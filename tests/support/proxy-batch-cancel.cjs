'use strict';

// Explicit first-access-unit cancellation check. The bootstrap pauses one
// actual packed AVC write; it is never part of the throughput/player fixture.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert'), vm = require('vm');
const WORK_MS = 20000, CLOSE_MS = 20000, MAX_INPUT_BYTES = 2 * 1024 ** 2, MAX_MARKER_BYTES = 16 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const inside = (file, parent) => path.resolve(file).toLowerCase().startsWith(path.resolve(parent).toLowerCase() + path.sep);
function stamp(stat) { return { dev: String(stat.dev), ino: String(stat.ino), bytes: Number(stat.size), mtimeNs: String(stat.mtimeNs) }; }
function regular(file) {
  const value = fs.lstatSync(file, { bigint: true });
  assert(value.isFile() && !value.isSymbolicLink() && value.nlink === 1n && fs.realpathSync(file).toLowerCase() === path.resolve(file).toLowerCase(), 'Expected an exact ordinary file');
  return value;
}
function readSmall(file, limit) {
  const before = regular(file); assert(before.size <= BigInt(limit), 'Fixture input/marker exceeds its byte bound');
  const bytes = fs.readFileSync(file), after = regular(file);
  assert.deepEqual(stamp(after), stamp(before), 'Fixture file changed while reading'); assert.equal(bytes.length, Number(before.size));
  return { bytes, identity: stamp(before), sha256: hash(bytes) };
}
function hashFile(file) {
  const before = regular(file), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(64 * 1024), digest = crypto.createHash('sha256');
  try {
    assert.deepEqual(stamp(fs.fstatSync(fd, { bigint: true })), stamp(before));
    let bytes; while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, bytes));
    assert.deepEqual(stamp(fs.fstatSync(fd, { bigint: true })), stamp(before)); assert.deepEqual(stamp(regular(file)), stamp(before));
    return { ...stamp(before), sha256: digest.digest('hex') };
  } finally { fs.closeSync(fd); }
}
function errorInfo(error) { return { code: error.code || error.name || 'FAILED', message: String(error.message || error).slice(0, 2048), stack: String(error.stack || '').slice(-4096) }; }
function timeout(promise, ms, label, onTimeout) {
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => {
    if (onTimeout) onTimeout(); reject(Object.assign(Error(label + ' timed out'), { code: 'PROXY_CANCEL_CHECK_TIMEOUT' }));
  }, ms); });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}
