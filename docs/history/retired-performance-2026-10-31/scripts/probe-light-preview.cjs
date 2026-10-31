'use strict';
const fs=require('fs'),fsp=fs.promises,path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const {JpegParser}=require('../plugin/media.cjs')._test;
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e43'),profile=require('../verification-runs/e42/profile.json');
async function digest(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
async function run(label,skip){
 const packFile=path.join(base,'light-'+label+'.pack'),recordFile=path.join(base,'light-'+label+'.json');
 if(fs.existsSync(packFile)||fs.existsSync(recordFile))throw Error('Evidence exists');
 if(await digest(profile.source)!==profile.sourceHash||await digest(profile.tools.ffmpeg)!==profile.toolHashes.ffmpeg)throw Error('Source/tools identity changed');
 const args=['-hide_banner','-nostdin','-loglevel','info','-threads','8',...(skip?['-skip_frame','noref']:[]),'-i',profile.source,'-map','0:v:0','-an','-sn','-dn','-vf',"select='isnan(prev_selected_t)+gte(t-prev_selected_t,0.1)',showinfo@v=checksum=0,scale=480:270:flags=bilinear:out_range=pc:out_color_matrix=bt601,format=yuvj420p,setsar=1",'-vsync','0','-threads','2','-c:v','mjpeg','-q:v','5','-f','image2pipe','pipe:1'];
 const start=performance.now(),parser=new JpegParser(),file=await fsp.open(packFile,'wx'),images=[],pts=[],progress=[];
 let offset=0,logTail='',pending='',error=null,first=null;
 const child=spawn(profile.tools.ffmpeg,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const timer=setTimeout(()=>child.kill(),90000),finish=new Promise((r,j)=>{child.on('error',j);child.on('close',(code,signal)=>code===0?r():j(Error('Preview exit '+code+' '+signal+' '+logTail)));});
 const video=(async()=>{for await(const chunk of child.stdout){for(const bytes of parser.push(chunk)){if(offset+bytes.length>64*1024**2||images.length>=12000)throw Error('Preview budget exceeded');
   const at=performance.now()-start;if(first===null)first=at;await file.write(bytes,0,bytes.length,offset);images.push({offset,bytes:bytes.length,availableMs:at});offset+=bytes.length;}}if(parser.buffer.length)throw Error('Truncated JPEG');})();
 const log=(async()=>{for await(const chunk of child.stderr){pending+=chunk.toString();logTail=(logTail+chunk.toString()).slice(-1500);const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines){if(!line.includes('showinfo@v'))continue;const p=/n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:/.exec(line);if(p){if(Number(p[1])!==pts.length)throw Error('Bad preview PTS order');pts.push(Number(p[2]));}}}})();
 for(const task of [video,log])task.catch(e=>{error=e;child.kill();});
 try{await Promise.all([finish,video,log]);if(error)throw error;if(images.length!==pts.length)throw Error('PTS count mismatch');
   const allowed=new Set(require('../verification-runs/e43/source-packets.json').packets.map(p=>p.pts));
   if(pts.some((p,n)=>!allowed.has(p)||(n&&p<=pts[n-1])))throw Error('PTS identity mismatch');
   const frames=images.map((v,n)=>({...v,pts:pts[n],time:pts[n]/16000})),maxGap=Math.max(...frames.slice(1).map((f,n)=>f.time-frames[n].time));
   const result={schema:1,sourceHash:profile.sourceHash,toolHash:profile.toolHashes.ffmpeg,skipNonReference:skip,width:480,height:270,quality:5,timeBase:[1,16000],frames,firstMs:first,totalMs:performance.now()-start,bytes:offset,maxGapSeconds:maxGap,scope:'experimental sparse temporary previews; does not replace exact source frames; CPU decode/JPEG encode; independent FFmpeg, not Eagle'};
   await file.close();result.packHash=await digest(packFile);fs.writeFileSync(recordFile,JSON.stringify(result,null,2),{flag:'wx'});
   console.log(JSON.stringify({...result,frames:frames.length}));
 }catch(e){fs.writeFileSync(recordFile,JSON.stringify({valid:false,error:e.stack,bytes:offset,frames:images.length,pts:pts.length}),{flag:'wx'});throw e;}
 finally{clearTimeout(timer);await file.close().catch(()=>{});if(child.exitCode===null)child.kill();}
}
const label=process.argv[2];if(!/^[a-z0-9-]{1,40}$/.test(label||''))throw Error('New label required');run(label,process.argv.includes('--skip-nonref')).catch(e=>{console.error(e.stack);process.exitCode=1;});
