'use strict';
const assert = require('assert'), path = require('path');
const { createMemoryPreferences, memoryValue, OWNER } = require('../plugin/preferences.cjs');
const root = path.resolve('mock memory 中文'), file = path.join(root, 'memory-settings.json'), temp = path.join(root, 'memory-settings.next.json');
function model() {
  const files = new Map(), fds = new Map(); let seq = 1, next = 5;
  const missing = () => Object.assign(new Error('missing'), { code: 'ENOENT' });
  const stats = (value, dir = false) => ({ dev: 1, ino: value?.ino || 1, mtimeMs: value?.time || 1, size: value?.data.length || 0,
    nlink: value?.links || 1, isFile: () => !dir, isDirectory: () => dir, isSymbolicLink: () => !!value?.link });
  const io = { realpathSync: n => n,
    lstatSync(n) { assert([root, file, temp].includes(n)); if (n === root) return stats(null, true); if (!files.has(n)) throw missing(); return stats(files.get(n)); },
    readFileSync(n) { if (!files.has(n)) throw missing(); return Buffer.from(files.get(n).data); },
    openSync(n, flags) { assert.equal(n, temp); assert.equal(flags, 'wx'); if (files.has(n)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      const value = { ino: ++seq, time: seq, data: Buffer.alloc(0) }; files.set(n, value); const fd = ++next; fds.set(fd, value); return fd; },
    fstatSync: fd => stats(fds.get(fd)),
    writeFileSync(fd, data) { const value = fds.get(fd); value.data = Buffer.from(data); value.time = ++seq; if (io.onWrite) io.onWrite(); },
    fsyncSync() {}, closeSync(fd) { fds.delete(fd); },
    renameSync(from, to) { if (io.failRename) throw new Error('rename failed'); assert.equal(from, temp); assert.equal(to, file); files.set(to, files.get(from)); files.delete(from); },
    unlinkSync(n) { assert.equal(n, temp); files.delete(n); } };
  const put = (n, data) => files.set(n, { ino: ++seq, time: seq, data: Buffer.from(data) });
  return { io, files, put, create: total => createMemoryPreferences({ pluginRoot: root, io, totalRamBytes: total || 40 * 1024 ** 3 }) };
}
{
  const m = model(), p = m.create(); assert.equal(m.files.size, 0); assert.equal(p.snapshot().ramBytes, 1024 ** 3);
  assert.equal(p.snapshot().ramMiB, 1024); assert.equal(p.snapshot().compressedRamBytes, 128 * 1024 ** 2);
  p.save(2048); assert.equal(p.snapshot().ramBytes, 2 * 1024 ** 3); assert(!m.files.has(temp));
  assert.equal(m.create().snapshot().ramMiB, 2048); assert.equal(m.create(32 * 1024 ** 3).snapshot().ramBytes, 2 * 1024 ** 3);
  for (const x of [0, -1, 100.1, NaN, Infinity, '2048', 1536, 11264]) assert.throws(() => p.save(x));
  for (const n of [512, ...Array.from({length:10},(_,i)=>(i+1)*1024)]) assert.equal(memoryValue(40 * 1024 ** 3,n).ramBytes,n * 1024 ** 2);
  assert.throws(()=>memoryValue(4 * 1024 ** 3,5120),/物理内存/);
}
{
  const m = model(), p = m.create(); p.save(1024); const original = Buffer.from(m.files.get(file).data);
  m.io.failRename = true; assert.throws(() => p.save(2048), /rename failed/);
  assert(m.files.get(file).data.equals(original)); assert(!m.files.has(temp)); assert.equal(p.snapshot().ramMiB, 1024);
}
{
  const m = model(), p = m.create(); p.save(1024);
  m.io.onWrite = () => m.put(file, JSON.stringify({ owner: OWNER, ramMiB: 3072 }));
  assert.throws(() => p.save(2048), /保存期间改变/); assert.equal(m.create().snapshot().ramMiB, 3072); assert(!m.files.has(temp));
}
for (const kind of ['link', 'links', 'large', 'foreign', 'broken']) {
  const m = model(); m.put(file, JSON.stringify({ owner: OWNER, percent: 2.5 })); const item = m.files.get(file);
  if (kind === 'link') item.link = true;
  if (kind === 'links') item.links = 2;
  if (kind === 'large') item.data = Buffer.alloc(4097);
  if (kind === 'foreign') item.data = Buffer.from('{}');
  if (kind === 'broken') item.data = Buffer.from('{');
  assert.throws(() => m.create()); assert.equal(m.files.size, 1);
}
{
  const m = model(), p = m.create(); m.put(temp, 'other writer'); assert.throws(() => p.save(2048));
  assert.equal(m.files.get(temp).data.toString(), 'other writer'); assert(!m.files.has(file));
}
{
  const m=model();m.put(file,JSON.stringify({owner:OWNER,percent:2.5}));const before=Buffer.from(m.files.get(file).data);
  assert.equal(m.create(42551783424).snapshot().ramMiB,1024);assert(m.create().snapshot().legacyConverted);assert(m.files.get(file).data.equals(before));
  const p=m.create();p.save(1024);assert.deepEqual(JSON.parse(m.files.get(file).data),{owner:OWNER,ramMiB:1024,previewQuality:'720p',forwardPredecode:true,wheelFrames:1,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false,playbackBackend:'proxy',proxyEncoder:'nvidia',decoderPreference:'prefer-hardware',autoProxy:true,gpuDrawing:true,gpuAcceleration:true});assert(!m.create().snapshot().legacyConverted);
}
{
  const m=model();m.put(file,JSON.stringify({owner:OWNER,ramMiB:1024,previewQuality:'1080p'}));
  const old=Buffer.from(m.files.get(file).data),p=m.create();assert.equal(p.forwardPredecode(),true);assert(m.files.get(file).data.equals(old));
  p.save(1024,'1080p',false);assert.equal(m.create().forwardPredecode(),true);p.save(2048);assert.equal(m.create().forwardPredecode(),true);
  assert.throws(()=>p.save(1024,'720p','yes'));m.io.failRename=true;assert.throws(()=>p.save(1024,'720p',true));assert.equal(p.forwardPredecode(),true);
  assert.equal(m.create().forwardPredecode(),true);m.put(file,JSON.stringify({owner:OWNER,ramMiB:1024,previewQuality:'1080p',forwardPredecode:'yes'}));assert.throws(()=>m.create());
}
{
  const m=model(); m.put(file,JSON.stringify({owner:OWNER,ramMiB:2048}));
  const before=Buffer.from(m.files.get(file).data), p=m.create(); assert.equal(p.quality(),'720p'); assert(m.files.get(file).data.equals(before));
  p.save(2048,'1080p'); assert.equal(m.create().quality(),'1080p'); p.save(1024); assert.equal(m.create().quality(),'1080p');
  assert.throws(()=>p.save(1024,'4K')); const saved=Buffer.from(m.files.get(file).data);
  m.io.failRename=true; assert.throws(()=>p.save(2048,'720p')); assert.equal(p.quality(),'1080p'); assert(m.files.get(file).data.equals(saved));
  m.io.failRename=false; m.put(temp,'interrupted write'); assert.throws(()=>m.create().save(1024,'720p')); assert.equal(m.create().quality(),'1080p');
}
{
  const m=model(),p=m.create();assert.deepEqual(p.interaction(),{wheelFrames:1,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false});
  p.save(1024,'1080p',true,{wheelFrames:5,showCacheStrip:false});const saved=Buffer.from(m.files.get(file).data);
  assert.deepEqual(m.create().interaction(),{wheelFrames:5,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false});p.save(2048);assert.deepEqual(m.create().interaction(),{wheelFrames:5,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false});
  for(const value of [0,3,1.5,11,NaN,'2'])assert.throws(()=>p.save(1024,'720p',true,{wheelFrames:value,showCacheStrip:false}));
  assert.throws(()=>p.save(1024,'720p',true,{wheelFrames:1,showCacheStrip:'no'}));
  const original=Buffer.from(m.files.get(file).data);m.io.failRename=true;assert.throws(()=>p.save(1024,'720p',true,{wheelFrames:2,showCacheStrip:false}));
  assert(m.files.get(file).data.equals(original));assert.deepEqual(p.interaction(),{wheelFrames:5,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false});assert(!m.files.has(temp));
  m.io.failRename=false;m.put(file,saved);m.put(temp,'interrupted settings');assert.throws(()=>m.create().save(1024));assert.deepEqual(m.create().interaction(),{wheelFrames:5,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false});
}
for(const extra of [{wheelFrames:3},{showCacheStrip:0},{rateStep:.3},{rateStep:'0.1'},{wheelFrames:2,unknown:true}]){
  const m=model();m.put(file,JSON.stringify({owner:OWNER,ramMiB:1024,previewQuality:'720p',forwardPredecode:true,...extra}));assert.throws(()=>m.create());
}
{
  const m=model(),legacy=Buffer.from(JSON.stringify({owner:OWNER,ramMiB:1024,previewQuality:'1080p',forwardPredecode:true,wheelFrames:2,showCacheStrip:false}));
  m.put(file,legacy);const p=m.create();assert.equal(p.interaction().rateStep,.1);assert(m.files.get(file).data.equals(legacy));
  for(const rateStep of [.1,.2,.25,.5]){p.save(1024,'1080p',true,{wheelFrames:2,showCacheStrip:false,rateStep});assert.equal(m.create().interaction().rateStep,rateStep);}
  const saved=Buffer.from(m.files.get(file).data);for(const rateStep of [0,-.1,.3,NaN,'0.25'])assert.throws(()=>p.save(1024,'1080p',true,{wheelFrames:2,showCacheStrip:false,rateStep}));
  assert(m.files.get(file).data.equals(saved));m.io.failRename=true;assert.throws(()=>p.save(1024,'1080p',true,{wheelFrames:2,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false,showProxyStrip:false}));
  assert.equal(p.interaction().rateStep,.5);assert(m.files.get(file).data.equals(saved));assert(!m.files.has(temp));
}
{
 const m=model();m.put(file,JSON.stringify({owner:OWNER,ramMiB:1024,previewQuality:'1080p'}));const before=Buffer.from(m.files.get(file).data);assert.equal(m.create().interaction().drawingFadeSeconds,.25);assert(m.files.get(file).data.equals(before));
 const p=m.create();for(const drawingFadeSeconds of [0,.05,.25,1]){p.save(1024,'1440p',true,{wheelFrames:1,showCacheStrip:false,rateStep:.1,drawingFadeSeconds});assert.equal(m.create().interaction().drawingFadeSeconds,drawingFadeSeconds);assert.equal(m.create().quality(),'1440p');}
 const saved=Buffer.from(m.files.get(file).data);for(const drawingFadeSeconds of [-1,1.01,NaN,'0'])assert.throws(()=>p.save(1024,'1440p',true,{drawingFadeSeconds}));assert(m.files.get(file).data.equals(saved));
}
console.log('Memory preference models: fixed tiers/limits/proportion, legacy read-only conversion, quality/predecode/wheel/strip persistence, atomic failure/concurrent/interrupted save, unsafe files and writer protection passed; no actual files written.');

{const m=model();m.put(file,JSON.stringify({owner:OWNER,ramMiB:1024,previewQuality:'720p',forwardPredecode:true,showCacheStrip:true}));const p=m.create();assert.equal(p.interaction().showCacheStrip,true);p.save(2048);assert.equal(m.create().interaction().showCacheStrip,true);}

{const m=model(),p=m.create();assert.equal(p.interaction().showProxyStrip,false);p.save(1024,'720p',true,{...p.interaction(),showProxyStrip:true});assert.equal(m.create().interaction().showProxyStrip,true);p.save(2048);assert.equal(m.create().interaction().showProxyStrip,true);const before=Buffer.from(m.files.get(file).data);m.io.failRename=true;assert.throws(()=>p.save(1024,'720p',true,{...p.interaction(),showProxyStrip:false}));assert(m.files.get(file).data.equals(before));assert.equal(m.create().interaction().showProxyStrip,true);}

{
 const m=model(),p=m.create();assert.equal(p.proxyEncoder(),'nvidia');assert.equal(p.decoderPreference(),'prefer-hardware');assert.equal(p.gpuAcceleration(),true);
 p.save(1024,undefined,undefined,undefined,undefined,'nvidia','prefer-software');
 assert.equal(m.create().proxyEncoder(),'nvidia');assert.equal(m.create().decoderPreference(),'prefer-hardware');
 p.save(2048);assert.equal(m.create().proxyEncoder(),'nvidia');
 const previous=Buffer.from(m.files.get(file).data);m.io.failRename=true;
 assert.throws(()=>p.save(1024,undefined,undefined,undefined,undefined,'cpu','no-preference'));assert(m.files.get(file).data.equals(previous));
 assert.equal(m.create().proxyEncoder(),'nvidia');m.io.failRename=false;
 assert.throws(()=>p.save(1024,undefined,undefined,undefined,undefined,'automatic'));assert.throws(()=>p.save(1024,undefined,undefined,undefined,undefined,'cpu','cuda'));
}


// E46 unified switch persists atomically; legacy per-stage inputs cannot split it.
{
 const m=model(),p=m.create(),save=(gpu)=>p.save(1024,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,gpu);
 save(false);assert.equal(m.create().gpuAcceleration(),false);assert.equal(m.create().gpuDrawing(),false);assert.equal(m.create().proxyEncoder(),'cpu');assert.equal(m.create().decoderPreference(),'prefer-software');
 const old=Buffer.from(m.files.get(file).data);m.io.failRename=true;assert.throws(()=>save(true));assert(m.files.get(file).data.equals(old));assert.equal(p.gpuAcceleration(),false);assert.equal(m.create().gpuAcceleration(),false);assert(!m.files.has(temp));
 m.io.failRename=false;save(true);assert.equal(m.create().gpuAcceleration(),true);assert.equal(m.create().proxyEncoder(),'nvidia');assert.equal(m.create().gpuDrawing(),true);
 p.save(2048,undefined,false,undefined,undefined,'cpu','prefer-software',false,false);assert.equal(m.create().gpuAcceleration(),true);assert.equal(m.create().decoderPreference(),'prefer-hardware');assert.equal(m.create().forwardPredecode(),true);assert.equal(m.create().automaticProxy(),true);
 for(const value of [null,0,'false'])assert.throws(()=>save(value));
}
