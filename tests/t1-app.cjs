'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const code = fs.readFileSync(path.join(__dirname, '../plugin/app.js'), 'utf8');
function harness(settings = {}) {
  const hooks = {}, log = [], updates = [], root = path.resolve(__dirname, '../plugin'), discoveries = [];
  let config, discovered = 0, prepared = 0, closed = 0, destroyed = 0, windowDestroyed = false, closeAttempts = 0;
  let nativeCloseBusy = false, mergedCloseAttempts = 0;
  const nativeTasks = [];
  const ui = { canvas: {}, bindSession() {}, update(value) { updates.push(value); }, destroy() { destroyed++; } };
  if(settings.prepareEntry)ui.prepareEntry=settings.prepareEntry;
  const session = {
    hasDrawingDraft: () => !!settings.drawingDraft,
    loadSelected(options, captured) { log.push({ type: 'selected', options, captured }); return Promise.resolve(); },
    libraryChanged() { log.push({ type: 'library' }); return Promise.resolve(); },
    setCommentsVisible(visible) { log.push({ type: 'comment-visibility', visible }); },
    refreshComments() { log.push({ type: 'comment-refresh' }); return Promise.resolve(); },
    close() { closed++; return settings.closeSession ? settings.closeSession() : Promise.resolve(); },
    snapshot() { return { epoch: 3, libraryEpoch: 1, sourceIdentity: { itemId: 'fixed', sha256: 'a'.repeat(64) } }; }
  };
  const adapter = {
    captureSelected() { return settings.capture?settings.capture():Promise.resolve({ id: 'fixed', filePath: path.join(root, 'video.mp4') }); },
    discoverTools() { discovered++; return new Promise((resolve, reject) => { discoveries.push({ resolve, reject }); }); }
  };
  const modules = {
    'window-fit.cjs': require('../plugin/window-fit.cjs'),
    'cache.cjs': { createCache(options) { assert.strictEqual(options.pluginRoot, root); return settings.backendCache || { readAsset() {}, release() {} }; } },
    'eagle.cjs': { createEagleAdapter() { return Object.freeze(adapter); } },
    'drawing-store.cjs': { createAnnotationStore: () => null },
    'drawing-lifetime.cjs': { createDrawingLifetime: () => ({ run() { settings.maintenanceRuns = (settings.maintenanceRuns || 0) + 1; }, stop() { settings.maintenanceStops = (settings.maintenanceStops || 0) + 1; } }) },
    'preferences.cjs': { createMemoryPreferences() { return settings.preferences || { forwardPredecode:()=>true, snapshot: () => ({ ramBytes: 1024 ** 3, compressedRamBytes: 128 * 1024 ** 2, percent: 2.5 }) }; } },
    'session.cjs': { createSession(options) { config = options; return settings.realSession ? require('../plugin/session.cjs').createSession(options) : session; } },
    'diagnostics.cjs': { createDiagnostics: require('../plugin/diagnostics.cjs').createDiagnostics },
    'media.cjs': { createMedia(options) { assert.strictEqual(options.tools.ffmpeg, 'existing-only'); return { prepare(snapshot, options) { prepared++; assert.strictEqual(snapshot.id, 'fixed'); return { snapshot, options }; } }; } },
    'media-policy.cjs': {createJpegGate:()=>async()=>{},nativeContainer:require('../plugin/media-policy.cjs').nativeContainer},
    'temporary-media.cjs': {createTemporaryMedia:()=>({directory:path.join(root,'cache/sessions-v1/test'),ready:Promise.resolve(),close:async()=>({status:'cleared'})})},
    'frame-index.cjs': {}
  };
  modules['task-client.cjs'] = { createTaskClient: options => require('./support/task-client-model.cjs').createModel(modules, options) };
  Object.assign(modules, settings.modules || {});
  const eagle = Object.fromEntries(['onPluginCreate', 'onPluginRun', 'onLibraryChanged', 'onPluginBeforeExit', 'onPluginShow', 'onPluginHide'].map(name => [name, callback => { hooks[name] = callback; }]));
  if(settings.hostWindow)eagle.window=settings.hostWindow;
  function requestClose() {
    closeAttempts++;
    if (settings.deferNativeAck && nativeCloseBusy) { mergedCloseAttempts++; return { merged: true }; }
    if (settings.throwNativeClose && closeAttempts > 1) throw new Error('native close failure');
    nativeCloseBusy = true;
    // Like Eagle main + plugin IPC: invoke the callback without awaiting it.
    if (hooks.onPluginBeforeExit) hooks.onPluginBeforeExit();
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    if (hooks.beforeunload) hooks.beforeunload(event);
    if (!event.defaultPrevented && event.returnValue === undefined) {
      windowDestroyed = true; if (hooks.pagehide) hooks.pagehide();
    }
    // The browser processes the cancelled-beforeunload acknowledgement after
    // the renderer callback and its microtasks. A second close before that ACK
    // is merged with the already-pending request instead of firing another event.
    if (settings.deferNativeAck) nativeTasks.push(() => { nativeCloseBusy = false; });
    else nativeCloseBusy = false;
    return event;
  }
  const schedule = (callback, milliseconds) => {
    if (settings.throwTimer) throw new Error('close timer failure');
    if (settings.deferNativeAck) { nativeTasks.push(callback); return nativeTasks.length; }
    return setTimeout(callback, milliseconds);
  };
  let uiCreations = 0;
  const win = { EVAUI: { createUI: () => { if (++uiCreations === settings.failUIAt) throw Error('injected UI reconstruction failure'); return ui; } }, EVAPlayer: { Player: function (options) { this.options = options; } },
    close: requestClose, addEventListener(type, fn) { hooks[type] = fn; } };
  if (settings.nativePlayer) win.EVANativePlayer = { Player: settings.nativePlayer };
  vm.runInNewContext(settings.code || code, { window: win, eagle, performance: { now: () => 100 }, require(name) {
    if (name === 'path') return path; if (name === 'fs') return { realpathSync: file => file };
    assert.strictEqual(path.dirname(name), root); assert(modules[path.basename(name)], name); return modules[path.basename(name)];
  }, Promise, setTimeout: schedule });
  return { hooks, log, updates, root, ui, discoveries, win, requestClose,
    async flushNativeTasks() {
      const microtasks = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
      await microtasks();
      while (nativeTasks.length) { nativeTasks.shift()(); await microtasks(); }
    },
    windowState: () => ({ destroyed: windowDestroyed, attempts: closeAttempts, merged: mergedCloseAttempts }), get config() { return config; },
    counts: () => ({ discovered, prepared, closed, destroyed }), session, settings };
}
async function bounded(pending) {
  let timer;
  try { return await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Operation remained blocked by tool discovery')), 1000); })]); }
  finally { clearTimeout(timer); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function main() {
  {
    let resume,captures=0;const gate=new Promise(r=>{resume=r;});const h=harness({prepareEntry:()=>gate,capture:()=>{captures++;return Promise.resolve({id:'fixed',filePath:path.resolve('selected-before-paint.mp4')});}});
    const opening=h.hooks.onPluginCreate({path:h.root});assert.equal(captures,1);assert.equal(h.config,undefined,'heavy session work waits for first paint');
    const closing=h.hooks.onPluginBeforeExit();resume();await bounded(closing);await bounded(opening);assert.equal(h.config,undefined,'closed initializer cannot build media after paint');
    await bounded(h.hooks.onPluginRun());assert(h.config);assert.equal(captures,2,'reopening captures once and consumes that exact promise');await h.hooks.onPluginBeforeExit();
    console.log('E58 app: selection captured before first paint; close drains initializer and reopen remains usable');
  }
  {
    const h = harness({ failUIAt: 2 });
    await h.hooks.onPluginCreate({path:h.root});await h.hooks.onPluginBeforeExit();
    await h.hooks.onPluginRun();assert.match(h.updates.at(-1).error.message,/UI reconstruction failure/);
    assert.equal(h.log.filter(x=>x.type==='selected').length,1,'Failed UI cannot start media');
    await h.hooks.onPluginRun();assert.equal(h.log.filter(x=>x.type==='selected').length,2,'Explicit run retries after failed UI construction');
    await h.hooks.onPluginBeforeExit();assert.equal(h.counts().closed,2);
    assert.equal(h.settings.maintenanceStops,2);assert(h.settings.maintenanceRuns>=2);
    console.log('T1 app: failed UI reconstruction remains retryable without starting media or losing close ownership');
  }
  {
    let finish, hidden = 0, shown = 0;
    const pending = new Promise(resolve => { finish = resolve; });
    const h = harness({closeSession:()=>pending,hostWindow:{hide:async()=>hidden++,show:async()=>shown++}});
    await h.hooks.onPluginCreate({path:h.root});const closing=h.hooks.onPluginBeforeExit();
    assert.equal(hidden,1,'hide is requested before delayed cleanup');assert(!h.windowState().destroyed);
    finish({status:'closed'});await closing;
    await h.hooks.onPluginRun();assert(shown>0,'reopen presents only after cleanup');
    console.log('E42 hide before cleanup / reopen after drain passed (host model)');
  }
  {
    let shown=0;const h=harness({closeSession:async()=>{throw Error('model release failure');},hostWindow:{hide:async()=>{},show:async()=>shown++}});
    await h.hooks.onPluginCreate({path:h.root});await h.hooks.onPluginBeforeExit().catch(()=>{});await tick();
    assert(shown>0,'failed close is made visible');assert(h.updates.some(v=>v.error?.message.includes('model release failure')));
  }
  {
    const calls = [], info = { streaming: 'segments-v1' }, pcm = { bytes: Buffer.from('pcm') };
    const backendCache = {
      readAudioSegment(value, ordinal) { assert.strictEqual(this, backendCache); assert.strictEqual(value, info); calls.push(['audio', ordinal]); return Promise.resolve(pcm); },
      target(value, time) { assert.strictEqual(this, backendCache); assert.strictEqual(value, info); calls.push(['target', time]); },
      prefetch(value, time, loop) { assert.strictEqual(value, info); calls.push(['prefetch', time, loop]); },
      cancelReads(value) { assert.strictEqual(this, backendCache); assert.strictEqual(value, info); calls.push(['cancel']); }
    };
    const h = harness({ backendCache }); await h.hooks.onPluginCreate({ path: h.root });
    const pending = h.config.media.prepare({ id: 'fixed' }, {});
    await tick(); h.discoveries[0].resolve({ ffmpeg: 'existing-only' }); await pending;
    assert.strictEqual(await h.config.cache.readAudioSegment(info, 31), pcm);
    h.config.cache.target(info, 31.5); h.config.cache.prefetch(info,31.5,null); h.config.cache.cancelReads(info);
    assert.deepStrictEqual(calls, [['audio', 31], ['target', 31.5], ['prefetch',31.5,null], ['cancel']]);
    await h.hooks.onPluginBeforeExit();
    console.log('E33 app: actual entry forwards segmented audio, seek cancellation and close cancellation with original owner identity');
  }
  {const calls=[],h=harness({hostWindow:{show:async()=>calls.push('show'),focus:async()=>calls.push('focus')}});await h.hooks.onPluginCreate({path:h.root});await tick();assert.deepEqual(calls,['show','focus']);h.hooks.onPluginRun();await tick();assert.deepEqual(calls,['show','focus','show','focus']);await h.hooks.onPluginBeforeExit();console.log('T1 app: create/run show then focus without permanent topmost');}
  {const h=harness({hostWindow:{show(){throw Error('host closing');}}});await h.hooks.onPluginCreate({path:h.root});await tick();assert(h.config);await h.hooks.onPluginBeforeExit();console.log('T1 app: display failure does not abort session wiring');}

  {
    const h = harness(); await h.hooks.onPluginCreate({ path: h.root });
    h.hooks.onPluginHide(); h.hooks.onPluginShow();
    assert.deepEqual(h.log.filter(value => value.type.startsWith('comment-')), [
      { type: 'comment-visibility', visible: false }, { type: 'comment-visibility', visible: true }, { type: 'comment-refresh' }]);
    await h.hooks.onPluginBeforeExit(); const before = h.log.length;
    h.hooks.onPluginShow(); h.hooks.onPluginHide(); assert.equal(h.log.length, before);
    console.log('E-07 visibility: native host show/hide routes sync visibility and refresh, never reviving a closed session');
  }
  {
    let finish; const pending = new Promise(resolve => { finish = resolve; });
    const h = harness({ closeSession: () => pending, deferNativeAck: true });
    await h.hooks.onPluginCreate({ path: h.root }); h.requestClose();
    const first = h.hooks.onPluginRun(), latest = h.hooks.onPluginRun();
    finish({ status: 'closed' }); await Promise.all([first, latest]); await h.flushNativeTasks();
    assert.equal(h.windowState().destroyed, false, 'Explicit reopening supersedes pending native exit');
    assert.equal(h.log.filter(x => x.type === 'selected').length, 2, 'Only the newest opening is initialized after cleanup');
    console.log('Task handover: repeated open during closing retains latest request and prevents stale native exit');
  }
  for (const fastResult of [null, { status: 'closed' }]) {
    const h = harness({ deferNativeAck: true, closeSession: () => Promise.resolve(fastResult) });
    await h.hooks.onPluginCreate({ path: h.root }); h.requestClose();
    await h.flushNativeTasks();
    assert.strictEqual(h.windowState().destroyed, true, 'Fast ready/empty cleanup must wait for the native cancellation ACK before requesting another close');
    assert.strictEqual(h.windowState().attempts, 2); assert.strictEqual(h.windowState().merged, 0);
    assert.strictEqual(h.counts().closed, 1); assert.strictEqual(h.counts().destroyed, 1);
    console.log('T1 app: fast ' + (fastResult ? 'ready' : 'empty') + ' close runs in a new task after native ACK passed');
  }
  {
    let finish;
    const cleanup = new Promise(resolve => { finish = resolve; });
    const h = harness({ closeSession: () => cleanup }); await h.hooks.onPluginCreate({ path: h.root });
    const event = h.requestClose();
    assert.strictEqual(event.returnValue, false, 'Native close must be blocked synchronously even when Eagle ignores the cleanup promise');
    assert.strictEqual(h.windowState().destroyed, false, 'Renderer must stay alive until cleanup really settles');
    h.requestClose(); await tick(); assert.strictEqual(h.counts().closed, 1); assert.strictEqual(h.counts().destroyed, 1);
    assert.strictEqual(h.windowState().destroyed, false);
    finish({ status: 'closed' }); await tick();
    assert.strictEqual(h.windowState().destroyed, true); assert.strictEqual(h.windowState().attempts, 3);
    assert.strictEqual(h.counts().closed, 1);
    const after = {}; h.hooks.beforeunload(after); assert.strictEqual(after.returnValue, undefined, 'Final native close is allowed without another cleanup loop');
    console.log('T1 app: nonawaiting Eagle close waits for cleanup then closes once passed');
  }
  for (const rejected of [false, true]) {
    let finish, reject;
    const cleanup = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    const h = harness({ closeSession: () => cleanup }); await h.hooks.onPluginCreate({ path: h.root });
    h.requestClose();
    if (rejected) reject(new Error('cleanup failure'));
    else finish({ status: 'error', error: { message: 'lease release failure' } });
    await tick(); assert.strictEqual(h.windowState().destroyed, false);
    assert.strictEqual(h.updates.at(-1).state, 'closed'); assert.match(h.updates.at(-1).error.message, /关闭清理失败/);
    h.requestClose(); await tick(); assert.strictEqual(h.windowState().destroyed, false);
    assert.strictEqual(h.counts().closed, 1);
    console.log('T1 app: cleanup ' + (rejected ? 'rejection' : 'error result') + ' cannot destroy the renderer or retry cleanup silently passed');
  }
  for (const setting of ['throwTimer', 'throwNativeClose']) {
    const h = harness({ [setting]: true }); await h.hooks.onPluginCreate({ path: h.root });
    h.requestClose(); await tick();
    assert.strictEqual(h.windowState().destroyed, false);
    assert.match(h.updates.at(-1).error.message, /关闭清理失败/);
    assert.strictEqual(h.counts().closed, 1); assert.strictEqual(h.counts().destroyed, 1);
    const blocked = {}; h.hooks.beforeunload(blocked); assert.strictEqual(blocked.returnValue, false);
    await tick(); assert.strictEqual(h.windowState().destroyed, false);
    console.log('T1 app: ' + setting + ' remains blocked and reports the failure passed');
  }
  const h = harness();
  await h.hooks.onPluginCreate({ path: h.root });
  assert.strictEqual(h.log[0].type, 'selected'); assert.strictEqual(h.log[0].options.startedAt, 100);
  assert.strictEqual(h.counts().discovered, 0, 'Selection must not wait for tools');
  const signal = new AbortController().signal, pending = h.config.media.prepare({ id: 'fixed' }, { signal });
  await tick(); assert.strictEqual(h.counts().discovered, 1); assert.strictEqual(h.counts().prepared, 0);
  h.discoveries[0].resolve({ ffmpeg: 'existing-only' }); await pending;
  await h.config.media.prepare({ id: 'fixed' }, { signal }); assert.strictEqual(h.counts().discovered, 1);
  const player = h.config.createPlayer({ experimentMode: 'compressed-ram' });
  assert.strictEqual(player.options.canvas, h.ui.canvas); assert.strictEqual(player.options.experimentMode, 'compressed-ram');
  assert.strictEqual(player.options.forwardPredecode,true);
  assert(Object.isFrozen(h.win.EVADiagnostics));
  assert.strictEqual(h.win.EVADiagnostics.snapshot().epoch, 3);
  assert.strictEqual(h.win.EVADiagnostics.snapshot().pluginRoot, h.root);
  const events = [], unsubscribe = h.win.EVADiagnostics.subscribe(event => events.push(event));
  player.options.emit({ type: 'draw', frameId: 0 });
  assert.strictEqual(events[0].type, 'player'); assert.strictEqual(events[0].value.binding.sessionEpoch, 3);
  assert.strictEqual(events[0].value.event.frameId, 0); unsubscribe();
  await h.hooks.onPluginCreate({ path: h.root }); assert.strictEqual(h.log.length, 1);
  await h.hooks.onPluginRun(); assert.strictEqual(h.log[1].options.trigger, 'plugin-run');
  await h.hooks.onLibraryChanged(); assert.strictEqual(h.log[2].type, 'library');
  await h.hooks.onPluginBeforeExit(); h.hooks.pagehide();
  assert.strictEqual(h.counts().closed, 1); assert.strictEqual(h.counts().destroyed, 1);
  await h.hooks.onPluginRun(); assert.strictEqual(h.log.length, 4); assert.strictEqual(h.updates[0].state, 'closing');
  console.log('T1 app: lifecycle/selected-entry/tool-discovery/assembly/close simulation passed');

  for (const lateReject of [false, true]) {
    const h = harness(); await h.hooks.onPluginCreate({ path: h.root });
    const controller = new AbortController(), pending = h.config.media.prepare({ id: 'fixed' }, { signal: controller.signal });
    const rejection = assert.rejects(pending, error => error.name === 'AbortError');
    await tick(); controller.abort(); await bounded(rejection);
    assert.strictEqual(h.counts().prepared, 0, 'Cancelled wait must settle before SDK returns');
    if (lateReject) h.discoveries[0].reject(new Error('late discovery failure'));
    else h.discoveries[0].resolve({ ffmpeg: 'existing-only' });
    await tick(); assert.strictEqual(h.counts().prepared, 0, 'Late SDK result cannot start old media work');
    console.log('T1 app: cancelled discovery wait and late ' + (lateReject ? 'rejection' : 'success') + ' passed');
  }
  {
    const h = harness(); await h.hooks.onPluginCreate({ path: h.root });
    const first = new AbortController(), second = new AbortController();
    const old = h.config.media.prepare({ id: 'fixed' }, { signal: first.signal });
    const rejected = assert.rejects(old, error => error.name === 'AbortError');
    await tick(); first.abort(); await bounded(rejected);
    const current = h.config.media.prepare({ id: 'fixed' }, { signal: second.signal });
    h.discoveries[0].resolve({ ffmpeg: 'existing-only' }); await current;
    assert.deepStrictEqual(h.counts(), { discovered: 1, prepared: 1, closed: 0, destroyed: 0 });
    console.log('T1 app: new session shares discovery without running cancelled session passed');
  }
  {
    const h = harness(); await h.hooks.onPluginCreate({ path: h.root });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(h.config.media.prepare({ id: 'fixed' }, { signal: controller.signal }), error => error.name === 'AbortError');
    assert.strictEqual(h.counts().discovered, 0);
    const failed = h.config.media.prepare({ id: 'fixed' }, {});
    const rejection = assert.rejects(failed, /discovery failed/);
    await tick(); h.discoveries[0].reject(new Error('discovery failed')); await rejection;
    const retry = h.config.media.prepare({ id: 'fixed' }, {});
    await tick(); h.discoveries[1].resolve({ ffmpeg: 'existing-only' }); await retry;
    assert.strictEqual(h.counts().prepared, 1); assert.strictEqual(h.counts().discovered, 2);
    console.log('T1 app: pre-aborted entry and discovery failure retry passed');
  }
  {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const h = harness({ closeSession: () => pending });
    await h.hooks.onPluginCreate({ path: h.root });
    const observed = [];
    h.win.EVADiagnostics.subscribe(event => { if (event.type === 'close-result') observed.push(event); });
    const closing = h.hooks.onPluginBeforeExit(); await tick();
    assert.equal(observed.length, 0, 'A close request/pending cleanup cannot be reported as completed');
    finish({ status: 'closed' }); await closing; await tick();
    assert.equal(observed.length, 1, 'Actual cleanup completion must be observable before native exit');
    assert.equal(observed[0].value.status, 'closed');
    await h.hooks.onPluginBeforeExit(); assert.equal(observed.length, 1, 'Repeated close must not emit another result');
    assert.equal(h.windowState().destroyed, false, 'Cleanup result alone is not native window destruction');
    console.log('T2 close observation: real app publishes only settled cleanup once, independently of native destruction passed');
  }
  for (const rejects of [false, true]) {
    const h = harness({ closeSession: () => rejects ? Promise.reject(new Error('controlled close failure')) : Promise.resolve({ status: 'error', error: { message: 'controlled release failure' } }) });
    await h.hooks.onPluginCreate({ path: h.root }); const observed = [];
    h.win.EVADiagnostics.subscribe(event => { if (/^close-/.test(event.type)) observed.push(event); });
    await h.hooks.onPluginBeforeExit().catch(() => {}); await tick();
    assert.equal(observed.length, 1); assert.equal(observed[0].value.status, 'error');
    assert.match(observed[0].value.error.message, /controlled/);
    console.log('T2 close observation: '+(rejects ? 'rejected' : 'error result')+' cleanup preserved without success passed');
  }
  {
    const h = harness({ realSession: true });
    const loading = h.hooks.onPluginCreate({ path: h.root });
    await tick(); assert.strictEqual(h.counts().discovered, 1);
    await bounded(h.hooks.onPluginBeforeExit()); await bounded(loading);
    assert.strictEqual(h.counts().prepared, 0); assert.strictEqual(h.counts().destroyed, 1);
    assert.strictEqual(h.updates.at(-1).state, 'closing');
    console.log('T1 app: real session closes while SDK discovery never returns passed; Eagle not executed');
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { harness, bounded };
