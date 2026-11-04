'use strict';
// Explicit bounded developer comparison. Models do not measure native/Eagle speed.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert/strict'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),baseline=process.argv.includes('--window')?'2a5f6b3':'e2ffd0c',out=path.join(root,'verification-runs/seek-reuse');
const common=require('../plugin/playback-common.js'),index=require('../plugin/frame-index.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function codes(){return {baseline:execFileSync('git',['show',baseline+':plugin/native-player.js'],{cwd:root,encoding:'utf8',windowsHide:true}),candidate:fs.readFileSync(path.join(root,'plugin/native-player.js'),'utf8')};}
function save(report,prefix){
 fs.mkdirSync(out,{recursive:true});let used=0;for(const name of fs.readdirSync(out)){const s=fs.lstatSync(path.join(out,name));if(!s.isFile()||s.isSymbolicLink())throw Error('Unexpected evidence entry');used+=s.size;}
 const bytes=JSON.stringify(report,null,2);if(used+Buffer.byteLength(bytes)>16*1024**2)throw Error('Evidence budget reached');
 const file=path.join(out,prefix+'-'+Date.now()+'.json');fs.writeFileSync(file,bytes,{flag:'wx'});console.log(path.relative(root,file));return file;
}
function playerClass(code,env={}){const context={EVAPlaybackCommon:common,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},Buffer,performance,setTimeout,clearTimeout,module:{exports:{}},...env};vm.runInNewContext(code,context);return context.module.exports.Player;}
async function model(code,spec){
 let now=0,serial=0,active=null,latest=0;const timers=new Map(),draws=[],events=[],stats={requests:0,cancels:0,completed:0};
 const schedule=(fn,ms=0)=>{const id=++serial;timers.set(id,{at:now+Math.max(.01,ms),fn});return id;},flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
 const until=async end=>{let count=0;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;assert(++count<10000);timers.delete(next[0]);now=next[1].at;next[1].fn();await flush();}now=end;await flush();};
 const reader={request(n){stats.requests++;assert.equal(active,null,'overlapping reader dispatch');return new Promise(resolve=>{const job={resolve,n};active=job;job.timer=schedule(()=>{active=null;stats.completed++;resolve({status:'exact',pixels:Buffer.from([n,0,0,255]),metrics:{width:1,height:1}});},spec.cost(n));});},cancel(){if(active){stats.cancels++;timers.delete(active.timer);active.resolve({status:'superseded'});active=null;}},snapshot:()=>({})};
 const frames=Array.from({length:180},(_,n)=>({id:n,ptsTicks:String(n),timeBase:[1,60],time:n/60,end:(n+1)/60}));
 const view={width:1,height:1,style:{},getContext:()=>({putImageData:im=>draws.push({at:now,frame:im.data[0],target:latest,lagFrames:Math.abs(latest-im.data[0])})})};
 const Player=playerClass(code,{performance:{now:()=>now},setTimeout:schedule,clearTimeout:id=>timers.delete(id)});
 const p=new Player({nativeRuntime:{nativeBytes:4096,createReader:async()=>reader,closeReader:async()=>{reader.cancel();return {ack:true};},proxyAsset:()=>null,subscribeProxy:()=>()=>{}},frameIndex:{...index,validateIndex(){}},canvas:view,ramBytes:1024**2,forwardPredecode:false,emit:e=>events.push(e),env:{now:()=>now,raf:fn=>schedule(fn,16),caf:id=>timers.delete(id)}});
 try{
  const loading=p.load({width:1,height:1,frames,duration:3,source:{filePath:'owned-virtual-model'},audio:null});await flush();await until(300);await loading;
  if(spec.start){latest=spec.start;const seek=p.seek(latest/60,{index:latest,final:true});await until(now+300);await seek;}
  draws.length=events.length=0;stats.requests=stats.cancels=stats.completed=0;const start=now,jobs=[];
  if(spec.promotion){p.setForwardPredecode(true);await until(now+.01);await until(now+spec.cost(1)/2);latest=1;jobs.push(p.seek(1/60,{index:1,final:true}));}
  else for(let i=0;i<spec.targets.length;i++){await until(start+i*spec.interval);latest=spec.targets[i];jobs.push(p.seek(latest/60,{index:latest,kind:'rapid'}));}
  await until(now+5);const released=now;latest=spec.final??latest;const final=p.seek(latest/60,{index:latest,final:true});
  // Stop precisely when the final intent resolves; idle prefetch must not pollute stats.
  let result,releaseAt;final.then(r=>{result=r;releaseAt=now;});await flush();for(let i=0;i<200&&!result;i++)await until(now+5);assert(result,'final target did not settle');await Promise.all(jobs);
  assert.equal(p.currentIndex,latest);assert.equal(p.frameHeld,false);assert(['drawn','reused'].includes(result.status));assert(p.budget.peak<=p.budget.limit);
  const during=draws.filter(d=>d.at<=released),gaps=[];let last=start;for(const d of during){gaps.push(d.at-last);last=d.at;}gaps.push(released-last);
  return {name:spec.name,...stats,usefulDraws:during.length,longestHeldMs:Math.max(...gaps),releaseMs:releaseAt-released,finalOrdinal:p.currentIndex,peakBytes:p.budget.peak,maxDisplayedLagFrames:Math.max(0,...during.map(d=>d.lagFrames)),draws:draws.map(d=>({...d,at:d.at-start})),outcomes:events.filter(e=>['reused','superseded','error'].includes(e.type)).reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{})};
 }finally{await p.dispose();await flush();assert.equal(p.budget.used,0);assert.equal(timers.size,0);assert.equal(active,null);}
}
function scenarios(){const forward=Array.from({length:20},(_,n)=>10+n),back=Array.from({length:20},(_,n)=>49-n),reverse=[40,41,42,43,44,43,42,41,40,39,38,39,40,41,42,43,42,41,40];return [
 ...[10,30,60,100].flatMap(ms=>[{name:'slow-forward-'+ms,cost:()=>ms,targets:forward,interval:40},{name:'back-and-forth-'+ms,cost:()=>ms,targets:reverse,interval:40},{name:'release-different-'+ms,cost:()=>ms,targets:forward,interval:20,final:35}]),
 {name:'slow-backward-60',cost:()=>60,start:50,targets:back,interval:40},
 {name:'cost-spike',cost:n=>n<17?10:90,targets:forward,interval:40},
 {name:'deadline-180',cost:()=>180,targets:forward,interval:20},
 {name:'duplicate-100',cost:()=>100,targets:Array(20).fill(20),interval:20},
 {name:'promote-fill-60',cost:()=>60,promotion:true}
 ];}
async function main(){const source=codes(),report={at:new Date().toISOString(),baseline,node:process.version,scope:'Deterministic cancellable reads, virtual ms; no physical transfer, drawing, audio or Eagle measurement',sources:Object.fromEntries(Object.entries(source).map(([k,v])=>[k,sha(v)])),rows:[]};
 try{for(const spec of scenarios())for(const [variant,code] of Object.entries(source)){const row={variant,...await model(code,spec)};report.rows.push(row);const {name,usefulDraws,longestHeldMs,releaseMs,cancels}=row;console.log(JSON.stringify({variant,name,usefulDraws,longestHeldMs,releaseMs,cancels}));}report.passed=true;}
 catch(e){report.failure=e.stack;throw e;}finally{save(report,'model');}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={codes,playerClass,save,sha,model,scenarios};
