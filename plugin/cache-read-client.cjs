'use strict';
const path = require('path'), { Worker } = require('worker_threads');
function createReadClient({ pluginRoot, onFailure = () => {}, createWorker = settings => new Worker(path.join(pluginRoot, 'cache-read-worker.cjs'), settings) }) {
  let thread = null, starting = null, serial = 0, failure = null, closing = null, stopped = false, expectedStop = false;
  const pending = new Map(), adopted = new WeakMap();
  function failed(error) { if (failure) return; failure = error; for (const entry of pending.values()) entry.reject(error); pending.clear(); onFailure(error); }
  function start() {
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      try {
        thread = createWorker({ workerData: { pluginRoot } });
        thread.on('message', value => {
          if (value.type === 'ready') { resolve(); return; }
          const entry = pending.get(value.id); if (!entry) { failed(Error('读取线程响应编号无效。')); return; }
          pending.delete(value.id);
          if (value.error) entry.reject(Object.assign(Error(value.error.message), { code: value.error.code })); else entry.resolve(value.result);
        });
        thread.once('error', error => { reject(error); failed(error); });
        thread.once('exit', () => { stopped = true; if (!expectedStop || pending.size) { const error = Error('只读线程异常退出。'); reject(error); failed(error); } });
      } catch (error) { reject(error); failed(error); }
    }); starting.catch(() => {}); return starting;
  }
  async function ask(method, fields = {}) {
    await start(); if (failure) throw failure;
    if (stopped || pending.size >= 64) throw Object.assign(Error('读取线程已关闭或请求超额。'), { code: 'CACHE_READER_BUSY' });
    return new Promise((resolve, reject) => {
      const id = ++serial; pending.set(id, { resolve, reject });
      try { thread.postMessage({ id, method, ...fields }); } catch (error) { pending.delete(id); reject(error); }
    });
  }
  function entry(info) { const value = info && adopted.get(info); if (!value || value.detaching) throw Error('缓存读取句柄已失效。'); return value; }
  function adopt(info, taskOwner) {
    if (!info || adopted.has(info)) return Promise.reject(Error('只读租约重复或无效。'));
    const value = { promise: null, detaching: false, reads: new Set(),leaseId:info.leaseId }; adopted.set(info, value);
    value.promise = ask('adopt', { info, taskOwner }).catch(error => { adopted.delete(info); throw error; }); return value.promise;
  }
  function reading(info, method, fields, convert) {
    let value; try { value = entry(info); } catch (error) { return Promise.reject(error); }
    const work = value.promise.then(() => ask(method, { leaseId: value.leaseId, ...fields })).then(convert);
    value.reads.add(work); work.then(() => value.reads.delete(work), () => value.reads.delete(work)); return work;
  }
  function readAsset(info, file) { return reading(info, 'read', { file }, value => Buffer.from(value)); }
  function readFrameBatch(info, files) { return reading(info, 'batch', { files }, values => values.map(value => Buffer.from(value))); }
  async function detach(info) {
    const value = adopted.get(info); if (!value) return false;
    if (value.detaching) return value.detaching;
    value.detaching = value.promise.then(async () => { await Promise.allSettled([...value.reads]); return ask('detach', { leaseId: value.leaseId }); }).then(result => { adopted.delete(info); return result; });
    try { return await value.detaching; } catch (error) { value.detaching = false; throw error; }
  }
  function close() {
    if (closing) return closing;
    closing = (async () => { if (!thread && !starting) return; await ask('close'); expectedStop = true; await thread.terminate(); if (failure) throw failure; })();
    const work=closing;work.catch(() => {if(closing===work)closing=null;});return work;
  }
  return { adopt, readAsset, readFrameBatch, detach, inventory: () => ask('inventory'), close };
}
module.exports = { createReadClient };