function bootstrapSource() {
  return `'use strict';
// instrumented-test-seam: only the first real AVC access-unit write is held.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const root=fs.realpathSync(__dirname),cacheModule=require('./cache.cjs'),originalCreate=cacheModule.createCache;
let claimed=false,first=null,aborted=false,nextRecorded=false,batchSerial=0;
function read(file){const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size<=16384);const bytes=fs.readFileSync(file);return {bytes,value:JSON.parse(bytes.toString('utf8')),sha256:sha(bytes)};}
function marker(name,value){const file=path.join(root,name),next=file+'.next',bytes=Buffer.from(JSON.stringify(value)+'\\n');assert(bytes.length<=16384);const fd=fs.openSync(next,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert(fs.readFileSync(next).equals(bytes));fs.renameSync(next,file);}
function current(cacheRoot,sourceKey,originalSha,serial){
  const lock=read(path.join(cacheRoot,'writer.lock')),slot=read(path.join(cacheRoot,'writer-current-'+lock.value.token+'.json'));
  assert(lock.value.mode==='batch-v1'&&lock.value.sourceSha256===originalSha&&slot.value.writerSha256===lock.sha256);
  assert(slot.value.sourceSha256===sourceKey&&slot.value.token===lock.value.token&&slot.value.target===path.join(cacheRoot,'media-'+sourceKey+'-'+path.basename(slot.value.target).slice(-12)));
  return {schema:'eva-first-au-cancel-v1',scope:'instrumented-test-seam',batchSerial:serial,originalSha256:originalSha,sourceKey,
    writerToken:lock.value.token,writerSha256:lock.sha256,segmentToken:slot.value.segmentToken,sequence:slot.value.sequence,target:slot.value.target,
    currentSha256:slot.sha256,currentBase64:slot.bytes.toString('base64'),taskOwner:lock.value.taskOwner,workerPid:process.pid};
}
cacheModule.createCache=function(options){
  const cache=originalCreate(options);
  return Object.freeze({...cache,openBatch(settings){
    const batch=cache.openBatch(settings),serial=++batchSerial;
    return Object.freeze({...batch,beginSegment(selected){
      const tx=batch.beginSegment(selected);
      if(aborted&&!nextRecorded){const value=current(cache.root,selected.sourceSha256,settings.sourceSha256,serial);nextRecorded=true;marker('cancel-next-segment.json',{...value,phase:'next-segment',at:Date.now()});}
      return Object.freeze({...tx,async writeFrame(name,bytes){
        const asset=await tx.writeFrame(name,bytes);
        if(claimed)return asset;claimed=true;assert(/\\.avc$/.test(name),'Only real AVC access units may enter the cancellation seam');
        const signal=selected.signal;assert(signal&&typeof signal.addEventListener==='function','Use the actual segment cancellation signal');
        const value=current(cache.root,selected.sourceSha256,settings.sourceSha256,serial),pack=path.join(cache.root,'partial-'+value.writerToken,'frames.pack');
        const until=Date.now()+1000;let stat;
        while(Date.now()<until){try{stat=fs.lstatSync(pack);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size>0)break;}catch(error){if(error.code!=='ENOENT')throw error;}await new Promise(resolve=>setTimeout(resolve,5));}
        assert(stat&&stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.size>0,'First actual access-unit write has no nonempty packed file');
        assert(!fs.existsSync(value.target),'Held segment must not already be published');
        first={...value,phase:'first-AU-written',at:Date.now(),frameFile:name,frameBytes:asset.bytes,packFile:pack,packBytes:stat.size,
          packIdentity:{dev:String(stat.dev),ino:String(stat.ino)},unpublishedAtReady:true};
        marker('cancel-first-au.json',first);
        await new Promise((resolve,reject)=>{
          let timer=null,done=false;
          const finish=error=>{if(done)return;done=true;if(timer!==null)clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
          const abort=()=>{try{const now=current(cache.root,selected.sourceSha256,settings.sourceSha256,serial);
            assert(now.writerToken===first.writerToken&&now.currentSha256===first.currentSha256&&now.segmentToken===first.segmentToken);
            const unpublishedAtAbort=!fs.existsSync(first.target);assert(unpublishedAtAbort,'Held target published before segment abort');
            marker('cancel-abort.json',{...now,phase:'segment-aborted-after-AU',at:Date.now(),firstCurrentSha256:first.currentSha256,
              packBytesAtReady:first.packBytes,unpublishedAtAbort,signalAborted:signal.aborted});aborted=true;
            finish(Object.assign(Error('Instrumented first-AU write cancelled by the actual segment signal'),{code:'MEDIA_CANCELLED',name:'AbortError'}));
          }catch(error){finish(error);}};
          signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>finish(Object.assign(Error('First-AU seam never received a real segment abort'),{code:'PROXY_CANCEL_SEAM_TIMEOUT'})),10000);
          if(signal.aborted)abort();
        });
        return asset;
      }});
    }});
  }});
};
require('./task-worker-real.cjs');
`;
}

