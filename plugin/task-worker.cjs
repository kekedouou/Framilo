'use strict';
// Runs under the Windows guard using Eagle's own Node runtime. No Eagle APIs.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline');
const root = fs.realpathSync(__dirname), key = crypto.createHash('sha256').update(root.toLowerCase()).digest('hex');
if (process.env.EVA_TASK_ROOT !== root || process.env.EVA_TASK_KEY !== key ||
    !/^[0-9a-f]{32}$/.test(process.env.EVA_TASK_EPOCH || '') || !/^\d+$/.test(process.env.EVA_TASK_GUARD_PID || ''))
  throw new Error('Task worker requires its owned Windows guard.');
const taskOwner = Object.freeze({ schema: 'eva-task-owner-v1', key, epoch: process.env.EVA_TASK_EPOCH,
  guardPid: Number(process.env.EVA_TASK_GUARD_PID) });
const base = require('./process-identity.cjs').createIdentity();
const identity = { self: () => { const value = base.self(); if (!value) throw new Error('Cannot establish worker identity; no cache writer created.'); return value; },
  child: () => null, // OS task membership is established before spawn; no synchronous per-child CIM query.
  claimEmptyWriter: base.claimEmptyWriter,
  inspect(record) {
    if (record.taskOwner && record.taskOwner.schema === taskOwner.schema && record.taskOwner.key === key &&
        /^[0-9a-f]{32}$/.test(record.taskOwner.epoch || '') && record.taskOwner.epoch !== taskOwner.epoch)
      return { safe: true, reason: 'exclusive-guard-confirmed-previous-owned-job-empty' };
    const ordinary = base.inspect(record); if (ordinary.safe) return ordinary;
    // One legacy dead renderer left only a marker (no partial outputs). Its
    // unregistered children only wrote pipes; no cache writer survives it.
    // Keep the complete owner record/hash in the existing reap audit.
    if (!record.taskOwner && record.kind === 'writer' && record.children && record.children.some(c => c.state === 'starting') &&
        !fs.readdirSync(path.join(root, 'cache')).some(n => /^partial-/.test(n))) {
      const rows = require('./process-identity.cjs')._test.snapshot();
      if (!rows.some(row => row.pid === record.pid || row.parentPid === record.pid) &&
          !rows.some(row => /\\ff(?:mpeg|probe)\.exe$/i.test(row.image || ''))) {
        const proof = require('./process-identity.cjs')._test.proveGone({ ...record,
          children: record.children.map(child => child.state === 'starting' ? { ...child, state: 'closed' } : child) }, rows);
        if (proof.safe) return { safe: true, reason: 'legacy-renderer-gone-no-writable-partial-or-observed-media-descendant' };
      }
    }
    return ordinary;
  } };
