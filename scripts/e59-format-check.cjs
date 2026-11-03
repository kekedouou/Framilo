'use strict';
// Explicit read-only E59 compatibility regression; existing synthetic samples only.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const {inspect}=require('../plugin/native-backend.cjs'),{FilmcraftClient}=require('../plugin/native-reader.cjs'),{createAudioTrack}=require('../plugin/native-audio.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'verification-runs/e59'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const tool=n=>{const r=cp.spawnSync('where.exe',[n],{windowsHide:true,encoding:'utf8'});if(r.status)throw Error(n+' unavailable');return r.stdout.trim().split(/\r?\n/)[0];};
async function main(){
 const tools={ffmpeg:tool('ffmpeg'),ffprobe:tool('ffprobe')},began=performance.now(),rows=[],receipt=path.join(out,'formats-'+Date.now()+'.json');
 const names=['h264.mp4','alias.m4v','hevc.mp4','av1-aom.mp4','h264.mov','prores-hd.mov','pcm.mov','aac.mkv','hevc.mkv','offset.mkv','vfr.mkv','vp8.webm','opus.webm','silent.webm','uhd709.mp4','hfr709.mp4','prores.mov'];
 for(const name of names){
  if(performance.now()-began>240000)throw Error('Four-minute stop limit');
  const file=path.join(root,'verification-runs/e52/formats',name),sourceHash=sha(fs.readFileSync(file)),row={name,sourceHash,modes:[]};rows.push(row);
  try{
   const info=await inspect({filePath:file},tools,name==='uhd709.mp4'?'2160p':'720p');row.frames=info.frames.length;row.audio=info.audio;
   if(info.audio&&!/\.(mkv|webm)$/.test(name)&&!/^pcm_/.test(info.audio.codec)){
    try{row.audioCopy=(await createAudioTrack({source:info.source,tools,maxBytes:1024**2,expectedStamp:info.source.nativeStamp}).promise).verification;}
    catch(e){row.audioFallback={code:e.code,message:e.message};}
   }
   const ordinals=[0,Math.floor(info.frames.length/2),info.frames.length-1],refs=new Map();
   for(const software of [true,false]){
    const reader=new FilmcraftClient({exe:path.join(root,'plugin/bin/filmcraft-media.exe'),source:file,frames:info.frames,software,height:parseInt(info.preview.quality),width:info.width,outputHeight:info.height,gpuDrawing:false,cacheBytes:128*1024**2}),mode={software,frames:[]};row.modes.push(mode);
    try{await reader.ready;for(const ordinal of ordinals){const v=await reader.request(ordinal);if(v.status!=='exact')throw Error('Frame '+ordinal+': '+v.status);const hash=sha(v.pixels);let mae=null;
     if(software){
      const ref=cp.spawnSync(tools.ffmpeg,['-v','error','-i',file,'-vf','select=eq(n\\,'+ordinal+'),scale='+info.width+':'+info.height+':flags=bilinear','-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1'],{windowsHide:true,timeout:15000,maxBuffer:40*1024**2});
      if(ref.status||ref.stdout.length!==v.pixels.length)throw Error('Independent reference failed');
      let sum=0;for(let i=0;i<v.pixels.length;i++)sum+=Math.abs(v.pixels[i]-ref.stdout[i]);mae=sum/v.pixels.length;if(mae>=4)throw Error('Reference color mismatch '+mae);refs.set(ordinal,hash);
     }else if(refs.get(ordinal)!==hash)throw Error('CPU/GPU pixel mismatch');
     mode.frames.push({ordinal,hash,mae,hwFrames:v.metrics.hwFrames,hwFallbacks:v.metrics.hwFallbacks});
    }}finally{mode.close=await reader.close();}
   }
   row.passed=true;
  }catch(e){row.error={code:e.code,message:e.message};row.expectedRejection=name==='prores.mov'&&e.code==='MEDIA_COLOR_UNVERIFIED';}
  row.sourceUnchanged=sourceHash===sha(fs.readFileSync(file));
  fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),elapsedMs:performance.now()-began,scope:'synthetic native CPU/GPU frames and copied audio; not Eagle playback/listening',rows},null,2));
  console.log(JSON.stringify({name,passed:row.passed,expectedRejection:row.expectedRejection,error:row.error}));
 }
 if(rows.some(r=>(!r.passed&&!r.expectedRejection)||!r.sourceUnchanged))process.exitCode=1;console.log(receipt);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
