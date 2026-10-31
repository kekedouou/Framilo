'use strict';
// E43: single-process source decode/encode throughput, not player acceptance.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const {AccessUnitParser}=require('../plugin/avc-access-units.cjs'),encoding=require('../plugin/proxy-encoding.cjs');
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e43'),profile=require('../verification-runs/e42/profile.json');
const hash=async file=>{const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');};
async function run(variant,width,height,duration){
 const conditions=require('../tests/support/gpu-conditions.cjs').monitor();
 const args=['-hide_banner','-nostdin','-loglevel','info','-threads','8','-i',profile.source,'-map','0:v:0','-an','-sn','-dn','-vf',`trim=end=${duration},showinfo@v=checksum=0,scale=${width}:${height}:out_range=pc:out_color_matrix=bt601,format=yuvj420p,setsar=1`,'-vsync','0','-c:v','mjpeg','-q:v','3','-f','image2pipe','pipe:1'];
 const recipe=encoding.configure(args,{videoEncoding:encoding.encoding(variant),width,height,preview:{rotation:0,sampleAspectRatio:'1:1',width,height}}, {codec_name:'h264',pix_fmt:'yuv420p',color_space:'bt709',color_range:'tv',color_transfer:'bt709'});
 // configure replaces the GPU filter, so restore the experiment's duration cap.
 if(variant==='nvidia')args[args.indexOf('-vf')+1]=`trim=end=${duration},`+args[args.indexOf('-vf')+1];
 const start=performance.now(),parser=new AccessUnitParser(),bound=512*1024**2;
 let bytes=0,frames=0,firstSource=null,firstPacket=null,stderr='',pending='',sourcePts=[],publications=[];
 const child=spawn(profile.tools.ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const timer=setTimeout(()=>child.kill(),90000);let primary=null;
 const finish=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>code===0?resolve():reject(Error('Producer exit '+code+' '+signal+' '+stderr.slice(-1500))));});
 function accept(packet){bytes+=packet.bytes.length;if(bytes>bound)throw Error('Compressed-byte bound exceeded');frames++;if(firstPacket===null)firstPacket=performance.now()-start;if(frames%120===0)publications.push({frames,ms:performance.now()-start,bytes});}
 const video=(async()=>{for await(const data of child.stdout)for(const packet of parser.push(data))accept(packet);for(const packet of parser.end())accept(packet);})();
 const log=(async()=>{for await(const data of child.stderr){stderr=(stderr+data.toString()).slice(-2048);pending+=data.toString();const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines){if(!line.includes('showinfo@v'))continue;const p=/n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:/.exec(line);if(p){if(firstSource===null)firstSource=performance.now()-start;if(Number(p[1])!==sourcePts.length||sourcePts.length>=120000)throw Error('PTS index mismatch');sourcePts.push(Number(p[2]));}}}})();
 for(const work of [video,log])work.catch(e=>{primary=e;child.kill();});
 try{await Promise.all([finish,video,log]);if(primary)throw primary;
   const expected=require('../verification-runs/e43/source-packets.json').packets.filter(p=>p.pts/16000<duration).map(p=>p.pts).sort((a,b)=>a-b);
   if(frames!==expected.length||sourcePts.length!==frames||expected.some((p,n)=>p!==sourcePts[n]))throw Error('Source PTS verification failed');
   return {variant,width,height,duration,recipe,firstSourceMs:firstSource,firstPacketMs:firstPacket,totalMs:performance.now()-start,frames,bytes,publications,ptsVerified:true,conditions:await conditions.stop()};
 }finally{clearTimeout(timer);if(child.exitCode===null)child.kill();await conditions.stop();}
}
async function main(){const label=process.argv[2];if(!/^[a-z0-9-]{1,40}$/.test(label||''))throw Error('New label required');const out=path.join(base,'continuous-'+label+'.json');if(fs.existsSync(out))throw Error('Evidence exists');
 for(const [file,expected]of [[profile.source,profile.sourceHash],[profile.tools.ffmpeg,profile.toolHashes.ffmpeg]])if(await hash(file)!==expected)throw Error('Identity changed');
 const results=[];let error;
 try{const settings=[['cpu',1280,720,12],['nvidia',1280,720,12]];if(!process.argv.includes('--short-only'))settings.push(['nvidia',480,270,77.462]);for(const config of settings){const r=await run(...config);results.push(r);console.log(JSON.stringify({...r,conditions:r.conditions.length}));}}
 catch(e){error=e.stack;throw e;}finally{fs.writeFileSync(out,JSON.stringify({at:new Date().toISOString(),sourceHash:profile.sourceHash,toolHash:profile.toolHashes.ffmpeg,scope:'video-only continuous raw AVC output, discarded after parsing; no disk publication or audio timing',results,error},null,2),{flag:'wx'});}}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
