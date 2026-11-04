'use strict';
// Explicit check: existing owned E52 media, unchanged native executable, Node sink.
// No media output, Eagle, audio playback, library/preferences or ZIP writes.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{execFileSync}=require('child_process');
const {codes,playerClass,save,sha}=require('./seek-reuse-compare.cjs'),{FilmcraftClient}=require('../plugin/native-reader.cjs'),{inspect}=require('../plugin/native-backend.cjs'),index=require('../plugin/frame-index.cjs');
const root=path.resolve(__dirname,'..'),exe=path.join(root,'plugin/bin/filmcraft-media.exe'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const locate=name=>execFileSync('where.exe',[name],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
async function run(code,info,file,software,scenario){
 if(global.gc){global.gc();await sleep(25);}let client,lastPixels,closed,requests=0,cancels=0;const events=[];
 const Player=playerClass(code,{EVANativeRenderer:{create:()=>({render:(pixels,h)=>{lastPixels=Buffer.from(pixels);return h;},dispose(){}})}});
 const runtime={nativeBytes:128*1024**2,async createReader(){client=new FilmcraftClient({exe,source:file,frames:info.frames,software,height:info.preview.quality==='2160p'?2160:720,width:info.width,outputHeight:info.height,gpuDrawing:!software,cacheBytes:this.nativeBytes});await client.ready;
  const request=client.request.bind(client),cancel=client.cancel.bind(client);client.request=n=>{requests++;return request(n);};client.cancel=()=>{cancels++;return cancel();};return client;},
  async closeReader(r){closed=await r.close();return closed;},subscribeProxy:()=>()=>{},proxyAsset:()=>null};
 const canvas={width:1,height:1,style:{},getContext:()=>({drawImage(){},putImageData:im=>{lastPixels=Buffer.from(im.data);}})};
 const p=new Player({nativeRuntime:runtime,frameIndex:index,canvas,ramBytes:512*1024**2,forwardPredecode:process.argv.includes('--window'),emit:e=>events.push(e),env:{now:()=>performance.now(),raf:fn=>setTimeout(fn,16),caf:clearTimeout}}),result={software,scenario,width:info.width,height:info.height};
 try{
  await p.load({...info,audio:null});events.length=0;requests=cancels=0;
  const last=info.frames.length-1,startFrame=Math.min(10,Math.floor(last/4)),offsets=scenario==='slow-forward'?Array.from({length:16},(_,n)=>n):[8,9,10,11,12,11,10,9,8,7,6,7,8,9,8,7];
  const targets=scenario==='promote-fill'?[1]:offsets.map(n=>Math.min(last,startFrame+n)),interval=scenario==='slow-forward'?40:24,at=performance.now(),jobs=[];
  if(scenario==='promote-fill'){
   p.setForwardPredecode(true);clearTimeout(p.fillTimer);p.fillTimer=undefined;p._fillAround();await Promise.resolve();assert.equal(client.current.target.ordinal,1);
   jobs.push(p.seek(info.frames[1].time,{index:1,kind:'rapid'}));p.setForwardPredecode(false);
  }else for(let i=0;i<targets.length;i++){await sleep(Math.max(0,at+i*interval-performance.now()));const n=targets[i];jobs.push(p.seek(info.frames[n].time,{index:n,kind:'rapid'}));}
  const released=performance.now(),n=targets.at(-1),final=await p.seek(info.frames[n].time,{index:n,final:true});const releaseMs=performance.now()-released;await Promise.all(jobs);
  assert(['drawn','reused'].includes(final.status));assert.equal(p.currentIndex,n);assert.equal(p.frameHeld,false);assert.equal(client.stats.wrong,0);assert.equal(client.stats.errors,0);
  const draws=events.filter(e=>e.type==='draw'||e.type==='reused'&&!e.repeatedFrame),during=draws.filter(e=>e.at<=released),gaps=[];let previous=at;for(const e of during){gaps.push(e.at-previous);previous=e.at;}gaps.push(released-previous);
  Object.assign(result,{requests,cancelCalls:cancels,releaseMs,finalOrdinal:n,sha256:sha(lastPixels),usefulDraws:during.length,longestHeldMs:Math.max(...gaps),peakBytes:p.budget.peak,pixelFormat:client.stats.last.pixelFormat,hwFrames:client.stats.hwFrames,hwFallbacks:client.stats.hwFallbacks,draws:draws.map(e=>({ms:e.at-at,kind:e.kind||e.type,frameId:e.frameId})),readMetrics:events.filter(e=>e.type==='draw'&&e.nativeMetrics).map(e=>e.nativeMetrics)});
  // Compare the final pixels to an independent exact request on the same source.
  p.setForwardPredecode(false);const reference=await client.request(n);assert.equal(reference.status,'exact');assert.equal(sha(reference.pixels),result.sha256);assert(p.budget.peak<=p.budget.limit);
 }catch(e){result.failure=e.stack;throw e;}finally{await p.dispose();if(client&&!closed)closed=await client.close();assert.equal(p.budget.used,0);if(client){assert.equal(closed?.ack?.cacheBytes,0);assert.equal(closed?.ack?.liveDecoders,0);}result.close=closed;}
 return result;
}
async function main(){const promotion=process.argv.includes('--promotion-only'),source=codes(),tools={ffmpeg:locate('ffmpeg'),ffprobe:locate('ffprobe')},report={at:new Date().toISOString(),node:process.version,baseline:process.argv.includes('--window')?'2a5f6b3':'e2ffd0c',forwardPredecode:process.argv.includes('--window'),scope:'Actual native source reads, Node canvas sink; no browser/GPU drawing/audio/Eagle; no ready whole-proxy test',promotionOnly:promotion,ramBytes:512*1024**2,nativeBytes:128*1024**2,gcPolicy:global.gc?'explicit GC and25ms before each run':'ordinary GC',executableSha256:sha(fs.readFileSync(exe)),sources:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,sha(v)])),rows:[]};
 try{for(const name of ['h264.mp4','uhd709.mp4']){const file=path.join(root,'verification-runs/e52/formats',name),hash=sha(fs.readFileSync(file)),info=await inspect({filePath:file},tools,name==='uhd709.mp4'?'2160p':'720p');
   for(const software of [true,false])for(const scenario of promotion?['promote-fill']:['slow-forward','back-and-forth'])for(let round=0;round<(promotion?1:2);round++){const pair=[];
    for(const variant of round%2?['candidate','baseline']:['baseline','candidate']){if(Date.now()-Date.parse(report.at)>8*60*1000)throw Error('Stop before10-minute media budget');const row={name,sourceSha256:hash,round,variant,...await run(source[variant],info,file,software,scenario)};report.rows.push(row);pair.push(row);console.log(JSON.stringify({name,software,scenario,round,variant,usefulDraws:row.usefulDraws,releaseMs:row.releaseMs,longestHeldMs:row.longestHeldMs}));}
    assert.equal(pair[0].sha256,pair[1].sha256);assert.equal(pair[0].finalOrdinal,pair[1].finalOrdinal);
    if(promotion){assert.equal(pair.find(r=>r.variant==='candidate').requests,1);assert.equal(pair.find(r=>r.variant==='candidate').cancelCalls,0);assert.equal(pair.find(r=>r.variant==='baseline').requests,2);}
   }assert.equal(sha(fs.readFileSync(file)),hash);
  }report.passed=true;
 }catch(e){report.failure=e.stack;throw e;}finally{report.completed=new Date().toISOString();save(report,'native');}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
