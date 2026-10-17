'use strict';
// Explicitly named sources only. Single-frame, bounded, in-memory diagnostics.
const fs=require('fs'),path=require('path'),http=require('http');
const {store,identity,hashFile}=require('./workspace.cjs');
const {command,monitor}=require('./quality.cjs');
const {previewColor,previewRgbFilter,ffmpegArgs}=require('../../plugin/media.cjs')._test;
async function json(exe,args,control){return JSON.parse(await bytes(exe,args,control,2*1024**2));}
async function bytes(exe,args,control,limit=24*1024**2){const chunks=[];let size=0;
  await command(exe,args,b=>{size+=b.length;if(size>limit)throw Error('Single-frame diagnostic exceeds boundary');chunks.push(b);},null,control,15000);
  return Buffer.concat(chunks);
}
function differences(a,b){if(a.length!==b.length)throw Error('Color comparison sizes differ');let absolute=0,squares=0,max=0,delta=[0,0,0];
  const hist=new Uint32Array(256);for(let i=0;i<a.length;i++){const d=a[i]-b[i],v=Math.abs(d);absolute+=v;squares+=d*d;hist[v]++;delta[i%3]+=d;if(v>max)max=v;}
  let count=0,p95=0;for(;p95<255;p95++){count+=hist[p95];if(count>=a.length*.95)break;}
  return {mae:absolute/a.length,rmse:Math.sqrt(squares/a.length),p95,max,meanDelta:delta.map(x=>x/(a.length/3))};
}
function oracle(yuv,width,height,matrix,range){const size=width*height;if(yuv.length!==size*3)throw Error('Oracle needs planar YUV444');
  const [kr,kb]=matrix==='bt601'?[.299,.114]:[.2126,.0722],kg=1-kr-kb,out=Buffer.alloc(size*3);
  const round=x=>Math.max(0,Math.min(255,Math.round(x)));
  for(let i=0;i<size;i++){const y=range==='pc'?yuv[i]:(yuv[i]-16)*255/219;
    const u=(yuv[size+i]-128)*(range==='pc'?1:255/224),v=(yuv[2*size+i]-128)*(range==='pc'?1:255/224);
    out[i*3]=round(y+2*(1-kr)*v);out[i*3+1]=round(y-2*kb*(1-kb)/kg*u-2*kr*(1-kr)/kg*v);out[i*3+2]=round(y+2*(1-kb)*u);
  }return out;
}
function item(name){return new Promise((resolve,reject)=>{const r=http.get('http://127.0.0.1:41595/api/item/list?ext=mp4&limit=10&keyword='+encodeURIComponent(name),res=>{
    let s='';res.on('data',b=>{s+=b;if(s.length>2*1024**2)r.destroy(Error('Item reply exceeds boundary'));});res.on('error',reject);res.on('end',()=>{try{const hits=JSON.parse(s).data.filter(x=>x.name===name);if(hits.length!==1)throw Error('Explicit source ambiguous/missing');resolve(hits[0]);}catch(e){reject(e);}});
  });r.setTimeout(5000,()=>r.destroy(Error('Read-only item request deadline')));r.on('error',reject);});}
