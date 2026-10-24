'use strict';

// Coordinates one material at a time. No Eagle calls, filesystem or UI access.
const path = require('path');
const { quality } = require('./preview-profile.cjs');
const { interactionValue, DEFAULT_INTERACTION } = require('./preferences.cjs');
const { createDrawingSession } = require('./drawing-session.cjs');
function issue(code, message) { const error = new Error(message); error.code = code; return error; }
function createSession(options) {
  const { eagleAdapter, media, cache, createPlayer } = options || {};
  if (!eagleAdapter || typeof eagleAdapter.captureSelected !== 'function' || !media || typeof media.prepare !== 'function' ||
    !cache || typeof cache.readAsset !== 'function' || typeof cache.release !== 'function' || typeof createPlayer !== 'function')
    throw new Error('会话缺少素材、媒体、缓存或播放器接口。');
  const now = options.now || (() => typeof performance === 'object' ? performance.now() : Date.now());
  const onChange = options.onChange || (() => {});
  let epoch = 0, libraryEpoch = 0, closed = false, tail = Promise.resolve(), controller = null, owner = null;
  let state = 'empty', source = null, duration = 0, playback = null, error = null, progress = null, loadMetrics = null;
  let memoryResume = null;
  let cleanupError = null;
  let activeExport = null, exportSequence = 0;
  let exportState = Object.freeze({ status: 'idle', message: '' }), exportFolders = Object.freeze({ status: 'idle', items: [] });
  const emptyComments = () => Object.freeze({ status: 'idle', items: Object.freeze([]), libraryPath: null, message: '', syncMessage: '', draft: null });
  let comments = emptyComments(), draftSequence = 0;
  const drawings = createDrawingSession({ store: options.annotationStore, onChange: () => notify() });
  let mergedCommentSource = null, mergedCommentItems = null, mergedComments = null;
  function observedComments() {
    const items = drawings.list(comments.items);
    if (items === comments.items) return comments;
    if (mergedCommentSource !== comments || mergedCommentItems !== items) {
      mergedCommentSource = comments; mergedCommentItems = items; mergedComments = Object.freeze({ ...comments, items });
    }
    return mergedComments;
  }
  const writes = new Map(), annotationReceipts = [];
  // A Window timer cannot be called with this plain clock object as receiver.
  // Keep ordinary global calls; injected test clocks retain their own methods.
  const commentClock = options.commentTimers || {
    setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle)
  };
  let commentsVisible = false, commentTimer = null, commentRead = null, queuedCommentLoad = null, commentWriteRevision = 0, commentFailures = 0;
  function commentChange(value) { comments = Object.freeze({ ...comments, ...value }); notify(); }
  function snapshot() {
    // Background image tasks finish without a UI state notification. Observe
    // the current ready owner directly so diagnostics do not hold an old task
    // count/RAM ledger forever. Never borrow a superseded material's player.
    const observed = !closed && owner && owner.ready && owner.epoch === epoch && owner.player
      ? owner.player.snapshot() : playback;
    return Object.freeze({ state, epoch, libraryEpoch, source, duration,
      sourceIdentity: source ? Object.freeze({ libraryEpoch, itemId: source.id, filePath: source.filePath, sha256: source.sha256 || null }) : null,
      playback: observed ? { ...observed, frame: observed.frameId, time: observed.time } : null,
      error: error ? { ...error } : null, progress: progress ? { ...progress } : null,
      loadMetrics: loadMetrics ? { ...loadMetrics } : null,
      comments: observedComments(), drawings: drawings.snapshot(), exportState, exportFolders,
      preview: owner && owner.ready && owner.epoch === epoch && owner.info.preview ? owner.info.preview : null,
      previewQuality: options.memoryPreferences && typeof options.memoryPreferences.quality === 'function' ? options.memoryPreferences.quality() : '720p',
      forwardPredecode: !!(options.memoryPreferences && typeof options.memoryPreferences.forwardPredecode === 'function' && options.memoryPreferences.forwardPredecode()),
      interactionSettings: options.memoryPreferences && typeof options.memoryPreferences.interaction === 'function' ? options.memoryPreferences.interaction() : DEFAULT_INTERACTION,
      memorySettings: options.memoryPreferences ? options.memoryPreferences.snapshot() : null });
  }
  function memorySnapshot() {
    if (closed || !owner || owner.epoch !== epoch || !owner.player) return null;
    const budget = owner.player.snapshot().budget;
    return budget ? { used: budget.used, limit: budget.limit } : null;
  }
  function cacheCoverageSnapshot() {
    if (closed || !owner || !owner.ready || owner.epoch !== epoch || !['paused', 'playing', 'seeking'].includes(state) ||
        typeof owner.player.cacheCoverageSnapshot !== 'function') return null;
    const value = owner.player.cacheCoverageSnapshot();
    return value ? Object.freeze({ ...value, sessionEpoch: epoch }) : null;
  }
  function notify() { try { onChange(snapshot()); } catch (_) { /* UI observation does not own session state. */ } }
  function current(request) { return !closed && request.epoch === epoch && !request.controller.signal.aborted; }
  function describe(failure, fallback) { return { code: failure && failure.code || fallback,
    message: String(failure && failure.message || failure || '未知错误').slice(0, 1024) }; }
  function startDispose(owned) {
    if (!owned || !owned.player || owned.dispose) return;
    // Player.dispose invalidates its own draw/audio tokens synchronously, then
    // waits for real decoders. A cache handle stays leased throughout that wait.
    try { owned.dispose = Promise.resolve(owned.player.dispose()); }
    catch (failure) { owned.dispose = Promise.reject(failure); }
    owned.dispose.catch(() => {});
  }
  async function releaseOwner(owned = owner) {
    if (!owned) return;
    startDispose(owned);
    if (owned.dispose) await owned.dispose;
    if (owned.info && !owned.released) { await cache.release(owned.info); owned.released = true; }
    if (owner === owned) owner = null;
  }
  function invalidate() {
    const token = ++epoch, previous = controller; controller = null;
    queuedCommentLoad = null; stopCommentTimer();
    if (commentRead && commentRead.watch !== null) { commentClock.clearTimeout(commentRead.watch); commentRead.watch = null; }
    if (activeExport) activeExport.controller.abort();
    if (previous) previous.abort(); startDispose(owner);
    return token;
  }
  function enqueue(work) { const next = tail.catch(() => {}).then(work); tail = next.catch(() => {}); return next; }
  function waitCaptured(captured, signal) {
    if (signal.aborted) return Promise.resolve({ aborted: true });
    return new Promise(resolve => {
      const aborted = () => { signal.removeEventListener('abort', aborted); resolve({ aborted: true }); };
      signal.addEventListener('abort', aborted, { once: true });
      captured.then(result => { signal.removeEventListener('abort', aborted); resolve(result); });
    });
  }
  function validatePrepared(info, selected) {
    const value = info && info.source;
    if (!value || (value.itemId || value.id) !== selected.id || typeof (value.filePath || value.file) !== 'string' ||
      path.resolve(value.filePath || value.file) !== selected.filePath || !/^[0-9a-f]{64}$/.test(value.sha256 || ''))
      throw issue('PREPARED_IDENTITY_MISMATCH', '准备结果与本次选中的素材身份不一致，已停止显示。');
    if (!Array.isArray(info.frames) || !info.frames.length || !Number.isFinite(info.duration) || info.duration <= 0)
      throw issue('PREPARED_MEDIA_INVALID', '视频准备结果缺少可靠的帧或时长。');
  }
  async function runLoad(request) {
    let owned = null;
    try {
      if (cleanupError) throw issue(cleanupError.code, cleanupError.message);
      if (!current(request)) return { status: 'superseded' };
      await releaseOwner(); if (!current(request)) return { status: 'superseded' };
      const captured = await waitCaptured(request.captured, request.controller.signal);
      if (!current(request) || captured.aborted) return { status: 'superseded' };
      if (captured.error) throw captured.error;
      const selected = captured.value;
      source = Object.freeze({ ...selected }); progress = { stage: 'media-prepare', message: '正在准备视频预览' }; notify();
      if (!current(request)) return { status: 'superseded' };
      loadComments(request, selected); // Independent read; never add API work to the frame loop.
      owned = { epoch: request.epoch, info: null, player: null, dispose: null, released: false, ready: false }; owner = owned;
      const mediaStartedAt = now();
      const info = await media.prepare(selected, { signal: request.controller.signal, previewQuality: request.previewQuality, onProgress: value => {
        if (current(request) && owner === owned) { progress = typeof value === 'object' && value ? { ...value } : { stage: 'media-prepare', message: String(value) }; notify(); }
      } });
      const mediaReturnedAt = now(); owned.info = info;
      if (!current(request)) { await releaseOwner(owned); return { status: 'superseded' }; }
      validatePrepared(info, selected);
      if (request.previewQuality !== undefined && (!info.preview || info.preview.quality !== request.previewQuality))
        throw issue('PREVIEW_QUALITY_MISMATCH', '准备结果的画质与本次选择不一致。');
      source = Object.freeze({ ...selected, sha256: info.source.sha256 }); duration = info.duration;
      drawings.open({ libraryPath: request.drawingLibrary || comments.libraryPath, itemId: source.id, sourceSha256: source.sha256, frames: info.frames, duration: info.duration });
      progress = { stage: 'player-initialize', message: '正在初始化画面与声音' }; notify();
      if (!current(request)) { await releaseOwner(owned); return { status: 'superseded' }; }
      const player = createPlayer({ experimentMode: 'compressed-ram',
        readAsset: (_copiedInfo, file) => cache.readAsset(info, file),
        setMediaTarget: time => { if (cache.target) cache.target(info, time); },
        cancelMediaReads: () => { if (cache.cancelReads) cache.cancelReads(info); },
        createSegmentAudio: info.streaming && info.audio ? settings => require('./segment-audio.cjs').createSegmentAudio({ ...settings,
          read: ordinal => cache.readAudioSegment(info, ordinal) }) : undefined,
        readFrameBatch: typeof cache.readFrameBatch === 'function' ? (_copiedInfo, files) => cache.readFrameBatch(info, files) : undefined,
        onChange: value => {
          if (!current(request) || owner !== owned) return;
          playback = { ...value };
          if (owned.ready) {
            state = value.state;
            if (state === 'error') error = { code: value.lastErrorCode || 'PLAYBACK_FAILED', message: value.lastIssue || '视频播放或定位失败，请重试。' };
            else error = null;
          }
          notify();
        } });
      if (!player || ['load', 'snapshot', 'dispose', 'play', 'pause', 'seek', 'step'].some(name => typeof player[name] !== 'function'))
        throw issue('PLAYER_INTERFACE_INVALID', '播放器接口不完整。');
      owned.player = player;
      if (!current(request)) { await releaseOwner(owned); return { status: 'superseded' }; }
      const playerStartedAt = now(); await player.load(info); const playerLoadedAt = now();
      if (!current(request)) { await releaseOwner(owned); return { status: 'superseded' }; }
      let ready = player.snapshot();
      if (ready.state !== 'paused' || ready.frameId !== info.frames[0].id || ready.frameOrdinal !== 0)
        throw issue('FIRST_FRAME_NOT_READY', '首帧尚未准确显示并暂停，未开放播放操作。');
      if (Number.isFinite(request.restoreTime)) {
        const restoreIndex = request.restoreFrameId === undefined ? undefined : info.frames.findIndex(frame => frame.id === request.restoreFrameId);
        if (restoreIndex === -1 || restoreIndex !== undefined && info.frames[restoreIndex].time !== request.restoreTime)
          throw issue('SETTINGS_FRAME_MISMATCH', '应用设置前后的源帧时间不一致。');
        const located = await player.seek(request.restoreTime, { kind: request.trigger, index: restoreIndex, final: true, inputAt: now() });
        if (!current(request)) { await releaseOwner(owned); return { status: 'superseded' }; }
        ready = player.snapshot();
        if (!located || !['drawn', 'reused'].includes(located.status) || ready.state !== 'paused' || ready.frameId !== located.frameId ||
            request.restoreFrameId !== undefined && ready.frameId !== request.restoreFrameId)
          throw issue('MEMORY_POSITION_NOT_READY', '应用设置后未能准确恢复当前源帧。');
      }
      if (request.transportState && request.transportState.sourceSha256 === info.source.sha256) {
        if (typeof player.restoreTransport !== 'function') throw issue('TRANSPORT_RESTORE_UNAVAILABLE', '播放器不能恢复片段范围和速度。');
        await player.restoreTransport(request.transportState.value);
        if (!current(request)) { await releaseOwner(owned); return { status: 'superseded' }; }
        ready = player.snapshot();
      }
      owned.ready = true; playback = { ...ready }; state = 'paused'; progress = null; error = null;
      if (request.restoredWrite) restoreWrite(request.restoredWrite);
      // UI enables ready controls synchronously inside this notification. Count
      // that initialization in P03, then expose metrics without redrawing UI.
      notify(); if (!current(request)) return { status: 'superseded' };
      const readyAt = now(); loadMetrics = { entryAt: request.startedAt, readyAt, totalMs: readyAt - request.startedAt,
        reused: !!(info.metrics && info.metrics.reused), trigger: request.trigger,
        mediaPrepareMs: mediaReturnedAt - mediaStartedAt, playerLoadMs: playerLoadedAt - playerStartedAt,
        mediaPhaseMs: info.metrics && info.metrics.phaseMs ? { ...info.metrics.phaseMs } : null };
      scheduleCommentSync();
      return { status: 'ready', snapshot: snapshot() };
    } catch (failure) {
      try { await releaseOwner(owned || owner); }
      catch (cleanupFailure) { failure = issue('SESSION_RELEASE_FAILED', '旧视频资源未能确认释放，停止准备新素材：' + cleanupFailure.message); }
      if (['MEDIA_CLEANUP_FAILED', 'SESSION_RELEASE_FAILED'].includes(failure && failure.code)) {
        cleanupError = describe(failure, 'SESSION_RELEASE_FAILED');
        if (!current(request)) { error = cleanupError; notify(); return { status: 'error', error: { ...cleanupError } }; }
      }
      if (!current(request)) return { status: 'superseded' };
      state = 'error'; error = describe(failure, 'PREPARATION_FAILED'); progress = null; playback = null; notify();
      return { status: 'error', error: { ...error } };
    }
  }
  function startLoad(settings = {}, retainedSource = null) {
    if (closed) return Promise.resolve({ status: 'ignored', reason: 'closed' });
    if (drawings.snapshot().draft) return Promise.resolve({ status: 'drawing-blocked', message: '请先保存或取消圈画。' });
    drawings.deactivate();
    if (!['memory-settings', 'playback-settings'].includes(settings.trigger)) memoryResume = null;
    const startedAt = Number.isFinite(settings.startedAt) ? settings.startedAt : now();
    const request = { epoch: invalidate(), controller: new AbortController(), captured: null, startedAt, trigger: settings.trigger || 'selected-load',
      restoreTime: settings.restoreTime, restoreFrameId: settings.restoreFrameId, transportState: settings.transportState,
      previewQuality: options.memoryPreferences && typeof options.memoryPreferences.quality === 'function' ? options.memoryPreferences.quality() : undefined };
    if (!current(request)) return Promise.resolve({ status: 'superseded' });
    controller = request.controller;
    try { request.drawingLibrary = typeof eagleAdapter.drawingLibrary === 'function' ? eagleAdapter.drawingLibrary() : comments.libraryPath; } catch (_) { /* Drawing load reports its own missing context. */ }
    // Start the single official API call now, before the disposal/preparation queue.
    let response; try { response = retainedSource || eagleAdapter.captureSelected(); } catch (failure) { response = Promise.reject(failure); }
    request.captured = Promise.resolve(response).then(value => ({ value }), failure => ({ error: failure }));
    if (!current(request)) return Promise.resolve({ status: 'superseded' });
    state = 'preparing'; source = null; duration = 0; playback = null; error = null; loadMetrics = null;
    comments = emptyComments();
    progress = { stage: 'selection', message: '正在读取 Eagle 选中的视频' }; notify();
    return enqueue(() => runLoad(request));
  }
  function loadSelected(settings = {}, capturedSource = null) { return startLoad(settings, capturedSource); }
  async function clearOtherCaches() {
    if (activeExport) throw issue('EXPORT_BUSY', '请等待导出结束或取消。');
    if (closed || state === 'preparing' || comments.draft || drawings.snapshot().draft || !source || !owner || !owner.ready)
      throw issue('CACHE_CLEAN_BUSY', '请等待视频就绪，并先保存或取消标注。');
    if (typeof cache.clearOther !== 'function') throw issue('CACHE_CLEAN_UNAVAILABLE', '当前入口没有缓存清理接口。');
    const token = epoch, retained = source;
    await control('pause', [], ['paused', 'playing', 'seeking']);
    if (closed || token !== epoch) return { status: 'superseded' };
    const result = await cache.clearOther({ sourceSha256: retained.sha256 });
    return closed || token !== epoch ? { status: 'superseded' } : { status: 'cleared', ...result };
  }
  async function setPlaybackSettings({ ramMiB, previewQuality, forwardPredecode, wheelFrames, showCacheStrip, rateStep, drawingFadeSeconds } = {}, trigger = 'playback-settings') {
    if (activeExport) throw issue('EXPORT_BUSY', '请等待导出结束或取消。');
    const preferences = options.memoryPreferences;
    if (!preferences) throw issue('MEMORY_SETTINGS_UNAVAILABLE', '当前入口没有内存设置接口。');
    if (previewQuality !== undefined) quality(previewQuality);
    if (forwardPredecode !== undefined && typeof forwardPredecode !== 'boolean') throw issue('SETTINGS_INVALID', '提前解压设置必须为开或关。');
    const previousInteraction = typeof preferences.interaction === 'function' ? preferences.interaction() : DEFAULT_INTERACTION;
    const interaction = interactionValue(wheelFrames === undefined ? previousInteraction.wheelFrames : wheelFrames,
      showCacheStrip === undefined ? previousInteraction.showCacheStrip : showCacheStrip,
      rateStep === undefined ? previousInteraction.rateStep : rateStep,
      drawingFadeSeconds === undefined ? previousInteraction.drawingFadeSeconds : drawingFadeSeconds, previousInteraction.drawingToolbar);
    preferences.preview(ramMiB);
    if (closed || state === 'preparing' || comments.draft || drawings.snapshot().draft) throw issue('MEMORY_SETTINGS_BUSY', '请等待准备完成，并先保存或取消标注。');
    const token = epoch, retained = source;
    const onlyControls = (forwardPredecode !== undefined || wheelFrames !== undefined || showCacheStrip !== undefined || rateStep !== undefined || drawingFadeSeconds !== undefined) && preferences.snapshot().ramMiB === ramMiB &&
      (previewQuality === undefined || typeof preferences.quality === 'function' && previewQuality === preferences.quality());
    const predecodeChanged = forwardPredecode !== undefined && (typeof preferences.forwardPredecode !== 'function' || forwardPredecode !== preferences.forwardPredecode());
    if (onlyControls && predecodeChanged && owner && owner.ready && typeof owner.player.setForwardPredecode !== 'function')
      throw issue('SETTINGS_UNAVAILABLE', '当前播放器没有提前解压设置接口。');
    if (owner && owner.ready) await control('pause', [], ['paused', 'playing', 'seeking']);
    if (closed || token !== epoch) return { status: 'superseded' };
    const retainedTime = memoryResume && retained && memoryResume.id === retained.id && memoryResume.filePath === retained.filePath ? memoryResume.time : 0;
    const actual = owner && owner.player ? owner.player.snapshot() : null;
    const time = actual ? actual.time : retainedTime;
    const frameId = actual ? actual.frameId : memoryResume ? memoryResume.frameId : undefined;
    const transportState = actual && actual.transport && retained ? { sourceSha256: retained.sha256, value: actual.transport } : memoryResume && memoryResume.transportState;
    preferences.save(ramMiB, previewQuality, forwardPredecode, interaction);
    if (onlyControls && owner && owner.ready) {
      if (predecodeChanged) owner.player.setForwardPredecode(forwardPredecode);
      notify(); return { status: 'applied' };
    }
    memoryResume = retained ? { id: retained.id, filePath: retained.filePath, time, frameId, transportState } : null;
    notify();
    if (closed || token !== epoch) return { status: 'superseded' };
    return retained ? startLoad({ trigger, restoreTime: time, restoreFrameId: frameId, transportState }, retained) : { status: 'applied' };
  }
  function setMemoryMiB(ramMiB) { return setPlaybackSettings({ ramMiB }, 'memory-settings'); }
  function setDrawingToolbar(visible) {
    if (closed) return { status: 'ignored' };
    if (typeof visible !== 'boolean') throw issue('SETTINGS_INVALID', '圈画工具条显示设置必须为开或关。');
    const preferences = options.memoryPreferences;
    if (!preferences || typeof preferences.interaction !== 'function') throw issue('SETTINGS_UNAVAILABLE', '当前入口没有工具条设置接口。');
    const previous = preferences.interaction();
    const interaction = interactionValue(previous.wheelFrames, previous.showCacheStrip, previous.rateStep, previous.drawingFadeSeconds, visible);
    preferences.save(preferences.snapshot().ramMiB, preferences.quality(), preferences.forwardPredecode(), interaction);
    notify(); return { status: 'saved' };
  }
  function control(method, args, allowed) {
    if (drawings.snapshot().draft) return Promise.reject(issue('DRAWING_FRAME_FIXED', '圈画已固定当前帧，请先保存或取消。'));
    if (activeExport) return Promise.reject(issue('EXPORT_BUSY', '正在导出固定画面或片段，请等待完成或取消。'));
    const owned = owner, token = epoch;
    if (comments.draft) return Promise.reject(issue('COMMENT_FRAME_FIXED', '标注时间已固定，请先保存或取消标注。'));
    if (closed || !owned || !owned.ready || owned.epoch !== token || !allowed.includes(state))
      return Promise.reject(issue('SESSION_NOT_READY', '视频尚未就绪或正在定位，请等待当前操作完成。'));
    let result; try { result = owned.player[method](...args); } catch (failure) { result = Promise.reject(failure); }
    return Promise.resolve(result).then(value => token === epoch && !closed ? value : { status: 'superseded' }, failure => {
      if (token !== epoch || closed) return { status: 'superseded' };
      state = 'error'; error = describe(failure, 'PLAYBACK_FAILED'); notify(); throw failure;
    });
  }
  function clear(kind) {
    if (drawings.snapshot().draft) return Promise.resolve({ status: 'drawing-blocked', message: '请先保存或取消圈画。' });
    if (closed) return tail.then(() => error ? { status: 'error', error: { ...error } } : { status: 'closed' });
    if (kind === 'closed') { closed = true; commentsVisible = false; } else libraryEpoch++;
    memoryResume = null;
    const token = invalidate();
    if (kind === 'closed' || token === epoch) {
      state = kind === 'closed' ? 'closed' : 'empty'; source = null; duration = 0; playback = null; error = null; loadMetrics = null;
      comments = emptyComments();
      drawings.deactivate();
      if (kind !== 'closed') exportFolders = Object.freeze({ status: 'idle', items: [] });
      progress = kind === 'closed' ? null : { stage: 'library-changed', message: '素材库已变化，请重新调用插件。' }; notify();
    }
    return enqueue(async () => {
      if (!closed && token !== epoch) return { status: 'superseded' };
      try {
        if (cleanupError) throw issue(cleanupError.code, cleanupError.message);
        await releaseOwner();
        // Dispatched writes cannot be cancelled with the player. They finish
        // read-back against their own identity, without updating another item.
        if (kind === 'closed') await Promise.all([...writes.values()].map(value => value.promise).filter(Boolean).concat(activeExport && activeExport.promise || []));
        return { status: kind === 'closed' ? 'closed' : 'empty' };
      }
      catch (failure) {
        if (!closed && token !== epoch) return { status: 'superseded' };
        if (kind !== 'closed') state = 'error'; error = describe(failure, 'SESSION_RELEASE_FAILED'); notify(); return { status: 'error', error: { ...error } };
      }
    });
  }
  function writeKey(value) { return value.libraryPath + '\0' + value.source.id + '\0' + value.source.filePath; }
  function stopCommentTimer() {
    if (commentTimer !== null) { commentClock.clearTimeout(commentTimer); commentTimer = null; }
  }
  function sameComments(a, b) {
    return a.length === b.length && a.every((item, index) => ['id', 'time', 'text', 'revision'].every(key => item[key] === b[index][key]));
  }
  function syncableComments() {
    return !closed && commentsVisible && source && owner && owner.ready && owner.epoch === epoch &&
      ['paused', 'playing', 'seeking'].includes(state) && !activeExport && !writes.has(writeKey({ source, libraryPath: comments.libraryPath || '' }));
  }
  function scheduleCommentSync(delay = Math.min(30000, 1000 * 2 ** Math.min(commentFailures, 5))) {
    if (commentTimer !== null || commentRead || !syncableComments()) return;
    commentTimer = commentClock.setTimeout(() => { commentTimer = null; refreshComments(); }, delay);
    if (commentTimer && typeof commentTimer.unref === 'function') commentTimer.unref();
  }
  function setCommentsVisible(visible) {
    commentsVisible = !!visible; stopCommentTimer();
    if (commentsVisible) scheduleCommentSync(0);
  }
  function commentReadCurrent(record) {
    return !closed && record.epoch === epoch && record.libraryEpoch === libraryEpoch && source &&
      record.source.id === source.id && record.source.filePath === source.filePath;
  }
  function startCommentRead(selected, request = null) {
    const record = { source: selected, request, epoch, libraryEpoch, writeRevision: commentWriteRevision, watch: null, promise: null };
    commentRead = record; stopCommentTimer();
    record.watch = commentClock.setTimeout(() => {
      record.watch = null;
      if (!commentReadCurrent(record) || record.writeRevision !== commentWriteRevision || !request && !commentsVisible) return;
      commentChange({ ...(comments.status === 'loading' ? { status: 'error', message: '' } : {}),
        syncMessage: 'Eagle标注读取暂未返回，已保留现有内容；等待本次读取结束，不重复派发。' });
    }, 15000);
    if (record.watch && typeof record.watch.unref === 'function') record.watch.unref();
    record.promise = Promise.resolve().then(() => {
      if (!commentReadCurrent(record)) return null;
      if (typeof eagleAdapter.readComments !== 'function') throw issue('COMMENTS_API_UNAVAILABLE', '当前环境没有标注读取接口。');
      // Keep the single read occupied until the actual SDK promise settles.
      // A timeout or hiding the window cannot cancel Eagle's already-issued IPC.
      return eagleAdapter.readComments(selected, { libraryPath: comments.libraryPath, waitForCompletion: true });
    }).then(data => {
      if (!data || !commentReadCurrent(record) || record.writeRevision !== commentWriteRevision || !request && !commentsVisible)
        return { status: 'superseded' };
      commentFailures = 0;
      const old = request ? writes.get(writeKey({ libraryPath: data.libraryPath, source: selected })) : null;
      if (request) request.restoredWrite = old || null;
      const items = sameComments(comments.items, data.items) ? comments.items : data.items;
      let draft = old ? old.draft : comments.draft;
      if (draft && draft.original && ['pausing', 'editing', 'failed'].includes(draft.status)) {
        const target = data.items.find(item => item.id === draft.original.id);
        if (!target || !sameComments([draft.original], [target])) draft = Object.freeze({ ...draft, status: 'obsolete',
          message: '这条标注已在Eagle中修改或删除。你的文字已保留，请复制后取消，再重新选择。' });
      }
      if (items !== comments.items || draft !== comments.draft || comments.status !== 'ready' || comments.syncMessage || comments.libraryPath !== data.libraryPath)
        commentChange({ status: 'ready', items, draft, libraryPath: data.libraryPath, syncMessage: '',
          message: items !== comments.items && !request ? '标注已从Eagle更新。' : request ? '' : comments.message });
      return { status: 'refreshed' };
    }, failure => {
      if (commentReadCurrent(record) && record.writeRevision === commentWriteRevision && (request || commentsVisible)) {
        commentFailures++;
        commentChange({ ...(comments.status === 'loading' ? { status: 'error', message: '' } : {}),
          syncMessage: '标注同步失败：' + failure.message + '；现有内容已保留，将稍后重试。' });
      }
      return { status: 'failed' };
    }).finally(() => {
      if (record.watch !== null) commentClock.clearTimeout(record.watch);
      if (commentRead === record) commentRead = null;
      const next = queuedCommentLoad; queuedCommentLoad = null;
      if (next && current(next.request)) startCommentRead(next.selected, next.request);
      else scheduleCommentSync();
    });
    record.promise.catch(() => {}); return record.promise;
  }
  function refreshComments() {
    stopCommentTimer();
    if (!syncableComments()) { scheduleCommentSync(); return Promise.resolve({ status: 'ignored' }); }
    if (commentRead) return commentRead.promise;
    return startCommentRead(source);
  }
  function loadComments(request, selected) {
    commentChange({ status: 'loading', message: '正在读取标注' });
    if (!current(request)) return;
    if (commentRead) {
      queuedCommentLoad = { request, selected };
      commentChange({ message: '正在等待上次Eagle标注读取结束，视频可继续使用。' }); return;
    }
    startCommentRead(selected, request);
  }
  function liveDraft(id, token) { return !closed && token === epoch && comments.draft && comments.draft.id === id; }
  function restoreWrite(record) {
    const result = record.result;
    if (result && result.status === 'saved') comments = Object.freeze({ ...comments, items: result.items, draft: null, message: result.message });
    else comments = Object.freeze({ ...comments, draft: result && result.status === 'failed'
      ? Object.freeze({ ...record.draft, status: 'obsolete', message: '原提案未发送，视频已切换。文字已保留，请复制后取消，再固定新画面。' }) : record.draft });
  }

  const drawingModel = require('./drawing-model.js');
  function frameBounds(owned, ordinal) {
    return { start: owned.info.frames[ordinal].time, end: owned.info.frames[ordinal + 1]?.time ?? owned.info.duration, final: ordinal === owned.info.frames.length - 1 };
  }
  async function freshNative(owned, token) {
    if (typeof eagleAdapter.readComments !== 'function') throw issue('COMMENTS_API_UNAVAILABLE', '无法核对Eagle文字标注，未发送新标注。');
    commentWriteRevision++;
    const data = await eagleAdapter.readComments(source, { libraryPath: comments.libraryPath });
    if (closed || token !== epoch || owner !== owned) throw issue('COMMENT_SUPERSEDED', '素材已经切换，未继续保存。');
    commentChange({ items: data.items, libraryPath: data.libraryPath, status: 'ready' }); return data.items;
  }

  async function beginComment(preferredId = null) {
    if (activeExport || drawings.snapshot().draft) return { status: 'ignored' };
    const owned = owner, token = epoch;
    if (closed || !owned?.ready || comments.status !== 'ready' || comments.draft || !['paused', 'playing'].includes(state)) return { status: 'ignored' };
    let draft = Object.freeze({ id: ++draftSequence, status: 'pausing', source, libraryPath: comments.libraryPath,
      libraryEpoch, frameId: null, time: null, text: '', message: '正在固定画面…', attempt: null });
    commentChange({ draft });
    try {
      await owned.player.pause();
      if (!liveDraft(draft.id, token)) return { status: 'superseded' };
      const actual = owned.player.snapshot(), frame = owned.info.frames[actual.frameOrdinal];
      if (actual.state !== 'paused' || actual.pendingTargets > 0 || !frame || frame.id !== actual.frameId || frame.time !== actual.time)
        throw issue('COMMENT_FRAME_NOT_READY', '画面尚未定位完成，请完成定位后再添加标注。');
      const items = await freshNative(owned, token);
      if (!liveDraft(draft.id, token)) return { status: 'superseded' };
      const choices = drawingModel.nativeAtFrame(items, owned.info.frames, actual.frameOrdinal, owned.info.duration);
      const selected = choices.find(n => n.id === preferredId) || (choices.length === 1 ? choices[0] : null);
      if (selected) {
        draft = Object.freeze({ ...draft, kind: 'edit', frameId: actual.frameId, time: selected.time, text: selected.text,
          original: Object.freeze({ ...selected }), status: 'editing', message: '修改当前帧已有文字，保留原时间。' });
      } else if (choices.length > 1) draft = Object.freeze({ ...draft, kind: 'choose', frameId: actual.frameId, time: actual.time,
        choices, status: 'choosing', message: '这一帧已有多条文字，请选择要修改的一条。' });
      else draft = Object.freeze({ ...draft, frameId: actual.frameId, time: actual.time, frameBounds: frameBounds(owned, actual.frameOrdinal), status: 'editing', message: '' });
      commentChange({ draft }); return { status: draft.status, draft };
    } catch (failure) {
      if (liveDraft(draft.id, token)) commentChange({ draft: null, message: failure.message });
      return { status: 'failed', message: failure.message };
    }
  }
  function chooseComment(id) {
    const d = comments.draft;
    if (!d || d.status !== 'choosing') return { status: 'ignored' };
    const item = d.choices.find(n => n.id === id); if (!item) return { status: 'ignored' };
    commentChange({ draft: Object.freeze({ ...d, kind: 'edit', status: 'editing', time: item.time, text: item.text,
      original: Object.freeze({ ...item }), message: '修改选中的文字，其余同帧文字保持原样。' }) });
    return { status: 'editing' };
  }
  async function beginCommentMutation(id, kind) {
    if (activeExport || drawings.snapshot().draft) return { status: 'ignored' };
    const owned = owner, token = epoch, item = comments.items.find(value => value.id === id);
    if (!['edit', 'delete'].includes(kind) || closed || !owned || !owned.ready || comments.status !== 'ready' || comments.draft ||
        !item || !['paused', 'playing'].includes(state)) return { status: 'ignored' };
    const draft = Object.freeze({ id: ++draftSequence, kind, status: 'pausing', source, libraryPath: comments.libraryPath,
      libraryEpoch, frameId: null, time: item.time, text: item.text, original: Object.freeze({ ...item }), attempt: null,
      message: '正在暂停播放…' });
    commentChange({ draft });
    try {
      await owned.player.pause();
      if (!liveDraft(draft.id, token)) return { status: 'superseded' };
      if (comments.draft.status === 'obsolete') return { status: 'obsolete' };
      commentChange({ draft: Object.freeze({ ...draft, status: 'editing', message: kind === 'delete'
        ? '确认删除这条标注？仅保留仍由同帧其他文字使用的圈画。' : '修改文字，原标注时间保持不变。' }) });
      return { status: 'editing' };
    } catch (failure) {
      if (liveDraft(draft.id, token)) commentChange({ draft: null, message: failure.message });
      return { status: 'failed', message: failure.message };
    }
  }
  function setCommentText(text) {
    const draft = comments.draft;
    if (!draft || draft.kind === 'delete' || !['editing', 'failed', 'obsolete'].includes(draft.status) || typeof text !== 'string') return { status: 'ignored' };
    // A composition already in progress may finish after an external conflict.
    // Preserve those final characters for copying without enabling a stale save.
    const obsolete = draft.status === 'obsolete';
    commentChange({ draft: Object.freeze({ ...draft, text, status: obsolete ? 'obsolete' : 'editing', message: obsolete ? draft.message : '' }) });
    return { status: obsolete ? 'obsolete' : 'editing' };
  }
  function cancelComment() {
    const draft = comments.draft;
    if (!draft || ['pausing', 'editing', 'failed', 'obsolete', 'choosing'].includes(draft.status)) { commentChange({ draft: null, message: '' }); return { status: 'cancelled' }; }
    // An uncertain write must stay available for explicit read-only checking.
    return { status: 'ignored', message: '这次保存已发出，请先核对结果。' };
  }
  function saveComment() {
    const draft = comments.draft, token = epoch;
    if (!draft || !['editing', 'failed'].includes(draft.status)) return Promise.resolve({ status: 'ignored' });
    if (draft.kind !== 'delete' && !draft.text.trim()) return Promise.resolve(cancelComment());
    if (typeof eagleAdapter.saveComment !== 'function' || writes.size >= 32) {
      commentChange({ draft: Object.freeze({ ...draft, status: 'failed', message: '保存接口不可用或待核对记录已达上限，请先在Eagle核对。' }) });
      return Promise.resolve({ status: 'failed' });
    }
    const key = writeKey(draft);
    if (writes.has(key)) return Promise.resolve({ status: 'ignored' });
    const record = { draft: Object.freeze({ ...draft, status: 'saving', message: '正在保存并核对…' }), promise: null };
    commentWriteRevision++; writes.set(key, record); commentChange({ draft: record.draft });
    const active = () => liveDraft(draft.id, token) && libraryEpoch === draft.libraryEpoch;
    // Attach the promise before any adapter callback can trigger a close.
    record.promise = Promise.resolve().then(() => eagleAdapter.saveComment(draft, { isCurrent: active,
      onIssued(attempt) { record.draft = Object.freeze({ ...record.draft, attempt }); if (active()) commentChange({ draft: record.draft }); }
    })).catch(failure => ({ status: record.draft.attempt ? 'unknown' : 'failed', attempt: record.draft.attempt, message: failure.message }))
      .then(result => finishComment(record, key, result, draft.id, token));
    return record.promise;
  }
  function finishComment(record, key, result, id, token) {
    commentWriteRevision++;
    record.result = result;
    record.draft = Object.freeze({ ...record.draft, status: result.status, attempt: result.status === 'failed' ? null : result.attempt || record.draft.attempt, message: result.message });
    annotationReceipts.push(Object.freeze({ source: record.draft.source, libraryPath: record.draft.libraryPath,
      frameId: record.draft.frameId, time: record.draft.time, text: record.draft.text, kind: record.draft.kind || 'add', status: result.status,
      commentId: result.commentId || null, message: result.message }));
    if (annotationReceipts.length > 32) annotationReceipts.shift();
    if (result.status !== 'unknown') writes.delete(key);
    // Restored attempts may belong to an earlier epoch. Match the proposal ID
    // and library path as well as the source, never just a reused content hash.
    const sameDraft = !closed && comments.draft && comments.draft.id === id && comments.libraryPath === record.draft.libraryPath &&
      source && source.id === record.draft.source.id && source.filePath === record.draft.source.filePath && source.sha256 === record.draft.source.sha256;
    if (sameDraft && result.status === 'saved' && record.draft.kind === 'delete') {
      const cleanup = drawings.nativeDeleted(record.draft.original.id, result.items, record.draft.original);
      if (cleanup.status === 'failed') result = { ...result, message: '原生文字已删除，但圈画仍保留：' + cleanup.message };
    }
    if (liveDraft(id, token) || sameDraft) {
      if (result.status === 'saved') commentChange({ items: result.items, draft: null, message: result.message });
      else if (token !== epoch && result.status === 'failed') { restoreWrite(record); notify(); }
      else commentChange({ ...(result.items ? { items: result.items } : {}), draft: record.draft });
    }
    scheduleCommentSync(); return result;
  }
  function checkComment() {
    const draft = comments.draft, token = epoch;
    if (!draft || draft.status !== 'unknown' || !draft.attempt || typeof eagleAdapter.verifyComment !== 'function') return Promise.resolve({ status: 'ignored' });
    const key = writeKey(draft), record = writes.get(key);
    if (!record) return Promise.resolve({ status: 'ignored' });
    record.draft = Object.freeze({ ...draft, status: 'checking', message: '正在核对原操作结果，不会再次写入…' });
    commentWriteRevision++;
    commentChange({ draft: record.draft });
    record.promise = Promise.resolve().then(() => eagleAdapter.verifyComment(draft.attempt))
      .catch(failure => ({ status: 'unknown', attempt: draft.attempt, message: failure.message }))
      .then(result => finishComment(record, key, result, draft.id, token));
    return record.promise;
  }
  function exportChange(value) { exportState = Object.freeze(value); notify(); }
  async function loadExportFolders() {
    if (closed || activeExport || typeof eagleAdapter.exportFolders !== 'function') return { status: 'ignored' };
    const token = libraryEpoch;
    exportFolders = Object.freeze({ status: 'loading', items: [] }); notify();
    try {
      const result = await eagleAdapter.exportFolders();
      if (closed || token !== libraryEpoch) return { status: 'superseded' };
      exportFolders = Object.freeze({ status: 'ready', ...result }); notify(); return result;
    } catch (error) {
      if (!closed && token === libraryEpoch) { exportFolders = Object.freeze({ status: 'failed', items: [], message: error.message }); notify(); }
      return { status: 'failed', message: error.message };
    }
  }
  function waitExport(work, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(issue('EXPORT_CANCELLED', '导出已取消。'));
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  function beginExport(kind, settings = {}) {
    const owned = owner, token = epoch;
    if (closed || activeExport || exportState.status === 'unknown' || comments.draft || drawings.snapshot().draft || !owned || !owned.ready ||
        !['paused', 'playing'].includes(state) || !options.exports || typeof eagleAdapter.exportDestination !== 'function')
      return Promise.resolve({ status: 'ignored' });
    const job = { controller: new AbortController(), promise: null, issued: false, id: ++exportSequence };
    activeExport = job;
    const valid = () => !closed && epoch === token && owner === owned && !job.controller.signal.aborted;
    exportChange({ status: 'busy', message: '正在固定导出画面和范围…' });
    job.promise = (async () => {
      let generated = null, retain = false;
      try {
        await owned.player.pause();
        if (!valid()) throw issue('EXPORT_CANCELLED', '导出已取消。');
        const actual = owned.player.snapshot(), frame = owned.info.frames[actual.frameOrdinal];
        if (actual.state !== 'paused' || actual.pendingTargets > 0 || !frame || frame.id !== actual.frameId || frame.time !== actual.time)
          throw issue('EXPORT_FRAME', '画面尚未准确定位，请完成定位后再导出。');
        const transport = typeof owned.player.transportSnapshot === 'function' ? owned.player.transportSnapshot() : actual.transport;
        const loop = transport && transport.loop;
        if (kind === 'clip' && (!loop || !loop.valid)) throw issue('EXPORT_RANGE', '请先用现有头尾端点选定片段。');
        if (!['frame', 'clip'].includes(kind)) throw issue('EXPORT_KIND', '导出类型无效。');
        const request = kind === 'frame' ? { kind, frameOrdinal: actual.frameOrdinal }
          : { kind, firstOrdinal: loop.startOrdinal, lastOrdinal: loop.endOrdinal };
        const label = source.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
        const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
        const name = label + (kind === 'frame' ? '_帧' + (actual.frameOrdinal + 1) : '_片段') + '_' + stamp;
        const proposal = { ...settings, kind, name, libraryPath: comments.libraryPath || exportFolders.libraryPath };
        const destination = await waitExport(eagleAdapter.exportDestination(proposal), job.controller.signal);
        if (!valid() || destination.kind === 'cancelled') return { status: 'cancelled', message: '已取消保存。' };
        generated = await options.exports.create(owned.info, request, { signal: job.controller.signal,
          onProgress: value => { if (valid()) exportChange({ status: 'busy', message: value.message || '正在导出…' }); } });
        if (!valid()) throw issue('EXPORT_CANCELLED', '导出已取消。');
        let result;
        if (destination.kind === 'local') {
          result = await options.exports.publish(generated.token, destination, { signal: job.controller.signal });
          generated = null;
          return { ...result, message: result.message || '已保存到本地，未覆盖任何已有文件。' };
        }
        exportChange({ status: 'busy', message: '正在保存到Eagle并核对结果…' });
        result = await eagleAdapter.importExport({ ...generated, ...destination, name }, { isCurrent: valid,
          onIssued() { job.issued = true; if (valid()) exportChange({ status: 'busy', cancellable: false, message: '保存已发往Eagle，正在核对结果…' }); } });
        retain = result.status === 'unknown';
        return { ...result, generated: retain ? generated : null };
      } catch (error) {
        retain = job.issued;
        return { status: retain ? 'unknown' : job.controller.signal.aborted ? 'cancelled' : 'failed', generated: retain ? generated : null,
          message: error.code === 'ENOSPC' ? '保存位置空间不足，导出未完成。' : ['EACCES', 'EPERM'].includes(error.code)
            ? '保存位置无法写入或文件正在使用，请选择其他位置。' : error.message };
      } finally {
        if (generated && !retain) {
          try { await options.exports.discard(generated.token); }
          catch (error) { job.cleanupWarning = '临时文件清理未完成：' + error.message; }
        }
      }
    })().then(result => {
      if (job.cleanupWarning) result = { ...result, message: (result.message || '操作已结束') + '；' + job.cleanupWarning };
      if (activeExport === job) activeExport = null;
      if (closed) exportState = Object.freeze(result);
      else if (token === epoch || result.status === 'unknown') exportChange(result);
      else exportChange({ status: 'idle', message: result.status === 'saved' ? '上个视频的导出已保存。' : '上个视频的导出已结束。' });
      scheduleCommentSync();
      return result;
    });
    return job.promise;
  }
  async function checkExport() {
    const previous = exportState;
    if (closed || activeExport || previous.status !== 'unknown' || !previous.attempt || typeof eagleAdapter.verifyExport !== 'function')
      return { status: 'ignored' };
    let result = await eagleAdapter.verifyExport(previous.attempt);
    if (result.status === 'saved' && previous.generated) {
      try { await options.exports.discard(previous.generated.token); }
      catch (error) { result = { ...result, message: (result.message || '已保存') + '；临时文件清理未完成：' + error.message }; }
    }
    if (!closed) exportChange({ ...result, generated: result.status === 'unknown' ? previous.generated : null });
    return result;
  }
  async function beginDrawing(id = null, kind = 'edit') {
    const owned = owner, token = epoch;
    if (closed || comments.draft || activeExport || exportState.status === 'unknown' || !owned || !owned.ready || !['paused', 'playing'].includes(state)) return { status: 'ignored' };
    let target;
    try { target = drawings.resolve(id, comments.items); } catch (failure) { drawings.fail(failure); return { status: 'failed' }; }
    const reservation = drawings.reserve(); if (reservation === null) return { status: 'ignored' };
    const valid = () => !closed && token === epoch && owner === owned && drawings.snapshot().draft?.id === reservation;
    try {
      await owned.player.pause(); if (!valid()) return { status: 'superseded' };
      if (target.note || target.row) {
        const time = target.note ? target.note.time : target.row.time;
        const index = target.note ? target.note.frameOrdinal : undefined;
        if (target.note && (!owned.info.frames[index] || owned.info.frames[index].id !== target.note.frameId || owned.info.frames[index].time !== time))
          throw issue('DRAWING_FRAME_CHANGED', '圈画源帧不一致，旧圈画已保留。');
        await owned.player.seek(time, { index, kind: 'annotation', final: true, inputAt: now() });
        if (!valid()) return { status: 'superseded' };
      }
      const actual = owned.player.snapshot(), frame = owned.info.frames[actual.frameOrdinal];
      if (actual.state !== 'paused' || actual.pendingTargets > 0 || !frame || frame.id !== actual.frameId || frame.time !== actual.time)
        throw issue('DRAWING_FRAME_NOT_READY', '当前源帧尚未准确显示，请完成定位后重试。');
      const native = await freshNative(owned, token); if (!valid()) return { status: 'superseded' };
      target = drawings.resolveFrame({ frameId: actual.frameId, frameOrdinal: actual.frameOrdinal }, native);
      drawings.begin(reservation, { frameId: actual.frameId, frameOrdinal: actual.frameOrdinal, time: actual.time }, target, kind);
      drawings.noteSetup(drawingModel.nativeAtFrame(native, owned.info.frames, actual.frameOrdinal, owned.info.duration), id);
      return { status: 'editing' };
    } catch (failure) { if (valid()) drawings.fail(failure); return { status: 'failed', message: failure.message }; }
  }

  let drawingWrite = null;
  function saveDrawing() {
    if (drawingWrite) return drawingWrite;
    const d = drawings.snapshot().draft, owned = owner, token = epoch;
    if (!d || !owned?.ready || closed || !['editing', 'failed', 'unknown'].includes(d.status)) return Promise.resolve({ status: 'ignored' });
    if (d.kind === 'delete' || !d.objects.length && !d.noteDirty && !d.nativeAttempt) return Promise.resolve(drawings.save());
    if (d.noteDirty && d.noteChoices?.length > 1 && !d.noteOriginal) { drawings.fail(Error('请选择要修改的文字，圈画和输入仍保留。')); return Promise.resolve({status:'failed'}); }
    const valid = () => !closed && epoch === token && owner === owned && drawings.snapshot().draft?.id === d.id;
    drawings.saveState('saving', d.nativeAttempt ? '正在核对原保存结果…' : '正在核对Eagle文字…');
    drawingWrite = Promise.resolve().then(async () => {
      let items;
      if (d.nativeAttempt) {
        if (typeof eagleAdapter.verifyComment !== 'function') throw Error('原保存结果尚未确认，无法重新发送。');
        const result = await eagleAdapter.verifyComment(d.nativeAttempt);
        if (!valid()) return { status: 'superseded' };
        if (result.status !== 'saved') { drawings.saveState('unknown', result.message || '文字保存结果未确认，请再次核对，勿重复添加。', d.nativeAttempt); return result; }
        drawings.saveState('saving', '文字已确认，正在保存圈画…', null);
        drawings.noteSaved();
        commentChange({ items: result.items }); items = result.items;
      } else items = await freshNative(owned, token);
      if (!valid()) return { status: 'superseded' };
      let links = drawingModel.nativeAtFrame(items, owned.info.frames, d.frameOrdinal, owned.info.duration);
      if ((!links.length && d.objects.length) || d.noteDirty && !d.nativeAttempt) {
        if (typeof eagleAdapter.saveComment !== 'function') throw Error('当前Eagle没有可用的文字保存接口。');
        const text = d.noteDirty ? d.noteText : d.objects.find(o => o.kind === 'text' && o.text.trim())?.text.trim().slice(0, 4096) || '第' + (d.frameOrdinal + 1) + '帧';
        let attempt = null;
        commentWriteRevision++;
        let result;
        try {
          result = await eagleAdapter.saveComment({ source, libraryPath: comments.libraryPath, frameId: d.frameId, time: d.time, text,
            ...(d.noteDirty && d.noteOriginal ? {kind:'edit',original:d.noteOriginal,time:d.noteOriginal.time} : {frameBounds: frameBounds(owned, d.frameOrdinal), reuseSameFrame: !d.noteDirty}) },
            { isCurrent: valid, onIssued(value) { attempt = value; if (valid()) drawings.saveState('saving', '正在保存并核对Eagle文字…', value); } });
        } catch (failure) { result = { status: attempt ? 'unknown' : 'failed', attempt, message: failure.message }; }
        commentWriteRevision++;
        if (!valid()) return { status: 'superseded' };
        if (result.status !== 'saved') {
          drawings.saveState(result.status === 'unknown' ? 'unknown' : 'failed', result.message || '文字未保存，圈画草稿仍保留。', result.attempt || attempt);
          return result;
        }
        drawings.saveState('saving', '文字已确认，正在保存圈画…', null);
        drawings.noteSaved();
        items = result.items; commentChange({ items });
        links = drawingModel.nativeAtFrame(items, owned.info.frames, d.frameOrdinal, owned.info.duration);
        if (!links.length) throw Error('新文字未能关联当前源帧，圈画草稿仍保留。');
      }
      drawings.setLinks(links.map(n => ({ id: n.id, time: n.time })));
      return drawings.save();
    }).catch(failure => {
      if (valid()) drawings.saveState('failed', failure.message);
      return { status: 'failed', message: failure.message };
    }).finally(() => { drawingWrite = null; scheduleCommentSync(); });
    return drawingWrite;
  }

  async function clearDrawing(id) {
    const owned = owner, token = epoch;
    if (closed || comments.draft || drawings.snapshot().draft || activeExport || !owned || !owned.ready || !['paused', 'playing'].includes(state)) return { status: 'ignored' };
    await control('pause', [], ['paused', 'playing']);
    if (token !== epoch || closed || owner !== owned) return { status: 'superseded' };
    return drawings.remove(id);
  }
  return Object.freeze({ loadSelected, retry: settings => loadSelected({ ...settings, trigger: 'retry' }),
    beginDrawing, clearDrawing, setDrawingObjects: drawings.objects, touchDrawing: drawings.touch,
    setDrawingNote: drawings.noteText,
    timelineFrames: () => owner?.ready ? owner.info.frames : null,
    annotationFrame: time => owner?.ready ? drawingModel.frameIndex(owner.info.frames,time,owner.info.duration) : null,
    renderThumbnail: (time, canvas) => owner?.ready && owner.player.paintThumbnail ? owner.player.paintThumbnail(time,canvas) : Promise.resolve(null),
    saveDrawing, cancelDrawing: drawings.discard, setDrawingsVisible: drawings.setVisible, setDrawingStyles: drawings.setStyles,
    hasDrawingDraft: () => !!drawings.snapshot().draft,
    play: () => control('play', [], ['paused']), pause: () => control('pause', [], ['paused', 'playing', 'seeking']),
    toggle: () => state === 'playing' || owner?.player?.snapshot()?.buffering ? control('pause', [], ['playing', 'seeking']) : control('play', [], ['paused']),
    seek: (time, settings = {}) => control('seek', [time, { ...settings, inputAt: settings.inputAt === undefined ? now() : settings.inputAt }], ['paused', 'playing', 'seeking']),
    step: delta => control('step', [delta], ['paused', 'playing', 'seeking']),
    setPlaybackRate: rate => control('setPlaybackRate', [rate], ['paused', 'playing']),
    setLoopPoint: point => control('setLoopPoint', [point], ['paused', 'playing']),
    setLoopEnabled: enabled => control('setLoopEnabled', [enabled], ['paused', 'playing']),
    clearLoop: () => control('clearLoop', [], ['paused', 'playing']),
    applyLoopRange: range => control('applyLoopRange', [range], ['paused', 'playing', 'seeking']),
    loopFrameAt: (time, bounds) => !closed && owner && owner.ready && owner.epoch === epoch && !comments.draft &&
      ['paused', 'playing', 'seeking'].includes(state) && typeof owner.player.loopFrameAt === 'function' ? owner.player.loopFrameAt(time, bounds) : null,
    beginComment, chooseComment, editComment: id => beginCommentMutation(id, 'edit'), deleteComment: id => beginCommentMutation(id, 'delete'),
    setCommentText, saveComment, cancelComment, checkComment, refreshComments, setCommentsVisible,
    seekComment: id => {
      const item = drawings.list(comments.items).find(value => value.id === id);
      return item && item.time <= duration ? control('seek', [item.time, { kind: 'annotation', index: item.drawingFrameOrdinal, final: true, inputAt: now() }], ['paused', 'playing', 'seeking']) : Promise.resolve({ status: 'ignored' });
    },
    annotationHistory: () => Object.freeze(annotationReceipts.slice()), setMemoryMiB, setPlaybackSettings, setDrawingToolbar, clearOtherCaches,
    beginExport, loadExportFolders, checkExport, cancelExport: () => { if (activeExport && !activeExport.issued) activeExport.controller.abort(); },
    libraryChanged: () => clear('library-changed'), close: () => clear('closed'), snapshot, memorySnapshot, cacheCoverageSnapshot });
}
module.exports = { createSession };
