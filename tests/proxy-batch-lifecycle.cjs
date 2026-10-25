'use strict';
// Production cache + long-media + background orchestration, using only the
// existing in-memory filesystem. No media programs, native host or disk writes.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { harness: cacheHarness, SOURCE_SHA } = require('./t1-cache.cjs');
const { createLongMedia } = require('../plugin/long-media.cjs');
const { createProxyBackground } = require('../plugin/proxy-background.cjs');
const frameIndex = require('../plugin/frame-index.cjs'), mediaHelpers = require('../plugin/media.cjs')._test;
const taskOwner = { schema: 'eva-task-owner-v1', key: 'c'.repeat(64), epoch: 'd'.repeat(32), guardPid: 123 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function abortError() { return Object.assign(Error('model cancelled'), { code: 'MEDIA_CANCELLED', name: 'AbortError' }); }
function model(count = 3) {
  const h = cacheHarness({ taskOwner, packFrames: true }), calls = [], batches = [], controls = {};
  const snapshot = { id: 'MODEL', itemId: 'MODEL', filePath: 'D:\\fixtures\\source.mp4', name: 'model', ext: 'mp4' };
  const fingerprint = { sha256: SOURCE_SHA, stamp: { value: 1 } };
  const probe = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 16, height: 16 }] };
  let stamp = fingerprint.stamp;
  const check = job => { if (job.signal?.aborted) throw abortError(); if (job.failure) throw job.failure; };
  const cache = { ...h.cache,
    begin(settings) { calls.push(['begin', settings]); return h.cache.begin(settings); },
    inventory() { throw Error('public inventory must not run during a batch'); },
    openBatch(settings) {
      if (controls.failOpen) throw Object.assign(Error('model initializer cleanup failure'), { code: 'MEDIA_CLEANUP_FAILED' });
      calls.push(['open', settings]); const actual = h.cache.openBatch(settings), record = { actual, settings, segments: [] }; batches.push(record);
      return { snapshot: () => actual.snapshot(),
        beginSegment(value) {
          calls.push(['segment', value]); record.segments.push(value); const tx = actual.beginSegment(value);
          return { ...tx, async readComplete(options) {
            if (controls.block) { const block = controls.block; controls.block = null; block.entered.resolve(value); await block.release.promise; check({ signal: value.signal }); }
            if (controls.failRead) throw Error('model read failure');
            return tx.readComplete(options);
          }, abort() { if (controls.failAbort) throw Error('model unknown cleanup'); return tx.abort(); },
          async close() { calls.push(['tx-close']); return tx.close(); } };
        },
        async close() { calls.push(['batch-close']); if (controls.failClose) throw Error('model reconciliation failure'); return actual.close(); }
      };
    }
  };
  const helpers = { ...mediaHelpers, check, sameStamp: (a, b) => a.value === b.value, regular: () => stamp, sourceStamp: value => value,
    videoEnd: () => ({ timeBase: [1, 1], lastFrameEndTicks: String(count * 2) }),
    childProcess(job, tool, args) {
      assert(args.includes('-show_packets')); calls.push(['index']);
      return { child: { stdout: Readable.from([Buffer.from(Array.from({ length: count }, (_, i) => `pts=${i * 2}|flags=K_`).join('\n'))]), stderr: Readable.from([]) }, finish: Promise.resolve({ code: 0 }) };
    }, guarded: (_, value) => value, stopChildren: () => {}, settleJob: async () => {} };
  const long = createLongMedia({ cache, tools: { ffprobe: 'model-index-only' }, helpers });
  const prepare = (backend = 'proxy') => long.prepare(snapshot, fingerprint, probe, { playbackBackend: backend, previewQuality: '720p' });
  async function seed(info) {
    for (const group of info.segments) {
      const key = crypto.createHash('sha256').update(JSON.stringify([info.videoEncoding ? 'avc-idr-v1' : 'segments-v1',
        ...(info.videoEncoding ? [info.videoEncoding] : []), info.source.sha256, info.preview, group, helpers.COLOR_VERSION])).digest('hex');
      const tx = h.cache.begin({ sourceSha256: key, previewQuality: info.preview.quality });
      const asset = await tx.writeFrame('0.' + (info.videoEncoding ? 'avc' : 'jpg'), Buffer.from('verified-model-bytes'));
      const indexed = frameIndex.buildIndex([{ ...asset, id: group.first, ptsTicks: info.frames[group.first].ptsTicks, timeBase: [1, 1] }],
        { lastFrameEndTicks: String((group.first + 1) * 2), endTimeBase: [1, 1] });
      const source = { sha256: key, codec: 'h264', width: 16, height: 16, hasAudioStream: false }, framePack = await tx.finishFrames();
      const value = await tx.finish({ source, preview: info.preview, width: 16, height: 16, duration: 2,
        colorVersion: helpers.COLOR_VERSION, color: helpers.previewColor(probe.streams[0]), frames: indexed.frames, audio: null,
        ...(framePack ? { framePack } : {}), ...(info.videoEncoding ? { videoEncoding: info.videoEncoding } : {}), metrics: { sourceSha256: SOURCE_SHA } }, source);
      tx.close(); h.cache.release(value);
    }
  }
  return { ...h, cache, long, calls, batches, controls, prepare, seed, snapshot,
    changeSource: () => { stamp = { value: 2 }; }, block: () => controls.block = { entered: deferred(), release: deferred() } };
}
// Execute the real worker's line protocol and queue. Only Windows process I/O,
// indexing and createMedia's source/probe boundary are supplied by this model.
// Segment preparation, batch transactions, retained leases and background run
// through their actual production modules rather than substitute APIs.
function worker(h) {
  const input = new EventEmitter(), timers = new Map(), responses = new Map(), messages = [], exited = [];
  let timerId = 0, nextId = 1;
  const root = path.resolve(__dirname, '../plugin'), key = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex');
  const processModel = { env: { EVA_TASK_ROOT: root, EVA_TASK_KEY: key, EVA_TASK_EPOCH: taskOwner.epoch, EVA_TASK_GUARD_PID: '123' },
    versions: { node: process.versions.node }, pid: 4242, stdin: new EventEmitter(), stderr: { write(value) { messages.push({ stderr: value }); } },
    stdout: { write(value, callback) { if (value) { const message = JSON.parse(value); messages.push(message); if (message.type === 'response') responses.get(message.id)?.resolve(message); } if (callback) callback(); } },
    exit(code) { exited.push(code); } };
  processModel.stdin.destroy = () => {}; input.close = () => input.emit('close');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'task-worker.cjs'), 'utf8'), { __dirname: root, Buffer, console, AbortController,
    process: processModel, require(name) {
      if (name === 'fs') return { realpathSync: () => root };
      if (name === 'readline') return { createInterface: () => input };
      if (name === './process-identity.cjs') return { createIdentity: () => ({ self: () => ({ pid: 4242 }), inspect: () => ({ safe: false }) }) };
      if (name === './cache.cjs') return { createCache: () => h.cache };
      if (name === './media.cjs') return { createMedia: () => ({ prepare: (_, settings) => h.prepare(settings.playbackBackend),
        prepareSegment: (...args) => h.long.segment(...args), releaseLong: info => h.long.release(info),
        proxyBudget: (...args) => h.long.proxyBudget(...args), closeProxyBatch: info => h.long.closeProxyBatch(info) }) };
      if (name === './proxy-background.cjs') return { createProxyBackground: settings => createProxyBackground({ ...settings,
        schedule(fn) { timers.set(++timerId, fn); return timerId; }, cancel(id) { timers.delete(id); } }) };
      return require(name.startsWith('.') ? path.resolve(root, name) : name);
    } }, { filename: 'plugin/task-worker.cjs' });
  function start(method, value = {}) {
    const id = nextId++, gate = deferred(); responses.set(id, gate);
    input.emit('line', JSON.stringify({ id, method, ...value }));
    return { id, response: gate.promise.then(message => { responses.delete(id); return message; }) };
  }
  return { messages, exited, timers, start, async ask(method, value) {
    const message = await start(method, value).response; await tick();
    if (message.error) throw Object.assign(Error(message.error.message), { code: message.error.code }); return message.result;
  }, cancel(id) { input.emit('line', JSON.stringify({ method: 'cancel', id })); },
    async pump() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await tick(); await tick(); } };
}
async function main() {
  let count = 0;
  const test = async (name, action) => { await action(); count++; console.log('ok proxy batch lifecycle: ' + name); };
  await test('same-source segments reuse the real batch and preserve original read-lease objects', async () => {
    const h = model(), info = await h.prepare(); await h.seed(info); const values = [];
    for (let ordinal = 0; ordinal < 3; ordinal++) values.push(await h.long.segment(info, ordinal));
    assert.equal(h.batches.length, 1); assert.equal(h.calls.filter(v => v[0] === 'begin').length, 0);
    assert.equal(h.batches[0].settings.sourceSha256, SOURCE_SHA); assert.equal(h.batches[0].settings.previewQuality, '720p');
    assert.equal((await h.long.proxyBudget(info)).sequence, 3); assert.equal(h.batches[0].actual.snapshot().active, false);
    const bytes = await h.cache.readAsset(values[0], values[0].frames[0].file); assert.equal(bytes.toString(), 'verified-model-bytes');
    await h.long.closeProxyBatch(info); assert(!h.nodes.has(path.win32.join(h.root, 'writer.lock')));
    assert.equal((await h.cache.readAsset(values[2], values[2].frames[0].file)).toString(), bytes.toString());
    for (const value of values) h.cache.release(value); await h.long.release(info); assert.equal(h.descriptors.size, 0);
  });
  await test('JPEG segments keep the original one-transaction path', async () => {
    const h = model(), info = await h.prepare('jpeg'); await h.seed(info);
    for (let ordinal = 0; ordinal < 3; ordinal++) h.cache.release(await h.long.segment(info, ordinal));
    assert.equal(h.batches.length, 0); assert.equal(h.calls.filter(v => v[0] === 'begin').length, 3);
    await assert.rejects(h.long.proxyBudget(info)); await h.long.release(info);
  });
  await test('segment abort drains the transaction before the next target reuses its session', async () => {
    const h = model(), info = await h.prepare(); await h.seed(info);
    const controller = new AbortController(), block = h.block(), first = h.long.segment(info, 0, { signal: controller.signal });
    await block.entered.promise; controller.abort(); await tick(); assert.equal(h.batches[0].actual.snapshot().active, true);
    assert(!h.batches[0].settings.sessionSignal.aborted); block.release.resolve(); await assert.rejects(first, e => e.code === 'MEDIA_CANCELLED');
    assert.equal(h.batches[0].actual.snapshot().active, false);
    const next = await h.long.segment(info, 1); assert.equal(h.batches.length, 1);
    assert.notStrictEqual(h.batches[0].segments[0].signal, h.batches[0].settings.sessionSignal);
    h.cache.release(next); await h.long.release(info); assert.equal(h.descriptors.size, 0);
  });
  await test('source release aborts its signal and waits for active task/transaction closure', async () => {
    const h = model(), info = await h.prepare(); await h.seed(info); const block = h.block(), preparing = h.long.segment(info, 0);
    const rejected = assert.rejects(preparing, e => e.code === 'MEDIA_CANCELLED'); await block.entered.promise;
    let closed = false; const closing = h.long.release(info).then(() => { closed = true; }); await tick();
    assert(!closed); assert(h.batches[0].settings.sessionSignal.aborted); block.release.resolve(); await rejected; await closing;
    assert(!h.nodes.has(path.win32.join(h.root, 'writer.lock'))); await assert.rejects(h.long.segment(info, 1), e => e.code === 'MEDIA_CANCELLED');
  });
  await test('failed reconciliation retains the batch and source identity for an explicit retry', async () => {
    const h = model(), info = await h.prepare(); await h.seed(info); const value = await h.long.segment(info, 0); h.cache.release(value);
    h.controls.failClose = true; await assert.rejects(h.long.release(info), /reconciliation/); assert(h.nodes.has(path.win32.join(h.root, 'writer.lock')));
    h.controls.failClose = false; assert.equal(await h.long.release(info), true); assert.equal(h.batches.length, 1); assert.equal(h.descriptors.size, 0);
  });
  await test('forty independently published targets reuse one root writer without changing leases', async () => {
    const h = model(40), info = await h.prepare(); await h.seed(info); const retained = [];
    for (let ordinal = 0; ordinal < 40; ordinal++) retained.push(await h.long.segment(info, ordinal));
    assert.equal(h.batches.length, 1); assert.equal((await h.long.proxyBudget(info)).sequence, 40);
    for (const value of retained) h.cache.release(value); await h.long.closeProxyBatch(info); await h.long.release(info);
    assert.equal(h.descriptors.size, 0);
  });
  await test('source changes reject a target before any new transaction begins', async () => {
    const h = model(), info = await h.prepare(); await h.seed(info); h.changeSource();
    await assert.rejects(h.long.segment(info, 0), e => e.code === 'MEDIA_SOURCE_CHANGED'); assert.equal(h.batches.length, 0); await h.long.release(info);
  });
  await test('unknown cleanup failure survives known-writer close and cannot lose its source handle', async () => {
    const h = model(), info = await h.prepare(); await h.seed(info); h.controls.failRead = true; h.controls.failAbort = true;
    await assert.rejects(h.long.segment(info, 0), e => e.code === 'MEDIA_CLEANUP_FAILED');
    await assert.rejects(h.long.release(info), /unknown cleanup/); assert(h.batches[0].actual.snapshot().closed);
    await assert.rejects(h.long.release(info), /unknown cleanup/); await assert.rejects(h.long.closeProxyBatch(), /unknown cleanup/);
    assert.equal(h.descriptors.size, 0);
  });
  await test('batch initializer cleanup errors remain sticky without a returned batch handle', async () => {
    const h = model(), info = await h.prepare(); h.controls.failOpen = true;
    await assert.rejects(h.long.proxyBudget(info), e => e.code === 'MEDIA_CLEANUP_FAILED');
    h.controls.failOpen = false; await assert.rejects(h.long.closeProxyBatch(), /initializer cleanup/);
    await assert.rejects(h.long.release(info), /initializer cleanup/); assert.equal(h.batches.length, 0);
  });
  await test('worker foreground target and background share a batch; complete follows root close', async () => {
    const h = model(), seeded = await h.prepare(); await h.seed(seeded); const w = worker(h);
    const info = await w.ask('prepare', { snapshot: h.snapshot, playbackBackend: 'proxy' });
    const first = await w.ask('segment', { leaseId: info.leaseId, ordinal: 1 });
    for (let i = 0; i < 5; i++) await w.pump();
    assert.equal(h.batches.length, 1); assert.equal(h.batches[0].actual.snapshot().closed, true);
    const complete = w.messages.filter(v => v.type === 'proxy-progress' && v.value.stage === 'complete'); assert.equal(complete.length, 1);
    const repeated = await w.ask('segment', { leaseId: info.leaseId, ordinal: 1 }); assert.equal(first.leaseId, repeated.leaseId);
    assert.equal(h.batches.length, 1); await w.ask('close'); assert.deepEqual(w.exited, [0]); assert.equal(h.descriptors.size, 0);
    assert.equal(h.cache.root, h.root); assert.equal(h.nodes.has(path.win32.join(h.root, 'writer.lock')), false);
  });
  await test('worker cancellation drains the aborted target before queued foreground reuse', async () => {
    const h = model(), seed = await h.prepare(); await h.seed(seed); const w = worker(h), info = await w.ask('prepare', { playbackBackend: 'proxy' });
    const block = h.block(), first = w.start('segment', { leaseId: info.leaseId, ordinal: 0 }); await block.entered.promise;
    w.cancel(first.id); const next = w.start('segment', { leaseId: info.leaseId, ordinal: 1 }); await tick();
    assert.equal(h.batches[0].segments.length, 1); block.release.resolve();
    assert.equal((await first.response).error.code, 'MEDIA_CANCELLED'); assert((await next.response).result);
    assert.equal(h.batches.length, 1); await w.ask('close'); assert.equal(h.descriptors.size, 0);
  });
  await test('worker maintenance and new JPEG prepare close the active proxy writer in queue', async () => {
    const h = model(), seed = await h.prepare(); await h.seed(seed); const w = worker(h), info = await w.ask('prepare', { playbackBackend: 'proxy' });
    await w.ask('segment', { leaseId: info.leaseId, ordinal: 0 }); await w.ask('clearOther', { settings: { sourceSha256: SOURCE_SHA } });
    assert(h.batches[0].actual.snapshot().closed);
    await w.ask('segment', { leaseId: info.leaseId, ordinal: 1 }); assert.equal(h.batches.length, 2);
    const jpeg = await w.ask('prepare', { playbackBackend: 'jpeg' }); assert(h.batches[1].actual.snapshot().closed);
    assert(!jpeg.videoEncoding); await w.ask('close'); assert.equal(h.descriptors.size, 0);
  });
  await test('worker release failure leaves ownership available for retry', async () => {
    const h = model(), seed = await h.prepare(); await h.seed(seed); const w = worker(h), info = await w.ask('prepare', { playbackBackend: 'proxy' });
    await w.ask('segment', { leaseId: info.leaseId, ordinal: 0 }); h.controls.failClose = true;
    await assert.rejects(w.ask('release', { leaseId: info.leaseId }), /reconciliation/);
    assert(h.nodes.has(path.win32.join(h.root, 'writer.lock'))); h.controls.failClose = false;
    assert.equal(await w.ask('release', { leaseId: info.leaseId }), true); await w.ask('close'); assert.equal(h.descriptors.size, 0);
  });
  console.log(`Proxy batch lifecycle: ${count} real-module memory models; no media/native host or physical file mutation.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