async function run(names){if(!names.length||names.length>2)throw Error('Specify one or two user-approved names');
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'config.local.json'))),images=path.dirname(path.dirname(config.sources[0].file)),records=store(),writer=records.writer('color-single-frame-diagnostic');
  const control={child:null,failure:null},observer=monitor(control),rows=[];
  try{writer.append({sourceCodeSha256:hashFile(__filename),mediaCodeSha256:hashFile(path.join(__dirname,'../../plugin/media.cjs')),node:process.version,ffmpegSha256:hashFile(config.ffmpeg),scope:'FFmpeg and independent YUV matrix arithmetic; NOT real Eagle video/Canvas or full HDR validation; no output media written'});writer.flush();
    for(const name of names){const value=await item(name),dir=path.join(images,value.id+'.info');identity(dir,true);
      const files=fs.readdirSync(dir).filter(f=>/\.mp4$/i.test(f));if(files.length!==1)throw Error('Source MP4 ambiguous');
      const file=path.join(dir,files[0]),before=identity(file),sourceSha256=hashFile(file);
      const probe=await json(config.ffprobe,['-v','error','-select_streams','v:0','-show_streams','-of','json',file],control),v=probe.streams[0],color=previewColor(v);
      if(!v||v.width/v.height!==16/9||!['bt709','bt601'].includes(color.matrix))throw Error('This diagnostic oracle covers approved16:9 SDR709/601 only');
      for(const height of [720,1080])for(const frame of [0,29]){const width=height*16/9,select=`select=eq(n\\,${frame}),`,base=['-v','error','-threads','2','-i',file,'-an','-sn','-dn'];
        const raw=filter=>bytes(config.ffmpeg,[...base,'-vf',select+filter,'-frames:v','1','-c:v','rawvideo','-threads','2','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],control);
        const oldRgb=await raw(`scale=${width}:${height}:flags=bilinear,format=rgb24`),rgb=await raw(previewRgbFilter(v,width,height));
        const planar=await bytes(config.ffmpeg,[...base,'-vf',select+`scale=${width}:${height}:flags=bilinear+accurate_rnd,format=yuv444p`,'-frames:v','1','-c:v','rawvideo','-threads','2','-pix_fmt','yuv444p','-f','rawvideo','pipe:1'],control);
        const reference=oracle(planar,width,height,color.matrix,color.range==='pc'?'pc':'tv');
        const oldVf=`scale=${width}:${height}:flags=bilinear`,fixedVf=previewRgbFilter(v,width,height)+',scale=in_range=pc:out_range=pc:out_color_matrix=bt601:flags=bilinear+accurate_rnd+full_chroma_int,format=yuvj420p';
        const jpeg=async filter=>{const image=await bytes(config.ffmpeg,[...base,'-vf',select+filter,'-frames:v','1','-c:v','mjpeg','-q:v','3','-threads','2','-f','image2pipe','pipe:1'],control);
          // Pipe bytes through a spawned decoder without writing source/cache files.
          const cp=require('child_process'),child=cp.spawn(config.ffmpeg,['-v','error','-threads','2','-f','image2pipe','-i','pipe:0','-frames:v','1','-c:v','rawvideo','-threads','2','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','pipe']});control.child=child;
          const chunks=[];let size=0;const deadline=setTimeout(()=>child.kill(),15000);let error=null;child.stderr.resume();child.stdin.on('error',e=>error=e);
          const done=new Promise(resolve=>{child.once('error',e=>{error=e;resolve(-1);});child.once('close',resolve);});child.stdin.end(image);
          try{for await(const b of child.stdout){size+=b.length;if(size>24*1024**2||control.failure){child.kill();throw control.failure||Error('Decoded JPEG exceeds boundary');}chunks.push(b);}
            const exit=await done;if(error||exit!==0)throw error||Error('JPEG diagnostic decode failed');return {pixels:Buffer.concat(chunks),bytes:image.length};
          }finally{clearTimeout(deadline);if(control.child===child)control.child=null;}
        };
        const old=await jpeg(oldVf),fixed=await jpeg(fixedVf);
        const row={sourceSha256,sourceWidth:v.width,sourceHeight:v.height,color,width,height,frame,oldRgbVsOracle:differences(oldRgb,reference),fixedRgbVsOracle:differences(rgb,reference),oldJpegVsOracle:differences(old.pixels,reference),fixedJpegVsOracle:differences(fixed.pixels,reference),oldJpegBytes:old.bytes,fixedJpegBytes:fixed.bytes};
        rows.push(row);writer.append(row);writer.flush();console.log(JSON.stringify({source:name,height,frame,oldRgbMAE:row.oldRgbVsOracle.mae,newRgbMAE:row.fixedRgbVsOracle.mae,oldJpegMAE:row.oldJpegVsOracle.mae,newJpegMAE:row.fixedJpegVsOracle.mae}));
      }
      if(JSON.stringify(before)!==JSON.stringify(identity(file))||sourceSha256!==hashFile(file))throw Error('Original changed');writer.append({sourceSha256,sourceUnchanged:true});writer.flush();
    }
  }catch(e){writer.append({failure:true,message:e.message.replace(/[A-Za-z]:[^\n]*/g,'[local path]')});throw e;}
  finally{writer.append({resources:await observer.stop()});console.log(JSON.stringify({evidence:writer.close()}));}
  return rows;
}
if(require.main===module)run(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run,differences,oracle};
