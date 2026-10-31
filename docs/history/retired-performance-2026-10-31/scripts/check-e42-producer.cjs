'use strict';
// Read-only source; bounded FFmpeg stdout hashed in memory, never a cache writer.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert'),{spawn,spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e42'),profile=JSON.parse(fs.readFileSync(path.join(base,'profile.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 const output=path.join(base,'producer-probe.json');assert(!fs.existsSync(output));
 assert.equal(sha(fs.readFileSync(profile.source)),profile.sourceHash);
 for(const [k,file]of Object.entries(profile.tools))assert.equal(sha(fs.readFileSync(file)),profile.toolHashes[k]);
 const p=spawnSync(profile.tools.ffprobe,['-v','error','-show_streams','-of','json',profile.source],{windowsHide:true,encoding:'utf8',timeout:15000});assert.equal(p.status,0);
 const video=JSON.parse(p.stdout).streams.find(x=>x.codec_type==='video'),preview={width:1280,height:720,quality:'720p',rotation:0,sampleAspectRatio:'1:1'};
 const rows=[],record={sourceHash:profile.sourceHash,status:'running',scope:'FFmpeg single 2s video-only segment, no cache/audio/player; no quality recipe change',rows};
 for(let round=0;round<2;round++)for(const mode of ['original','frame-cap','single-input-thread']){
  const args=require('../plugin/media.cjs')._test.ffmpegArgs(profile.source,false,video.codec_name,video,preview);
  args.splice(args.indexOf('-i'),0,'-noaccurate_seek','-seek_timestamp','1','-ss','43.990000000');
  const production=require('../plugin/proxy-encoding.cjs').configure(args,{width:1280,height:720,preview,videoEncoding:{recipe:'nvenc-p1-qp20-v1'}},video);
  args[args.indexOf('-vf')+1]='trim=start=43.990000000,trim=end_frame=120,'+args[args.indexOf('-vf')+1];
  if(mode==='frame-cap')args.splice(args.indexOf('-f'),0,'-frames:v','120');
  if(mode==='single-input-thread')args[args.indexOf('-threads')+1]='1';
  const began=performance.now(),row={round,mode,production,args,bytes:0,firstPacketMs:null},hash=crypto.createHash('sha256');rows.push(row);
  const child=spawn(profile.tools.ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>child.kill(),30000);let stderr='';
  child.stdout.on('data',b=>{row.firstPacketMs??=performance.now()-began;row.bytes+=b.length;if(row.bytes>64*1024**2)child.kill();hash.update(b);});
  child.stderr.on('data',b=>{stderr=(stderr+b).slice(-32768);});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);}).finally(()=>clearTimeout(timer));
  row.ms=performance.now()-began;row.code=code;row.sha256=hash.digest('hex');row.stderrTail=stderr.slice(-800);fs.writeFileSync(output,JSON.stringify(record,null,2));assert.equal(code,0);
 }
 record.status='completed';fs.writeFileSync(output,JSON.stringify(record,null,2));console.log(rows.map(({mode,ms,firstPacketMs,bytes,sha256})=>({mode,ms,firstPacketMs,bytes,sha256})));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
