'use strict';
// Explicit, bounded E36 startup regression. No Eagle/library writes.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e36-startup-lifecycle');
fs.mkdirSync(base,{recursive:true});assert(fs.readdirSync(base).filter(n=>/^run-.*\.json$/.test(n)).length<4,'Budget exhausted');
const id=crypto.randomBytes(8).toString('hex'),scratch=path.join(base,'scratch-'+id);fs.mkdirSync(scratch);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const report={id,node:process.version,started:new Date().toISOString(),status:'running',events:[],inputs:[]};
const log=(event,data={})=>{report.events.push({ms:Date.now()-started,event,...data});console.log(event,JSON.stringify(data));};
const started=Date.now(),config=JSON.parse(fs.readFileSync(path.join(root,'tests/host/t0/config.local.json'))),tools={ffmpeg:config.ffmpeg,ffprobe:config.ffprobe};
let client,info,safe=false;const abort=new AbortController();
const timer=setTimeout(()=>{abort.abort();client?.cache.cancelReads(info);},180000);
async function main(){
 const worker=path.join(scratch,'worker');fs.mkdirSync(worker);
 for(const file of require('./package-release.cjs').RUNTIME){const b=fs.readFileSync(path.join(root,'plugin',file)),p=path.join(worker,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b,{flag:'wx'});report.inputs.push({file,sha256:sha(b)});}
 const source=path.join(scratch,'synthetic.mp4');
 const gen=spawnSync(tools.ffmpeg,['-hide_banner','-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=6:duration=45','-f','lavfi','-i','sine=frequency=431:sample_rate=48000:duration=45','-c:v','libx264','-threads','2','-preset','ultrafast','-bf','3','-c:a','aac',source],{windowsHide:true,timeout:30000,maxBuffer:1024**2});
 assert(!gen.error&&gen.status===0,String(gen.error||gen.stderr));const hash=sha(fs.readFileSync(source));
 // Select the actual embedded-renderer compatibility branch; runtime remains
 // real Node/Eagle Node, not an emulation of Eagle's DOM or native decoder.
 const oldType=process.type;process.type='renderer';
 try {client=require('../plugin/task-client.cjs').createTaskClient({pluginRoot:worker,runtime:process.env.EVA_TEST_RUNTIME||process.execPath,discoverTools:async()=>tools,onFailure:e=>log('fatal',{code:e.code,message:e.message})});}finally{if(oldType===undefined)delete process.type;else process.type=oldType;}
 const selected={id:'startup-synthetic',filePath:source,ext:'mp4'};
 log('guard-runtime',await client.ping());
 info=await client.media.prepare(selected,{playbackBackend:'proxy',previewQuality:'720p',signal:abort.signal});log('proxy-index',{frames:info.frames.length});
 if(process.argv.includes('--browser')){
  report.browser=await require('../tests/support/startup-browser.cjs').check({root,scratch,client,info});assert.equal(report.browser.status,'passed',report.browser.error);assert(report.browser.safeToClean);
  log('browser-cold-play-seek-close',{cases:report.browser.cases});await client.cache.release(info);info=await client.media.prepare(selected,{playbackBackend:'proxy',previewQuality:'720p',signal:abort.signal});
 }
 client.cache.prioritizeRecords(info,{all:[0,90,180,269],visible:[0,90]});
 client.cache.target(info,0);
 const record=client.cache.readRecordFrame(info,180,{priority:'idle'}).then(v=>log('record',{bytes:v.bytes.length}),e=>log('record-preempted',{code:e.code,message:e.message}));
 const first=await client.cache.readAsset(info,info.frames[0].file);assert(first.length);log('first-frame',{bytes:first.length});await record;
 client.cache.prefetch(info,20,null);client.cache.target(info,0);
 assert((await client.cache.readAudioSegment(info,11))?.bytes.length);log('real-cancelled-prefetch-new-pcm');
 // Exercise obsolete reads sharing a preparation with the returning target.
 const pending=[];
 for(const n of [250,120,15,220,0]){client.cache.target(info,info.frames[n].time);pending.push(client.cache.readAsset(info,info.frames[n].file).then(b=>({n,bytes:b.length}),e=>({n,code:e.code,error:e.message})));await new Promise(r=>setTimeout(r,15));}
 const seeks=await Promise.all(pending);log('rapid-seeks',{seeks});assert(seeks.at(-1).bytes);
 client.cache.prefetch(info,0,null);assert(await client.cache.readAudioSegment(info,0));log('audio-first');
 await client.cache.release(info);info=null;log('proxy-released');
 const stop=new AbortController();
 await assert.rejects(client.media.prepare(selected,{playbackBackend:'jpeg',previewQuality:'720p',signal:stop.signal,onProgress:p=>{if(p.stage==='decode')stop.abort();}}),e=>e.code==='MEDIA_CANCELLED'||e.name==='AbortError');log('jpeg-cancelled');
 info=await client.media.prepare(selected,{playbackBackend:'jpeg',previewQuality:'720p',signal:abort.signal});assert(!info.streaming);assert.equal(info.frames.length,270);assert((await client.cache.readAsset(info,info.frames[269].file)).length);log('jpeg-reopened');
 await client.cache.release(info);info=null;
 info=await client.media.prepare(selected,{playbackBackend:'proxy',previewQuality:'720p',signal:abort.signal});assert((await client.cache.readAsset(info,info.frames[0].file)).length);log('proxy-reopened');
 await client.cache.release(info);info=null;await client.close();safe=true;assert.equal(sha(fs.readFileSync(source)),hash);assert(Date.now()-started<180000);report.status='passed';
}
function files(dir){assert(dir===scratch||dir.startsWith(scratch+path.sep));let out=[];for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p);assert(!s.isSymbolicLink());if(s.isDirectory())out.push(...files(p));else{assert(s.isFile()&&s.nlink===1);out.push({path:path.relative(scratch,p),bytes:s.size,sha256:sha(fs.readFileSync(p))});}}return out;}
main().catch(async e=>{report.status='failed';report.error=e.stack;process.exitCode=1;try{if(info){client.cache.cancelReads(info);await client.cache.release(info);}if(client)await client.close();log('failure-closed');}catch(e){report.closeError=e.stack;}}).finally(()=>{
 clearTimeout(timer);report.elapsedMs=Date.now()-started;report.scriptSha256=sha(fs.readFileSync(__filename));
 if(safe){try{const list=files(scratch);assert(list.reduce((n,f)=>n+f.bytes,0)<256*1024**2);report.cleanup=list;for(const f of list){const p=path.resolve(scratch,f.path);assert(p.startsWith(scratch+path.sep));assert.equal(sha(fs.readFileSync(p)),f.sha256);fs.unlinkSync(p);}const dirs=p=>{for(const n of fs.readdirSync(p))dirs(path.join(p,n));fs.rmdirSync(p);};dirs(scratch);}catch(e){report.cleanupError=e.stack;report.status='failed';process.exitCode=1;}}
 fs.writeFileSync(path.join(base,'run-'+id+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({id,status:report.status,error:report.error,closeError:report.closeError}));
});
