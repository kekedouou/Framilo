'use strict';
// Explicit E55 check: existing owned synthetic samples, read-only executables.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {spawnSync}=require('child_process'),root=path.resolve(__dirname,'..'),out=path.join(root,'verification-runs/e55');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function binary(n){const r=spawnSync('where.exe',[n],{windowsHide:true,encoding:'utf8'});assert.equal(r.status,0);return r.stdout.trim().split(/\r?\n/)[0];}
const tools={ffmpeg:binary('ffmpeg'),ffprobe:binary('ffprobe')};
// After promotion, pass the restored 14edb4e executable as argv[2]. Never
// silently compare the promoted executable against itself as the baseline.
const programs=[['baseline',process.argv[2]||'plugin/bin/filmcraft-media.exe'],['stripped','verification-runs/e55/filmcraft-media-stripped.exe'],['thin','verification-runs/e55/thin/filmcraft-media.exe']].map(([name,p])=>{const exe=path.resolve(root,p);return {name,exe,sha256:sha(fs.readFileSync(exe))};});
assert.equal(programs[0].sha256,'cd8cc84baf1098e391e37f1c455d0c084512e4bd5ccdded8b8fdef449b62148a','E55 baseline must be restored from 14edb4e; supply its executable path explicitly after promotion');
const report={at:new Date().toISOString(),scope:'E55 independent native pixel/PTS and bounded timing comparison; not Eagle, physical presentation or long stability',programs,rows:[]};
const target=path.join(out,'native-compare-'+Date.now()+'.json');assert(!fs.existsSync(target));
const save=()=>fs.writeFileSync(target,JSON.stringify(report,null,2));
const {FilmcraftClient}=require('../plugin/native-reader.cjs'),{inspect}=require('../plugin/native-backend.cjs');
async function read(program,file,info,software,quality,ordinals){
 const began=performance.now(),row={program:program.name,software,quality,frames:[]};let r;
 try {
  r=new FilmcraftClient({exe:program.exe,source:file,frames:info.frames,software,height:quality==='2160p'?2160:720,width:info.width,outputHeight:info.height,gpuDrawing:false,cacheBytes:128*1024**2});
  await r.ready;row.openMs=performance.now()-began;
  for(const ordinal of ordinals){const t=performance.now(),v=await r.request(ordinal);assert.equal(v.status,'exact');assert.equal(v.pixels.length,info.width*info.height*4);
   row.frames.push({ordinal,sha256:sha(v.pixels),ms:performance.now()-t,hwFrames:v.metrics?.hwFrames,hwFallbacks:v.metrics?.hwFallbacks});}
 } finally {if(r)row.close=await r.close();}
 row.elapsedMs=performance.now()-began;assert(row.close.ack);return row;
}
async function main(){
 const names=['h264.mp4','alias.m4v','hevc.mp4','av1-aom.mp4','h264.mov','prores-hd.mov','aac.mkv','hevc.mkv','offset.mkv','vfr.mkv','vp8.webm','opus.webm','silent.webm','hfr709.mp4','uhd709.mp4'];
 for(const name of names){const file=path.join(root,'verification-runs/e52/formats',name);assert(fs.statSync(file).size<32*1024**2);const sourceSha=sha(fs.readFileSync(file));
  const quality=name==='uhd709.mp4'?'2160p':'720p',info=await inspect({filePath:file},tools,quality);
  for(const software of name==='h264.mp4'||name==='uhd709.mp4'?[true,false]:[true]){
   const entry={name,sourceSha,quality,software,runs:[]};report.rows.push(entry);
   for(const p of programs){const result=await read(p,file,info,software,quality,[0,Math.floor(info.frames.length/2),info.frames.length-1,3,3]);entry.runs.push(result);save();}
   const reference=entry.runs[0].frames.map(f=>f.sha256);for(const r of entry.runs.slice(1))assert.deepEqual(r.frames.map(f=>f.sha256),reference,'Pixels changed: '+name+' '+r.program);
   entry.pixelsEqual=true;save();console.log(JSON.stringify({name,software,pixelsEqual:true,ms:entry.runs.map(r=>[r.program,Math.round(r.elapsedMs)])}));
  }assert.equal(sha(fs.readFileSync(file)),sourceSha);
  if(Date.now()-Date.parse(report.at)>9*60*1000)throw Error('E55 comparison time budget reached');
 }
 // Same-target repeated rounds with rotated process order reduce first-run bias.
 report.timing=[];
 for(const name of ['h264.mp4','uhd709.mp4']){const file=path.join(root,'verification-runs/e52/formats',name),quality=name.startsWith('uhd')?'2160p':'720p',info=await inspect({filePath:file},tools,quality);
  for(let round=0;round<3;round++)for(let step=0;step<programs.length;step++){const p=programs[(round+step)%programs.length];report.timing.push({name,round,...await read(p,file,info,true,quality,[0,3,8,1,12,2,3,3])});save();}}
 report.passed=report.rows.length===17&&report.rows.every(r=>r.pixelsEqual);report.completed=new Date().toISOString();save();console.log(JSON.stringify({file:path.relative(root,target),cases:report.rows.length,passed:report.passed}));
}
main().catch(error=>{report.failure=String(error.stack);save();console.error(error);process.exitCode=1;});
