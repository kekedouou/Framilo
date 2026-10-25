'use strict';
// Shared read host for thread transport and the Eagle compatibility queue.
// It never creates writers, releases OS-owned leases or receives image pipes.
const { isMainThread, parentPort, workerData } = require('worker_threads');
const MAX_PENDING = 64, MAX_ACTIVE = 2, MAX_ASSET = 256 * 1024 ** 2;
function createReadHost({ cache, send }) {
  const leases = new Map(), queue = [], active = new Set(); let closing = false, barrier = false;
  const error = message => Object.assign(Error(message), { code: 'CACHE_READER_INVALID' });
  function bytes(value) {
    if (!Buffer.isBuffer(value) || value.byteLength > MAX_ASSET) throw error('读取线程返回无效资产。');
    // Cache allocations normally own their exact ArrayBuffer. Never transfer a
    // Node pooled slab (which would copy unrelated bytes or detach siblings).
    if (value.byteOffset === 0 && value.buffer.byteLength === value.byteLength) return value.buffer;
    const output = new ArrayBuffer(value.byteLength); new Uint8Array(output).set(value); return output;
  }
  function reply(id, result, failure) {
    const transfer = [];
    if (!failure && result instanceof ArrayBuffer) transfer.push(result);
    else if (!failure && Array.isArray(result)) for (const item of result) if (item instanceof ArrayBuffer) transfer.push(item);
    send({ id, ...(failure ? { error: { code: failure.code || 'CACHE_READ_FAILED', message: String(failure.message).slice(0, 2048) } } : { result }) }, transfer);
  }
  async function execute(message) {
    if (message.method === 'adopt') {
      const info = message.info;
      if (!info || leases.has(info.leaseId)) throw error('只读租约重复或无效。');
      cache.adoptReadLease(info, message.taskOwner); leases.set(info.leaseId, info); return true;
    }
    if (message.method === 'inventory') return cache.inventory();
    const info = leases.get(message.leaseId);
    if (!info) throw error('只读租约未登记。');
    if (message.method === 'read') return bytes(await cache.readAsset(info, message.file));
    if (message.method === 'batch') return (await cache.readFrameBatch(info, message.files)).map(bytes);
    if (message.method === 'detach') { const value = cache.detachReadLease(info); leases.delete(message.leaseId); return value; }
    throw error('未知只读操作。');
  }
  function pump() {
    if(barrier)return;
    while (queue.length && active.size < MAX_ACTIVE) {
      // Detach is a barrier: do not start it while any preceding reads remain,
      // and do not let later work overtake it. Adoption stays ordered as well.
      const next = queue[0];
      const exclusive=['adopt','detach','close','inventory'].includes(next.method);
      if (exclusive && active.size) return;
      queue.shift();
      if(exclusive)barrier=true;
      const work = Promise.resolve().then(async () => {
        if (next.method === 'close') {
          if (leases.size) throw error('读取线程仍有未交还租约。');
          closing = true; return true;
        }
        return execute(next);
      }).then(value => reply(next.id, value), failure => reply(next.id, null, failure));
      active.add(work); work.finally(() => { active.delete(work);if(exclusive)barrier=false;pump(); });
      if (exclusive) return;
    }
  }
  function receive(message) {
    if (!message || !Number.isSafeInteger(message.id) || message.id < 1 || !['adopt','read','batch','detach','inventory','close'].includes(message.method))
      throw error('只读线程消息无效。');
    if (closing || queue.length + active.size >= MAX_PENDING) { reply(message.id, null, error('只读线程已关闭或请求超额。')); return; }
    queue.push(message); pump();
  }
  return { receive, get pending() { return queue.length + active.size; } };
}
if (!isMainThread && require.main === module) {
  const cache = require('./cache.cjs').createCache({ pluginRoot: workerData.pluginRoot });
  const host = createReadHost({ cache, send: (value, transfer) => parentPort.postMessage(value, transfer) });
  parentPort.on('message', value => host.receive(value));
  parentPort.postMessage({ type: 'ready' });
}
module.exports = { createReadHost, MAX_PENDING, MAX_ACTIVE };
