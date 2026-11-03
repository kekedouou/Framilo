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
  let session = null, diagnostics = null, initializing = false, initializationTask = null, closed = false;
  let activePlayer = null;
  let closeTask = null, allowUnload = false, exitScheduled = false;
  let hideTask = Promise.resolve(), closeFailure = null;
  let drawingCloseIntent = null, drawingLoadSequence = 0;
  let temporaryMedia = null;
  let drawingLifetime = null;
  window.addEventListener('focus', () => { if (!closed) drawingLifetime?.run(); });
  let windowFit = null;
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
    const task=initializeReady(plugin,entryAt);initializationTask=task;
    task.finally(()=>{if(initializationTask===task)initializationTask=null;}).catch(()=>{});return task;
  }
  async function initializeReady(plugin,entryAt){
    presentWindow();
    try {
      if (!plugin || typeof plugin.path !== 'string' || !path.isAbsolute(plugin.path)) throw new Error('Eagle 未提供有效插件目录，请从插件入口打开。');
      const root = fs.realpathSync(plugin.path);
      lastPlugin = plugin;
      const { createEagleAdapter } = require(path.join(root, 'eagle.cjs'));
      adapter = createEagleAdapter(eagle);
      // Capture the chosen source before yielding for paint; a later selection
      // must not silently replace what the user opened.
      if(!initialSelection){try{initialSelection=Promise.resolve(adapter.captureSelected());}catch(error){initialSelection=Promise.reject(error);}initialSelection.catch(()=>{});}
      if(ui.prepareEntry)await ui.prepareEntry();
      if(closed)return;
      const { createTaskClient } = require(path.join(root, 'task-client.cjs'));
      const { createSession } = require(path.join(root, 'session.cjs'));
      const { createDiagnostics } = require(path.join(root, 'diagnostics.cjs'));
      const { createMemoryPreferences } = require(path.join(root, 'preferences.cjs'));
      const { createAnnotationStore } = require(path.join(root, 'drawing-store.cjs'));
      const preferences = createMemoryPreferences({ pluginRoot: root,
        display: { width: window.screen?.width, height: window.screen?.height, scaleFactor: window.devicePixelRatio || 1 } });
      const annotationStore = createAnnotationStore({ pluginRoot: root });
      const frameIndex = require(path.join(root, 'frame-index.cjs'));
      if (!diagnostics) {
        diagnostics = createDiagnostics({ snapshot: () => session ? { ...session.snapshot(),
          annotationReceipts: session.annotationHistory ? session.annotationHistory() : [], pluginRoot: root } : null });
        Object.defineProperty(window, 'EVADiagnostics', { value: diagnostics.public, writable: false, configurable: false });
      }
      windowFit = require(path.join(root, 'window-fit.cjs')).createWindowFit({host:eagle.window,screen:eagle.screen,
        report:error=>diagnostics?.publish('window-fit-failed',{message:String(error.message)})});
      const sessionAdapter = { ...adapter };
      sessionAdapter.captureSelected = () => { if (initialSelection) { const captured = initialSelection; initialSelection = null; return captured; } return adapter.captureSelected(); };
      // Route leases by the info object that acquired them, never by a newer
      // active backend after a source or settings switch.
      const mediaOwners = new WeakMap();
      const ownedCache = info => mediaOwners.get(info) || backend?.cache;
      const cache = { readAsset: (info, ...args) => ownedCache(info).readAsset(info, ...args),
        readAudioSegment: (info, ...args) => ownedCache(info).readAudioSegment(info, ...args),
        target: (info, ...args) => ownedCache(info)?.target?.(info, ...args),
        isFrameReady: (info, ...args) => !!ownedCache(info)?.isFrameReady?.(info, ...args),
        prioritizeRecords: (info, ...args) => ownedCache(info)?.prioritizeRecords?.(info, ...args),
        readRecordFrame: (info, ...args) => ownedCache(info).readRecordFrame(info, ...args),
        backgroundStatus: (info, ...args) => ownedCache(info)?.backgroundStatus?.(info, ...args) || null,
        prefetch: (info, ...args) => ownedCache(info)?.prefetch?.(info, ...args),
        cancelReads: (info, ...args) => ownedCache(info)?.cancelReads?.(info, ...args),
        readFrameBatch: (info, ...args) => ownedCache(info).readFrameBatch(info, ...args),
        release: async (info, ...args) => { const holder = ownedCache(info); await holder.release(info, ...args); mediaOwners.delete(info); },
        clearOther: (...args) => backend.cache.clearOther(...args) };
      const jpegGate=require(path.join(root,'media-policy.cjs')).createJpegGate();
      let preparedMedia = null, discovery = null, discoveredTools = null, backendKey = null;
      // Selection is captured by session immediately; tool discovery waits only
      // inside preparation, so it cannot silently change the clicked material.
      const media = { async prepare(snapshot, options = {}) {
        const signal = options && options.signal;
        if (signal && signal.aborted) throw cancelled();
        const native = options?.playbackBackend === 'proxy';
        if(native&&!require(path.join(root,'media-policy.cjs')).nativeContainer(snapshot.filePath))throw Object.assign(Error('暂不支持此视频格式。'),{code:'MEDIA_CONTAINER_MODE'});
        const memory = preferences.snapshot();
        const acceleration=preferences.gpuAcceleration?.();
        const decoder=acceleration===undefined?(preferences.decoderPreference?.()||'prefer-hardware'):acceleration?'prefer-hardware':'prefer-software',encoder=acceleration===undefined?(preferences.proxyEncoder?.()||'cpu'):acceleration?'nvidia':'cpu',gpu=acceleration===undefined?preferences.gpuDrawing?.()!==false:acceleration;
        const key = native ? ['native', memory.ramBytes, decoder, encoder, true, gpu,(preferences.proxyDiskGiB?.()||5)].join(':') : 'jpeg';
        if (!preparedMedia || key !== backendKey) {
          if (!discoveredTools && !discovery) discovery = Promise.resolve().then(() => adapter.discoverTools())
            .finally(() => { discovery = null; });
          const tools = discoveredTools || await waitTools(discovery, signal); discoveredTools = tools;
          if (signal && signal.aborted) throw cancelled();
          if (!preparedMedia || key !== backendKey) {
            if (backend) { const previous = backend; preparedMedia = null; backendKey = null; backend = null;
              await previous.close(); if (signal?.aborted) throw cancelled(); }
            if(native){temporaryMedia=temporaryMedia||require(path.join(root,'temporary-media.cjs')).createTemporaryMedia({pluginRoot:root});
            await temporaryMedia.ready;if(signal?.aborted)throw cancelled();}
            const onBackground = () => { if (session && !closed) ui.update(session.snapshot()); };
            backend = native ? require(path.join(root, 'native-backend.cjs')).createNativeBackend({ pluginRoot: root, tools,
              temporaryMedia,cacheRoot:temporaryMedia.directory,limitBytes:100*1024**3, ramBytes: memory.ramBytes, decoderPreference: decoder, proxyEncoder: encoder, automaticProxy: true, gpuDrawing: gpu, onBackground })
              : createTaskClient({ pluginRoot: root, discoverTools: async () => tools,
              onWaiting: () => { if (session && !closed) ui.update({ ...session.snapshot(), progress: { stage: 'handover', message: '正在等待上一个视频任务结束' } }); },
              onBackground,
              onFailure: error => { if (session && !closed) session.close().finally(() => startupError(error)).catch(() => {}); } });
            preparedMedia = backend.media; backendKey = key;
          }
        }
        const active = backend, provider=preparedMedia;
        if(!native)await jpegGate(snapshot,options,discoveredTools);
        if(signal?.aborted)throw cancelled();
        const info = await provider.prepare(snapshot, options);
        mediaOwners.set(info, active.cache); return info;
      } };
      const exportOperation = (name, args) => {
        const provider = backend?.exports;
        if (!provider || typeof provider[name] !== 'function')
          return Promise.reject(Object.assign(new Error('当前界面未开放导出。'), { code: 'EXPORT_UNAVAILABLE' }));
        return provider[name](...args);
      };
      const exports = { create: (...args) => exportOperation('create', args), publish: (...args) => exportOperation('publish', args),
        discard: (...args) => exportOperation('discard', args) };
      session = createSession({ eagleAdapter: sessionAdapter, media, cache, now, memoryPreferences: preferences, annotationStore, exports,
        // Exact previews/thumbnails belong to the native player; no legacy overlay service.
        createPreviewServices: () => ({}),
        createPlayer: options => {
          const value = session.snapshot(), identity = value.sourceIdentity;
          const binding = Object.freeze({ sessionEpoch: value.epoch, libraryEpoch: value.libraryEpoch,
            itemId: identity && identity.itemId, sourceSha256: identity && identity.sha256 });
          const memory = preferences.snapshot();
          const nativeInfo = options.mediaInfo?.videoEncoding === 'filmcraft-native' ? options.mediaInfo : null;
          const Player = nativeInfo ? window.EVANativePlayer?.Player : window.EVAPlayer?.Player;
          if (!Player) throw Error('原生播放器组件尚未加载，请重新打开插件。');
          activePlayer = new Player({ ...options,
            ...(nativeInfo ? { nativeRuntime: nativeInfo.nativeRuntime, gpuDrawing: preferences.gpuDrawing() } : {}),
            ramBytes: memory.ramBytes, compressedRamBytes: memory.compressedRamBytes,
            forwardPredecode: preferences.forwardPredecode(), canvas: ui.canvas, frameIndex,
            emit: event => { diagnostics.publish('player', () => ({ binding, event })); } });
          activePlayer.observeCanvas = false;
          activePlayer.observePerformance = false;
          return activePlayer;
        }, onChange: snapshot => { ui.update(snapshot); windowFit?.update(snapshot); diagnostics.publish('state', snapshot); } });
      ui.bindSession(session);
      drawingLifetime = require(path.join(root, 'drawing-lifetime.cjs')).createDrawingLifetime({
        store: annotationStore, adapter,
        protectedItem: () => session?.snapshot().sourceIdentity,
        report: receipt => diagnostics?.publish('drawing-maintenance', receipt)
      });
      const loading = loadSelected({ startedAt: entryAt, trigger: 'plugin-create' }).catch(() => {});
      drawingLifetime.run(); return loading;
    } catch (error) { startupError(error); }
    finally { initializing = false; }
  }
  function close() {
    if (closeTask) return closeTask;
    if (session && session.hasDrawingDraft && session.hasDrawingDraft()) return Promise.resolve({ status: 'cancelled' });
    closed = true;
    // Invalidates all pending deletion probes immediately; read-only probes may
    // finish later but cannot delete, reschedule or hold up media shutdown.
    drawingLifetime?.stop(); drawingLifetime = null;
    windowFit?.destroy();windowFit=null;
    // Hide the window, not its failure/result: owned resources still close below.
    // Keep the promise so a delayed host hide cannot hide a reopened session.
    try { hideTask = Promise.resolve(eagle.window?.hide?.()).catch(() => {}); } catch (_) { hideTask = Promise.resolve(); }
    try { closeTask = (async () => {
      let result, failure;
      // Arm the independent deadline before awaiting potentially stuck media
      // cleanup. Player reads still drain before the owner releases its leases.
      try { if (backend) backend.beginClose(); } catch (error) { failure = error; }
      try { result = session ? await session.close() : { status: 'closed' }; } catch (error) { failure = error; }
      // destroy() below releases a pending first-paint wait. Reopening waits
      // for this old initializer as well as its media owner before reusing UI.
      try { await initializationTask; } catch (error) { failure = failure || error; }
      try { if (backend) await backend.close(); } catch (error) { failure = failure || error; }
      if(!failure&&temporaryMedia)try{await temporaryMedia.close();temporaryMedia=null;await backend?.retireLegacy?.();}catch(error){failure=error;}
      if (failure) throw failure;
      if (result?.status === 'error') throw new Error(result.error?.message || '资源释放未完成');
      return result;
    })(); }
    catch (error) { closeTask = Promise.reject(error); }
    // Opt-in observation only: the actual cleanup result, not a close request
    // or the session's early "closed" state. No subscriber means no recording.
    closeTask.then(result => { if (diagnostics) diagnostics.publish('close-result', result); }, failure => {
      if (diagnostics) diagnostics.publish('close-result', { status: 'error', error: {
        message: String(failure && failure.message || failure).slice(0, 1024) } });
    });
    closeTask.catch(closeFailed);
    ui.destroy({ closing: true }); ui.update({ state: 'closing', source: null, duration: 0, playback: null, error: null }); return closeTask;
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
    if (session && !closed) { presentWindow(); drawingLifetime?.run(); return loadSelected({ startedAt: now(), trigger: 'plugin-run' }).catch(() => {}); }
    if (!closed || !lastPlugin || !adapter) return;
    const startedAt = now(); let captured;
    try { captured = Promise.resolve(adapter.captureSelected()); } catch (error) { captured = Promise.reject(error); }
    const request = { captured, startedAt };
    request.captured.catch(() => {}); pendingOpen = request;
    return closeTask.then(async result => {
      await hideTask;
      if (pendingOpen !== request) return;
      if (result && result.status === 'error') throw new Error(result.error && result.error.message || '旧任务未能正常释放。');
      // UI construction may fail. Keep the closed lifecycle retryable until it
      // succeeds, and retain the previous error surface instead of exposing DOM.
      const nextUI = window.EVAUI.createUI({hostAction});
      pendingOpen = null; initialSelection = request.captured; entryOverride = request.startedAt;
      session = null; backend = null; closeTask = null; closed = false; allowUnload = false; exitScheduled = false; closeFailure = null;
      ui = nextUI; const work = initialize(lastPlugin); presentWindow(); return work;
    }).catch(error => { if (pendingOpen === request) pendingOpen = null; startupError(error); });
  }
  function closeFailed(error) {
    closeFailure = error;
    allowUnload = false; exitScheduled = false;
    hideTask.then(() => presentWindow());
    ui.update({ state: 'closed', source: null, duration: 0, playback: null,
      error: { message: '关闭清理失败，窗口暂未关闭：' + String(error && error.message || error).slice(0, 1024) } });
    // An error remains an error in diagnostics. Once the independent owner has
    // actually exited, it must not imprison the user's error window forever.
    // Keep the error visible; a subsequent explicit close may leave once stopped.
  }
  function beforeUnload(event) {
    if (closeFailure && backend?.stopped) { allowUnload = true; return; }
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
      if (!closed) drawingLifetime?.run();
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
  } else startupError(new Error('请从 Eagle 打开 Framilo。'));
})();
