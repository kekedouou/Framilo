/* Temporary, approximate native-video previews. Never a source-frame authority. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EVAQuickPreview = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function createQuickPreview({ canvas, info, sourceUrl, budget, evict, isCurrent, onChange = () => {}, onPerformance = () => {}, scrubSource = null, env = {} }) {
    const doc = env.document || canvas?.ownerDocument;
    const now = env.now || (() => performance.now()), later = env.setTimeout || ((f, ms) => setTimeout(f, ms)), cancel = env.clearTimeout || (id => clearTimeout(id));
    let dead = false, disabled = false, latest = null, running = null, serial = 0, active = false, timer = null, failures = 0;
    let shownTime = null, held = null, generation = 0, cachedBytes = 0, lastAttempt = null, kickTimer = null, retryAt = 0;
    const cache = new Map(), cacheLimit = budget ? Math.min((scrubSource ? 4 : 8) * 1024 ** 2, Math.floor(budget.snapshot().limit / 64)) : 0;
    const listeners = [], video = env.video || doc?.createElement?.('video'), overlay = env.overlay || doc?.createElement?.('canvas');
    const scale = Math.min(1, 480 / info.width, 270 / info.height);
    const width = Math.max(1, Math.round(info.width * scale)), height = Math.max(1, Math.round(info.height * scale));
    const snapshot = () => ({ active, approximate: active, time: shownTime, disabled, pending: !!(latest || running),
      cachedFrames: cache.size, cachedBytes, cacheLimit, lastAttempt, failures, purpose: 'temporary-preview',
      native: { readyState: video?.readyState, seeking: video?.seeking, time: video?.currentTime, error: video?.error?.code || null } });
    const changed = () => { try { onChange(snapshot()); } catch (_) {} };
    if (!video || !overlay || !doc || !sourceUrl || !budget || !canvas?.parentElement) return { request() {}, cancel() {}, clear() {}, snapshot, async close() {} };
    overlay.width = overlay.height = 1; overlay.hidden = true; overlay.className = 'quick-preview-picture';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;z-index:1;background:#000';
    video.muted = true; video.playsInline = true; video.preload = 'metadata'; video.tabIndex = -1;
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;width:1px;height:1px;left:-4px;top:-4px;opacity:0;pointer-events:none';
    canvas.parentElement.appendChild(overlay); canvas.parentElement.appendChild(video);
    let lastInput=null;
    const scrubApi=env.scrubApi||(typeof globalThis==='object'&&globalThis.EVAScrubPreview);
    const scrub=scrubSource&&scrubApi? scrubApi.create({canvas,budget,evict,isCurrent,find:scrubSource.find,read:scrubSource.read,
      onMiss:(time,settings)=>api.request(time,{...settings,sparseFailed:true,delayMs:0}),
      onDraw:(frame,settings,time)=>{overlay.hidden=true;releaseOverlay();active=true;shownTime=frame.time;
        try{onPerformance({type:'preview',at:now(),time:frame.time,targetDeltaMs:(frame.time-time)*1000,...settings.performanceIdentity});}catch(_){}changed();}}):null;
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
    function sourceFrame(time) {
      const frames = info.frames; if (!frames?.length || !Number.isFinite(frames[0].time)) return null;
      let low = 0, high = frames.length;
      while (low < high) { const mid = (low + high) >>> 1; if (frames[mid].time <= time) low = mid + 1; else high = mid; }
      const frame = frames[Math.max(0, low - 1)];
      return Number.isFinite(frame.end) && frame.end > frame.time ? frame : null;
    }
    function remember(time, confirmed) {
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
        cache.set(key, { canvas: picture, time, confirmed, bytes, token }); cachedBytes += bytes; token = picture = null;
      } catch (_) {} finally {
        if (token) {
          try { if (picture) picture.width = picture.height = 1; }
          finally { budget.release(token); }
        }
      }
    }
    function finish(request, mediaTime, confirmed = false) {
      if (running !== request || dead) return;
      const age = now() - request.startedAt, matching = Number.isFinite(mediaTime) && (request.frame
        ? confirmed && Math.abs(mediaTime - request.frame.time) < .00001
        : Math.abs(mediaTime - request.seekTime) <= Math.max(.25, request.quantum));
      lastAttempt = { requested: request.seekTime, returned: Number.isFinite(mediaTime) ? mediaTime : null, ageMs: age,
        nativeTime: video.currentTime, nativeDuration: Number.isFinite(video.duration) ? video.duration : null, offset: request.offset,
        readyState: video.readyState, matching, confirmed };
      // Chromium can deliver the new frame callback while seeked still reports
      // HAVE_METADATA. Keep its identity until the element is drawable.
      if (matching && confirmed && video.readyState < 2) { request.confirmedTime = mediaTime; return; }
      // Initial decoded callbacks can precede the requested seek's picture.
      // Keep the still-current request/fallback alive instead of consuming it.
      if (!matching && valid() && latest.id === request.id) return;
      cleanRequest(request);
      if (timer !== null) { cancel(timer); timer = null; }
      running = null;
      // A slightly late picture may follow a fast pointer; it cannot survive a
      // source/precise-frame generation change or overwrite an accurate draw.
      if (request.generation === generation && valid() && (!latest.frame || confirmed && Math.abs(mediaTime - latest.frame.time) < .00001) &&
          (latest.id === request.id || Math.abs(mediaTime - latest.seekTime) <= Math.max(.025, latest.quantum / 2) ||
            !latest.final && age <= 250 && Math.abs(mediaTime-latest.seekTime) <= Math.min(2,Math.max(.1,latest.speed*.25))) && video.readyState >= 2 && matching) {
        try {
          drawOverlay(video);scrub?.clear();
          active = true; shownTime = mediaTime; overlay.hidden = false;
          failures = 0; retryAt = 0;
          try { onPerformance({ type: 'preview', at: now(), time: mediaTime, targetDeltaMs:(mediaTime-latest.time)*1000, ...latest.performanceIdentity }); } catch (_) {}
          remember(mediaTime, confirmed); changed();
        } catch (_) { /* Optional preview cannot turn a precise seek into an error. */ }
      }
      if (latest?.id === request.id) latest = null;
      pump();
    }
    function wake(delay) {
      if (kickTimer !== null) return;
      kickTimer = later(() => { kickTimer = null; pump(); }, Math.max(0, delay));
    }
    function watchFrame(request) {
      if (request.callbackId !== undefined || typeof video.requestVideoFrameCallback !== 'function') return;
      request.callbackId = video.requestVideoFrameCallback((_at, metadata) => {
        delete request.callbackId;
        finish(request, metadata.mediaTime - request.offset, true);
        if (running === request) watchFrame(request);
      });
    }
    function pump() {
      if (!valid() || video.readyState < 1) return;
      if (running) {
        if (latest.id === running.id) return;
        const age = now() - running.startedAt;
        const grace=latest.final||Math.abs(latest.seekTime-running.seekTime)>2?80:180;
        if (age < grace) { wake(grace - age); return; }
        // Retarget the one native decoder rather than waiting for an obsolete
        // 1.5s timeout. Throttle retargets so useful frames can still finish.
        cleanRequest(running); running = null;
        if (timer !== null) cancel(timer); timer = null;
      }
      if (now() < retryAt) { wake(retryAt - now()); return; }
      const item = latest, request = running = { ...item, startedAt: now(), generation };
      timer = later(() => {
        if (running !== request) return;
        cleanRequest(request);
        running = null; timer = null; failures++;
        if (latest?.id === request.id) latest = null;
        retryAt = now() + Math.min(500, failures * 100);
        changed(); pump();
      // A still-current release can wait for the native frame while the proxy
      // is being generated. New input still retargets within 80ms, and an exact
      // draw cancels immediately; this does not extend the proxy decoder timeout.
      }, request.final ? 3000 : 1500);
      try {
        request.offset = nativeOffset();
        const nativeTime = request.seekTime + request.offset;
        // Register before seeking: a paused frame may be presented before seeked.
        watchFrame(request);
        if (!request.frame && Math.abs(video.currentTime - nativeTime) < .001 && video.readyState >= 2) finish(request, video.currentTime - request.offset);
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
      if (Number.isFinite(request.confirmedTime) && video.readyState >= 2) {
        finish(request, request.confirmedTime, true); return;
      }
      if (typeof video.requestVideoFrameCallback === 'function') {
        watchFrame(request);
        // Paused video callbacks can be throttled by the host. seeked already
        // means decoded media is available; this fallback stays approximate.
        if (!request.frame) request.fallbackTimer = later(() => { if (running === request) finish(request, video.currentTime - request.offset); }, 8);
      } else if (!request.frame) finish(request, video.currentTime - request.offset);
    });
    listen('error', () => { stop(); disabled = true; changed(); });
    video.src = sourceUrl; video.load();
    function stop() { generation++; latest = null; if (timer !== null) cancel(timer); timer = null;
      if (kickTimer !== null) cancel(kickTimer); kickTimer = null; cleanRequest(running); running = null; }
    function clear() { stop(); scrub?.clear();lastInput=null; active = false; shownTime = null; overlay.hidden = true; releaseOverlay(); changed(); }
    const api = {
      request(time, settings = {}) {
        if (dead || !Number.isFinite(time)) return;
        const at = now(), previous = lastInput;
        const speed = previous && at > previous.inputAt ? Math.abs(time - previous.time) / ((at - previous.inputAt) / 1000) : 0;
        lastInput={time,inputAt:at};
        if(!settings.sparseFailed&&settings.final===false&&speed>3&&scrub?.request(time,settings)){stop();return;}
        scrub?.cancel();if(disabled)return;
        const quantum = settings.final ? 0 : speed > 30 ? .2 : speed > 5 ? .08 : 0;
        const frame = settings.final ? sourceFrame(time) : null;
        // Seek inside the source-frame interval; avoid rounding across its start.
        const seekTime = frame ? frame.time + Math.min(.001, (frame.end - frame.time) / 2)
          : Math.max(0, Math.min(info.duration - .001, quantum ? Math.round(time / quantum) * quantum : time));
        latest = { id: ++serial, time, seekTime, frame, quantum, speed, final:!!settings.final, inputAt: at, initial: !!settings.initial, performanceIdentity: settings.performanceIdentity };
        const nearby = [...cache.values()].find(entry => frame ? entry.confirmed && Math.abs(entry.time - frame.time) < .00001
          : Math.abs(entry.time - seekTime) <= Math.max(.025, quantum / 2));
        if (nearby && valid()) {
          try {
            drawOverlay(nearby.canvas);scrub?.clear();
            try { onPerformance({ type: 'preview', at: now(), time: nearby.time, targetDeltaMs:(nearby.time-latest.time)*1000, ...latest.performanceIdentity }); } catch (_) {}
            active = true; shownTime = nearby.time; overlay.hidden = false; stop(); changed(); return;
          } catch (_) {}
        }
        if (running) pump();
        else if (settings.delayMs > 0) wake(settings.delayMs);
        else pump();
      },
      cancel(){stop();scrub?.cancel();}, clear, snapshot,
      async close() { if (dead) return; clear(); dead = true; await scrub?.close(); for (const key of [...cache.keys()]) drop(key); for (const [name, fn] of listeners) video.removeEventListener(name, fn);
        video.pause(); video.removeAttribute('src'); video.load(); video.remove(); overlay.remove(); }
    };return api;
  }
  return { createQuickPreview };
});
