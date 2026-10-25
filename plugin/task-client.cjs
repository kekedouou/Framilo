'use strict';
// Guard pipe carries control metadata only. Cache I/O uses a read thread or the bounded Eagle compatibility queue.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn } = require('child_process');
const { createReadClient } = require('./cache-read-client.cjs');
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
  const root = fs.realpathSync(options.pluginRoot), local = createReadClient({ pluginRoot: root, onFailure: error => failed(error) });
  const key = sha(Buffer.from(root.toLowerCase())), runtime = options.runtime || process.execPath;
  const backgroundProgress=new Map(),retainedSegments=new Map(),closingSources=new Set(),retainedValues=new WeakSet();
  const recordReads = new Set(), recordEntries = new Map(), pendingRecordReturns=new Set(),priorityBits=new WeakMap();
  function retainLocal(parent,ordinal,value){
    if(!/^[0-9a-f]{24}$/.test(parent)||!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>=120000||!value?.videoEncoding)throw Error('代理段登记无效。');
    let group=retainedSegments.get(parent);if(!group){group=new Map();retainedSegments.set(parent,group);}
    const prior=group.get(ordinal);if(prior){if(prior.value.leaseId!==value.leaseId)throw Error('代理段租约冲突。');return prior.promise;}
    const entry={value,ready:false,promise:null};group.set(ordinal,entry);retainedValues.add(value);
    entry.promise=local.adopt(value,taskOwner).then(()=>{entry.ready=true;return value;});entry.promise.catch(()=>{});return entry.promise;
  }
  async function detachRetained(parent){const group=retainedSegments.get(parent);if(group)for(const [ordinal,entry] of group){await entry.promise.catch(()=>{});await local.detach(entry.value);group.delete(ordinal);}retainedSegments.delete(parent);}
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
            else if (value.type === 'proxy-segment') {if(!closingSources.has(value.parentLeaseId))retainLocal(value.parentLeaseId,value.ordinal,value.value).catch(failed);}
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
  function control(method, info, fields) {
    if (!leases.has(info) || closingSources.has(info.leaseId) || failure || !taskOwner || ended) return;
    write({method,leaseId:info.leaseId,...fields});
  }
  function segmentAt(info,time){let low=0,high=info.segments.length;while(low<high){const mid=(low+high)>>>1;if(info.segments[mid].start<=time)low=mid+1;else high=mid;}return Math.max(0,low-1);}
  async function returnRecord(token){
    const {entry,value,parent}=token;
    if(entry&&!entry.users){await entry.promise.catch(()=>{});await local.detach(entry.info);if(recordEntries.get(value.leaseId)===entry)recordEntries.delete(value.leaseId);}
    await ask('releaseRecord',{leaseId:parent,recordLeaseId:value.leaseId});pendingRecordReturns.delete(token);
  }
  function readRecordFrame(info,ordinal,settings={}){
    if(!leases.has(info)||closingSources.has(info.leaseId)||!Number.isSafeInteger(ordinal)||!info.frames[ordinal])return Promise.reject(Error('标注帧会话已失效。'));
    if(recordReads.size>=2)return Promise.reject(Object.assign(Error('标注帧读取已满。'),{code:'CACHE_READER_BUSY'}));
    const controller=new AbortController(),abort=()=>controller.abort();if(settings.signal){settings.signal.addEventListener('abort',abort,{once:true});if(settings.signal.aborted)abort();}
    const task={parent:info.leaseId,controller,promise:null};
    task.promise=(async()=>{
      let value=null,entry=null;
      try{
        if(controller.signal.aborted)throw issue('MEDIA_CANCELLED','标注帧读取已取消。');
        if(!info.streaming){const bytes=await local.readAsset(info,info.frames[ordinal].file);if(controller.signal.aborted)throw issue('MEDIA_CANCELLED','标注帧读取已取消。');return {bytes,width:info.width,height:info.height,ordinal};}
        value=await ask('recordStill',{leaseId:info.leaseId,ordinal,...(settings.priority==='idle'?{priority:'idle'}:{})},{signal:controller.signal});
        entry=recordEntries.get(value.leaseId);
        if(!entry){entry={info:value,users:0,promise:local.adopt(value,taskOwner)};recordEntries.set(value.leaseId,entry);entry.promise.catch(()=>{});}
        entry.users++;await entry.promise;
        if(controller.signal.aborted)throw issue('MEDIA_CANCELLED','标注帧读取已取消。');
        const bytes=await local.readAsset(entry.info,entry.info.frames[0].file);
        if(controller.signal.aborted)throw issue('MEDIA_CANCELLED','标注帧读取已取消。');
        return {bytes,width:entry.info.width,height:entry.info.height,ordinal};
      }finally{
        if(settings.signal)settings.signal.removeEventListener('abort',abort);
        if(entry)entry.users--;
        if(value){const token={entry,value,parent:info.leaseId};pendingRecordReturns.add(token);await returnRecord(token);}
      }
    })();recordReads.add(task);task.promise.then(()=>recordReads.delete(task),()=>recordReads.delete(task));return task.promise;
  }
  async function drainRecords(parent){const tasks=[...recordReads].filter(task=>!parent||task.parent===parent);tasks.forEach(task=>task.controller.abort());await Promise.allSettled(tasks.map(task=>task.promise));
    // A detach/release failure keeps the handle and must prevent false close.
    const returns=await Promise.allSettled([...pendingRecordReturns].filter(token=>!parent||token.parent===parent).map(returnRecord));
    const bad=returns.find(result=>result.status==='rejected');if(bad)throw bad.reason;
    if([...pendingRecordReturns].some(token=>!parent||token.parent===parent))throw Error('标注静帧读取占用尚未交还。');}
  const cache = {
    readAsset: (info, file) => failure ? Promise.reject(failure) : readers.has(info) ? readers.get(info).frame(file) : local.readAsset(info, file),
    readAudioSegment: (info, ordinal) => readers.get(info).audio(ordinal),
    target: (info, time) => { if (readers.has(info)) readers.get(info).cancelExcept(time);if(Number.isFinite(time))control('target',info,{time}); },
    prioritizeRecords:(info,value)=>{const valid=items=>Array.isArray(items)&&items.length<=120000&&items.every(n=>Number.isSafeInteger(n)&&n>=0&&n<info.frames.length);if(!value||!valid(value.all)||!valid(value.visible)||info.frames.length>120000)throw Error('标注优先帧无效。');const prior=priorityBits.get(info)||{};for(const kind of ['all','visible']){const bits=Buffer.alloc(Math.ceil(info.frames.length/8));for(const n of value[kind])bits[n>>>3]|=1<<(n&7);const encoded=bits.toString('base64');if(prior[kind]!==encoded){control('prioritizeRecords',info,{kind,bits:encoded});prior[kind]=encoded;}}priorityBits.set(info,prior);},
    isFrameReady:(info,ordinal)=>{if(!leases.has(info)||closingSources.has(info.leaseId)||!Number.isSafeInteger(ordinal)||!info.frames[ordinal])return false;if(!info.streaming)return true;const segment=segmentAt(info,info.frames[ordinal].time);return retainedSegments.get(info.leaseId)?.get(segment)?.ready===true||readers.get(info)?.isFrameReady(ordinal)===true;},
    readRecordFrame,
    prefetch: (info, time, loop) => { if (readers.has(info)) readers.get(info).prefetch(time, loop); },
    cancelReads: info => { if (readers.has(info)) readers.get(info).cancelAll(); },
    readFrameBatch: (...args) => failure ? Promise.reject(failure) : local.readFrameBatch(...args),
    async release(info) { if (!leases.has(info)) return false; closingSources.add(info.leaseId);
      await drainRecords(info.leaseId);
      if (readers.has(info)) { await readers.get(info).close(); readers.delete(info); }
      else await local.detach(info);
      await detachRetained(info.leaseId);
      await ask('release', { leaseId: info.leaseId }); leases.delete(info); backgroundProgress.delete(info.leaseId); closingSources.delete(info.leaseId); return true; },
    clearOther: settings => ask('clearOther', { settings }),
    backgroundStatus: info=>backgroundProgress.get(info.leaseId)||null,
    inventory: local.inventory
  };
  const media = { async prepare(snapshot, settings = {}) {
    const tools = await options.discoverTools(settings.signal);
    const info = require('./media-wire.cjs').unpackInfo(await ask('prepare', { snapshot, tools, previewQuality: settings.previewQuality, playbackBackend: settings.playbackBackend }, settings));
    if (settings.signal && settings.signal.aborted) { closingSources.add(info.leaseId);await detachRetained(info.leaseId);await ask('release', { leaseId: info.leaseId });backgroundProgress.delete(info.leaseId);closingSources.delete(info.leaseId);throw issue('MEDIA_CANCELLED', '视频准备已取消。'); }
    if (info.streaming) {
      const reader = require('./segment-reader.cjs').createSegmentReader({ info,
        acquire: async (ordinal, signal) => {
          const retained=retainedSegments.get(info.leaseId)?.get(ordinal);if(retained)return retained.promise;
          const value = await ask('segment', { leaseId: info.leaseId, ordinal }, { signal });
          try { if(info.videoEncoding){const retained=await retainLocal(info.leaseId,ordinal,value);if(signal.aborted)throw issue('MEDIA_CANCELLED','分段准备已取消。');return retained;} if (signal.aborted) throw issue('MEDIA_CANCELLED', '分段准备已取消。'); await local.adopt(value, taskOwner); }
          catch (error) { if(!info.videoEncoding)await ask('release', { leaseId: value.leaseId }); throw error; }
          return value;
        }, release: async value => { if(retainedValues.has(value))return; await local.detach(value); await ask('release', { leaseId: value.leaseId }); },
        readAsset: (value, file) => local.readAsset(value, file) });
      readers.set(info, reader);
    } else try { await local.adopt(info, taskOwner); } catch (error) { await ask('release', { leaseId: info.leaseId }); throw error; }
    leases.add(info); return info;
  } };
  function close() {
    if (closing) return closing;
    closing = (async () => {
      if (!host && !ready) {await local.close();return { status: 'closed' };}
      beginClose();for(const info of leases)closingSources.add(info.leaseId);
      await drainRecords();
      for (const reader of readers.values()) await reader.close(); readers.clear();
      for (const info of leases) if (!info.streaming) await local.detach(info);
      for(const parent of retainedSegments.keys())await detachRetained(parent);
      leases.clear(); backgroundProgress.clear();
      try { if (!failure && !ended) await ask('close'); }
      catch (error) { if (!guardCancelled) throw error; }
      finally { if (host && !ended) host.stdin.end(); await exited; }
      await local.close();if (failure) throw failure; return { status: 'closed' };
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