const cache = require('./cache.cjs').createCache({ pluginRoot: root, taskOwner, processIdentity: identity, packFrames: true, protectWholeProxy: true });
const handles = new Map(), controllers = new Map(),requestMethods=new Map();
const longOwners = new Map(), backgrounds = new Map();
const scrubBackgrounds=new Map();
const recordBorrows = new Map(),recordPriorities=new Map();
function backgroundEvent(leaseId,value){send({type:"proxy-progress",leaseId,value});}
let sourceExports = null;
let tail = Promise.resolve(), stopping = false, quiescing = false, shutdownTask = null;
function send(value) { const text = JSON.stringify(value); if (Buffer.byteLength(text) > 8 * 1024 ** 2) throw new Error('Control response exceeds 8MiB.'); process.stdout.write(text + '\n'); }
function response(id, result, error) { send({ type: 'response', id, ...(error ? { error: { code: error.code || (error.name === 'AbortError' ? 'MEDIA_CANCELLED' : 'TASK_FAILED'), message: String(error.message).slice(0, 2048) } } : { result }) }); }
function enqueue(fn) { const work = tail.then(fn); tail = work.catch(() => {}); return work; }
function registerRecordBorrow(info,ordinal,value,bg){
  const prior=recordBorrows.get(value.leaseId);
  if(prior){if(prior.parent!==info.leaseId||prior.bg!==bg||prior.ordinal!==ordinal)throw Error('标注静帧归属冲突。');prior.users++;}
  else recordBorrows.set(value.leaseId,{parent:info.leaseId,ordinal,value,users:1,bg});
  return value;
}
function borrowReadyRecord(info,ordinal,bg){
  if(!info||!bg||!Number.isSafeInteger(ordinal)||!info.frames[ordinal])return null;
  const value=bg.borrowRecord(ordinal);if(!value)return null;
  try{return registerRecordBorrow(info,ordinal,value,bg);}catch(error){bg.returnRecord(value);throw error;}
}
function recordReturn(message){
  const entry=recordBorrows.get(message.recordLeaseId);
  if(!entry||entry.parent!==message.leaseId||entry.users<1)throw Error('未知标注静帧占用。');
  return entry;
}
function returnReadyRecord(message){
  const entry=recordReturn(message);if(!entry.bg)return false;
  entry.bg.returnRecord(entry.value);if(!--entry.users)recordBorrows.delete(message.recordLeaseId);return true;
}
async function closeProxyBatches(except) {
  for (const [leaseId, media] of longOwners) if (leaseId !== except) await media.closeProxyBatch(handles.get(leaseId));
}
function shutdown(id) {
  if (shutdownTask) return shutdownTask;
  stopping = true; for(const bg of scrubBackgrounds.values())bg.stop();for(const bg of backgrounds.values())bg.foreground(); for (const controller of controllers.values()) controller.abort();
  shutdownTask = enqueue(async () => {
    if(recordBorrows.size)throw Error('标注静帧尚未交还，未确认关闭。');
    for(const bg of scrubBackgrounds.values())await bg.close();scrubBackgrounds.clear();
    for(const bg of backgrounds.values())await bg.close(); backgrounds.clear();
    for (const info of handles.values()) {
      if (longOwners.has(info.leaseId)) await longOwners.get(info.leaseId).releaseLong(info);
      else await cache.release(info);
    }
    longOwners.clear();
    handles.clear(); if (id !== undefined) response(id, { status: 'closed' });
    process.stdout.write('', () => process.exit(0));
  });
  shutdownTask.catch(error => { if (id !== undefined) response(id, null, error); process.stderr.write(String(error.stack).slice(0, 8192)); process.exitCode = 2; input.close(); process.stdin.destroy(); });
  return shutdownTask;
}
async function execute(message, controller) {
  if (stopping||controller.signal.aborted) throw Object.assign(new Error('视频任务正在关闭或已取消。'), { code: 'MEDIA_CANCELLED' });
  if (message.method === 'prepare') {
    await closeProxyBatches();
    const media = require('./media.cjs').createMedia({ tools: message.tools, cache });
    const info = await media.prepare(message.snapshot, { signal: controller.signal, previewQuality: message.previewQuality, playbackBackend: message.playbackBackend, proxyEncoder: message.proxyEncoder,
      onProgress: value => send({ type: 'progress', id: message.id, value }) });
    handles.set(info.leaseId, info);
    if (info.streaming) longOwners.set(info.leaseId, media);
    if(info.videoEncoding){
      const bg=require('./proxy-background.cjs').createProxyBackground({info,
        prepare:(ordinal,signal)=>media.prepareSegment(info,ordinal,{signal}),release:value=>cache.release(value),
        prepareRecord:typeof media.prepareStill==='function'?(ordinal,signal)=>media.prepareStill(info,ordinal,{signal}):undefined,
        enqueue,idle:()=>!stopping&&!quiescing&&!controllers.size&&scrubBackgrounds.get(info.leaseId)?.snapshot().stage!=='preparing',
        budget:async signal=>{await closeProxyBatches(info.leaseId);return media.proxyBudget(info,{signal});},
        closeBatch:()=>media.closeProxyBatch(info),emit:value=>backgroundEvent(info.leaseId,value),
        onSegment:(ordinal,value)=>{send({type:'proxy-segment',parentLeaseId:info.leaseId,ordinal,value});scrubBackgrounds.get(info.leaseId)?.start();}});
      backgrounds.set(info.leaseId,bg);bg.kick();
      const scrub=require('./scrub-background.cjs').createScrubBackground({info,enqueue,
        lookup:(n,signal)=>media.scrubSegment(info,n,null,{signal}),publish:(n,items,signal)=>media.scrubSegment(info,n,items,{signal}),
        stream:(n,signal)=>media.scrubStream(info,n,signal),release:value=>cache.release(value),
        budget:async signal=>{await closeProxyBatches(info.leaseId);return media.proxyBudget(info,{signal});},
        onSegment:(ordinal,value)=>send({type:'scrub-segment',parentLeaseId:info.leaseId,ordinal,value}),
        emit:value=>{send({type:'scrub-progress',leaseId:info.leaseId,value});if(value.stage!=='preparing')bg.kick();}});
      scrubBackgrounds.set(info.leaseId,scrub);
    }
    return info.streaming ? require('./media-wire.cjs').packInfo(info) : info;
  }
  if (message.method === 'segment') {
    const info = handles.get(message.leaseId), media = longOwners.get(message.leaseId);
    if (!info || !media) throw new Error('长视频会话已失效。');
    const bg=backgrounds.get(info.leaseId);if(bg?.get(message.ordinal))return bg.get(message.ordinal);
    await closeProxyBatches(info.videoEncoding ? info.leaseId : undefined);
    let segment = await media.prepareSegment(info, message.ordinal, { signal: controller.signal });
    if(bg) return await bg.retain(message.ordinal,segment);
    handles.set(segment.leaseId, segment);return segment;
  }
  if(message.method==='recordStill'){
    const info=handles.get(message.leaseId),media=longOwners.get(message.leaseId),bg=backgrounds.get(message.leaseId);
    if(!info||!media||!Number.isSafeInteger(message.ordinal)||!info.frames[message.ordinal])throw Error('标注静帧会话已失效。');
    let value=borrowReadyRecord(info,message.ordinal,bg);if(value)return value;
    if(!value){await closeProxyBatches(info.videoEncoding?info.leaseId:undefined);value=await media.prepareStill(info,message.ordinal,{signal:controller.signal});
      if(bg){await bg.retainRecord(message.ordinal,value);const ready=borrowReadyRecord(info,message.ordinal,bg);if(!ready)throw Error('标注静帧正在关闭或交还。');return ready;}}
    return registerRecordBorrow(info,message.ordinal,value,bg);
  }
  if(message.method==='releaseRecord'){
    if(returnReadyRecord(message))return true;
    const entry=recordReturn(message);await cache.release(entry.value);
    if(!--entry.users)recordBorrows.delete(message.recordLeaseId);return true;
  }
  if (message.method === 'release') {
    const info = handles.get(message.leaseId); if (!info) throw new Error('Unknown task lease.');
    if([...recordBorrows.values()].some(entry=>entry.parent===message.leaseId))throw Error('标注静帧尚未交还。');
    if(scrubBackgrounds.has(message.leaseId)){await scrubBackgrounds.get(message.leaseId).close();scrubBackgrounds.delete(message.leaseId);}
    if(backgrounds.has(message.leaseId)){await backgrounds.get(message.leaseId).close();backgrounds.delete(message.leaseId);}
    if (longOwners.has(message.leaseId)) { await longOwners.get(message.leaseId).releaseLong(info); longOwners.delete(message.leaseId); }
    else await cache.release(info);
    handles.delete(message.leaseId);recordPriorities.delete(message.leaseId);return true;
  }
  if (message.method === 'clearOther') {
    if(message.settings?.clearAll===true&&handles.size)throw Error('活动视频缓存不能整批清理。');
    await closeProxyBatches();
    const maintenance=message.settings?.independentWholeProxy===true
      ? require('./cache.cjs').createCache({pluginRoot:root,taskOwner,processIdentity:identity,packFrames:true,protectWholeProxy:true,independentWholeProxy:true}) : cache;
    return maintenance.clearOther(message.settings);
  }
  if (['export', 'publishExport', 'discardExport'].includes(message.method)) {
    if (!sourceExports) sourceExports = require('./export.cjs').createExportStore({ pluginRoot: root });
    if (message.method === 'export') {
      const info = handles.get(message.leaseId);
      if (!info) throw new Error('导出对应的视频会话已失效。');
      return sourceExports.create(info, message.request, { tools: message.tools, signal: controller.signal,
        onProgress: value => send({ type: 'progress', id: message.id, value }) });
    }
    if (message.method === 'publishExport') return sourceExports.publish(message.token, message.destination, { signal: controller.signal });
    return sourceExports.discard(message.token);
  }
  if (message.method === 'ping') return { node: process.versions.node, pid: process.pid, taskOwner };
  throw new Error('Unknown task method.');
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (Buffer.byteLength(line) > 32768) { shutdown(); return; }
  let message; try { message = JSON.parse(line); } catch (_) { shutdown(); return; }
  // Stop producers immediately, while renderer leases/reads drain separately.
  if (message.method === 'quiesce') {
    quiescing = true;
    for(const bg of scrubBackgrounds.values())bg.stop();
    for (const bg of backgrounds.values()) bg.foreground();
    for (const [id, method] of requestMethods) if (['prepare','segment','recordStill'].includes(method)) controllers.get(id)?.abort();
    return;
  }
  if (message.method === 'cancel') { const controller = controllers.get(message.id); if (controller) controller.abort(); return; }
  if(['target','prioritizeRecords'].includes(message.method)){
    // Receipt acknowledges pipe consumption, not completed media preparation.
    // Always acknowledge even a retired source so no intention lane is stuck.
    if (Number.isSafeInteger(message.controlId) && message.controlId > 0)
      send({type:'control-ack',id:message.controlId});
    // These are latest intentions, not jobs. Never append every pointer move to
    // the writer queue or abort an in-flight preparation for the same segment.
    if(stopping)return;const info=handles.get(message.leaseId),bg=backgrounds.get(message.leaseId);if(!info||!bg)return;
    if(message.method==='target'){if(Number.isFinite(message.time))bg.target(message.time);return;}
    if(!['all','visible'].includes(message.kind)||typeof message.bits!=='string'||info.frames.length>120000)return;
    const size=Math.ceil(info.frames.length/8);if(message.bits.length!==Math.ceil(size/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(message.bits))return;
    const bits=Buffer.from(message.bits,'base64');if(bits.length!==size||bits.toString('base64')!==message.bits)return;
    const values=[];for(let n=0;n<bits.length*8;n++)if(bits[n>>>3]&(1<<(n&7))){if(n>=info.frames.length)return;values.push(n);}
    const prior=recordPriorities.get(info.leaseId)||{all:[],visible:[]};prior[message.kind]=values;recordPriorities.set(info.leaseId,prior);bg.prioritizeRecords(prior);return;
  }
  if(message.method==='stopScrub'){scrubBackgrounds.get(message.leaseId)?.stop();return;}
  if (!Number.isSafeInteger(message.id) || message.id < 1 || controllers.has(message.id)) { shutdown(); return; }
  if (message.method === 'close') { shutdown(message.id); return; }
  if(message.method==='prepare')for(const bg of scrubBackgrounds.values())bg.stop();
  if(message.method==='release')scrubBackgrounds.get(message.leaseId)?.stop();
  if(message.method==='recordStill'&&!stopping){
    try{const info=handles.get(message.leaseId),bg=backgrounds.get(message.leaseId),value=borrowReadyRecord(info,message.ordinal,bg);
      if(value){response(message.id,value);return;}
    }catch(error){response(message.id,null,error);return;}
  }
  if(message.method==='releaseRecord'){
    try{if(returnReadyRecord(message)){response(message.id,true);return;}}
    catch(error){response(message.id,null,error);return;}
  }
  if(message.method==='segment'&&!backgrounds.get(message.leaseId)?.get(message.ordinal))
    for(const [id,method] of requestMethods)if(method==='recordStill')controllers.get(id)?.abort();
  if(!['releaseRecord','ping'].includes(message.method)&&!(message.method==='recordStill'&&message.priority==='idle'))for(const [leaseId,bg] of backgrounds){
    if(message.method==='segment'&&leaseId===message.leaseId){if(!bg.get(message.ordinal))bg.foreground(message.ordinal);}
    else if(message.method==='recordStill'&&leaseId===message.leaseId){if(!bg.getRecord(message.ordinal))bg.foreground(message.ordinal,'record');}
    else bg.foreground();
  }
  const controller = new AbortController(); controllers.set(message.id, controller);requestMethods.set(message.id,message.method);
  enqueue(() => execute(message, controller)).then(result => response(message.id, result), error => response(message.id, null, error))
    .finally(() => {controllers.delete(message.id);requestMethods.delete(message.id);for(const bg of backgrounds.values())bg.kick();});
});
input.on('close', () => shutdown());
send({ type: 'ready', pid: process.pid, taskOwner, node: process.versions.node });
