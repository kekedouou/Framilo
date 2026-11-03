'use strict';
// Existing files only. Native/Node stage costs, not Electron display latency.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'verification-runs/e60');
const profile=JSON.parse(fs.readFileSync(path.join(root,'verification-runs/e44/profile.json')));
const {inspect}=require('../plugin/native-backend.cjs'),{FilmcraftClient}=require('../plugin/native-reader.cjs'),{createAudioTrack}=require('../plugin/native-audio.cjs');
global.EVAPlaybackCommon=require('../plugin/playback-common.js');global.ImageData=class{constructor(data,width,height){Object.assign(this,{data,width,height});}};
const {Player}=require('../plugin/native-player.js'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const result={at:new Date().toISOString(),sourceCommit:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),scope:'Real source/index/hash/native frames/audio copy; simulated ready audio and canvas, no Eagle/proxy/physical rendering',rows:[]};
async function main(){
 for(const [name,file,quality]of [['synthetic-h264',path.join(root,'verification-runs/e52/formats/h264.mp4'),'1080p'],['thor',profile.source,'2160p']]){
  const row={name,quality,phases:[],children:[]},start=performance.now();result.rows.push(row);let reader,audioTask,player,firstFrame=null;
  const spawn=(exe,args,opts)=>{const at=performance.now(),child=cp.spawn(exe,args,opts),record={tool:path.basename(exe),startMs:at-start};row.children.push(record);child.on('close',(code,signal)=>Object.assign(record,{endMs:performance.now()-start,code,signal}));return child;};
  const stat=fs.statSync(file);row.sourceBytes=stat.size;
  try{
   const info=await inspect({filePath:file},profile.tools,quality,null,v=>row.phases.push({stage:v.stage,atMs:performance.now()-start}),spawn);row.sourceHash=info.source.sha256;row.inspectMs=performance.now()-start;
   const runtime={nativeBytes:128*1024**2,async createReader(){reader=await FilmcraftClient.create({spawnProcess:spawn,exe:path.join(root,'plugin/bin/filmcraft-media.exe'),source:file,frames:info.frames,software:false,height:parseInt(quality),width:info.width,outputHeight:info.height,gpuDrawing:false,cacheBytes:128*1024**2});row.readerReadyMs=performance.now()-start;return reader;},closeReader:r=>r.close(),cancelReaders:()=>reader?.close(),subscribeProxy:()=>()=>{},proxyAsset:()=>null,cancelAudio:()=>audioTask?.cancel(),async audioTrack(maxBytes){row.audioStartMs=performance.now()-start;audioTask=createAudioTrack({spawn,source:info.source,tools:profile.tools,maxBytes,expectedStamp:info.source.nativeStamp});try{return await audioTask.promise;}finally{row.audioEndMs=performance.now()-start;}}};
   const a={currentTime:0,readyState:2,paused:true,load(){},pause(){},removeAttribute(){}};
   const canvas={style:{},getContext:()=>({putImageData:im=>{if(firstFrame===null){firstFrame=performance.now()-start;row.frameHash=sha(im.data);}}})};
   player=new Player({nativeRuntime:runtime,frameIndex:require('../plugin/frame-index.cjs'),canvas,ramBytes:1024**3,forwardPredecode:false,createAudio:()=>a});
   await player.load(info);row.firstFrameMs=firstFrame;row.readyMs=performance.now()-start;row.audioKind=player.audioSourceKind;row.audioIssue=player.audioSourceIssue;assert(firstFrame!==null);
  }finally{await player?.dispose();if(reader)row.close=await reader.close();await audioTask?.cancel();assert.equal(fs.statSync(file).mtimeMs,stat.mtimeMs);assert.equal(fs.statSync(file).size,stat.size);row.endMs=performance.now()-start;}
 }
 result.passed=true;
}
main().catch(e=>{result.error=e.stack;process.exitCode=1;}).finally(()=>{const file=path.join(out,'startup-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({file,...result}));});
