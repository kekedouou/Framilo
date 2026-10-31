'use strict';
// Explicit E43 owned-cache media check. Never loads Eagle or writes its library.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e43');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const label=process.argv[2];assert(/^[a-z0-9-]{1,30}$/.test(label||''));
 const profile=JSON.parse(fs.readFileSync(path.join(root,'verification-runs/e42/profile.json')));
 assert.equal(hash(fs.readFileSync(profile.source)),profile.sourceHash);
 for(const [k,f]of Object.entries(profile.tools))assert.equal(hash(fs.readFileSync(f)),profile.toolHashes[k]);
 const output=path.join(base,'runtime-'+label+'.json'),scratch=path.join(base,'runtime-'+label);assert(!fs.existsSync(output)&&!fs.existsSync(scratch));fs.mkdirSync(scratch);
 const worker=path.join(scratch,'plugin');fs.mkdirSync(worker);
 const record={status:'running',at:new Date().toISOString(),scope:'real guarded producer/cache/read; no Eagle acceptance',sourceHash:profile.sourceHash,runtime:{},rounds:[]};
 for(const f of require('./package-release.cjs').RUNTIME){const dest=path.join(worker,f),bytes=fs.readFileSync(path.join(root,'plugin',f));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx'});record.runtime[f]=hash(bytes);}
 const save=()=>fs.writeFileSync(output,JSON.stringify(record,null,2));save();
 let safe=true;
 for(let round=0;round<2;round++){
  const row={round,reads:[]};record.rounds.push(row);let client,info;const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),90000);
  const began=performance.now();
  try{
   client=require(path.join(worker,'task-client.cjs')).createTaskClient({pluginRoot:worker,discoverTools:async()=>profile.tools,onFailure:e=>{row.ownerError=e.message;controller.abort();}});
   info=await client.media.prepare({id:'e43-read-only',filePath:profile.source,ext:'mp4'},{playbackBackend:'proxy',proxyEncoder:'cpu',previewQuality:'720p',signal:controller.signal});row.prepareMs=performance.now()-began;
   // The real first accurate segment unlocks background sparse production.
   await client.cache.readAsset(info,info.frames[0].file);
   for(const time of (process.argv.includes('--whole')?[0,4,10,30,60,76]:[0,4,10])){
    let frame;const start=performance.now();
    while(!(frame=client.cache.findScrubFrame(info,time))){assert(!controller.signal.aborted,'deadline');row.progress=client.cache.scrubStatus(info);save();assert(!row.progress?.error,row.progress?.error);assert(performance.now()-start<30000,'preview coverage deadline');await wait(50);}
    const readAt=performance.now(),bytes=await client.cache.readScrubFrame(info,frame);
    assert.equal(bytes[0],255);assert.equal(bytes[1],216);assert.equal(frame.width,480);assert.equal(frame.height,270);assert(Math.abs(frame.time-time)<=.15);
    row.reads.push({target:time,sourceTime:frame.time,id:frame.id,coverageWaitMs:readAt-start,readMs:performance.now()-readAt,bytes:bytes.length});
   }
   if(process.argv.includes('--whole')){const end=performance.now()+30000;while(client.cache.scrubStatus(info)?.stage!=='complete'||client.cache.backgroundStatus(info)?.ready<2){assert(performance.now()<end,'continuous completion/resume deadline');assert(!client.cache.scrubStatus(info)?.error);await wait(50);}}
   row.progress=client.cache.scrubStatus(info);row.mainProgress=client.cache.backgroundStatus(info);
  }catch(e){row.error={message:e.message,code:e.code};record.status='failed';}
  finally{clearTimeout(deadline);try{const began=performance.now();if(info)await client.cache.release(info);await client?.close();row.closeMs=performance.now()-began;}catch(e){row.closeError=e.message;safe=false;}save();}
  if(row.error||!safe)break;
 }
 // Only our closed isolated copy is removed, after non-link identity/hash checks.
 if(safe){const files=[],dirs=[];function walk(dir){assert(dir===scratch||dir.startsWith(scratch+path.sep));assert(!fs.lstatSync(dir).isSymbolicLink());for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,entry.name),st=fs.lstatSync(f);assert(!st.isSymbolicLink());if(st.isDirectory())walk(f);else files.push({file:f,bytes:st.size,ino:st.ino,hash:hash(fs.readFileSync(f))});}dirs.push(dir);}walk(scratch);
  record.cleanup={bytes:files.reduce((n,f)=>n+f.bytes,0),files:files.map(f=>({path:path.relative(base,f.file),bytes:f.bytes,sha256:f.hash}))};save();
  assert(record.cleanup.bytes<384*1024**2,'owned runtime disk budget');for(const f of files){const st=fs.lstatSync(f.file);assert(!st.isSymbolicLink()&&st.ino===f.ino&&st.size===f.bytes&&hash(fs.readFileSync(f.file))===f.hash);fs.unlinkSync(f.file);}for(const d of dirs)fs.rmdirSync(d);record.cleanup.completed=true;
 }
 assert.equal(hash(fs.readFileSync(profile.source)),profile.sourceHash);
 if(record.status!=='failed'&&safe)record.status='completed';save();console.log(JSON.stringify({status:record.status,rounds:record.rounds,bytes:record.cleanup?.bytes},null,2));assert.equal(record.status,'completed');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
