'use strict';
const { test }=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const { createRequire }=require('module'),{EventEmitter}=require('events'),{PassThrough}=require('stream');
async function fixture(t,options={}){
 const root=path.resolve(__dirname,'../verification-runs/e44/native-backend-unit');await fs.promises.mkdir(root,{recursive:true});const dir=await fs.promises.mkdtemp(path.join(root,'case-'));
 t.after(()=>fs.promises.rm(dir,{recursive:true,force:true}));const pluginRoot=path.join(dir,'plugin');await fs.promises.mkdir(path.join(pluginRoot,'bin'),{recursive:true});await fs.promises.writeFile(path.join(pluginRoot,'bin/filmcraft-media.exe'),'fixture');
 const source=path.join(dir,'source.mp4');await fs.promises.writeFile(source,'readonly source fixture');
 const readers=[],jobs=[],factoryOptions=[],maintenanceOptions=[],clearCalls=[];let sourceProbes=0;
 class FakeReader{
  constructor(opts){this.options=opts;this.closed=0;readers.push(this);this.ready=options.holdOpen?new Promise((resolve,reject)=>{this.rejectOpen=reject;}):Promise.resolve(this);}
  async close(){if(this.closing)return this.closing;this.closed++;this.rejectOpen?.(Error('closed before ready'));this.closing=(async()=>{if(options.closeWait)await options.closeWait;return{exit:{code:0}};})();return this.closing;}
 }
 function producer(config){factoryOptions.push(config);return{start(spec){if(options.throwProxy)throw Error('proxy unsupported');let resolve;const job={spec,state:{status:'encoding',stage:'preparing'},ready:new Promise(r=>{resolve=r;}),snapshot(){return this.state;},async cancel(){this.state={status:'cancelled',stage:'cancelled'};resolve(null);return this.ready;},complete(value){this.state={status:'ready',stage:'complete'};resolve(value);}};jobs.push(job);return job;},async close(){await Promise.all(jobs.map(j=>j.cancel()));}};}
 function spawn(exe,args){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.kill=()=>{c.emit('close',null);};if(options.holdProbe)return c;setImmediate(()=>{
  const audio=args.includes('a:0');let data;
  if(audio){data={streams:[]};if(options.mutateDuringProbe)fs.writeFileSync(source,'changed source contents while probing');}
  else{sourceProbes++;data={streams:[{codec_type:'video',codec_name:'h264',width:options.videoWidth||1920,height:options.videoHeight||1080,time_base:'1/1000',duration_ts:50,start_pts:0,sample_aspect_ratio:'1:1',color_transfer:options.hdr?'smpte2084':'bt709'}],packets:[{pts:0,duration:17},{pts:33,duration:17},{pts:17,duration:16}]};}
  c.stdout.end(JSON.stringify(data));c.emit('close',0);
 });return c;}
 const filename=path.resolve(__dirname,'../plugin/native-backend.cjs'),realRequire=createRequire(filename),module={exports:{}};
 const requireStub=name=>name==='child_process'?{spawn}:name==='./native-reader.cjs'?{FilmcraftClient:FakeReader}:name==='./whole-proxy.cjs'?{createWholeProxy:producer}:name==='./task-client.cjs'?{createTaskClient(config){maintenanceOptions.push(config);return{cache:{async clearOther(settings){clearCalls.push(settings);if(options.clearWait)await options.clearWait;if(options.clearError)throw options.clearError;return{cleared:2,freedBytes:1024**2,occupiedProtected:1};}},async close(){}};}}:realRequire(name);
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:requireStub,module,exports:module.exports,Buffer,console,setTimeout,clearTimeout,process,AbortController},{filename});
 const backend=module.exports.createNativeBackend({pluginRoot,tools:{ffmpeg:path.join(dir,'ffmpeg'),ffprobe:path.join(dir,'ffprobe')},automaticProxy:false,ramBytes:1024**3,...options.backend});t.after(()=>backend.close());
 return{dir,pluginRoot,source,backend,readers,jobs,factoryOptions,maintenanceOptions,clearCalls,sourceProbes:()=>sourceProbes};
}
test('source identity spans frame/audio probe and hash',async t=>{
 const f=await fixture(t,{mutateDuringProbe:true});await assert.rejects(f.backend.media.prepare({id:'unit',filePath:f.source}),/建立帧索引期间发生变化/);assert.equal(f.readers.length,0);
});
test('proxy binds original ordinal to actual proxy PTS and preserves frame geometry',async t=>{
 const f=await fixture(t),info=await f.backend.media.prepare({id:'unit',filePath:f.source});assert.equal(info.width,1280);assert.equal(info.height,720);assert.equal(info.frames[1].ptsTicks,'17');
 const runtime=info.nativeRuntime,job=runtime.startProxy();assert.equal(job,f.jobs[0]);assert.equal(job.spec.video.color_transfer,'bt709');assert.equal(job.spec.frames,info.frames);assert.equal(job.spec.validationHardware,true);
 const asset={filePath:path.join(f.dir,'complete.mp4'),proxyPts:['0','17000','33000'],proxyTimeBase:[1,1000000]};job.complete(asset);await job.ready;await new Promise(r=>setImmediate(r));
 const reader=await runtime.createReader({proxy:true});assert.equal(reader.options.source,asset.filePath);assert.equal(reader.options.frames[1].ptsTicks,'17000');assert.equal(reader.options.frames[1].time,.017);assert.equal(reader.options.frames[1].id,1);assert.equal(reader.options.cacheBytes,192*1024**2);
 await runtime.release();assert.equal(reader.closed,1);
});
test('cancelled proxy can be started again; duplicate active start shares job',async t=>{
 const f=await fixture(t),info=await f.backend.media.prepare({id:'unit',filePath:f.source}),r=info.nativeRuntime;
 const first=r.startProxy();assert.equal(r.startProxy(),first);await r.cancelProxy();assert.equal(r.status().stage,'cancelled');const second=r.startProxy();assert.notEqual(second,first);assert.equal(f.jobs.length,2);await r.cancelProxy();
});
test('proxy validation respects software decode preference independently of the encoder',async t=>{
 const f=await fixture(t,{backend:{decoderPreference:'prefer-software',proxyEncoder:'nvidia'}});
 const first=await f.backend.media.prepare({id:'unit',filePath:f.source});
 const a=first.nativeRuntime.startProxy();assert.equal(a.spec.encoder,'nvidia');assert.equal(a.spec.validationHardware,false);await first.nativeRuntime.release();
 const second=await f.backend.media.prepare({id:'unit',filePath:f.source},{decoderPreference:'prefer-hardware',proxyEncoder:'cpu'});
 const b=second.nativeRuntime.startProxy();assert.equal(b.spec.encoder,'cpu');assert.equal(b.spec.validationHardware,true);await second.nativeRuntime.release();
});
test('unsupported automatic proxy leaves original reader usable',async t=>{
 const f=await fixture(t,{throwProxy:true,backend:{automaticProxy:true}}),info=await f.backend.media.prepare({id:'unit',filePath:f.source});assert.equal(info.nativeRuntime.status().stage,'error');assert.match(info.nativeRuntime.status().message,/unsupported/);const reader=await info.nativeRuntime.createReader();assert.equal(reader.options.source,f.source);
});
test('proxy quota is independent of legacy JPEG cache; prior files remain intact',async t=>{
 const f=await fixture(t),prior=path.join(f.pluginRoot,'cache','old','keep.txt');await fs.promises.mkdir(path.dirname(prior),{recursive:true});await fs.promises.writeFile(prior,'prior cache');
 assert.equal(f.factoryOptions[0].capacityRoot,path.join(f.pluginRoot,'cache/e44-whole'));assert.equal(f.factoryOptions[0].cacheRoot,path.join(f.pluginRoot,'cache/e44-whole'));await f.backend.close();assert.equal(await fs.promises.readFile(prior,'utf8'),'prior cache');
});
test('beginClose and close share reader cleanup; opening reader is already owned',async t=>{
 let release;const wait=new Promise(r=>{release=r;}),f=await fixture(t,{holdOpen:true,closeWait:wait}),info=await f.backend.media.prepare({id:'unit',filePath:f.source}),r=info.nativeRuntime;
 const opening=r.createReader().then(()=>assert.fail('must not open after close'),()=>{});assert.equal(f.readers.length,1);f.backend.beginClose();let done=false;const closing=f.backend.close().then(()=>{done=true;});await new Promise(r=>setImmediate(r));assert.equal(done,false);release();await closing;await opening;assert.equal(f.readers[0].closed,1);
});
test('closing during source inspection cancels the owned probe before returning',async t=>{
 const f=await fixture(t,{holdProbe:true}),preparing=f.backend.media.prepare({id:'unit',filePath:f.source});
 const rejected=assert.rejects(preparing,/准备已取消/);f.backend.beginClose();await f.backend.close();await rejected;assert.equal(f.readers.length,0);assert.equal(f.jobs.length,0);
});
test('native clear-other delegates to asynchronous guarded maintenance and independent whole quota',async t=>{
 const f=await fixture(t),info=await f.backend.media.prepare({id:'unit',filePath:f.source});
 await fs.promises.mkdir(path.join(f.pluginRoot,'cache'));await fs.promises.writeFile(path.join(f.pluginRoot,'cache/owner.json'),'legacy ownership fixture');
 const result=await f.backend.cache.clearOther({sourceSha256:info.source.sha256});assert.equal(result.status,'cleared');assert.equal(result.cleared,2);assert.equal(result.freedBytes,1024**2);assert.match(result.message,/占用中的缓存保留/);
 assert.equal(f.maintenanceOptions.length,1);assert.equal(f.maintenanceOptions[0].pluginRoot,f.pluginRoot);assert.equal(typeof f.maintenanceOptions[0].discoverTools,'function');assert.equal(f.clearCalls[0].independentWholeProxy,true);assert.equal(f.clearCalls[0].sourceSha256,info.source.sha256);
 await f.backend.cache.clearOther({sourceSha256:info.source.sha256});assert.equal(f.maintenanceOptions.length,1);assert.equal(f.clearCalls.length,2);
 assert.equal(await fs.promises.readFile(f.source,'utf8'),'readonly source fixture');
});
test('native-only cache without legacy ownership is not claimed or deleted',async t=>{
 const f=await fixture(t),info=await f.backend.media.prepare({id:'unit',filePath:f.source}),whole=path.join(f.pluginRoot,'cache/e44-whole/whole-v1');
 await fs.promises.mkdir(whole,{recursive:true});await fs.promises.writeFile(path.join(whole,'keep.lock'),'unknown active owner');
 const result=await f.backend.cache.clearOther({sourceSha256:info.source.sha256});assert.equal(result.status,'unchanged');assert.equal(result.freedBytes,0);assert.equal(f.maintenanceOptions.length,0);assert.equal(await fs.promises.readFile(path.join(whole,'keep.lock'),'utf8'),'unknown active owner');
 assert.equal(fs.existsSync(path.join(f.pluginRoot,'cache/owner.json')),false);
});
test('cleanup refuses mismatched or released source ownership and preserves legacy busy errors',async t=>{
 const failure=Object.assign(Error('unknown writer remains protected'),{code:'CACHE_BUSY'}),f=await fixture(t,{clearError:failure}),info=await f.backend.media.prepare({id:'unit',filePath:f.source});
 await assert.rejects(f.backend.cache.clearOther({sourceSha256:'f'.repeat(64)}),e=>e.code==='CACHE_CLEAN_BUSY');assert.equal(f.clearCalls.length,0);
 await fs.promises.mkdir(path.join(f.pluginRoot,'cache'));await fs.promises.writeFile(path.join(f.pluginRoot,'cache/owner.json'),'legacy ownership fixture');
 await assert.rejects(f.backend.cache.clearOther({sourceSha256:info.source.sha256}),e=>e===failure);await info.nativeRuntime.release();
 await assert.rejects(f.backend.cache.clearOther({sourceSha256:info.source.sha256}),e=>e.code==='CACHE_CLEAN_BUSY');assert.equal(f.clearCalls.length,1);
});

