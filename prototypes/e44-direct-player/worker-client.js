(function (root) {
  'use strict';
  root.E44Worker = { async create({ index, read, draw, blank, hardware, ramBytes = 256 * 1024 ** 2 }) {
    const worker = new Worker('worker.js'); let serial = 0, latest = null, dead = false, snapshot = {}, closeResolve;
    const pending = new Map(); let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    function finish(r, status, extra = {}) {
      clearTimeout(r.timer); pending.delete(r.id); if (latest === r) latest = null;
      r.resolve({ id: r.id, status, target: r.target, ms: performance.now() - r.at, ...extra });
    }
    worker.onmessage = async ({ data: m }) => {
      if (m.snapshot) snapshot = m.snapshot;
      if (m.type === 'read') {
        try { const buffer = await read(m.a, m.b); if (!dead) { const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); worker.postMessage({ type: 'bytes', id: m.id, bytes }, [bytes]); } }
        catch (e) { if (!dead) worker.postMessage({ type: 'bytes', id: m.id, error: e.message }); } return;
      }
      if (m.type === 'opened') return readyResolve();
      if (m.type === 'closed') { clearTimeout(closeTimer); closeResolve?.({ ...m.result, workerExited: true }); worker.terminate(); return; }
      if (m.type === 'fatal') { readyReject(Error(m.error)); for (const r of [...pending.values()]) finish(r, 'error', { error: m.error }); return; }
      const r = pending.get(m.id);
      if (m.type === 'picture') {
        try { if (dead || !r || latest !== r) return; if (m.pts !== r.target) { finish(r, 'error', { error: 'Wrong source PTS' }); return; } const at = performance.now(); draw(m.bitmap, m.pts); finish(r, 'exact', { actualPts: m.pts, renderMs: performance.now() - at }); }
        finally { m.bitmap.close(); }
      } else if (r && m.type === 'picture-error') finish(r, 'error', { error: m.error });
      else if (r && m.type === 'result' && m.result.status !== 'exact') finish(r, m.result.status, { error: m.result.error });
    };
    worker.onerror = e => { readyReject(Error(e.message)); for (const r of [...pending.values()]) finish(r, 'error', { error: e.message }); };
    worker.postMessage({ type: 'open', index, hardware, ramBytes });
    const startup = setTimeout(() => readyReject(Error('Worker startup timed out')), 5000);
    try { await ready; } catch (e) { worker.terminate(); throw e; } finally { clearTimeout(startup); }
    let closePromise = null, closeTimer;
    return {
      seek(seconds) {
        if (dead) return Promise.resolve({ status: 'closed' });
        if (latest) finish(latest, 'superseded'); blank();
        return new Promise(resolve => { const r = latest = { id: ++serial, target: E44Direct.targetAt(index, seconds).pts, at: performance.now(), resolve }; pending.set(r.id, r); r.timer = setTimeout(() => { if (pending.has(r.id)) finish(r, 'timeout'); }, 8500); worker.postMessage({ type: 'seek', id: r.id, seconds }); });
      },
      snapshot() { return { ...snapshot, pending: pending.size, worker: 'browser-dedicated-worker' }; },
      close() {
        if (closePromise) return closePromise; dead = true; const at = performance.now();
        for (const r of [...pending.values()]) finish(r, 'closed');
        closePromise = new Promise(resolve => { closeResolve = v => resolve({ ...v, wallMs: performance.now() - at }); closeTimer = setTimeout(() => { worker.terminate(); resolve({ wallMs: performance.now() - at, workerExited: false, forced: true }); }, 2000); worker.postMessage({ type: 'close' }); });
        return closePromise;
      }
    };
  } };
})(globalThis);
