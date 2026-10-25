'use strict';
// Fault injection models stopped Windows guards, never real process evidence.
// The production cache runs against the existing in-memory filesystem only.
const assert = require('assert'), path = require('path').win32;
const { harness, SOURCE_SHA } = require('./t1-cache.cjs');
const owner = epoch => ({ schema: 'eva-task-owner-v1', key: 'c'.repeat(64), epoch: epoch.repeat(32), guardPid: 123 });
const identity = { self: () => ({ pid: 4242, startTicks: '639000000000000001', image: 'D:\\worker.exe' }), child: () => null,
  inspect: () => ({ safe: true, reason: 'memory-model-only-previous-guard-confirmed-stopped' }) };
const source = sha => ({ sha256: sha, codec: 'h264', width: 1920, height: 1080, hasAudioStream: false });
function model() { let filesystem; const h = harness({ taskOwner: owner('a'), processIdentity: identity }, memory => { filesystem = memory.api; }); return { h, filesystem }; }
function open(cache, settings = {}) { return cache.openBatch({ sourceSha256: SOURCE_SHA, ...settings }); }
function data(asset, key) { return { source: source(key), width: 1280, height: 720, duration: 1,
  frames: [{ ...asset, id: 0, ptsTicks: '0', timeBase: [1, 30], time: 0, end: 1 }], audio: null, metrics: { sourceSha256: SOURCE_SHA } }; }
async function publish(batch, key = 'b'.repeat(64)) {
  const tx = batch.beginSegment({ sourceSha256: key }), asset = await tx.writeAsset('000000.jpg', Buffer.from('safe-frame'));
  const info = await tx.finish(data(asset, key), source(key)); tx.close(); return info;
}
function reset(h) { h.state.afterOpen = null; h.state.afterWrite = null; h.state.beforeUnlink = null;
  h.state.shortWrite = Infinity; h.state.writesUntilError = Infinity; h.state.failRename = false; h.descriptors.clear(); }
async function recover(h) { reset(h); const next = h.reboot({ taskOwner: owner('b'), processIdentity: identity });
  const batch = open(next); await batch.close(); assert.equal(h.descriptors.size, 0); return next; }
