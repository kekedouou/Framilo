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
const cache = require('./cache.cjs').createCache({ pluginRoot: root, taskOwner, processIdentity: identity, packFrames: true });
const handles = new Map(), controllers = new Map();
const longOwners = new Map(), backgrounds = new Map();
function backgroundEvent(leaseId,value){send({type:"proxy-progress",leaseId,value});}
let sourceExports = null;
let tail = Promise.resolve(), stopping = false, shutdownTask = null;
function send(value) { const text = JSON.stringify(value); if (Buffer.byteLength(text) > 8 * 1024 ** 2) throw new Error('Control response exceeds 8MiB.'); process.stdout.write(text + '\n'); }
function response(id, result, error) { send({ type: 'response', id, ...(error ? { error: { code: error.code || 'TASK_FAILED', message: String(error.message).slice(0, 2048) } } : { result }) }); }
function enqueue(fn) { const work = tail.then(fn); tail = work.catch(() => {}); return work; }
async function closeProxyBatches(except) {
  for (const [leaseId, media] of longOwners) if (leaseId !== except) await media.closeProxyBatch(handles.get(leaseId));
}
function shutdown(id) {
  if (shutdownTask) return shutdownTask;
  stopping = true; for(const bg of backgrounds.values())bg.foreground(); for (const controller of controllers.values()) controller.abort();
  shutdownTask = enqueue(async () => {
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
  if (stopping) throw Object.assign(new Error('视频任务正在关闭。'), { code: 'MEDIA_CANCELLED' });
  if (message.method === 'prepare') {
    await closeProxyBatches();
    const media = require('./media.cjs').createMedia({ tools: message.tools, cache });
    const info = await media.prepare(message.snapshot, { signal: controller.signal, previewQuality: message.previewQuality, playbackBackend: message.playbackBackend,
      onProgress: value => send({ type: 'progress', id: message.id, value }) });
    handles.set(info.leaseId, info);
    if (info.streaming) longOwners.set(info.leaseId, media);
    if(info.videoEncoding){
      const bg=require('./proxy-background.cjs').createProxyBackground({info,
        prepare:(ordinal,signal)=>media.prepareSegment(info,ordinal,{signal}),release:value=>cache.release(value),
        enqueue,idle:()=>!stopping&&!controllers.size,
        budget:async signal=>{await closeProxyBatches(info.leaseId);return media.proxyBudget(info,{signal});},
        closeBatch:()=>media.closeProxyBatch(info),emit:value=>backgroundEvent(info.leaseId,value),
        onSegment:(ordinal,value)=>{send({type:'proxy-segment',parentLeaseId:info.leaseId,ordinal,value});}});
      backgrounds.set(info.leaseId,bg);bg.kick();
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
  if (message.method === 'release') {
    const info = handles.get(message.leaseId); if (!info) throw new Error('Unknown task lease.');
    if(backgrounds.has(message.leaseId)){await backgrounds.get(message.leaseId).close();backgrounds.delete(message.leaseId);}
    if (longOwners.has(message.leaseId)) { await longOwners.get(message.leaseId).releaseLong(info); longOwners.delete(message.leaseId); }
    else await cache.release(info);
    handles.delete(message.leaseId); return true;
  }
  if (message.method === 'clearOther') { await closeProxyBatches(); return cache.clearOther(message.settings); }
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
  if (message.method === 'cancel') { const controller = controllers.get(message.id); if (controller) controller.abort(); return; }
  if (!Number.isSafeInteger(message.id) || message.id < 1 || controllers.has(message.id)) { shutdown(); return; }
  if (message.method === 'close') { shutdown(message.id); return; }
  for(const bg of backgrounds.values())bg.foreground();
  const controller = new AbortController(); controllers.set(message.id, controller);
  enqueue(() => execute(message, controller)).then(result => response(message.id, result), error => response(message.id, null, error))
    .finally(() => {controllers.delete(message.id);for(const bg of backgrounds.values())bg.kick();});
});
input.on('close', () => shutdown());
send({ type: 'ready', pid: process.pid, taskOwner, node: process.versions.node });
