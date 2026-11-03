'use strict';
// Explicit E57 check on existing E52 owned synthetic files only. No media
// generation, Eagle interaction, original user video or audio acceptance.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert/strict'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'verification-runs/e57'),baseline='8268b2d';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sources={baseline:execFileSync('git',['show',baseline+':plugin/native-player.js'],{cwd:root,encoding:'utf8'}),candidate:fs.readFileSync(path.join(root,'plugin/native-player.js'),'utf8')};
const {FilmcraftClient}=require('../plugin/native-reader.cjs'),{inspect}=require('../plugin/native-backend.cjs'),index=require('../plugin/frame-index.cjs'),common=require('../plugin/playback-common.js');
const oldWire={exports:{}};vm.runInNewContext(execFileSync('git',['show',baseline+':plugin/native-wire.cjs'],{cwd:root,encoding:'utf8'}),{module:oldWire,Buffer});
const oldReader={exports:{}};vm.runInNewContext(execFileSync('git',['show',baseline+':plugin/native-reader.cjs'],{cwd:root,encoding:'utf8'}),{module:oldReader,Buffer,setTimeout,clearTimeout,require:n=>n==='./native-wire.cjs'?oldWire.exports:require(n)});
const binary=n=>execFileSync('where.exe',[n],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];
const tools={ffmpeg:binary('ffmpeg'),ffprobe:binary('ffprobe')},exe=path.join(root,'plugin/bin/filmcraft-media.exe');
async function run(code,info,file,software,variant){
 if(global.gc){global.gc();await sleep(25);}
 let client,close,requests=0,cancels=0,lastPixels;const events=[];
 const context={EVAPlaybackCommon:common,EVANativeRenderer:{create:()=>({render:(pixels,h)=>{lastPixels=pixels;return h;},dispose(){}})},ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},setTimeout,clearTimeout,performance,Buffer,module:{exports:{}},console};
 vm.runInNewContext(code,context);const Player=context.module.exports.Player;
 const Client=variant==='baseline'?oldReader.exports.FilmcraftClient:FilmcraftClient;
 const runtime={nativeBytes:128*1024**2,async createReader(){client=new Client({exe,source:file,frames:info.frames,software,height:info.height>720?2160:720,width:info.width,outputHeight:info.height,gpuDrawing:!software,cacheBytes:this.nativeBytes});await client.ready;const read=client.request.bind(client),cancel=client.cancel.bind(client);client.request=n=>{requests++;return read(n);};client.cancel=()=>{cancels++;return cancel();};return client;},async closeReader(r){close=await r.close();return close;},subscribeProxy:()=>()=>{},proxyAsset:()=>null};
 const canvas={width:1,height:1,style:{},getContext:()=>({putImageData:im=>{lastPixels=im.data;},drawImage(){}})};
 const p=new Player({nativeRuntime:runtime,frameIndex:index,canvas,ramBytes:512*1024**2,forwardPredecode:false,emit:e=>events.push(e),env:{now:()=>performance.now(),raf:fn=>setTimeout(fn,16),caf:clearTimeout}});
 const result={software,width:info.width,height:info.height,scope:'Real native reader + Node canvas sink, no browser layout/GPU drawing/audio/Eagle',draws:[]};
 try{await p.load({...info,audio:null});events.length=0;const start=performance.now(),jobs=[],targets=Array.from({length:20},(_,i)=>Math.min(info.frames.length-1,10+i));
  for(let i=0;i<targets.length;i++){const at=start+i*8;await sleep(Math.max(0,at-performance.now()));const n=targets[i];jobs.push(p.seek(info.frames[n].time,{index:n,kind:'rapid'}));}
  const release=performance.now(),n=targets.at(-1);await p.seek(info.frames[n].time,{index:n,final:true});await Promise.all(jobs);assert.equal(p.currentIndex,n);assert.equal(p.frameHeld,false);
  result.releaseMs=performance.now()-release;result.finalOrdinal=n;result.sha256=sha(lastPixels);result.requests=requests;result.cancelCalls=cancels;result.seekReadMs=p.seekReadMs;result.pixelFormat=client.stats.last?.pixelFormat;result.hwFrames=client.stats.hwFrames;result.hwFallbacks=client.stats.hwFallbacks;result.draws=events.filter(e=>e.type==='draw').map(e=>({ms:e.at-start,kind:e.kind,frameId:e.frameId}));result.drawsBeforeRelease=result.draws.filter(e=>e.ms<release-start).length;
  const warm=performance.now();for(const ordinal of [n,n-1,n]){const locating=p.seek(info.frames[ordinal].time,{index:ordinal,final:true});await locating;}result.revisitMs=performance.now()-warm;result.peakBytes=p.budget.peak;
 }catch(e){result.failure=e.stack;throw e;}finally{await p.dispose();if(client&&!close)close=await client.close();assert.equal(p.budget.used,0);if(client&&!result.failure)assert(close?.ack);result.close=close;}
 return result;
}
async function main(){fs.mkdirSync(out,{recursive:true});const report={at:new Date().toISOString(),scope:'Bounded independent native scheduling/pixel smoke, not P-01/P-02, browser or Eagle acceptance',gcPolicy:global.gc?'explicit GC and25ms idle before each fresh reader workload':'ordinary process GC; sequential VM/frame buffers may bias timing',baseline,executableSha256:sha(fs.readFileSync(exe)),sources:Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,sha(s)])),transport:Object.fromEntries(['native-reader.cjs','native-wire.cjs'].map(name=>[name,{baseline:sha(execFileSync('git',['show',baseline+':plugin/'+name],{cwd:root})),candidate:sha(fs.readFileSync(path.join(root,'plugin',name)))}])),rows:[]};const target=path.join(out,'native-cache-'+Date.now()+'.json'),save=()=>fs.writeFileSync(target,JSON.stringify(report,null,2));
 try{for(const name of ['h264.mp4','uhd709.mp4']){const file=path.join(root,'verification-runs/e52/formats',name),sourceSha=sha(fs.readFileSync(file)),quality=name.startsWith('uhd')?'2160p':'720p',info=await inspect({filePath:file},tools,quality);
   for(const software of [true,false])for(let round=0;round<3;round++){const rows=[];for(const variant of round%2?['candidate','baseline']:['baseline','candidate']){const row={name,sourceSha,round,variant,...await run(sources[variant],info,file,software,variant)};rows.push(row);report.rows.push(row);save();console.log(JSON.stringify({name,software,round,variant,requests:row.requests,drawsBeforeRelease:row.drawsBeforeRelease,releaseMs:row.releaseMs}));}assert.equal(rows[0].sha256,rows[1].sha256,'Final source pixels changed');}
   assert.equal(sha(fs.readFileSync(file)),sourceSha);if(Date.now()-Date.parse(report.at)>9*60*1000)throw Error('E57 duration budget reached');}
  report.passed=true;
 }catch(e){report.failure=e.stack;throw e;}finally{report.completed=new Date().toISOString();save();console.log(path.relative(root,target));}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