async function checkProxyBatchCancel({ root, scratch, source, tools }) {
  const started = Date.now(), result = { name: 'first-real-AU-background-cancel-and-foreground-reuse', status: 'running',
    origin: 'instrumented-test-seam-real-native-guard-formal-media-cache-worker', eagle: false,
    limits: { workMs: WORK_MS, closeMs: CLOSE_MS }, runtimeInputs: [], markers: {}, close: { attempted: false, stopped: false, safeToCleanup: false } };
  let client = null, info = null, stopping = false, ownRoot = null;
  const controller = new AbortController();
  try {
    root = fs.realpathSync(root); scratch = fs.realpathSync(scratch); source = fs.realpathSync(source);
    assert(fs.lstatSync(scratch).isDirectory() && inside(source, scratch), 'Reuse only the caller-owned generated source');
    for (const name of ['ffmpeg', 'ffprobe']) { assert(tools && path.isAbsolute(tools[name])); regular(tools[name]); }
    const sourceBefore = hashFile(source); result.source = { file: path.relative(scratch, source), ...sourceBefore };
    ownRoot = path.join(scratch, 'proxy-cancel-' + crypto.randomBytes(8).toString('hex')); assert(inside(ownRoot, scratch)); fs.mkdirSync(ownRoot);
    fs.mkdirSync(path.join(ownRoot, 'native')); result.scratch = path.relative(scratch, ownRoot);
    const runtime = require(path.join(root, 'scripts/package-release.cjs')).RUNTIME;
    for (const file of runtime) {
      const original = path.join(root, 'plugin', file); assert(inside(original, path.join(root, 'plugin')));
      const input = readSmall(original, MAX_INPUT_BYTES), copied = file === 'task-worker.cjs' ? 'task-worker-real.cjs' : file;
      const destination = path.join(ownRoot, copied); assert(inside(destination, ownRoot));
      fs.writeFileSync(destination, input.bytes, { flag: 'wx' }); const actual = readSmall(destination, MAX_INPUT_BYTES); assert.equal(actual.sha256, input.sha256);
      result.runtimeInputs.push({ file, copied, bytes: input.bytes.length, sha256: input.sha256 });
    }
    const boot = Buffer.from(bootstrapSource()); new vm.Script(boot.toString('utf8'), { filename: 'instrumented-task-worker.cjs' });
    fs.writeFileSync(path.join(ownRoot, 'task-worker.cjs'), boot, { flag: 'wx' });
    result.bootstrap = { bytes: boot.length, sha256: hash(boot), base64: boot.toString('base64') };
    result.helper = { bytes: regular(__filename).size.toString(), sha256: hash(fs.readFileSync(__filename)) };
    const { createTaskClient } = require(path.join(ownRoot, 'task-client.cjs'));
    client = createTaskClient({ pluginRoot: ownRoot, runtime: process.execPath, discoverTools: async () => tools });
    function saveMarker(name) {
      const file = path.join(ownRoot, name), input = readSmall(file, MAX_MARKER_BYTES), value = JSON.parse(input.bytes.toString('utf8'));
      assert.equal(value.schema, 'eva-first-au-cancel-v1'); assert.equal(value.scope, 'instrumented-test-seam');
      const saved = { file: path.relative(scratch, file), bytes: input.bytes.length, sha256: input.sha256, base64: input.bytes.toString('base64'), value };
      result.markers[name] = saved; return value;
    }
    const work = (async () => {
      result.runtime = await client.ping();
      info = await client.media.prepare({ id: 'synthetic-first-AU-cancel', filePath: source, ext: 'mp4' },
        { playbackBackend: 'proxy', previewQuality: '720p', signal: controller.signal });
      assert(info.streaming && info.videoEncoding && info.segments.length >= 2); assert.equal(info.source.sha256, sourceBefore.sha256);
      result.session = { leaseId: info.leaseId, sourceSha256: info.source.sha256, frames: info.frames.length, segments: info.segments.length };
      const readyFile = path.join(ownRoot, 'cancel-first-au.json');
      while (!fs.existsSync(readyFile)) { if (stopping) throw Error('Cancellation check stopped'); await pause(10); }
      const ready = saveMarker('cancel-first-au.json');
      assert.equal(ready.originalSha256, info.source.sha256); assert(ready.packBytes > 0 && ready.frameBytes > 0 && ready.unpublishedAtReady);
      assert.equal(ready.taskOwner.key, result.runtime.taskOwner.key); assert.equal(ready.taskOwner.epoch, result.runtime.taskOwner.epoch);
      assert.equal(ready.taskOwner.guardPid, result.runtime.taskOwner.guardPid); assert.equal(ready.workerPid, result.runtime.pid);
      if (stopping) throw Error('Cancellation check stopped before foreground target');
      const target = info.frames.length - 1, frame = info.frames[target], at = Date.now();
      client.cache.target(info, frame.time);
      const bytes = await client.cache.readAsset(info, frame.file);
      assert(bytes && bytes.byteLength > 0);
      result.foreground = { ordinal: target, ptsTicks: frame.ptsTicks, timeBase: frame.timeBase, file: frame.file,
        bytes: bytes.byteLength, sha256: hash(Buffer.from(bytes)), ms: Date.now() - at,
        scope: 'Formal segment reader verified source PTS and returned packed AVC bytes; no pixel decode assertion.' };
      const aborted = saveMarker('cancel-abort.json'), next = saveMarker('cancel-next-segment.json');
      assert(aborted.signalAborted && aborted.unpublishedAtAbort); assert.equal(aborted.sourceKey, ready.sourceKey);
      assert.equal(aborted.firstCurrentSha256, ready.currentSha256); assert.equal(aborted.segmentToken, ready.segmentToken);
      for (const value of [aborted, next]) {
        assert.equal(value.originalSha256, ready.originalSha256); assert.equal(value.writerToken, ready.writerToken);
        assert.equal(value.writerSha256, ready.writerSha256); assert.equal(value.batchSerial, ready.batchSerial);
      }
      assert(next.sequence > ready.sequence); assert.notEqual(next.sourceKey, ready.sourceKey);
      result.sameBatchReused = true;
      if (stopping) throw Error('Cancellation check stopped before source release');
      result.release = await client.cache.release(info); assert.equal(result.release, true); info = null;
    })();
    await timeout(work, WORK_MS, 'First-AU cancellation work', () => { stopping = true; controller.abort(); client.beginClose(); });
    assert.deepEqual(hashFile(source), sourceBefore, 'The generated source changed during cancellation check');
    result.status = 'passed';
  } catch (error) { result.status = 'failed'; result.error = errorInfo(error); }
  finally {
    stopping = true; controller.abort();
    if (client) {
      result.close.attempted = true; const at = Date.now();
      try {
        client.beginClose(); result.close.result = await timeout(client.close(), CLOSE_MS, 'Owned native guard close');
        result.close.stopped = client.stopped;
        assert(result.close.stopped && result.close.result.status === 'closed', 'Owned native guard did not acknowledge a clean exit');
        const inventory = require(path.join(ownRoot, 'cache.cjs')).createCache({ pluginRoot: ownRoot }).inventory();
        result.close.inventory = { exists: inventory.exists, usedBytes: inventory.usedBytes, caches: inventory.caches.length, leases: inventory.leases.length };
        const cacheRoot = path.join(ownRoot, 'cache'), names = fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot) : [];
        assert.equal(inventory.leases.length, 0); assert(!names.some(name => /^(?:writer\.lock$|partial-|lease-|writer-current-)/.test(name)), 'Cancellation fixture leaked writer/current/partial/lease');
        result.close.safeToCleanup = true;
      } catch (error) { result.close.stopped = client.stopped; result.close.error = errorInfo(error); result.status = 'failed'; }
      result.close.ms = Date.now() - at;
    } else result.close.safeToCleanup = true;
    if (ownRoot) for (const name of ['cancel-first-au.json', 'cancel-abort.json', 'cancel-next-segment.json']) {
      if (result.markers[name] || !fs.existsSync(path.join(ownRoot, name))) continue;
      try { const input = readSmall(path.join(ownRoot, name), MAX_MARKER_BYTES); result.markers[name] = { file: path.relative(scratch, path.join(ownRoot, name)),
        bytes: input.bytes.length, sha256: input.sha256, base64: input.bytes.toString('base64'), value: JSON.parse(input.bytes.toString('utf8')) }; }
      catch (error) { result.markerErrors ||= []; result.markerErrors.push({ name, ...errorInfo(error) }); result.status = 'failed'; }
    }
    result.wallMs = Date.now() - started;
  }
  return result;
}

module.exports = { checkProxyBatchCancel, _test: { bootstrapSource } };
