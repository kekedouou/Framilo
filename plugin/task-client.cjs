'use strict';
// Control messages only. The existing Player reads JPEG/PCM bytes locally.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const { createCache } = require('./cache.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function issue(code, message) { return Object.assign(new Error(message), { code }); }
function verifyGuard(root) {
  const native = path.join(root, 'native'), executable = path.join(native, 'task-host.local.exe');
  const build = JSON.parse(fs.readFileSync(path.join(native, 'task-host.local.json')));
  for (const file of [native, executable, path.join(native, 'task-host.cs')]) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || fs.realpathSync(file).toLowerCase() !== file.toLowerCase()) throw new Error('任务负责人路径无效。');
  }
  const binary = fs.readFileSync(executable);
  if (build.schema !== 'eva-task-guard-build-v1' || binary.length !== build.bytes || binary.length > 256 * 1024 ||
      sha(binary) !== build.executableSha256 || sha(fs.readFileSync(path.join(native, 'task-host.cs'))) !== build.sourceSha256)
    throw new Error('任务负责人构建需要更新；请由开发者修复。');
  return executable;
}
function createTaskClient(options) {
  const root = fs.realpathSync(options.pluginRoot), local = createCache({ pluginRoot: root });
  const key = sha(Buffer.from(root.toLowerCase())), runtime = options.runtime || process.execPath;
  const backgroundProgress=new Map(),retainedSegments=new Map(),closingSources=new Set(),retainedValues=new WeakSet();
  function retainLocal(parent,ordinal,value){
    if(!/^[0-9a-f]{24}$/.test(parent)||!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>=120000||!value?.videoEncoding)throw Error('代理段登记无效。');
    let group=retainedSegments.get(parent);if(!group){group=new Map();retainedSegments.set(parent,group);}
    const prior=group.get(ordinal);if(prior){if(prior.leaseId!==value.leaseId)throw Error('代理段租约冲突。');return prior;}
    local.adoptReadLease(value,taskOwner);retainedValues.add(value);group.set(ordinal,value);return value;
  }
  function detachRetained(parent){const group=retainedSegments.get(parent);if(group)for(const value of group.values())local.detachReadLease(value);retainedSegments.delete(parent);}
  let host = null, ready = null, serial = 0, closing = null, ended = false, failure = null, guardFinished = false;
  let readyResolve, readyReject, exitResolve;
  let taskOwner = null;
  let guardCancelled = false;
  const exited = new Promise(resolve => { exitResolve = resolve; });
  const pending = new Map(), leases = new Set();
  const readers = new Map();
  function failed(error) {
    if (failure) return; failure = error;
    if (readyReject) readyReject(error);
    for (const value of pending.values()) value.reject(error); pending.clear();
    if (!closing && options.onFailure) options.onFailure(error);
  }
  function write(value) { if (!host || ended || !host.stdin.writable) throw issue('TASK_DISCONNECTED', '视频任务连接已结束。'); host.stdin.write(JSON.stringify(value) + '\n'); }
  function start() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; }); ready.catch(() => {});
    try {
      // Detached avoids Node's parent-lifetime Windows job killing the guard
      // before it can handle EOF. Our own guarded job controls its descendants.
      host = spawn(verifyGuard(root), [root, runtime, key], { detached: true, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '', stderr = '';
      host.stdout.setEncoding('utf8');
      host.stdout.on('data', chunk => {
        try {
          buffer += chunk; if (Buffer.byteLength(buffer) > 8 * 1024 ** 2) throw new Error('任务通信超过容量。');
          let at; while ((at = buffer.indexOf('\n')) >= 0) {
            const value = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1);
            if (value.type === 'ready') {
              if (taskOwner || !value.taskOwner || value.taskOwner.key !== key || value.taskOwner.guardPid !== host.pid ||
                  !/^[0-9a-f]{32}$/.test(value.taskOwner.epoch || '')) throw new Error('任务负责人身份不符。');
              taskOwner = value.taskOwner; readyResolve(value);
            }
            else if (value.type === 'guard' && value.event === 'waiting') { if (options.onWaiting) options.onWaiting(); }
            else if (value.type === 'guard' && value.event === 'cancelled') {
              if (taskOwner || pending.size) throw new Error('任务取消发生在错误阶段。');
              guardCancelled = true; guardFinished = true; readyReject(issue('MEDIA_CANCELLED', '视频准备已取消。'));
            }
            else if (value.type === 'guard' && value.event === 'finished') guardFinished = value.exitCode === 0;
            else if (value.type === 'progress') { const request = pending.get(value.id); if (request && request.onProgress) request.onProgress(value.value); }
            else if (value.type === 'proxy-segment') {if(!closingSources.has(value.parentLeaseId))retainLocal(value.parentLeaseId,value.ordinal,value.value);}
            else if (value.type === 'proxy-progress') {if(closingSources.has(value.leaseId))continue;backgroundProgress.set(value.leaseId,value.value);if(options.onBackground)options.onBackground(value.value);}
            else if (value.type === 'response') {
              const request = pending.get(value.id); if (!request) throw new Error('任务响应编号无效。'); pending.delete(value.id);
              if (value.error) request.reject(issue(value.error.code, value.error.message)); else request.resolve(value.result);
            }
          }
        } catch (error) { failed(error); host.stdin.end(); }
      });
      host.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
      host.stdin.on('error', error => failed(error)); host.once('error', error => { failed(error); ended = true; exitResolve(); });
      host.once('close', code => { ended = true;
        if (!guardFinished || code !== 0 || pending.size) failed(issue('TASK_OWNER_EXITED', '视频任务负责人异常退出：' + (stderr || String(code))));
        exitResolve(); });
    } catch (error) { failed(error); ended = true; exitResolve(); }
    return ready;
  }
  async function ask(method, fields = {}, settings = {}) {
    await start(); if (failure) throw failure;
    const id = ++serial;
    const work = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress: settings.onProgress });
      try { write({ id, method, ...fields }); } catch (error) { pending.delete(id); reject(error); }
    });
    const cancel = () => { try { write({ id, method: 'cancel' }); } catch (_) {} };
    if (settings.signal) { settings.signal.addEventListener('abort', cancel, { once: true }); if (settings.signal.aborted) cancel(); }
    try { return await work; } finally { if (settings.signal) settings.signal.removeEventListener('abort', cancel); }
  }
  const cache = {
    readAsset: (info, file) => failure ? Promise.reject(failure) : readers.has(info) ? readers.get(info).frame(file) : local.readAsset(info, file),
    readAudioSegment: (info, ordinal) => readers.get(info).audio(ordinal),
    target: (info, time) => { if (readers.has(info)) readers.get(info).cancelExcept(time); },
    prefetch: (info, time, loop) => { if (readers.has(info)) readers.get(info).prefetch(time, loop); },
    cancelReads: info => { if (readers.has(info)) readers.get(info).cancelAll(); },
    readFrameBatch: (...args) => failure ? Promise.reject(failure) : local.readFrameBatch(...args),
    async release(info) { if (!leases.has(info)) return false; closingSources.add(info.leaseId);
      if (readers.has(info)) { await readers.get(info).close(); readers.delete(info); }
      else local.detachReadLease(info);
      detachRetained(info.leaseId);
      await ask('release', { leaseId: info.leaseId }); leases.delete(info); backgroundProgress.delete(info.leaseId); closingSources.delete(info.leaseId); return true; },
    clearOther: settings => ask('clearOther', { settings }),
    backgroundStatus: info=>backgroundProgress.get(info.leaseId)||null,
    inventory: local.inventory
  };
  const media = { async prepare(snapshot, settings = {}) {
    const tools = await options.discoverTools(settings.signal);
    const info = require('./media-wire.cjs').unpackInfo(await ask('prepare', { snapshot, tools, previewQuality: settings.previewQuality, playbackBackend: settings.playbackBackend }, settings));
    if (settings.signal && settings.signal.aborted) { closingSources.add(info.leaseId);detachRetained(info.leaseId);await ask('release', { leaseId: info.leaseId });backgroundProgress.delete(info.leaseId);closingSources.delete(info.leaseId);throw issue('MEDIA_CANCELLED', '视频准备已取消。'); }
    if (info.streaming) {
      const reader = require('./segment-reader.cjs').createSegmentReader({ info,
        acquire: async (ordinal, signal) => {
          const retained=retainedSegments.get(info.leaseId)?.get(ordinal);if(retained)return retained;
          const value = await ask('segment', { leaseId: info.leaseId, ordinal }, { signal });
          try { if(info.videoEncoding){const retained=retainLocal(info.leaseId,ordinal,value);if(signal.aborted)throw issue('MEDIA_CANCELLED','分段准备已取消。');return retained;} if (signal.aborted) throw issue('MEDIA_CANCELLED', '分段准备已取消。'); local.adoptReadLease(value, taskOwner); }
          catch (error) { if(!info.videoEncoding)await ask('release', { leaseId: value.leaseId }); throw error; }
          return value;
        }, release: async value => { if(retainedValues.has(value))return; local.detachReadLease(value); await ask('release', { leaseId: value.leaseId }); },
        readAsset: (value, file) => local.readAsset(value, file) });
      readers.set(info, reader);
    } else try { local.adoptReadLease(info, taskOwner); } catch (error) { await ask('release', { leaseId: info.leaseId }); throw error; }
    leases.add(info); return info;
  } };
  function close() {
    if (closing) return closing;
    closing = (async () => {
      if (!host && !ready) return { status: 'closed' };
      beginClose();for(const info of leases)closingSources.add(info.leaseId);
      for (const reader of readers.values()) await reader.close(); readers.clear();
      for (const info of leases) if (!info.streaming) local.detachReadLease(info);
      for(const parent of retainedSegments.keys())detachRetained(parent);
      leases.clear(); backgroundProgress.clear();
      try { if (!failure && !ended) await ask('close'); }
      catch (error) { if (!guardCancelled) throw error; }
      finally { if (host && !ended) host.stdin.end(); await exited; }
      if (failure) throw failure; return { status: 'closed' };
    })(); closing.catch(() => {}); return closing;
  }
  function beginClose() { if (host && !ended && host.stdin.writable) write({ type: 'guard', event: 'closing' }); }
  const exports = {
    async create(info, request, settings = {}) {
      if (!leases.has(info)) throw issue('EXPORT_SESSION', '导出会话已失效。');
      const tools = await options.discoverTools(settings.signal);
      return ask('export', { leaseId: info.leaseId, request, tools }, settings);
    },
    publish: (token, destination, settings) => ask('publishExport', { token, destination }, settings),
    discard: token => ask('discardExport', { token })
  };
  return Object.freeze({ media, cache, exports, beginClose, close, ping: () => ask('ping'), get stopped() { return ended; } });
}
module.exports = { createTaskClient, verifyGuard };
