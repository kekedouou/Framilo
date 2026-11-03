'use strict';
// Session ownership/ordering in memory; no Eagle, files, tools or media output.
const assert = require('assert');
const path = require('path');
const { createSession } = require('../plugin/session.cjs');
let tests = 0;
async function test(name, body) { await body(); tests++; console.log('ok ' + name); }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const flush = () => new Promise(resolve => setImmediate(resolve));
const selected = id => Object.freeze({ id, itemId: id, name: '中文 ' + id, filePath: path.resolve('中文 ' + id + '.mp4'), ext: 'mp4' });
function harness(settings = {}) {
  const h = { selection: selected('A'), calls: 0, prepared: [], released: [], players: [], reads: [], changes: [], events: [], clock: 100 };
  h.makeInfo = value => ({ source: { ...value, file: value.filePath, sha256: 'a'.repeat(64) }, duration: 3,
    frames: [0, 1, 2].map(id => ({ id, time: id, file: String(id) + '.jpg' })), metrics: { reused: false } });
  const eagleAdapter = { captureSelected() { h.calls++; return settings.capture ? settings.capture(h) : h.selection; } };
  const media = { async prepare(value, options) {
    h.prepared.push({ selected: value, options }); h.events.push('prepare-' + value.id);
    return settings.prepare ? settings.prepare(value, options, h) : h.makeInfo(value);
  } };
  const cache = { async readAsset(info, file) { h.reads.push({ info, file }); return Buffer.from('registered asset'); },
    readFrameBatch: settings.readFrameBatch,
    clearOther: settings.clearOther,
    async release(info) { if (settings.release) await settings.release(info, h); h.released.push(info); h.events.push('release-' + info.source.id); } };
  function createPlayer(options) {
    const player = { options, info: null, disposed: false, disposeDone: false,
      value: { state: 'loading', time: 0, frameId: null, frameOrdinal: null },
      change(value) { this.value = { ...this.value, ...value }; options.onChange({ ...this.value }); },
      snapshot() { return { ...this.value }; },
      setForwardPredecode(enabled) { this.value.forwardPredecode=enabled; h.events.push('forward-'+enabled); },
      async load(info) {
        this.info = info; this.change({ state: 'loading' });
        await options.readAsset({ ...info }, info.frames[0].file);
        if (settings.load) await settings.load(this, info, h);
        this.change({ state: 'paused', time: 0, frameId: info.frames[0].id, frameOrdinal: 0 });
      },
      async dispose() {
        this.disposed = true; h.events.push('stop-' + (this.info && this.info.source.id));
        if (settings.dispose) await settings.dispose(this, h);
        this.disposeDone = true; this.change({ state: 'disposed' }); h.events.push('disposed-' + (this.info && this.info.source.id));
      },
      async play() { this.change({ state: 'playing' }); return { status: 'playing' }; },
      async pause() { this.change({ state: 'paused' }); return { status: 'paused' }; },
      async seek(time, options) {
        this.change({ state: 'seeking' }); if (settings.seek) await settings.seek(this, time, options, h);
        const index = options.index === undefined ? Math.max(0, Math.min(2, Math.floor(time))) : options.index;
        this.change({ state: 'paused', time: this.info.frames[index].time, frameId: this.info.frames[index].id, frameOrdinal: index });
        return { status: 'drawn', frameId: index };
      },
      async step(delta) { return this.seek(Math.max(0, Math.min(2, this.value.frameOrdinal + delta)), { final: true }); },
      async restoreTransport(value) { if (settings.restoreTransport) await settings.restoreTransport(this,value,h);
        h.events.push('restore-transport'); this.change({transport:value}); return {status:'applied'}; }
    };
    if (settings.configurePlayer) settings.configurePlayer(player, h);
    h.players.push(player); return player;
  }
  h.session = createSession({ eagleAdapter, media, cache, createPlayer, now: () => h.clock, memoryPreferences: settings.memoryPreferences,
    createPreviewServices: settings.createPreviewServices,
    onChange(value) { h.changes.push(value); if (settings.onChange) settings.onChange(value, h); } });
  return h;
}
async function main() {
  await test('E41 direct and released seeks retain provisional preview until the exact frame is drawn', async () => {
    const gate=deferred(), calls=[]; let pending=false, clears=0;
    const quick={snapshot:()=>({active:false,pending}),request(t,o){pending=true;calls.push({t,o});},clear(){pending=false;clears++;},cancel(){pending=false;},async close(){pending=false;}};
    const h=harness({createPreviewServices:()=>({quick}),seek:async(p,time)=>{p.change({pendingTargets:1,targetTime:time});await gate.promise;p.change({pendingTargets:0});}});
    await h.session.loadSelected();calls.length=0;clears=0;
    const jump=h.session.seek(2,{final:true});
    assert.equal(calls.length,1);assert.equal(calls[0].t,2);assert.equal(calls[0].o.final,true);assert.equal(calls[0].o.delayMs,80);
    assert.equal(pending,true);assert.equal(clears,0);
    gate.resolve();await jump;assert.equal(pending,false);assert.equal(clears,1);await h.session.close();
  });
  await test('E41 changing encoder/decoder waits for old ownership, reloads paused and preserves source position',async()=>{
    let enc='cpu',dec='prefer-hardware';const prefs={snapshot:()=>({ramMiB:1024}),quality:()=> '720p',forwardPredecode:()=>true,playbackBackend:()=> 'proxy',proxyEncoder:()=>enc,decoderPreference:()=>dec,preview(){},save(_ram,_q,_p,_ui,_backend,e,d){enc=e;dec=d;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>({...m.makeInfo(v),preview:{quality:o.previewQuality}})});
    await h.session.loadSelected();await h.session.seek(2);
    await h.session.setPlaybackSettings({ramMiB:1024,proxyEncoder:'nvidia',decoderPreference:'prefer-software'});
    assert.equal(h.prepared.length,2);assert.equal(h.prepared[1].options.proxyEncoder,'nvidia');assert.equal(h.session.snapshot().decoderPreference,'prefer-software');
    assert.equal(h.session.snapshot().playback.time,2);assert.equal(h.session.snapshot().state,'paused');assert(h.events.indexOf('release-A')<h.events.lastIndexOf('prepare-A'));
    await assert.rejects(()=>h.session.setPlaybackSettings({ramMiB:1024,proxyEncoder:'hevc'}));await h.session.close();
  });
  await test('Batch preload delegates the original cache lease rather than the Player manifest copy', async () => {
    let original, requested;
    const h = harness({ readFrameBatch: async (info, files) => { original = info; requested = files; return [Buffer.from('frame')]; } });
    await h.session.loadSelected(); const p = h.players[0]; await p.options.readFrameBatch({ ...p.info }, ['0.jpg']);
    assert.strictEqual(original, p.info); assert.deepEqual(requested, ['0.jpg']); await h.session.close();
  });
  await test('Closing while cache clearing is pending suppresses its late result', async () => {
    const issued = deferred(), finish = deferred();
    const h = harness({ clearOther() { issued.resolve(); return finish.promise; } });
    await h.session.loadSelected(); const cleaning = h.session.clearOtherCaches(); await issued.promise;
    await h.session.close(); const changes = h.changes.length;
    finish.resolve({ cleared: 1, freedBytes: 123 }); assert.equal((await cleaning).status, 'superseded');
    assert.equal(h.session.snapshot().state, 'closed'); assert.equal(h.changes.length, changes); assert.equal(h.released.length, 1);
  });
  await test('Closing during a seek ignores the old picture result and never restores playback', async () => {
    const gate = deferred(), issued = deferred();
    const h = harness({ seek: async () => { issued.resolve(); await gate.promise; } });
    await h.session.loadSelected(); const locating = h.session.seek(2); await issued.promise;
    await h.session.close(); const changes = h.changes.length; gate.resolve(); await locating;
    assert.equal(h.session.snapshot().state, 'closed'); assert.equal(h.changes.length, changes); assert.equal(h.released.length, 1);
  });
  await test('Manual cache clearing pauses and protects the loaded source rather than a new Eagle selection',async()=>{
    let request;const h=harness({clearOther(value){request=value;return {cleared:2,freedBytes:400};}});
    await h.session.loadSelected();await h.session.seek(2,{final:true});await h.session.toggle();h.selection=selected('B');
    const r=await h.session.clearOtherCaches();assert.equal(request.sourceSha256,'a'.repeat(64));assert.equal(r.cleared,2);
    assert.equal(h.session.snapshot().state,'paused');assert.equal(h.session.snapshot().playback.time,2);assert.equal(h.calls,1);await h.session.close();
    await assert.rejects(()=>h.session.clearOtherCaches(),/等待视频/);
  });
  await test('Ready metrics separate media preparation and Player initialization without changing the readiness boundary',async()=>{
    const h=harness({prepare(value,_options,model){model.clock+=20;return {...model.makeInfo(value),metrics:{reused:true,phaseMs:{existingCacheValidationMs:12}}};},
      load(_p,_info,model){model.clock+=30;}});
    const r=await h.session.loadSelected({startedAt:100});const m=r.snapshot.loadMetrics;
    assert.equal(m.totalMs,50);assert.equal(m.mediaPrepareMs,20);assert.equal(m.playerLoadMs,30);
    assert.deepEqual(m.mediaPhaseMs,{existingCacheValidationMs:12});assert(m.reused);await h.session.close();
  });
  await test('RAM apply pins current source/position, pauses, persists and disposes before replacement', async () => {
    let ramMiB = 1024, saves = 0;
    const h = harness({ memoryPreferences: { snapshot: () => ({ ramMiB }), preview(value) { if (!(value > 0)) throw new Error('invalid tier'); },
      save(value) { ramMiB = value; saves++; } } });
    await h.session.loadSelected(); await h.session.seek(2, { final: true }); await h.session.toggle();
    const source = h.session.snapshot().source.id; h.selection = selected('B');
    const result = await h.session.setMemoryMiB(2048);
    assert.equal(result.status, 'ready'); assert.equal(saves, 1); assert.equal(ramMiB, 2048);
    assert.equal(h.session.snapshot().source.id, source); assert.equal(h.session.snapshot().playback.time, 2);
    assert.equal(h.session.snapshot().state, 'paused'); assert.equal(h.players.length, 2); assert.equal(h.calls, 1);
    await h.session.close();
  });
  await test('Invalid RAM tier or failed persistence cannot invalidate the current video', async () => {
    const h = harness({ memoryPreferences: { snapshot: () => ({ ramMiB: 1024 }), preview(value) { if (!(value > 0)) throw new Error('invalid tier'); },
      save() { throw new Error('disk refused'); } } });
    await h.session.loadSelected(); await h.session.seek(2, { final: true });
    await assert.rejects(() => h.session.setMemoryMiB(0), /invalid tier/);
    await assert.rejects(() => h.session.setMemoryMiB(2048), /disk refused/);
    assert.equal(h.players.length, 1); assert.equal(h.session.snapshot().playback.time, 2);
    await h.session.close();
  });
  for (const action of ['switch', 'close']) await test('RAM apply waits old disposal and cannot override a later ' + action, async () => {
    const gate = deferred(); let disposed = 0;
    const h = harness({ memoryPreferences: { snapshot: () => ({}), preview() {}, save() {} },
      async dispose() { if (!disposed++) await gate.promise; } });
    await h.session.loadSelected(); const apply = h.session.setMemoryMiB(2048); await flush();
    assert.equal(h.players.length, 1); assert(h.players[0].disposed); assert.equal(h.released.length, 0);
    h.selection = selected('B'); const next = action === 'switch' ? h.session.loadSelected() : h.session.close();
    await flush(); assert.equal(h.players.length, 1); gate.resolve(); await Promise.all([apply, next]);
    assert.equal(h.session.snapshot().state, action === 'switch' ? 'paused' : 'closed');
    if (action === 'switch') { assert.equal(h.session.snapshot().source.id, 'B'); await h.session.close(); }
  });
  await test('Insufficient RAM load can be retried at the original displayed position', async () => {
    let reject = true;
    const h = harness({ memoryPreferences: { snapshot: () => ({}), preview() {}, save() {} },
      load: async (_p, _info, model) => { if (model.players.length === 2 && reject) throw new Error('RAM insufficient'); } });
    await h.session.loadSelected(); await h.session.seek(2, { final: true });
    assert.equal((await h.session.setMemoryMiB(512)).status, 'error');
    reject = false; assert.equal((await h.session.setMemoryMiB(2048)).status, 'ready');
    assert.equal(h.session.snapshot().playback.time, 2); assert.equal(h.session.snapshot().state, 'paused');
    await h.session.close();
  });
  await test('A selection made synchronously during RAM notification wins over the retained source', async () => {
    let ramMiB = 1024, switching = null;
    const h = harness({ memoryPreferences: { snapshot: () => ({ ramMiB }), preview() {}, save(v) { ramMiB = v; } },
      onChange(value, model) { if (ramMiB === 2048 && !switching && value.state === 'paused') {
        switching = true; model.selection = selected('B'); switching = model.session.loadSelected();
      } } });
    await h.session.loadSelected(); assert.equal((await h.session.setMemoryMiB(2048)).status, 'superseded');
    await switching; assert.equal(h.session.snapshot().source.id, 'B'); await h.session.close();
  });
  await test('Read-only snapshots follow completed background work without UI notifications', async () => {
    const h = harness(); await h.session.loadSelected(); const player = h.players[0];
    player.change({ activeImageTasks: 1, cacheBytes: 100, rafOpportunity: 20 });
    const observed = h.session.snapshot(), changes = h.changes.length;
    player.value = { ...player.value, activeImageTasks: 0, cacheBytes: 80, rafOpportunity: 23 };
    const current = h.session.snapshot();
    assert.strictEqual(observed.playback.activeImageTasks, 1);
    assert.strictEqual(current.playback.activeImageTasks, 0);
    assert.strictEqual(current.playback.cacheBytes, 80); assert.strictEqual(current.playback.rafOpportunity, 23);
    assert.strictEqual(h.changes.length, changes, 'Observation must not notify or draw UI');
    await h.session.close(); assert.strictEqual(h.session.snapshot().playback, null);
  });
  await test('A changing or closing session never borrows the old player live snapshot', async () => {
    const gate = deferred(), h = harness({ capture: value => value.calls === 2 ? gate.promise : value.selection });
    await h.session.loadSelected(); const old = h.players[0]; old.value = { ...old.value, activeImageTasks: 1 };
    const loading = h.session.loadSelected(); assert.strictEqual(h.session.snapshot().playback, null);
    gate.resolve(selected('B')); await loading;
    old.value = { ...old.value, activeImageTasks: 99, frameId: 99 };
    assert.strictEqual(h.session.snapshot().playback.frameId, 0); await h.session.close();
  });
  await test('Selection starts once at entry; load uses adopted mode and original cache handle', async () => {
    const h = harness(); const pending = h.session.loadSelected({ startedAt: 10 });
    assert.strictEqual(h.calls, 1); assert.strictEqual(h.session.snapshot().state, 'preparing');
    assert.strictEqual((await pending).status, 'ready'); const state = h.session.snapshot();
    assert.strictEqual(state.state, 'paused'); assert.strictEqual(state.playback.frame, 0); assert.strictEqual(state.sourceIdentity.itemId, 'A');
    assert.strictEqual(state.loadMetrics.totalMs, 90); assert.strictEqual(h.players[0].options.experimentMode, 'compressed-ram');
    assert.strictEqual(h.reads[0].info, h.players[0].info); assert(Object.isFrozen(state.source));
    assert(h.changes.filter(value => value.playback && value.playback.frameId === 0).slice(0, -1).every(value => value.state === 'preparing'));
    await h.session.close(); assert.strictEqual(h.released.length, 1);
  });
  await test('Cancelled slow selection does not block latest invocation or become old media', async () => {
    const old = deferred(); const h = harness({ capture: value => value.calls === 1 ? old.promise : value.selection });
    const first = h.session.loadSelected(); await flush(); h.selection = selected('B'); const second = h.session.loadSelected();
    assert.strictEqual(h.calls, 2); assert.strictEqual((await first).status, 'superseded'); assert.strictEqual((await second).status, 'ready');
    old.resolve(selected('A')); await flush(); assert.deepStrictEqual(h.prepared.map(value => value.selected.id), ['B']);
    assert.strictEqual(h.session.snapshot().source.id, 'B'); await h.session.close();
  });
  await test('Switch aborts preparation but waits its real exit and releases before new preparation', async () => {
    const old = deferred(); const h = harness({ prepare: async (value, options, state) => value.id === 'A' ? old.promise : state.makeInfo(value) });
    const first = h.session.loadSelected(); await flush(); h.selection = selected('B'); const second = h.session.loadSelected();
    assert.strictEqual(h.prepared[0].options.signal.aborted, true); assert.strictEqual(h.prepared.length, 1);
    old.resolve(h.makeInfo(selected('A'))); await first; await second;
    assert(h.events.indexOf('release-A') < h.events.indexOf('prepare-B')); assert.strictEqual(h.released[0].source.id, 'A'); await h.session.close();
  });
  await test('Switch stops player synchronously and holds lease through real load and dispose completion', async () => {
    const loading = deferred(), disposing = deferred();
    const h = harness({ load: (player, info) => info.source.id === 'A' ? loading.promise : undefined,
      dispose: player => player.info.source.id === 'A' ? disposing.promise : undefined });
    const first = h.session.loadSelected(); await flush(); h.selection = selected('B'); const second = h.session.loadSelected();
    assert.strictEqual(h.players[0].disposed, true); assert.strictEqual(h.released.length, 0); assert.strictEqual(h.prepared.length, 1);
    loading.resolve(); await flush(); assert.strictEqual(h.released.length, 0); disposing.resolve(); await first; await second;
    assert(h.events.indexOf('disposed-A') < h.events.indexOf('release-A')); assert(h.events.indexOf('release-A') < h.events.indexOf('prepare-B'));
    await h.session.close();
  });
  await test('Old player/progress callbacks cannot replace newer source or displayed frame', async () => {
    const h = harness(); await h.session.loadSelected(); const old = h.players[0], progress = h.prepared[0].options.onProgress;
    h.selection = selected('B'); await h.session.loadSelected(); old.options.onChange({ state: 'playing', frameId: 999, time: 999 }); progress({ stage: 'wrong' });
    assert.strictEqual(h.session.snapshot().source.id, 'B'); assert.strictEqual(h.session.snapshot().playback.frame, 0); assert.strictEqual(h.session.snapshot().progress, null);
    await h.session.close();
  });
  await test('Controls enforce ready/seek gates; latest displayed frame drives state', async () => {
    const seek = deferred(), h = harness({ seek: () => seek.promise });
    await assert.rejects(h.session.play(), error => error.code === 'SESSION_NOT_READY'); await h.session.loadSelected();
    await h.session.toggle(); assert.strictEqual(h.session.snapshot().state, 'playing'); await h.session.toggle();
    const pending = h.session.seek(2.9, { kind: 'drag', final: false });
    assert.strictEqual(h.session.snapshot().state, 'seeking'); assert.strictEqual(h.session.snapshot().playback.time, 0);
    await assert.rejects(h.session.play(), error => error.code === 'SESSION_NOT_READY'); seek.resolve(); await pending;
    assert.strictEqual(h.session.snapshot().playback.time, 2); await h.session.step(-1); assert.strictEqual(h.session.snapshot().playback.frame, 1); await h.session.close();
  });
  await test('E57 native pending seeks accept play and a second toggle pauses the pending play request',async()=>{
    const h=harness();await h.session.loadSelected();const p=h.players[0];p.change({native:true,state:'seeking',pendingTargets:1,frameHeld:true});
    assert.equal((await h.session.play()).status,'playing');p.change({state:'seeking',pendingTargets:1,playRequested:true});assert.equal((await h.session.toggle()).status,'paused');
    await h.session.close();await assert.rejects(h.session.play(),e=>e.code==='SESSION_NOT_READY');
  });
  await test('Library change clears without reading selection; closed session cannot load again', async () => {
    const h = harness(); await h.session.loadSelected(); const old = h.players[0];
    const cleared = h.session.libraryChanged(); assert.strictEqual(old.disposed, true); assert.strictEqual(h.session.snapshot().source, null);
    await cleared; assert.strictEqual(h.calls, 1); assert.strictEqual(h.session.snapshot().libraryEpoch, 1); assert.strictEqual(h.session.snapshot().state, 'empty');
    h.selection = selected('B'); await h.session.retry(); assert.strictEqual(h.calls, 2); await h.session.close(); await h.session.close();
    assert.strictEqual((await h.session.loadSelected()).status, 'ignored'); assert.strictEqual(h.calls, 2); assert.strictEqual(h.session.snapshot().state, 'closed');
  });
  await test('Empty selection enters normal empty state and retry captures a fresh selection', async () => {
    const failure = new Error('请单选MP4'); failure.code = 'SELECTION_EMPTY';
    const h = harness({ capture: value => value.calls === 1 ? Promise.reject(failure) : value.selection });
    assert.strictEqual((await h.session.loadSelected()).status, 'empty'); assert.strictEqual(h.prepared.length, 0);
    assert.strictEqual(h.session.snapshot().error, null); assert.equal(h.session.snapshot().progress.stage,'selection-empty'); h.selection = selected('B'); await h.session.retry();
    assert.strictEqual(h.session.snapshot().source.id, 'B'); await h.session.close();
  });
  await test('API failure is not mistaken for empty selection; empty after ready releases the player', async () => {
    let empty=false;const h=harness({capture:value=>{if(empty)throw Object.assign(Error('none'),{code:'SELECTION_EMPTY'});return value.selection;}});
    await h.session.loadSelected();empty=true;assert.equal((await h.session.retry()).status,'empty');assert(h.players[0].disposed);assert.equal(h.session.snapshot().source,null);await h.session.close();
    const broken=harness({capture:()=>{throw Object.assign(Error('SDK unavailable'),{code:'SELECTION_API_UNAVAILABLE'});}});
    assert.equal((await broken.session.loadSelected()).status,'error');assert.equal(broken.session.snapshot().error.code,'SELECTION_API_UNAVAILABLE');await broken.session.close();
  });
  await test('Prepared source mismatch releases original handle and never creates a player', async () => {
    let prepared; const h = harness({ prepare: (value, options, state) => { prepared = state.makeInfo(selected('wrong')); return prepared; } });
    const result = await h.session.loadSelected(); assert.strictEqual(result.status, 'error'); assert.strictEqual(result.error.code, 'PREPARED_IDENTITY_MISMATCH');
    assert.strictEqual(h.players.length, 0); assert.strictEqual(h.released[0], prepared); await h.session.close();
  });
  await test('Disposal failure retains handle and blocks the next video', async () => {
    const h = harness({ dispose: () => Promise.reject(new Error('decoder still active')) }); await h.session.loadSelected();
    h.selection = selected('B'); const result = await h.session.loadSelected(); assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.error.code, 'SESSION_RELEASE_FAILED'); assert.strictEqual(h.prepared.length, 1); assert.strictEqual(h.released.length, 0);
    assert.strictEqual((await h.session.close()).status, 'error');
  });
  await test('Close during preparation stops immediately and waits before releasing late result', async () => {
    const gate = deferred(), h = harness({ prepare: () => gate.promise }); const pending = h.session.loadSelected(); await flush();
    const close = h.session.close(); assert.strictEqual(h.session.snapshot().state, 'closed'); assert.strictEqual(h.prepared[0].options.signal.aborted, true);
    assert.strictEqual(h.released.length, 0); gate.resolve(h.makeInfo(selected('A'))); await pending; await close;
    assert.strictEqual(h.players.length, 0); assert.strictEqual(h.released.length, 1); assert.strictEqual(h.session.snapshot().state, 'closed');
  });
  await test('Display cannot become interactive before actual player load resolves', async () => {
    const gate = deferred(); const h = harness({ load: async player => { player.change({ state: 'paused', time: 0, frameId: 0, frameOrdinal: 0 }); await gate.promise; } });
    const load = h.session.loadSelected(); await flush(); assert.strictEqual(h.session.snapshot().state, 'preparing');
    await assert.rejects(h.session.play(), error => error.code === 'SESSION_NOT_READY'); gate.resolve(); await load;
    assert.strictEqual(h.session.snapshot().state, 'paused'); await h.session.close();
  });
  await test('P03 includes final synchronous ready UI initialization before recording endpoint', async () => {
    let readyCalls = 0;
    const h = harness({ onChange: (value, state) => { if (value.state === 'paused') { readyCalls++; state.clock += 25; } } });
    const result = await h.session.loadSelected({ startedAt: 10 });
    assert.strictEqual(readyCalls, 1); assert.strictEqual(result.snapshot.loadMetrics.readyAt, 125);
    assert.strictEqual(h.session.snapshot().loadMetrics.totalMs, 115); await h.session.close();
  });
  await test('Reentrant latest load cannot be disposed by an older queued invocation', async () => {
    let switched = false;
    const h = harness({ onChange: (value, state) => {
      if (!switched && value.state === 'preparing') { switched = true; state.selection = selected('B'); state.newLoad = state.session.loadSelected(); }
    } });
    const old = h.session.loadSelected(); await old; await h.newLoad;
    assert.deepStrictEqual(h.prepared.map(value => value.selected.id), ['B']);
    assert.strictEqual(h.players[0].disposed, false); await h.session.play(); await h.session.close();
  });
  await test('Library-change notification can load a new source without stale cleanup disposing it', async () => {
    let switched = false;
    const h = harness({ onChange: (value, state) => {
      if (!switched && value.state === 'empty' && value.libraryEpoch === 1) {
        switched = true; state.selection = selected('B'); state.newLoad = state.session.loadSelected();
      }
    } });
    await h.session.loadSelected(); const cleared = h.session.libraryChanged(); await cleared; await h.newLoad;
    assert.strictEqual(h.session.snapshot().source.id, 'B'); assert.strictEqual(h.players[1].disposed, false);
    assert.strictEqual(h.released.length, 1); await h.session.close();
  });
  await test('Synchronous selection-side library change cannot restore obsolete preparing state', async () => {
    const h = harness({ capture: state => { state.clear = state.session.libraryChanged(); return selected('A'); } });
    assert.strictEqual((await h.session.loadSelected()).status, 'superseded'); await h.clear;
    assert.strictEqual(h.session.snapshot().state, 'empty'); assert.strictEqual(h.prepared.length, 0);
    assert.strictEqual(h.calls, 1); await h.session.close();
  });
  await test('Cache-release failure prevents new preparation and remains visible on repeated close', async () => {
    const h = harness({ release: () => { throw new Error('lease still held'); } }); await h.session.loadSelected();
    h.selection = selected('B'); const result = await h.session.loadSelected();
    assert.strictEqual(result.error.code, 'SESSION_RELEASE_FAILED'); assert.strictEqual(h.prepared.length, 1);
    assert.strictEqual(h.released.length, 0); assert.strictEqual((await h.session.close()).status, 'error');
    assert.strictEqual((await h.session.close()).status, 'error'); assert.strictEqual(h.session.snapshot().state, 'closed');
  });
  await test('Preparation cleanup failure survives cancellation and prevents false close success', async () => {
    const started = deferred();
    const h = harness({ prepare: (value, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('partial cleanup failed'), { code: 'MEDIA_CLEANUP_FAILED' })), { once: true });
      started.resolve();
    }) });
    const load = h.session.loadSelected(); await started.promise;
    const closed = h.session.close();
    assert.equal((await load).status, 'error');
    assert.equal((await closed).status, 'error');
    assert.equal((await h.session.close()).error.code, 'MEDIA_CLEANUP_FAILED');
  });
  await test('Current-video memory is observable during loading and invalidated before switching or closing', async () => {
    const gate = deferred();
    const h = harness({ load: async player => { player.value.budget = { used: 32, limit: 512 }; await gate.promise; } });
    assert.equal(h.session.memorySnapshot(), null);
    const pending = h.session.loadSelected(); await flush();
    assert.deepStrictEqual(h.session.memorySnapshot(), { used: 32, limit: 512 });
    const copy = h.session.memorySnapshot(); copy.used = 99; assert.equal(h.session.memorySnapshot().used, 32);
    gate.resolve(); await pending;
    const closing = h.session.close(); assert.equal(h.session.memorySnapshot(), null); await closing;
  });
  await test('E03 quality apply restores the same source frame, persists together and never rereads another selection', async () => {
    let q='720p', ram=1024; const preferences={quality:()=>q,snapshot:()=>({ramMiB:ram}),preview(){},save(v,next){ram=v;if(next!==undefined)q=next;}};
    const h=harness({memoryPreferences:preferences,prepare:async(value,settings,model)=>({...model.makeInfo(value),preview:{quality:settings.previewQuality,width:settings.previewQuality==='1080p'?1920:1280,height:settings.previewQuality==='1080p'?1080:720}})});
    await h.session.loadSelected(); await h.session.seek(2); await h.session.play(); h.selection=selected('B');
    assert.equal((await h.session.setPlaybackSettings({ramMiB:2048,previewQuality:'1080p'})).status,'ready');
    assert.equal(h.calls,1);assert.equal(h.session.snapshot().source.id,'A');assert.equal(h.session.snapshot().playback.frameId,2);
    assert.equal(h.session.snapshot().state,'paused');assert.equal(h.session.snapshot().previewQuality,'1080p');assert.equal(h.prepared[1].options.previewQuality,'1080p');
    assert(h.events.indexOf('disposed-A')<h.events.lastIndexOf('prepare-A'));await h.session.close();
  });
  await test('E03 retains an ordinal frame even when two source frames have identical times',async()=>{
    let q='720p';const prefs={quality:()=>q,snapshot:()=>({ramMiB:1024}),preview(){},save(_v,n){q=n;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>{const info=m.makeInfo(v);info.frames[1].time=0;return {...info,preview:{quality:o.previewQuality}};}});
    await h.session.loadSelected();await h.session.seek(0,{index:1});assert.equal(h.session.snapshot().playback.frameId,1);
    assert.equal((await h.session.setPlaybackSettings({ramMiB:1024,previewQuality:'1080p'})).status,'ready');
    assert.equal(h.session.snapshot().playback.frameId,1);assert.equal(h.session.snapshot().playback.time,0);await h.session.close();
  });
  await test('preparation mode switching aborts old work and ignores its late result',async()=>{
    let backend='jpeg';const gate=deferred();
    const prefs={backend:()=>backend,quality:()=> '720p',snapshot:()=>({ramMiB:1024}),preview(){},save(_m,_q,_p,_i,b){backend=b;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>{if(o.playbackBackend==='jpeg')await gate.promise;return {...m.makeInfo(v),preview:{quality:o.previewQuality}};}});
    const first=h.session.loadSelected();await flush();assert.equal(h.session.snapshot().state,'preparing');
    const next=h.session.setPlaybackSettings({ramMiB:1024,previewQuality:'720p',playbackBackend:'proxy'});await flush();
    assert(h.prepared[0].options.signal.aborted);assert.equal(h.prepared.length,1,'new task must wait for old cleanup');
    gate.resolve();assert.equal((await first).status,'superseded');assert.equal((await next).status,'ready');
    assert.equal(h.prepared[1].options.playbackBackend,'proxy');assert.equal(h.players.length,1);assert.equal(h.calls,1);
    assert.equal(h.session.snapshot().state,'paused');await h.session.close();
  });
  await test('E03 can recover initial preparation failure by applying settings without inventing a prior frame',async()=>{
    let q='720p';const prefs={quality:()=>q,snapshot:()=>({ramMiB:1024}),preview(){},save(_v,n){q=n;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>{if(m.prepared.length===1)throw Error('initial failure');return {...m.makeInfo(v),preview:{quality:o.previewQuality}};}});
    assert.equal((await h.session.loadSelected()).status,'error');assert.equal((await h.session.setPlaybackSettings({ramMiB:1024,previewQuality:'1080p'})).status,'ready');
    assert.equal(h.session.snapshot().playback.frameId,0);await h.session.close();
  });
  await test('E03 rejects mismatched quality and close during settings prepare cannot publish stale readiness', async()=>{
    let q='720p',hold=false;const gate=deferred(); const prefs={quality:()=>q,snapshot:()=>({ramMiB:1024}),preview(){},save(_v,next){q=next;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>{if(hold)await gate.promise;return {...m.makeInfo(v),preview:{quality:o.previewQuality}};}});
    await h.session.loadSelected();hold=true;const pending=h.session.setPlaybackSettings({ramMiB:1024,previewQuality:'1080p'});await flush();
    const closing=h.session.close();gate.resolve();assert.equal((await pending).status,'superseded');await closing;assert.equal(h.session.snapshot().state,'closed');
    const bad=harness({memoryPreferences:prefs,prepare:async(v,_o,m)=>({...m.makeInfo(v),preview:{quality:'720p'}})});
    assert.equal((await bad.session.loadSelected()).error.code,'PREVIEW_QUALITY_MISMATCH');await bad.session.close();
  });
  await test('E46 legacy requests cannot disable fixed forward preparation or recapture another selection',async()=>{
    let enabled=true;const prefs={snapshot:()=>({ramMiB:1024}),quality:()=> '720p',forwardPredecode:()=>enabled,preview(){},save(_m,_q,e){enabled=e;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>({...m.makeInfo(v),preview:{quality:o.previewQuality}})});
    await h.session.loadSelected();await h.session.seek(2);await h.session.play();const player=h.players[0];h.selection=selected('B');
    assert.equal((await h.session.setPlaybackSettings({ramMiB:1024,previewQuality:'720p',forwardPredecode:false})).status,'applied');
    assert.equal(h.calls,1);assert.equal(h.prepared.length,1);assert.strictEqual(h.players[0],player);assert.equal(h.session.snapshot().playback.frameId,2);
    assert.equal(h.session.snapshot().state,'paused');assert.equal(h.session.snapshot().forwardPredecode,true);assert(!h.events.includes('forward-false'));await h.session.close();
  });
  await test('E05 source ownership hides stale coverage during replacement and after close',async()=>{
    const h=harness();assert.equal(h.session.cacheCoverageSnapshot(),null);await h.session.loadSelected();
    h.players[0].cacheCoverageSnapshot=()=>({epoch:4,revision:1,ranges:[{start:0,end:1}]});
    const first=h.session.cacheCoverageSnapshot();assert.equal(first.sessionEpoch,h.session.snapshot().epoch);
    h.selection=selected('B');await h.session.loadSelected();assert.equal(h.session.cacheCoverageSnapshot(),null);
    h.players[1].cacheCoverageSnapshot=()=>({epoch:1,revision:1,ranges:[{start:0,end:2}]});
    assert(h.session.cacheCoverageSnapshot().sessionEpoch>first.sessionEpoch);await h.session.close();assert.equal(h.session.cacheCoverageSnapshot(),null);
  });
  await test('E06 routes transport controls and rejects obsolete operation completion after close',async()=>{
    const h=harness();await h.session.loadSelected();const p=h.players[0],calls=[];
    for(const method of ['setPlaybackRate','setLoopPoint','setLoopEnabled','clearLoop'])p[method]=async value=>{calls.push([method,value]);return {status:'applied'};};
    await h.session.setPlaybackRate(.5);await h.session.setLoopPoint('start');await h.session.setLoopEnabled(true);await h.session.clearLoop();
    assert.deepEqual(calls,[['setPlaybackRate',.5],['setLoopPoint','start'],['setLoopEnabled',true],['clearLoop',undefined]]);
    const gate=deferred();p.setPlaybackRate=async()=>{await gate.promise;p.change({state:'playing'});return {status:'playing'};};
    const pending=h.session.setPlaybackRate(.25);await h.session.close();const changes=h.changes.length;gate.resolve();
    assert.equal((await pending).status,'superseded');assert.equal(h.changes.length,changes);assert.equal(h.session.snapshot().state,'closed');
  });
  await test('E06 same-source settings restore transport paused; selecting a new video never inherits it',async()=>{
    let q='720p';const prefs={snapshot:()=>({ramMiB:1024}),quality:()=>q,forwardPredecode:()=>true,preview(){},save(_m,next){q=next;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>({...m.makeInfo(v),preview:{quality:o.previewQuality}})});
    await h.session.loadSelected();await h.session.seek(2);const transport={rate:.5,loop:{startId:0,endId:2,enabled:true}};h.players[0].change({transport});
    await h.session.setPlaybackSettings({ramMiB:2048,previewQuality:'1080p'});assert.equal(h.calls,1);assert.equal(h.session.snapshot().state,'paused');
    assert.deepEqual(h.session.snapshot().playback.transport,transport);assert.equal(h.session.snapshot().playback.frameId,2);
    h.selection=selected('B');await h.session.loadSelected();assert.equal(h.session.snapshot().playback.transport,undefined);
    assert.equal(h.events.filter(e=>e==='restore-transport').length,1);await h.session.close();
  });
  await test('E06 content hash change never restores the previous range or speed',async()=>{
    let q='720p';const prefs={snapshot:()=>({ramMiB:1024}),quality:()=>q,preview(){},save(_m,next){q=next;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>{const info=m.makeInfo(v);if(m.prepared.length>1)info.source.sha256='b'.repeat(64);return {...info,preview:{quality:o.previewQuality}};}});
    await h.session.loadSelected();h.players[0].change({transport:{rate:.25,loop:{startId:0,endId:2,enabled:true}}});
    assert.equal((await h.session.setPlaybackSettings({ramMiB:2048,previewQuality:'1080p'})).status,'ready');assert(!h.events.includes('restore-transport'));await h.session.close();
  });
  await test('UX wheel/strip apply persists and pauses the same player without media reload or predecode churn',async()=>{
    let interaction={wheelFrames:1,showCacheStrip:true},q='720p';
    const prefs={snapshot:()=>({ramMiB:1024}),quality:()=>q,forwardPredecode:()=>true,interaction:()=>interaction,preview(){},save(_m,next,_p,ui){if(next!==undefined)q=next;interaction=ui;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>({...m.makeInfo(v),preview:{quality:o.previewQuality}})});
    await h.session.loadSelected();await h.session.seek(2);await h.session.play();const player=h.players[0],transport={rate:.5,loop:{startId:0,endId:2,enabled:true}};player.change({transport});
    assert.equal((await h.session.setPlaybackSettings({ramMiB:1024,previewQuality:'720p',forwardPredecode:true,wheelFrames:5,showCacheStrip:false})).status,'applied');
    assert.strictEqual(h.players[0],player);assert.equal(h.prepared.length,1);assert.equal(h.calls,1);assert.equal(h.session.snapshot().state,'paused');assert.equal(h.session.snapshot().playback.frameId,2);
    assert.deepEqual(h.session.snapshot().playback.transport,transport);assert.deepEqual(h.session.snapshot().interactionSettings,{wheelFrames:5,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:true,showProxyStrip:false});assert(!h.events.some(e=>e.startsWith('forward-')));
    await h.session.setPlaybackSettings({ramMiB:1024,previewQuality:'1080p'});assert.deepEqual(h.session.snapshot().interactionSettings,{wheelFrames:5,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:true,showProxyStrip:false});await h.session.close();
  });
  await test('Invalid or failed interaction settings keep the old preferences/player; closing or switching during pause prevents writes',async()=>{
    for(const abort of ['close','switch']){
      let saves=0;const prefs={snapshot:()=>({ramMiB:1024}),quality:()=> '720p',preview(){},save(){saves++;}};
      const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>({...m.makeInfo(v),preview:{quality:o.previewQuality}})});assert.equal((await h.session.loadSelected()).status,'ready');await h.session.play();
      await assert.rejects(()=>h.session.setPlaybackSettings({ramMiB:1024,wheelFrames:3}));assert.equal(h.session.snapshot().state,'playing');assert.equal(saves,0);
      const gate=deferred(),p=h.players[0],pause=p.pause;p.pause=async()=>{await gate.promise;return pause.call(p);};
      const apply=h.session.setPlaybackSettings({ramMiB:1024,wheelFrames:5,showCacheStrip:false});await flush();
      let end;if(abort==='close')end=h.session.close();else{h.selection=selected('B');end=h.session.loadSelected();}
      gate.resolve();assert.equal((await apply).status,'superseded');await end;assert.equal(saves,0);await h.session.close();
    }
    const prefs={snapshot:()=>({ramMiB:1024}),quality:()=> '720p',preview(){},save(){throw Error('write refused');}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>({...m.makeInfo(v),preview:{quality:o.previewQuality}})});assert.equal((await h.session.loadSelected()).status,'ready');await assert.rejects(()=>h.session.setPlaybackSettings({ramMiB:1024,wheelFrames:5,showCacheStrip:false}));
    assert.equal(h.players.length,1);assert.equal(h.session.snapshot().state,'paused');assert.deepEqual(h.session.snapshot().interactionSettings,{wheelFrames:1,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:true,showProxyStrip:false});await h.session.close();
  });
  await test('Only changing rate step pauses in place without recreating media or losing a nonpreset speed/range',async()=>{
    let interaction={wheelFrames:1,showCacheStrip:true,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false},saves=0;
    const prefs={snapshot:()=>({ramMiB:1024}),quality:()=> '720p',interaction:()=>interaction,preview(){},save(_m,_q,_p,ui){interaction=ui;saves++;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>({...m.makeInfo(v),preview:{quality:o.previewQuality}})});
    assert.equal((await h.session.loadSelected()).status,'ready');await h.session.seek(2);const player=h.players[0];
    const transport={rate:1.35,loop:{startId:0,endId:2,enabled:true}};player.change({transport});await h.session.play();
    await assert.rejects(()=>h.session.setPlaybackSettings({ramMiB:1024,rateStep:.3}));assert.equal(h.session.snapshot().state,'playing');assert.equal(saves,0);
    assert.equal((await h.session.setPlaybackSettings({ramMiB:1024,rateStep:.25})).status,'applied');assert.equal(h.prepared.length,1);assert.strictEqual(h.players[0],player);
    assert.equal(h.session.snapshot().playback.time,2);assert.deepEqual(h.session.snapshot().playback.transport,transport);assert.equal(h.session.snapshot().state,'paused');
    assert.equal(h.session.snapshot().interactionSettings.rateStep,.25);assert.equal(saves,1);await h.session.close();
  });
  await test('Fade duration applies without media regeneration, preserves frame and transport, and validates before side effects',async()=>{
    let interaction={wheelFrames:1,showCacheStrip:true,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false};
    const prefs={snapshot:()=>({ramMiB:1024}),quality:()=> '720p',interaction:()=>interaction,preview(){},save(_m,_q,_p,ui){interaction=ui;}};
    const h=harness({memoryPreferences:prefs,prepare:async(v,o,m)=>({...m.makeInfo(v),preview:{quality:o.previewQuality}})});
    await h.session.loadSelected();await h.session.seek(2);const p=h.players[0];await h.session.play();
    await assert.rejects(()=>h.session.setPlaybackSettings({ramMiB:1024,drawingFadeSeconds:1.1}));assert.equal(h.session.snapshot().state,'playing');
    assert.equal((await h.session.setPlaybackSettings({ramMiB:1024,drawingFadeSeconds:0})).status,'applied');assert.equal(h.prepared.length,1);assert.strictEqual(h.players[0],p);
    assert.equal(h.session.snapshot().playback.time,2);assert.equal(h.session.snapshot().interactionSettings.drawingFadeSeconds,0);assert.equal(h.session.snapshot().state,'paused');await h.session.close();
  });
  await test('E46 native record priority survives while legacy automatic-proxy toggles cannot stop generation', async () => {
    const calls=[];let auto=true;
    const prefs={snapshot:()=>({ramMiB:1024}),quality:()=> '720p',forwardPredecode:()=>true,backend:()=> 'proxy',automaticProxy:()=>auto,preview(){},save(_ram,_q,_p,_ui,_backend,_enc,_dec,value){if(value!==undefined)auto=value;}};
    const runtime={startProxy(){calls.push('start');return Promise.resolve();},cancelProxy(){calls.push('cancel');return Promise.resolve();}};
    const h=harness({memoryPreferences:prefs,prepare:async(value,options,m)=>({...m.makeInfo(value),preview:{quality:options.previewQuality},videoEncoding:'filmcraft-native',nativeRuntime:runtime}),configurePlayer:p=>{p.primeRecords=order=>calls.push(order);}});
    await h.session.loadSelected();await h.session.seek(2);h.session.prioritizeRecords({all:[0,1,2],visible:[1]});
    assert.deepEqual(calls[0],{all:[0,1,2],visible:[1]});
    await h.session.setAutoProxy(false);assert.equal(h.session.snapshot().autoProxy,true);assert.equal(h.prepared.length,1);assert.equal(h.session.snapshot().playback.time,2);assert(!calls.includes('cancel'));
    await h.session.setAutoProxy(true);assert(!calls.includes('start'));const starts=calls.filter(x=>x==='start').length;await h.session.setAutoProxy(true);assert.equal(calls.filter(x=>x==='start').length,starts,'unchanged settings do not restart production');
    await assert.rejects(()=>h.session.setAutoProxy('yes'));await h.session.close();assert.equal(h.session.startProxy().status,'ignored');
  });
  await test('E44 video drawing preference rebuilds paused on the same source frame and rejects invalid values', async () => {
    let gpu=true;const prefs={snapshot:()=>({ramMiB:1024}),quality:()=> '720p',forwardPredecode:()=>true,backend:()=> 'proxy',gpuDrawing:()=>gpu,preview(){},save(_ram,_q,_p,_ui,_backend,_enc,_dec,_auto,value){if(value!==undefined)gpu=value;}};
    const h=harness({memoryPreferences:prefs,prepare:async(value,options,m)=>({...m.makeInfo(value),preview:{quality:options.previewQuality}})});
    await h.session.loadSelected();await h.session.seek(2);await h.session.setPlaybackSettings({ramMiB:1024,gpuDrawing:false});
    assert.equal(h.prepared.length,2);assert.equal(h.session.snapshot().gpuDrawing,false);assert.equal(h.session.snapshot().playback.time,2);assert.equal(h.session.snapshot().state,'paused');
    await h.session.setPlaybackSettings({ramMiB:1024,gpuDrawing:false,forwardPredecode:true});assert.equal(h.prepared.length,2,'unchanged drawing mode does not rebuild');
    await assert.rejects(()=>h.session.setPlaybackSettings({ramMiB:1024,gpuDrawing:'yes'}));assert.equal(h.prepared.length,2);await h.session.close();
  });
  console.log('T1 session memory tests passed: ' + tests + '. Not real Eagle, media, Canvas or performance verification.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
