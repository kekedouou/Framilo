'use strict';
// Pure candidate-model test; no media generation and no product/library writes.
const assert = require('assert');
const { createWindowCache } = require('../prototypes/long-video/window-cache.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
  const calls = [], disposed = [], background = [];
  const cache = createWindowCache({ maxBytes: 30, entryLimit: 10, onBackgroundError: e => background.push(e.message),
    load: (key, { signal, maxBytes }) => new Promise((resolve, reject) => calls.push({ key, signal, maxBytes, resolve, reject })) });
  const finish = async (key, bytes = 10) => { const call = calls.find(c => c.key === key && !c.finished); assert(call, key); call.finished = true;
    call.resolve({ bytes, value: key, dispose: () => disposed.push(key) }); await tick();
    const s = cache.snapshot(); assert(s.used + s.reserved <= s.maxBytes); };
  const first = cache.seek('0', ['1', '2']); await finish('0'); assert.equal(await first, '0'); assert.equal(cache.snapshot().running, '1');
  const far = cache.seek('90', ['91', '89']); assert(calls[1].signal.aborted);
  assert.equal(calls.length, 2, 'Never spawn over still-settling old process');
  await finish('1'); assert(disposed.includes('1')); assert.equal(cache.snapshot().running, '90');
  await finish('90'); assert.equal(await far, '90'); await finish('91'); await finish('89');
  assert(!cache.snapshot().cached.includes('0')); assert.equal(cache.snapshot().visible, '90');
  const same = cache.seek('90'); assert.equal(await same, '90');
  const a = cache.seek('100'); const rejected = a.catch(e => e.name);
  const b = cache.seek('101'); await finish('100'); assert.equal(await rejected, 'AbortError');
  assert(!cache.snapshot().cached.includes('100')); await finish('101'); assert.equal(await b, '101');
  const overflow = cache.seek('102').catch(e => e.message); await finish('102', 11); assert.match(await overflow, /reservation/); assert(disposed.includes('102'));
  assert.equal(cache.snapshot().visible, '101', 'Failure preserves displayed chunk');
  const repeat = cache.seek('101', ['bad']); await repeat; calls.find(c => c.key === 'bad').reject(Error('background failed')); await tick();
  assert.deepEqual(background, ['background failed']); assert.equal(cache.snapshot().running, null, 'No endless retry');
  const closing = cache.seek('200').catch(e => e.name); const closed = cache.close(); assert(calls.find(c => c.key === '200').signal.aborted);
  await finish('200'); await closed; assert.equal(await closing, 'AbortError'); assert.equal(cache.snapshot().used, 0);
  await cache.close(); await assert.rejects(cache.seek('201'), /closed/);
  assert.equal(new Set(disposed).size, disposed.length, 'Each resource disposed once');
  console.log('long-video window: latest target, serial cancellation, reservation, eviction, failures and close passed');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
