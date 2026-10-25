/* Small exact annotation pictures, independent of the playback decoder slots. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EVARecordPreviews = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function createRecordPreviews({ info, budget, read, isCurrent, busy = () => false, evict, env = {} }) {
    const schedule = env.setTimeout || ((f, ms) => setTimeout(f, ms)), cancel = env.clearTimeout || (id => clearTimeout(id));
    const decode = env.decode || ((bytes, width, height) => createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { resizeWidth: width, resizeHeight: height }));
    const maxBytes = Math.min(16 * 1024 ** 2, Math.floor(budget.snapshot().limit / 32));
    const entries = new Map(), tasks = new Map(), failures = new Map(), painted = new Set(), prepared = new Set();
    let all = [], visible = [], timer = null, closed = false, resident = 0;
    const dimensions = () => { const factor = Math.min(1, 240 / info.width, 135 / info.height); return { width: Math.max(1, Math.round(info.width * factor)), height: Math.max(1, Math.round(info.height * factor)) }; };
    function discard(ordinal) { const entry = entries.get(ordinal); if (!entry) return; entries.delete(ordinal); resident -= entry.bytes; entry.bitmap.close(); budget.release(entry.token); }
    function trim(need) { while (entries.size && (resident + need > maxBytes || entries.size >= 96)) discard(entries.keys().next().value); }
    async function obtain(ordinal, idle = false) {
      if (closed || !isCurrent() || !Number.isSafeInteger(ordinal) || !info.frames[ordinal]) return null;
      if (failures.get(ordinal) > Date.now()) return null;
      if (entries.has(ordinal)) { const entry = entries.get(ordinal); entries.delete(ordinal); entries.set(ordinal, entry); return entry; }
      if (tasks.has(ordinal)) return tasks.get(ordinal).promise;
      if (busy()) return null;
      if (tasks.size >= 2) return null;
      const controller = new AbortController(), holder = { controller, promise: null };
      holder.promise = (async () => {
        let token = null, bitmap = null;
        try {
          const size = dimensions(), bytes = size.width * size.height * 4;
          trim(bytes);
          token = budget.reserve(info.width * info.height * 4 + 16 * 1024 ** 2 + bytes, 'record-preview-loading', evict);
          const picture = await read(ordinal, { signal: controller.signal, priority: idle ? 'idle' : 'normal' });
          if (closed || !isCurrent() || controller.signal.aborted || !picture) return null;
          if (picture.ordinal !== ordinal || !picture.bytes?.byteLength || picture.width !== info.width || picture.height !== info.height) throw Error('记录缩略图源帧身份不符。');
          if (picture.bytes.byteLength > 8 * 1024 ** 2) throw Error('记录静帧超过资源上限。');
          budget.shrink(token, info.width * info.height * 4 + picture.bytes.byteLength * 2 + bytes, 'record-preview-loading');
          bitmap = await decode(picture.bytes, size.width, size.height);
          if (closed || !isCurrent() || controller.signal.aborted) return null;
          if (!bitmap || bitmap.width !== size.width || bitmap.height !== size.height) throw Error('记录缩略图解码尺寸不符。');
          trim(bytes); // Another auxiliary decode may have filled the pool while this one awaited.
          budget.shrink(token, bytes, 'record-preview-cache');
          const entry = { bitmap, bytes, token, ...size }; bitmap = token = null;
          entries.set(ordinal, entry); resident += bytes; prepared.add(ordinal); failures.delete(ordinal); return entry;
        } catch (error) { if (!closed && error.code !== 'MEDIA_CANCELLED' && error.name !== 'AbortError') failures.set(ordinal, Date.now() + 5000); return null; }
        finally { if (bitmap) bitmap.close(); if (token) budget.release(token); }
      })().finally(() => { tasks.delete(ordinal); kick(); });
      tasks.set(ordinal, holder); return holder.promise;
    }
    function kick() {
      if (closed || timer !== null || tasks.size || !isCurrent()) return;
      const wanted = [...new Set([...visible, ...all])].find(n => !prepared.has(n) && !entries.has(n) && (!failures.has(n) || failures.get(n) <= Date.now()));
      if (wanted === undefined) return;
      timer = schedule(() => { timer = null; if (busy()) { kick(); return; } obtain(wanted, true); }, 120);
    }
    return {
      prioritize(value) {
        const clean = rows => [...new Set((rows || []).filter(n => Number.isSafeInteger(n) && !!info.frames[n]))].slice(0, 120000);
        all = clean(value.all); visible = clean(value.visible); kick();
      },
      async paint(ordinal, canvas) {
        if (closed || !canvas?.getContext) return null;
        const entry = await obtain(ordinal); if (!entry || closed || !isCurrent() || !entries.has(ordinal)) return null;
        let token, resized = false;
        try { token = budget.reserve(entry.bytes, 'record-thumbnail', evict); canvas.width = entry.width; canvas.height = entry.height;
          resized = true;
          canvas.getContext('2d').drawImage(entry.bitmap, 0, 0, entry.width, entry.height); }
        catch (_) { if (resized) canvas.width = canvas.height = 1; if (token) budget.release(token); return null; }
        let released = false; const lease = { release() { if (released) return; released = true; budget.release(token); canvas.width = canvas.height = 1; painted.delete(lease); } };
        painted.add(lease); return lease;
      },
      snapshot: () => ({ frames: entries.size, bytes: resident, limit: maxBytes, pending: tasks.size }),
      async close() { closed = true; if (timer !== null) cancel(timer); timer = null; for (const task of tasks.values()) task.controller.abort();
        await Promise.allSettled([...tasks.values()].map(task => task.promise)); for (const lease of [...painted]) lease.release(); for (const ordinal of [...entries.keys()]) discard(ordinal); }
    };
  }
  return { createRecordPreviews };
});
