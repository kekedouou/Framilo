'use strict';
// Actual Session and actual app entry with memory-only media/cache/host models.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { createSession } = require('../plugin/session.cjs');
const { DEFAULT_INTERACTION } = require('../plugin/preferences.cjs');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const sha = 'a'.repeat(64), source = Object.freeze({ id: 'same-material', itemId: 'same-material', name: 'same source', filePath: path.resolve('model-source.mp4'), ext: 'mp4' });
function sessionModel(settings = {}) {
  const calls = [], players = [], drawings = []; let backend = 'proxy', memory = { ramMiB: 1024, ramBytes: 1024 ** 3 }, interaction = DEFAULT_INTERACTION;
  const preferences = { snapshot: () => memory, quality: () => '720p', forwardPredecode: () => true, interaction: () => interaction, backend: () => backend,
    preview: ramMiB => ({ ramMiB }), save(ramMiB, _quality, _predecode, nextInteraction, nextBackend = backend) { backend = nextBackend; interaction = nextInteraction; memory = { ramMiB, ramBytes: ramMiB * 1024 ** 2 }; } };
  const cache = { readAsset: async () => Buffer.from('registered frame'),
    target(info, time) { calls.push(['target', info, time]); }, cancelReads(info) { calls.push(['cancel', info]); },
    prefetch(info, time, loop) { calls.push(['prefetch', info, time, loop]); },
    backgroundStatus: info => ({ stage: 'preparing', ready: info.frames.length, total: 10 }),
    async release(info) { calls.push(['release-start', info]); if (settings.release) await settings.release(info); calls.push(['background-closed', info]); } };
  const media = { async prepare(selected, options) {
    calls.push(['prepare', options.playbackBackend, selected, options]);
    if (settings.prepare) await settings.prepare(selected, options);
    return { source: { ...selected, sha256: sha }, duration: 3, width: 1280, height: 720,
      preview: { quality: '720p' }, frames: [0, 1, 2].map(id => ({ id, time: id, file: id + (options.playbackBackend === 'proxy' ? '.avc' : '.jpg') })),
      ...(options.playbackBackend === 'proxy' ? { streaming: 'segments-v1', videoEncoding: { format: 'annexb-idr-v1', codec: 'avc1.42001f' } } : {}) };
  } };
  const session = createSession({ memoryPreferences: preferences, media, cache,
    eagleAdapter: { captureSelected: () => source, drawingLibrary: () => path.resolve('model-library') },
    annotationStore: { read(binding) { drawings.push(binding); return { records: [] }; } },
    createPlayer(options) {
      const player = { options, info: null, state: { state: 'loading', time: 0, frameId: null, frameOrdinal: null },
        snapshot() { return { ...this.state }; }, change(value) { this.state = { ...this.state, ...value }; options.onChange(this.snapshot()); },
        async load(info) { this.info = info; await options.readAsset({ ...info }, info.frames[0].file); if(settings.load)await settings.load(info); this.change({ state: 'paused', time: 0, frameId: 0, frameOrdinal: 0 }); },
        async play() { this.change({ state: 'playing' }); return { status: 'playing' }; },
        async pause() { this.change({ state: 'paused' }); return { status: 'paused' }; },
        async seek(time, details = {}) { const id = details.index ?? Math.floor(time); this.change({ state: 'paused', time: this.info.frames[id].time, frameId: id, frameOrdinal: id }); return { status: 'drawn', frameId: id }; },
        async step(delta) { return this.seek(this.state.time + delta); },
        async dispose() { calls.push(['dispose', this.info]); options.cancelMediaReads(); this.change({ state: 'disposed' }); },
        async restoreTransport(value) { this.change({ transport: value }); return { status: 'applied' }; }
      }; players.push(player); return player;
    } });
  return { session, calls, players, drawings, preferences };
}
async function entryModel(mode = 'proxy') {
  const root = path.resolve(__dirname, '../plugin'), code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const hooks = {}, calls = [], updates = []; let configured, clientOptions;
  const info = { leaseId: 'b'.repeat(24), source: { ...source, sha256: sha },
    ...(mode === 'proxy' ? { videoEncoding: 'filmcraft-native', nativeRuntime: { identity: 'model-native-runtime' } } : {}) };
  const backend = { media: { async prepare(selected, settings) { calls.push(['prepare', selected, settings]); return info; } },
    cache: { readAsset: async () => Buffer.from('frame'), readAudioSegment: async () => null, readFrameBatch: async () => [], release: async () => true,
      prefetch(...args) { calls.push(['prefetch', ...args]); }, target(...args) { calls.push(['target', ...args]); }, cancelReads(...args) { calls.push(['cancel', ...args]); },
      backgroundStatus(value) { assert.strictEqual(value, info); return { stage: 'complete', ready: 10, total: 10 }; }, clearOther: async () => ({ cleared: 0 }) },
    exports: {}, beginClose() { calls.push(['begin-close']); }, async close() { calls.push(['background-close']); return { status: 'closed' }; } };
  const session = { loadSelected: async () => ({ status: 'ready' }), close: async () => ({ status: 'closed' }), hasDrawingDraft: () => false,
    snapshot: () => ({ epoch: 1, libraryEpoch: 1, sourceIdentity: { itemId: source.id, sha256: sha } }) };
  const modules = {
    'eagle.cjs': { createEagleAdapter: () => ({ captureSelected: () => source, discoverTools: async () => ({ ffmpeg: 'existing-only' }) }) },
    'preferences.cjs': { createMemoryPreferences: () => ({ snapshot: () => ({ ramBytes: 1024 ** 3, compressedRamBytes: 128 * 1024 ** 2 }), backend: () => mode, forwardPredecode: () => true,
      decoderPreference: () => 'prefer-hardware', proxyEncoder: () => 'cpu', automaticProxy: () => true, gpuDrawing: () => true }) },
    'drawing-store.cjs': { createAnnotationStore: () => null }, 'frame-index.cjs': {},
    'diagnostics.cjs': require('../plugin/diagnostics.cjs'),
    'task-client.cjs': { createTaskClient(options) { clientOptions = options; return backend; } },
    'native-backend.cjs': { createNativeBackend(options) { clientOptions = options; return backend; } },
    'media-policy.cjs': {createJpegGate:()=>async()=>{}},
    'session.cjs': { createSession(options) { configured = options; return session; } }
  };
  const win = { addEventListener() {}, close() {}, EVAUI: { createUI: () => ({ canvas: {}, bindSession() {}, update(value) { updates.push(value); }, destroy() {} }) },
    EVAPlayer: { Player: function (options) { this.options = options; } }, EVANativePlayer: { Player: function (options) { this.options = options; this.native = true; } }, EVAProxyDecoder: { createProxyDecoder: settings => ({ settings, persistentDecoder: true }) } };
  const eagle = Object.fromEntries(['onPluginCreate', 'onPluginRun', 'onLibraryChanged', 'onPluginBeforeExit', 'onPluginShow', 'onPluginHide'].map(name => [name, fn => { hooks[name] = fn; }]));
  vm.runInNewContext(code, { window: win, eagle, performance: { now: () => 100 }, Promise, setTimeout,
    require(name) { if (name === 'path') return path; if (name === 'fs') return { realpathSync: value => value }; const api = modules[path.basename(name)]; assert(api, name); return api; } });
  await hooks.onPluginCreate({ path: root });
  return { configured, get clientOptions() { return clientOptions; }, hooks, calls, updates, info };
}
async function main() {
  let count = 0;
  const test = async (name, fn) => { await fn(); count++; console.log('ok proxy session: ' + name); };
  await test('backend choice reaches preparation and original SHA reaches drawings', async () => {
    const h = sessionModel(); assert.equal((await h.session.loadSelected()).status, 'ready');
    assert.equal(h.calls.find(c => c[0] === 'prepare')[1], 'proxy'); assert.equal(h.session.snapshot().playbackBackend, 'proxy');
    assert.equal(h.drawings[0].sourceSha256, sha); assert.equal(h.session.snapshot().sourceIdentity.sha256, sha);
    const info = h.players[0].info; h.players[0].options.prefetchMedia(1, null); assert.strictEqual(h.calls.find(c => c[0] === 'prefetch')[1], info);
    assert.deepEqual(h.session.snapshot().proxyPreparation, { stage: 'preparing', ready: 3, total: 10 }); await h.session.close();
    assert(h.calls.find(c => c[0] === 'background-closed'));
  });
  await test('mode switch retains exact current source frame and SHA, cancels old work before rebuilding', async () => {
    const h = sessionModel(); await h.session.loadSelected(); await h.session.seek(2, { final: true }); await h.session.toggle();
    const old = h.players[0].info; await h.session.setPlaybackSettings({ ramMiB: 1024, playbackBackend: 'jpeg' });
    const snap = h.session.snapshot(); assert.equal(snap.state, 'paused', JSON.stringify(snap.error)); assert.equal(snap.playback.frameOrdinal, 2); assert.equal(snap.playback.time, 2);
    assert.equal(snap.sourceIdentity.sha256, sha); assert(h.drawings.every(binding => binding.sourceSha256 === sha));
    assert.deepEqual(h.calls.filter(c => c[0] === 'prepare').map(c => c[1]), ['proxy', 'jpeg']);
    assert(h.calls.findIndex(c => c[0] === 'cancel' && c[1] === old) < h.calls.findIndex(c => c[0] === 'background-closed' && c[1] === old));
    assert(h.calls.findIndex(c => c[0] === 'background-closed' && c[1] === old) < h.calls.findIndex(c => c[0] === 'prepare' && c[1] === 'jpeg'));
    await h.session.setPlaybackSettings({ ramMiB: 1024, playbackBackend: 'proxy' }); assert.equal(h.session.snapshot().playback.frameOrdinal, 2); await h.session.close();
  });
  await test('close during replacement preparation aborts it and cannot revive the old backend', async () => {
    let entered, signal; const started = new Promise(resolve => { entered = resolve; });
    const h = sessionModel({ prepare(_source, options) { if (options.playbackBackend !== 'jpeg') return;
      signal = options.signal; entered(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled prepare'), { name: 'AbortError' })), { once: true })); } });
    await h.session.loadSelected(); const changing = h.session.setPlaybackSettings({ ramMiB: 1024, playbackBackend: 'jpeg' }); await started;
    await h.session.close(); await changing; assert(signal.aborted); assert.equal(h.session.snapshot().state, 'closed'); assert.equal(h.players.length, 1);
  });
  await test('unsupported proxy decoder fails visibly and JPEG settings can recover the same source', async () => {
    const h=sessionModel({load(info){if(info.videoEncoding)throw Object.assign(Error('proxy decoder unavailable'),{code:'PROXY_UNSUPPORTED'});}});
    assert.equal((await h.session.loadSelected()).status,'error');assert.equal(h.session.snapshot().error.code,'PROXY_UNSUPPORTED');
    assert.equal(h.players.length,1);assert(h.calls.some(c=>c[0]==='background-closed'));
    const changed=await h.session.setPlaybackSettings({ramMiB:1024,playbackBackend:'jpeg'});assert.equal(changed.status,'ready');
    assert.equal(h.session.snapshot().playbackBackend,'jpeg');assert.equal(h.session.snapshot().sourceIdentity.sha256,sha);await h.session.close();
  });
  await test('E51 pending preparation choice aborts cleanly when mode switches or window closes',async()=>{
    for(const close of [false,true]){let entered;const waiting=new Promise(r=>entered=r);const h=sessionModel({prepare:async(selected,options)=>{if(options.playbackBackend==='proxy'){entered();await options.requestDecision({kind:'decoder-routing',choices:[{value:'jpeg'}]});}}});
      const opening=h.session.loadSelected();await waiting;await flush();const id=h.session.snapshot().decision.id;
      if(close){await h.session.close();assert.equal(h.session.snapshot().decision,null);}else{const next=await h.session.setPlaybackSettings({ramMiB:1024,playbackBackend:'jpeg'});assert.equal(next.status,'ready');assert.equal(h.session.snapshot().decision,null);assert.equal(h.session.snapshot().playbackBackend,'jpeg');}
      assert.equal(h.session.answerDecision(id,'jpeg'),false);assert.equal((await opening).status,'superseded');await h.session.close();
    }
  });
  await test('actual app entry forwards native runtime and background status without old preview layers', async () => {
    const h = await entryModel(), signal = new AbortController().signal;
    assert.strictEqual(await h.configured.media.prepare(source, { playbackBackend: 'proxy', previewQuality: '720p', signal }), h.info);
    const request = h.calls.find(c => c[0] === 'prepare'); assert.strictEqual(request[1], source); assert.equal(request[2].playbackBackend, 'proxy'); assert.strictEqual(request[2].signal, signal);
    assert.equal(h.configured.cache.backgroundStatus(h.info).stage, 'complete'); const before = h.updates.length; h.clientOptions.onBackground(); assert.equal(h.updates.length, before + 1);
    const player = h.configured.createPlayer({ mediaInfo: h.info }); assert(player.native); assert.strictEqual(player.options.nativeRuntime, h.info.nativeRuntime);
    assert.equal(h.clientOptions.decoderPreference, 'prefer-hardware'); assert.equal(h.clientOptions.automaticProxy, true);
    assert.equal(Object.keys(h.configured.createPreviewServices({ info: h.info })).length, 0, 'native source has no old provisional preview layers');
    await assert.rejects(() => h.configured.exports.create({}), /当前界面未开放导出/);
    await h.hooks.onPluginBeforeExit(); assert(h.calls.find(c => c[0] === 'background-close'));
    const closed = h.updates.length; h.clientOptions.onBackground(); assert.equal(h.updates.length, closed);
  });
  await test('JPEG app keeps the original provider and guarded unavailable exports', async () => {
    const h = await entryModel('jpeg'); await h.configured.media.prepare(source, { playbackBackend: 'jpeg', previewQuality: '720p' });
    const player = h.configured.createPlayer({ mediaInfo: h.info }); assert(!player.native);
    const decoder = player.options.createFrameDecoder({ token: 7 }); assert.equal(decoder.settings.token, 7); assert(decoder.persistentDecoder);
    await assert.rejects(() => h.configured.exports.publish({}), /当前界面未开放导出/); await h.hooks.onPluginBeforeExit();
  });
  console.log('Proxy Session: ' + count + ' real Session/app assembly models; no media, native host or library writes.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