const snapshot = h => JSON.stringify([...h.nodes].map(([file, node]) => [file, node.ino, node.mtimeMs, node.data?.toString('hex')]));
async function interruptedReaper(point) {
  const { h, filesystem } = model(), batch = open(h.cache), complete = await publish(batch);
  const completeBytes = Buffer.from(h.nodes.get(path.join(complete.cacheDir, '000000.jpg')).data);
  const tx = batch.beginSegment({ sourceSha256: 'd'.repeat(64) }); await tx.writeAsset('000000.jpg', Buffer.from('interrupted-partial'));
  reset(h); const unlink = filesystem.unlinkSync; let fired = false;
  filesystem.unlinkSync = file => {
    const result = unlink(file);
    if (!fired && (point === 'current' ? /writer-current-[0-9a-f]{24}\.json$/.test(file) : file.endsWith('writer.lock'))) {
      fired = true; throw Error('reaper-after-' + point + '-unlink');
    }
    return result;
  };
  const attempt = h.reboot({ taskOwner: owner('b'), processIdentity: identity });
  assert.throws(() => open(attempt), new RegExp('reaper-after-' + point + '-unlink')); assert(fired);
  assert(![...h.nodes.keys()].some(file => /writer-current-[0-9a-f]{24}\.json$/.test(file)));
  const partial = [...h.nodes.keys()].find(file => /\\partial-[0-9a-f]{24}$/.test(file)); assert(partial);
  assert.equal(h.nodes.has(path.join(h.root, 'writer.lock')), point === 'current');
  return { h, partial, complete, completeBytes };
}
async function main() {
  let count = 0;
  async function test(name, action) { await action(); count++; console.log('ok batch recovery: ' + name); }
  for (const point of ['next-open', 'next-half', 'next-fsync', 'rename-before', 'rename-after']) await test('stopped at ' + point + ' recovers only exact bound metadata', async () => {
    const { h, filesystem } = model(), batch = open(h.cache); let fired = false;
    if (point === 'next-open') h.state.afterOpen = ({ file, flags }) => { if (flags === 'wx' && /\.next\.json$/.test(file)) { fired = true; throw Error('model-stop-next-open'); } };
    if (point === 'next-half') { h.state.shortWrite = 17; h.state.writesUntilError = 1; fired = true; }
    if (point === 'next-fsync') { const original = filesystem.fsyncSync; filesystem.fsyncSync = fd => {
      if (/\.next\.json$/.test(h.descriptors.get(fd)?.file || '')) { fired = true; throw Error('model-stop-next-fsync'); } return original(fd); }; }
    if (point.startsWith('rename-')) { const original = filesystem.renameSync; filesystem.renameSync = (from, to) => {
      if (/writer-current-.*\.next\.json$/.test(from)) { fired = true; if (point === 'rename-after') original(from, to); throw Error('model-stop-rename'); } return original(from, to); }; }
    assert.throws(() => batch.beginSegment({ sourceSha256: 'b'.repeat(64) })); assert(fired);
    const next = await recover(h); assert(![...h.nodes.keys()].some(file => /writer-current-|partial-/.test(file)));
    assert.equal(next.inventory().caches.length, 0);
  });
  for (const point of ['partial', 'manifest', 'owner-next', 'published']) await test('stopped at ' + point + ' preserves completed segments and cleans only owned output', async () => {
    const { h, filesystem } = model(), batch = open(h.cache), first = await publish(batch), firstBytes = Buffer.from(h.nodes.get(path.join(first.cacheDir, '000000.jpg')).data);
    const key = 'd'.repeat(64), tx = batch.beginSegment({ sourceSha256: key }); let fired = false;
    if (point !== 'published') h.state.afterWrite = ({ file }) => {
      if (!fired && (point === 'partial' && file.endsWith('000000.jpg') || point === 'manifest' && file.endsWith('manifest.json') ||
        point === 'owner-next' && /owner\.next-/.test(file))) { fired = true; throw Error('model-stop-' + point); }
    };
    if (point === 'published') { const original = filesystem.renameSync; filesystem.renameSync = (from, to) => {
      const result = original(from, to); if (/\\partial-/.test(from) && /\\media-/.test(to)) { fired = true; throw Error('model-stop-published'); } return result;
    }; }
    let asset;
    try { asset = await tx.writeAsset('000000.jpg', Buffer.from('second-frame')); if (asset) await tx.finish(data(asset, key), source(key)); }
    catch (error) { assert(/model-stop/.test(error.message)); }
    assert(fired); const next = await recover(h);
    assert(h.nodes.get(path.join(first.cacheDir, '000000.jpg')).data.equals(firstBytes));
    assert(![...h.nodes.keys()].some(file => /\\partial-|owner\.next-|writer-current-/.test(file)));
    assert(next.inventory().caches.length >= 1);
  });
  for (const which of ['missing', 'corrupt', 'wrong-target']) await test('partial plus ' + which + ' current refuses recovery without guessing a derived target', async () => {
    const { h } = model(), batch = open(h.cache), tx = batch.beginSegment({ sourceSha256: 'b'.repeat(64) });
    await tx.writeAsset('000000.jpg', Buffer.from('owned-partial'));
    const file = [...h.nodes.keys()].find(name => /writer-current-[0-9a-f]{24}\.json$/.test(name));
    if (which === 'missing') h.nodes.delete(file);
    else if (which === 'corrupt') h.nodes.get(file).data = Buffer.from('{broken');
    else { const value = JSON.parse(h.nodes.get(file).data); value.target = value.target.replace('b'.repeat(64), 'e'.repeat(64)); h.nodes.get(file).data = Buffer.from(JSON.stringify(value)); }
    reset(h); const before = snapshot(h), deleted = h.deleted.length;
    const next = h.reboot({ taskOwner: owner('b'), processIdentity: identity }); assert.throws(() => open(next), /当前目标.*缺失|当前目标.*损坏|当前目标记录/);
    assert.equal(snapshot(h), before); assert.equal(h.deleted.length, deleted);
  });
  await test('a damaged staged next cannot override the valid current target', async () => {
    const { h } = model(), batch = open(h.cache), tx = batch.beginSegment({ sourceSha256: 'b'.repeat(64) });
    await tx.writeAsset('000000.jpg', Buffer.from('active-partial'));
    const current = [...h.nodes.keys()].find(file => /writer-current-[0-9a-f]{24}\.json$/.test(file));
    h.make(current.replace('.json', '.next.json'), 'file', '{"target":"G:\\outside');
    const next = await recover(h); assert.equal(next.inventory().caches.length, 0);
    assert(![...h.nodes.keys()].some(file => /writer-current-|partial-/.test(file)));
  });
  for (const point of ['current-delete', 'writer-delete']) await test('stopped after ' + point + ' retains published media and can reopen', async () => {
    const { h, filesystem } = model(), batch = open(h.cache), info = await publish(batch), bytes = Buffer.from(h.nodes.get(path.join(info.cacheDir, '000000.jpg')).data);
    const unlink = filesystem.unlinkSync; let fired = false;
    filesystem.unlinkSync = file => { const result = unlink(file);
      if (!fired && (point === 'current-delete' && /writer-current-[0-9a-f]{24}\.json$/.test(file) || point === 'writer-delete' && file.endsWith('writer.lock'))) {
        fired = true; throw Error('model-stop-delete'); } return result;
    };
    await assert.rejects(batch.close(), /model-stop-delete/); assert(fired);
    const next = await recover(h); assert(h.nodes.get(path.join(info.cacheDir, '000000.jpg')).data.equals(bytes));
    assert.equal(next.inventory().caches.length, 1);
  });
  await test('close refuses changed root bytes and succeeds on a retry after a transient unlink failure', async () => {
    const { h } = model(), batch = open(h.cache), info = await publish(batch);
    const extra = path.join(h.root, 'unknown-user-file'); h.make(extra, 'file', 'preserve');
    await assert.rejects(batch.close(), /未知|包含/); assert(h.nodes.has(extra)); assert(h.nodes.has(path.join(h.root, 'writer.lock')));
    h.nodes.delete(extra); let fired = false;
    h.state.beforeUnlink = file => { if (!fired && /writer-current-/.test(file)) { fired = true; throw Error('transient-unlink'); } };
    await assert.rejects(batch.close(), /transient-unlink/); h.state.beforeUnlink = null;
    assert(await batch.close()); h.cache.release(info); assert.equal(h.descriptors.size, 0);
  });
  await test('more than32 guarded child registrations close at per-segment boundaries', async () => {
    const { h } = model(), batch = open(h.cache);
    for (let n = 0; n < 45; n++) {
      const tx = batch.beginSegment({ sourceSha256: n.toString(16).padStart(64, '0') }), child = tx.beforeSpawn(); tx.childStarted(child, 9000 + n);
      assert.throws(() => tx.close(), /辅助进程|输出流/); tx.childClosed(child); tx.close();
    }
    await batch.close(); assert.equal(h.descriptors.size, 0);
  });
  for (const point of ['current', 'writer']) await test('reaper actually unlinks ' + point + ', stops with partial remaining, then resumes the original sealed plan', async () => {
    const { h, complete, completeBytes } = await interruptedReaper(point);
    const pending = [...h.nodes].filter(([file]) => /reap-[0-9a-f]{24}\.json$/.test(file)); assert(pending.length);
    const sealed = pending.map(([file, node]) => [file, Buffer.from(node.data)]);
    reset(h); const next = h.reboot({ taskOwner: owner('c'), processIdentity: identity }), batch = open(next); await batch.close();
    for (const [file, data] of sealed) assert(h.nodes.get(file).data.equals(data), 'Original recovery plan must not be replaced');
    assert(h.nodes.get(path.join(complete.cacheDir, '000000.jpg')).data.equals(completeBytes));
    assert(![...h.nodes.keys()].some(file => /writer-current-|\\partial-/.test(file)));
    assert.equal(next.inventory().caches.length, 1); assert.equal(h.descriptors.size, 0);
  });
  for (const damage of ['proof', 'guard', 'missing-plan', 'partial-identity']) await test('interrupted recovery refuses ' + damage + ' rather than inventing a new target/plan', async () => {
    const { h, partial } = await interruptedReaper('current');
    const [planFile, planNode] = [...h.nodes].find(([file]) => /reap-[0-9a-f]{24}\.json$/.test(file));
    if (damage === 'proof') {
      const value = JSON.parse(planNode.data), slot = value.records.find(item => item.ownerRecord.currentBytes);
      assert(slot); slot.ownerRecord.currentBytes = Buffer.from('not-the-original-current').toString('base64'); planNode.data = Buffer.from(JSON.stringify(value));
    } else if (damage === 'missing-plan') h.nodes.delete(planFile);
    else if (damage === 'partial-identity') h.nodes.get(path.join(partial, '000000.jpg')).ino++;
    reset(h); const before = snapshot(h), deleted = h.deleted.length;
    const taskOwner = damage === 'guard' ? { ...owner('c'), key: 'e'.repeat(64) } : owner('c');
    const next = h.reboot({ taskOwner, processIdentity: identity }); assert.throws(() => open(next));
    assert.equal(snapshot(h), before); assert.equal(h.deleted.length, deleted);
  });
  console.log('Batch recovery: ' + count + ' in-memory interrupted-write/reopen cases; no real process, media or Eagle.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { model, open, publish, data, source, owner, identity };
