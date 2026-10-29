/* Isolated E44 gate. No proxy encoding, Eagle API, filesystem or fallback path. */
(function (root) {
  'use strict';
  function targetAt(index, seconds) {
    const a = index.sorted; let l = 0, h = a.length;
    while (l < h) { const m = (l + h) >>> 1; if (a[m].pts <= seconds * 1e6) l = m + 1; else h = m; }
    return a[Math.max(0, l - 1)];
  }
  async function create({ index, read, draw, blank, hardware = 'no-preference', ramBytes = 256 * 1024 ** 2 }) {
    const config = { codec: index.codec, description: Uint8Array.from(index.description), codedWidth: index.width, codedHeight: index.height, hardwareAcceleration: hardware, optimizeForLatency: true };
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) throw Error('Decoder config unsupported: ' + hardware);
    const packets = index.packets, cache = new Map(); let used = 0, serial = 0, generation = 0, next = 0, group = -1, decoder = null;
    let latest = null, running = false, dead = false, decodeError = null, drainRequired = false;
    const stats = { decoded: 0, resets: 0, readBytes: 0, readMs: 0, peakQueue: 0, cacheHits: 0, peakBytes: 0, submitted: 0, outputPts: [] };
    const wait = () => new Promise(r => setTimeout(r, 0));
    function finish(r, status, fields = {}) { clearTimeout(r.timer); r.resolve({ id: r.id, target: r.target.pts, status, ms: performance.now() - r.at, ...fields }); }
    function show(r, frame, hit) {
      if (dead || latest !== r) return;
      const at = performance.now(); draw(frame.picture || frame, frame.timestamp); latest = null; stats.submitted++;
      finish(r, 'exact', { actualPts: frame.timestamp, cache: hit, renderMs: performance.now() - at });
    }
    function output(frame, g) {
      if (dead || g !== generation) { frame.close(); return; }
      stats.decoded++;
      // Decoder surfaces must be returned immediately: retaining them can exhaust
      // hardware output pools. Cache independent target canvases, not VideoFrame clones.
      const pts = frame.timestamp;
      try {
        if (!latest || pts !== latest.target.pts) return;
        const picture = new OffscreenCanvas(1280, 720), bytes = 1280 * 720 * 4;
        picture.getContext('2d', { alpha: false }).drawImage(frame, 0, 0, 1280, 720);
        const cached = { picture, timestamp: pts, close() { picture.width = picture.height = 1; } };
        while (used + bytes > ramBytes && cache.size) { const k = cache.keys().next().value, v = cache.get(k); used -= v.bytes; v.frame.close(); cache.delete(k); }
        if (bytes <= ramBytes) { cache.set(pts, { frame: cached, bytes }); used += bytes; stats.peakBytes = Math.max(stats.peakBytes, used); }
        show(latest, cached, false);
        if (bytes > ramBytes) cached.close();
      } finally { frame.close(); }
    }
    function reset(key) {
      generation++; if (decoder && decoder.state !== 'closed') decoder.close();
      const g = generation; decodeError = null; drainRequired = false; group = key; next = key; stats.resets++;
      decoder = new VideoDecoder({ output: f => output(f, g), error: e => { if (g === generation) { decodeError = e; if (latest) { const r = latest; latest = null; finish(r, 'error', { error: e.message }); } } } });
      decoder.configure(config);
    }
    async function pump() {
      if (running || dead) return; running = true;
      try {
        while (latest && !dead) {
          const r = latest, p = packets[r.target.n], hit = cache.get(r.target.pts);
          if (hit) { stats.cacheHits++; cache.delete(r.target.pts); cache.set(r.target.pts, hit); show(r, hit.frame, true); continue; }
          if (!decoder || decodeError || drainRequired || group !== p.key || (r.target.n < next - 24 && decoder.decodeQueueSize === 0)) reset(p.key);
          const g = generation, end = Math.min(packets.length, r.target.n + 24);
          if (next >= end) { drainRequired = true; await decoder.flush(); continue; }
          // Bound the total, not just the pre-batch queue. A batch of eight with
          // seven pending packets previously allowed fifteen queued 4K frames.
          const capacity = 2 - decoder.decodeQueueSize;
          if (capacity <= 0) { await wait(); continue; }
          const a = next, b = Math.min(end, a + capacity), at = performance.now(), bytes = await read(a, b);
          stats.readMs += performance.now() - at; stats.readBytes += bytes.byteLength;
          if (dead || g !== generation || !latest) continue;
          if (packets[latest.target.n].key !== group) continue;
          let offset = 0;
          for (let n = a; n < b; n++) { const v = packets[n]; decoder.decode(new EncodedVideoChunk({ type: v.isKey ? 'key' : 'delta', timestamp: v.pts, data: bytes.subarray(offset, offset + v.size) })); offset += v.size; next++; }
          stats.peakQueue = Math.max(stats.peakQueue, decoder.decodeQueueSize);
        }
      } catch (e) { if (latest) { const r = latest; latest = null; finish(r, 'error', { error: e.message }); } }
      finally { running = false; if (latest && !dead) pump(); }
    }
    return {
      seek(seconds) {
        if (dead) return Promise.resolve({ status: 'closed' });
        if (latest) finish(latest, 'superseded');
        blank();
        return new Promise(resolve => {
          const r = latest = { id: ++serial, target: targetAt(index, seconds), at: performance.now(), resolve };
          r.timer = setTimeout(() => { if (latest === r) { latest = null; finish(r, 'timeout'); } }, 8000);
          pump();
        });
      },
      snapshot() { return { ...stats, cacheFrames: cache.size, cacheBytes: used, pending: !!latest, support: support.config, hardwareActual: 'unconfirmed' }; },
      close() { const at = performance.now(); dead = true; generation++; if (latest) { finish(latest, 'closed'); latest = null; } if (decoder && decoder.state !== 'closed') decoder.close(); for (const { frame } of cache.values()) frame.close(); cache.clear(); used = 0; return { ms: performance.now() - at, bytes: used, frames: cache.size }; }
    };
  }
  root.E44Direct = { create, targetAt };
})(globalThis);
