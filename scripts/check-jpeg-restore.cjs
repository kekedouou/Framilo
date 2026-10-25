'use strict';
// Explicit bounded E36 repair check. Synthetic source only; no Eagle library/UI.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {spawnSync}=require('child_process');
const {createMedia}=require('../plugin/media.cjs'),{createCache}=require('../plugin/cache.cjs');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'verification-runs/e36-jpeg-restore');
fs.mkdirSync(evidence,{recursive:true});
const old=fs.readdirSync(evidence).filter(n=>/^run-.*\.json$/.test(n));assert(old.length<2,'Run budget exhausted');
assert(fs.readdirSync(evidence).reduce((n,f)=>n+fs.statSync(path.join(evidence,f)).size,0)<512*1024,'Evidence budget exhausted');
const id=crypto.randomBytes(8).toString('hex'),scratch=path.join(evidence,'scratch-'+id);fs.mkdirSync(scratch);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const record={id,started:new Date().toISOString(),node:process.version,status:'running',limits:{rounds:2,scratchBytes:64*1024**2,seconds:120},checks:[],cleanup:[]};
const output=path.join(evidence,'run-'+id+'.json');
const config=JSON.parse(fs.readFileSync(path.join(root,'tests/host/t0/config.local.json')));
const tools={ffmpeg:config.ffmpeg,ffprobe:config.ffprobe};
record.sourceHashes=Object.fromEntries(['media.cjs','long-media.cjs','cache.cjs','cache-read-client.cjs','cache-read-worker.cjs'].map(n=>[n,sha(fs.readFileSync(path.join(root,'plugin',n)))]));
record.scriptSha256=sha(fs.readFileSync(__filename));
let safe=true;const began=Date.now(),controller=new AbortController();
const deadline=setTimeout(()=>controller.abort(),120000);
function files(dir){assert(path.resolve(dir).startsWith(scratch+path.sep)||dir===scratch);let result=[];for(const name of fs.readdirSync(dir)){const p=path.join(dir,name),s=fs.lstatSync(p);assert(!s.isSymbolicLink());if(s.isDirectory())result.push(...files(p));else {assert(s.isFile()&&s.nlink===1);result.push({path:p,bytes:s.size,sha256:sha(fs.readFileSync(p))});}}return result;}
async function main(){
 const source=path.join(scratch,'synthetic-45s.mp4');
 const generated=spawnSync(tools.ffmpeg,['-hide_banner','-nostdin','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=6:duration=45','-f','lavfi','-i','sine=frequency=431:sample_rate=48000:duration=45','-c:v','libx264','-threads','2','-preset','ultrafast','-bf','3','-c:a','aac','-movflags','+faststart',source],{windowsHide:true,timeout:30000,maxBuffer:1024**2});
 assert(!generated.error&&generated.status===0,String(generated.error||generated.stderr));
 const sourceSha=sha(fs.readFileSync(source)),cache=createCache({pluginRoot:scratch,packFrames:true,diskBytes:32*1024**2}),media=createMedia({tools,cache});
 const selected={id:'synthetic-jpeg-restore',filePath:source,ext:'mp4'};
 const info=await media.prepare(selected,{playbackBackend:'jpeg',previewQuality:'720p',signal:controller.signal});
 assert(!info.streaming);assert.equal(info.frames.length,270);assert(info.duration>=45);assert(info.audio);assert.equal(info.source.sha256,sourceSha);
 record.checks.push({name:'whole-jpeg-real-prepare',frames:info.frames.length,duration:info.duration,ms:info.metrics.preparationMs,reused:info.metrics.reused});
 for(const ordinal of [0,135,269]){const bytes=await cache.readAsset(info,info.frames[ordinal].file);assert.equal(sha(bytes),info.frames[ordinal].sha256);}
 await cache.release(info);
 const reused=await media.prepare(selected,{playbackBackend:'jpeg',previewQuality:'720p',signal:controller.signal});assert(reused.metrics.reused);assert.equal(reused.frames.length,270);await cache.release(reused);
 record.checks.push({name:'real-cache-read-first-middle-last-and-reopen',reused:true});
 const fresh=path.join(scratch,'cancel-case');fs.mkdirSync(fresh);const cancelledCache=createCache({pluginRoot:fresh,packFrames:true,diskBytes:32*1024**2}),cancelledMedia=createMedia({tools,cache:cancelledCache});
 const cancel=new AbortController();let observed=false;
 await assert.rejects(cancelledMedia.prepare(selected,{playbackBackend:'jpeg',previewQuality:'720p',signal:cancel.signal,onProgress:v=>{if(v.stage==='decode'){observed=true;cancel.abort();}}}),e=>e.name==='AbortError'||e.code==='MEDIA_CANCELLED');assert(observed);
 const next=await cancelledMedia.prepare(selected,{playbackBackend:'jpeg',previewQuality:'720p',signal:controller.signal});assert.equal(next.frames.length,270);await cancelledCache.release(next);
 for(const c of [cache,cancelledCache]){const inv=c.inventory();assert.equal(inv.leases.length,0);}
 assert(!files(scratch).some(f=>/partial-|writer.lock|lease-/.test(path.relative(scratch,f.path))));
 assert.equal(sha(fs.readFileSync(source)),sourceSha);assert(Date.now()-began<120000);assert(files(scratch).reduce((n,f)=>n+f.bytes,0)<64*1024**2);
 record.checks.push({name:'cancel-during-decode-reopen-and-zero-leases',passed:true});record.status='passed';
}
main().catch(e=>{safe=false;record.status='failed';record.error=e.stack;process.exitCode=1;}).finally(()=>{
 clearTimeout(deadline);record.finished=new Date().toISOString();record.elapsedMs=Date.now()-began;
 // media.prepare settles its own children before returning/rejecting. Preserve on uncertain reader closure.
 if(safe){try{record.cleanup=files(scratch).map(f=>({...f,path:path.relative(evidence,f.path)}));for(const f of record.cleanup){const p=path.resolve(evidence,f.path);assert(p.startsWith(scratch+path.sep));assert.equal(sha(fs.readFileSync(p)),f.sha256);fs.unlinkSync(p);}function dirs(p){for(const n of fs.readdirSync(p))dirs(path.join(p,n));fs.rmdirSync(p);}dirs(scratch);}catch(e){record.cleanupError=e.message;record.status='failed';process.exitCode=1;}}
 fs.writeFileSync(output,JSON.stringify(record,null,2));console.log(JSON.stringify({id,status:record.status,checks:record.checks,error:record.error,cleanupError:record.cleanupError}));
});
