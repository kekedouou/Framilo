'use strict';
const assert = require('assert'), path = require('path');
const { createSession } = require('../plugin/session.cjs');
const { createEagleAdapter } = require('../plugin/eagle.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const objects = () => [{ id: 'circle', kind: 'ellipse', color: '#ffd54f', width: .004, a: { x: .2, y: .2 }, b: { x: .7, y: .7 } }];
const clone = value => JSON.parse(JSON.stringify(value));
function memoryStore() {
  const data = new Map(); let serial = 0;
  return { fail: false, data,
    read(scope) { return clone(data.get(JSON.stringify(scope === 'visibility' ? scope : { libraryPath: scope.libraryPath, itemId: scope.itemId })) || { records: [], token: null, visible: true }); },
    save(scope, records, token) {
      if (this.fail) throw Error('injected save failure'); const key = JSON.stringify({ libraryPath: scope.libraryPath, itemId: scope.itemId });
      if ((data.get(key)?.token || null) !== token) throw Error('version conflict');
      const next = clone({ records, token: String(++serial) }); data.set(key, next); return clone(next);
    },
    readVisibility() { return this.read('visibility'); },
    saveVisibility(visible, token) { if (this.fail) throw Error('visibility write failed'); const previous = data.get(JSON.stringify('visibility')); assert.equal(previous?.token || null, token); const v = { visible, token: String(++serial) }; data.set(JSON.stringify('visibility'), v); return v; }
  };
}
function harness(store = memoryStore(), settings = {}) {
  const h = { store, selected: 'A', library: path.resolve('isolated.library'), sha: 'a'.repeat(64), native: [{ id: 'native', duration: .033, annotation: '已有文字' }], writes: 0, prepares: 0, changes: [] };
  const source = () => ({ id: h.selected, name: h.selected, ext: 'mp4', filePath: path.resolve(h.library, h.selected + '.mp4') });
  const adapter = createEagleAdapter({ library: { get path() { return h.library; } }, item: {
    getSelected: async () => [source()], getById: async id => { h.onRead?.(); return ({ ...source(), id, comments: h.hideAdded ? h.native.filter(n => !n.added) : h.native,
      async addComment(value) { h.writes++; const n = { id: 'new-' + h.writes, duration: value.duration, annotation: value.annotation, added: true }; h.native.push(n); if (settings.unknownAdd) h.hideAdded = true; return n; },
      async removeComment(commentId) { h.writes++; if (settings.unknownDelete) return false; h.native = h.native.filter(n => n.id !== commentId); return true; },
      async updateComment(id, value) { h.writes++; const n = h.native.find(n => n.id === id); n.annotation = value.annotation; return true; }
    }); }
  } });
  const frames = [{ id: 10, time: 0 }, { id: 12, time: .033 }, { id: 20, time: .099 }];
  h.session = createSession({ annotationStore: store, eagleAdapter: adapter,
    media: { async prepare(s) { h.prepares++; return { source: { ...s, sha256: h.sha }, frames, duration: .15 }; } },
    cache: { readAsset() {}, release: async () => {}, clearOther: async () => ({ cleared: 0 }) },
    memoryPreferences: { snapshot: () => null, preview() {}, save() {} },
    createPlayer(options) {
      const p = { value: { state: 'paused', frameId: 10, frameOrdinal: 0, time: 0, pendingTargets: 0 },
        change(v) { this.value = { ...this.value, ...v }; options.onChange(this.value); }, snapshot() { return { ...this.value }; },
        async load() { this.change({ state: 'paused' }); }, async dispose() {},
        async pause() { if (settings.pause) await settings.pause(); this.change({ state: 'paused' }); }, async play() { this.change({ state: 'playing' }); },
        async seek(time, config = {}) { const i = config.index ?? (time >= .099 ? 2 : time >= .033 ? 1 : 0); this.change({ state: 'paused', frameOrdinal: i, frameId: frames[i].id, time: frames[i].time }); return { status: 'drawn' }; },
        async step(delta) { return this.seek(0, { index: Math.max(0, Math.min(2, this.value.frameOrdinal + delta)) }); }
      }; h.player = p; return p;
    }, onChange(s) { h.changes.push(s); } });
  h.load = async () => { const r = await h.session.loadSelected(); await flush(); assert.equal(r.status, 'ready'); return h.session.snapshot(); };
  return h;
}

async function main() {
  let count = 0; const test = async (name, fn) => { await fn(); count++; console.log('ok drawing session: ' + name); };
  await test('a held picture after a failed target cannot become a text or drawing draft', async () => {
    const h = harness(); await h.load();
    h.player.change({ state: 'paused', pendingTargets: 0, frameHeld: true, targetTime: .099 });
    assert.equal(h.session.snapshot().playback.frameId, 10);
    assert.equal((await h.session.beginComment()).status, 'ignored');
    assert.equal(h.session.snapshot().comments.draft, null);
    assert.equal((await h.session.beginDrawing()).status, 'ignored');
    assert.equal(h.writes, 0); assert.equal(h.store.data.size, 0);
    h.player.change({ frameHeld: false, frameId: 20, frameOrdinal: 2, time: .099 });
    assert.equal((await h.session.beginDrawing()).status, 'editing');
    assert.equal(h.session.snapshot().drawings.draft.frameId, 20);
    assert.equal(h.writes, 0); await h.session.close();
  });
  await test('pending held targets do not enter annotation or drawing editing', async () => {
    const h = harness(); await h.load();
    h.player.change({ state: 'seeking', pendingTargets: 1, frameHeld: true, targetTime: .099 });
    assert.equal((await h.session.beginComment()).status, 'ignored');
    assert.equal((await h.session.beginDrawing()).status, 'ignored');
    assert.equal(h.session.snapshot().comments.draft, null);
    assert.equal(h.session.snapshot().drawings.draft, null);
    assert.equal(h.writes, 0); assert.equal(h.store.data.size, 0); await h.session.close();
  });
  await test('D reuses the one current-frame group and links the existing native text without adding it again', async () => {
    const h = harness(); await h.load(); await h.session.seek(.033); await h.session.beginDrawing();
    assert.equal(h.session.snapshot().drawings.draft.frameId, 12); h.session.setDrawingObjects(objects());
    assert.equal((await h.session.saveDrawing()).status, 'saved'); assert.equal(h.writes, 0);
    assert.equal(h.session.snapshot().comments.items[0].drawingId, h.session.snapshot().drawings.records[0].id);
    await h.session.beginDrawing(); assert.equal(h.session.snapshot().drawings.draft.objects.length, 1);
    await h.session.saveDrawing(); assert.equal(h.session.snapshot().drawings.records.length, 1); await h.session.close();
  });
  await test('Erasing the last object retries a failed save and reopens empty without deleting linked native text', async () => {
    const store = memoryStore(), h = harness(store), model = require('../plugin/drawing-model.js');
    const pen = {id:'pen',kind:'pen',color:'#ffffff',width:.006,points:[{x:.2,y:.5},{x:.8,y:.5}]};
    await h.load(); await h.session.seek(.033); await h.session.beginDrawing(); h.session.setDrawingObjects([pen]);
    assert.equal((await h.session.saveDrawing()).status,'saved'); await h.session.beginDrawing();
    h.session.setDrawingObjects(model.erase(h.session.snapshot().drawings.draft.objects,{width:.05,points:pen.points},{width:1280,height:720}));
    store.fail=true; assert.equal((await h.session.saveDrawing()).status,'failed'); assert.deepStrictEqual(h.session.snapshot().drawings.draft.objects,[]);
    assert.equal(h.writes,0); assert.equal(h.native[0].annotation,'已有文字');
    store.fail=false; assert.equal((await h.session.saveDrawing()).status,'saved'); await h.session.close();
    const reopened=harness(store); reopened.native=clone(h.native); await reopened.load();
    assert.deepStrictEqual(reopened.session.snapshot().drawings.records,[]); assert.equal(reopened.native[0].annotation,'已有文字');
    assert.equal(reopened.writes,0); await reopened.session.close();
  });
  await test('Saving a new group creates native text once, using image text and exact displayed frame', async () => {
    const store = memoryStore(), h = harness(store); await h.load(); await h.session.seek(.099); await h.session.beginDrawing();
    const text = { ...objects()[0], id: 'text', kind: 'text', text: '释放冲击\n观察落点', size: .04 };
    h.session.setDrawingObjects([...objects(), text]); assert.equal((await h.session.saveDrawing()).status, 'saved');
    assert.equal(h.writes, 1); assert.equal(h.native[1].duration, .099); assert.equal(h.native[1].annotation, text.text);
    assert.equal(h.session.snapshot().drawings.records[0].nativeLinks[0].id, h.native[1].id); await h.session.close();
    const re = harness(store); re.native = h.native; await re.load(); await re.session.seek(.099); await re.session.beginDrawing();
    assert.equal(re.session.snapshot().drawings.draft.objects.length, 2); await re.session.saveDrawing(); assert.equal(re.writes, 0); await re.session.close();
  });
  await test('Cancelling and saving an empty unchanged editor never creates placeholder text or files', async () => {
    const h = harness(); h.native = []; await h.load(); await h.session.beginDrawing(); h.session.cancelDrawing();
    await h.session.beginDrawing(); assert.equal((await h.session.saveDrawing()).status, 'saved');
    assert.equal(h.writes, 0); assert.equal(h.store.data.size, 0); await h.session.close();
  });
  await test('All same-source-frame native timestamps share one graphic group; N chooses rather than adds', async () => {
    const h = harness(); h.native = [{ id: 'one', duration: .034, annotation: '起手' }, { id: 'two', duration: .08, annotation: '发力' }];
    await h.load(); await h.session.seek(.033); await h.session.beginDrawing(); h.session.setDrawingObjects(objects()); await h.session.saveDrawing();
    const rows = h.session.snapshot().comments.items; assert.equal(rows.length, 2); assert.equal(rows[0].drawingId, rows[1].drawingId);
    assert.equal(h.session.snapshot().drawings.records.length, 1); assert.equal(h.writes, 0);
    assert.equal((await h.session.beginComment()).status, 'choosing'); assert.equal(h.session.snapshot().comments.draft.choices.length, 2);
    h.session.chooseComment('two'); h.session.setCommentText('只改第二条'); assert.equal((await h.session.saveComment()).status, 'saved');
    assert.equal(h.native[0].annotation, '起手'); assert.equal(h.native[1].annotation, '只改第二条');
    await h.session.beginComment('one'); assert.equal(h.session.snapshot().comments.draft.original.id, 'one'); h.session.cancelComment(); await h.session.close();
  });
  await test('N edits a single existing comment and creates a new note only for an empty actual frame', async () => {
    const h = harness(); await h.load(); await h.session.seek(.033); await h.session.beginComment();
    assert.equal(h.session.snapshot().comments.draft.kind, 'edit'); h.session.setCommentText('改文字'); await h.session.saveComment(); assert.equal(h.native.length, 1);
    await h.session.seek(.099); await h.session.beginComment(); assert(!h.session.snapshot().comments.draft.kind); h.session.setCommentText('末帧'); await h.session.saveComment();
    assert.equal(h.native.length, 2); await h.session.close();
  });
  await test('The final adapter read reuses a concurrently added native comment instead of making a duplicate', async () => {
    const h = harness(); h.native = []; await h.load(); await h.session.beginDrawing(); h.session.setDrawingObjects(objects());
    let readCount = 0; h.onRead = () => { if (++readCount === 2) h.native.push({ id: 'external', duration: 0, annotation: '刚从原生添加' }); };
    assert.equal((await h.session.saveDrawing()).status, 'saved'); assert.equal(h.writes, 0); assert.equal(h.native.length, 1); await h.session.close();
  });
  await test('An unknown native write only verifies on retry, preserves the draft and never resends', async () => {
    const h = harness(undefined, { unknownAdd: true }); h.native = []; await h.load(); await h.session.beginDrawing(); h.session.setDrawingObjects(objects());
    assert.equal((await h.session.saveDrawing()).status, 'unknown'); assert.equal(h.writes, 1);
    assert.equal((await h.session.close()).status, 'drawing-blocked'); assert.equal(h.session.cancelDrawing(), false);
    assert.equal((await h.session.saveDrawing()).status, 'unknown'); assert.equal(h.writes, 1);
    h.hideAdded = false; assert.equal((await h.session.saveDrawing()).status, 'saved'); assert.equal(h.writes, 1); await h.session.close();
  });
  await test('A local write failure after native success retries only local data and retains exact shapes', async () => {
    const h = harness(); h.native = []; await h.load(); await h.session.beginDrawing(); h.session.setDrawingObjects(objects()); h.store.fail = true;
    assert.equal((await h.session.saveDrawing()).status, 'failed'); assert.equal(h.writes, 1); assert(h.session.snapshot().drawings.draft.dirty);
    h.store.fail = false; assert.equal((await h.session.saveDrawing()).status, 'saved'); assert.equal(h.writes, 1); await h.session.close();
  });
  await test('Deleting a shared text preserves graphics; deleting the last text removes them', async () => {
    const h = harness(); h.native.push({ id: 'two', duration: .04, annotation: '第二条' }); await h.load(); await h.session.seek(.033);
    await h.session.beginDrawing(); h.session.setDrawingObjects(objects()); await h.session.saveDrawing();
    await h.session.deleteComment('native'); await h.session.saveComment(); assert.equal(h.session.snapshot().drawings.records.length, 1);
    assert.equal(h.session.snapshot().comments.items[0].id, 'two'); assert(h.session.snapshot().comments.items[0].drawingId);
    await h.session.deleteComment('two'); await h.session.saveComment(); assert.equal(h.session.snapshot().drawings.records.length, 0);
    assert.equal(h.session.snapshot().comments.items.length, 0); await h.session.close();
  });
  await test('External move/delete cannot move the source-frame group or silently remove it', async () => {
    const h = harness(); await h.load(); await h.session.beginDrawing('native'); h.session.setDrawingObjects(objects()); await h.session.saveDrawing();
    h.native[0].duration = .099; h.session.setCommentsVisible(true); await h.session.refreshComments(); await flush();
    const row = h.session.snapshot().comments.items.find(n => n.localDrawing); assert(row); assert.equal(row.time, .033); assert(!h.session.snapshot().comments.items.find(n => n.id === 'native').drawingId);
    h.session.setCommentsVisible(false); await h.session.seekComment(row.id); assert.equal(h.session.snapshot().playback.frameId, 12); await h.session.close();
  });
  await test('Legacy same-frame records merge without discarding any graphic, including colliding object IDs', async () => {
    const store = memoryStore(), h = harness(store), scope = { libraryPath: h.library, itemId: 'A' };
    const base = { sourceSha256: h.sha, frameOrdinal: 1, frameId: 12, time: .033, nativeId: 'native', nativeTime: .033, objects: objects() };
    store.save(scope, [{ ...base, id: 'old1' }, { ...base, id: 'old2' }], null);
    await h.load(); await h.session.seek(.033); await h.session.beginDrawing();
    assert.equal(h.session.snapshot().drawings.draft.objects.length, 2); assert.equal(new Set(h.session.snapshot().drawings.draft.objects.map(n => n.id)).size, 2);
    await h.session.saveDrawing(); assert.equal(h.session.snapshot().drawings.records.length, 1); await h.session.close();
  });
  await test('Draft blocks conflicting actions and failed storage keeps the old complete version', async () => {
    const h = harness(); await h.load(); await h.session.seek(.033); await h.session.beginDrawing(); h.session.setDrawingObjects(objects());
    for (const op of [() => h.session.play(), () => h.session.step(1), () => h.session.seek(.099), () => h.session.setMemoryMiB(2048), () => h.session.clearOtherCaches()]) await assert.rejects(op);
    assert.equal((await h.session.loadSelected()).status, 'drawing-blocked'); assert.equal((await h.session.libraryChanged()).status, 'drawing-blocked');
    h.store.fail = true; assert.equal((await h.session.saveDrawing()).status, 'failed'); assert.equal((await h.session.close()).status, 'drawing-blocked');
    h.store.fail = false; await h.session.saveDrawing(); await h.session.close();
  });
  await test('Replacing source content hides but preserves previous source groups; clearing graphics keeps text', async () => {
    const h = harness(); await h.load(); await h.session.seek(.033); await h.session.beginDrawing(); h.session.setDrawingObjects(objects()); await h.session.saveDrawing();
    h.sha = 'b'.repeat(64); await h.load(); assert.equal(h.session.snapshot().drawings.records.length, 0);
    h.sha = 'a'.repeat(64); await h.load(); assert.equal(h.session.snapshot().drawings.records.length, 1);
    await h.session.clearDrawing(h.session.snapshot().drawings.records[0].id); assert.equal(h.session.snapshot().drawings.records.length, 0); assert.equal(h.native.length, 1); await h.session.close();
  });
  await test('Cancelling a pending pause cannot revive a stale editor after switching videos', async () => {
    let resolve; const gate = new Promise(r => { resolve = r; }), h = harness(undefined, { pause: () => gate }); await h.load();
    const pending = h.session.beginDrawing(); h.session.cancelDrawing(); h.selected = 'B'; const loading = h.load(); resolve(); await pending; await loading;
    assert.equal(h.session.snapshot().source.id, 'B'); assert.equal(h.session.snapshot().drawings.draft, null); await h.session.close();
  });

  await test('A verified local commit with a lost acknowledgement is recovered without resending native text', async () => {
    const store=memoryStore(), h=harness(store), original=store.save.bind(store);let once=true;
    store.save=(...args)=>{const saved=original(...args);if(once){once=false;throw Error('committed acknowledgement lost');}return saved;};
    h.native=[];await h.load();await h.session.beginDrawing();h.session.setDrawingObjects(objects());
    assert.equal((await h.session.saveDrawing()).status,'saved');assert.equal(h.writes,1);assert.equal(h.session.snapshot().drawings.records.length,1);await h.session.close();
  });
  await test('A mismatched saved source-frame identity is preserved but never drawn onto a different frame', async () => {
    const store=memoryStore(),h=harness(store);store.save({libraryPath:h.library,itemId:'A'},[{id:'bad',sourceSha256:h.sha,frameId:999,frameOrdinal:1,time:.033,nativeId:null,nativeTime:null,objects:objects()}],null);
    await h.load();assert.equal(h.session.snapshot().drawings.status,'error');assert.equal(h.session.snapshot().drawings.records.length,0);assert.equal(store.data.size,1);await h.session.close();
  });

  console.log('Drawing Session: ' + count + ' actual Session/adapter models; no real Eagle/library writes.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { harness, memoryStore };
