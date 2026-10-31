/* UI sends operations only to the session; it never reads Eagle or files. */
(function (root, factory) {
  'use strict';
  // Eagle exposes CommonJS in a Window, but its require is rooted in the host.
  // Page scripts must use the helper already loaded by index.html instead.
  const view = typeof window === 'object' && window ? window : root && root.document ? root : null;
  const api = factory(view ? view.EVALoopSelection : require('./loop-selection.js'),
    view ? view.EVATimelineView : require('./timeline-view.js'), view ? view.EVAPlayer : require('./player.js'),
    view ? view.EVADrawingUI : require('./drawing-ui.js'), view ? view.EVAScreenGestureUI : require('./screen-gesture-ui.js'),
    view ? view.EVAContextWheel : require('./context-wheel.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (view) view.EVAUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (selectionAPI, timelineAPI, playerAPI, drawingAPI, screenGestureAPI, contextAPI) {
  'use strict';
  function formatTime(seconds) {
    const milliseconds = Math.max(0, Math.floor((Number(seconds) || 0) * 1000 + .00001));
    return Math.floor(milliseconds / 60000) + ':' + String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0') + '.' + String(milliseconds % 1000).padStart(3, '0');
  }
  const pointerTime = (x, rect, range) => timelineAPI.timeAt(x, rect, range);
  function previewChoices(preview) {
    const all = ['720p', '1080p', '1440p', '2160p'];
    if (!preview || !(preview.sourceWidth > 0) || !(preview.sourceHeight > 0)) return all.map(value => ({ value, original: false }));
    const sar = String(preview.sampleAspectRatio || '1:1').split(':').map(Number), ratio = sar.length === 2 && sar.every(n => n > 0 && Number.isFinite(n)) ? sar[0] / sar[1] : 1;
    let w = preview.sourceWidth * ratio, h = preview.sourceHeight;
    if (Math.abs(preview.rotation % 180) === 90) [w, h] = [h, w];
    const result = []; let previous = '';
    for (const value of all) {
      const [long, short] = value === '2160p' ? [3840,2160] : value === '1440p' ? [2560, 1440] : value === '1080p' ? [1920, 1080] : [1280, 720];
      const scale = Math.min(1, (w < h ? short : long) / w, (w < h ? long : short) / h);
      const key = Math.floor(w * scale + 1e-8) + ':' + Math.floor(h * scale + 1e-8);
      if (key !== previous) result.push({ value, original: ratio === 1 && scale === 1 });
      previous = key;
    }
    return result;
  }
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
    doc.querySelector?.('[data-eva-closing]')?.remove();
    let closingSurface = null;
    const ids = ['screen', 'picture', 'notice', 'timeline', 'progress', 'thumb', 'timeHint', 'play', 'previous', 'next', 'currentTime', 'duration', 'frameReadout', 'sourceName', 'memoryUsage', 'status', 'error', 'retry',
      'commentMarkers', 'commentList', 'commentStatus', 'commentAdd', 'commentShade', 'commentEditor', 'commentTime', 'commentChoice', 'commentText', 'commentSave', 'commentCancel', 'commentKeyboardHint', 'commentDraftPreview', 'commentEditorStatus',
      'memoryMiB', 'memoryApply', 'memoryAllowance', 'memoryStatus', 'cacheClearOther', 'cacheClearStatus', 'qualitySelect', 'previewQuality',
      'forwardPredecode', 'decodedCache', 'cacheStatus', 'playbackRate', 'loopSelect', 'loopCancel', 'loopEnabled', 'loopRange',
      'loopBand', 'loopHandleStart', 'loopHandleEnd', 'loopHelp', 'timeRuler', 'wheelFrames', 'showCacheStrip', 'rateStep', 'customPlaybackRate', 'drawingFadeSeconds', 'drawingToolbar',
      'exportDestination', 'exportFolder', 'exportFolderArea', 'exportFolderRefresh', 'exportFrame', 'exportClip', 'exportCancel', 'exportCheck', 'exportStatus'];
    const el = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
    if (ids.some(id => !el[id])) throw new Error('播放器界面缺少必要元素。');
    // New controls are optional for older embedded pages and DOM fixtures.
    el.playbackBackend = doc.getElementById('playbackBackend');
    const codecControls=['proxyDiskGiB'].map(id=>({id,el:doc.getElementById(id),shown:null})).filter(c=>c.el?.tagName==='SELECT');
    el.showProxyStrip = doc.getElementById('showProxyStrip');
    for (const id of ['autoProxy', 'gpuDrawing', 'gpuAcceleration', 'proxyGenerate', 'proxyCancel', 'proxyState']) el[id] = doc.getElementById(id);
    const backendControl = !!el.playbackBackend && String(el.playbackBackend.tagName).toUpperCase() === 'SELECT';
    let session = null, state = { state: 'empty', duration: 0 }, gesture = null, hintEpoch = null, hintGeometry = null, lastRequestedTime = 0;
    let seekIntent = null;
    let viewRange = { start: 0, end: 0, focused: false }, timelineWidth = null, rulerKey = null;
    let rateRequest = null, noteRequest = null, exportRequest = null;
    let drawingUI = null, screenUI = null, contextUI = null, shellUI = null;
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
    let coverageText = '';
    const coverageContext = typeof el.decodedCache.getContext === 'function' ? el.decodedCache.getContext('2d') : null;
    function proxyLabel(value) {
      if (!value) return '';
      if (value.stage === 'complete') return '整片代理已就绪';
      if (value.status === 'cleaning') return value.message || '正在回收未完成的代理';
      if (value.stage === 'budget') return value.message || '代理磁盘额度不足，继续播放原片';
      if (value.stage === 'error') return '后台准备失败' + (value.error ? '：' + String(value.error.message || value.error).slice(0, 160) : '');
      if (value.stage === 'cancelled') return '代理生成已取消';
      if (value.stage !== 'preparing') return '';
      const message = typeof value.message === 'string' ? value.message.trim().slice(0, 80) : '';
      if (value.status === 'queued') return message || '整片代理等待启动';
      if (value.status === 'checking') return message || '正在检查整片代理';
      if (value.status === 'validating') {
        const phases = { frames: '正在逐帧核验', 'source-hash': '正在校验源视频', 'proxy-hash': '正在校验代理文件', publish: '正在发布整片代理' };
        const label = message || phases[value.validationPhase] || '正在校验完整代理';
        const done = value.validationDone, total = value.validationTotal;
        const counted = Number.isSafeInteger(done) && done >= 0 && Number.isSafeInteger(total) && total > 0 && done <= total;
        if (value.validationPhase === 'frames' && counted) return label + ' · ' + done + '/' + total + ' 帧';
        const fraction = Number.isFinite(value.validationProgress) ? value.validationProgress : counted ? done / total : null;
        const hashing = value.validationPhase === 'source-hash' || value.validationPhase === 'proxy-hash';
        return label + (hashing && fraction !== null ? ' · ' + Math.floor(Math.max(0, Math.min(1, fraction)) * 100) + '%' : '');
      }
      // Old embedded providers do not expose a status. Keep their compatible
      // label while current native encoding is explicitly a phase percentage.
      return (value.status === 'encoding' ? '代理编码 ' : '整片代理生成 ') + Math.floor(Math.max(0, Math.min(1, Number(value.progress) || 0)) * 100) + '%' +
        (Number.isFinite(value.speed) && value.speed > 0 ? ' · ' + value.speed.toFixed(1) + '倍速' : '') +
        (Number.isFinite(value.remainingSeconds) && value.remainingSeconds > 0 ? ' · 约' + Math.ceil(value.remainingSeconds) + '秒' : '');
    }
    function updateCoverageStatus() {
      const value = session && state.playbackBackend !== 'jpeg' && !['empty', 'closing', 'closed'].includes(state.state) ? state.proxyPreparation : null;
      set(el.cacheStatus, 'textContent', [coverageText, proxyLabel(value)].filter(Boolean).join(' · '));
    }
    let proxyToastKey = null, proxyToastTimer = null;
    function updateProxyMessage() {
      const node = el.proxyState; if (!node) return;
      if(state.playbackBackend==='jpeg'&&state.state==='preparing'){
        if(proxyToastTimer!==null)win.clearTimeout(proxyToastTimer);proxyToastTimer=null;
        node.setAttribute('data-persistent','true');proxyToastKey=state.epoch+':jpeg';node.removeAttribute?.('data-faded');node.hidden=false;
        const p=state.progress||{},labels={hash:'校验视频',analyze:'读取视频信息',cache:'检查已有缓存',decode:'生成JPEG序列',verify:'核验JPEG序列','player-initialize':'准备画面与声音'};
        const label=p.message||labels[p.stage]||'准备JPEG序列';
        set(node,'textContent',label+(Number.isSafeInteger(p.frames)?' · 已准备'+p.frames+'帧':''));return;
      }
      const value = state.playbackBackend !== 'jpeg' ? state.proxyPreparation : null;
      const stage = value?.stage, active = ['paused', 'playing', 'seeking'].includes(state.state);
      if (!active || !['preparing', 'complete', 'cancelled', 'error', 'budget'].includes(stage)) {
        if (proxyToastTimer !== null) win.clearTimeout(proxyToastTimer); proxyToastTimer = null; proxyToastKey = null; node.hidden = true; return;
      }
      const transient = ['complete', 'cancelled', 'budget'].includes(stage) || stage === 'error' && value.cleanupComplete === true;
      node.setAttribute('data-persistent',String(!transient));
      const key = state.epoch + ':' + stage + ':' + !!value.cleanupComplete + ':' + (stage === 'preparing' ? '' : value.message || '');
      if (key !== proxyToastKey) {
        if (proxyToastTimer !== null) win.clearTimeout(proxyToastTimer); proxyToastTimer = null;
        proxyToastKey = key; node.removeAttribute?.('data-faded');
        shellUI?.transient?.('proxyState');
        if (transient) { proxyToastTimer = win.setTimeout(() => { node.setAttribute('data-faded', 'true'); proxyToastTimer = null; }, 2200); }
      }
      node.hidden = false;
      set(node, 'textContent', proxyLabel(value));
    }
    function clearCoverage() {
      if (coverageKey !== 'empty' && coverageContext) coverageContext.clearRect(0, 0, el.decodedCache.width || 1, el.decodedCache.height || 3);
      coverageKey = 'empty'; coverageText = ''; updateCoverageStatus();
    }
    function refreshCoverage() {
      // Hidden diagnostics must not enumerate/sort the RAM cache every 50ms.
      if(state.interactionSettings?.showCacheStrip===false){clearCoverage();return;}
      const value = session && typeof session.cacheCoverageSnapshot === 'function' ? session.cacheCoverageSnapshot() : null;
      if (!value || value.sessionEpoch !== state.epoch || !(value.duration > 0) || !['paused', 'playing', 'seeking'].includes(state.state)) { clearCoverage(); return; }
      const text = value.issue ? '后台准备暂停，请重开视频重试' : value.decodedFrames === value.totalFrames ? '整段已解压' :
        (value.enabled ? value.phase === 'budget' ? '已保留操作余量' : '后台准备附近画面' : '按需缓存') + ' · ' + value.decodedFrames + ' / ' + value.totalFrames + ' 帧';
      coverageText = text; updateCoverageStatus();
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
    const previewDisabled = new Map();
    function blockPreviewSave(event) {
      if (!previewActive()) return;
      const target = event.target?.closest?.('button') || event.target;
      const saveClick = event.type === 'click' && ['drawingSave', 'drawingExitSave', 'commentSave'].some(id => target === doc.getElementById(id));
      const saveKey = event.type === 'keydown' && !event.isComposing && event.keyCode !== 229 &&
        (letterKey(event, 'D') || letterKey(event, 'N') || ['Enter', 'NumpadEnter'].includes(event.code || event.key) && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey);
      if (saveClick || saveKey) { event.preventDefault(); event.stopImmediatePropagation?.(); event.stopPropagation?.(); }
    }
    on(win, 'click', blockPreviewSave, true); on(win, 'keydown', blockPreviewSave, true);
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
    let memoryApplySerial = 0, memoryBusy = false, toolbarBusy = false, cleaning = false, shownMemory = null, shownTier = '', shownQuality = null, shownPredecode = null, shownWheel = null, shownStrip = null, shownProxyStrip = null, shownRateStep = null, shownFade = null, shownBackend = null, shownAutoProxy = null, shownGpuDrawing = null;
    let messageRevision=0;
    function settingsMessage(node,text,persistent=false){node.setAttribute('data-notice-revision',String(++messageRevision));set(node,'textContent',text);node.setAttribute('data-persistent',String(persistent));node.removeAttribute?.('data-faded');shellUI?.update(state);}
    function updateMemorySettings() {
      const memory = state.memorySettings;
      const disabled = !session || !memory || (memoryBusy && state.state !== 'preparing') || cleaning || transportBusy || !!noteRequest || !!exportRequest || ['closing', 'closed'].includes(state.state) || !!state.comments?.draft || !!state.drawings?.draft || selection.snapshot().editing;
      set(el.memoryApply, 'disabled', disabled); set(el.memoryMiB, 'disabled', disabled); set(el.qualitySelect, 'disabled', disabled);
      set(el.forwardPredecode, 'disabled', disabled);
      if (backendControl) {
        set(el.playbackBackend, 'disabled', disabled);
        const backend = state.playbackBackend === 'jpeg' ? 'jpeg' : 'proxy';
        if (shownBackend !== backend) { shownBackend = backend; set(el.playbackBackend, 'value', backend); }
      }
      for(const c of codecControls){set(c.el,'disabled',disabled);const value=state[c.id]||(c.id==='proxyDiskGiB'?5:c.id==='proxyEncoder'?'cpu':'prefer-hardware');if(c.shown!==value){c.shown=value;set(c.el,'value',value);}}
      const native = state.playbackBackend === 'proxy', proxyStage = state.proxyPreparation?.stage;
      if (el.autoProxy) { set(el.autoProxy, 'disabled', disabled || !native); if (shownAutoProxy !== (state.autoProxy !== false)) { shownAutoProxy = state.autoProxy !== false; set(el.autoProxy, 'checked', shownAutoProxy); } }
      if(el.gpuAcceleration?.type==='checkbox'){set(el.gpuAcceleration,'disabled',disabled);const value=state.gpuAcceleration!==false;if(el.gpuAcceleration._shown!==value){el.gpuAcceleration._shown=value;set(el.gpuAcceleration,'checked',value);}}
      if (el.gpuDrawing) { set(el.gpuDrawing, 'disabled', disabled || !native); if (shownGpuDrawing !== (state.gpuDrawing !== false)) { shownGpuDrawing = state.gpuDrawing !== false; set(el.gpuDrawing, 'checked', shownGpuDrawing); } }
      if (el.proxyGenerate) set(el.proxyGenerate, 'disabled', disabled || !native || !['paused', 'playing', 'seeking'].includes(state.state) || ['preparing', 'complete'].includes(proxyStage));
      if (el.proxyCancel) set(el.proxyCancel, 'disabled', disabled || !native || proxyStage !== 'preparing');
      set(el.wheelFrames, 'disabled', disabled); set(el.showCacheStrip, 'disabled', disabled); if (el.showProxyStrip) set(el.showProxyStrip, 'disabled', disabled);
      set(el.rateStep, 'disabled', disabled); set(el.drawingFadeSeconds, 'disabled', disabled);
      set(el.cacheClearOther, 'disabled', disabled || !['paused', 'playing', 'seeking'].includes(state.state));
      if (memory && memory !== shownMemory) {
        shownMemory = memory; shownTier = String(memory.ramMiB);
        set(el.memoryMiB, 'value', shownTier);
        set(el.memoryAllowance, 'textContent', '缓存上限 ' + (memory.ramBytes / 1048576).toFixed(0) + ' MB（不含程序额外占用）' +
          (memory.legacyConverted ? '；旧百分比已换算，应用后保存。' : ''));
      }
      const preview = state.preview?.width > 0 && state.preview?.height > 0 ? state.preview : null;
      const choices = previewChoices(preview), desiredQuality = state.previewQuality || '720p';
      const effectiveQuality = choices.some(n => n.value === desiredQuality) ? desiredQuality : choices[choices.length - 1].value;
      const qualityKey = desiredQuality + ':' + choices.map(n => n.value).join(',');
      if (shownQuality !== qualityKey) { shownQuality = qualityKey; set(el.qualitySelect, 'value', effectiveQuality); }
      if (shownPredecode !== !!state.forwardPredecode) {
        shownPredecode = !!state.forwardPredecode; set(el.forwardPredecode, 'checked', true);
      }
      const interaction = state.interactionSettings || { wheelFrames: 1, showCacheStrip: true };
      set(el.drawingToolbar, 'checked', interaction.drawingToolbar === true);
      set(el.drawingToolbar, 'disabled', !session || !session.setDrawingToolbar || toolbarBusy || state.state === 'closed');
      if (shownWheel !== interaction.wheelFrames) { shownWheel = interaction.wheelFrames; set(el.wheelFrames, 'value', String(shownWheel)); }
      if (el.showProxyStrip && shownProxyStrip !== !!interaction.showProxyStrip) { shownProxyStrip = !!interaction.showProxyStrip; set(el.showProxyStrip, 'checked', shownProxyStrip); }
      if (shownStrip !== interaction.showCacheStrip) { shownStrip = interaction.showCacheStrip; set(el.showCacheStrip, 'checked', shownStrip); }
      if (shownRateStep !== (interaction.rateStep ?? .1)) { shownRateStep = interaction.rateStep ?? .1; set(el.rateStep, 'value', String(shownRateStep)); }
      if (shownFade !== (interaction.drawingFadeSeconds ?? .25)) { shownFade = interaction.drawingFadeSeconds ?? .25; set(el.drawingFadeSeconds, 'value', String(shownFade)); }
      for (const option of Array.from(el.qualitySelect.options || [])) {
        const choice = choices.find(n => n.value === option.value);
        set(option, 'hidden', !choice); set(option, 'disabled', !choice);
        set(option, 'textContent', (option.value === '2160p' ? '4K UHD（2160p）' : option.value === '1440p' ? '2K（1440p）' : option.value) + (choice?.original ? '（原始分辨率）' : ''));
      }
      const displayedQuality = preview && choices.some(n => n.value === preview.quality) ? preview.quality : effectiveQuality;
      set(el.previewQuality, 'textContent', preview ? (displayedQuality === '2160p' ? '4K UHD（2160p）' : displayedQuality === '1440p' ? '2K（1440p）' : displayedQuality) + ' 预览 · ' + preview.width + ' × ' + preview.height +
        (preview.originalResolution ? '（原始分辨率）' : '') : (state.previewQuality || '720p') + ' 预览');
    }
    on(el.drawingToolbar, 'change', async () => {
      if (el.drawingToolbar.disabled || !session?.setDrawingToolbar) return;
      const active = session, visible = el.drawingToolbar.checked; toolbarBusy = true;
      try { await active.setDrawingToolbar(visible); if (session === active) settingsMessage(el.memoryStatus, '工具条设置已保存。'); }
      catch (failure) { if (session === active) settingsMessage(el.memoryStatus, failure.message || String(failure),true); }
      finally { toolbarBusy = false; updateMemorySettings(); }
    });
    on(el.memoryApply, 'click', async () => {
      if (el.memoryApply.disabled || !session || typeof session.setPlaybackSettings !== 'function' && typeof session.setMemoryMiB !== 'function') return;
      const active = session, applySerial = ++memoryApplySerial, ramMiB = Number(el.memoryMiB.value);
      memoryBusy = true; settingsMessage(el.memoryStatus, ''); updateMemorySettings();
      try { const result = typeof active.setPlaybackSettings === 'function'
          ? await active.setPlaybackSettings({ ramMiB, previewQuality: el.qualitySelect.value, forwardPredecode: true,
            proxyDiskGiB: Number(doc.getElementById('proxyDiskGiB')?.value||state.proxyDiskGiB||5),wheelFrames: Number(el.wheelFrames.value), showCacheStrip: !!el.showCacheStrip.checked, showProxyStrip: el.showProxyStrip ? !!el.showProxyStrip.checked : !!state.interactionSettings?.showProxyStrip, rateStep: Number(el.rateStep.value), drawingFadeSeconds: Number(el.drawingFadeSeconds.value),
            ...Object.fromEntries(codecControls.map(c=>[c.id,c.id==='proxyDiskGiB'?Number(c.el.value):c.el.value])), ...(backendControl ? { playbackBackend: el.playbackBackend.value } : {}), ...(el.autoProxy ? { autoProxy: !!el.autoProxy.checked } : {}), ...(el.gpuAcceleration?.type==='checkbox'?{gpuAcceleration:!!el.gpuAcceleration.checked}:{}) }) : await active.setMemoryMiB(ramMiB);
        if (session !== active || applySerial !== memoryApplySerial) return;
        settingsMessage(el.memoryStatus, result.status === 'error' ? '设置已保存，视频准备失败；可调整画质或内存后重试。' :
          result.status === 'superseded' ? '操作已被素材切换或关闭替代。' : '设置已保存。');
      } catch (failure) { if (session === active && applySerial === memoryApplySerial) settingsMessage(el.memoryStatus, String(failure.message || failure),true); }
      finally { if (applySerial === memoryApplySerial) memoryBusy = false; if (session === active && applySerial === memoryApplySerial) { shownMemory = null; shownQuality = null; shownPredecode = null; shownWheel = null; shownStrip = null; shownProxyStrip = null; shownRateStep = null; shownFade = null; shownBackend = null; codecControls.forEach(c=>c.shown=null); updateMemorySettings(); } }
    });
    if (el.proxyGenerate) on(el.proxyGenerate, 'click', () => { if (!el.proxyGenerate.disabled && session?.startProxy) invoke(() => session.startProxy()); });
    if (el.proxyCancel) on(el.proxyCancel, 'click', () => { if (!el.proxyCancel.disabled && session?.cancelProxy) invoke(() => session.cancelProxy()); });
    on(el.cacheClearOther, 'click', async () => {
      if (el.cacheClearOther.disabled || !session || typeof session.clearOtherCaches !== 'function') return;
      const active = session; cleaning = true; settingsMessage(el.cacheClearStatus, '正在清理，保留当前及正在使用的缓存…'); updateMemorySettings();
      try { if(typeof win.requestAnimationFrame==='function')await new Promise(resolve=>win.requestAnimationFrame(resolve));const result = await active.clearOtherCaches(); if (session !== active) return;
        settingsMessage(el.cacheClearStatus, result.status === 'superseded' ? '操作已被素材切换或关闭替代。' : result.message ? result.message :
          '已清除' + result.cleared + '个缓存，释放' + (result.freedBytes / 1048576).toFixed(1) + ' MB；当前及正在使用的缓存保留。');
      } catch (failure) { if (session === active) settingsMessage(el.cacheClearStatus, String(failure.message || failure),true); }
      finally { cleaning = false; if (session === active) updateMemorySettings(); }
    });
    function layoutComment() {
      if (el.commentEditor.hidden) return;
      const r = el.screen.getBoundingClientRect(), w = Number(el.picture.width), h = Number(el.picture.height);
      if (!(r.width > 0 && r.height > 0 && w > 0 && h > 0)) return;
      const scale = Math.min(r.width / w, r.height / h), imageWidth = w * scale, imageHeight = h * scale;
      const inset = Math.min(56, Math.max(12, imageHeight * .08));
      set(el.commentEditor.style, 'bottom', (r.height - imageHeight) / 2 + inset + 'px');
      set(el.commentEditor.style, 'maxWidth', Math.max(1, imageWidth - 24) + 'px');
      set(el.commentEditor.style, 'maxHeight', Math.max(1, imageHeight - inset - 12) + 'px');
    }
    on(win, 'resize', () => { coverageKey = null; coverageSize = null; timelineWidth = null; rulerKey = null; updateTransport(); refreshCoverage(); layoutComment(); });
    const interactive = () => !!session && !shellUI?.blocked?.() && !noteRequest && !exportRequest && !state.comments?.draft && !state.drawings?.draft && state.exportState?.status !== 'busy' && ['paused', 'playing', 'seeking'].includes(state.state);
    const invoke = fn => {
      try { Promise.resolve(fn()).catch(() => {}); } catch (_) { /* session publishes operation errors */ }
    };
    const previewActive = () => state.preview?.active === true;
    const cursorTime = () => seekIntent && seekIntent.epoch === state.epoch ? seekIntent.time
      : state.playback?.pendingTargets && Number.isFinite(state.playback.targetTime) ? state.playback.targetTime : state.playback?.time || 0;
    function settleIntent() {
      if (seekIntent?.completed && !gesture && !screenUI?.active() && !previewActive() &&
          state.state !== 'seeking' && !(state.playback?.pendingTargets > 0)) seekIntent = null;
    }
    function requestSeek(time, settings) {
      if (!session || !Number.isFinite(time)) return;
      const job = seekIntent = { time, epoch: state.epoch, session, completed: false };
      // The cursor is a UI intent, never a replacement for the submitted frame.
      // Do not await image preparation in a pointer handler or serialize moves.
      thumb(time);
      try {
        Promise.resolve(job.session.seek(time, settings)).then(result => {
          if (seekIntent !== job || session !== job.session || state.epoch !== job.epoch ||
              ['superseded', 'failed', 'error', 'ignored'].includes(result?.status)) return;
          job.completed = true; settleIntent(); thumb(cursorTime()); updateTransport();
        }, () => {});
      } catch (_) { /* Session publishes failures; retain the latest intent. */ }
    }
    const selection = selectionAPI.createSelection({ getSession: () => session, getState: () => state,
      setTimeout: (fn, ms) => (win.setTimeout || setTimeout).call(win, fn, ms), clearTimeout: id => (win.clearTimeout || clearTimeout).call(win, id),
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
        if (!gesture) thumb(cursorTime());
        if (hintEpoch !== null) hint(state.playback?.time || 0);
        refreshCoverage();
      }
      const key = [viewRange.start, viewRange.end, viewRange.focused, timelineWidth].join(':');
      if (rulerKey === key) return;
      rulerKey = key;
      if (shellUI) return;
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
      return interactive() && !previewActive() && !seekIntent && ['paused', 'playing'].includes(state.state) && !gesture && !memoryBusy && !cleaning &&
        !selection.snapshot().editing && !selection.snapshot().busy;
    }
    async function requestRate(value, direction, feedback = false) {
      if ((!shortcutReady() && !rateRequest) || transportBusy && !rateRequest) return;
      const base = rateRequest ? rateRequest.target : state.playback?.transport?.rate || 1;
      const target = direction === undefined ? value : playerAPI.steppedRate(base, direction, state.interactionSettings?.rateStep ?? .1);
      if (!playerAPI.validRate(target)) return;
      if (feedback) screenUI?.hint(target, 'keyboard');
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
      set(el.play, 'disabled', !interactive() || editing.editing || editing.busy || !(['paused', 'playing'].includes(state.state) || state.playback?.buffering));
      set(el.commentAdd, 'disabled', !interactive() || previewActive() || !!seekIntent || editing.editing || editing.busy || !!gesture || state.comments?.status !== 'ready' || state.playback?.frameHeld === true);
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
        (!start ? '在画面或时间轴拖动起点，再拖动终点。' : !endPoint ? '在画面或时间轴拖动终点。' : '画面横拖或时间轴拖动调整端点；【／】微调当前端点。') +
        ' 右键左/右选头尾；' + (editing.mode === 'hold' ? '松R或右键短点结束' : 'R或右键短点结束') + '，未齐取消、同帧清除；Esc取消。' : '');
      set(el.loopHelp, 'textContent', help); set(el.loopHelp, 'hidden', !help); loopAttribute(el.loopHelp, 'data-fading', String(!!editing.messageFading));
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
      else requestSeek(time, { kind: final ? 'release' : 'rapid', final: !!final, inputAt });
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
        point: editing.editing ? handle || (editing.controlled ? editing.active : selection.nextPoint() || editing.active) : null };
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
    function step(delta) { if (interactive() && !gesture && !selection.snapshot().busy) { seekIntent = null; clearHint(); if (!selection.snapshot().editing || !selection.step(delta)) invoke(() => session.step(delta)); } }
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
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && contextUI?.active()) return;
      if (event.key === 'Escape' && state.comments?.draft) {
        if (!commentComposing && !event.isComposing && event.keyCode !== 229 && now() - commentCompositionEnd >= 50) { event.preventDefault(); invoke(() => session.cancelComment()); }
        return;
      }
      if (event.key === 'Escape' && selection.snapshot().editing) { event.preventDefault(); clearGesture(); selection.cancel(); return; }
      if (letterKey(event, 'R')) { if (interactive() && !gesture) { event.preventDefault(); selection.keyDown(); } return; }
      if (letterKey(event, 'L')) { if (interactive() && !gesture) { event.preventDefault(); selection.toggleLoop(); } return; }
      for (const key of ['Z', 'X', 'C']) if (letterKey(event, key)) {
        if (shortcutReady()) { event.preventDefault(); requestRate(key === 'Z' ? 1 : undefined, key === 'Z' ? undefined : key === 'X' ? -1 : 1, true); }
        return;
      }
      if (letterKey(event, 'N')) { if (shortcutReady() && !transportBusy && !el.commentAdd.disabled) { event.preventDefault(); beginNote(); } return; }
      for (const [key, kind] of [['S', 'frame'], ['E', 'clip']]) if (letterKey(event, key)) {
        if (shellUI) return;
        if (shortcutReady() && !transportBusy) { event.preventDefault(); exportSelected(kind); } return;
      }
      const delta = frameStepKey(event);
      if (delta) {
        if (interactive() && !gesture) { event.preventDefault(); step(delta); }
        return;
      }
      if (!spaceAllowed(event, el.timeline)) return;
      event.preventDefault(); if (interactive() && !gesture && !selection.snapshot().editing && !selection.snapshot().busy && (['paused', 'playing'].includes(state.state) || state.playback?.buffering)) { clearHint(); invoke(() => session.toggle()); }
    });
    on(win, 'keyup', event => {
      if (event.code === 'KeyR' || String(event.key || '').toLowerCase() === 'r') { if (selection.snapshot().editing && gesture) end(null); if (selection.snapshot().editing && screenUI?.active()) screenUI.finish(); selection.keyUp(); }
    });
    on(el.timeline, 'keydown', event => {
      if (!interactive() || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
    });
    let renderedItems = null, renderedDuration = null, renderedComments = null, renderedInteractive = null, editorId = null, editorEpoch = null;
    let selectedComment = null;
    const commentRows = [];
    function showCommentActions(id) {
      selectedComment = id;
      for (const entry of commentRows) {
        entry.actions.hidden = entry.id !== id;
        entry.row.dataset.selected = String(entry.id === id);
        entry.button.setAttribute('aria-expanded', String(entry.id === id));
      }
    }
    let commentComposing = false, commentCompositionEnd = -Infinity;
    const commentButtons = [];
    function seekComment(event) {
      const button = event.target && event.target.closest && event.target.closest('button[data-comment-id]');
      if (button && !button.disabled && interactive() && !selection.snapshot().editing) {
        seekIntent = null;
        clearHint();
        showCommentActions(button.dataset.commentId);
        const action = button.dataset.commentAction;
        const item = state.comments?.items.find(n => n.id === button.dataset.commentId);
        if (action === 'drawing') { drawingUI.begin(button.dataset.commentId); return; }
        if (action === 'clear-drawing') { invoke(() => session.clearDrawing(item.drawingId)); return; }
        if (action === 'edit' && item?.localDrawing) { invoke(async () => { await session.seekComment(item.id); return session.beginComment(); }); return; }
        if (action === 'delete' && item?.localDrawing) { drawingUI.begin(item.id, 'delete'); return; }
        if (!action && item?.time > state.duration) return; // Still expose management of an out-of-range note.
        invoke(() => action === 'edit' ? session.editComment(button.dataset.commentId)
          : action === 'delete' ? session.deleteComment(button.dataset.commentId) : session.seekComment(button.dataset.commentId));
      }
    }
    on(el.commentMarkers, 'click', seekComment); on(el.commentList, 'click', seekComment);
    on(win, 'pointerdown', event => {
      if (selectedComment && !state.comments?.draft && !state.drawings?.draft && !event.target?.closest?.('.comment-row')) showCommentActions(null);
    });
    async function beginNote() {
      if (shellUI) { drawingUI.begin(); return; }
      if (!shortcutReady() || transportBusy || el.commentAdd.disabled) return;
      const job = noteRequest = { session, epoch: state.epoch }; update(state);
      try { const pending = job.session.beginComment(selectedComment); if (pending && typeof pending.then === 'function') await pending; }
      catch (_) { /* Session publishes proposal failures. */ }
      finally { if (noteRequest === job) { noteRequest = null; update(state); } }
    }
    on(el.commentAdd, 'click', beginNote);
    on(el.commentChoice, 'change', () => { if (session && el.commentChoice.value) invoke(() => session.chooseComment(el.commentChoice.value)); });
    on(el.commentText, 'input', () => { if (session) invoke(() => session.setCommentText(el.commentText.value)); });
    on(el.commentText, 'compositionstart', () => { commentComposing = true; });
    on(el.commentText, 'compositionend', () => {
      commentComposing = false; commentCompositionEnd = now();
      if (session) invoke(() => session.setCommentText(el.commentText.value));
    });
    on(el.commentShade, 'pointerdown', event => { if (event.button === 0) { event.preventDefault(); event.stopPropagation?.(); } });
    on(el.commentShade, 'wheel', event => event.preventDefault(), {passive:false});
    function saveNote() {
      const draft = state.comments?.draft;
      if (!session || previewActive() || seekIntent || !draft || commentComposing || now() - commentCompositionEnd < 50 || draft.kind === 'delete') return;
      if (draft.status === 'unknown') return invoke(() => session.checkComment());
      if (['editing', 'failed'].includes(draft.status)) return invoke(() => { session.setCommentText(el.commentText.value); return session.saveComment(); });
    }
    on(el.commentText, 'keydown', event => {
      if (event.key !== 'Enter' && event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
      const draft = state.comments?.draft;
      if (commentComposing || event.isComposing || event.keyCode === 229 || now() - commentCompositionEnd < 50) return;
      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || !session || !draft || draft.kind === 'delete' ||
          !['editing', 'failed'].includes(draft.status)) return;
      event.preventDefault();
      if (event.repeat) return;
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      saveNote();
    });
    on(el.commentSave, 'click', () => { if (session && !previewActive() && !seekIntent) invoke(() => state.comments?.draft?.status === 'unknown' ? session.checkComment() : session.saveComment()); });
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
        el.commentList.replaceChildren(); el.commentMarkers.replaceChildren(); commentButtons.length = 0; markerButtons.length = 0; commentRows.length = 0;
        if (!items.some(item => item.id === selectedComment)) selectedComment = null;
        for (const item of items) {
          const inRange = item.time <= state.duration;
          const button = doc.createElement('button'); button.type = 'button'; button.dataset.commentId = item.id;
          button.className = 'comment-item'; button.textContent = formatTime(item.time) + '  ' + item.text;
          if (item.drawingId) {
            const badge = doc.createElementNS ? doc.createElementNS('http://www.w3.org/2000/svg', 'svg') : doc.createElement('span');
            badge.setAttribute('class', 'drawing-badge'); badge.setAttribute('viewBox', '0 0 24 24'); badge.setAttribute('aria-label', '含圈画');
            if (doc.createElementNS) { const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'm5 17-1 4 4-1L20 8l-3-3L5 17Zm10-10 3 3'); badge.appendChild(path); }
            button.appendChild(badge);
          }
          button.title = inRange ? '定位到此标注并展开操作' : '此标注超出当前时长，点击展开管理，不定位视频';
          const row = doc.createElement('div'); row.className = 'comment-row'; row.appendChild(button);
          const actions = doc.createElement('div'); actions.className = 'comment-row-actions';
          const rowActions = item.localDrawing ? [['edit', '添加文字说明'], ['delete', '清除圈画']] : [['edit', '修改文字'], ['delete', '删除文字']];
          if (typeof session?.beginDrawing === 'function') rowActions.push(['drawing', item.drawingId ? '编辑圈画' : '添加圈画']);
          if (item.drawingId) rowActions.push(['clear-drawing', '清除圈画']);
          for (const [action, label] of rowActions) {
            const control = doc.createElement('button'); control.type = 'button'; control.dataset.commentId = item.id;
            control.dataset.commentAction = action; control.textContent = label; control.title = label + '此标注';
            actions.appendChild(control); commentButtons.push({ button: control, inRange: true });
          }
          row.appendChild(actions); el.commentList.appendChild(row); commentButtons.push({ button, inRange: true });
          commentRows.push({ row, button, actions, id: item.id });
          if (inRange && state.duration > 0) {
            const marker = doc.createElement('button'); marker.type = 'button'; marker.dataset.commentId = item.id;
            marker.className = 'comment-marker'; markerTimes.set(marker, item.time);
            marker.title = formatTime(item.time) + '  ' + item.text; marker.setAttribute('aria-label', marker.title);
            el.commentMarkers.appendChild(marker); markerButtons.push(marker);
          }
        }
        positionMarkers();
        showCommentActions(selectedComment);
      }
      if (rebuilt || renderedInteractive !== ready) {
        for (const entry of commentButtons) set(entry.button, 'disabled', !ready || !entry.inRange);
        for (const button of markerButtons) set(button, 'disabled', !ready);
        renderedInteractive = ready;
      }
      set(el.commentAdd, 'disabled', !ready || !value || value.status !== 'ready' || state.state === 'seeking' || state.playback?.frameHeld === true);
      set(el.commentDraftPreview, 'hidden', !draft || draft.kind === 'delete' || !draft.text?.trim());
      set(el.commentDraftPreview, 'textContent', draft && draft.kind !== 'delete' ? formatTime(draft.time) + ' · 草稿\n' + (draft.text || '') : '');
      set(el.commentEditorStatus, 'textContent', draft?.message || '');
      if (value === renderedComments) return;
      const previous = renderedComments; renderedComments = value;
      set(el.commentStatus, 'textContent', draft?.message || value?.syncMessage || value?.message || '');
      // Hiding a focused editor can synchronously move activeElement to body.
      const editorHadFocus = [el.commentText, el.commentSave, el.commentCancel].includes(doc.activeElement);
      set(el.commentEditor, 'hidden', !draft);
      set(el.commentShade, 'hidden', !draft);
      if (draft && (editorId !== draft.id || editorEpoch !== state.epoch)) layoutComment();
      if (!draft) {
        const saved = previous?.draft && ['saving', 'checking'].includes(previous.draft.status) && editorEpoch === state.epoch &&
          ['paused', 'playing'].includes(state.state) && value?.status === 'ready';
        if (saved && editorHadFocus &&
            (typeof doc.hasFocus !== 'function' || doc.hasFocus())) el.timeline.focus();
        el.commentChoice.hidden = true; editorId = null; editorEpoch = null; commentComposing = false; set(el.commentText, 'value', ''); return;
      }
      const choosing = draft.status === 'choosing';
      set(el.commentChoice, 'hidden', !choosing);
      if (choosing && editorId !== draft.id) {
        el.commentChoice.replaceChildren(); const empty = doc.createElement('option'); empty.value = ''; empty.textContent = '选择要修改的文字'; el.commentChoice.appendChild(empty);
        for (const item of draft.choices) { const option = doc.createElement('option'); option.value = item.id; option.textContent = item.text; el.commentChoice.appendChild(option); }
        el.commentChoice.value = ''; el.commentChoice.focus();
      }
      const editable = ['editing', 'failed'].includes(draft.status), deleting = draft.kind === 'delete';
      set(el.commentSave, 'hidden', !deleting && draft.status !== 'unknown');
      set(el.commentCancel, 'hidden', !deleting && !['unknown', 'obsolete', 'choosing'].includes(draft.status));
      set(el.commentTime, 'textContent', Number.isFinite(draft.time) ? (editable ? '固定时间 ' : '原保存时间 ') + formatTime(draft.time) : '正在固定画面…');
      set(el.commentText, 'disabled', draft.status === 'pausing'); set(el.commentText, 'readOnly', !editable && !commentComposing || deleting);
      if (!commentComposing || editorId !== draft.id) set(el.commentText, 'value', draft.text);
      set(el.commentKeyboardHint, 'hidden', !editable || deleting);
      set(el.commentSave, 'textContent', draft.status === 'unknown' ? '核对保存结果' : deleting ? '确认删除' : '保存');
      set(el.commentSave, 'disabled', !editable && draft.status !== 'unknown');
      set(el.commentCancel, 'disabled', !['editing', 'failed', 'pausing', 'obsolete', 'choosing'].includes(draft.status));
      if (editable && editorId !== draft.id) { editorId = draft.id; editorEpoch = state.epoch; if (!deleting) el.commentText.focus(); }
    }
    function update(snapshot) {
      if (closingSurface) { closingSurface.textContent = snapshot.error?.message || ''; return; }
      if (state.epoch !== snapshot.epoch) showCommentActions(null);
      state = snapshot;
      if (!previewActive() && previewDisabled.size) { for (const [node, disabled] of previewDisabled) node.disabled = disabled; previewDisabled.clear(); }
      if (seekIntent && (seekIntent.epoch !== state.epoch || ['empty', 'preparing', 'closing', 'closed', 'error'].includes(state.state))) seekIntent = null;
      settleIntent();
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
      set(el.play, 'disabled', !ready || !(['paused', 'playing'].includes(state.state) || state.playback?.buffering));
      set(el.previous, 'disabled', !ready); set(el.next, 'disabled', !ready);
      set(el.play, 'textContent', state.state === 'playing' || state.playback?.buffering ? '暂停' : '播放');
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
      set(el.status, 'textContent', emptyMessage || handover || (state.playback?.buffering ? '正在缓冲画面，稍后自动继续…' : state.state === 'closing' ? '正在关闭…' : messages[state.state] || '等待素材') + (state.state === 'preparing' ? progress : ''));
      set(el.error, 'hidden', !state.error); set(el.error, 'textContent', state.error ? state.error.message : '');
      set(el.retry, 'hidden', !session || !['error','empty'].includes(state.state));
      set(el.retry, 'textContent', state.state==='empty'?'读取选中视频':'重试');
      set(el.notice, 'hidden', ready || !!(state.playback && Number.isSafeInteger(state.playback.frameId)));
      set(el.notice, 'textContent', emptyMessage || handover || (state.state === 'closing' ? '正在关闭…' : state.state === 'preparing' ? '正在准备视频…' : state.state === 'error' ? '视频未就绪' : '在 Eagle 中单选 MP4 后打开插件'));
      thumb(cursorTime());
      if (hintEpoch !== null) hint(time); // Includes final release settlement; only actual submitted frame time.
      updateComments();
      updateExports();
      updateMemorySettings();
      updateCoverageStatus();
      updateProxyMessage();
      updateTransport();
      if (drawingUI) drawingUI.update(state);
      if (previewActive()) {
        const layer = doc.getElementById('drawingLayer');
        if (layer) { layer.hidden = true; layer.setAttribute('hidden', ''); }
        for (const id of ['drawingSave', 'drawingExitSave', 'commentSave']) { const node = doc.getElementById(id); if (node) { if (!previewDisabled.has(node)) previewDisabled.set(node, node.disabled); node.disabled = true; } }
        for (const id of ['drawingText', 'drawingTextDelete', 'commentDraftPreview']) { const node = doc.getElementById(id); if (node) node.hidden = true; }
      }
      if (screenUI) screenUI.update();
      if (contextUI) contextUI.update();
      if (shellUI) shellUI.update(state);
      const hideStrip = state.interactionSettings?.showCacheStrip === false;
      if (el.decodedCache.hidden !== hideStrip) { set(el.decodedCache, 'hidden', hideStrip); coverageKey = null; }
    }
    drawingUI = drawingAPI.createDrawingUI({ document: doc, window: win, getSession: () => session, getState: () => state, menuActive: () => !!contextUI?.active(),
      canBegin: () => shortcutReady() && !transportBusy && state.exportState?.status !== 'unknown' && state.playback?.frameHeld !== true, isKey: letterKey });
    let screenSelectionPoint = null;
    screenUI = screenGestureAPI.createScreenGestureUI({ document: doc, window: win, now,
      getContext: () => ({ epoch: state.epoch, enabled: interactive() && !gesture && !memoryBusy && !cleaning &&
          !selection.snapshot().busy,
        canStart: interactive() && !selection.snapshot().busy && !transportBusy, canRate: shortcutReady() || !!rateRequest, horizontalOnly: selection.snapshot().editing,
        // State checks on every move do not need a fresh layout measurement.
        get width() { return el.screen.getBoundingClientRect().width; },
        range: viewRange, time: cursorTime(), rate: state.playback?.transport?.rate || 1,
        minOrdinal:viewRange.focused?state.playback?.transport?.loop?.startOrdinal:0,
        maxOrdinal:viewRange.focused?state.playback?.transport?.loop?.endOrdinal:state.playback?.frameCount-1,
        frameAt:(time,bounds)=>session?.loopFrameAt?.(time,bounds),step: state.interactionSettings?.rateStep || .1 }),
      start: () => { const s = selection.snapshot(); screenSelectionPoint = s.editing ? (s.controlled ? s.active : selection.nextPoint() || s.active || (Math.abs((state.playback?.time || 0) - s.start.time) <= Math.abs((state.playback?.time || 0) - s.end.time) ? 'start' : 'end')) : null; },
      release: () => { screenSelectionPoint = null; },
      seek: (time, final, ordinal) => { clearHint(); if (screenSelectionPoint && selection.snapshot().editing) selection.move(screenSelectionPoint, time, final, now(),ordinal); else requestSeek(time, { index:ordinal,final, kind: final ? 'release' : 'rapid', inputAt: now() }); },
      rate: value => requestRate(value),
      toggle: () => { if ((shortcutReady() || interactive() && state.playback?.buffering) && !transportBusy) invoke(() => state.state === 'playing' || state.playback?.buffering ? session.pause() : session.play()); } });
    contextUI = contextAPI.createContextWheel({ document: doc, window: win, screen: el.screen, now,
      getContext: () => {
        const deletion = state.drawings?.draft?.kind === 'delete' ? state.drawings.draft : state.comments?.draft?.kind === 'delete' ? state.comments.draft : null;
        if (deletion) return { epoch: state.epoch, mode: 'note', enabled: ['editing','failed','pausing','obsolete'].includes(deletion.status), tap: 'cancel-delete', items: [] };
        if (state.drawings?.draft) return { epoch: state.epoch, mode: 'drawing', ...drawingUI.menuState(), ...(previewActive() ? { enabled: false } : {}) };
        if (state.comments?.draft) return { epoch: state.epoch, mode: 'note', enabled: !previewActive() && !commentComposing && now() - commentCompositionEnd >= 50 && state.comments.draft.kind !== 'delete' && ['editing', 'failed', 'unknown'].includes(state.comments.draft.status), tap: 'save-note', items: [] };
        if (selection.snapshot().editing) return { epoch: state.epoch, mode: 'selection', enabled: interactive() && !gesture && !selection.snapshot().busy,
          tap: 'finish-selection', items: [{ id: 'unused-up', label: '', disabled: true }, { id: 'endpoint-end', label: '控制尾', symbol: '→' },
            { id: 'unused-down', label: '', disabled: true }, { id: 'endpoint-start', label: '控制头', symbol: '←' }] };
        const loop = state.playback?.transport?.loop;
        return { epoch: state.epoch, mode: 'watch', enabled: interactive() && !gesture && !memoryBusy && !cleaning && !transportBusy && !selection.snapshot().busy,
          items: [{ id: 'note', label: '添加标注', symbol: 'N', disabled: !shortcutReady() || state.comments?.status !== 'ready' || state.playback?.frameHeld === true },
            { id: 'loop', label: loop?.enabled ? '关闭循环' : '开启循环', symbol: '↻', selected: !!loop?.enabled, disabled: selection.snapshot().editing },
            { id: shellUI ? 'records' : 'drawing', label: shellUI ? '记录' : '添加圈画', symbol: '✎', disabled: !shortcutReady() || state.drawings?.status !== 'ready' || !shellUI && state.playback?.frameHeld === true },
            { id: 'selection', label: '选择片段', symbol: '↔' }] };
      },
      opening: () => { screenUI.reset(); },
      command: (id, value) => {
        if (previewActive() && (id === 'save-note' || state.drawings?.draft && id === 'save')) return;
        if (id === 'cancel-delete') { if(state.drawings?.draft?.kind==='delete')session.cancelDrawing();else session.cancelComment(); return; }
        if (id === 'save-note') { saveNote(); return; }
        if (id === 'finish-selection') { invoke(() => selection.finish()); return; }
        if (id === 'endpoint-start' || id === 'endpoint-end') { invoke(() => selection.selectEndpoint(id === 'endpoint-start' ? 'start' : 'end')); return; }
        if (state.drawings?.draft) { invoke(() => drawingUI.menuCommand(id, value)); return; }
        if (id === 'selection') invoke(() => selection.begin('toggle'));
        else if (id === 'loop') invoke(() => selection.toggleLoop());
        else if (id === 'note') invoke(beginNote);
        else if (id === 'drawing') drawingUI.begin();
        else if (id === 'records') shellUI?.records();
      } });
    if (win.EVAGraphite) shellUI = win.EVAGraphite.createShell({document:doc,window:win,getState:()=>state,getSession:()=>session,getRange:()=>viewRange,
      annotate:(id,kind)=>drawingUI.begin(id,kind),clip:()=>{if(interactive())selection.clearOrChoose();},
      exitDrawing:()=>drawingUI.confirmExit('退出标注'),hostAction:options.hostAction});
    const commentResize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(layoutComment) : null;
    commentResize?.observe(el.screen);
    return { canvas: el.picture, confirmDrawingExit: () => drawingUI.confirmExit(), bindSession(value) {
      if (session !== value) {
        seekIntent = null;
        showCommentActions(null);
        drawingUI.reset(); screenUI.reset(); contextUI.reset();
        rateRequest = noteRequest = exportRequest = null; transportBusy = false;
        selection.destroy();
        if (session && typeof session.setCommentsVisible === 'function') session.setCommentsVisible(false);
      }
      session = value; timelineWidth = null; rulerKey = null; coverageKey = null; coverageSize = null;
      update(state); commentsVisibility(); refreshMemory(); refreshCoverage();
      if (memoryTimer === null && typeof win.setInterval === 'function') memoryTimer = win.setInterval(refreshMemory, 500);
      if (coverageTimer === null && typeof win.setInterval === 'function') coverageTimer = win.setInterval(refreshCoverage, 50);
    }, update,
      destroy({ closing = false } = {}) {
        if (proxyToastTimer !== null) win.clearTimeout(proxyToastTimer); proxyToastTimer = null;
        if (el.proxyState) el.proxyState.hidden = true;
        if (closing && doc.createElement && doc.body) {
          closingSurface = doc.createElement('div'); closingSurface.setAttribute('data-eva-closing', '');
          closingSurface.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000;color:#d7a49e;display:flex;align-items:center;justify-content:center;padding:32px;font:14px Segoe UI';
          doc.body.appendChild(closingSurface);
        }
        seekIntent = null;
        for (const [node, disabled] of previewDisabled) node.disabled = disabled; previewDisabled.clear();
        shellUI?.destroy();
        commentResize?.disconnect();
        drawingUI.destroy(); screenUI.destroy(); contextUI.destroy();
        rateRequest = noteRequest = exportRequest = null; transportBusy = false;
        if (session && typeof session.setCommentsVisible === 'function') session.setCommentsVisible(false);
        if (memoryTimer !== null) { win.clearInterval(memoryTimer); memoryTimer = null; }
        if (coverageTimer !== null) { win.clearInterval(coverageTimer); coverageTimer = null; }
        selection.destroy(); clearGesture(); listeners.forEach(([target, type, fn, settings]) => target.removeEventListener(type, fn, settings)); session = null; refreshMemory(); clearCoverage();
      } };
  }
  return { createUI, formatTime, pointerTime, spaceAllowed, previewChoices };
});
