'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e43'),profile=require('../verification-runs/e42/profile.json');
async function main(){
 const out=path.join(base,'preview-targets.json');if(fs.existsSync(out))throw Error('Evidence exists');
 const hash=crypto.createHash('sha256');for await(const b of fs.createReadStream(profile.source))hash.update(b);if(hash.digest('hex')!==profile.sourceHash)throw Error('Source changed');
 const sparse=require('../verification-runs/e43/light-sparse.json'),results=[];
 for(const target of [58.4,22.7,44.2]){
  const selected=sparse.frames.reduce((best,f)=>Math.abs(f.time-target)<Math.abs(best.time-target)?f:best);
  for(const width of [480,1280]){
   const height=width===480?270:720,begin=performance.now(),chunks=[],conditions=require('../tests/support/gpu-conditions.cjs').monitor();let bytes=0,first=null,stderr='',failure;
   const args=['-hide_banner','-nostdin','-loglevel','info','-copyts','-threads','8',...(width===480?['-skip_frame','noref']:[]),'-noaccurate_seek','-seek_timestamp','1','-ss',selected.time.toFixed(9),'-i',profile.source,'-map','0:v:0','-an','-sn','-dn','-vf',`trim=start=${selected.time.toFixed(9)},showinfo@v=checksum=0,scale=${width}:${height}:flags=bilinear:out_range=pc:out_color_matrix=bt601,format=yuvj420p,setsar=1`,'-frames:v','1','-vsync','0','-threads','2','-c:v','mjpeg','-q:v',width===480?'5':'3','-f','image2pipe','pipe:1'];
   const child=spawn(profile.tools.ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill(),15000);
   try{
    await new Promise((resolve,reject)=>{child.on('error',reject);child.stdout.on('data',b=>{if(first===null)first=performance.now()-begin;bytes+=b.length;if(bytes>2*1024**2){failure=Error('Image bound');child.kill();}else chunks.push(b);});child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-16384);});child.on('close',(code,signal)=>code===0&&!failure?resolve():reject(failure||Error('Target process failed '+code+' '+signal+' '+stderr)));});
    const pts=[...stderr.matchAll(/n:\s*0\s+pts:\s*(-?\d+)\s+pts_time:/g)].map(m=>Number(m[1]));if(pts[0]!==selected.pts)throw Error('Source PTS mismatch');
    const ms=performance.now()-begin,data=Buffer.concat(chunks),name=`reference-${selected.pts}-${width}.jpg`;fs.writeFileSync(path.join(base,name),data,{flag:'wx'});
    results.push({target,sourceTime:selected.time,sourcePts:selected.pts,width,height,firstMs:first,totalMs:ms,bytes,name,hash:crypto.createHash('sha256').update(data).digest('hex'),conditions:await conditions.stop()});console.log(JSON.stringify({target,width,firstMs:first,totalMs:ms}));
   }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();await conditions.stop();}
  }
 }
 fs.writeFileSync(out,JSON.stringify({schema:1,sourceHash:profile.sourceHash,scope:'unprepared original-source seek; CPU; sparse source PTS targets; not Eagle',results},null,2),{flag:'wx'});
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
