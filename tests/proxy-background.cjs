'use strict';
const assert = require('assert');
const { createProxyBackground } = require('../plugin/proxy-background.cjs');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(settings = {}) {
  const timers = new Map(), calls = [], released = [], events = [], segments = []; let id = 0, idle = true;
  const bg = createProxyBackground({ info: { segments: [{}, {}, {}] },
    prepare: settings.prepare || (async ordinal => { calls.push(ordinal); return { ordinal, leaseId: 'lease-' + ordinal }; }),
    release: async value => { released.push(value); if (settings.release) await settings.release(value); },
    enqueue: settings.enqueue || (fn => Promise.resolve().then(fn)), idle: () => idle,
    inventory: () => settings.disk || ({ usedBytes: 0, diskLimitBytes: 5 * 1024 ** 3 }),
    emit: value => events.push(value), onSegment: (ordinal, value) => { segments.push([ordinal, value]); if (settings.onSegment) return settings.onSegment(ordinal, value); },
    schedule: fn => { timers.set(++id, fn); return id; }, cancel: value => timers.delete(value) });
  return { bg, calls, released, events, segments, timers, setIdle: value => { idle = value; },
    async tick() { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); await flush(); } };
}
async function main() {
  let count = 0;
  const test = async (name, action) => { await action(); count++; console.log('ok proxy background: ' + name); };
  await test('idle generation retains original leases, not frame bytes, and completion requires every segment', async () => {
    const h = harness(); h.setIdle(false); h.bg.kick(); await h.tick(); assert.equal(h.calls.length, 0);
    h.setIdle(true); for (let i = 0; i < 4; i++) await h.tick();
    assert.deepEqual(h.calls, [0, 1, 2]); assert.equal(h.released.length, 0); assert.equal(h.bg.snapshot().stage, 'complete');
    assert.equal(h.bg.snapshot().ready, 3); assert.equal(h.segments.length, 3);
    for (const [ordinal, value] of h.segments) assert.strictEqual(h.bg.get(ordinal), value);
    await h.bg.close(); assert.equal(h.released.length, 3); assert.equal(h.bg.get(0), undefined);
  });
  await test('disk guard stops before preparation and does not allocate a separate quota', async () => {
    const h = harness({ disk: { usedBytes: 500 * 1024 ** 2, diskLimitBytes: 512 * 1024 ** 2 } });
    h.bg.kick(); await h.tick(); assert.equal(h.bg.snapshot().stage, 'budget'); assert.equal(h.calls.length, 0); await h.bg.close();
  });
  await test('foreground cancels work and closing cancels the replacement timer', async () => {
    let cancelled = 0;
    const h = harness({ prepare: (_, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { cancelled++; reject(Object.assign(Error('cancelled'), { code: 'MEDIA_CANCELLED' })); }, { once: true })) });
    h.bg.kick(); await h.tick(); h.bg.foreground(); await flush(); assert.equal(cancelled, 1);
    assert.equal(h.bg.snapshot().stage, 'preparing'); await h.bg.close(); assert.equal(h.timers.size, 0);
  });
  await test('duplicate foreground result releases its new lease and returns the original retained handle', async () => {
    const h = harness(), first = { leaseId: 'first' }, duplicate = { leaseId: 'duplicate' };
    assert.strictEqual(await h.bg.retain(1, first), first); assert.strictEqual(await h.bg.retain(1, first), first);
    assert.strictEqual(await h.bg.retain(1, { leaseId: 'first' }), first); assert.equal(h.released.length, 0);
    assert.strictEqual(await h.bg.retain(1, duplicate), first); assert.deepEqual(h.released, [duplicate]); assert.equal(h.segments.length, 1);
    await h.bg.close(); assert.deepEqual(h.released, [duplicate, first]);
  });
  await test('simultaneous duplicate retention installs one owner before notifications settle', async () => {
    const gate = deferred(), h = harness({ onSegment: () => gate.promise }), a = { leaseId: 'a' }, b = { leaseId: 'b' };
    const one = h.bg.retain(0, a), two = h.bg.retain(0, b); await flush();
    assert.strictEqual(h.bg.get(0), a); assert.deepEqual(h.released, [b]); gate.resolve();
    assert.strictEqual(await one, a); assert.strictEqual(await two, a); await h.bg.close();
  });
  await test('mark hints cannot claim complete before original leases are retained', async () => {
    const h = harness(); [0, 1, 2].forEach(h.bg.mark); assert.equal(h.bg.snapshot().stage, 'preparing'); assert.equal(h.bg.snapshot().ready, 0);
    for (let i = 0; i < 3; i++) await h.bg.retain(i, { leaseId: 'hint-' + i }); assert.equal(h.bg.snapshot().stage, 'complete');
    await h.bg.close(); for (const ordinal of [-1, 3, 1.5, NaN]) await assert.rejects(h.bg.retain(ordinal, {}), /无效/);
  });
  await test('close waits for a late completed preparation and releases it instead of publishing', async () => {
    const gate = deferred(), h = harness({ prepare: () => gate.promise }), late = { leaseId: 'late' };
    h.bg.kick(); await h.tick(); let finished = false; const closing = h.bg.close().then(() => { finished = true; }); await flush(); assert(!finished);
    gate.resolve(late); await closing; assert.deepEqual(h.released, [late]); assert.equal(h.segments.length, 0); assert.equal(h.bg.get(0), undefined);
  });
  await test('all retained releases settle; failures are visible, retained for retry, and not hidden by another success', async () => {
    let fail = true; const h = harness({ release: async value => { if (value.leaseId === 'bad' && fail) throw Error('cannot release bad lease'); } });
    const good = { leaseId: 'good' }, bad = { leaseId: 'bad' }; await h.bg.retain(0, good); await h.bg.retain(1, bad);
    await assert.rejects(h.bg.close(), /cannot release bad lease/); assert.equal(h.bg.get(0), undefined); assert.strictEqual(h.bg.get(1), bad);
    assert(h.released.includes(good) && h.released.includes(bad)); fail = false; await h.bg.close(); assert.equal(h.bg.get(1), undefined);
    assert.equal(h.released.filter(value => value === good).length, 1);
  });
  await test('duplicate release failure cannot lose the extra lease on close', async () => {
    const h = harness({ release: async value => { if (value.leaseId === 'duplicate') throw Error('duplicate cleanup failed'); } });
    await h.bg.retain(0, { leaseId: 'original' }); await assert.rejects(h.bg.retain(0, { leaseId: 'duplicate' }), /duplicate cleanup failed/);
    await assert.rejects(h.bg.close(), /duplicate cleanup failed/); assert.equal(h.released.filter(value => value.leaseId === 'duplicate').length, 2);
  });
  await test('retention after close releases incoming ownership and reports cancellation', async () => {
    const h = harness(); await h.bg.close(); const late = { leaseId: 'after-close' };
    await assert.rejects(h.bg.retain(0, late), error => error.code === 'MEDIA_CANCELLED'); assert.deepEqual(h.released, [late]);
  });
  await test('unknown preparation cleanup failure is never erased by releasing known leases', async () => {
    const h = harness({ prepare: async () => { throw Object.assign(Error('unknown output cleanup'), { code: 'MEDIA_CLEANUP_FAILED' }); } });
    await h.bg.retain(0, { leaseId: 'known' }); h.bg.kick(); await h.tick(); assert.equal(h.bg.snapshot().stage, 'error');
    await assert.rejects(h.bg.close(), /unknown output cleanup/); assert.equal(h.released.length, 1);
    await assert.rejects(h.bg.close(), /unknown output cleanup/); assert.equal(h.released.length, 1);
  });
  console.log('Proxy background: ' + count + ' retention/priority/budget/closure models; no media, files or native host.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
