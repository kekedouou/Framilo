'use strict';

// Renderer-side lease pool. No paths or bytes cross the control channel.
// A reader keeps a lease until all reads have settled, including cancellation.
function createSegmentReader({ info, acquire, release, readAsset }) {
  const entries = new Map(); let closed = false, stopping = false, clock = 0, targetOrdinal = 0;
  const active = new Set(), maintenance = new Set(); let prefetchKey = null, cleanupFailure = null; let protectedOrdinals = new Set();
  function groupAt(time) {
    let low = 0, high = info.segments.length;
    while (low < high) { const mid = (low + high) >>> 1; if (info.segments[mid].start <= time) low = mid + 1; else high = mid; }
    return Math.max(0, low - 1);
  }
  async function evict() {
    while (entries.size > 3) {
      const candidates = [...entries.values()].filter(e => !e.users && e.value && !protectedOrdinals.has(e.ordinal)).sort((a, b) => a.used - b.used);
      if (!candidates.length) break;
      const old = candidates[0]; entries.delete(old.ordinal); await release(old.value);
    }
  }
  async function use(ordinal, callback) {
    if (closed || stopping) throw new Error('视频分段读取已关闭。');
    let entry = entries.get(ordinal);
    if (!entry) {
      entry = { ordinal, users: 0, used: ++clock, value: null, controller: new AbortController() };
      entries.set(ordinal, entry);
      entry.promise = acquire(ordinal, entry.controller.signal).then(value => { entry.value = value; return value; }, error => { entries.delete(ordinal); throw error; });
    }
    entry.users++; entry.used = ++clock;
    const task = (async () => { try { const value = await entry.promise; if (closed) throw new Error('视频分段读取已关闭。'); return await callback(value); }
      finally {
        entry.users--;
        // Release acknowledgement is serialized behind worker decoding. Do not
        // hold an already-read frame hostage to a future segment's completion.
        const cleanup = evict(); maintenance.add(cleanup);
        cleanup.then(() => maintenance.delete(cleanup), error => { cleanupFailure = error; maintenance.delete(cleanup); });
      } })();
    active.add(task); task.then(() => active.delete(task), () => active.delete(task)); return task;
  }
  function frame(file) {
    const match = /^frame-(\d+)\.jpg$/.exec(file), ordinal = match && Number(match[1]);
    if (!match || !Number.isSafeInteger(ordinal) || !info.frames[ordinal] || info.frames[ordinal].file !== file) throw new Error('无效的长视频帧资源。');
    const segment = groupAt(info.frames[ordinal].time), range = info.segments[segment];
    return use(segment, value => {
      const resource = value.frames[ordinal - range.first];
      if (!resource || resource.ptsTicks !== info.frames[ordinal].ptsTicks) throw new Error('分段帧身份不一致。');
      return readAsset(value, resource.file);
    }).catch(error => { if (!closed && !stopping && error.code === 'MEDIA_CANCELLED' && segment === targetOrdinal) return frame(file); throw error; });
  }
  function audio(ordinal) {
    if (!Number.isSafeInteger(ordinal) || !info.segments[ordinal]) throw new Error('无效的音频分段。');
    return use(ordinal, async value => value.audio ? { bytes: await readAsset(value, value.audio.file),
      start: info.segments[ordinal].start + value.audio.start, duration: value.audio.duration } : null);
  }
  function cancelExcept(time) {
    const wanted = groupAt(time);
    targetOrdinal = wanted; prefetchKey = null; protectedOrdinals = new Set([wanted]);
    for (const entry of entries.values()) if (!entry.value && entry.ordinal !== wanted) entry.controller.abort();
  }
  function prefetch(time, loop) {
    if (closed || stopping) return;
    const current = groupAt(time), key = current + ':' + (loop ? loop.start + ':' + loop.end : '');
    if (key === prefetchKey) return; prefetchKey = key;
    let next = current; const seen = new Set([current]); protectedOrdinals = seen;
    for (let n = 0; n < 2; n++) {
      const boundary = info.segments[next].end;
      const wanted = loop && boundary >= loop.end ? groupAt(loop.start) : next + 1;
      if (wanted >= info.segments.length || seen.has(wanted)) break;
      seen.add(wanted); next = wanted;
      // Preparation is independent of optional bitmap predecode. At most two
      // upcoming disk segments share the same coalesced demand/PCM lease pool.
      use(wanted, () => null).catch(() => {}); // A real demand reports failures.
    }
  }
  function cancelAll() { stopping = true; for (const entry of entries.values()) if (!entry.value) entry.controller.abort(); }
  async function close() {
    closed = true; for (const entry of entries.values()) entry.controller.abort();
    await Promise.allSettled([...active]);
    await Promise.allSettled([...maintenance]);
    const retained = [...entries.values()]; entries.clear();
    const results = await Promise.allSettled(retained.map(async entry => { const value = await entry.promise.catch(() => null); if (value) await release(value); }));
    const failed = results.find(result => result.status === 'rejected'); if (failed) throw failed.reason; if (cleanupFailure) throw cleanupFailure;
  }
  return { frame, audio, prefetch, cancelExcept, cancelAll, close };
}
module.exports = { createSegmentReader };
