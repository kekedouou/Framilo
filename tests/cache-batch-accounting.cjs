'use strict';
// Exact physical-byte accounting at recoverable failure boundaries; memory only.
const assert = require('assert'), path = require('path').win32;
const { model, open, data, source, owner, identity } = require('./cache-batch-recovery.cjs');
const bytes = h => [...h.nodes.values()].filter(node => node.kind === 'file').reduce((sum, node) => sum + node.data.length, 0);
const ledger = (h, batch) => assert.equal(batch.snapshot().usedBytes, bytes(h));
async function main() {
  let count = 0;
  const test = async (name, action) => { await action(); count++; console.log('ok batch accounting: ' + name); };
  for (const point of ['ledger', 'frame', 'stream']) await test('partial ' + point + ' writes refund only bytes that never reached disk', async () => {
    const { h } = model(), batch = open(h.cache), tx = batch.beginSegment({ sourceSha256: 'b'.repeat(64) });
    if (point === 'stream') {
      const stream = tx.openAsset('audio.wav'); h.state.shortWrite = 3; h.state.writesUntilError = 1;
      assert.throws(() => stream.append(Buffer.from('0123456789')), /EIO/);
      h.state.shortWrite = Infinity; h.state.writesUntilError = Infinity; await stream.close();
    } else {
      h.state.shortWrite = 3;
      if (point === 'ledger') h.state.afterWrite = ({ file, node }) => {
        if (/\\partial-[^\\]+\\owner\.json$/.test(file) && node.data.at(-1) === 125) h.state.writesUntilError = 1;
      };
      else h.state.afterWrite = ({ file, node }) => { if (file.endsWith('transaction.log') && node.data.at(-1) === 10) h.state.writesUntilError = 1; };
      await assert.rejects(tx.writeAsset('000000.jpg', Buffer.from('0123456789')), /EIO/);
      h.state.afterWrite = null; h.state.shortWrite = Infinity; h.state.writesUntilError = Infinity;
    }
    ledger(h, batch); assert(tx.abort()); ledger(h, batch); tx.close(); await batch.close();
    assert.equal(h.descriptors.size, 0);
  });
  await test('a half-written current slot can be cleaned by its owning live batch without losing bytes', async () => {
    const { h } = model(), batch = open(h.cache); h.state.shortWrite = 3; h.state.writesUntilError = 1;
    assert.throws(() => batch.beginSegment({ sourceSha256: 'b'.repeat(64) }), /EIO/);
    h.state.shortWrite = Infinity; h.state.writesUntilError = Infinity; ledger(h, batch); await batch.close();
    assert(![...h.nodes.keys()].some(file => /writer-current-/.test(file))); assert.equal(h.descriptors.size, 0);
  });
  await test('a failed lease append removes only its own verified prefix and leaves the committed cache reusable', async () => {
    const { h } = model(), batch = open(h.cache), key = 'b'.repeat(64), tx = batch.beginSegment({ sourceSha256: key });
    const asset = await tx.writeAsset('000000.jpg', Buffer.from('frame'));
    h.state.afterWrite = ({ file }) => { if (/owner\.next-/.test(file)) { h.state.shortWrite = 3; h.state.writesUntilError = 1; } };
    await assert.rejects(tx.finish(data(asset, key), source(key)), /EIO/);
    h.state.afterWrite = null; h.state.shortWrite = Infinity; h.state.writesUntilError = Infinity;
    assert(![...h.nodes.keys()].some(file => /\\lease-/.test(file))); ledger(h, batch); tx.close(); await batch.close();
    assert.equal(h.cache.inventory().caches.length, 1); assert.equal(h.descriptors.size, 0);
  });
  await test('touch open-before-create EACCES refunds the batch reservation and permits a successful close', async () => {
    const { h, filesystem } = model(), batch = open(h.cache), key = 'b'.repeat(64), tx = batch.beginSegment({ sourceSha256: key });
    const asset = await tx.writeAsset('000000.jpg', Buffer.from('frame')), original = filesystem.openSync;
    filesystem.openSync = (file, flags) => { if (/owner\.next-/.test(file) && flags === 'wx') throw Object.assign(Error('touch-open-denied'), { code: 'EACCES' }); return original(file, flags); };
    await assert.rejects(tx.finish(data(asset, key), source(key)), error => error.code === 'EACCES' && !error.cleanupError);
    filesystem.openSync = original; assert(![...h.nodes.keys()].some(file => /owner\.next-/.test(file)));
    ledger(h, batch); tx.close(); await batch.close(); assert.equal(h.descriptors.size, 0);
  });
  await test('ordinary touch open failure refunds exactly enough for a boundary-budget reuse retry', async () => {
    const { h, filesystem } = model(), key = 'b'.repeat(64), seed = h.cache.begin({ sourceSha256: key });
    const writerBytes = h.nodes.get(path.join(h.root, 'writer.lock')).data.length;
    const asset = await seed.writeAsset('000000.jpg', Buffer.alloc(22000, 3)), info = await seed.finish(data(asset, key), source(key)); seed.close();
    const ownerBytes = h.nodes.get(path.join(info.cacheDir, 'owner.json')).data.length;
    const leaseBytes = h.nodes.get(path.join(h.root, 'lease-' + info.leaseId + '.json')).data.length;
    const peak = bytes(h) + writerBytes + Math.max(ownerBytes, leaseBytes);
    let limit = Math.ceil(peak * 8 / 7); while (limit - Math.floor(limit / 8) < peak) limit++;
    const limited = h.reboot({ diskBytes: limit, processIdentity: { ...identity, inspect: () => ({ safe: false }) } });
    const tx = limited.begin({ sourceSha256: key }), candidate = await tx.readComplete(), original = filesystem.openSync;
    filesystem.openSync = (file, flags) => { if (/owner\.next-/.test(file) && flags === 'wx') throw Object.assign(Error('touch-open-denied'), { code: 'EACCES' }); return original(file, flags); };
    await assert.rejects(tx.finish(candidate, source(key)), error => error.code === 'EACCES' && !error.cleanupError);
    filesystem.openSync = original;
    const reused = await tx.finish(candidate, source(key)); tx.close(); limited.release(reused); h.cache.release(info);
    assert.equal(limited.inventory().caches.length, 1); assert.equal(h.descriptors.size, 0);
  });
  for (const point of ['current-open', 'partial-mkdir', 'partial-owner-open', 'partial-ledger-open']) await test(point + ' failure does not leave reserved ghost bytes in the batch', async () => {
    const { h, filesystem } = model(), batch = open(h.cache), originalOpen = filesystem.openSync, originalMkdir = filesystem.mkdirSync;
    let tx;
    if (point !== 'current-open') tx = batch.beginSegment({ sourceSha256: 'b'.repeat(64) });
    filesystem.openSync = (file, flags) => {
      if (point === 'current-open' && /writer-current-.*\.next\.json$/.test(file) ||
        point === 'partial-owner-open' && /\\partial-[^\\]+\\owner\.json$/.test(file) ||
        point === 'partial-ledger-open' && file.endsWith('transaction.log')) throw Object.assign(Error(point), { code: 'EACCES' });
      return originalOpen(file, flags);
    };
    filesystem.mkdirSync = file => { if (point === 'partial-mkdir' && /\\partial-/.test(file)) throw Object.assign(Error(point), { code: 'EACCES' }); return originalMkdir(file); };
    if (point === 'current-open') assert.throws(() => batch.beginSegment({ sourceSha256: 'b'.repeat(64) }), /current-open/);
    else await assert.rejects(tx.writeAsset('000000.jpg', Buffer.from('frame')), error => error.code === 'EACCES');
    filesystem.openSync = originalOpen; filesystem.mkdirSync = originalMkdir; ledger(h, batch);
    if (tx) { tx.abort(); tx.close(); } ledger(h, batch); await batch.close(); assert.equal(h.descriptors.size, 0);
  });
  await test('lease open-before-create failure refunds its reservation and leaves the committed target intact', async () => {
    const { h, filesystem } = model(), batch = open(h.cache), key = 'b'.repeat(64), tx = batch.beginSegment({ sourceSha256: key });
    const asset = await tx.writeAsset('000000.jpg', Buffer.from('frame')), original = filesystem.openSync;
    filesystem.openSync = (file, flags) => { if (/\\lease-/.test(file) && flags === 'wx') throw Object.assign(Error('lease-open-denied'), { code: 'EACCES' }); return original(file, flags); };
    await assert.rejects(tx.finish(data(asset, key), source(key)), /lease-open-denied/); filesystem.openSync = original;
    ledger(h, batch); tx.close(); await batch.close(); assert.equal(h.cache.inventory().caches.length, 1); assert.equal(h.descriptors.size, 0);
  });
  for (const batchMode of [false, true]) await test('touch cleanup failure preserves the original error without an out-of-scope batchMode reference: ' + batchMode, async () => {
    const { h } = model(), batch = batchMode ? open(h.cache) : null, key = 'b'.repeat(64);
    const tx = batch ? batch.beginSegment({ sourceSha256: key }) : h.cache.begin({ sourceSha256: key });
    const asset = await tx.writeAsset('000000.jpg', Buffer.from('frame'));
    h.state.afterWrite = ({ file }) => { if (/owner\.next-/.test(file)) throw Error('touch-write-failure'); };
    await assert.rejects(tx.finish(data(asset, key), source(key)), error => error.message === 'touch-write-failure' && !!error.cleanupError);
    h.state.afterWrite = null; h.descriptors.clear();
    const next = h.reboot({ taskOwner: owner('b'), processIdentity: identity }), replacement = next.begin({ sourceSha256: key });
    replacement.close(); assert.equal(next.inventory().caches.length, 1);
  });
  await test('initialization rollback failure has an explicit sticky cleanup error rather than losing the writer capability silently', async () => {
    const { h } = model();
    h.state.afterOpen = ({ file, flags }) => { if (flags === 'wx' && file.endsWith('writer.lock')) h.make(path.join(h.root, 'external.txt'), 'file', 'preserve'); };
    h.state.beforeUnlink = file => { if (file.endsWith('writer.lock')) throw Error('writer-unlink-failure'); };
    assert.throws(() => open(h.cache), error => error.code === 'MEDIA_CLEANUP_FAILED' && error.cause.cleanupError === 'writer-unlink-failure');
    assert(h.nodes.has(path.join(h.root, 'writer.lock'))); assert(h.nodes.has(path.join(h.root, 'external.txt'))); assert.equal(h.descriptors.size, 0);
  });
  await test('an interrupted reaper resumes from its persisted batch-slot proof without guessing a missing current record', async () => {
    const { h } = model(), batch = open(h.cache), tx = batch.beginSegment({ sourceSha256: 'b'.repeat(64) });
    await tx.writeAsset('000000.jpg', Buffer.from('partial')); h.descriptors.clear(); let fired = false;
    h.state.beforeUnlink = file => { if (!fired && /writer-current-/.test(file)) { fired = true; throw Error('reaper-interrupted'); } };
    const attempt = h.reboot({ taskOwner: owner('b'), processIdentity: identity }); assert.throws(() => open(attempt), /reaper-interrupted/); assert(fired);
    h.state.beforeUnlink = null; h.descriptors.clear();
    const next = h.reboot({ taskOwner: owner('c'), processIdentity: identity }), replacement = open(next); await replacement.close();
    assert(![...h.nodes.keys()].some(file => /writer-current-|\\partial-/.test(file))); assert.equal(h.descriptors.size, 0);
    const plans = [...h.nodes].filter(([file]) => /reap-[0-9a-f]{24}\.json$/.test(file)); assert(plans.length);
  });
  console.log('Batch accounting: ' + count + ' exact failure/restart models; no real files, processes or media.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
