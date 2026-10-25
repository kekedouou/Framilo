'use strict';
// Real Player/Budget with deterministic byte/decoder/RAF models. No media or
// filesystem preparation; these checks do not claim host latency or GPU use.
const assert = require('assert'), index = require('../plugin/frame-index.cjs');
const { Player } = require('../plugin/player.js');
const flush = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(count = 600, proxy = true) {
  const frames = index.buildIndex(Array.from({ length: count }, (_, id) => ({ id, ptsTicks: String(id), file: `frame-${id}.${proxy ? 'avc' : 'jpg'}`, bytes: 256 })),
    { timeBase: [1, 60], lastFrameEndTicks: String(count) }).frames;
  const info = { streaming: 'segments-v1', source: { sha256: 'a'.repeat(64) }, width: 64, height: 36, frames, duration: count / 60, audio: null,
    ...(proxy ? { videoEncoding: { format: 'annexb-idr-v1', codec: 'avc1.42c033' } } : {}), segments: [] };
  for (let first = 0; first < count; first += 60) info.segments.push({ first, last: Math.min(count - 1, first + 59), start: first / 60, end: Math.min(count, first + 60) / 60 });
  return info;
}
function harness(options = {}) {
  let time = 0, serial = 0, active = 0, maxActive = 0;
  const callbacks = new Map(), reads = new Map(), decodeGates = new Map(), readGates = new Map(), events = [], draws = [], closed = [];
  const decode = async (bytes, frame) => {
    const ordinal = bytes.readUInt32LE(0); active++; maxActive = Math.max(maxActive, active);
    try { if (decodeGates.has(ordinal)) await decodeGates.get(ordinal).promise;
      return { width: 64, height: 36, ordinal, close() { closed.push(ordinal); } };
    } finally { active--; }
  };
  const player = new Player({ canvas: { getContext: () => ({ drawImage(bitmap) { draws.push(bitmap.ordinal); } }) }, frameIndex: index,
    ramBytes: options.ramBytes || 2 * 1024 ** 2, compressedRamBytes: options.compressedRamBytes,
    experimentMode: 'compressed-ram', forwardPredecode: options.forwardPredecode !== false,
    canPrefetchFrame: options.canPrefetchFrame, createFrameDecoder: () => ({ decode, close: async () => {}, snapshot: () => ({ state: 'configured', pending: active }) }),
    env: { now: () => time, raf(fn) { callbacks.set(++serial, fn); return serial; }, caf: id => callbacks.delete(id), decodeImage: decode, sleep: async () => {} },
    emit: value => events.push(value), readAsset: async (_, file) => {
      const ordinal = Number(/frame-(\d+)/.exec(file)[1]); reads.set(ordinal, (reads.get(ordinal) || 0) + 1);
      if (readGates.has(ordinal)) await readGates.get(ordinal).promise;
      const bytes = Buffer.alloc(24 + ordinal % 13); bytes.writeUInt32LE(ordinal); return bytes;
    } });
  const frame = async (ms = 16) => { time += ms; const work = [...callbacks.values()]; callbacks.clear(); work.forEach(fn => fn(time)); await flush(); };
  const frames = async count => { for (let n = 0; n < count; n++) await frame(); };
  const settle = async value => {
    let done = false, result, failure; value.then(v => { result = v; done = true; }, e => { failure = e; done = true; }); await flush();
    for (let n = 0; n < 400 && !done; n++) await frame(); assert(done, 'Player promise must settle'); if (failure) throw failure; return result;
  };
  return { player, reads, events, draws, closed, frame, frames, settle, maxActive: () => maxActive,
    decodeGate(ordinal) { const value = deferred(); decodeGates.set(ordinal, value); return value; },
    readGate(ordinal) { const value = deferred(); readGates.set(ordinal, value); return value; },
    load: info => settle(player.load(info)), async close() {
      const work = player.dispose(); for (const gate of [...decodeGates.values(), ...readGates.values()]) gate.resolve(); await work;
      assert.equal(player.snapshot().budget.used, 0); assert.equal(player.compressed.size, 0); assert.equal(player.tasks.size, 0);
    } };
}
async function main() {
  let count = 0;
  const test = async (name, action) => { await action(); count++; console.log('ok tiered Player: ' + name); };
  await test('proxy first frame enables a pool without warming the whole source or charging virtual bounds', async () => {
    const h = harness({ forwardPredecode: false }), info = fixture(); await h.load(info);
    assert(h.reads.size <= 3); assert(h.player.compressedCapacity > 0);
    const actual = [...h.player.compressed.values()].reduce((n, entry) => n + entry.bytes.byteLength, 0);
    assert.equal(h.player.snapshot().budget.kinds['compressed-jpeg'], actual); assert(actual < info.frames[0].bytes);
    assert(h.player.compressedCapacity <= h.player.budget.limit / 8); await h.close();
  });
  await test('RAM allowance changes the near window and extends beyond the former48-frame fill', async () => {
    const small = harness({ ramBytes: 2 * 1024 ** 2, canPrefetchFrame: () => true }), large = harness({ ramBytes: 8 * 1024 ** 2, canPrefetchFrame: () => true });
    await small.load(fixture(1200)); await large.load(fixture(1200)); await small.frames(180); await large.frames(180);
    assert(large.player.preparePlan.capacity > small.player.preparePlan.capacity); assert(small.player.preparePlan.capacity > 48);
    assert(small.player.cache.size > 48); assert(large.player.cache.size > 48);
    assert(small.player.budget.peak <= small.player.budget.limit && large.player.budget.peak <= large.player.budget.limit);
    await small.close(); await large.close();
  });
  await test('large virtual AVC byte bounds still charge only actual retained packets', async () => {
    const h = harness({ ramBytes: 128 * 1024 ** 2, canPrefetchFrame: () => true }), info = fixture(900);
    for (const frame of info.frames) frame.bytes = 8 * 1024 ** 2;
    await h.load(info); await h.frames(150);
    assert(h.player.compressedCapacity > 0); assert(h.player.compressedStats.warmedFrames > 0 || h.player.compressedStats.admittedFrames > 0);
    const actual = [...h.player.compressed.values()].reduce((n, entry) => n + entry.bytes.byteLength, 0);
    assert.equal(h.player.snapshot().compressed.residentBytes, actual); assert(actual < 1024 ** 2);
    assert(h.player.budget.peak <= h.player.budget.limit); await h.close();
  });
  await test('missing readiness callback only fills already observed complete segments', async () => {
    const h = harness(); await h.load(fixture()); await h.frames(240);
    assert(h.player.cache.size > 48); assert([...h.reads.keys()].every(n => n < 60), 'Do not ask the worker for an unobserved cold segment');
    assert.equal(h.player.snapshot().tieredCache.knownReadySegments, 1); await h.close();
  });
  await test('synchronous ready-set updates let nearby fill resume without generating other cold segments', async () => {
    const ready = new Set([0]), h = harness({ canPrefetchFrame: ordinal => ready.has(Math.floor(ordinal / 60)) });
    await h.load(fixture()); await h.frames(200); assert([...h.reads.keys()].every(n => n < 60));
    ready.add(1); await h.frames(220); assert(h.reads.has(100)); assert([...h.reads.keys()].every(n => n < 120));
    await h.close();
  });
  await test('visited frame islands can exceed48 and survive speculative fill until resource pressure', async () => {
    const h = harness({ forwardPredecode: false, canPrefetchFrame: () => true }); await h.load(fixture());
    for (let ordinal = 0; ordinal < 70; ordinal++) await h.settle(h.player.seek(ordinal / 60, { index: ordinal, final: true }));
    assert(h.player.cache.size >= 70); assert(h.player.cache.has(0)); h.player.setForwardPredecode(true); await h.frames(100);
    assert(h.player.cache.has(0), 'A visited old frame is not discarded merely for being outside the near window');
    assert(h.player.budget.peak <= h.player.budget.limit); await h.close();
  });
  await test('directional windows favour the latest motion and respect source time', async () => {
    const h = harness({ canPrefetchFrame: () => true }); await h.load(fixture(1200));
    await h.settle(h.player.seek(10, { index: 600, final: true })); await h.frames(2);
    const forward = h.player.preparePlan.order.slice(1, 20); assert(forward.filter(n => n > 600).length > forward.filter(n => n < 600).length);
    await h.settle(h.player.step(-1)); await h.frames(2);
    const backward = h.player.preparePlan.order.slice(1, 20); assert.equal(h.player.preparePlan.direction, -1);
    assert(backward.filter(n => n < 599).length > backward.filter(n => n > 599).length); await h.close();
  });
  await test('a far VFR frame does not displace genuinely nearby frames merely due to ordinal direction', async () => {
    const h = harness({ canPrefetchFrame: () => true }), info = fixture(9);
    const ticks = [0, 1, 2, 3, 50, 51, 52, 80, 90];
    info.frames = index.buildIndex(info.frames.map((frame, n) => ({ ...frame, ptsTicks: String(ticks[n]) })), { timeBase: [1, 10], lastFrameEndTicks: '100' }).frames;
    info.duration = 10; info.segments = [{ first: 0, last: 8, start: 0, end: 10 }];
    await h.load(info); await h.settle(h.player.seek(.3, { index: 3, final: true })); await h.frames(2);
    assert.deepEqual(h.player.preparePlan.order.slice(0, 4), [3, 2, 1, 0]); await h.close();
  });
  await test('compressed LRU uses actual bytes, evicts within its quota and serves decoded misses', async () => {
    const h = harness({ forwardPredecode: false, compressedRamBytes: 128 }); await h.load(fixture());
    for (const ordinal of [20, 40, 60, 80, 100]) await h.settle(h.player.seek(ordinal / 60, { index: ordinal, final: true }));
    assert(h.player.compressedBytes <= 128); assert(h.player.compressedStats.evictions > 0); assert(!h.player.compressed.has(0));
    const target = 80; assert(h.player.compressed.has(target)); const reads = h.reads.get(target), hits = h.player.compressedStats.hits;
    h.player._dropDecoded(h.player.cache.get(target)); await h.settle(h.player.seek(target / 60, { index: target, final: true }));
    assert.equal(h.reads.get(target), reads); assert(h.player.compressedStats.hits > hits); assert.equal(h.draws[h.draws.length - 1], target);
    const sum = [...h.player.compressed.values()].reduce((n, e) => n + e.bytes.byteLength, 0); assert.equal(sum, h.player.compressedBytes);
    assert.equal(h.player.snapshot().budget.kinds['compressed-jpeg'], sum); await h.close();
  });
  await test('tiny packets cannot create an unbounded number of metadata/budget tokens', async () => {
    const h = harness({ forwardPredecode: false }); await h.load(fixture(9000));
    for (let n = 1; n < 8500; n++) h.player._rememberCompressed(n, Buffer.alloc(8));
    assert.equal(h.player.compressed.size, 8192); assert(h.player.compressedBytes <= h.player.compressedCapacity);
    assert(!h.player.compressed.has(1)); assert(h.player.compressed.has(8499)); await h.close();
  });
  await test('cancelled warm admission and pending disposal retain reservations until the real read settles', async () => {
    const h = harness({ canPrefetchFrame: () => true }); await h.load(fixture()); const gate = h.readGate(500);
    const warm = h.player._readCompressed(h.player.info, h.player.epoch, 500); await flush(); h.player.setForwardPredecode(false);
    gate.resolve(); await warm; assert(!h.player.compressed.has(500));
    h.player.setForwardPredecode(true); const late = h.readGate(501), reading = h.player._readCompressed(h.player.info, h.player.epoch, 501); await flush();
    const closing = h.player.dispose(); assert(h.player.budget.used > 0); late.resolve(); await Promise.all([closing, reading]);
    assert.equal(h.player.budget.used, 0); assert.equal(h.player.compressed.size, 0); await h.close();
  });
  await test('material replacement waits old compressed reads and cannot admit them into the new source', async () => {
    const h = harness({ canPrefetchFrame: () => true }); await h.load(fixture()); const gate = h.readGate(500);
    const reading = h.player._readCompressed(h.player.info, h.player.epoch, 500); await flush();
    const next = fixture(); next.source.sha256 = 'b'.repeat(64); const replacing = h.player.load(next); await flush();
    assert.equal(h.player.state, 'loading'); gate.resolve(); await reading; await h.settle(replacing);
    assert.equal(h.player.info.source.sha256, 'b'.repeat(64)); assert(!h.player.compressed.has(500)); await h.close();
  });
  await test('toggling surrounding fill rebuilds its window without discarding the live compressed pool', async () => {
    const h = harness({ canPrefetchFrame: () => true }); await h.load(fixture()); await h.frames(20);
    const capacity = h.player.compressedCapacity, retained = [...h.player.compressed.keys()];
    h.player.setForwardPredecode(false); await h.frames(5); h.player.setForwardPredecode(true); await h.frames(20);
    assert(h.player.preparePlan && h.player.preparePlan.capacity > 0); assert.equal(h.player.compressedCapacity, capacity);
    assert(retained.some(n => h.player.compressed.has(n))); assert(!h.events.some(e => e.type === 'error')); await h.close();
  });
  await test('auxiliary allocations use the same ledger and can evict history while protecting the current frame', async () => {
    const h = harness({ forwardPredecode: false }); await h.load(fixture());
    for (let n = 1; n < 20; n++) await h.settle(h.player.seek(n / 60, { index: n, final: true }));
    const api = h.player.auxiliaryBudget(), current = h.player.currentIndex;
    assert.strictEqual(api.budget, h.player.budget); const token = api.budget.reserve(h.player.budget.limit - 2 * 64 * 36 * 4, 'auxiliary-preview', api.evict);
    assert(h.player.cache.has(current)); assert(h.player.budget.used <= h.player.budget.limit);
    api.budget.release(token); await h.close();
  });
  await test('a blocked background decode leaves the second slot for the latest exact target', async () => {
    const h = harness({ canPrefetchFrame: () => true }), gate = h.decodeGate(1); await h.load(fixture()); await h.frames(2);
    assert(h.player.tasks.size >= 1); const latest = await h.settle(h.player.seek(5, { index: 300, kind: 'release', final: true }));
    assert.equal(latest.status, 'drawn'); assert.equal(h.player.snapshot().frameOrdinal, 300); assert(h.maxActive() <= 2);
    gate.resolve(); await flush(); assert(!h.draws.includes(1)); assert.equal(h.player.info.source.sha256, 'a'.repeat(64)); await h.close();
  });
  await test('loop playback and its near window stay in the selected interval with two slots', async () => {
    const h = harness({ canPrefetchFrame: () => true }); await h.load(fixture());
    await h.settle(h.player.applyLoopRange({ startOrdinal: 100, endOrdinal: 119 })); await h.frames(100);
    assert.equal(h.player.snapshot().state, 'playing'); assert(h.player.currentIndex >= 100 && h.player.currentIndex <= 119);
    await h.settle(h.player.pause()); await h.frames(30);
    assert(h.player.preparePlan.order.every(n => n >= 100 && n <= 119)); assert(h.maxActive() <= 2);
    assert(!h.events.some(e => e.type === 'error')); await h.close();
  });
  console.log(`Tiered proxy Player: ${count} managed-cache/scheduler models; no media or host operation.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
