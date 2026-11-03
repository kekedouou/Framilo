'use strict';
// Explicit E59 bounded check. Reuses synthetic sources, never opens Eagle or a library.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'verification-runs/e59');
const {createNativeBackend}=require('../plugin/native-backend.cjs'),{createTemporaryMedia}=require('../plugin/temporary-media.cjs');
const tool=n=>{const r=cp.spawnSync('where.exe',[n],{windowsHide:true,encoding:'utf8'});if(r.status)throw Error(n+' unavailable');return r.stdout.trim().split(/\r?\n/)[0];};
async function main(){
 fs.mkdirSync(out,{recursive:true});const label=process.argv[2];if(!/^(baseline|candidate)$/.test(label||''))throw Error('Expected baseline or candidate');
 const tools={ffmpeg:tool('ffmpeg'),ffprobe:tool('ffprobe')},id=Date.now(),dir=fs.mkdtempSync(path.join(out,label+'-')),rows=[],began=performance.now();
 const record={at:new Date().toISOString(),label,sourceCommit:cp.spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).stdout.trim(),scope:'native backend close/recreate; not Eagle renderer, real audio or GPU compositor',rows};
 const receipt=path.join(out,label+'-'+id+'.json');let totalChildren=0,live=new Set(),peak=0;
 const spawn=(exe,args,options)=>{const c=cp.spawn(exe,args,options);totalChildren++;live.add(c);peak=Math.max(peak,live.size);c.once('close',()=>live.delete(c));return c;};
 try{for(let n=0;n<12;n++){
  if(performance.now()-began>240000)throw Error('Four-minute per-run stop limit');
  const name=['h264.mp4','aac.mkv','hevc.mp4','opus.webm'][n%4],file=path.join(root,'verification-runs/e52/formats',name),sourceHash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),at=performance.now();
  const m=createTemporaryMedia({pluginRoot:dir,spawn});await m.ready;
  const b=createNativeBackend({pluginRoot:path.join(root,'plugin'),tools,cacheRoot:m.directory,temporaryMedia:m,ramBytes:512*1024**2,decoderPreference:n%2?'prefer-hardware':'prefer-software',proxyEncoder:'cpu',gpuDrawing:false});
  const row={n,name,sourceHash,readyMs:performance.now()-at,software:!(n%2)};rows.push(row);
  try{const info=await b.media.prepare({filePath:file},{previewQuality:'720p'}),r=await info.nativeRuntime.createReader();row.frames=[];
   for(const ordinal of [0,Math.floor(info.frames.length/2),info.frames.length-1]){const v=await r.request(ordinal);row.frames.push({ordinal,status:v.status,sha256:v.pixels?crypto.createHash('sha256').update(v.pixels).digest('hex'):null});if(v.status!=='exact')throw Error('Frame failed');}
   row.loadedMs=performance.now()-at;
  }catch(e){row.error=e.message;}
  finally{const start=performance.now();b.beginClose();try{await b.close();row.cleanup=await m.close();}catch(e){row.closeError=e.message;}row.closeMs=performance.now()-start;row.active=m.active();row.live=live.size;row.rss=process.memoryUsage().rss;row.remaining=fs.existsSync(m.directory);}
  row.sourceUnchanged=sourceHash===crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');record.elapsedMs=performance.now()-began;record.peakChildren=peak;record.totalChildren=totalChildren;fs.writeFileSync(receipt,JSON.stringify(record,null,2));console.log(JSON.stringify(row));
  if(row.error||row.closeError||row.active||row.live||row.remaining||!row.sourceUnchanged)throw Error('Cycle failed; evidence retained');
 }
 record.passed=true;
 }finally{record.elapsedMs=performance.now()-began;fs.writeFileSync(receipt,JSON.stringify(record,null,2));}
 // Only empty known containers. Unknown/nonempty failure artifacts remain for inspection.
 for(const rel of ['cache/sessions-v1','cache']){const d=path.join(dir,rel);if(fs.existsSync(d)&&fs.readdirSync(d).length===0)fs.rmdirSync(d);}
 if(fs.readdirSync(dir).length===0)fs.rmdirSync(dir);
 console.log('receipt: '+receipt);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
