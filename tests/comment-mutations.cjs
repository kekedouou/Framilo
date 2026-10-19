'use strict';
// Real adapter/session with an in-memory SDK. Never writes an Eagle library.
const assert = require('assert'), path = require('path');
const { createEagleAdapter } = require('../plugin/eagle.cjs');
const { createSession } = require('../plugin/session.cjs');
let count = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const h = { library: path.resolve('mutation-test.library'), data: [
    { id: 'target', duration: 2.125, annotation: '原文字 空格', extra: 'preserve' },
    { id: 'other', duration: 0, annotation: '原有标注' }], writes: [], reads: 0, pauses: 0 };
  h.source = { id: 'A', filePath: path.resolve('mutation-test.library/images/A.info/video.mp4'), name: 'A' };
  h.api = { library: { get path() { return h.library; } }, item: {
    getSelected: async () => [h.source],
    async getById() {
      h.reads++;
      const snapshot = h.data.map(item => ({ ...item }));
      return { ...h.source, comments: snapshot,
        async updateComment(id, value) {
          h.writes.push({ kind: 'edit', id, value });
          if (options.write) return options.write(h, id, value);
          Object.assign(h.data.find(item => item.id === id), value);
          if (options.lostResponse) throw Error('IPC response lost');
          return h.data.find(item => item.id === id);
        },
        async removeComment(id) {
          h.writes.push({ kind: 'delete', id });
          if (options.write) return options.write(h, id);
          h.data = h.data.filter(item => item.id !== id);
          if (options.lostResponse) throw Error('IPC response lost');
          return true;
        }
      };
    }
  } };
  h.adapter = createEagleAdapter(h.api, { commentTimeoutMs: 10 });
  h.proposal = kind => ({ kind, source: h.source, libraryPath: h.library, time: 2.125,
    text: kind === 'edit' ? '修改后 中文 空格' : '原文字 空格', original: { id: 'target', time: 2.125, text: '原文字 空格' } });
  h.session = createSession({ eagleAdapter: h.adapter,
    media: { prepare: async source => ({ source: { ...source, sha256: 'a'.repeat(64) }, duration: 4,
      frames: [0, 1, 2, 3].map(id => ({ id, time: id, file: id + '.jpg' })) }) },
    cache: { readAsset() {}, async release() {} },
    createPlayer: config => {
      let state = 'paused';
      return { snapshot: () => ({ state, frameOrdinal: 0, frameId: 0, time: 0, pendingTargets: 0 }),
        async load() {}, async dispose() { state = 'disposed'; }, async play() {}, async seek() {}, async step() {},
        async pause() { h.pauses++; state = 'paused'; config.onChange(this.snapshot()); } };
    } });
  h.load = async () => { await h.session.loadSelected(); await tick(); assert.equal(h.session.snapshot().comments.status, 'ready'); };
  return h;
}
async function test(name, run) { await run(); count++; console.log('ok ' + name); }
(async () => {
  await test('Edit submits only annotation for the original ID and independently reads the preserved timestamp', async () => {
    const h = harness(), result = await h.adapter.saveComment(h.proposal('edit'));
    assert.equal(result.status, 'saved'); assert.equal(h.reads, 2);
    assert.deepEqual(h.writes, [{ kind: 'edit', id: 'target', value: { annotation: '修改后 中文 空格' } }]);
    assert.deepEqual(h.data[0], { id: 'target', duration: 2.125, annotation: '修改后 中文 空格', extra: 'preserve' });
    assert.equal(h.data[1].annotation, '原有标注');
  });
  await test('Delete removes only the exact original ID, not other notes at the same timestamp', async () => {
    const h = harness(); h.data.push({ id: 'same-time', duration: 2.125, annotation: '原文字 空格' });
    const result = await h.adapter.saveComment(h.proposal('delete'));
    assert.equal(result.status, 'saved'); assert.deepEqual(h.data.map(item => item.id), ['other', 'same-time']);
    assert.deepEqual(h.writes, [{ kind: 'delete', id: 'target' }]);
  });
  await test('Changed or removed original prevents dispatch and returns a fresh list', async () => {
    for (const kind of ['edit', 'delete']) {
      const h = harness(); h.data[0].annotation = '外部修改';
      const result = await h.adapter.saveComment(h.proposal(kind));
      assert.equal(result.status, 'failed'); assert.equal(result.items.find(item => item.id === 'target').text, '外部修改');
      assert.equal(h.writes.length, 0);
    }
  });
  await test('A replaced library or invalid original timestamp cannot mutate anything', async () => {
    const h = harness(), proposal = h.proposal('edit'); h.library = path.resolve('another.library');
    assert.equal((await h.adapter.saveComment(proposal)).status, 'failed');
    const next = h.proposal('delete'); next.time = 8;
    assert.equal((await h.adapter.saveComment(next)).status, 'failed'); assert.equal(h.writes.length, 0);
  });
  await test('A changed SDK lastModified revision rejects even identical text/time', async () => {
    const h = harness(), proposal = h.proposal('delete'); proposal.original.revision = '1'; h.data[0].lastModified = 2;
    assert.equal((await h.adapter.saveComment(proposal)).status, 'failed'); assert.equal(h.writes.length, 0);
  });
  await test('Synchronous invalidation in the dispatch observer is still pre-dispatch failure', async () => {
    const h = harness(); let current = true;
    const result = await h.adapter.saveComment(h.proposal('edit'), { isCurrent: () => current, onIssued: () => { current = false; } });
    assert.equal(result.status, 'failed'); assert.equal(result.attempt, null); assert.equal(h.writes.length, 0);
  });
  await test('Lost responses after committed edit/delete are recovered by read-back without resending', async () => {
    for (const kind of ['edit', 'delete']) {
      const h = harness({ lostResponse: true });
      assert.equal((await h.adapter.saveComment(h.proposal(kind))).status, 'saved'); assert.equal(h.writes.length, 1);
    }
  });
  await test('Uncommitted timeout remains unknown; explicit verification never repeats deletion', async () => {
    const h = harness({ write: () => new Promise(() => {}) }), first = await h.adapter.saveComment(h.proposal('delete'));
    assert.equal(first.status, 'unknown'); assert.equal((await h.adapter.verifyComment(first.attempt)).status, 'unknown');
    h.data = h.data.filter(item => item.id !== 'target');
    assert.equal((await h.adapter.verifyComment(first.attempt)).status, 'saved'); assert.equal(h.writes.length, 1);
  });
  await test('An edit that changes the timestamp is not declared successful', async () => {
    const h = harness({ write: async (value, id, fields) => { Object.assign(value.data[0], fields, { duration: 2.5 }); } });
    assert.equal((await h.adapter.saveComment(h.proposal('edit'))).status, 'unknown');
  });
  await test('Session edit pauses, fixes original time, and duplicate saves issue only one mutation', async () => {
    const h = harness(); await h.load(); await h.session.editComment('target');
    assert.equal(h.session.snapshot().comments.draft.time, 2.125); assert.equal(h.pauses, 1);
    h.session.setCommentText('新文字 空格');
    const first = h.session.saveComment(), second = await h.session.saveComment();
    assert.equal(second.status, 'ignored'); assert.equal((await first).status, 'saved');
    assert.equal(h.session.snapshot().comments.draft, null); assert.equal(h.writes.length, 1); await h.session.close();
  });
  await test('Session delete opens a read-only confirmation; cancel never writes', async () => {
    const h = harness(); await h.load(); await h.session.deleteComment('target');
    assert.equal(h.session.snapshot().comments.draft.kind, 'delete'); assert.equal(h.writes.length, 0);
    assert.equal(h.session.setCommentText('cannot alter').status, 'ignored');
    h.session.cancelComment(); assert.equal(h.session.snapshot().comments.draft, null); assert.equal(h.writes.length, 0);
    await h.session.deleteComment('target'); assert.equal((await h.session.saveComment()).status, 'saved');
    assert.equal(h.writes.length, 1); await h.session.close();
  });
  await test('Close waits for an issued edit to settle without reviving the closed UI', async () => {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const h = harness({ write: async (value, id, fields) => { await gate; Object.assign(value.data.find(item => item.id === id), fields); } });
    await h.load(); await h.session.editComment('target'); h.session.setCommentText('已发出的修改');
    const saving = h.session.saveComment(); await tick();
    let settled = false; const closing = h.session.close().then(value => { settled = true; return value; });
    await tick(); assert.equal(settled, false); finish();
    assert.equal((await saving).status, 'saved'); await closing;
    assert.equal(h.session.snapshot().state, 'closed'); assert.equal(h.session.snapshot().comments.draft, null); assert.equal(h.writes.length, 1);
  });
  console.log('Comment mutation checks: ' + count + '; simulated SDK/session only, no Eagle writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
