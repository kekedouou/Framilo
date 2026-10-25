'use strict';
// In-memory cache persistence/recovery only; no generated media or Eagle writes.
const assert = require('assert'), path = require('path').win32;
const { harness, prepared, SOURCE_SHA } = require('./t1-cache.cjs');
const { packed } = require('./cache-pack.cjs');
const layout = require('../plugin/frame-pack.cjs');
const encoding = Object.freeze({ format: 'annexb-idr-v1', codec: 'avc1.42001f' });
const original = { sha256: SOURCE_SHA, codec: 'h264', width: 1920, height: 1080, hasAudioStream: false };
async function proxy(h, sha = SOURCE_SHA, values = [Buffer.from([0, 0, 0, 1, 0x65, 1]), Buffer.from([0, 0, 0, 1, 0x65, 2])]) {
  const source = { ...original, sha256: sha }, tx = h.cache.begin({ sourceSha256: sha }), frames = [];
  for (let n = 0; n < values.length; n++) {
    const asset = await tx.writeFrame(String(n).padStart(6, '0') + '.avc', values[n]);
    frames.push({ ...asset, id: n, ptsTicks: String(n), timeBase: [1, 30], time: n / 30, end: n === values.length - 1 ? 1 : (n + 1) / 30 });
  }
  const framePack = await tx.finishFrames();
  const info = await tx.finish({ source, width: 1280, height: 720, duration: 1, frames, audio: null,
    ...(framePack ? { framePack } : {}), videoEncoding: encoding }, source);
  tx.close(); return info;
}
async function main() {
  let count = 0;
  const test = async (name, action) => { await action(); count++; console.log('ok proxy cache: ' + name); };
  await test('publish, read one frame/batch, release and reopen retain codec, PTS and exact bytes', async () => {
    const h = harness({ packFrames: true }), info = await proxy(h);
    assert.deepEqual(info.videoEncoding, encoding); assert.equal(info.framePack.bytes, 12);
    assert.equal((await h.cache.readAsset(info, info.frames[0].file)).toString('hex'), '000000016501');
    assert.deepEqual((await h.cache.readFrameBatch(info, info.frames.map(f => f.file))).map(b => b.toString('hex')), ['000000016501', '000000016502']);
    assert.equal(h.cache.inventory().caches[0].assetCount, 1); h.cache.release(info);
    const reopened = h.reboot({ packFrames: true }), tx = reopened.begin({ sourceSha256: SOURCE_SHA }), candidate = await tx.readComplete();
    assert.deepEqual(candidate.videoEncoding, encoding); const next = await tx.finish(candidate, original); tx.close();
    assert.equal((await reopened.readAsset(next, next.frames[1].file)).toString('hex'), '000000016502'); reopened.release(next);
    assert.equal(h.descriptors.size, 0);
  });
  await test('unpacked AVC is declared and readable without pretending to be JPEG', async () => {
    const h = harness(), info = await proxy(h); assert(!info.framePack);
    assert(h.nodes.has(path.join(info.cacheDir, '000000.avc')));
    assert.equal((await h.cache.readAsset(info, '000000.avc')).length, 6); h.cache.release(info);
  });
  await test('strict codec metadata and logical AVC filenames reject ambiguous manifests', async () => {
    const h = harness({ packFrames: true }), info = await proxy(h);
    for (const mutate of [
      v => { delete v.videoEncoding; }, v => { v.videoEncoding = null; },
      v => { v.videoEncoding.codec = 'h264'; }, v => { v.videoEncoding.codec = 'avc1.42001'; },
      v => { v.videoEncoding.format = 'annexb-v2'; }, v => { v.videoEncoding.extra = true; },
      v => { v.frames[0].file = '000000.jpg'; }, v => { v.frames[0].file = 'payload.avc'; },
      v => { v.frames[0].file = '../0.avc'; }, v => { v.frames[0].file = '1'.repeat(13) + '.avc'; }
    ]) { const bad = JSON.parse(JSON.stringify(info)); mutate(bad); assert.throws(() => layout.validate(bad, 5 * 1024 ** 3)); }
    const uppercase = JSON.parse(JSON.stringify(info)); uppercase.videoEncoding.codec = 'avc1.42E01F'; layout.validate(uppercase, 5 * 1024 ** 3);
    h.cache.release(info);
  });
  await test('undeclared AVC refuses actual commit; failed candidate cleans its own outputs', async () => {
    const h = harness({ packFrames: true }), tx = h.cache.begin({ sourceSha256: SOURCE_SHA });
    const asset = await tx.writeFrame('0.avc', Buffer.from('payload')), framePack = await tx.finishFrames();
    const frame = { ...asset, id: 0, ptsTicks: '0', timeBase: [1, 30], time: 0, end: 1 };
    await assert.rejects(tx.finish({ source: original, width: 1280, height: 720, duration: 1, frames: [frame], audio: null, framePack }, original), /编码/);
    assert(tx.abort()); tx.close(); assert(![...h.nodes.keys()].some(f => /partial-/.test(f)));
  });
  await test('JPEG cache remains compatible in the same cache implementation', async () => {
    const h = harness(), info = await prepared(h); h.cache.release(info);
    const next = h.reboot({ packFrames: true }), tx = next.begin({ sourceSha256: SOURCE_SHA }), old = await tx.readComplete();
    assert.strictEqual(old.videoEncoding, undefined); const ready = await tx.finish(old, { ...old.source }); tx.close();
    assert.equal((await next.readAsset(ready, ready.frames[0].file)).toString(), 'frame-data'); next.release(ready);
  });
  await test('JPEG and AVC obey one physical quota with oldest unleased cache eviction', async () => {
    const h = harness({ packFrames: true, diskBytes: 160 * 1024 }), data = Buffer.alloc(48 * 1024, 3);
    const jpeg = await packed(h, [data], SOURCE_SHA); h.cache.release(jpeg);
    const avc = await proxy(h, 'b'.repeat(64), [data]); h.cache.release(avc);
    const live = await packed(h, [data], 'c'.repeat(64));
    assert(!h.nodes.has(jpeg.cacheDir)); assert(h.nodes.has(avc.cacheDir)); assert(h.nodes.has(live.cacheDir));
    assert(h.cache.inventory().usedBytes <= 160 * 1024); h.cache.release(live);
  });
  await test('clear other materials retains verified current-source derived JPEG and AVC segments', async () => {
    const h = harness({ packFrames: true }), retained = [];
    for (const [key, backend, realSha] of [['b', 'proxy', SOURCE_SHA], ['c', 'jpeg', SOURCE_SHA], ['d', 'proxy', 'e'.repeat(64)]]) {
      const source = { ...original, sha256: key.repeat(64) }, tx = h.cache.begin({ sourceSha256: source.sha256 });
      const asset = await tx.writeFrame('000000.' + (backend === 'proxy' ? 'avc' : 'jpg'), Buffer.from('content'));
      const frame = { ...asset, id: 0, ptsTicks: '0', timeBase: [1, 30], time: 0, end: 1 }, framePack = await tx.finishFrames();
      const info = await tx.finish({ source, width: 1280, height: 720, duration: 1, frames: [frame], audio: null, framePack,
        ...(backend === 'proxy' ? { videoEncoding: encoding } : {}), metrics: { sourceSha256: realSha } }, source);
      tx.close(); h.cache.release(info); retained.push(info);
    }
    const result = h.cache.clearOther({ sourceSha256: SOURCE_SHA });
    assert.equal(result.cleared, 1); assert(h.nodes.has(retained[0].cacheDir)); assert(h.nodes.has(retained[1].cacheDir));
    assert(!h.nodes.has(retained[2].cacheDir));
  });
  await test('cancelled AVC pack drains streams before deleting only its own partial', async () => {
    const h = harness({ packFrames: true }), controller = new AbortController();
    const tx = h.cache.begin({ sourceSha256: SOURCE_SHA, signal: controller.signal }); await tx.writeFrame('0.avc', Buffer.from('partial'));
    controller.abort(); assert.throws(() => tx.close(), /仍未关闭/); await tx.finishFrames(); assert(tx.abort()); tx.close();
    assert.equal(h.descriptors.size, 0); assert(![...h.nodes.keys()].some(f => /partial-/.test(f)));
  });
  await test('owned task restart recovers numeric AVC partials but preserves unknown files', async () => {
    const owner = epoch => ({ schema: 'eva-task-owner-v1', key: 'c'.repeat(64), epoch: epoch.repeat(32), guardPid: 123 });
    const identity = { self: () => ({ pid: 4242, startTicks: '639000000000000001', image: 'D:\\worker.exe' }),
      child: () => null, inspect: () => ({ safe: true, reason: 'model-confirmed-previous-task-empty' }) };
    for (const unknown of [false, true]) {
      const h = harness({ taskOwner: owner('a'), processIdentity: identity }), tx = h.cache.begin({ sourceSha256: SOURCE_SHA });
      await tx.writeFrame('0.avc', Buffer.from('partial')); const partial = [...h.nodes.keys()].find(f => path.basename(f).startsWith('partial-'));
      if (unknown) h.make(path.join(partial, 'foreign.avc'), 'file', Buffer.from('unknown-preserve'));
      h.descriptors.clear(); const next = h.reboot({ taskOwner: owner('b'), processIdentity: identity });
      if (unknown) { assert.throws(() => next.begin({ sourceSha256: SOURCE_SHA }), /未知文件/); assert(h.nodes.has(partial)); }
      else { const replacement = next.begin({ sourceSha256: SOURCE_SHA }); assert(!h.nodes.has(partial)); replacement.close(); }
    }
  });
  console.log('Proxy cache: ' + count + ' in-memory persistence/recovery cases; no real media or Eagle.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
