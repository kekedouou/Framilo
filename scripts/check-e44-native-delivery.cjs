'use strict';
// Native executable + pixel equivalence, not Eagle/WebGL acceptance.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {FilmcraftClient}=require('../plugin/native-reader.cjs');
const {toRGBA}=require('../plugin/native-renderer.js');
const root=path.resolve(__dirname,'../verification-runs/e44'),profile=JSON.parse(fs.readFileSync(path.join(root,'profile.json')));
const info=JSON.parse(fs.readFileSync(path.join(root,'experience/prepare.json'))),exe=path.resolve(__dirname,'../plugin/bin/filmcraft-media.exe');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function main(){
 if(sha(profile.source)!==profile.sourceHash||info.source.sha256!==profile.sourceHash)throw Error('Fixed source identity changed');
 const record={created:new Date().toISOString(),scope:'real native executable and CPU pixel conversion; no Eagle or actual WebGL',performance:'correctness and teardown checks only; concurrent code checks permitted; timings excluded from performance comparisons',binarySha256:sha(exe),complete:false,colors:[],rows:[],lifecycle:[]};
 const file=path.join(root,'experience','native-delivery-'+Date.now()+'.json');let reader,other;
 try{
  const options={exe,source:profile.source,frames:info.frames,height:720,width:1280,outputHeight:720,cacheBytes:192*1024**2};
  reader=await FilmcraftClient.create({...options,gpuDrawing:true});
  other=await FilmcraftClient.create({...options,gpuDrawing:false});
  for(const n of [0,176,3500]){
   const y=await reader.request(n),rgba=await other.request(n);if(y.status!=='exact'||rgba.status!=='exact')throw Error('Missing exact color frame');
   const actual=toRGBA(y.pixels,y.metrics);let maximum=0,sum=0,over2=0;
   for(let k=0;k<actual.length;k++){const d=Math.abs(actual[k]-rgba.pixels[k]);maximum=Math.max(maximum,d);sum+=d;if(d>2)over2++;}
   record.colors.push({ordinal:n,actualTicks:y.actualTicks,pixelFormat:y.metrics.pixelFormat,colorMatrix:y.metrics.colorMatrix,fullRange:y.metrics.fullRange,maximum,mean:sum/actual.length,over2,rawBytes:y.pixels.length,rgbaBytes:rgba.pixels.length});
   if(over2)throw Error('Native YUV color differs from native RGBA reference');
  }
  record.rgbaClose=await other.close();other=null;record.originalClose=await reader.close();reader=null;
  const asset=JSON.parse(fs.readFileSync(path.join(root,'experience/proxy-gpu.json'))).asset;
  reader=await FilmcraftClient.create({...options,source:asset.filePath,frames:info.frames.map((f,n)=>({...f,ptsTicks:asset.proxyPts[n],timeBase:asset.proxyTimeBase})),gpuDrawing:true});
  for(let round=0;round<3;round++)for(const n of [0,3500,1300,2650,90,4340,740]){const r=await reader.request(n);record.rows.push({round,ordinal:n,status:r.status,ms:r.ms,format:r.metrics?.pixelFormat,hwFrames:r.metrics?.hwFrames});if(r.status!=='exact')throw Error('Exact proxy target unavailable');}
  record.proxyClose=await reader.close();reader=null;
  for(let n=0;n<50;n++){
   reader=await FilmcraftClient.create({...options,gpuDrawing:true});const pending=[];
   if(n%3){pending.push(reader.request(3500));await new Promise(r=>setTimeout(r,30));}
   if(n%3===2){pending.push(reader.request(1300));await new Promise(r=>setTimeout(r,15));}
   const close=await reader.close();await Promise.all(pending);reader=null;record.lifecycle.push({kind:n%3,close});
   if(!close.ack||close.ack.cacheBytes!==0||close.ack.liveDecoders!==0||close.exit?.code!==0||close.ms>2000)throw Error('Native lifecycle did not close cleanly');
  }
  record.complete=true;
 }catch(e){record.error=String(e.stack||e);}
 finally{if(reader)record.finalClose=await reader.close();if(other)record.otherClose=await other.close();fs.writeFileSync(file,JSON.stringify(record,null,2));}
 console.log(JSON.stringify({file,complete:record.complete,error:record.error,colors:record.colors,proxyRequests:record.rows.length,lifecycle:record.lifecycle.length}));if(!record.complete)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
