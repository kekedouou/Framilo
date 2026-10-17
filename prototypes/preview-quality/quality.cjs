'use strict';
// Isolated common-RGB comparison. Never writes the product cache or source.
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const { performance } = require('perf_hooks');
const { REPO, sha, hashFile, identity, store, scratch } = require('./workspace.cjs');
const { JpegParser } = require('../../plugin/media.cjs')._test;
const MAX_IMAGE = 32 * 1024 ** 2;
class PngParser {
  constructor() { this.buffer = Buffer.alloc(0); }
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out = [];
    while (this.buffer.length >= 8) {
      if (!this.buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('PNG signature mismatch');
      let offset = 8, complete = false;
      while (offset + 12 <= this.buffer.length) {
        const length = this.buffer.readUInt32BE(offset), type = this.buffer.toString('ascii', offset + 4, offset + 8);
        if (length > MAX_IMAGE || offset + 12 + length > MAX_IMAGE) throw Error('PNG image exceeds boundary');
        if (offset + 12 + length > this.buffer.length) break;
        offset += length + 12;
        if (type === 'IEND') { if (length !== 0) throw Error('PNG IEND length invalid'); complete = true; break; }
      }
      if (!complete) break;
      out.push(Buffer.from(this.buffer.subarray(0, offset))); this.buffer = this.buffer.subarray(offset);
    }
    if (this.buffer.length > MAX_IMAGE) throw Error('PNG stream boundary exceeded');
    return out;
  }
  finish() { if (this.buffer.length) throw Error('Truncated PNG stream'); }
}
class WebpParser {
  constructor(){this.buffer=Buffer.alloc(0);}
  push(chunk){this.buffer=Buffer.concat([this.buffer,chunk]);const frames=[];
    while(this.buffer.length>=12){
      if(this.buffer.toString('ascii',0,4)!=='RIFF'||this.buffer.toString('ascii',8,12)!=='WEBP')throw Error('WebP signature mismatch');
      const length=this.buffer.readUInt32LE(4)+8;if(length<20||length>MAX_IMAGE)throw Error('WebP image boundary invalid');
      if(this.buffer.length<length)break;frames.push(Buffer.from(this.buffer.subarray(0,length)));this.buffer=this.buffer.subarray(length);
    }if(this.buffer.length>MAX_IMAGE)throw Error('WebP stream exceeds boundary');return frames;
  }
  finish(){if(this.buffer.length)throw Error('Truncated WebP stream');}
}
function frameReader(bytes, onFrame) {
  const buffer = Buffer.alloc(bytes); let offset = 0, count = 0;
  return { push(chunk) { for (let at = 0; at < chunk.length;) {
    const n = Math.min(bytes - offset, chunk.length - at); chunk.copy(buffer, offset, at, at + n); offset += n; at += n;
    if (offset === bytes) { onFrame(buffer, count++); offset = 0; }
  } }, finish() { if (offset) throw Error('Truncated raw frame'); return count; } };
}
function percentile(a, p) { const xs = a.slice().sort((x,y) => x-y); return xs.length ? xs[Math.ceil(xs.length*p)-1] : null; }
async function command(exe, args, onData, onErrorLine, control, timeoutMs=60000) {
  if (control.failure) throw control.failure;
  const child = cp.spawn(exe, args, { windowsHide: true, shell: false, stdio: ['ignore','pipe','pipe'] }); control.child = child;
  const start = performance.now(); let errors = '', failure = null, stderr = '';
  const timer = setTimeout(() => { failure = Error('Experimental media command deadline reached'); child.kill(); }, timeoutMs);
  const closed = new Promise(resolve => { child.once('error', e => { failure = e; resolve(-1); }); child.once('close', resolve); });
  child.stderr.on('data', chunk => { try { stderr += chunk.toString('utf8'); let at;
    while ((at = stderr.indexOf('\n')) >= 0) { const line = stderr.slice(0,at); stderr = stderr.slice(at+1); if (onErrorLine) onErrorLine(line); errors = (errors + line + '\n').slice(-8192); }
    if (stderr.length > 65536) { failure = Error('FFmpeg diagnostic line too large'); child.kill(); }
    } catch(e) { failure=e; child.kill(); }
  });
  try { for await (const chunk of child.stdout) { if (control.failure) throw control.failure; onData(chunk); } }
  catch(e) { failure = e; child.kill(); }
  const code = await closed; clearTimeout(timer); if (control.child === child) control.child = null;
  if (failure || control.failure || code !== 0) throw failure || control.failure || Error('Experimental FFmpeg failed, code=' + code);
  return { elapsedMs: performance.now()-start, stderrTail: errors };
}
function monitor(control) {
  const exe = require('../../scripts/build-resource-sampler.cjs').verify();
  const child = cp.spawn(exe, ['1000','600000',String(process.pid),'parent','renderer',process.execPath],
    { windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'] });
  let pending='', issue=null, samples=0, ffmpegPeak=null, nodePeak=null, observerPeak=null, stopped=false;
  const done = new Promise(resolve => { child.once('error', e=>{ issue=e.message; resolve(); }); child.once('close', resolve); });
  child.stdout.on('data', chunk => { pending+=chunk.toString('utf8'); let at;
    try { while((at=pending.indexOf('\n'))>=0) { const x=JSON.parse(pending.slice(0,at)); pending=pending.slice(at+1); samples++;
      if(x.errors.length) throw Error('External resource sample incomplete');
      const rss=x.processes.filter(p=>p.role==='renderer').reduce((n,p)=>n+p.rssBytes,0);
      nodePeak=Math.max(nodePeak||0,rss);
      observerPeak=Math.max(observerPeak||0,x.processes.filter(p=>p.role==='observer'||p.role==='observer-child').reduce((n,p)=>n+p.rssBytes,0));
      for(const p of x.processes) if(p.role==='ffmpeg') { ffmpegPeak=Math.max(ffmpegPeak||0,p.rssBytes); if(p.rssBytes>=1024**3) throw Error('FFmpeg reached 1GiB observation line'); }
      if(rss>=1.5*1024**3) throw Error('Experimental Node reached 1.5GiB observation line');
    } if(pending.length>65536) throw Error('External sample line exceeds boundary'); }
    catch(e) { issue=e.message; control.failure=e; if(control.child)control.child.kill(); child.stdin.end(); }
  });
  child.stderr.resume(); child.stdin.on('error',()=>{});
  return { async stop() { stopped=true; child.stdin.end(); const timer=setTimeout(()=>child.kill(),5000); await done; clearTimeout(timer);
    return { samples, nodePeak, ffmpegPeak, observerPeak, issue, intervalMs:1000, stopped,
      limitation:'Polling can miss peaks and short FFmpeg processes. Node backend is not the Eagle renderer/GPU.' }; } };
}
async function run(selection, heights, formats=['jpeg','png'], capture=false, full=false, runtime={}) {
  if(!formats.length||formats.some(f=>!['jpeg','png','webp'].includes(f)))throw Error('Unapproved candidate format');
  const config = runtime.config || JSON.parse(fs.readFileSync(path.join(__dirname,'config.local.json'))), records=runtime.records || store(), results=[];
  const execution={node:process.version,scriptSha256:hashFile(__filename),ffmpegSha256:hashFile(config.ffmpeg),formats,heights,selection,capture,full};
  const control=runtime.control || {child:null,failure:null}, observer=monitor(control);
  try {
    for(const key of selection) {
      const source=config.sources.find(s=>s.key===key); if(!source)throw Error('Unregistered source');
      if(hashFile(source.file)!==source.sha256 || JSON.stringify(identity(source.file))!==JSON.stringify(source.identity))throw Error('Source changed');
      for(const height of heights) {
        if(![720,1080].includes(height))throw Error('Unapproved test dimensions');
        const width=height*16/9, frameBytes=width*height*3, work=scratch(), refs=[], times=[], roundRecord=records.writer(capture?'display-preparation':full?'full-quality-rounds':'quality-rounds'), displays=[];
        roundRecord.append({execution});roundRecord.flush();
        if(full&&(key!=='fenshen'||source.duration>7||capture))throw Error('Only the registered native1080p short source is approved for full screening');
        const maximum=full?240:60,seconds=full?7:1,start=full?0:source.start;
        const raw=work.create('reference.rgb'), parser=frameReader(frameBytes,(buffer,n)=>{
          if(n>=maximum)throw Error('Experimental frame count exceeded'); refs.push(sha(buffer)); work.write(raw,buffer);
        });
        const args=['-hide_banner','-loglevel','info','-nostdin','-threads','4',...(capture||full?['-copyts']:[]),'-i',source.file,'-an','-sn','-dn',
          '-vf',`trim=start=${start}:duration=${seconds},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=bilinear,setsar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=rgb24,showinfo=checksum=0`,
          '-filter_threads','2','-frames:v',String(maximum),'-fps_mode','passthrough','-c:v','rawvideo','-threads','2','-pix_fmt','rgb24','-f','rawvideo','pipe:1'];
        try {
          const prepared=await command(config.ffmpeg,args,b=>parser.push(b),line=>{const m=/\bn:\s*(\d+).*?pts:\s*(-?\d+).*?pts_time:([\d.e+-]+)/.exec(line);if(m)times.push({ordinal:Number(m[1]),pts:m[2],time:Number(m[3])});},control);
          const count=parser.finish();work.seal(raw); if(!count||times.length<count)throw Error('Missing source frame times');
          const usedTimes=times.slice(0,count); if(usedTimes.some((t,i)=>i&&t.time<=usedTimes[i-1].time))throw Error('Non-increasing experimental times');
          for(let round=0;round<(capture?1:3);round++) for(const format of round%2?formats.slice().reverse():formats) {
            const name=work.create(`encoded-${round}-${format}.pack`), packet=format==='png'?new PngParser():format==='webp'?new WebpParser():new JpegParser(), index=[];let total=0;
            const encoded=await command(config.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','rawvideo','-pixel_format','rgb24','-video_size',`${width}x${height}`,
              '-framerate','60','-i',work.path(raw),'-frames:v',String(count),'-an','-c:v',format==='png'?'png':format==='webp'?'libwebp':'mjpeg','-threads','2',
              ...(format==='png'?['-pix_fmt','rgb24','-compression_level','3']:format==='webp'?['-pix_fmt','bgra','-lossless','1','-compression_level','0','-quality','75']:['-pix_fmt','yuvj420p','-q:v','3']),'-f','image2pipe','pipe:1'],
              b=>{for(const image of packet.push(b)){if(index.length>=count)throw Error('Extra encoded frame');index.push({offset:total,bytes:image.length,sha256:sha(image)});total+=image.length;work.write(name,image);}},null,control);
            if(format!=='jpeg')packet.finish();else if(packet.buffer.length)throw Error('Truncated JPEG');
            work.seal(name);if(index.length!==count)throw Error('Encoded frame count mismatch');
            const fd=fs.openSync(work.path(raw),'r'), ref=Buffer.alloc(frameBytes), differences=[], arrivals=[];let exact=0,last=performance.now();
            const decodedFrames=frameReader(frameBytes,(pixels,n)=>{
              if(n>=count)throw Error('Extra decoded frame');const at=performance.now();arrivals.push(at-last);last=at;
              if(sha(pixels)===refs[n])exact++;
              if(n===0||n===Math.floor(count/2)||n===count-1) {
                if(fs.readSync(fd,ref,0,frameBytes,n*frameBytes)!==frameBytes)throw Error('Truncated reference');
                let sum=0,squares=0,max=0;for(let j=0;j<frameBytes;j++){const d=Math.abs(pixels[j]-ref[j]);sum+=d;squares+=d*d;if(d>max)max=d;}
                differences.push({ordinal:n,mae:sum/frameBytes,rmse:Math.sqrt(squares/frameBytes),max});
              }
            });
            let decoded;try{decoded=await command(config.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-threads','2','-f','image2pipe','-c:v',format==='png'?'png':format==='webp'?'webp':'mjpeg','-i',work.path(name),
              '-frames:v',String(count),'-pix_fmt','rgb24','-c:v','rawvideo','-threads','2','-f','rawvideo','pipe:1'],b=>decodedFrames.push(b),null,control);}finally{fs.closeSync(fd);}
            if(decodedFrames.finish()!==count||format!=='jpeg'&&exact!==count)throw Error('Lossless/reference integrity failed');
            const result={source:key,sourceSha256:source.sha256,sourceWidth:source.width,sourceHeight:source.height,sourceCodec:source.codec,width,height,round,format,count,fullSource:full,
              first:usedTimes[0],last:usedTimes[count-1],referenceDecodeMs:prepared.elapsedMs,encodeMs:encoded.elapsedMs,decodeMs:decoded.elapsedMs,
              encodedBytes:total,exactFrames:exact,differences,arrivalP95Ms:percentile(arrivals,.95),compressedPoolFramesAt128MiB:index.filter((_,i)=>index.slice(0,i+1).reduce((n,x)=>n+x.bytes,0)<=128*1024**2).length,
              timestampConvention:capture||full?'Original input PTS with copyts':'FFmpeg normalized input timeline without copyts; not original source PTS',
              scope:(full?'Full registered6.92-second source':'1-second window')+'; commonRGB24 -> codec -> FFmpeg RGB24. JPEG q3/yuvj420p includes RGB conversion; not production pipeline or Canvas P01/P02/P03.',
              decodedPixelBytesPerFrame:width*height*4,referenceSha256:sha(Buffer.from(refs.join('')))};
            roundRecord.append(result);roundRecord.flush();results.push(result);
            console.log(JSON.stringify({source:key,height,round,format,count,bytes:total,encodeMs:Math.round(encoded.elapsedMs),decodeMs:Math.round(decoded.elapsedMs),exactFrames:exact}));
            // Each round's generated packet is retired after its receipts are saved.
            if(capture)displays.push({format,file:name,sha256:hashFile(work.path(name)),index});
            else work.remove([name],records);
          }
          if(capture){
            const probeChunks=[];let probeBytes=0;
            await command(config.ffprobe,['-v','error','-select_streams','v:0','-read_intervals',`${Math.max(0,start)}%${usedTimes[count-1].time+1}`,'-show_frames','-show_entries','frame=best_effort_timestamp,pkt_duration,duration','-of','json',source.file],
              b=>{probeBytes+=b.length;if(probeBytes>2*1024**2)throw Error('Independent probe output exceeds boundary');probeChunks.push(b);},null,control,15000);
            const probed=JSON.parse(Buffer.concat(probeChunks).toString('utf8')).frames;
            if(usedTimes.some(t=>!probed.some(f=>String(f.best_effort_timestamp)===t.pts)))throw Error('Source PTS differs from independent probe');
            const frame=probed.find(f=>String(f.best_effort_timestamp)===usedTimes[count-1].pts),duration=frame&&(frame.duration||frame.pkt_duration);
            if(!duration||BigInt(duration)<=0n)throw Error('Explicit final source-frame duration missing');
            const finalTicks=(BigInt(usedTimes[count-1].pts)+BigInt(duration)).toString();
            const data={schema:'eva-display-clip-v1',source:key,sourceSha256:source.sha256,width,height,times:usedTimes,
              timeBase:source.timeBase.split('/').map(Number),lastFrameEndTicks:finalTicks,referenceHashes:refs,displays,
              scope:'One-second isolated source clip; no original audio or library operations. Not full-video preparation/latency acceptance.'};
            const meta=work.create('display-index.json');work.write(meta,Buffer.from(JSON.stringify(data)));work.seal(meta);
            records.save('display-ready',{directory:path.relative(REPO,work.root),files:work.names().filter(n=>n!==raw).map(n=>({name:n,identity:identity(work.path(n)),sha256:hashFile(work.path(n))})),exitCondition:'Retain for the single pending user/Eagle quality check; retire using this receipt after acceptance.'});
            const location={root:work.root,meta:work.path(meta),sha256:hashFile(work.path(meta))};
            if(runtime.onCapture)runtime.onCapture({location,data,work});
            else {const pointer=path.join(__dirname,'display.local.json');if(fs.existsSync(pointer))throw Error('Pending visual comparison exists; retained');
              fs.writeFileSync(pointer,JSON.stringify(location),{flag:'wx'});}
          }
          work.remove([raw],records);work.finish();roundRecord.close();
        }catch(e){for(const name of work.names())work.seal(name);roundRecord.append({failure:true,source:key,height,message:String(e.message).replace(/[A-Za-z]:[^\n]*/g,'[local path]'),scratch:path.relative(REPO,work.root)});roundRecord.close();work.remove(work.names(),records);throw e;}
      }
      if(hashFile(source.file)!==source.sha256||JSON.stringify(identity(source.file))!==JSON.stringify(source.identity))throw Error('Original changed after comparison');
    }
  }finally{const resource=await observer.stop();records.save('quality-resources',resource);if(resource.issue)console.log(JSON.stringify({resourceIssue:resource.issue}));}
  const summary={schema:'eva-quality-summary-v1',results,sourceFilesUnchanged:true,productionUntouched:true,hostVerified:false};records.save('quality-summary',summary);return summary;
}
if(require.main===module){const keys=(process.argv[2]||'fenshen,sonic,hevc,vp9').split(','),heights=(process.argv[3]||'720,1080').split(',').map(Number),formats=(process.argv[4]||'jpeg,png').split(',');run(keys,heights,formats,process.argv[5]==='capture',process.argv[5]==='full').catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={PngParser,WebpParser,frameReader,percentile,run,command,monitor};
