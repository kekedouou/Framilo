'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { EventEmitter } = require('events'), { PassThrough } = require('stream');
const { createWholeProxy, _test } = require('../plugin/whole-proxy.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(t, mode = 'normal', options = {}) {
  const root = path.resolve(__dirname, options.temporary?'../verification-runs/e52/whole-proxy-unit':'../verification-runs/e44/whole-proxy-unit'); await fs.promises.mkdir(root, { recursive: true });
  const dir = await fs.promises.mkdtemp(path.join(root, 'case-'));
  t.after(async () => { await fs.promises.rm(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'source.mp4'), ffmpeg = path.join(dir, 'ffmpeg.exe'), ffprobe = path.join(dir, 'ffprobe.exe');
  for (const file of [source, ffmpeg, ffprobe]) await fs.promises.writeFile(file, 'unit-fixture-' + path.basename(file));
  const spec = { source: { filePath: source, sha256: sha(await fs.promises.readFile(source)) }, width: 1280, height: 720, encoder: 'cpu', frames: [
    { id: 4, ptsTicks: '0', timeBase: [1, 16000], time: 0, end: .017 },
    { id: 6, ptsTicks: '272', timeBase: [1, 16000], time: .017, end: .033 },
    { id: 9, ptsTicks: '528', timeBase: [1, 16000], time: .033, end: .05 }] };
  const calls = [], children = []; let release, encodes=0;
  function spawn(exe, args, options) {
    calls.push({ exe, args, options }); const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.pid = 123;
    let done = false;
    const finish = (code=0) => { if (done) return; done = true; c.stdout.end(); c.stderr.end(); c.emit('close', code, null); };
    c.kill = () => { if (done) return false; done = true; c.stdout.end(); c.stderr.end(); queueMicrotask(() => c.emit('close', null, 'SIGTERM')); return true; };
    const run = async () => {
      if (done) return;
      if (exe === ffmpeg && args.includes('showinfo@verify=checksum=0')) {
        const hardware=args.includes('cuda'),shape=mode==='odd'?_test.normalize(spec):{width:1280,height:720,sampleAspectRatio:'1:1'};
        if(mode==='gpu-fail'&&hardware){c.stderr.write('CUDA initialization unavailable\n');finish(1);return;}
        if(mode==='long-validation-line'){c.stderr.write('x'.repeat(65537));return;}
        if(mode==='over-block-stderr'){const block=Buffer.alloc(1024*1024+1);block.toString=()=>{throw Error('Oversized stderr must be rejected before string conversion');};c.stderr.write(block);return;}
        if(mode==='late-failure-data'){c.stderr.emit('data',Buffer.from('x'.repeat(65537)));const late=Buffer.from('late');late.toString=()=>{throw Error('Data received after failure must be ignored');};c.stderr.emit('data',late);c.stdout.emit('data',late);return;}
        c.stderr.write('[showinfo@verify @ unit] config in time_base: 1/1000000, frame_rate: 60/1\n');
        const points=mode==='missing'?[0,17000]:[0,17000,33000];
        points.forEach((pts,n)=>c.stderr.write(`[showinfo@verify @ unit] n:${n} pts:${mode==='gpu-wrong-pts'&&hardware&&n===1?18000:pts} pts_time:0 fmt:${hardware?'cuda':'yuv420p'} sar:${shape.sampleAspectRatio.replace(':','/')} s:${shape.width}x${shape.height} i:P iskey:1 type:I\n`));
        if(mode==='hold-validation'){release=finish;return;}
      } else if (exe === ffmpeg) {
        if((mode==='nvenc-unavailable'||mode==='source-decode-error')&&args.includes('h264_nvenc')){c.stderr.write(mode==='nvenc-unavailable'?'[h264_nvenc] No NVENC capable devices found\n':'Error while decoding stream: invalid data\n');finish(1);return;}
        await fs.promises.writeFile(args[args.length - 1], Buffer.alloc(256, 1));
        if(mode==='disk-full'){c.stderr.write('No space left on device\n');finish(1);return;}
        if(mode==='quota-once'&&encodes++===0){c.stdout.write('total_size='+(Number(args[args.indexOf('-fs')+1])+1)+'\n');return;}
        c.stdout.write('out_time_us=25000\ntotal_size=256\n');
        if (mode === 'hold') { release = finish; return; }
      } else {
        const shape=mode==='odd'?_test.normalize(spec):{width:1280,height:720,sampleAspectRatio:'1:1'};c.stdout.write(`stream|codec_name=h264|width=${shape.width}|height=${shape.height}|time_base=1/1000000|start_pts=0|duration_ts=50000|sample_aspect_ratio=${shape.sampleAspectRatio}\n`);
      }
      finish();
    };
    setImmediate(() => run().catch(e => { c.emit('error', e); c.kill(); })); children.push(c); return c;
  }
  const cacheRoot = path.join(dir, 'cache'), states = [];
  const service = createWholeProxy({ cacheRoot, tools: { ffmpeg, ffprobe }, spawn, onChange: s => states.push(s), limitBytes: 128 * 1024 ** 2, ...options });
  t.after(() => service.close());
  return { dir, source, ffmpeg, ffprobe, cacheRoot, spec, service, calls, states, children, spawn, release: () => release?.() };
}
test('VFR whole recipe preserves every frame and only encodes video', () => {
  const spec = { source: { filePath: path.resolve('source.mp4') }, width: 1280, height: 720, encoder: 'nvidia' };
  const args = _test.encodeArgs(spec, path.resolve('proxy.mp4'), 1000000);
  assert.equal(args[args.indexOf('-g') + 1], '1'); assert.equal(args[args.indexOf('-bf') + 1], '0');
  assert.equal(args[args.indexOf('-fps_mode') + 1], 'passthrough'); assert(args.includes('-an'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'h264_nvenc'); assert(!args.includes('-ss')); assert(!args.includes('-t'));
});
test('E51 large proxy decline and close during choice start no encoder and leave no partial output',async t=>{
 for(const cancel of [false,true]){const f=await fixture(t),frames=Array.from({length:5000},(_,n)=>({id:n,ptsTicks:String(n),timeBase:[1,25],time:n/25,end:(n+1)/25}));let entered;const waiting=new Promise(r=>entered=r);
 const h=f.service.start({...f.spec,frames,requestDecision:async(spec,signal)=>{assert.equal(spec.kind,'large-proxy');entered();if(!cancel)return 'source';return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})),{once:true}));}});
 await waiting;if(cancel)await h.cancel();assert.equal(await h.ready,null);assert.equal(h.snapshot().status,'cancelled');assert.equal(f.calls.length,0);assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
 }
});
test('VFR mapping rejects lost frames, non-I frames and shifted timestamps', async t => {
  const f = await fixture(t), spec = _test.normalize(f.spec), stream = { codec_name: 'h264', width: 1280, height: 720, time_base: '1/1000000', duration_ts: '50000', start_pts: '0', sample_aspect_ratio: '1:1' };
  const rows = [0, 17000, 33000].map(n => ({ key_frame: '1', pts: String(n) }));
  assert.deepEqual(_test.validateProxy(spec, rows, stream).proxyPts, ['0', '17000', '33000']);
  assert.throws(() => _test.validateProxy(spec, rows.slice(1), stream), /帧数/);
  assert.throws(() => _test.validateProxy(spec, [{ ...rows[0], key_frame: '0' }, ...rows.slice(1)], stream), /非独立帧/);
  assert.throws(() => _test.validateProxy(spec, [rows[0], { ...rows[1], pts: '18000' }, rows[2]], stream), /时间映射/);
});
test('start returns immediately; publishes only complete atomically validated asset; restart reuses', async t => {
  const f = await fixture(t), handle = f.service.start(f.spec);
  assert(handle.ready instanceof Promise); assert.equal(handle.snapshot().stage, 'preparing'); assert.equal(f.calls.length, 0);
  const result = await handle.ready; assert(result, JSON.stringify(handle.snapshot())); assert.equal(result.frames.length, 3); assert.equal(result.frames[1].sourcePtsTicks, '272');
  assert.equal(result.frames[1].proxyPtsTicks, '17000'); assert.equal(result.audio, 'original-source-clock'); assert.equal(f.calls.length, 3);
  assert(f.states.filter(s => s.status !== 'ready').every(s => s.readyRanges.length === 0));
  assert.equal(handle.snapshot().stage, 'complete'); assert.deepEqual(handle.snapshot().readyRanges, [{ start: 0, end: .05 }]);
  assert.equal(handle.snapshot().asset, undefined); assert.equal(handle.snapshot().assetInfo.frames, 3);
  assert(Buffer.byteLength(JSON.stringify(handle.snapshot())) < 4096);
  await f.service.close();
  const again = createWholeProxy({ cacheRoot: f.cacheRoot, tools: { ffmpeg: f.ffmpeg, ffprobe: f.ffprobe }, spawn: f.spawn, limitBytes: 128 * 1024 ** 2 });
  t.after(() => again.close()); const reused = await again.start({ ...f.spec }).ready;
  assert.equal(reused.reused, true); assert.equal(f.calls.length, 3);
});
test('failed partial encode is never exposed and only current owned temporary directory is removed', async t => {
  const f = await fixture(t, 'missing'), foreign = path.join(f.cacheRoot, 'foreign'); await fs.promises.mkdir(foreign, { recursive: true }); await fs.promises.writeFile(path.join(foreign, 'keep.txt'), 'keep');
  const handle = f.service.start(f.spec); assert.equal(await handle.ready, null); assert.equal(handle.snapshot().stage, 'error');
  assert.equal(await fs.promises.readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'keep');
  assert.deepEqual((await fs.promises.readdir(path.join(f.cacheRoot, 'whole-v1'))), []);
});
test('cancel while encoding waits for child exit and leaves no published asset', async t => {
  const f = await fixture(t, 'hold'), handle = f.service.start(f.spec);
  while (!f.states.some(s => s.status === 'encoding')) await new Promise(r => setImmediate(r));
  assert.equal(await handle.cancel(), null); assert.equal(handle.snapshot().status, 'cancelled');
  assert.equal(handle.snapshot().readyRanges.length, 0); assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot, 'whole-v1')), []);
});
test('total capacity counts old cache and stops before spawning', async t => {
  const f = await fixture(t), shared = path.join(f.dir, 'shared'); await fs.promises.mkdir(shared); await fs.promises.writeFile(path.join(shared, 'old-cache'), 'preserve');
  const proxy = createWholeProxy({ cacheRoot: path.join(shared, 'new'), capacityRoot: shared, tools: { ffmpeg: f.ffmpeg, ffprobe: f.ffprobe }, spawn: f.spawn, limitBytes: 64 * 1024 ** 2 });
  t.after(() => proxy.close()); const handle = proxy.start(f.spec);
  assert.equal(await handle.ready, null); assert.equal(handle.snapshot().stage, 'budget'); assert.equal(f.calls.length, 0);
  assert.equal(await fs.promises.readFile(path.join(shared, 'old-cache'), 'utf8'), 'preserve');
});
test('source mutation and corrupt cached bytes cannot be published or reused', async t => {
  const f = await fixture(t); await fs.promises.writeFile(f.source, 'changed'); const handle = f.service.start(f.spec);
  assert.equal(await handle.ready, null); assert.equal(handle.snapshot().error.code, 'WHOLE_SOURCE_CHANGED'); assert.equal(f.calls.length, 0);
  const g = await fixture(t), complete = await g.service.start(g.spec).ready; await g.service.close(); await fs.promises.writeFile(complete.filePath, Buffer.alloc(256, 2));
  const again = createWholeProxy({ cacheRoot: g.cacheRoot, tools: { ffmpeg: g.ffmpeg, ffprobe: g.ffprobe }, spawn: g.spawn }); t.after(() => again.close());
  const reopened = again.start({ ...g.spec }); assert.equal(await reopened.ready, null); assert.equal(reopened.snapshot().error.code, 'WHOLE_CACHE_INVALID');
});
async function staleLock(f, token, pid, pendingToken = token) {
  const spec = _test.normalize(f.spec), toolHashes = { ffmpeg: sha(await fs.promises.readFile(f.ffmpeg)), ffprobe: sha(await fs.promises.readFile(f.ffprobe)) };
  const identity = { schema: 'e44-whole-proxy-v1', sourceHash: spec.source.sha256, indexHash: spec.indexHash, width: spec.width, height: spec.height, recipe: spec.recipe, toolHashes };
  const dir = path.join(f.cacheRoot, 'whole-v1'), key = sha(JSON.stringify(identity)), lock = path.join(dir, key + '.lock'), pending = path.join(dir, '.pending-' + token);
  await fs.promises.mkdir(pending, { recursive: true });
  await fs.promises.writeFile(path.join(pending, 'owner.json'), JSON.stringify({ schema: 'e44-whole-proxy-v1', token: pendingToken, pid }));
  await fs.promises.writeFile(path.join(pending, 'video.mp4'), 'abandoned generated bytes');
  await fs.promises.writeFile(lock, JSON.stringify({ schema: 'e44-whole-proxy-v1', token, pid, createdAt: '2020-01-01T00:00:00Z' }));
  return { dir, key, lock, pending };
}
test('dead owning process lock is recovered on restart; only matching pending is cleaned', async t => {
  const f = await fixture(t), token = 'a'.repeat(32), pid = 987654321, stale = await staleLock(f, token, pid), originalKill = process.kill;
  process.kill = function(candidate, signal) { if (candidate === pid) throw Object.assign(Error('dead fixture'), { code: 'ESRCH' }); return originalKill.call(process, candidate, signal); };
  try {
    const sibling = path.join(stale.dir, '.pending-' + 'b'.repeat(32)); await fs.promises.mkdir(sibling); await fs.promises.writeFile(path.join(sibling, 'keep'), 'not ours');
    const h = f.service.start(f.spec), result = await h.ready; assert(result, JSON.stringify(h.snapshot()));
    assert.equal(fs.existsSync(stale.pending), false); assert.equal(await fs.promises.readFile(path.join(sibling, 'keep'), 'utf8'), 'not ours');
    assert.equal(JSON.parse(await fs.promises.readFile(path.join(stale.dir, 'last-recovery.json'))).pending, 'removed');
    assert.equal(h.snapshot().lockReleased, true); assert.equal(h.snapshot().cleanupComplete, true); assert.equal(fs.existsSync(stale.lock), false);
  } finally { process.kill = originalKill; }
});
test('EPERM or active process is not considered dead and remains untouched', async t => {
  const f = await fixture(t), pid = 987654322, stale = await staleLock(f, 'c'.repeat(32), pid), originalKill = process.kill;
  process.kill = function(candidate, signal) { if (candidate === pid) throw Object.assign(Error('unknown fixture'), { code: 'EPERM' }); return originalKill.call(process, candidate, signal); };
  try { const h = f.service.start(f.spec); assert.equal(await h.ready, null); assert.equal(h.snapshot().error.code, 'WHOLE_BUSY'); assert.equal(fs.existsSync(stale.lock), true); assert.equal(fs.existsSync(stale.pending), true); assert.equal(f.calls.length, 0); }
  finally { process.kill = originalKill; }
});
test('dead pending whose ownership token differs is retained', async t => {
  const f = await fixture(t), pid = 987654323, stale = await staleLock(f, 'd'.repeat(32), pid, 'e'.repeat(32)), originalKill = process.kill;
  process.kill = function(candidate, signal) { if (candidate === pid) throw Object.assign(Error('dead fixture'), { code: 'ESRCH' }); return originalKill.call(process, candidate, signal); };
  try { const h = f.service.start(f.spec); assert(await h.ready); assert.equal(fs.existsSync(stale.pending), true); assert.equal(JSON.parse(await fs.promises.readFile(path.join(stale.dir, 'last-recovery.json'))).pending, 'not-owned'); }
  finally { process.kill = originalKill; }
});
test('lock changed at atomic isolation is restored without deleting fresh owner', async t => {
  const f = await fixture(t), pid = 987654324, stale = await staleLock(f, 'f'.repeat(32), pid), originalKill = process.kill, originalRename = fs.promises.rename;
  const fresh = { schema: 'e44-whole-proxy-v1', token: '9'.repeat(32), pid: process.pid, createdAt: new Date().toISOString() };
  process.kill = function(candidate, signal) { if (candidate === pid) throw Object.assign(Error('dead fixture'), { code: 'ESRCH' }); return originalKill.call(process, candidate, signal); };
  fs.promises.rename = async function(from, to) { if (from === stale.lock) await fs.promises.writeFile(stale.lock, JSON.stringify(fresh)); return originalRename.call(fs.promises, from, to); };
  try { const h = f.service.start(f.spec); assert.equal(await h.ready, null); assert.equal(h.snapshot().error.code, 'WHOLE_BUSY'); assert.deepEqual(JSON.parse(await fs.promises.readFile(stale.lock, 'utf8')), fresh); assert.equal(fs.existsSync(stale.pending), true); assert.equal(f.calls.length, 0); }
  finally { process.kill = originalKill; fs.promises.rename = originalRename; }
});
test('metadata probe is cheap but actual full decode remains mandatory with strict errors',()=>{
 const file=path.resolve('complete.mp4'),meta=_test.probeArgs(file);assert(!meta.includes('-show_frames'));assert(meta.includes('-show_streams'));
 for(const gpu of [false,true]){const args=_test.validationArgs(file,gpu);assert(args.includes('-xerror'));assert.equal(args[args.indexOf('-err_detect')+1],'explode');assert(args.includes('showinfo@verify=checksum=0'));assert.equal(args[args.indexOf('-c:v')+1],'wrapped_avframe');assert.equal(args[args.indexOf('-f')+1],'null');assert.equal(args[args.indexOf('-hwaccel')+1],gpu?'cuda':'none');assert(!args.includes('-skip_frame'));assert.equal(args.at(-1),'-');}
});
test('GPU failure uses exactly one complete CPU validation and records actual fallback',async t=>{
 const f=await fixture(t,'gpu-fail'),h=f.service.start(f.spec),result=await h.ready;assert(result,JSON.stringify(h.snapshot()));
 const verification=f.calls.filter(c=>c.args.includes('showinfo@verify=checksum=0'));assert.equal(verification.length,2);assert.equal(verification[0].args[verification[0].args.indexOf('-hwaccel')+1],'cuda');assert.equal(verification[1].args[verification[1].args.indexOf('-hwaccel')+1],'none');assert.equal(result.validation.decoder,'cpu');assert.match(result.validation.fallback,/CUDA initialization/);assert.equal(result.validation.frames,3);
});
test('wrong GPU timestamps are rejected; only complete independent CPU result may publish',async t=>{
 const f=await fixture(t,'gpu-wrong-pts'),h=f.service.start(f.spec),result=await h.ready;assert(result);assert.equal(result.validation.decoder,'cpu');assert.match(result.validation.fallback,/时间映射/);assert.deepEqual(result.proxyPts,['0','17000','33000']);
});
test('disabled hardware decoding does not start a GPU verification process',async t=>{
 const f=await fixture(t),h=f.service.start({...f.spec,validationHardware:false}),result=await h.ready;assert(result);assert.equal(result.validation.decoder,'cpu');assert.equal(result.validation.fallback,null);
 const verification=f.calls.filter(c=>c.args.includes('showinfo@verify=checksum=0'));assert.equal(verification.length,1);assert(!verification[0].args.includes('cuda'));
 assert.equal(_test.normalize({...f.spec,validationHardware:false}).recipe,_test.normalize(f.spec).recipe);
});
test('every validation stage exposes real frame/byte progress and stays unpublished',async t=>{
 const f=await fixture(t),h=f.service.start(f.spec),result=await h.ready;assert(result);
 const validation=f.states.filter(s=>s.status==='validating');for(const phase of ['metadata','frames','source-hash','proxy-hash','publish'])assert(validation.some(s=>s.validationPhase===phase),phase);
 const frame=validation.find(s=>s.validationPhase==='frames'&&s.validationDone===3);assert.equal(frame.validationTotal,3);assert.equal(frame.validationProgress,1);
 for(const phase of ['source-hash','proxy-hash']){const last=validation.filter(s=>s.validationPhase===phase).at(-1);assert(last.validationTotal>0);assert.equal(last.validationDone,last.validationTotal);assert.equal(last.validationProgress,1);}
 assert(validation.every(s=>s.ready===0&&s.readyRanges.length===0));assert(validation.every(s=>s.remainingSeconds===null));
});
test('cancel in full GPU validation never falls back or exposes partial asset',async t=>{
 const f=await fixture(t,'hold-validation'),h=f.service.start(f.spec);
 while(!f.states.some(s=>s.validationPhase==='frames'))await new Promise(r=>setImmediate(r));
 assert.equal(await h.cancel(),null);assert.equal(h.snapshot().status,'cancelled');assert.equal(f.calls.filter(c=>c.args.includes('showinfo@verify=checksum=0')).length,1);assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
});
test('oversized validation lines fail safely in both decoders',async t=>{
 const f=await fixture(t,'long-validation-line'),h=f.service.start(f.spec);assert.equal(await h.ready,null);assert.equal(h.snapshot().error.code,'WHOLE_PROTOCOL');assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
});
test('read-only validation uses formal validator without creating any cache asset',async t=>{
 const f=await fixture(t),file=path.join(f.dir,'existing.mp4');await fs.promises.writeFile(file,'existing proxy fixture');const before=await fs.promises.readFile(file),states=[];
  const r=await _test.validateExisting({cacheRoot:f.cacheRoot,tools:{ffmpeg:f.ffmpeg,ffprobe:f.ffprobe},spawn:f.spawn},f.spec,file,{onChange:s=>states.push(s)});assert.equal(r.validation.frames,3);assert.equal(r.validation.decoder,'cuda');assert.equal(r.sha256,sha(before));assert.deepEqual(await fs.promises.readFile(file),before);assert.equal(fs.existsSync(f.cacheRoot),false);assert(states.some(s=>s.validationPhase==='proxy-hash'));assert.equal(f.calls.length,2);assert.equal(f.service.validateExisting,undefined);
});
test('old complete records without optional validation metrics still reopen intact',async t=>{
 const f=await fixture(t),result=await f.service.start(f.spec).ready;assert(result);await f.service.close();
 const file=path.join(result.directory,'complete.json'),record=JSON.parse(await fs.promises.readFile(file,'utf8'));delete record.validation;await fs.promises.writeFile(file,JSON.stringify(record));
 const reopened=createWholeProxy({cacheRoot:f.cacheRoot,tools:{ffmpeg:f.ffmpeg,ffprobe:f.ffprobe},spawn:f.spawn});t.after(()=>reopened.close());const reused=await reopened.start({...f.spec}).ready;
 assert(reused);assert.equal(reused.reused,true);assert.equal(reused.validation,undefined);assert.equal(f.calls.length,3);
});
test('source changed after source SHA during proxy SHA is rejected before publication',async t=>{
 const f=await fixture(t);let changed=false;
 const h=f.service.start({...f.spec,onChange:s=>{if(!changed&&s.validationPhase==='proxy-hash'){changed=true;fs.appendFileSync(f.source,' changed during proxy hash');}}});
 assert.equal(await h.ready,null);assert.equal(changed,true);assert.equal(h.snapshot().error.code,'WHOLE_SOURCE_CHANGED');assert(f.states.every(s=>s.status!=='ready'));assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
});
test('source changed at publish stage cannot create a complete asset',async t=>{
 const f=await fixture(t);let changed=false;
 const h=f.service.start({...f.spec,onChange:s=>{if(!changed&&s.validationPhase==='publish'){changed=true;fs.appendFileSync(f.source,' changed before commit');}}});
 assert.equal(await h.ready,null);assert.equal(changed,true);assert.equal(h.snapshot().error.code,'WHOLE_SOURCE_CHANGED');assert(f.states.every(s=>s.status!=='ready'));assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
});
test('read-only validator checks source stamp through the end of proxy hashing',async t=>{
 const f=await fixture(t),file=path.join(f.dir,'existing.mp4');await fs.promises.writeFile(file,'existing proxy fixture');let changed=false;
 await assert.rejects(_test.validateExisting({cacheRoot:f.cacheRoot,tools:{ffmpeg:f.ffmpeg,ffprobe:f.ffprobe},spawn:f.spawn},f.spec,file,{onChange:s=>{if(!changed&&s.validationPhase==='proxy-hash'){changed=true;fs.appendFileSync(f.source,' changed after source hash');}}}),{code:'WHOLE_SOURCE_CHANGED'});
 assert.equal(changed,true);assert.equal(fs.existsSync(f.cacheRoot),false);
});
test('reuse source guard remains active while cached proxy SHA is being read',async t=>{
 const f=await fixture(t),complete=await f.service.start(f.spec).ready;assert(complete);await f.service.close();
 const reader=fs.createReadStream;let changed=false;
 fs.createReadStream=function(file,options){if(!changed&&path.resolve(String(file))===complete.filePath){changed=true;fs.appendFileSync(f.source,' changed while checking cached proxy');}return reader.call(fs,file,options);};
 const again=createWholeProxy({cacheRoot:f.cacheRoot,tools:{ffmpeg:f.ffmpeg,ffprobe:f.ffprobe},spawn:f.spawn});
 try{const h=again.start({...f.spec});assert.equal(await h.ready,null);assert.equal(changed,true);assert.equal(h.snapshot().error.code,'WHOLE_SOURCE_CHANGED');assert.equal(fs.existsSync(complete.filePath),true);assert.equal(f.calls.length,3);}
 finally{fs.createReadStream=reader;await again.close();}
});
test('oversized stderr is bounded before conversion or frame parsing',async t=>{
 const f=await fixture(t,'over-block-stderr'),h=f.service.start(f.spec);assert.equal(await h.ready,null);assert.equal(h.snapshot().error.code,'WHOLE_PROTOCOL');assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
});
test('late stdout and stderr are drained without conversion after a validation failure',async t=>{
 const f=await fixture(t,'late-failure-data'),h=f.service.start(f.spec);assert.equal(await h.ready,null);assert.equal(h.snapshot().error.code,'WHOLE_PROTOCOL');assert(f.states.filter(s=>s.validationPhase==='frames').every(s=>s.validationDone===0));assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
});

