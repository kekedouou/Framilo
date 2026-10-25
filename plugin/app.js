/* Eagle lifecycle and dependency wiring only. */
(function () {
  'use strict';
  const path = require('path'), fs = require('fs');
  let fullscreenProbe=0,fullscreenTransition=false;
  async function syncFullscreen(){if(fullscreenTransition)return;try{const token=++fullscreenProbe,value=await eagle.window.isFullScreen();if(token!==fullscreenProbe)return;if(!value)windowedGeometry=null;document.documentElement.dataset.evaFullscreen=String(!!value);window.dispatchEvent(new Event('eva-fullscreen-change'));}catch(_){/* Host may not be ready yet. */}}
  let fullscreenTimer=null;window.addEventListener('resize',()=>{clearTimeout(fullscreenTimer);fullscreenTimer=setTimeout(syncFullscreen,100);});window.addEventListener('focus',syncFullscreen);syncFullscreen();
  let windowDrag=null,windowedGeometry=null;
  function dragAdapter(){if(!windowDrag){if(!lastPlugin?.path)throw Error('窗口尚未准备完成');windowDrag=require(path.join(lastPlugin.path,'window-drag.cjs')).createWindowDrag({host:eagle.window,sync:syncFullscreen,schedule:fn=>window.requestAnimationFrame(fn),cancel:id=>window.cancelAnimationFrame(id),report:error=>{const n=document.getElementById('error');n.hidden=false;n.textContent='窗口拖动未完成：'+error.message;}});}return windowDrag;}
  window.addEventListener('unload',()=>windowDrag?.cancel());
  async function hostAction(action,details) {
    try {
      if(action==='window-drag-start'){await dragAdapter().start({...details,restore:windowedGeometry});return;}
      if(action==='window-drag-move'){windowDrag?.move(details);return;}
      if(action==='window-drag-end'){windowDrag?.end(details);return;}
      if(action==='close'){windowDrag?.cancel();window.close();return;}
      const host=eagle.window;
      if(action==='minimize')await host.minimize();
      else if(action==='maximize')await (await host.isMaximized()?host.unmaximize():host.maximize());
      else if(action==='windowed'){await host.setFullScreen(false);await syncFullscreen();}
      else if(action==='fullscreen'){fullscreenTransition=true;++fullscreenProbe;try{const full=await host.isFullScreen();if(!full){try{const [size,maximized]=await Promise.all([host.getSize(),host.isMaximized()]);windowedGeometry={size,maximized};}catch(_){windowedGeometry=null;}}await host.setFullScreen(!full);}finally{fullscreenTransition=false;await syncFullscreen();}}
    } catch(error) { const node=document.getElementById('error');node.hidden=false;node.textContent='窗口操作未完成：'+error.message; }
  }
  let ui = window.EVAUI.createUI({hostAction});
  let session = null, diagnostics = null, initializing = false, closed = false;
  let closeTask = null, allowUnload = false, exitScheduled = false;
  let drawingCloseIntent = null, drawingLoadSequence = 0;
  let backend = null, adapter = null, lastPlugin = null, pendingOpen = null, initialSelection = null;
  let entryOverride = null;
  const now = () => performance.now();
  const startupError = error => ui.update({ state: 'error', source: null, duration: 0, playback: null, error: { message: String(error && error.message || error) } });
  function cancelled() { const error = new Error('视频准备已取消。'); error.name = 'AbortError'; error.code = 'PREPARATION_CANCELLED'; return error; }
  // SDK discovery itself cannot be cancelled. Only this session's wait ends;
  // handlers still consume a late result/rejection without starting old work.
  function waitTools(pending, signal) {
    if (signal && signal.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
      const finish = (callback, value) => { if (signal) signal.removeEventListener('abort', aborted); callback(value); };
      const aborted = () => finish(reject, cancelled());
      if (signal) signal.addEventListener('abort', aborted, { once: true });
      pending.then(value => finish(resolve, value), error => finish(reject, error));
    });
  }
  async function loadSelected(settings) {
    let captured = null;
    if (session.hasDrawingDraft && session.hasDrawingDraft()) {
      const active = session, request = ++drawingLoadSequence;
      const library = adapter.drawingLibrary ? adapter.drawingLibrary() : null;
      try { captured = Promise.resolve(adapter.captureSelected()); } catch (error) { captured = Promise.reject(error); }
      captured.catch(() => {});
      if (!ui.confirmDrawingExit || !await ui.confirmDrawingExit()) return { status: 'cancelled' };
      if (session !== active || closed || request !== drawingLoadSequence || library && adapter.drawingLibrary() !== library) return { status: 'superseded' };
    }
    const result = await session.loadSelected(settings, captured);
    if (diagnostics) diagnostics.publish('load-result', result);
    return result;
  }
  function initialize(plugin) {
    const entryAt = entryOverride === null ? now() : entryOverride; entryOverride = null;
    if (closed || initializing || session) return;
    initializing = true;
    presentWindow();
    try {
      if (!plugin || typeof plugin.path !== 'string' || !path.isAbsolute(plugin.path)) throw new Error('Eagle 未提供有效插件目录，请从插件入口打开。');
      const root = fs.realpathSync(plugin.path);
      lastPlugin = plugin;
      const { createTaskClient } = require(path.join(root, 'task-client.cjs'));
      const { createEagleAdapter } = require(path.join(root, 'eagle.cjs'));
      const { createSession } = require(path.join(root, 'session.cjs'));
      const { createDiagnostics } = require(path.join(root, 'diagnostics.cjs'));
      const { createMemoryPreferences } = require(path.join(root, 'preferences.cjs'));
      const { createAnnotationStore } = require(path.join(root, 'drawing-store.cjs'));
      const preferences = createMemoryPreferences({ pluginRoot: root });
      const annotationStore = createAnnotationStore({ pluginRoot: root });
      const frameIndex = require(path.join(root, 'frame-index.cjs'));
      if (!diagnostics) {
        diagnostics = createDiagnostics({ snapshot: () => session ? { ...session.snapshot(),
          annotationReceipts: session.annotationHistory ? session.annotationHistory() : [], pluginRoot: root } : null });
        Object.defineProperty(window, 'EVADiagnostics', { value: diagnostics.public, writable: false, configurable: false });
      }
      adapter = createEagleAdapter(eagle);
      const sessionAdapter = { ...adapter };
      sessionAdapter.captureSelected = () => { if (initialSelection) { const captured = initialSelection; initialSelection = null; return captured; } return adapter.captureSelected(); };
      const cache = { readAsset: (...args) => backend.cache.readAsset(...args),
        readAudioSegment: (...args) => backend.cache.readAudioSegment(...args),
        target: (...args) => backend.cache.target(...args),
        backgroundStatus: (...args) => backend?.cache?.backgroundStatus?.(...args) || null,
        prefetch: (...args) => backend.cache.prefetch(...args),
        cancelReads: (...args) => backend.cache.cancelReads(...args),
        readFrameBatch: (...args) => backend.cache.readFrameBatch(...args),
        release: (...args) => backend.cache.release(...args), clearOther: (...args) => backend.cache.clearOther(...args) };
      let preparedMedia = null, discovery = null;
      // Selection is captured by session immediately; tool discovery waits only
      // inside preparation, so it cannot silently change the clicked material.
      const media = { async prepare(snapshot, options) {
        const signal = options && options.signal;
        if (signal && signal.aborted) throw cancelled();
        if (!preparedMedia) {
          if (!discovery) discovery = Promise.resolve().then(() => adapter.discoverTools())
            .finally(() => { discovery = null; });
          const tools = await waitTools(discovery, signal);
          if (signal && signal.aborted) throw cancelled();
          if (!preparedMedia) {
            backend = createTaskClient({ pluginRoot: root, discoverTools: async () => tools,
              onWaiting: () => { if (session && !closed) ui.update({ ...session.snapshot(), progress: { stage: 'handover', message: '正在等待上一个视频任务结束' } }); },
              onBackground: () => { if (session && !closed) ui.update(session.snapshot()); },
              onFailure: error => { if (session && !closed) session.close().finally(() => startupError(error)).catch(() => {}); } });
            preparedMedia = backend.media;
          }
        }
        return preparedMedia.prepare(snapshot, options);
      } };
      const exports = { create: (...args) => backend.exports.create(...args), publish: (...args) => backend.exports.publish(...args),
        discard: (...args) => backend.exports.discard(...args) };
      session = createSession({ eagleAdapter: sessionAdapter, media, cache, now, memoryPreferences: preferences, annotationStore, exports,
        createPlayer: options => {
          const value = session.snapshot(), identity = value.sourceIdentity;
          const binding = Object.freeze({ sessionEpoch: value.epoch, libraryEpoch: value.libraryEpoch,
            itemId: identity && identity.itemId, sourceSha256: identity && identity.sha256 });
          const memory = preferences.snapshot();
          return new window.EVAPlayer.Player({ ...options,
            createFrameDecoder: settings => { if (!window.EVAProxyDecoder) throw Error('帧内代理解码组件没有加载，请切换JPEG序列。'); return window.EVAProxyDecoder.createProxyDecoder(settings); }, ramBytes: memory.ramBytes, compressedRamBytes: memory.compressedRamBytes,
            forwardPredecode: preferences.forwardPredecode(), canvas: ui.canvas, frameIndex,
            emit: event => diagnostics.publish('player', () => ({ binding, event })) });
        }, onChange: snapshot => { ui.update(snapshot); diagnostics.publish('state', snapshot); } });
      ui.bindSession(session);
      return loadSelected({ startedAt: entryAt, trigger: 'plugin-create' }).catch(() => {});
    } catch (error) { startupError(error); }
    finally { initializing = false; }
  }
  function close() {
    if (closeTask) return closeTask;
    if (session && session.hasDrawingDraft && session.hasDrawingDraft()) return Promise.resolve({ status: 'cancelled' });
    closed = true;
    try { closeTask = (async () => {
      let result, failure;
      // Arm the independent deadline before awaiting potentially stuck media
      // cleanup. Player reads still drain before the owner releases its leases.
      try { if (backend) backend.beginClose(); } catch (error) { failure = error; }
      try { result = session ? await session.close() : { status: 'closed' }; } catch (error) { failure = error; }
      try { if (backend) await backend.close(); } catch (error) { failure = failure || error; }
      if (failure) throw failure;
      return result;
    })(); }
    catch (error) { closeTask = Promise.reject(error); }
    // Opt-in observation only: the actual cleanup result, not a close request
    // or the session's early "closed" state. No subscriber means no recording.
    closeTask.then(result => { if (diagnostics) diagnostics.publish('close-result', result); }, failure => {
      if (diagnostics) diagnostics.publish('close-result', { status: 'error', error: {
        message: String(failure && failure.message || failure).slice(0, 1024) } });
    });
    closeTask.catch(() => {});
    ui.destroy(); ui.update({ state: 'closing', source: null, duration: 0, playback: null, error: null }); return closeTask;
  }
  function requestClose() {
    if (closeTask) return closeTask;
    if (!session || !session.hasDrawingDraft || !session.hasDrawingDraft()) return close();
    if (drawingCloseIntent) return drawingCloseIntent;
    const intent = Promise.resolve(ui.confirmDrawingExit ? ui.confirmDrawingExit() : false).then(ok => ok ? close() : { status: 'cancelled' })
      .finally(() => { if (drawingCloseIntent === intent) drawingCloseIntent = null; });
    drawingCloseIntent = intent; return intent;
  }
  async function presentWindow(){try{const host=eagle.window;if(!host?.show)return;await host.show();if(!closed)await host.focus?.();}catch(_){/* Host may already be closing. */}}
  function run() {
    presentWindow();
    if (session && !closed) return loadSelected({ startedAt: now(), trigger: 'plugin-run' }).catch(() => {});
    if (!closed || !lastPlugin || !adapter) return;
    const startedAt = now(); let captured;
    try { captured = Promise.resolve(adapter.captureSelected()); } catch (error) { captured = Promise.reject(error); }
    const request = { captured, startedAt };
    request.captured.catch(() => {}); pendingOpen = request;
    return closeTask.then(result => {
      if (pendingOpen !== request) return;
      if (result && result.status === 'error') throw new Error(result.error && result.error.message || '旧任务未能正常释放。');
      pendingOpen = null; initialSelection = request.captured; entryOverride = request.startedAt;
      session = null; backend = null; closeTask = null; closed = false; allowUnload = false; exitScheduled = false;
      ui = window.EVAUI.createUI({hostAction}); return initialize(lastPlugin);
    }).catch(startupError);
  }
  function closeFailed(error) {
    allowUnload = false; exitScheduled = false;
    ui.update({ state: 'closed', source: null, duration: 0, playback: null,
      error: { message: '关闭清理失败，窗口暂未关闭：' + String(error && error.message || error).slice(0, 1024) } });
    // An error remains an error in diagnostics. Once the independent owner has
    // actually exited, it must not imprison the user's error window forever.
    if (backend && backend.stopped) setTimeout(() => { allowUnload = true; window.close(); }, 0);
  }
  function beforeUnload(event) {
    if (allowUnload) return;
    // Eagle's exit notification does not await our Promise. Keep this renderer
    // alive so media can stop/wait for children and streams, abort its own
    // partial and release writer/leases before allowing the actual close.
    event.returnValue = false;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (exitScheduled) return;
    exitScheduled = true;
    const closing = requestClose(); closing.then(result => {
      if (result && ['cancelled', 'drawing-blocked'].includes(result.status)) { exitScheduled = false; return; }
      if (result && result.status === 'error') throw new Error(result.error && result.error.message || '资源释放未完成');
      const completedClose = closeTask;
      // A settled ready/empty session can finish entirely in microtasks. Asking
      // Electron to close again there can reach the browser before its first
      // cancelled-beforeunload ACK, so Chromium merges that second request.
      // A new task lets the cancellation finish before making the real close.
      setTimeout(() => {
        if (closeTask !== completedClose || pendingOpen) return;
        try { allowUnload = true; window.close(); }
        catch (error) { closeFailed(error); }
      }, 0);
    }).catch(closeFailed);
  }
  if (typeof eagle !== 'undefined' && typeof eagle.onPluginCreate === 'function') {
    eagle.onPluginCreate(initialize);
    if (typeof eagle.onPluginRun === 'function') eagle.onPluginRun(run);
    if (typeof eagle.onPluginShow === 'function') eagle.onPluginShow(() => {
      if (session && !closed) { session.setCommentsVisible(true); session.refreshComments().catch(() => {}); }
    });
    if (typeof eagle.onPluginHide === 'function') eagle.onPluginHide(() => { if (session && !closed) session.setCommentsVisible(false); });
    if (typeof eagle.onLibraryChanged === 'function') eagle.onLibraryChanged(async () => {
      if (!session || closed) return;
      const active = session;
      if (active.hasDrawingDraft && active.hasDrawingDraft() && (!ui.confirmDrawingExit || !await ui.confirmDrawingExit())) return;
      if (session === active && !closed) return session.libraryChanged().catch(startupError);
    });
    if (typeof eagle.onPluginBeforeExit === 'function') eagle.onPluginBeforeExit(requestClose);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', requestClose);
  } else startupError(new Error('请从 Eagle 打开视频分析插件。'));
})();
