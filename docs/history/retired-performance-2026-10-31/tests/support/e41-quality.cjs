'use strict';
// Read-only source / exact source PTS comparison, after timed runs. No visual acceptance claim.
const fs=require('fs'),path=require('path'),assert=require('assert'),{spawn}=require('child_process');
function ffmpeg(executable,args,input){return new Promise((resolve,reject)=>{
 const child=spawn(executable,['-hide_banner','-nostdin',...args],{windowsHide:true,stdio:['pipe','pipe','pipe']});const out=[];let bytes=0,err='';
 const timer=setTimeout(()=>child.kill(),30000);child.on('error',reject);
 child.stdout.on('data',b=>{bytes+=b.length;if(bytes>16*1024**2)child.kill();else out.push(b);});child.stderr.on('data',b=>{err=(err+b).slice(-12000);});
 child.stdin.on('error',()=>{});child.stdin.end(input);child.on('close',code=>{clearTimeout(timer);code===0?resolve({bytes:Buffer.concat(out),log:err}):reject(Error('Quality check FFmpeg: '+err));});
});}
async function check({client,info,source,ffmpeg:executable,variant,output}){
 fs.mkdirSync(output,{recursive:true});const results=[];
 for(const target of [84.6,257.2,303.4]){
  const f=info.frames.find(f=>f.time<=target&&f.end>target);assert(f);const pts=Number(BigInt(f.ptsTicks))*f.timeBase[0]/f.timeBase[1];
  const reference=await ffmpeg(executable,['-copyts','-noaccurate_seek','-seek_timestamp','1','-ss',String(pts),'-i',source,'-an','-sn','-vf',`trim=start=${pts},showinfo,scale=${info.width}:${info.height}:flags=bilinear:out_range=tv:out_color_matrix=bt709,format=yuv420p`,'-frames:v','1','-f','rawvideo','pipe:1']);
  const returned=/\bn:\s*0\s+pts:\s*(-?\d+)\s+pts_time:/.exec(reference.log);assert(returned&&returned[1]===f.ptsTicks,'reference exact source PTS');
  const packet=await client.cache.readAsset(info,f.file);const decoded=await ffmpeg(executable,['-v','error','-f','h264','-i','pipe:0','-an','-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','pipe:1'],packet);
  assert.equal(reference.bytes.length,info.width*info.height*1.5);assert.equal(decoded.bytes.length,reference.bytes.length);
  let squares=0;for(let n=0;n<reference.bytes.length;n++)squares+=(reference.bytes[n]-decoded.bytes[n])**2;
  const mse=squares/reference.bytes.length;results.push({target,pts:f.ptsTicks,packetBytes:packet.length,psnr:mse?10*Math.log10(255**2/mse):null,reference:'CPU bilinear, BT709 limited, yuv420p; exact source PTS',scope:'sample image error, not perceptual acceptance'});
  for(const [name,raw]of [[variant,decoded.bytes],['source',reference.bytes]]){
   const file=path.join(output,`${name}-${f.id??info.frames.indexOf(f)}.png`);if(fs.existsSync(file))continue;
   const png=await ffmpeg(executable,['-v','error','-f','rawvideo','-pixel_format','yuv420p','-video_size',`${info.width}x${info.height}`,'-colorspace','bt709','-color_range','tv','-i','pipe:0','-vf','scale=in_color_matrix=bt709:in_range=tv:out_range=pc','-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],raw);fs.writeFileSync(file,png.bytes,{flag:'wx'});
  }
 }
 return results;
}
module.exports={check,ffmpeg};