test('underestimated output evicts remaining unused old proxy and retries once within quota',async t=>{
 const f=await fixture(t,'quota-once'),identity={sourceHash:'b'.repeat(64),fixture:'old'},key=sha(JSON.stringify(identity)),dir=path.join(f.cacheRoot,'whole-v1',key);await fs.promises.mkdir(dir,{recursive:true});const out=await fs.promises.open(path.join(dir,'video.mp4'),'wx');await out.truncate(48*1024**2);await out.close();await fs.promises.writeFile(path.join(dir,'complete.json'),JSON.stringify({schema:'e44-whole-proxy-v1',key,identity,sourceHash:identity.sourceHash,allKeyFrames:true,bytes:48*1024**2,generatedAt:'2026-01-01T00:00:00Z'}));
 const h=f.service.start(f.spec),result=await h.ready;assert(result,JSON.stringify(h.snapshot()));assert(!fs.existsSync(dir));assert.equal(f.calls.filter(c=>c.exe===f.ffmpeg&&!c.args.includes('showinfo@verify=checksum=0')).length,2);assert(f.states.some(s=>s.message.includes('重新生成')));assert(fs.existsSync(f.source));
});

test('odd preview encodes even samples with matching SAR and keeps every source PTS',async t=>{
 const f=await fixture(t),spec=_test.normalize({...f.spec,width:1280,height:689});assert.equal(spec.width,1280);assert.equal(spec.height,690);assert.equal(spec.displayHeight,689);const [sn,sd]=spec.sampleAspectRatio.split(':').map(Number);assert(Math.abs(spec.width*sn/sd/spec.height-1280/689)<1e-5);const args=_test.encodeArgs(spec,path.join(f.dir,'odd.mp4'),1024**2),filter=args[args.indexOf('-vf')+1];assert(filter.includes('scale=1280:690'));assert(filter.includes('setsar=sar='));assert(!filter.includes('crop'));const stream={codec_name:'h264',width:1280,height:690,time_base:'1/1000000',duration_ts:'50000',start_pts:'0',sample_aspect_ratio:spec.sampleAspectRatio};const rows=[0,17000,33000].map((pts,n)=>({ordinal:n,pts:String(pts),key_frame:'1',width:1280,height:690,sar:[sn,sd]}));assert.deepEqual(_test.validateProxy(spec,rows,stream).proxyPts,['0','17000','33000']);assert.throws(()=>_test.validateProxy(spec,rows,{...stream,sample_aspect_ratio:'1:1'}),/像素比例/);
});
test('unavailable NVENC retries once under the CPU cache identity and releases GPU locks',async t=>{
 const f=await fixture(t,'nvenc-unavailable'),h=f.service.start({...f.spec,encoder:'nvidia'}),a=await h.ready;assert(a,JSON.stringify(h.snapshot()));assert.equal(a.encoder,'cpu');assert.equal(a.identity.recipe,'h264-mp4-x264-ultrafast-crf20-all-i-v1');assert(f.states.some(s=>s.encoderFallback));const encoderCalls=f.calls.filter(c=>c.exe===f.ffmpeg&&!c.args.includes('showinfo@verify=checksum=0'));assert.equal(encoderCalls.length,2);assert(encoderCalls[0].args.includes('h264_nvenc'));assert(encoderCalls[1].args.includes('libx264'));assert(!(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1'))).some(n=>n.endsWith('.lock')||n.startsWith('.pending-')));
});
test('source decode error is never swallowed as an unavailable GPU encoder',async t=>{
 const f=await fixture(t,'source-decode-error'),h=f.service.start({...f.spec,encoder:'nvidia'});assert.equal(await h.ready,null);assert.equal(h.snapshot().status,'failed');assert.equal(f.calls.length,1);assert(!f.states.some(s=>s.encoderFallback));
});

test('odd-aspect cache publishes and reopens with original display geometry and SAR identity intact',async t=>{
 const f=await fixture(t,'odd');f.spec.height=689;const handle=f.service.start(f.spec),a=await handle.ready;assert(a,JSON.stringify(handle.snapshot()));assert.equal(a.displayHeight,689);assert.equal(a.height,690);assert.equal(a.identity.displayHeight,689);assert.equal(a.identity.sampleAspectRatio,a.sampleAspectRatio);await f.service.close();const again=createWholeProxy({cacheRoot:f.cacheRoot,tools:{ffmpeg:f.ffmpeg,ffprobe:f.ffprobe},spawn:f.spawn,limitBytes:128*1024**2});t.after(()=>again.close());const old=f.calls.length,b=await again.start({...f.spec}).ready;assert(b);assert.equal(b.reused,true);assert.equal(b.displayHeight,689);assert.equal(b.sampleAspectRatio,a.sampleAspectRatio);assert.equal(f.calls.length,old);
});

test('exact simple SAR is retained and numerically equivalent H264 fractions validate',async t=>{
 const f=await fixture(t),spec=_test.normalize({...f.spec,width:2560,height:975});assert.equal(spec.sampleAspectRatio,'976:975');const rows=[0,17000,33000].map(pts=>({pts:String(pts),key_frame:'1'})),stream={codec_name:'h264',width:2560,height:976,time_base:'1/1000000',duration_ts:'50000',start_pts:'0',sample_aspect_ratio:'1952:1950'};assert.equal(_test.validateProxy(spec,rows,stream).proxyPts.length,3);assert.throws(()=>_test.validateProxy(spec,rows,{...stream,sample_aspect_ratio:'1:1'}),/像素比例/);
});

test('quota failure is published only after the owned partial is removed; original remains untouched',async t=>{
 const f=await fixture(t,'quota-once');let terminal;
 const h=f.service.start({...f.spec,onChange:s=>{if(s.stage==='budget')terminal={...s,pending:fs.readdirSync(path.join(f.cacheRoot,'whole-v1')).filter(n=>n.startsWith('.pending-'))};}});
 assert.equal(await h.ready,null);assert(terminal);assert.equal(terminal.cleanupComplete,true);assert.equal(terminal.temporaryReleased,true);assert.equal(terminal.bytes,0);assert.deepEqual(terminal.pending,[]);assert(f.states.some(s=>s.status==='cleaning'));assert.match(h.snapshot().message,/已回收/);assert.equal(sha(await fs.promises.readFile(f.source)),f.spec.source.sha256);
});
test('failed cleanup retains ownership and never reports partial space reclaimed or cancelled successfully',async t=>{
 const f=await fixture(t,'missing');let changed=false;
 const h=f.service.start({...f.spec,onChange:s=>{if(s.status==='validating'&&!changed){changed=true;const dir=fs.readdirSync(path.join(f.cacheRoot,'whole-v1')).find(n=>n.startsWith('.pending-'));fs.writeFileSync(path.join(f.cacheRoot,'whole-v1',dir,'foreign.txt'),'preserve');}}});
 assert.equal(await h.ready,null);assert.equal(h.snapshot().error.code,'WHOLE_CLEANUP_FAILED');assert.equal(h.snapshot().cleanupComplete,false);assert.equal(h.snapshot().lockReleased,false);assert(fs.readdirSync(path.join(f.cacheRoot,'whole-v1')).some(n=>n.endsWith('.lock')));
});
test('missing owner does not masquerade as a removed partial',async t=>{
 const f=await fixture(t,'missing');let changed=false;
 const h=f.service.start({...f.spec,onChange:s=>{if(s.status==='validating'&&!changed){changed=true;const dir=fs.readdirSync(path.join(f.cacheRoot,'whole-v1')).find(n=>n.startsWith('.pending-'));fs.unlinkSync(path.join(f.cacheRoot,'whole-v1',dir,'owner.json'));}}});
 assert.equal(await h.ready,null);assert.equal(h.snapshot().error.code,'WHOLE_CLEANUP_FAILED');assert.equal(h.snapshot().temporaryReleased,false);
});

test('physical disk exhaustion is distinguished from configured quota after partial cleanup',async t=>{
 const f=await fixture(t,'disk-full'),h=f.service.start(f.spec);
 assert.equal(await h.ready,null);assert.equal(h.snapshot().cleanupComplete,true);assert.equal(h.snapshot().bytes,0);
 assert.match(h.snapshot().message,/硬盘可用空间不足/);assert.match(h.snapshot().message,/已回收/);
 assert(!fs.readdirSync(path.join(f.cacheRoot,'whole-v1')).some(n=>n.startsWith('.pending-')));
});

// E52 consent is window cumulative, not the retired preference quota.
test('E52 estimated oversize decline and close while awaiting consent start no encoder',async t=>{
 for(const cancel of [false,true]){const f=await fixture(t,'normal',{temporary:true,limitBytes:100*1024**3,freeBytes:async()=>20*1024**3});let entered;const waiting=new Promise(r=>entered=r);
 const frames=Array.from({length:5000},(_,n)=>({id:n,ptsTicks:String(n),timeBase:[1,25],time:n/25,end:(n+1)/25}));
 const h=f.service.start({...f.spec,frames,requestDecision:async(d,signal)=>{assert.match(d.title,/1 GB/);entered();if(!cancel)return 'source';return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}});
 await waiting;if(cancel)await h.cancel();assert.equal(await h.ready,null);assert.equal(f.calls.length,0);assert.equal(h.snapshot().status,'cancelled');assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
 }
});
test('E52 underestimated output is removed before confirmation and restarted only after consent',async t=>{
 for(const choice of ['source','generate']){const f=await fixture(t,'quota-once',{temporary:true,limitBytes:100*1024**3,freeBytes:async()=>20*1024**3});let prompts=0;
 const h=f.service.start({...f.spec,requestDecision:async d=>{prompts++;assert.match(d.body,/未完成文件已回收/);const pending=(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1'))).find(n=>n.startsWith('.pending-'));assert(!fs.existsSync(path.join(f.cacheRoot,'whole-v1',pending,'video.mp4')));return choice;}});
 const result=await h.ready;assert.equal(prompts,1);assert.equal(!!result,choice==='generate');assert.equal(h.snapshot().status,choice==='generate'?'ready':'cancelled');
 }
});
test('E52 physical reserve exhaustion never starts an encoder or requests unlimited consent',async t=>{
 const f=await fixture(t,'normal',{temporary:true,limitBytes:100*1024**3,freeBytes:async()=>2*1024**3});let prompts=0;const h=f.service.start({...f.spec,requestDecision:async()=>{prompts++;return 'generate';}});
 assert.equal(await h.ready,null);assert.equal(prompts,0);assert.equal(f.calls.length,0);assert.equal(h.snapshot().error.code,'WHOLE_BUDGET');assert.deepEqual(await fs.promises.readdir(path.join(f.cacheRoot,'whole-v1')),[]);
});
