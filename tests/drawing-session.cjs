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
    getSelected: async () => [source()], getById: async id => ({ ...source(), id, comments: h.native,
      async removeComment(commentId) { h.writes++; if (settings.unknownDelete) return false; h.native = h.native.filter(n => n.id !== commentId); return true; },
      async updateComment(id, value) { h.writes++; const n = h.native.find(n => n.id === id); n.annotation = value.annotation; return true; }
    })
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
  await test('New drawing freezes displayed source frame; save/reopen is local and never inserts native placeholder text', async () => {
    const store = memoryStore(), h = harness(store); await h.load(); await h.session.seek(.099); await h.session.beginDrawing();
    const d = h.session.snapshot().drawings.draft; assert.equal(d.frameId, 20); assert.equal(d.frameOrdinal, 2); assert.equal(d.time, .099);
    h.session.setDrawingObjects(objects()); assert.equal(h.session.saveDrawing().status, 'saved'); assert.equal(h.writes, 0); assert.equal(h.session.snapshot().state, 'paused');
    assert(h.session.snapshot().comments.items.some(n => n.localDrawing)); await h.session.close();
    const reopened = harness(store); await reopened.load(); const row = reopened.session.snapshot().comments.items.find(n => n.localDrawing);
    await reopened.session.seekComment(row.id); assert.equal(reopened.session.snapshot().playback.frameId, 20); await reopened.session.close();
  });
  await test('Existing native entry gains one drawing row, accurate nonuniform source frame and no native mutation', async () => {
    const h = harness(); await h.load(); await h.session.beginDrawing('native'); assert.equal(h.session.snapshot().drawings.draft.frameId, 12);
    h.session.setDrawingObjects(objects()); h.session.saveDrawing(); const row = h.session.snapshot().comments.items[0]; assert.equal(row.id, 'native'); assert(row.drawingId); assert.equal(h.session.snapshot().comments.items.length, 1); assert.equal(h.writes, 0);
    await h.session.clearDrawing(row.drawingId); assert.equal(h.native[0].annotation, '已有文字'); assert(!h.session.snapshot().comments.items[0].drawingId); await h.session.close();
  });
  await test('Draft protects transport/settings/cleanup/export and close/reload/library change without losing objects', async () => {
    const h = harness(); await h.load(); await h.session.beginDrawing(); h.session.setDrawingObjects(objects());
    for (const op of [() => h.session.play(), () => h.session.step(1), () => h.session.seek(.099), () => h.session.setMemoryMiB(2048), () => h.session.clearOtherCaches()]) await assert.rejects(op);
    assert.equal((await h.session.loadSelected()).status, 'drawing-blocked'); assert.equal((await h.session.libraryChanged()).status, 'drawing-blocked'); assert.equal((await h.session.close()).status, 'drawing-blocked');
    assert.equal(h.session.snapshot().drawings.draft.objects.length, 1); h.session.cancelDrawing(); await h.session.close();
  });
  await test('Native timestamp inside a frame remains attached; later native time changes retain the exact old source frame separately', async () => {
    const h = harness(); h.native[0].duration = .034; await h.load(); await h.session.beginDrawing('native'); h.session.setDrawingObjects(objects()); h.session.saveDrawing();
    const row = h.session.snapshot().comments.items[0]; assert.equal(row.id, 'native'); assert.equal(row.time, .033); assert(row.drawingId);
    h.native[0].duration = .099; h.session.setCommentsVisible(true); await h.session.refreshComments(); await flush();
    const rows = h.session.snapshot().comments.items; assert.equal(rows.length, 2); assert.equal(rows.find(n => n.localDrawing).time, .033); assert.equal(h.writes, 0); await h.session.close();
  });
  await test('Local-only delete is confirmed by draft then removes the row without changing native comments', async () => {
    const h = harness(); await h.load(); await h.session.beginDrawing(); h.session.setDrawingObjects(objects()); h.session.saveDrawing();
    const row = h.session.snapshot().comments.items.find(n => n.localDrawing); await h.session.beginDrawing(row.id, 'delete'); assert.equal(h.session.snapshot().comments.items.length, 2);
    h.session.saveDrawing(); assert.equal(h.session.snapshot().comments.items.length, 1); assert.equal(h.writes, 0); await h.session.close();
  });
  await test('External native deletion retains graph and time marker as an orphan rather than deleting user drawing', async () => {
    const h = harness(); await h.load(); await h.session.beginDrawing('native'); h.session.setDrawingObjects(objects()); h.session.saveDrawing();
    h.native = []; h.session.setCommentsVisible(true); await h.session.refreshComments(); await flush(); const row = h.session.snapshot().comments.items[0];
    assert(row.localDrawing && row.drawingId); assert(row.text.includes('删除')); await h.session.seekComment(row.id); assert.equal(h.session.snapshot().playback.frameId, 12); await h.session.close();
  });
  await test('Explicit whole-native delete removes its drawing only after verified native deletion', async () => {
    const h = harness(); await h.load(); await h.session.beginDrawing('native'); h.session.setDrawingObjects(objects()); h.session.saveDrawing();
    await h.session.deleteComment('native'); assert.equal(h.writes, 0); assert.equal((await h.session.saveComment()).status, 'saved');
    assert.equal(h.writes, 1); assert.equal(h.session.snapshot().drawings.records.length, 0); await h.session.close();
  });
  await test('Unknown native deletion preserves drawing and explicit readback does not resend', async () => {
    const h = harness(undefined, { unknownDelete: true }); await h.load(); await h.session.beginDrawing('native'); h.session.setDrawingObjects(objects()); h.session.saveDrawing();
    await h.session.deleteComment('native'); assert.equal((await h.session.saveComment()).status, 'unknown'); assert.equal(h.session.snapshot().drawings.records.length, 1);
    h.native = []; assert.equal((await h.session.checkComment()).status, 'saved'); assert.equal(h.writes, 1); assert.equal(h.session.snapshot().drawings.records.length, 0); await h.session.close();
  });
  await test('Save failure retains dirty objects and protection; subsequent save/reopen succeeds', async () => {
    const h = harness(); await h.load(); await h.session.beginDrawing(); h.session.setDrawingObjects(objects()); h.store.fail = true;
    assert.equal(h.session.saveDrawing().status, 'failed'); assert(h.session.snapshot().drawings.draft.dirty); assert.equal((await h.session.close()).status, 'drawing-blocked');
    h.store.fail = false; assert.equal(h.session.saveDrawing().status, 'saved'); await h.session.close();
  });
  await test('Visibility persists without media recreation; replaced video content preserves but hides old notes', async () => {
    const h = harness(); await h.load(); const prepares = h.prepares; h.session.setDrawingsVisible(false); assert(!h.session.snapshot().drawings.visible); assert.equal(h.prepares, prepares);
    await h.session.beginDrawing(); h.session.setDrawingObjects(objects()); h.session.saveDrawing(); h.sha = 'b'.repeat(64); await h.load();
    assert.equal(h.session.snapshot().drawings.records.length, 0); assert(h.session.snapshot().drawings.message.includes('改变'));
    await h.session.beginDrawing(); h.session.setDrawingObjects(objects()); h.session.saveDrawing(); h.sha = 'a'.repeat(64); await h.load(); assert.equal(h.session.snapshot().drawings.records.length, 1); await h.session.close();
  });
  await test('Cancelling a pending frame pause cannot revive an old drawing after switching source', async () => {
    let resolve; const gate = new Promise(r => { resolve = r; }); const h = harness(undefined, { pause: () => gate }); await h.load();
    const pending = h.session.beginDrawing(); assert.equal(h.session.snapshot().drawings.draft.status, 'pausing'); h.session.cancelDrawing(); h.selected = 'B'; const loading = h.load(); resolve(); await pending; await loading;
    assert.equal(h.session.snapshot().source.id, 'B'); assert.equal(h.session.snapshot().drawings.draft, null); await h.session.close();
  });
  await test('Tool preferences load/save independently and a failed preference write keeps prior values and video state', async () => {
    const store = memoryStore(), { defaultStyles } = require('../plugin/drawing-model.js'); let preferences = { styles: defaultStyles(), token: null }, failed = false;
    store.readStyles = () => clone(preferences);
    store.saveStyles = (styles, token) => { if (failed) throw Error('tool disk full'); assert.equal(token, preferences.token); preferences = { styles: clone(styles), token: 'style-1' }; return clone(preferences); };
    const h = harness(store); await h.load(); const prepares = h.prepares;
    const next = { ...defaultStyles(), color: '#ff5252', widths: { ...defaultStyles().widths, pen: .008 } };
    assert.equal(h.session.setDrawingStyles(next).status, 'saved'); assert.equal(h.session.snapshot().drawings.styles.widths.pen, .008);
    assert.equal(h.prepares, prepares); assert.equal(h.writes, 0); failed = true;
    assert.equal(h.session.setDrawingStyles({ ...next, color: '#ffffff' }).status, 'failed'); assert.equal(h.session.snapshot().drawings.styles.color, '#ff5252');
    assert(h.session.snapshot().drawings.message.includes('tool disk full')); await h.session.close();
    failed = false; const reopened = harness(store); await reopened.load(); assert.equal(reopened.session.snapshot().drawings.styles.widths.pen, .008); await reopened.session.close();
  });
  await test('Discarding a transient change restores clean state and empty unchanged save writes no drawing document', async () => {
    const store = memoryStore(), h = harness(store); await h.load(); await h.session.beginDrawing(); h.session.touchDrawing();
    assert(h.session.snapshot().drawings.draft.dirty); h.session.setDrawingObjects([]); assert(!h.session.snapshot().drawings.draft.dirty);
    assert.equal(h.session.saveDrawing().status, 'saved'); assert.equal(store.data.size, 0); await h.session.close();
  });
  await test('A corrupt tool preference is reported after media opens instead of silently replacing old data', async () => {
    const store = memoryStore(); store.readStyles = () => { throw Error('corrupt style revision'); };
    store.saveStyles = () => { throw Error('preserved corrupt style revision'); };
    const h = harness(store); await h.load(); assert.equal(h.session.snapshot().state, 'paused');
    assert(h.session.snapshot().drawings.message.includes('corrupt style revision'));
    assert.equal(h.session.setDrawingStyles(require('../plugin/drawing-model.js').defaultStyles()).status, 'saved'); // No-op is read-only.
    assert(h.session.snapshot().drawings.message.includes('corrupt style revision')); assert.equal(store.data.size, 0); await h.session.close();
  });
  console.log('Drawing Session: ' + count + ' actual Session/adapter models; no real Eagle/library writes.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { harness, memoryStore };
