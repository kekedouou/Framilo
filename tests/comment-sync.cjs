'use strict';
// Deterministic clock + real adapter/session, in-memory SDK only. No media or library writes.
const assert = require('assert'), path = require('path');
const { createSession } = require('../plugin/session.cjs');
const { createEagleAdapter } = require('../plugin/eagle.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function clock() {
  let now = 0, serial = 0; const tasks = new Map();
  return { setTimeout(fn, delay) { const id = ++serial; tasks.set(id, { at: now + delay, fn }); return id; },
    clearTimeout: id => tasks.delete(id), get size() { return tasks.size; },
    async advance(ms) {
      const end = now + ms;
      while (true) { const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break;
        now = next[1].at; tasks.delete(next[0]); next[1].fn(); await flush(); }
      now = end; await flush();
    } };
}
function harness(settings = {}) {
  const h = { selected: 'A', library: path.resolve('sync-test.library'), rows: { A: [{ id: 'note', duration: 1, annotation: '原文字', lastModified: 1 }], B: [] },
    reads: [], activeReads: 0, maxReads: 0, writes: [], players: [], preparations: 0, changes: [] };
  h.clock = clock();
  const source = id => ({ id, name: id, ext: 'mp4', filePath: path.resolve('sync-test.library', id + '.mp4') });
  const api = { library: { get path() { return h.library; } }, item: {
    getSelected: async () => [source(h.selected)],
    async getById(id) {
      h.reads.push(id); h.activeReads++; h.maxReads = Math.max(h.maxReads, h.activeReads);
      const rows = h.rows[id].map(value => ({ ...value }));
      try {
        if (settings.read) await settings.read(id, h.reads.length, h);
        return { ...source(id), comments: rows,
          async updateComment(target, fields) { h.writes.push({ id, target, fields });
            if (!settings.noCommit) Object.assign(h.rows[id].find(value => value.id === target), fields); },
          async removeComment(target) { h.writes.push({ id, target }); h.rows[id] = h.rows[id].filter(value => value.id !== target); },
          async addComment(fields) { const value = { id: 'added', ...fields }; h.writes.push({ id, fields }); h.rows[id].push(value); return value; }
        };
      } finally { h.activeReads--; }
    }
  } };
  h.api = api;
  h.adapter = createEagleAdapter(api, { commentTimeoutMs: 50 });
  h.session = createSession({ eagleAdapter: h.adapter, commentTimers: h.clock,
    media: { async prepare(selected) { h.preparations++; return { source: { ...selected, sha256: 'a'.repeat(64) }, duration: 4,
      frames: [0, 1, 2, 3].map(id => ({ id, time: id, file: id + '.jpg' })) }; } },
    cache: { readAsset() {}, async release() {} },
    createPlayer(config) {
      const player = { time: 0, pauses: 0, seeks: 0, state: 'paused',
        snapshot() { return { state: this.state, time: this.time, frameId: this.time, frameOrdinal: this.time, pendingTargets: 0 }; },
        async load() {}, async dispose() {}, async play() { this.state = 'playing'; config.onChange(this.snapshot()); },
        async pause() { this.pauses++; if (settings.pause) await settings.pause(); this.state = 'paused'; config.onChange(this.snapshot()); },
        async seek(time) { this.seeks++; this.time = time; config.onChange(this.snapshot()); }, async step() {} };
      h.players.push(player); return player;
    }, onChange: value => h.changes.push(value) });
  h.load = async (id = h.selected) => { h.selected = id; await h.session.loadSelected(); await flush(); };
  h.visible = () => h.session.setCommentsVisible(true);
  h.close = () => h.session.close();
  return h;
}
let count = 0;
async function test(name, run) { await run(); count++; console.log('ok ' + name); }
(async () => {
  await test('Missing write capability preserves the draft and sends no write; recovery saves once', async () => {
    const h=harness();await h.load();await h.session.editComment('note');h.session.setCommentText('接口恢复前保留的草稿');
    const lookup=h.api.item.getById;
    h.api.item.getById=async id=>{const item=await lookup(id);delete item.updateComment;return item;};
    const result=await h.session.saveComment();assert.equal(result.status,'failed');assert.equal(h.writes.length,0);
    assert.equal(h.session.snapshot().comments.draft.text,'接口恢复前保留的草稿');assert.match(result.message,/Eagle 4\.0 Build 22/);
    await h.clock.advance(5000);assert.equal(h.session.snapshot().comments.draft.text,'接口恢复前保留的草稿');
    h.api.item.getById=lookup;assert.equal((await h.session.saveComment()).status,'saved');assert.equal(h.writes.length,1);
    assert.equal(h.session.snapshot().comments.draft,null);await h.close();
  });
  await test('Missing read capability keeps existing records and reports a persistent sync error', async () => {
    const h=harness();h.visible();await h.load();const items=h.session.snapshot().comments.items,lookup=h.api.item.getById;
    h.api.item.getById=async id=>{const item=await lookup(id);delete item.comments;return item;};
    await h.clock.advance(3000);const state=h.session.snapshot();
    assert.strictEqual(state.comments.items,items);assert.match(state.comments.syncMessage,/Eagle 4\.0 Build 22/);
    assert.equal(h.preparations,1);assert.equal(h.writes.length,0);await h.close();
  });
  await test('Visible polling imports native additions, edits and removals without preparing, seeking or pausing video', async () => {
    const h = harness(); h.visible(); await h.load(); await h.session.play();
    h.rows.A.push({ id: 'new', duration: 2, annotation: '外部新增' }); await h.clock.advance(1000);
    assert.equal(h.session.snapshot().comments.items.length, 2);
    h.rows.A[0].annotation = '外部修改'; await h.clock.advance(1000); assert.equal(h.session.snapshot().comments.items[0].text, '外部修改');
    h.rows.A.shift(); await h.clock.advance(1000); assert.deepEqual(h.session.snapshot().comments.items.map(value => value.id), ['new']);
    assert.equal(h.preparations, 1); assert.equal(h.players[0].pauses, 0); assert.equal(h.players[0].seeks, 0); assert.equal(h.session.snapshot().state, 'playing'); await h.close();
  });
  await test('Unchanged polling retains immutable list identity and emits no redundant UI update', async () => {
    const h = harness(); h.visible(); await h.load(); const items = h.session.snapshot().comments.items, changes = h.changes.length;
    await h.clock.advance(5000); assert.strictEqual(h.session.snapshot().comments.items, items); assert.equal(h.changes.length, changes); assert.equal(h.reads.length, 6); await h.close();
  });
  await test('Returning to the window refreshes immediately and resets the normal one-second schedule', async () => {
    const h = harness(); h.visible(); await h.load(); await h.clock.advance(500); h.rows.A[0].annotation = '立即读取';
    await h.session.refreshComments(); assert.equal(h.session.snapshot().comments.items[0].text, '立即读取');
    await h.clock.advance(500); assert.equal(h.reads.length, 2); await h.clock.advance(500); assert.equal(h.reads.length, 3); await h.close();
  });
  await test('Hiding stops new reads; showing resumes; closing removes scheduled work', async () => {
    const h = harness(); h.visible(); await h.load(); h.session.setCommentsVisible(false); await h.clock.advance(10000); assert.equal(h.reads.length, 1);
    h.visible(); await h.clock.advance(0); assert.equal(h.reads.length, 2); await h.close(); await h.clock.advance(10000); assert.equal(h.clock.size, 0); assert.equal(h.reads.length, 2);
  });
  await test('Refreshing unrelated notes preserves an unsaved new draft and its exact text/time', async () => {
    const h = harness(); h.visible(); await h.load(); await h.session.beginComment(); h.session.setCommentText('我的草稿 空格\n换行');
    const draft = h.session.snapshot().comments.draft; h.rows.A.push({ id: 'new', duration: 2, annotation: '新标注' }); await h.clock.advance(1000);
    assert.strictEqual(h.session.snapshot().comments.draft, draft); assert.equal(h.session.snapshot().comments.items.length, 2); assert.equal(h.writes.length, 0); await h.close();
  });
  await test('External changes to the edited note preserve typed text and block saving until reselected', async () => {
    const h = harness(); h.visible(); await h.load(); await h.session.editComment('note'); h.session.setCommentText('我的未保存修改');
    h.rows.A[0].annotation = '原生改动'; await h.clock.advance(1000);
    const value = h.session.snapshot().comments; assert.equal(value.draft.status, 'obsolete'); assert.equal(value.draft.text, '我的未保存修改');
    assert.equal(value.items[0].text, '原生改动'); assert.equal((await h.session.saveComment()).status, 'ignored'); assert.equal(h.writes.length, 0); await h.close();
  });
  await test('External deletion and revision-only changes also invalidate the specific original proposal', async () => {
    for (const remove of [false, true]) { const h = harness(); h.visible(); await h.load(); await h.session.deleteComment('note');
      if (remove) h.rows.A = []; else h.rows.A[0].lastModified = 2;
      await h.clock.advance(1000); assert.equal(h.session.snapshot().comments.draft.status, 'obsolete');
      assert.equal((await h.session.saveComment()).status, 'ignored'); assert.equal(h.writes.length, 0); await h.close(); }
  });
  await test('A conflict found while pause is pending cannot later revive an editable old proposal', async () => {
    const gate = deferred(), h = harness({ pause: () => gate.promise }); h.visible(); await h.load(); const editing = h.session.editComment('note');
    h.rows.A = []; await h.clock.advance(1000); assert.equal(h.session.snapshot().comments.draft.status, 'obsolete'); gate.resolve(); await editing;
    assert.equal(h.session.snapshot().comments.draft.status, 'obsolete'); await h.close();
  });
  await test('Switching queues only the newest initial read and never applies another video snapshot', async () => {
    const gate = deferred(), h = harness({ read: (_id, n) => n === 2 ? gate.promise : undefined }); h.visible(); await h.load();
    await h.clock.advance(1000); await h.load('B'); await h.load('A'); await h.load('B'); assert.deepEqual(h.reads, ['A', 'A']);
    h.rows.B.push({ id: 'B-only', duration: 1, annotation: '新视频' }); gate.resolve(); await flush();
    assert.deepEqual(h.reads, ['A', 'A', 'B']); assert.equal(h.maxReads, 1); assert.equal(h.session.snapshot().comments.items[0].id, 'B-only'); await h.close();
  });
  await test('Closing never waits for an unresponsive read and ignores its late completion', async () => {
    const gate = deferred(), h = harness({ read: (_id, n) => n === 2 ? gate.promise : undefined }); h.visible(); await h.load(); await h.clock.advance(1000);
    await h.close(); const changes = h.changes.length; gate.resolve(); await flush(); await h.clock.advance(60000);
    assert.equal(h.changes.length, changes); assert.equal(h.clock.size, 0); assert.equal(h.reads.length, 2); assert.equal(h.session.snapshot().comments.items.length, 0);
  });
  await test('A stalled SDK read warns once but remains single-flight across repeated focus/timer attempts', async () => {
    const gate = deferred(), h = harness({ read: (_id, n) => n === 2 ? gate.promise : undefined }); h.visible(); await h.load(); await h.clock.advance(1000);
    await h.clock.advance(60000); h.session.refreshComments(); h.session.refreshComments();
    assert.equal(h.reads.length, 2); assert.equal(h.maxReads, 1); assert(h.session.snapshot().comments.syncMessage.includes('暂未返回'));
    await h.close(); gate.resolve(); await flush(); assert.equal(h.clock.size, 0);
  });
  await test('Read errors retain old notes and back off; success returns to the normal schedule', async () => {
    let broken = true;
    const h = harness({ read: (_id, n) => { if (n > 1 && broken) throw Error('临时失败'); } }); h.visible(); await h.load();
    const items = h.session.snapshot().comments.items; await h.clock.advance(1000); assert.strictEqual(h.session.snapshot().comments.items, items);
    assert.equal(h.session.snapshot().comments.status, 'ready'); assert(h.session.snapshot().comments.syncMessage.includes('临时失败'));
    await h.clock.advance(1999); assert.equal(h.reads.length, 2); await h.clock.advance(1); assert.equal(h.reads.length, 3);
    broken = false; await h.clock.advance(4000); assert.equal(h.reads.length, 4); assert.equal(h.session.snapshot().comments.syncMessage, '');
    await h.clock.advance(1000); assert.equal(h.reads.length, 5); await h.close();
  });
  await test('A read taken before an actual save cannot overwrite the successful independent read-back', async () => {
    const gate = deferred(), h = harness({ read: (_id, n) => n === 2 ? gate.promise : undefined }); h.visible(); await h.load(); await h.clock.advance(1000);
    await h.session.editComment('note'); h.session.setCommentText('正确的新文字'); assert.equal((await h.session.saveComment()).status, 'saved');
    gate.resolve(); await flush(); assert.equal(h.session.snapshot().comments.items[0].text, '正确的新文字'); assert.equal(h.writes.length, 1); await h.close();
  });
  await test('Unknown writes pause background reads and still require explicit read-only verification', async () => {
    const h = harness({ noCommit: true }); h.visible(); await h.load(); await h.session.editComment('note'); h.session.setCommentText('待核对');
    assert.equal((await h.session.saveComment()).status, 'unknown'); const reads = h.reads.length;
    await h.clock.advance(10000); assert.equal(h.reads.length, reads); assert.equal(h.writes.length, 1);
    h.rows.A[0].annotation = '待核对'; assert.equal((await h.session.checkComment()).status, 'saved');
    await h.clock.advance(1000); assert(h.reads.length > reads); assert.equal(h.writes.length, 1); await h.close();
  });
  await test('A library change while reading rejects the late result and stops polling the old item', async () => {
    const gate = deferred(), h = harness({ read: (_id, n) => n === 2 ? gate.promise : undefined }); h.visible(); await h.load(); await h.clock.advance(1000);
    h.library = path.resolve('new-sync-test.library'); await h.session.libraryChanged(); gate.resolve(); await flush(); await h.clock.advance(10000);
    assert.equal(h.reads.length, 2); assert.equal(h.session.snapshot().comments.items.length, 0); await h.close();
  });
  await test('An unknown write for another video does not disable synchronization of the current video', async () => {
    const h = harness({ noCommit: true }); h.visible(); await h.load(); await h.session.editComment('note'); h.session.setCommentText('A待核对');
    assert.equal((await h.session.saveComment()).status, 'unknown'); await h.load('B');
    h.rows.B.push({ id: 'B-new', duration: 2, annotation: 'B可正常同步' }); await h.clock.advance(1000);
    assert.equal(h.session.snapshot().comments.items[0].id, 'B-new'); assert.equal(h.writes.length, 1); await h.close();
  });
  await test('An initial read failure can recover without preparing the source video again', async () => {
    const h = harness({ read: (_id, n) => { if (n === 1) throw Error('首次暂不可用'); } }); h.visible(); await h.load();
    assert.equal(h.session.snapshot().comments.status, 'error'); await h.clock.advance(2000);
    assert.equal(h.session.snapshot().comments.status, 'ready'); assert.equal(h.preparations, 1); await h.close();
  });
  await test('A read that returns after hiding cannot change the list; returning obtains a fresh snapshot', async () => {
    const gate = deferred(), h = harness({ read: (_id, n) => n === 2 ? gate.promise : undefined }); h.visible(); await h.load();
    h.rows.A[0].annotation = '隐藏期间变更'; await h.clock.advance(1000); h.session.setCommentsVisible(false); gate.resolve(); await flush();
    assert.equal(h.session.snapshot().comments.items[0].text, '原文字'); h.visible(); await h.clock.advance(0);
    assert.equal(h.session.snapshot().comments.items[0].text, '隐藏期间变更'); await h.close();
  });
  await test('Finishing composition after a conflict preserves final characters but cannot enable stale saving', async () => {
    const h = harness(); h.visible(); await h.load(); await h.session.editComment('note'); h.session.setCommentText('未完成');
    h.rows.A[0].annotation = '外部改动'; await h.clock.advance(1000); h.session.setCommentText('未完成的中文');
    assert.equal(h.session.snapshot().comments.draft.text, '未完成的中文'); assert.equal(h.session.snapshot().comments.draft.status, 'obsolete');
    assert.equal((await h.session.saveComment()).status, 'ignored'); assert.equal(h.writes.length, 0); await h.close();
  });
  console.log('Comment sync checks: ' + count + '; deterministic SDK/session models, no real Eagle or library writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
