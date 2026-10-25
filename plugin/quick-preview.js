/* Temporary, approximate native-video previews. Never a source-frame authority. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EVAQuickPreview = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function createQuickPreview({ canvas, info, sourceUrl, budget, evict, isCurrent, onChange = () => {}, env = {} }) {
    const doc = env.document || canvas?.ownerDocument;
    const now = env.now || (() => performance.now()), later = env.setTimeout || ((f, ms) => setTimeout(f, ms)), cancel = env.clearTimeout || (id => clearTimeout(id));
    let dead = false, disabled = false, latest = null, running = null, serial = 0, active = false, timer = null, failures = 0;
    let shownTime = null, held = null, generation = 0, cachedBytes = 0, lastAttempt = null;
    const cache = new Map(), cacheLimit = budget ? Math.min(8 * 1024 ** 2, Math.floor(budget.snapshot().limit / 64)) : 0;
    const listeners = [], video = env.video || doc?.createElement?.('video'), overlay = env.overlay || doc?.createElement?.('canvas');
    const scale = Math.min(1, 480 / info.width, 270 / info.height);
    const width = Math.max(1, Math.round(info.width * scale)), height = Math.max(1, Math.round(info.height * scale));
    const snapshot = () => ({ active, approximate: active, time: shownTime, disabled, pending: !!(latest || running),
      cachedFrames: cache.size, cachedBytes, cacheLimit, lastAttempt, purpose: 'temporary-preview' });
    const changed = () => { try { onChange(snapshot()); } catch (_) {} };
    if (!video || !overlay || !doc || !sourceUrl || !budget || !canvas?.parentElement) return { request() {}, cancel() {}, clear() {}, snapshot, async close() {} };
    overlay.width = overlay.height = 1; overlay.hidden = true; overlay.className = 'quick-preview-picture';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;z-index:1;background:#000';
    video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.tabIndex = -1;
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;width:1px;height:1px;left:-4px;top:-4px;opacity:0;pointer-events:none';
    canvas.parentElement.appendChild(overlay); canvas.parentElement.appendChild(video);
    function listen(name, fn) { video.addEventListener(name, fn); listeners.push([name, fn]); }
    function valid() { return !dead && !disabled && latest && isCurrent(latest); }
    function nativeOffset() {
      const frame = info.frames?.[0];
      if (!frame?.timeBase || !/^-?\d+$/.test(frame.ptsTicks || '')) return 0;
      const origin = Number(BigInt(frame.ptsTicks)) * frame.timeBase[0] / frame.timeBase[1];
      // currentTime uses the media presentation timeline. duration can report
      // just the span even when a leading edit interval remains in that clock;
      // it is not evidence that the source PTS origin was removed.
      return Number.isFinite(origin) ? Math.max(0, origin) : 0;
    }
    function cleanRequest(request) {
      if (!request) return;
      if (request.fallbackTimer !== undefined) { cancel(request.fallbackTimer); delete request.fallbackTimer; }
      if (request.callbackId !== undefined) { try { video.cancelVideoFrameCallback?.(request.callbackId); } catch (_) {} delete request.callbackId; }
    }
    function releaseOverlay() {
      try { overlay.width = overlay.height = 1; }
      finally { if (held) budget.release(held); held = null; }
    }
    function drawOverlay(picture) {
      const previous = held, token = previous || budget.reserve(width * height * 4, 'temporary-preview-canvas', evict);
      try {
        // The backing store grows only after its actual RGBA bytes are held.
        if (!previous) { overlay.width = width; overlay.height = height; }
        overlay.getContext('2d').drawImage(picture, 0, 0, width, height);
        held = token;
      } catch (error) {
        if (!previous) {
          try { overlay.width = overlay.height = 1; }
          finally { budget.release(token); }
        }
        throw error;
      }
    }
    function drop(key) {
      const entry = cache.get(key); if (!entry) return;
      cache.delete(key); cachedBytes -= entry.bytes;
      try { entry.canvas.width = entry.canvas.height = 1; }
      finally { budget.release(entry.token); }
    }
    function remember(time) {
      const key = Math.round(time * 10), factor = Math.min(1, 240 / width, 135 / height);
      const w = Math.max(1, Math.round(width * factor)), h = Math.max(1, Math.round(height * factor)), bytes = w * h * 4;
      if (bytes > cacheLimit) return;
      if (cache.has(key)) drop(key);
      while (cache.size && (cachedBytes + bytes > cacheLimit || cache.size >= 64)) drop(cache.keys().next().value);
      let token, picture = null;
      try {
        token = budget.reserve(bytes, 'temporary-preview-cache', evict);
        picture = doc.createElement('canvas'); picture.width = w; picture.height = h;
        picture.getContext('2d').drawImage(overlay, 0, 0, w, h);
        cache.set(key, { canvas: picture, time, bytes, token }); cachedBytes += bytes; token = picture = null;
      } catch (_) {} finally {
        if (token) {
          try { if (picture) picture.width = picture.height = 1; }
          finally { budget.release(token); }
        }
      }
    }
    function finish(request, mediaTime) {
      if (running !== request || dead) return;
      const age = now() - request.startedAt, matching = Number.isFinite(mediaTime) && Math.abs(mediaTime - request.seekTime) <= Math.max(.25, request.quantum);
      lastAttempt = { requested: request.seekTime, returned: Number.isFinite(mediaTime) ? mediaTime : null, ageMs: age,
        nativeTime: video.currentTime, nativeDuration: Number.isFinite(video.duration) ? video.duration : null, offset: request.offset,
        readyState: video.readyState, matching };
      // Initial decoded callbacks can precede the requested seek's picture.
      // Keep the still-current request/fallback alive instead of consuming it.
      if (!matching && valid() && latest.id === request.id) return;
      cleanRequest(request);
      if (timer !== null) { cancel(timer); timer = null; }
      running = null;
      // A slightly late picture may follow a fast pointer; it cannot survive a
      // source/precise-frame generation change or overwrite an accurate draw.
      if (request.generation === generation && valid() && (latest.id === request.id || age <= 250) && video.readyState >= 2 && matching) {
        try {
          drawOverlay(video);
          active = true; shownTime = mediaTime; overlay.hidden = false; remember(mediaTime); changed();
        } catch (_) { /* Optional preview cannot turn a precise seek into an error. */ }
      }
      if (latest?.id === request.id) latest = null;
      pump();
    }
    function pump() {
      if (!valid() || running || video.readyState < 1) return;
      const item = latest, request = running = { ...item, startedAt: now(), generation };
      timer = later(() => {
        if (running !== request) return;
        cleanRequest(request);
        running = null; timer = null; failures++;
        if (latest?.id === request.id) latest = null;
        if (failures >= 2) disabled = true;
        changed(); pump();
      }, 1500);
      try {
        request.offset = nativeOffset();
        const nativeTime = request.seekTime + request.offset;
        if (Math.abs(video.currentTime - nativeTime) < .001 && video.readyState >= 2) finish(request, video.currentTime - request.offset);
        else video.currentTime = nativeTime;
      } catch (_) { finish(request, NaN); }
    }
    listen('loadedmetadata', pump);
    listen('seeked', () => {
      const request = running; if (!request) return;
      const wanted = request.seekTime + request.offset;
      if (Math.abs(video.currentTime - wanted) > .25) {
        // A video's automatic initial seek can race a target set at metadata.
        try { video.currentTime = wanted; } catch (_) {} return;
      }
      if (typeof video.requestVideoFrameCallback === 'function') {
        request.callbackId = video.requestVideoFrameCallback((_at, metadata) => finish(request, metadata.mediaTime - request.offset));
        // Paused video callbacks can be throttled by the host. seeked already
        // means decoded media is available; this fallback stays approximate.
        request.fallbackTimer = later(() => { if (running === request) finish(request, video.currentTime - request.offset); }, 8);
      } else finish(request, video.currentTime - request.offset);
    });
    listen('error', () => { stop(); disabled = true; changed(); });
    video.src = sourceUrl; video.load();
    function stop() { generation++; latest = null; if (timer !== null) cancel(timer); timer = null; cleanRequest(running); running = null; }
    function clear() { stop(); active = false; shownTime = null; overlay.hidden = true; releaseOverlay(); changed(); }
    return {
      request(time, settings = {}) {
        if (dead || disabled || !Number.isFinite(time)) return;
        const at = now(), previous = latest || running;
        const speed = previous && at > previous.inputAt ? Math.abs(time - previous.time) / ((at - previous.inputAt) / 1000) : 0;
        const quantum = speed > 30 ? .2 : speed > 5 ? .08 : 0;
        const seekTime = Math.max(0, Math.min(info.duration - .001, quantum ? Math.round(time / quantum) * quantum : time));
        latest = { id: ++serial, time, seekTime, quantum, inputAt: at, initial: !!settings.initial };
        const nearby = [...cache.values()].find(entry => Math.abs(entry.time - seekTime) <= Math.max(.025, quantum / 2));
        if (nearby && valid()) {
          try {
            drawOverlay(nearby.canvas);
            active = true; shownTime = nearby.time; overlay.hidden = false; stop(); changed(); return;
          } catch (_) {}
        }
        pump();
      },
      cancel: stop, clear, snapshot,
      async close() { if (dead) return; clear(); dead = true; for (const key of [...cache.keys()]) drop(key); for (const [name, fn] of listeners) video.removeEventListener(name, fn);
        video.pause(); video.removeAttribute('src'); video.load(); video.remove(); overlay.remove(); }
    };
  }
  return { createQuickPreview };
});
