'use strict';
// Deterministic race checks, not a performance or Eagle acceptance test.
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm');
let instance;
class Worker {
  constructor() { instance = this; this.sent = []; this.terminated = false; }
  postMessage(m) {
    this.sent.push(m);
    if (m.type === 'open') queueMicrotask(() => this.emit({ type: 'opened' }));
    if (m.type === 'close') queueMicrotask(() => this.emit({ type: 'closed', result: { bytes: 0 } }));
  }
  emit(data) { return this.onmessage({ data }); }
  terminate() { this.terminated = true; }
}
async function main() {
  const scope = { Worker, performance, setTimeout, clearTimeout, E44Direct: { targetAt: (_, t) => ({ pts: t * 1000000 }) } };
  vm.runInNewContext(fs.readFileSync('prototypes/e44-direct-player/worker-client.js', 'utf8'), scope);
  const shown = [], disposed = [], reads = []; let blanks = 0;
  const reader = await scope.E44Worker.create({ index: {}, read: () => new Promise(resolve => reads.push(resolve)), draw: (_, pts) => shown.push(pts), blank: () => blanks++, hardware: 'prefer-hardware' });
  const a = reader.seek(1), b = reader.seek(2);
  assert.equal((await a).status, 'superseded');
  const picture = (id, pts) => instance.emit({ type: 'picture', id, pts, bitmap: { close: () => disposed.push(id) } });
  await picture(1, 1000000); assert.deepEqual(shown, []);
  await picture(2, 2000000); assert.equal((await b).status, 'exact'); assert.deepEqual(shown, [2000000]);
  const c = reader.seek(3); await picture(3, 2999999); assert.equal((await c).status, 'error'); assert.deepEqual(shown, [2000000]);
  const d = reader.seek(4); const inflight = instance.emit({ type: 'read', id: 11, a: 0, b: 1 });
  const closing = reader.close(); assert.equal((await d).status, 'closed'); assert.equal((await closing).workerExited, true);
  reads[0](new Uint8Array([1])); await inflight; await picture(4, 4000000);
  assert.equal(instance.sent.filter(x => x.type === 'bytes').length, 0);
  assert.deepEqual(disposed, [1, 2, 3, 4]); assert.equal(blanks, 4); assert.equal(reader.snapshot().pending, 0); assert.equal(instance.terminated, true);
  assert.equal((await reader.seek(5)).status, 'closed'); assert.equal(await reader.close(), await closing);
  console.log('E44 worker lifecycle: stale result, exact PTS, late read, close and bitmap release passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
