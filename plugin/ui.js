/* UI sends operations only to the session; it never reads Eagle or files. */
(function (root, factory) {
  'use strict';
  // Eagle exposes CommonJS in a Window, but its require is rooted in the host.
  // Page scripts must use the helper already loaded by index.html instead.
  const view = typeof window === 'object' && window ? window : root && root.document ? root : null;
  const api = factory(view ? view.EVALoopSelection : require('./loop-selection.js'),
    view ? view.EVATimelineView : require('./timeline-view.js'), view ? view.EVAPlayer : require('./player.js'),
    view ? view.EVADrawingUI : require('./drawing-ui.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (view) view.EVAUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (selectionAPI, timelineAPI, playerAPI, drawingAPI) {
  'use strict';
  function formatTime(seconds) {
    const milliseconds = Math.max(0, Math.floor((Number(seconds) || 0) * 1000 + .00001));
    return Math.floor(milliseconds / 60000) + ':' + String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0') + '.' + String(milliseconds % 1000).padStart(3, '0');
  }
  const pointerTime = (x, rect, range) => timelineAPI.timeAt(x, rect, range);
  function spaceAllowed(event, timeline) {
    if (!(event.code === 'Space' || event.key === ' ') || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
    const target = event.target;
    if (!target) return true;
    if (target.isContentEditable) return false;
    const control = typeof target.closest === 'function' && target.closest('button,input,textarea,select,a,[contenteditable],[role="textbox"],[role="slider"]');
    // This custom timeline has no native Space action; other controls retain theirs.
    return !control || control === timeline;
  }
  function frameStepKey(event) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return 0;
    const target = event.target;
    if (target && (target.isContentEditable || typeof target.closest === 'function' && target.closest('input,textarea,select,[contenteditable],[role="textbox"]'))) return 0;
    if (event.code === 'BracketLeft' || event.key === '[' || event.key === '【') return -1;
    if (event.code === 'BracketRight' || event.key === ']' || event.key === '】') return 1;
    return 0;
  }
  function letterKey(event, code) {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
    const target = event.target;
    if (target && (target.isContentEditable || typeof target.closest === 'function' && target.closest('textarea,select,[contenteditable],[role="textbox"]'))) return false;
    const input = target && typeof target.closest === 'function' && target.closest('input');
    if (input && !['checkbox', 'radio', 'button'].includes(input.type)) return false;
    return event.code === 'Key' + code || String(event.key || '').toLowerCase() === code.toLowerCase();
  }
  function createUI(options = {}) {
    const doc = options.document || document, win = options.window || window, now = options.now || (() => performance.now());
    const ids = ['screen', 'picture', 'notice', 'timeline', 'progress', 'thumb', 'timeHint', 'play', 'previous', 'next', 'currentTime', 'duration', 'frameReadout', 'sourceName', 'memoryUsage', 'status', 'error', 'retry',
      'commentMarkers', 'commentList', 'commentStatus', 'commentAdd', 'commentEditor', 'commentTime', 'commentText', 'commentSave', 'commentCancel', 'commentKeyboardHint',
      'memoryMiB', 'memoryApply', 'memoryAllowance', 'memoryStatus', 'cacheClearOther', 'cacheClearStatus', 'qualitySelect', 'previewQuality',
      'forwardPredecode', 'decodedCache', 'cacheStatus', 'playbackRate', 'loopSelect', 'loopCancel', 'loopEnabled', 'loopRange',
      'loopBand', 'loopHandleStart', 'loopHandleEnd', 'loopHelp', 'timeRuler', 'wheelFrames', 'showCacheStrip', 'rateStep', 'customPlaybackRate',
      'exportDestination', 'exportFolder', 'exportFolderArea', 'exportFolderRefresh', 'exportFrame', 'exportClip', 'exportCancel', 'exportCheck', 'exportStatus'];
    const el = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
    if (ids.some(id => !el[id])) throw new Error('播放器界面缺少必要元素。');
    let session = null, state = { state: 'empty', duration: 0 }, gesture = null, hintEpoch = null, hintGeometry = null, lastRequestedTime = 0;
    let viewRange = { start: 0, end: 0, focused: false }, timelineWidth = null, rulerKey = null;
    let rateRequest = null, noteRequest = null, exportRequest = null;
    let drawingUI = null;
    const markerButtons = [], markerTimes = new WeakMap();
    const attributes = new Map();
    const loopAttributes = new WeakMap();
    function loopAttribute(node, name, value) {
      if (!loopAttributes.has(node)) loopAttributes.set(node, new Map());
      const saved = loopAttributes.get(node);
      if (saved.get(name) !== value) { node.setAttribute(name, value); saved.set(name, value); }
    }
    const set = (node, key, value) => { if (node[key] !== value) node[key] = value; };
    let memoryTimer = null;
    let coverageTimer = null, coverageKey = null, coverageEpoch = null, coverageSize = null;
    const coverageContext = typeof el.decodedCache.getContext === 'function' ? el.decodedCache.getContext('2d') : null;
    function clearCoverage() {
      if (coverageKey !== 'empty' && coverageContext) coverageContext.clearRect(0, 0, el.decodedCache.width || 1, el.decodedCache.height || 3);
      coverageKey = 'empty'; set(el.cacheStatus, 'textContent', '');
    }
    function refreshCoverage() {
      const value = session && typeof session.cacheCoverageSnapshot === 'function' ? session.cacheCoverageSnapshot() : null;
      if (!value || value.sessionEpoch !== state.epoch || !(value.duration > 0) || !['paused', 'playing', 'seeking'].includes(state.state)) { clearCoverage(); return; }
      const text = value.issue ? '后台准备暂停，请重开视频重试' : value.decodedFrames === value.totalFrames ? '整段已解压' :
        (value.enabled ? value.phase === 'budget' ? '已保留操作余量' : '后台准备附近画面' : '按需缓存') + ' · ' + value.decodedFrames + ' / ' + value.totalFrames + ' 帧';
      set(el.cacheStatus, 'textContent', text);
      if (el.decodedCache.hidden) { coverageKey = null; return; }
      const key = [value.sessionEpoch, value.epoch, value.revision, value.duration, viewRange.start, viewRange.end].join(':');
      if (key === coverageKey) return;
      coverageKey = key;
      if (!coverageContext) return;
      if (!coverageSize) {
        const scale = Number(win.devicePixelRatio) || 1;
        if (timelineWidth === null) timelineWidth = el.timeline.getBoundingClientRect().width;
        coverageSize = { width: Math.max(1, Math.round(timelineWidth * scale)), height: Math.max(1, Math.round(3 * scale)) };
      }
      const { width, height } = coverageSize;
      set(el.decodedCache, 'width', width); set(el.decodedCache, 'height', height);
      coverageContext.clearRect(0, 0, width, height); coverageContext.fillStyle = '#68ab79';
      for (const range of value.ranges) {
        const clipped = timelineAPI.clip(range.start, range.end, viewRange);
        if (clipped) coverageContext.fillRect(clipped.start * width, 0, (clipped.end - clipped.start) * width, height);
      }
    }
    function refreshMemory() {
      const budget = session && typeof session.memorySnapshot === 'function' ? session.memorySnapshot() : null;
      const available = budget && Number.isFinite(budget.used) && budget.used >= 0 && Number.isFinite(budget.limit) && budget.limit > 0;
      set(el.memoryUsage, 'textContent', available ? '视频缓存 RAM：' + (budget.used / 1048576).toFixed(1) + ' / ' +
        (budget.limit / 1048576).toFixed(0) + ' MiB' : '视频缓存 RAM：—');
    }
    function attribute(name, value) {
      if (attributes.get(name) !== value) { el.timeline.setAttribute(name, value); attributes.set(name, value); }
    }
    const listeners = [];
    const on = (target, type, handler, settings) => { target.addEventListener(type, handler, settings); listeners.push([target, type, handler, settings]); };
    function commentsVisibility() {
      const visible = !doc.hidden && doc.visibilityState !== 'hidden' && state.state !== 'closed' && state.state !== 'closing';
      if (session && typeof session.setCommentsVisible === 'function') session.setCommentsVisible(visible);
      return visible;
    }
    function refreshCommentsOnReturn() {
      if (commentsVisibility() && session && typeof session.refreshComments === 'function')
        Promise.resolve(session.refreshComments()).catch(() => {});
    }
    on(win, 'focus', refreshCommentsOnReturn);
    if (typeof doc.addEventListener === 'function') on(doc, 'visibilitychange', refreshCommentsOnReturn);
    let memoryBusy = false, cleaning = false, shownMemory = null, shownTier = '', shownQuality = null, shownPredecode = null, shownWheel = null, shownStrip = null, shownRateStep = null;
    function updateMemorySettings() {
      const memory = state.memorySettings;
      const disabled = !session || !memory || memoryBusy || cleaning || transportBusy || !!noteRequest || !!exportRequest || state.state === 'preparing' || state.state === 'closed' || !!state.comments?.draft || !!state.drawings?.draft || selection.snapshot().editing;
      set(el.memoryApply, 'disabled', disabled); set(el.memoryMiB, 'disabled', disabled); set(el.qualitySelect, 'disabled', disabled);
      set(el.forwardPredecode, 'disabled', disabled);
      set(el.wheelFrames, 'disabled', disabled); set(el.showCacheStrip, 'disabled', disabled);
      set(el.rateStep, 'disabled', disabled);
      set(el.cacheClearOther, 'disabled', disabled || !['paused', 'playing', 'seeking'].includes(state.state));
      if (memory && memory !== shownMemory) {
        shownMemory = memory; shownTier = String(memory.ramMiB);
        set(el.memoryMiB, 'value', shownTier);
        set(el.memoryAllowance, 'textContent', '缓存上限 ' + (memory.ramBytes / 1048576).toFixed(0) + ' MB（不含程序额外占用）' +
          (memory.legacyConverted ? '；旧百分比已换算，应用后保存。' : ''));
      }
      if (shownQuality !== (state.previewQuality || '720p')) {
        shownQuality = state.previewQuality || '720p'; set(el.qualitySelect, 'value', shownQuality);
      }
      const preview = state.preview;
      if (shownPredecode !== !!state.forwardPredecode) {
        shownPredecode = !!state.forwardPredecode; set(el.forwardPredecode, 'checked', shownPredecode);
      }
      const interaction = state.interactionSettings || { wheelFrames: 1, showCacheStrip: true };
      if (shownWheel !== interaction.wheelFrames) { shownWheel = interaction.wheelFrames; set(el.wheelFrames, 'value', String(shownWheel)); }
      if (shownStrip !== interaction.showCacheStrip) { shownStrip = interaction.showCacheStrip; set(el.showCacheStrip, 'checked', shownStrip); }
      if (shownRateStep !== (interaction.rateStep ?? .1)) { shownRateStep = interaction.rateStep ?? .1; set(el.rateStep, 'value', String(shownRateStep)); }
      for (const option of Array.from(el.qualitySelect.options || [])) {
        const long = option.value === '1080p' ? 1920 : 1280, short = option.value === '1080p' ? 1080 : 720;
        const original = preview && preview.sampleAspectRatio === '1:1' &&
          Math.max(preview.sourceWidth, preview.sourceHeight) <= long && Math.min(preview.sourceWidth, preview.sourceHeight) <= short;
        set(option, 'textContent', option.value + (original ? '（原始分辨率）' : ''));
      }
      set(el.previewQuality, 'textContent', preview ? preview.quality + ' 预览 · ' + preview.width + ' × ' + preview.height +
        (preview.originalResolution ? '（原始分辨率）' : '') : (state.previewQuality || '720p') + ' 预览');
    }
    on(el.memoryApply, 'click', async () => {
      if (el.memoryApply.disabled || !session || typeof session.setPlaybackSettings !== 'function' && typeof session.setMemoryMiB !== 'function') return;
      const active = session, ramMiB = Number(el.memoryMiB.value);
      memoryBusy = true; set(el.memoryStatus, 'textContent', '正在应用，完成后保持暂停…'); updateMemorySettings();
      try { const result = typeof active.setPlaybackSettings === 'function'
          ? await active.setPlaybackSettings({ ramMiB, previewQuality: el.qualitySelect.value, forwardPredecode: el.forwardPredecode.checked,
            wheelFrames: Number(el.wheelFrames.value), showCacheStrip: !!el.showCacheStrip.checked, rateStep: Number(el.rateStep.value) }) : await active.setMemoryMiB(ramMiB);
        if (session !== active) return;
        set(el.memoryStatus, 'textContent', result.status === 'error' ? '设置已保存，视频准备失败；可调整画质或内存后重试。' :
          result.status === 'superseded' ? '操作已被素材切换或关闭替代。' : '设置已保存。');
      } catch (failure) { if (session === active) set(el.memoryStatus, 'textContent', String(failure.message || failure)); }
      finally { memoryBusy = false; if (session === active) { shownMemory = null; shownQuality = null; shownPredecode = null; shownWheel = null; shownStrip = null; shownRateStep = null; updateMemorySettings(); } }
    });
    on(el.cacheClearOther, 'click', async () => {
      if (el.cacheClearOther.disabled || !session || typeof session.clearOtherCaches !== 'function') return;
      const active = session; cleaning = true; set(el.cacheClearStatus, 'textContent', '正在清理，保留当前及正在使用的缓存…'); updateMemorySettings();
      try { const result = await active.clearOtherCaches(); if (session !== active) return;
        set(el.cacheClearStatus, 'textContent', result.status === 'superseded' ? '操作已被素材切换或关闭替代。' :
          '已清除' + result.cleared + '个缓存，释放' + (result.freedBytes / 1048576).toFixed(1) + ' MB；当前及正在使用的缓存保留。');
      } catch (failure) { if (session === active) set(el.cacheClearStatus, 'textContent', String(failure.message || failure)); }
      finally { cleaning = false; if (session === active) updateMemorySettings(); }
    });
    on(win, 'resize', () => { coverageKey = null; coverageSize = null; timelineWidth = null; rulerKey = null; updateTransport(); refreshCoverage(); });
    const interactive = () => !!session && !noteRequest && !exportRequest && !state.comments?.draft && !state.drawings?.draft && state.exportState?.status !== 'busy' && ['paused', 'playing', 'seeking'].includes(state.state);
    const invoke = fn => {
      try { Promise.resolve(fn()).catch(() => {}); } catch (_) { /* session publishes operation errors */ }
    };
    const selection = selectionAPI.createSelection({ getSession: () => session, getState: () => state,
      setTimeout: (fn, ms) => (win.setTimeout || setTimeout)(fn, ms), clearTimeout: id => (win.clearTimeout || clearTimeout)(id),
      changed() { updateTransport(); updateMemorySettings(); updateComments(); updateExports(); } });
    let transportBusy = false;
    function positionMarkers() {
      for (const marker of markerButtons) {
        const time = markerTimes.get(marker);
        set(marker, 'hidden', !timelineAPI.contains(time, viewRange));
        set(marker.style, 'left', timelineAPI.ratio(time, viewRange) * 100 + '%');
      }
    }
    function updateView() {
      if (timelineWidth === null) timelineWidth = el.timeline.getBoundingClientRect().width;
      const next = gesture ? gesture.range : timelineAPI.visibleRange(state.duration, state.playback?.transport?.loop, selection.snapshot().editing);
      const changed = next.start !== viewRange.start || next.end !== viewRange.end || next.focused !== viewRange.focused;
      viewRange = next;
      attribute('aria-valuemin', String(viewRange.start)); attribute('aria-valuemax', String(viewRange.end));
      if (changed) {
        rulerKey = null; hintGeometry = null; coverageKey = null;
        attribute('data-view', viewRange.focused ? 'loop' : 'full');
        attribute('aria-label', viewRange.focused ? '循环片段进度（L关闭恢复整段，长按R临时整段调整）' : '视频进度');
        positionMarkers();
        if (!gesture) thumb(state.playback?.time || 0);
        if (hintEpoch !== null) hint(state.playback?.time || 0);
        refreshCoverage();
      }
      const key = [viewRange.start, viewRange.end, viewRange.focused, timelineWidth].join(':');
      if (rulerKey === key) return;
      rulerKey = key;
      // Non-DOM unit harnesses may omit createElement; browser/loader tests
      // exercise the actual bounded tick nodes and their geometry.
      if (typeof doc.createElement !== 'function') return;
      const nodes = timelineAPI.ticks(viewRange, timelineWidth).map(value => {
        const tick = doc.createElement('span'); tick.className = 'time-tick'; tick.style.left = value.position * 100 + '%';
        if (value.label) {
          const label = doc.createElement('span'); label.className = 'tick-label'; label.textContent = value.label;
          label.style.left = value.labelOffset + 'px'; tick.appendChild(label);
        }
        return tick;
      });
      el.timeRuler.replaceChildren(...nodes);
    }
    function shortcutReady() {
      return interactive() && ['paused', 'playing'].includes(state.state) && !gesture && !memoryBusy && !cleaning &&
        !selection.snapshot().editing && !selection.snapshot().busy;
    }
    async function requestRate(value, direction) {
      if (!shortcutReady() || transportBusy && !rateRequest) return;
      const base = rateRequest ? rateRequest.target : state.playback?.transport?.rate || 1;
      const target = direction === undefined ? value : playerAPI.steppedRate(base, direction, state.interactionSettings?.rateStep ?? .1);
      if (!playerAPI.validRate(target)) return;
      if (rateRequest) { rateRequest.target = target; return; }
      if (target === base) return;
      const job = rateRequest = { session, epoch: state.epoch, target };
      transportBusy = true; updateTransport(); updateMemorySettings(); updateComments(); updateExports();
      try {
        while (rateRequest === job && session === job.session && state.epoch === job.epoch && shortcutReady()) {
          const selected = job.target, result = await job.session.setPlaybackRate(selected);
          if (result?.status === 'superseded' || result?.status === 'error' || job.target === selected) break;
        }
      } catch (_) { /* Session publishes controlled failures. */ }
      finally { if (rateRequest === job) { rateRequest = null; transportBusy = false; update(state); } }
    }
    function updateTransport() {
      updateView();
      const transport = state.playback && state.playback.transport, loop = transport && transport.loop;
      const editing = selection.snapshot(), disabled = transportBusy || editing.busy || !interactive() || !['paused', 'playing'].includes(state.state) || !!gesture;
      set(el.playbackRate, 'disabled', disabled || editing.editing);
      set(el.loopSelect, 'disabled', transportBusy || editing.busy || !interactive() || !!gesture);
      set(el.loopEnabled, 'disabled', disabled || editing.editing || !loop || !loop.valid);
      set(el.loopCancel, 'hidden', !editing.editing);
      set(el.loopSelect, 'textContent', editing.editing ? '确认片段（R）' : loop && (loop.startOrdinal != null || loop.endOrdinal != null) ? '清除片段（R）' : '选择片段（R）');
      set(el.play, 'disabled', !interactive() || editing.editing || editing.busy || !['paused', 'playing'].includes(state.state));
      set(el.commentAdd, 'disabled', !interactive() || editing.editing || editing.busy || !!gesture || state.comments?.status !== 'ready');
      if (!transportBusy) {
        set(el.loopEnabled, 'checked', !!(loop && loop.enabled));
      }
      const rate = transport ? transport.rate : 1, custom = !playerAPI.RATE_PRESETS.includes(rate);
      set(el.customPlaybackRate, 'hidden', !custom);
      set(el.customPlaybackRate, 'value', custom ? String(rate) : 'custom');
      set(el.customPlaybackRate, 'textContent', custom ? rate + '×' : '当前速度');
      set(el.playbackRate, 'value', String(rate));
      const point = (time, ordinal) => Number.isFinite(time) && Number.isSafeInteger(ordinal) ? formatTime(time) + '（第' + (ordinal + 1) + '帧）' : '未设';
      const start = editing.editing ? editing.start : loop?.startOrdinal != null ? { time: loop.startTime, ordinal: loop.startOrdinal } : null,
        endPoint = editing.editing ? editing.end : loop?.endOrdinal != null ? { time: loop.endTime, ordinal: loop.endOrdinal } : null;
      loopAttribute(el.timeline, 'data-has-range', String(!!(start || endPoint)));
      set(el.loopRange, 'textContent', !start && !endPoint ? '未设置范围' : point(start?.time, start?.ordinal) + ' → ' + point(endPoint?.time, endPoint?.ordinal) + (start && endPoint ? ' · 含结束帧' : ''));
      set(el.loopRange, 'title', el.loopRange.textContent);
      loopAttribute(el.timeline, 'data-selecting', String(editing.editing)); loopAttribute(el.timeline, 'data-loop-on', String(!!loop?.enabled && !editing.editing));
      for (const [node, value, name] of [[el.loopHandleStart, start, 'start'], [el.loopHandleEnd, endPoint, 'end']]) {
        set(node, 'hidden', !value); set(node, 'disabled', !editing.editing || editing.busy);
        loopAttribute(node, 'data-active', String(editing.editing && editing.active === name));
        if (value) { set(node.style, 'left', timelineAPI.ratio(value.time, viewRange) * 100 + '%'); loopAttribute(node, 'aria-label', (name === 'start' ? '循环起点 ' : '循环终点 ') + point(value.time, value.ordinal)); }
      }
      set(el.loopBand, 'hidden', !start || !endPoint);
      if (start && endPoint && state.duration > 0) { set(el.loopBand.style, 'left', timelineAPI.ratio(start.time, viewRange) * 100 + '%'); set(el.loopBand.style, 'width', Math.max(0, timelineAPI.ratio(endPoint.time, viewRange) - timelineAPI.ratio(start.time, viewRange)) * 100 + '%'); }
      const help = editing.message || (editing.editing ? editing.busy ? '正在固定画面…' :
        (!start ? '点击并拖动起点，再点击并拖动终点。' : !endPoint ? '点击并拖动终点。' : '拖动端点调整，点击空白处浏览；【／】微调当前端点。') +
        (editing.mode === 'hold' ? ' 临时整段；松开 R 确认，Esc 取消。' : ' 再按 R 确认，Esc 取消。') : '');
      set(el.loopHelp, 'textContent', help); set(el.loopHelp, 'hidden', !help);
    }
    on(el.playbackRate, 'change', () => { if (!el.playbackRate.disabled) requestRate(Number(el.playbackRate.value)); });
    on(el.loopSelect, 'click', () => { if (!el.loopSelect.disabled) selection.clearOrChoose(); });
    on(el.loopCancel, 'click', () => { clearGesture(); selection.cancel(); });
    on(el.loopEnabled, 'change', () => { if (!el.loopEnabled.disabled) selection.toggleLoop(); });
    function thumb(time) {
      const ratio = timelineAPI.ratio(time, viewRange);
      set(el.thumb.style, 'left', ratio * 100 + '%'); set(el.progress.style, 'width', ratio * 100 + '%');
    }
    function measureHint(rect) {
      // The <=30s time string uses tabular digits of constant width. Measure
      // on gesture start/resize, not after every DOM write in the seek loop.
      hintGeometry = { width: (rect || el.timeline.getBoundingClientRect()).width,
        half: Math.max(35, (el.timeHint.offsetWidth || 80) / 2) };
    }
    function hint(time) {
      set(el.timeHint, 'textContent', formatTime(time));
      if (!hintGeometry) measureHint();
      const { width, half } = hintGeometry;
      const x = timelineAPI.ratio(time, viewRange) * width;
      set(el.timeHint.style, 'left', Math.max(Math.min(half, width / 2), Math.min(width - half, x)) + 'px');
    }
    function clearHint() { hintEpoch = null; hintGeometry = null; set(el.timeHint, 'hidden', true); }
    function clearGesture(hideHint = true) {
      const old = gesture; gesture = null; if (hideHint) clearHint();
      if (old) { try { if (el.timeline.hasPointerCapture(old.id)) el.timeline.releasePointerCapture(old.id); } catch (_) {} }
      updateTransport();
    }
    function requestAt(event, final, inputAt = now()) {
      const time = event && gesture ? pointerTime(event.clientX, gesture.rect, gesture.range) : lastRequestedTime;
      if (time === null) return;
      lastRequestedTime = time; thumb(time);
      if (gesture && gesture.point) selection.move(gesture.point, time, final, inputAt);
      else invoke(() => session.seek(time, { kind: final ? 'release' : 'rapid', final: !!final, inputAt }));
    }
    function end(event) {
      const inputAt = now();
      if (!gesture || (event && event.pointerId !== gesture.id)) return;
      if (interactive()) requestAt(event, true, inputAt);
      clearGesture(false);
    }
    on(el.timeline, 'pointerdown', event => {
      const inputAt = now();
      if (!interactive() || gesture || (event.button !== undefined && event.button !== 0)) return;
      const editing = selection.snapshot(); if (editing.busy) return;
      const handle = event.target === el.loopHandleStart ? 'start' : event.target === el.loopHandleEnd ? 'end' : null;
      if (handle && !editing.editing) return;
      event.preventDefault(); gesture = { id: event.pointerId, rect: el.timeline.getBoundingClientRect(), epoch: state.epoch, range: { ...viewRange },
        point: editing.editing ? handle || selection.nextPoint() : null };
      el.timeline.focus(); try { el.timeline.setPointerCapture(event.pointerId); } catch (_) {}
      hintEpoch = state.epoch; set(el.timeHint, 'hidden', false);
      set(el.timeHint, 'textContent', formatTime(state.playback ? state.playback.time : 0));
      measureHint(gesture.rect); hint(state.playback ? state.playback.time : 0); requestAt(event, false, inputAt);
    });
    // Capture loss does not end a physical drag: window moves/up still own it.
    on(el.timeline, 'lostpointercapture', () => {});
    on(win, 'pointermove', event => {
      const inputAt = now();
      if (!gesture || event.pointerId !== gesture.id) return;
      if (event.buttons !== undefined && !(event.buttons & 1)) return end(event);
      if (interactive()) requestAt(event, false, inputAt);
    });
    on(win, 'pointerup', end);
    on(win, 'pointercancel', event => { if (selection.snapshot().editing) { clearGesture(); selection.cancel(); } else end(event); });
    on(win, 'blur', () => { if (selection.snapshot().editing) { clearGesture(); selection.blur(); } else { end(null); selection.blur(); } });
    on(win, 'resize', () => {
      if (gesture) gesture.rect = el.timeline.getBoundingClientRect();
      if (hintEpoch !== null) { measureHint(gesture && gesture.rect); hint(state.playback ? state.playback.time : 0); }
    });
    on(el.play, 'click', () => { if (session && !gesture && !selection.snapshot().editing && !selection.snapshot().busy) { clearHint(); invoke(() => session.toggle()); } });
    function step(delta) { if (interactive() && !gesture && !selection.snapshot().busy) { clearHint(); if (!selection.snapshot().editing || !selection.step(delta)) invoke(() => session.step(delta)); } }
    function wheel(event) {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.isComposing ||
          !Number.isFinite(event.deltaY) || !event.deltaY || Math.abs(event.deltaX || 0) > Math.abs(event.deltaY) ||
          !interactive() || gesture || selection.snapshot().busy || memoryBusy || cleaning) return;
      const target = doc.activeElement;
      if (target && (target.isContentEditable || typeof target.closest === 'function' && target.closest('input,textarea,select,[contenteditable],[role="textbox"]'))) return;
      const sensitivity = state.interactionSettings?.wheelFrames || 1;
      event.preventDefault(); step(Math.sign(event.deltaY) * sensitivity);
    }
    on(el.screen, 'wheel', wheel, { passive: false }); on(el.timeline, 'wheel', wheel, { passive: false });
    on(el.previous, 'click', () => step(-1)); on(el.next, 'click', () => step(1));
    on(el.retry, 'click', () => { if (session) invoke(() => session.retry()); });
    on(win, 'keydown', event => {
      if (event.key === 'Escape' && selection.snapshot().editing) { event.preventDefault(); clearGesture(); selection.cancel(); return; }
      if (letterKey(event, 'R')) { if (interactive() && !gesture) { event.preventDefault(); selection.keyDown(); } return; }
      if (letterKey(event, 'L')) { if (interactive() && !gesture) { event.preventDefault(); selection.toggleLoop(); } return; }
      for (const key of ['Z', 'X', 'C']) if (letterKey(event, key)) {
        if (shortcutReady()) { event.preventDefault(); requestRate(key === 'Z' ? 1 : undefined, key === 'Z' ? undefined : key === 'X' ? -1 : 1); }
        return;
      }
      if (letterKey(event, 'N')) { if (shortcutReady() && !transportBusy && !el.commentAdd.disabled) { event.preventDefault(); beginNote(); } return; }
      for (const [key, kind] of [['S', 'frame'], ['E', 'clip']]) if (letterKey(event, key)) {
        if (shortcutReady() && !transportBusy) { event.preventDefault(); exportSelected(kind); } return;
      }
      const delta = frameStepKey(event);
      if (delta) {
        if (interactive() && !gesture) { event.preventDefault(); step(delta); }
        return;
      }
      if (!spaceAllowed(event, el.timeline)) return;
      event.preventDefault(); if (interactive() && !gesture && !selection.snapshot().editing && !selection.snapshot().busy && ['paused', 'playing'].includes(state.state)) { clearHint(); invoke(() => session.toggle()); }
    });
    on(win, 'keyup', event => {
      if (event.code === 'KeyR' || String(event.key || '').toLowerCase() === 'r') { if (selection.snapshot().editing && gesture) end(null); selection.keyUp(); }
    });
    on(el.timeline, 'keydown', event => {
      if (!interactive() || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
    });
    let renderedItems = null, renderedDuration = null, renderedComments = null, renderedInteractive = null, editorId = null, editorEpoch = null;
    let commentComposing = false, commentCompositionEnd = -Infinity;
    const commentButtons = [];
    function seekComment(event) {
      const button = event.target && event.target.closest && event.target.closest('button[data-comment-id]');
      if (button && !button.disabled && interactive() && !selection.snapshot().editing) {
        clearHint();
        const action = button.dataset.commentAction;
        const item = state.comments?.items.find(n => n.id === button.dataset.commentId);
        if (action === 'drawing') { drawingUI.begin(button.dataset.commentId); return; }
        if (action === 'clear-drawing') { invoke(() => session.clearDrawing(item.drawingId)); return; }
        if (action === 'delete' && item?.localDrawing) { drawingUI.begin(item.id, 'delete'); return; }
        invoke(() => action === 'edit' ? session.editComment(button.dataset.commentId)
          : action === 'delete' ? session.deleteComment(button.dataset.commentId) : session.seekComment(button.dataset.commentId));
      }
    }
    on(el.commentMarkers, 'click', seekComment); on(el.commentList, 'click', seekComment);
    async function beginNote() {
      if (!shortcutReady() || transportBusy || el.commentAdd.disabled) return;
      const job = noteRequest = { session, epoch: state.epoch }; update(state);
      try { const pending = job.session.beginComment(); if (pending && typeof pending.then === 'function') await pending; }
      catch (_) { /* Session publishes proposal failures. */ }
      finally { if (noteRequest === job) { noteRequest = null; update(state); } }
    }
    on(el.commentAdd, 'click', beginNote);
    on(el.commentText, 'input', () => { if (session) invoke(() => session.setCommentText(el.commentText.value)); });
    on(el.commentText, 'compositionstart', () => { commentComposing = true; });
    on(el.commentText, 'compositionend', () => {
      commentComposing = false; commentCompositionEnd = now();
      if (session) invoke(() => session.setCommentText(el.commentText.value));
    });
    on(el.commentText, 'keydown', event => {
      if (event.key !== 'Enter' && event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
      const draft = state.comments?.draft;
      if (commentComposing || event.isComposing || event.keyCode === 229 || now() - commentCompositionEnd < 50) return;
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || !session || !draft || draft.kind === 'delete' ||
          !['editing', 'failed'].includes(draft.status)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      invoke(() => { session.setCommentText(el.commentText.value); return session.saveComment(); });
    });
    on(el.commentSave, 'click', () => { if (session) invoke(() => state.comments?.draft?.status === 'unknown' ? session.checkComment() : session.saveComment()); });
    on(el.commentCancel, 'click', () => { if (session) invoke(() => session.cancelComment()); });
    on(el.exportDestination, 'change', () => {
      updateExports();
      if (session && el.exportDestination.value === 'eagle') invoke(() => session.loadExportFolders());
    });
    on(el.exportFolderRefresh, 'click', () => { if (session) invoke(() => session.loadExportFolders()); });
    const exportSelected = async kind => {
      if (!shortcutReady() || transportBusy || (kind === 'clip' ? el.exportClip : el.exportFrame).disabled) return;
      const job = exportRequest = { session, epoch: state.epoch };
      const destination = { destination: el.exportDestination.value === 'eagle' ? 'eagle' : 'local', folderId: el.exportFolder.value };
      update(state);
      try { const pending = job.session.beginExport(kind, destination); if (pending && typeof pending.then === 'function') await pending; }
      catch (_) { /* Session publishes output/unknown-result failures. */ }
      finally { if (exportRequest === job) { exportRequest = null; update(state); } }
    };
    on(el.exportFrame, 'click', () => exportSelected('frame')); on(el.exportClip, 'click', () => exportSelected('clip'));
    on(el.exportCancel, 'click', () => { if (session) invoke(() => session.cancelExport()); });
    on(el.exportCheck, 'click', () => { if (session) invoke(() => session.checkExport()); });
    let renderedFolders = null;
    function updateExports() {
      const value = state.exportState || {}, folders = state.exportFolders || {}, busy = value.status === 'busy';
      const eagleDestination = el.exportDestination.value === 'eagle';
      const ready = interactive() && !transportBusy && ['paused', 'playing'].includes(state.state) && !gesture && !selection.snapshot().editing &&
        !selection.snapshot().busy && !memoryBusy && !cleaning && value.status !== 'unknown';
      if (Array.isArray(folders.items) && folders.items !== renderedFolders) {
        renderedFolders = folders.items;
        const selected = el.exportFolder.value;
        el.exportFolder.replaceChildren();
        const placeholder = doc.createElement('option'); placeholder.value = ''; placeholder.textContent = '选择Eagle文件夹'; el.exportFolder.appendChild(placeholder);
        for (const folder of folders.items || []) {
          const option = doc.createElement('option'); option.value = folder.id; option.textContent = folder.label; el.exportFolder.appendChild(option);
        }
        el.exportFolder.value = (folders.items || []).some(folder => folder.id === selected) ? selected : '';
      }
      set(el.exportFolderArea, 'hidden', !eagleDestination);
      set(el.exportDestination, 'disabled', busy); set(el.exportFolder, 'disabled', busy || folders.status !== 'ready');
      set(el.exportFolderRefresh, 'disabled', busy || folders.status === 'loading');
      const destinationReady = !eagleDestination || folders.status === 'ready' && !!el.exportFolder.value;
      set(el.exportFrame, 'disabled', !ready || !destinationReady);
      set(el.exportClip, 'disabled', !ready || !destinationReady || !state.playback?.transport?.loop?.valid);
      set(el.exportCancel, 'hidden', !busy); set(el.exportCheck, 'hidden', value.status !== 'unknown');
      set(el.exportCancel, 'disabled', value.cancellable === false);
      set(el.exportStatus, 'textContent', value.message || folders.message || (folders.status === 'loading' ? '正在读取文件夹…' : '从原视频导出，预览画质不影响结果。'));
    }
    on(el.exportFolder, 'change', updateExports);
    function updateComments() {
      const value = state.comments, draft = value && value.draft, ready = interactive() && !transportBusy && !selection.snapshot().editing && !selection.snapshot().busy && !gesture;
      const items = value && value.items;
      let rebuilt = false;
      // The immutable list changes only on loading/read-back, never per frame.
      if (items && (items !== renderedItems || renderedDuration !== state.duration)) {
        renderedItems = items; renderedDuration = state.duration;
        rebuilt = true;
        el.commentList.replaceChildren(); el.commentMarkers.replaceChildren(); commentButtons.length = 0; markerButtons.length = 0;
        for (const item of items) {
          const inRange = item.time <= state.duration;
          const button = doc.createElement('button'); button.type = 'button'; button.dataset.commentId = item.id;
          button.className = 'comment-item'; button.textContent = formatTime(item.time) + '  ' + item.text + (item.drawingId ? '  ◇圈画' : '');
          button.title = inRange ? '定位到此标注' : '此标注超出当前视频时长，不能可靠定位';
          const row = doc.createElement('div'); row.className = 'comment-row'; row.appendChild(button);
          const actions = doc.createElement('div'); actions.className = 'comment-row-actions';
          const rowActions = item.localDrawing ? [['delete', '删除']] : [['edit', '修改'], ['delete', '删除']];
          if (typeof session?.beginDrawing === 'function') rowActions.push(['drawing', item.drawingId ? '编辑圈画' : '添加圈画']);
          if (item.drawingId) rowActions.push(['clear-drawing', '清除圈画']);
          for (const [action, label] of rowActions) {
            const control = doc.createElement('button'); control.type = 'button'; control.dataset.commentId = item.id;
            control.dataset.commentAction = action; control.textContent = label; control.title = label + '此标注';
            actions.appendChild(control); commentButtons.push({ button: control, inRange: true });
          }
          row.appendChild(actions); el.commentList.appendChild(row); commentButtons.push({ button, inRange });
          if (inRange && state.duration > 0) {
            const marker = doc.createElement('button'); marker.type = 'button'; marker.dataset.commentId = item.id;
            marker.className = 'comment-marker'; markerTimes.set(marker, item.time);
            marker.title = formatTime(item.time) + '  ' + item.text; marker.setAttribute('aria-label', marker.title);
            el.commentMarkers.appendChild(marker); markerButtons.push(marker);
          }
        }
        positionMarkers();
      }
      if (rebuilt || renderedInteractive !== ready) {
        for (const entry of commentButtons) set(entry.button, 'disabled', !ready || !entry.inRange);
        for (const button of markerButtons) set(button, 'disabled', !ready);
        renderedInteractive = ready;
      }
      set(el.commentAdd, 'disabled', !ready || !value || value.status !== 'ready' || state.state === 'seeking');
      if (value === renderedComments) return;
      const previous = renderedComments; renderedComments = value;
      set(el.commentStatus, 'textContent', draft?.message || value?.syncMessage || value?.message || (value?.status === 'ready' && !items.length ? '暂无标注' : ''));
      // Hiding a focused editor can synchronously move activeElement to body.
      const editorHadFocus = [el.commentText, el.commentSave, el.commentCancel].includes(doc.activeElement);
      set(el.commentEditor, 'hidden', !draft);
      if (!draft) {
        const saved = previous?.draft && ['saving', 'checking'].includes(previous.draft.status) && editorEpoch === state.epoch &&
          ['paused', 'playing'].includes(state.state) && value?.status === 'ready';
        if (saved && editorHadFocus &&
            (typeof doc.hasFocus !== 'function' || doc.hasFocus())) el.timeline.focus();
        editorId = null; editorEpoch = null; commentComposing = false; set(el.commentText, 'value', ''); return;
      }
      const editable = ['editing', 'failed'].includes(draft.status), deleting = draft.kind === 'delete';
      set(el.commentTime, 'textContent', Number.isFinite(draft.time) ? (editable ? '固定时间 ' : '原保存时间 ') + formatTime(draft.time) : '正在固定画面…');
      set(el.commentText, 'disabled', draft.status === 'pausing'); set(el.commentText, 'readOnly', !editable && !commentComposing || deleting);
      if (!commentComposing || editorId !== draft.id) set(el.commentText, 'value', draft.text);
      set(el.commentKeyboardHint, 'hidden', !editable || deleting);
      set(el.commentSave, 'textContent', draft.status === 'unknown' ? '核对保存结果' : deleting ? '确认删除' : '保存');
      set(el.commentSave, 'disabled', !editable && draft.status !== 'unknown');
      set(el.commentCancel, 'disabled', !['editing', 'failed', 'pausing', 'obsolete'].includes(draft.status));
      if (editable && editorId !== draft.id) { editorId = draft.id; editorEpoch = state.epoch; if (!deleting) el.commentText.focus(); }
    }
    function update(snapshot) {
      state = snapshot;
      if ([rateRequest, noteRequest, exportRequest].some(job => job && (job.epoch !== state.epoch || ['closed', 'closing'].includes(state.state)))) {
        rateRequest = noteRequest = exportRequest = null; transportBusy = false;
      }
      if (coverageEpoch !== state.epoch || !['paused', 'playing', 'seeking'].includes(state.state)) clearCoverage();
      coverageEpoch = state.epoch;
      selection.update();
      if (gesture && (gesture.epoch !== state.epoch || !interactive())) clearGesture();
      if (hintEpoch !== null && (hintEpoch !== state.epoch || !interactive() || state.state === 'playing')) clearHint();
      updateView();
      const ready = interactive(), time = state.playback && Number.isFinite(state.playback.time) ? state.playback.time : 0;
      set(el.play, 'disabled', !ready || !['paused', 'playing'].includes(state.state));
      set(el.previous, 'disabled', !ready); set(el.next, 'disabled', !ready);
      set(el.play, 'textContent', state.state === 'playing' ? '暂停' : '播放');
      attribute('aria-disabled', String(!ready));
      attribute('aria-valuenow', String(time)); attribute('aria-valuetext', formatTime(time));
      set(el.currentTime, 'textContent', formatTime(time)); set(el.duration, 'textContent', formatTime(state.duration));
      const ordinal = state.playback && state.playback.frameOrdinal, count = state.playback && state.playback.frameCount;
      set(el.frameReadout, 'textContent', Number.isSafeInteger(ordinal) && ordinal >= 0 && Number.isSafeInteger(count) && ordinal < count
        ? '第 ' + (ordinal + 1) + ' / ' + count + ' 帧' : '帧：—');
      set(el.sourceName, 'textContent', state.source ? state.source.name : '未载入视频');
      const messages = { empty: '等待素材', preparing: '正在准备视频', paused: '已暂停', playing: '播放中', seeking: '正在定位', error: '无法继续', closed: '已关闭' };
      const progress = state.progress && Number.isSafeInteger(state.progress.frames) ? '（' + state.progress.frames + ' 帧）' : '';
      const emptyMessage = state.state === 'empty' && state.progress && state.progress.message;
      const handover = state.state === 'preparing' && state.progress && state.progress.stage === 'handover' && state.progress.message;
      set(el.status, 'textContent', emptyMessage || handover || (state.state === 'closing' ? '正在关闭…' : messages[state.state] || '等待素材') + (state.state === 'preparing' ? progress : ''));
      set(el.error, 'hidden', !state.error); set(el.error, 'textContent', state.error ? state.error.message : '');
      set(el.retry, 'hidden', !session || state.state !== 'error');
      set(el.notice, 'hidden', ready || !!(state.playback && Number.isSafeInteger(state.playback.frameId)));
      set(el.notice, 'textContent', emptyMessage || handover || (state.state === 'closing' ? '正在关闭…' : state.state === 'preparing' ? '正在准备视频…' : state.state === 'error' ? '视频未就绪' : '在 Eagle 中单选 MP4 后打开插件'));
      if (!gesture) thumb(time);
      if (hintEpoch !== null) hint(time); // Includes final release settlement; only actual submitted frame time.
      updateComments();
      updateExports();
      updateMemorySettings();
      updateTransport();
      if (drawingUI) drawingUI.update(state);
      const hideStrip = state.interactionSettings?.showCacheStrip === false;
      if (el.decodedCache.hidden !== hideStrip) { set(el.decodedCache, 'hidden', hideStrip); coverageKey = null; }
    }
    drawingUI = drawingAPI.createDrawingUI({ document: doc, window: win, getSession: () => session, getState: () => state,
      canBegin: () => shortcutReady() && !transportBusy && state.exportState?.status !== 'unknown', isKey: letterKey });
    return { canvas: el.picture, confirmDrawingExit: () => drawingUI.confirmExit(), bindSession(value) {
      if (session !== value) {
        drawingUI.reset();
        rateRequest = noteRequest = exportRequest = null; transportBusy = false;
        selection.destroy();
        if (session && typeof session.setCommentsVisible === 'function') session.setCommentsVisible(false);
      }
      session = value; timelineWidth = null; rulerKey = null; coverageKey = null; coverageSize = null;
      update(state); commentsVisibility(); refreshMemory(); refreshCoverage();
      if (memoryTimer === null && typeof win.setInterval === 'function') memoryTimer = win.setInterval(refreshMemory, 500);
      if (coverageTimer === null && typeof win.setInterval === 'function') coverageTimer = win.setInterval(refreshCoverage, 50);
    }, update,
      destroy() {
        drawingUI.destroy();
        rateRequest = noteRequest = exportRequest = null; transportBusy = false;
        if (session && typeof session.setCommentsVisible === 'function') session.setCommentsVisible(false);
        if (memoryTimer !== null) { win.clearInterval(memoryTimer); memoryTimer = null; }
        if (coverageTimer !== null) { win.clearInterval(coverageTimer); coverageTimer = null; }
        selection.destroy(); clearGesture(); listeners.forEach(([target, type, fn, settings]) => target.removeEventListener(type, fn, settings)); session = null; refreshMemory(); clearCoverage();
      } };
  }
  return { createUI, formatTime, pointerTime, spaceAllowed };
});
