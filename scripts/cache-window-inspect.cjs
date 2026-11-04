'use strict';
// Bounded read-only source probe; no media generation or library writes.
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const {inspect}=require('../plugin/native-backend.cjs'),{FilmcraftClient}=require('../plugin/native-reader.cjs');
const locate=n=>execFileSync('where.exe',[n],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
async function main(){const report={at:new Date().toISOString(),scope:'source metadata and exact native requests; no Eagle/render/audio',rows:[]};
for(const [name,file] of [['绮梦录','G:/Assets/Eagle/库/设计素材.library/images/MULA9DOZYR0SI.info/绮梦录.mp4'],['雷霆之锤','G:/Assets/Eagle/库/设计素材.library/images/MV3FZ0Z86KYBH.info/雷霆之锤.mp4']]){
 const probe=JSON.parse(execFileSync(locate('ffprobe'),['-v','error','-select_streams','v:0','-show_streams','-show_entries','packet=pts_time,flags','-of','json',file],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024**2}));
 const keys=probe.packets.filter(p=>p.flags.includes('K')).map(p=>Number(p.pts_time)),gaps=keys.slice(1).map((v,i)=>v-keys[i]);
 const info=await inspect({filePath:file}, {ffprobe:locate('ffprobe')},'2160p');
 for(const software of process.argv.includes('--completion-only')?[true]:[false,true]){const row={name,software,source:info.source,stream:probe.streams[0],keyframes:keys.length,maxKeyGap:Math.max(...gaps),meanKeyGap:gaps.reduce((a,b)=>a+b,0)/gaps.length,requests:[]};report.rows.push(row);
 const r=new FilmcraftClient({exe:path.resolve('plugin/bin/filmcraft-media.exe'),source:file,frames:info.frames,software,height:2160,width:info.width,outputHeight:info.height,gpuDrawing:true,cacheBytes:192*1024**2});
 try{await r.ready;const mid=Math.floor(info.frames.length/2);for(const n of process.argv.includes('--completion-only')?[mid]:[0,mid,mid+1,mid+2,mid+1,mid,mid-1]){const v=await r.request(n,{timeoutMs:process.argv.includes('--completion-only')?60000:10000});row.requests.push({n,status:v.status,ms:v.ms,actualTicks:v.actualTicks,targetTicks:v.targetTicks,error:v.error,metrics:v.metrics});}}finally{row.close=await r.close();}
 }
}
require('./seek-reuse-compare.cjs').save(report,'sources');for(const r of report.rows)console.log(JSON.stringify({name:r.name,software:r.software,codec:r.stream.codec_name,profile:r.stream.profile,size:[r.stream.width,r.stream.height],fps:r.stream.avg_frame_rate,maxKeyGap:r.maxKeyGap,requests:r.requests.map(v=>({n:v.n,status:v.status,ms:v.ms,decoded:v.metrics?.decoded,seeks:v.metrics?.seeks,decodeMs:v.metrics?.decodeMs,convertMs:v.metrics?.convertMs}))}));}
main().catch(e=>{console.error(e);process.exitCode=1;});
