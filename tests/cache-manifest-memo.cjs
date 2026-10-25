'use strict';
// Actual cache implementation with the existing in-memory Windows filesystem.
// No media, disk-cache writes, Eagle calls or deletion outside that model.
const assert = require('assert'), path = require('path').win32;
const { harness, prepared, SOURCE_SHA } = require('./t1-cache.cjs');
const { packed } = require('./cache-pack.cjs');
const stats = h => h.api._test.manifestMemoSnapshot(h.cache);
const manifestNode = (h, info) => h.nodes.get(path.join(info.cacheDir, 'manifest.json'));
async function warm(options = {}) {
  const h = harness(options), info = await prepared(h); h.cache.release(info);
  h.cache.inventory(); return { h, info };
}
async function remoteFixtures(count, paddingBytes = 0) {
  let filesystem; const h = harness({}, memory => { filesystem = memory.api; });
  const original = await prepared(h); h.cache.release(original);
  const base = JSON.parse(manifestNode(h, original).data), owner = JSON.parse(h.nodes.get(path.join(original.cacheDir, 'owner.json')).data);
  const padding = 'x'.repeat(paddingBytes), values = [];
  for (let n = 1; n <= count; n++) {
    const sourceSha = n.toString(16).padStart(64, '0'), leaseId = n.toString(16).padStart(24, '0');
    const cacheDir = original.cacheDir.replace(SOURCE_SHA, sourceSha), source = { ...base.source, sha256: sourceSha };
    const persistent = { ...base, source, metrics: paddingBytes ? { padding } : base.metrics };
    h.make(cacheDir, 'dir'); h.make(path.join(cacheDir, 'owner.json'), 'file', JSON.stringify(owner));
    h.make(path.join(cacheDir, 'manifest.json'), 'file', JSON.stringify(persistent));
    h.make(path.join(cacheDir, '000000.jpg'), 'file', 'frame-data');
    h.make(path.join(h.root, 'lease-' + leaseId + '.json'), 'file', JSON.stringify({ ...owner, kind: 'lease', token: leaseId,
      sourceSha256: sourceSha, cacheDir, pid: 4242, taskOwner: { key: 'memo-owner', epoch: 1, guardPid: 4242 } }));
    values.push({ ...persistent, cacheDir, leaseId });
  }
  // Fixtures stay immutable during this test. Index the model directory listing
  // once so its global Map scan does not manufacture O(N squared) test overhead.
  const children = new Map();
  for (const file of h.nodes.keys()) { const dir = path.dirname(file); if (dir !== file) { if (!children.has(dir)) children.set(dir, []); children.get(dir).push(path.basename(file)); } }
  filesystem.readdirSync = dir => { const key = h.normal(dir); assert.equal(h.nodes.get(key).kind, 'dir'); return [...children.get(key) || []]; };
  const adopt = value => { const copy = { ...value }; h.cache.adoptReadLease(copy); assert(h.cache.detachReadLease(copy)); };
  return { h, values, adopt };
}
async function main() {
  let count = 0;
  async function test(name, action) { await action(); count++; console.log('ok manifest memo: ' + name); }
  await test('identical raw bytes are reread and hashed while the validated parse is reused', async () => {
    const { h } = await warm(), before = stats(h), opens = h.state.readOpens.length;
    h.state.shortRead = 3; h.cache.inventory(); const after = stats(h);
    assert.equal(after.reads, before.reads + 1); assert.equal(after.hits, before.hits + 1);
    assert.equal(after.validations, before.validations);
    assert(h.state.readOpens.slice(opens).some(file => file.endsWith('manifest.json')));
    assert.equal(after.entries, 1); assert(after.bytes > 0);
    assert.equal(after.maxEntries, 4096); assert.equal(after.maxBytes, 32 * 1024 ** 2);
    assert.equal(h.descriptors.size, 0);
  });
  await test('same-length changed bytes with restored mtime cannot bypass full index validation', async () => {
    const { h, info } = await warm(), node = manifestNode(h, info), original = Buffer.from(node.data), stamp = node.mtimeMs;
    const text = original.toString().replace('"timeBase":[1,30]', '"timeBase":[0,30]');
    assert.notEqual(text, original.toString()); assert.equal(Buffer.byteLength(text), original.length);
    const before = stats(h); node.data = Buffer.from(text); node.mtimeMs = stamp;
    assert.throws(() => h.cache.inventory(), /timeBase/);
    assert.equal(stats(h).validations, before.validations + 1); assert.equal(stats(h).entries, 0);
    node.data = original; node.mtimeMs = stamp; h.cache.inventory(); assert.equal(stats(h).entries, 1);
    assert.equal(h.descriptors.size, 0);
  });
  await test('same-size valid changes also replace the canonical parse rather than reusing stale metadata', async () => {
    const { h, info } = await warm(), node = manifestNode(h, info), before = stats(h), stamp = node.mtimeMs;
    node.data = Buffer.from(node.data.toString().replace('"codec":"h264"', '"codec":"h265"')); node.mtimeMs = stamp;
    const tx = h.cache.begin({ sourceSha256: SOURCE_SHA });
    try { const candidate = await tx.readComplete(); assert.equal(candidate.source.codec, 'h265'); }
    finally { tx.close(); }
    assert.equal(stats(h).validations, before.validations + 1);
  });
  await test('unknown leaves, modified asset lengths and hardlinks are still rejected on warm hits', async () => {
    const { h, info } = await warm(), unknown = path.join(info.cacheDir, 'unknown.tmp');
    h.make(unknown, 'file', 'unknown'); const deleted = h.deleted.length;
    assert.throws(() => h.cache.inventory(), /未登记文件/); assert(h.nodes.has(unknown)); assert.equal(h.deleted.length, deleted);
    h.nodes.delete(unknown);
    const asset = h.nodes.get(path.join(info.cacheDir, info.frames[0].file)), original = asset.data;
    asset.data = Buffer.concat([original, Buffer.from('x')]); assert.throws(() => h.cache.inventory(), /长度/);
    asset.data = original; asset.nlink = 2; assert.throws(() => h.cache.inventory(), /普通文件/);
    asset.nlink = 1; h.cache.inventory(); assert.equal(h.descriptors.size, 0);
  });
  await test('owner records are not memoized and cannot be hidden by a manifest hit', async () => {
    const { h, info } = await warm(), owner = h.nodes.get(path.join(info.cacheDir, 'owner.json'));
    const before = Buffer.from(owner.data), value = JSON.parse(before); value.kind = 'partial'; owner.data = Buffer.from(JSON.stringify(value));
    assert.throws(() => h.cache.inventory(), /所有权/); owner.data = before; h.cache.inventory();
  });
  await test('caller metrics remain editable without contaminating a later candidate or canonical frames', async () => {
    const { h } = await warm(); let tx = h.cache.begin({ sourceSha256: SOURCE_SHA }), first;
    try {
      first = await tx.readComplete(); assert(Object.isFrozen(first.frames)); assert(Object.isFrozen(first.frames[0]));
      first.metrics.reused = 'caller-only'; first.metrics.newValue = 123;
      assert.throws(() => { first.frames[0].file = 'extra.jpg'; }, TypeError);
    } finally { tx.close(); }
    tx = h.cache.begin({ sourceSha256: SOURCE_SHA });
    try {
      const next = await tx.readComplete(); assert.notStrictEqual(next, first); assert.notStrictEqual(next.metrics, first.metrics);
      assert.equal(next.metrics.reused, false); assert.equal(next.metrics.newValue, undefined);
      next.metrics = { reused: true, preparationMs: 4 };
      const live = await tx.finish(next, { ...next.source }); assert.equal(live.metrics.preparationMs, 4); h.cache.release(live);
    } finally { tx.close(); }
    tx = h.cache.begin({ sourceSha256: SOURCE_SHA });
    try { const next = await tx.readComplete(); assert.equal(next.metrics.preparationMs, undefined); assert.equal(next.metrics.reused, false); }
    finally { tx.close(); }
  });
  await test('same-path rebuilt directory and replacement manifest inode require fresh validation', async () => {
    const { h, info } = await warm(); let before = stats(h);
    h.nodes.get(info.cacheDir).ino += 10000; h.cache.inventory();
    assert.equal(stats(h).validations, before.validations + 1); before = stats(h);
    manifestNode(h, info).exactIno = 9007199254740993n; h.cache.inventory();
    assert.equal(stats(h).validations, before.validations + 1); before = stats(h);
    // Adjacent file IDs alias as Number; the memo must still distinguish them.
    manifestNode(h, info).exactIno = 9007199254740994n; h.cache.inventory();
    assert.equal(stats(h).validations, before.validations + 1);
  });
  await test('partial publication is never memoized and guarded deletion invalidates a rebuilt path', async () => {
    const h = harness(), first = await prepared(h); h.cache.release(first);
    assert.equal(stats(h).reads, 0); assert.equal(stats(h).entries, 0);
    h.cache.inventory(); assert.equal(stats(h).entries, 1);
    const before = stats(h); h.cache.clearOther({ sourceSha256: 'b'.repeat(64) });
    assert.equal(stats(h).entries, 0); assert(!h.nodes.has(first.cacheDir));
    const rebuilt = await prepared(h); h.cache.release(rebuilt); assert.equal(rebuilt.cacheDir, first.cacheDir);
    h.cache.inventory(); assert.equal(stats(h).entries, 1); assert(stats(h).validations > before.validations);
  });
  await test('a different valid path and source never borrow another entry despite identical asset bytes', async () => {
    const { h } = await warm({ packFrames: true }), info = await packed(h, [Buffer.from('frame-data')], 'b'.repeat(64));
    h.cache.release(info); const before = stats(h); h.cache.inventory(); const after = stats(h);
    assert.equal(after.entries, 2); assert(after.validations > before.validations); assert(after.bytes > before.bytes);
  });
  await test('replacement of the manifest path while its old fd is open fails and closes that fd', async () => {
    const { h, info } = await warm(), file = path.join(info.cacheDir, 'manifest.json'); let fired = false;
    h.state.afterOpen = ({ file: opened, node, flags }) => {
      if (!fired && flags === 'r' && opened === file) { fired = true; h.nodes.set(file, { ...node, ino: node.ino + 50000 }); }
    };
    assert.throws(() => h.cache.inventory(), /元数据已改变/); assert(fired); assert.equal(h.descriptors.size, 0); assert.equal(stats(h).entries, 0);
    h.state.afterOpen = null; h.cache.inventory();
  });
  await test('manifest growth after opening fails before reading an unbounded allocation', async () => {
    const { h, info } = await warm(), file = path.join(info.cacheDir, 'manifest.json'); let fired = false;
    h.state.afterOpen = ({ file: opened, node, flags }) => {
      if (!fired && flags === 'r' && opened === file) { fired = true; node.data = Buffer.concat([node.data, Buffer.from(' ')]); }
    };
    assert.throws(() => h.cache.inventory(), /元数据身份已改变/); assert(fired); assert.equal(h.descriptors.size, 0);
  });
  await test('4096-entry cap evicts the least recently used parse and revalidates it when requested again', async () => {
    const { h, values, adopt } = await remoteFixtures(4097);
    values.forEach(adopt); let before = stats(h);
    assert.equal(before.entries, 4096); assert.equal(before.evictions, 1); assert(before.bytes <= before.maxBytes);
    adopt(values[1]); assert.equal(stats(h).validations, before.validations); // Refresh oldest surviving entry.
    adopt(values[0]); assert.equal(stats(h).validations, before.validations + 1); // Miss evicts values[2].
    before = stats(h); adopt(values[1]); assert.equal(stats(h).validations, before.validations);
    adopt(values[2]); assert.equal(stats(h).validations, before.validations + 1);
    assert.equal(stats(h).entries, 4096); assert.equal(h.descriptors.size, 0);
  });
  await test('32MiB raw-manifest cap evicts large parses independently of entry count', async () => {
    const { h, values, adopt } = await remoteFixtures(9, 4 * 1024 ** 2);
    values.forEach(adopt); const before = stats(h);
    assert(before.entries < values.length); assert(before.evictions > 0); assert(before.bytes <= 32 * 1024 ** 2);
    assert(before.entries < 4096); adopt(values[0]);
    assert.equal(stats(h).validations, before.validations + 1); assert(stats(h).bytes <= before.maxBytes);
    assert.equal(h.descriptors.size, 0);
  });
  console.log('Manifest memo: ' + count + ' in-memory integrity/isolation cases; no real media or Eagle.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