test('odd fitted geometry remains the display/reader geometry while proxy encodes independently',async t=>{
 const f=await fixture(t,{videoWidth:2560,videoHeight:1379}),info=await f.backend.media.prepare({id:'odd',filePath:f.source}),r=info.nativeRuntime;assert.equal(info.width,1280);assert.equal(info.height,689);const job=r.startProxy();assert.equal(job.spec.height,689);job.complete({filePath:path.join(f.dir,'proxy.mp4'),proxyPts:['0','17000','33000'],proxyTimeBase:[1,1000000],width:1280,height:690,sampleAspectRatio:'690:689'});await job.ready;await new Promise(resolve=>setImmediate(resolve));const reader=await r.createReader({proxy:true});assert.equal(reader.options.width,1280);assert.equal(reader.options.outputHeight,689);
});
test('asynchronous clear yields to input and close waits for the owned cleanup',async t=>{
 let done;const gate=new Promise(resolve=>{done=resolve;}),f=await fixture(t,{clearWait:gate}),info=await f.backend.media.prepare({id:'unit',filePath:f.source});await fs.promises.mkdir(path.join(f.pluginRoot,'cache'));await fs.promises.writeFile(path.join(f.pluginRoot,'cache/owner.json'),'fixture');let finished=false;const pending=f.backend.cache.clearOther({sourceSha256:info.source.sha256}).then(()=>{finished=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);let closed=false;const closing=f.backend.close().then(()=>{closed=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,false);done();await pending;await closing;assert.equal(finished,true);assert.equal(f.clearCalls.length,1);
});
