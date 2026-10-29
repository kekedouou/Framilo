(function (root) {
  'use strict';
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const percentile = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(a.length * p) - 1)] : null;
  async function nativeReader({ url, index, draw, blank }) {
    const v = document.getElementById('reference'); v.muted = true; v.preload = 'auto'; let latest = null, dead = false, callback = null, serial = 0;
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Native metadata timeout')), 8000); v.onloadedmetadata = () => { clearTimeout(timer); resolve(); }; v.onerror = () => { clearTimeout(timer); reject(Error('Native source unsupported')); }; v.src = url; });
    function finish(r, status, fields = {}) { clearTimeout(r.timer); r.resolve({ id: r.id, target: r.target.pts, status, ms: performance.now() - r.at, ...fields }); }
    function frame(now, meta) {
      callback = null; if (dead) return;
      if (latest && Math.abs(meta.mediaTime * 1e6 - latest.target.pts) < 2) {
        const r = latest; latest = null; draw(v, r.target.pts); finish(r, 'exact', { actualPts: Math.round(meta.mediaTime * 1e6), presentedFrames: meta.presentedFrames });
      }
      callback = v.requestVideoFrameCallback(frame);
    }
    callback = v.requestVideoFrameCallback(frame);
    let shown = null;
    const originalDraw = draw; draw = (v, pts) => { shown = pts; originalDraw(v, pts); };
    return {
      seek(t) {
        if (latest) finish(latest, 'superseded'); blank();
        return new Promise(resolve => {
          const target = E44Direct.targetAt(index, t), r = latest = { id: ++serial, target, at: performance.now(), resolve };
          if (shown === target.pts && !v.seeking) { latest = null; draw(v, shown); finish(r, 'exact', { actualPts: shown, cache: true }); return; }
          r.timer = setTimeout(() => { if (latest === r) { latest = null; finish(r, 'timeout', { videoTime: v.currentTime }); } }, 8000);
          const n = index.sorted.findIndex(p => p.pts === target.pts), end = index.sorted[n + 1]?.pts ?? target.pts + 16000;
          // Seek inside the source frame's presentation interval, not a rounded frame rate.
          v.currentTime = (target.pts + (end - target.pts) / 2) / 1e6;
        });
      },
      snapshot() { return { quality: v.getVideoPlaybackQuality(), hardwareActual: 'opaque-native-video', sourceWidth: v.videoWidth, sourceHeight: v.videoHeight }; },
      close() { const at = performance.now(); dead = true; if (latest) finish(latest, 'closed'); latest = null; if (callback !== null) v.cancelVideoFrameCallback(callback); v.pause(); v.removeAttribute('src'); v.load(); return { ms: performance.now() - at }; }
    };
  }
  root.E44Gate = {
    async run({ index, url, read, label, host, save, onStatus = () => {}, preferences = ['prefer-hardware', 'prefer-software'], rounds = 3 }) {
      const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d', { alpha: false }), cursor = document.querySelector('#cursor');
      const begin = performance.now(), draws = [], blankEvents = [], runs = [];
      // Hide the display layer without issuing GPU canvas work on every input.
      // Drawing the confirmed target is the only operation that reveals it again.
      const draw = (picture, pts) => { ctx.drawImage(picture, 0, 0, canvas.width, canvas.height); canvas.style.visibility = 'visible'; draws.push({ at: performance.now() - begin, pts }); };
      const blank = () => { canvas.style.visibility = 'hidden'; blankEvents.push(performance.now() - begin); };
      const input = (reader, t, scenario, pending) => {
        const at = performance.now(); cursor.style.left = Math.min(100, t / 77.46 * 100) + '%';
        const p = reader.seek(t).then(r => ({ ...r, scenario, inputTime: t, inputAt: at - begin }));
        const seekSyncMs = performance.now() - at;
        const cursorMs = new Promise(r => requestAnimationFrame(() => r(performance.now() - at)));
        pending.push(p.then(async r => ({ ...r, seekSyncMs, cursorMs: await cursorMs }))); return p;
      };
      const report = { schema: 'e44-gate-a-v1', label, host, sourceHash: index.sourceHash, browser: navigator.userAgent, at: new Date().toISOString(), complete: false, scope: 'isolated 720p display; native video reference vs full-resolution original compressed packet decode; no proxy; no Eagle annotation writes; submission not physical display', runs };
      try {
        for (let round = 0; round < rounds; round++) {
          const order = round % 2 ? [...preferences, 'native'] : ['native', ...preferences];
          for (const hardware of order) {
            onStatus(`第 ${round + 1}/${rounds} 轮 · ${hardware}`);
            const rows = [], start = performance.now(), drawStart = draws.length, blankStart = blankEvents.length;
            const run = { round, hardware, rows, complete: false }; runs.push(run); let reader;
            try {
              reader = hardware === 'native' ? await nativeReader({ url, index, draw, blank }) : await E44Worker.create({ index, read, draw, blank, hardware });
              run.openMs = performance.now() - start;
              for (const t of [58.4, 22.7, 44.2, 1.5, 72.4, 12.3]) { const r = await input(reader, t, 'remote', rows); if (r.status !== 'exact') throw Error('Remote gate stopped: ' + r.status); }
              for (let n = 0; n < 12; n++) { await input(reader, 12.3 + n / 60, 'step', rows); await wait(20); }
              for (let n = 0; n < 60; n++) { input(reader, 5 + n * .92, 'fast', rows); await wait(16); }
              await input(reader, 59.28, 'release', rows);
              for (let n = 0; n < 12; n++) { await input(reader, 59.28 - n / 60, 'reverse', rows); await wait(20); }
              const resolved = await Promise.all(rows); run.rows = resolved; run.stats = reader.snapshot();
              const completed = resolved.filter(r => r.status === 'exact'), slow = resolved.filter(r => r.scenario === 'remote' && r.status === 'exact');
              run.summary = { total: resolved.length, exact: completed.length, superseded: resolved.filter(r => r.status === 'superseded').length, timeout: resolved.filter(r => r.status === 'timeout').length, errors: resolved.filter(r => r.status === 'error').length, wrongFrame: completed.filter(r => r.actualPts !== r.target).length, remoteP95: percentile(slow.map(r => r.ms), .95), cursorP95: percentile(resolved.map(r => r.cursorMs), .95), cursorMax: Math.max(...resolved.map(r => r.cursorMs)), releaseMs: resolved.find(r => r.scenario === 'release')?.ms };
              // A mismatched frame is rejected before drawing, but is still a failed request.
              run.summary.wrongFrame += resolved.filter(r => r.status === 'wrong-frame').length;
              run.summary.errors += resolved.filter(r => !['exact','superseded','timeout','error','wrong-frame'].includes(r.status)).length;
              run.complete = run.summary.errors === 0 && run.summary.timeout === 0 && run.summary.wrongFrame === 0;
            } catch (e) { run.error = String(e.stack || e); }
            finally { if (reader) { run.stats = reader.snapshot(); run.close = await reader.close(); run.statsAfterClose = reader.snapshot(); } run.rows = await Promise.all(rows); run.draws = draws.slice(drawStart); run.blanks = blankEvents.slice(blankStart); }
            await save(report); await wait(200);
          }
        }
        report.complete = runs.every(r => r.complete); return report;
      } finally { report.durationMs = performance.now() - begin; await save(report); }
    }
  };
})(globalThis);
