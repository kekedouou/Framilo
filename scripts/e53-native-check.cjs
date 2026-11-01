'use strict';
// Explicit bounded E53 read-only native check. Existing owned synthetic E52
// fixtures only; no generation, Eagle API, annotations or source modification.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),out=path.join(ROOT,'verification-runs/e53');
const plugin=path.resolve(process.argv[2]||path.join(ROOT,'plugin'));
assert(plugin===path.join(ROOT,'plugin')||path.dirname(plugin)===path.join(ROOT,'dist'));
assert.equal(fs.realpathSync(plugin).toLowerCase(),plugin.toLowerCase());
const binary=n=>{const r=spawnSync('where.exe',[n],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0);return r.stdout.trim().split(/\r?\n/)[0];};
const tools={ffmpeg:binary('ffmpeg'),ffprobe:binary('ffprobe')};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(fs.readFileSync(path.join(plugin,'manifest.json'))),results=[];
const report={started:new Date().toISOString(),scope:'Independent native reader only; not Eagle playback/audio/interaction or a performance benchmark',version:manifest.version,plugin:path.relative(ROOT,plugin).replace(/\\/g,'/'),binarySha256:sha(fs.readFileSync(path.join(plugin,'bin/filmcraft-media.exe'))),results};
const target=path.join(out,'native-check-'+Date.now()+'.json');fs.mkdirSync(out,{recursive:true});assert(!fs.existsSync(target));
const persist=()=>fs.writeFileSync(target,JSON.stringify(report,null,2));
async function main(){
 const names=process.argv.includes('--smoke')?['h264.mp4']:['h264.mp4','alias.m4v','hevc.mp4','av1-aom.mp4','h264.mov','prores-hd.mov','aac.mkv','hevc.mkv','offset.mkv','vfr.mkv','vp8.webm','opus.webm','silent.webm','hfr709.mp4','uhd709.mp4'];
 for(const name of names){
  const file=path.join(ROOT,'verification-runs/e52/formats',name);assert(fs.statSync(file).size<32*1024**2);const sourceSha=sha(fs.readFileSync(file));
  for(const software of name==='h264.mp4'||name==='uhd709.mp4'?[true,false]:[true]){
   const row={name,sourceSha256:sourceSha,requestedDecoder:software?'software':'hardware',quality:name==='uhd709.mp4'?'2160p':'720p'},began=performance.now();results.push(row);let r;
   try{
    const info=await require(path.join(plugin,'native-backend.cjs')).inspect({filePath:file},tools,row.quality);row.sourceFrames=info.frames.length;row.audioCodec=info.audio?.codec||null;
    r=new (require(path.join(plugin,'native-reader.cjs')).FilmcraftClient)({exe:path.join(plugin,'bin/filmcraft-media.exe'),source:file,frames:info.frames,software,height:row.quality==='2160p'?2160:720,width:info.width,outputHeight:info.height,gpuDrawing:false,cacheBytes:128*1024**2});
    await r.ready;row.frames=[];
    for(const ordinal of [0,Math.floor(info.frames.length/2),info.frames.length-1,3,3]){const v=await r.request(ordinal);row.frames.push({ordinal,status:v.status,width:v.metrics?.width,height:v.metrics?.height,hwFrames:v.metrics?.hwFrames,hwFallbacks:v.metrics?.hwFallbacks});assert.equal(v.status,'exact');assert.equal(v.pixels.length,info.width*info.height*4);}
   }catch(e){row.error=String(e.message);}finally{if(r)try{row.close=await r.close();}catch(e){row.closeError=e.message;}row.elapsedMs=Math.round(performance.now()-began);assert.equal(sha(fs.readFileSync(file)),sourceSha);persist();}
   console.log(JSON.stringify({name,requestedDecoder:row.requestedDecoder,frames:row.frames?.length,error:row.error,closed:!!row.close?.ack}));
   if(Date.now()-Date.parse(report.started)>9*60*1000)throw Error('E53 bounded duration reached');
  }
 }
 report.completed=new Date().toISOString();report.passed=results.every(r=>!r.error&&!r.closeError&&r.frames?.length===5&&r.close?.ack);persist();console.log(JSON.stringify({report:path.relative(ROOT,target),cases:results.length,passed:report.passed}));if(!report.passed)process.exitCode=1;
}
main().catch(e=>{report.failure=e.message;persist();console.error(e.message);process.exitCode=1;});
