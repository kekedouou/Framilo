'use strict';

// Independent public contract for the E35 writer session. All mutations use
// the existing VM-injected in-memory filesystem; no real cache/media writes.
const assert = require('assert'), path = require('path').win32, crypto = require('crypto');
const { harness, prepared, SOURCE_SHA } = require('./t1-cache.cjs');
const profile = require('../plugin/preview-profile.cjs');
const ROOT = 'D:\\fixtures\\plugin\\cache';
const guard = epoch => ({ schema: 'eva-task-owner-v1', key: 'c'.repeat(64), epoch: epoch.repeat(32), guardPid: 123 });
const original = { sha256: SOURCE_SHA, codec: 'h264', width: 1920, height: 1080, hasAudioStream: false };
const key = ordinal => crypto.createHash('sha256').update('independent-segment/' + ordinal).digest('hex');
const physicalBytes = h => [...h.nodes.values()].filter(node => node.kind === 'file').reduce((sum, node) => sum + node.data.length, 0);
const rejects = (operation, match) => assert.rejects(Promise.resolve().then(operation), match);
function model(options = {}) {
  return harness({ taskOwner: guard('a'), ...options }, memory => {
    const read = memory.api.readdirSync;
    memory.state.rootEnumerations = 0;
    memory.api.readdirSync = directory => {
      if (memory.normal(directory) === ROOT) memory.state.rootEnumerations++;
      return read(directory);
    };
  });
}
async function open(h, settings = {}) {
  assert.equal(typeof h.cache.openBatch, 'function', 'E35 openBatch must be implemented; this contract must not silently skip');
  const batch = await h.cache.openBatch({ sourceSha256: SOURCE_SHA, previewQuality: '720p', ...settings });
  assert.equal(typeof batch.beginSegment, 'function'); assert.equal(typeof batch.snapshot, 'function'); assert.equal(typeof batch.close, 'function');
  return batch;
}
function source(sha) { return { ...original, sha256: sha }; }
function manifest(asset, sha, realSha = SOURCE_SHA) {
  const preview = profile.dimensions(original, '720p');
  return { source: source(sha), preview, width: preview.width, height: preview.height, duration: 1,
    frames: [{ ...asset, id: 0, ptsTicks: '0', timeBase: [1, 30], time: 0, end: 1 }], audio: null,
    metrics: { sourceSha256: realSha, segmentStart: 0 } };
}
async function publish(batch, ordinal, bytes = Buffer.from('frame-' + ordinal)) {
  const sha = key(ordinal), tx = batch.beginSegment({ sourceSha256: sha, previewQuality: '720p' });
  assert.strictEqual(await tx.readComplete(), null);
  const asset = await tx.writeAsset('000000.jpg', bytes), info = await tx.finish(manifest(asset, sha), source(sha));
  await tx.close(); return info;
}
function assertLedger(h, batch, label) {
  const value = batch.snapshot();
  assert(Number.isSafeInteger(value.usedBytes) && value.usedBytes >= 0, label + ': nonnegative exact byte ledger');
  assert.equal(value.usedBytes, physicalBytes(h), label + ': physical writer/current/lease/assets/receipts must all be charged exactly');
  assert(Number.isSafeInteger(value.diskLimitBytes) && value.usedBytes <= value.diskLimitBytes, label + ': disk quota');
  return value;
}
async function main() {
  let count = 0;
  async function test(name, body) { await body(); count++; console.log('ok batch contract: ' + name); }
  await test('legacy begin remains usable and the root writer is exclusive across both APIs', async () => {
    const h = model(), old = await prepared(h);
    assert.equal((await h.cache.readAsset(old, old.frames[0].file)).toString(), 'frame-data'); h.cache.release(old);
    const normal = h.cache.begin({ sourceSha256: SOURCE_SHA });
    await rejects(() => open(h), /任务|writer|写锁|占用|运行|batch|批量/i); normal.close();
    const batch = await open(h);
    await rejects(() => h.cache.begin({ sourceSha256: key('ordinary') }), /任务|writer|写锁|占用|运行|batch|批量/i);
    await rejects(() => h.cache.openBatch({ sourceSha256: 'b'.repeat(64), previewQuality: '720p' }), /任务|writer|写锁|占用|运行|batch|批量/i);
    await batch.close();
    const next = h.cache.begin({ sourceSha256: SOURCE_SHA }); next.close(); assert.equal(h.descriptors.size, 0);
  });
  await test('session quality, key syntax and original source binding cannot be mixed', async () => {
    const h = model(), batch = await open(h);
    for (const sha of ['', '../outside', 'b'.repeat(63), 'G'.repeat(64), 'b'.repeat(65)])
      await rejects(() => batch.beginSegment({ sourceSha256: sha, previewQuality: '720p' }));
    await rejects(() => batch.beginSegment({ sourceSha256: key(0), previewQuality: '1080p' }));
    const tx = batch.beginSegment({ sourceSha256: key(0), previewQuality: '720p' }), asset = await tx.writeAsset('000000.jpg', Buffer.from('foreign'));
    await rejects(() => tx.finish(manifest(asset, key(0), 'b'.repeat(64)), source(key(0))), /源|素材|source|绑定/i);
    await tx.abort(); await tx.close(); await batch.close();
    // Old ordinary writers may contain another source's derived cache. A batch
    // must not adopt it merely because its caller supplies that otherwise valid key.
    const foreign = h.cache.begin({ sourceSha256: key(1), previewQuality: '720p' }), payload = await foreign.writeAsset('000000.jpg', Buffer.from('prior-source'));
    const prior = await foreign.finish(manifest(payload, key(1), 'b'.repeat(64)), source(key(1))); foreign.close(); h.cache.release(prior);
    const reopened = await open(h), candidate = reopened.beginSegment({ sourceSha256: key(1), previewQuality: '720p' });
    await rejects(() => candidate.readComplete(), /源|素材|source|绑定/i); await candidate.abort(); await candidate.close(); await reopened.close();
    assert.equal(h.descriptors.size, 0);
  });
  await test('published leases remain readable while the batch owns the root and after close/reboot', async () => {
    const h = model(), batch = await open(h), info = await publish(batch, 2, Buffer.from('retained-frame'));
    assert.equal((await h.cache.readAsset(info, info.frames[0].file)).toString(), 'retained-frame');
    await batch.close();
    assert.equal((await h.cache.readAsset(info, info.frames[0].file)).toString(), 'retained-frame'); h.cache.release(info);
    const next = h.reboot(), reopened = await next.openBatch({ sourceSha256: SOURCE_SHA, previewQuality: '720p' });
    const tx = reopened.beginSegment({ sourceSha256: key(2), previewQuality: '720p' }), complete = await tx.readComplete(); assert(complete);
    const reused = await tx.finish(complete, source(key(2))); await tx.close();
    assert.equal((await next.readAsset(reused, reused.frames[0].file)).toString(), 'retained-frame'); next.release(reused); await reopened.close();
    assert.equal(h.descriptors.size, 0);
  });
  await test('an unclosed child output or transaction cannot retarget or report a successful batch close', async () => {
    const h = model(), batch = await open(h), tx = batch.beginSegment({ sourceSha256: key(3), previewQuality: '720p' });
    const stream = tx.openAsset('000000.jpg'); await stream.append(Buffer.from('unfinished'));
    const writer = path.join(h.root, 'writer.lock'), writerBytes = Buffer.from(h.nodes.get(writer).data);
    await rejects(() => batch.beginSegment({ sourceSha256: key(4), previewQuality: '720p' })); await rejects(() => batch.close());
    assert(h.nodes.has(writer)); assert(h.nodes.get(writer).data.equals(writerBytes)); assert(!batch.snapshot().closed);
    await stream.close(); await tx.abort(); await tx.close();
    const published = batch.beginSegment({ sourceSha256: key(4), previewQuality: '720p' }), asset = await published.writeAsset('000000.jpg', Buffer.from('published-not-closed'));
    const info = await published.finish(manifest(asset, key(4)), source(key(4)));
    await rejects(() => batch.beginSegment({ sourceSha256: key(5), previewQuality: '720p' })); await rejects(() => batch.close());
    await published.close(); h.cache.release(info); await batch.close(); assert(!h.nodes.has(writer)); assert.equal(h.descriptors.size, 0);
  });
  await test('100 then 900 independent segments do not enumerate the whole root for each target or sequence', async () => {
    const h = model(), batch = await open(h), opened = h.state.rootEnumerations; assert(opened > 0, 'opening must actually verify the root');
    for (let n = 0; n < 100; n++) { const info = await publish(batch, 1000 + n, Buffer.from([n & 255])); h.cache.release(info); }
    const at100 = h.state.rootEnumerations;
    assert(at100 - opened <= 2, 'first 100 target commits must use the verified session ledger, not repeated full-root scans');
    for (let n = 100; n < 900; n++) { const info = await publish(batch, 1000 + n, Buffer.from([n & 255])); h.cache.release(info); }
    const at900 = h.state.rootEnumerations;
    assert(at900 - at100 <= 2, 'the next 800 targets must not introduce root scans proportional to segment count');
    assertLedger(h, batch, 'after 900 segments'); await batch.close();
    assert(h.state.rootEnumerations > at900, 'close must independently reconcile the full root');
    assert(h.state.rootEnumerations - at900 <= 20, 'closing is a bounded number of full scans, not one scan per segment');
    assert.equal(h.descriptors.size, 0);
  });
  await test('stable byte ledger includes current metadata, leases, aborts and quota rejection', async () => {
    const h = model({ diskBytes: 96 * 1024 }), batch = await open(h); assertLedger(h, batch, 'initial batch');
    const tx = batch.beginSegment({ sourceSha256: key(6), previewQuality: '720p' }); assertLedger(h, batch, 'current target installed');
    const asset = await tx.writeAsset('000000.jpg', Buffer.alloc(16 * 1024, 7)); assertLedger(h, batch, 'partial output and ownership ledger');
    const info = await tx.finish(manifest(asset, key(6)), source(key(6))); assertLedger(h, batch, 'committed output and active lease');
    await tx.close(); assertLedger(h, batch, 'child closed, root writer retained');
    h.cache.release(info); assertLedger(h, batch, 'lease removed');
    const aborted = batch.beginSegment({ sourceSha256: key(7), previewQuality: '720p' });
    await aborted.writeAsset('000000.jpg', Buffer.alloc(4096, 9)); assertLedger(h, batch, 'second partial');
    await aborted.abort(); await aborted.close(); assertLedger(h, batch, 'abort removes exact owned bytes');
    const overflow = batch.beginSegment({ sourceSha256: key(8), previewQuality: '720p' });
    await rejects(() => overflow.writeAsset('000000.jpg', Buffer.alloc(128 * 1024, 1)), /预算|容量|上限|空间/);
    assert(physicalBytes(h) <= 96 * 1024, 'quota rejection must precede oversized output');
    await overflow.abort(); await overflow.close(); assertLedger(h, batch, 'rejected write cleanup'); await batch.close();
    assert.equal(h.cache.inventory().usedBytes, physicalBytes(h)); assert.equal(h.descriptors.size, 0);
  });
  await test('session cancellation blocks new targets but permits owned child cleanup and final writer release', async () => {
    const h = model(), controller = new AbortController(), batch = await open(h, { sessionSignal: controller.signal });
    const tx = batch.beginSegment({ sourceSha256: key(9), previewQuality: '720p' }); await tx.writeAsset('000000.jpg', Buffer.from('cancelled-child'));
    controller.abort(); await rejects(() => batch.beginSegment({ sourceSha256: key(10), previewQuality: '720p' }));
    await rejects(() => batch.close()); assert(h.nodes.has(path.join(h.root, 'writer.lock')));
    await tx.abort(); await tx.close(); await batch.close(); assert(batch.snapshot().closed);
    assert(![...h.nodes.keys()].some(file => /(?:writer\.lock|writer-current-|partial-)/.test(file))); assert.equal(h.descriptors.size, 0);
  });
  await test('a corrupt current record with live partial is preserved on restart, never inferred from the root first key', async () => {
    const h = model(), batch = await open(h), first = await publish(batch, 'first-key'); h.cache.release(first);
    const tx = batch.beginSegment({ sourceSha256: key('actual-current'), previewQuality: '720p' }); await tx.writeAsset('000000.jpg', Buffer.from('must-preserve'));
    const current = [...h.nodes.keys()].find(file => /^writer-current-[0-9a-f]{24}\.json$/.test(path.basename(file)));
    const partial = [...h.nodes.keys()].find(file => /^partial-[0-9a-f]{24}$/.test(path.basename(file)));
    assert(current && partial, 'current target must be durably registered before a partial exists');
    h.nodes.get(current).data = Buffer.from('{corrupt-current'); h.nodes.get(current).mtimeMs++;
    const protectedFiles = new Map([...h.nodes].map(([file, node]) => [file, { kind: node.kind, bytes: Buffer.from(node.data || '') }]));
    h.descriptors.clear();
    const restarted = h.reboot({ taskOwner: guard('b'), processIdentity: {
      self: () => ({ pid: 5151, startTicks: '639000000000000001', image: 'D:\\fixtures\\worker-next.exe' }), child: () => null,
      inspect: () => ({ safe: true, reason: 'model-confirmed-previous-guard-empty' }) } });
    await rejects(() => restarted.openBatch({ sourceSha256: SOURCE_SHA, previewQuality: '720p' }));
    for (const [file, before] of protectedFiles) {
      assert(h.nodes.has(file), 'restart must preserve unknown ownership: ' + file);
      assert(Buffer.from(h.nodes.get(file).data || '').equals(before.bytes), 'restart must not rewrite a corrupt or ambiguous prior record: ' + file);
    }
    assert(h.nodes.has(first.cacheDir) && h.nodes.has(partial) && h.nodes.has(current));
  });
  console.log('Cache batch public contract: ' + count + ' in-memory cases; no real media/cache writes.');
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
