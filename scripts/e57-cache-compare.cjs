'use strict';
// Explicit developer-only deterministic scheduling comparison. No media/library
// writes, wall-clock decoder claims, UI report, installed plugin or telemetry.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),assert=require('assert/strict'),{execFileSync}=require('child_process');
const root=path.resolve(__dirname,'..'),baseline='8268b2d',out=path.join(root,'verification-runs/e57');
const sources={baseline:execFileSync('git',['show',baseline+':plugin/native-player.js'],{cwd:root,encoding:'utf8'}),candidate:fs.readFileSync(path.join(root,'plugin/native-player.js'),'utf8')};
const index=require('../plugin/frame-index.cjs'),common=require('../plugin/playback-common.js'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function run(code,scenario){
 let now=0,id=0;const timers=new Map(),stats={requests:0,cancels:0,completed:0,draws:[],audioPositions:0},schedule=(fn,ms=0)=>{const key=++id;timers.set(key,{at:now+Math.max(.01,ms),fn});return key;};
 const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
 const until=async target=>{let guard=0;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;assert(++guard<10000);timers.delete(next[0]);now=next[1].at;next[1].fn();await flush();}now=target;await flush();};
 let active;const reader={async request(n){stats.requests++;if(active)this.cancel();return new Promise(resolve=>{const work={resolve};active=work;work.timer=schedule(()=>{if(active===work)active=null;stats.completed++;resolve({status:'exact',pixels:Buffer.from([n,0,0,255]),metrics:{width:1,height:1}});},30);});},cancel(){if(active){stats.cancels++;timers.delete(active.timer);active.resolve({status:'superseded'});active=null;}},snapshot(){return {};}};
 const info={width:1,height:1,frames:Array.from({length:240},(_,n)=>({id:n,ptsTicks:String(n),timeBase:[1,60],time:n/60,end:(n+1)/60})),duration:4,metrics:{sourceVideoOrigin:0},source:{filePath:'owned-scheduling-model'},audio:null};
 const view={width:1,height:1,style:{},getContext:()=>({putImageData:im=>stats.draws.push({at:now,n:im.data[0]}),drawImage(){}})};
 const context={EVAPlaybackCommon:common,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},performance:{now:()=>now},setTimeout:schedule,clearTimeout:k=>timers.delete(k),module:{exports:{}},Buffer,console};
 vm.runInNewContext(code,context);const Player=context.module.exports.Player;
 const p=new Player({nativeRuntime:{nativeBytes:4096,createReader:async()=>reader,closeReader:async()=>{reader.cancel();return {ack:true};},subscribeProxy:()=>()=>{},proxyAsset:()=>null},frameIndex:{...index,validateIndex(){}},canvas:view,ramBytes:1024*1024,forwardPredecode:false,env:{now:()=>now,raf:fn=>schedule(fn,1000/60),caf:k=>timers.delete(k)}});
 const loading=p.load(info);await flush();await until(30);await loading;stats.draws=[];stats.requests=stats.cancels=stats.completed=0;
 const start=now,jobs=[];let end;
 if(scenario==='seek-then-play'){
  jobs.push(p.seek(20/60,{index:20,final:true}));await flush();await until(start+10);jobs.push(p.play());await flush();await until(start+70);await Promise.all(jobs);end=now;await p.pause();
 }else{
  const interval=scenario==='slow'?40:8,targets=scenario==='reverse'?[20,21,22,23,24,23,22,21,20,19,18,17]:Array.from({length:scenario==='slow'?20:50},(_,n)=>10+n);
  for(let i=0;i<targets.length;i++){await until(start+i*interval);const n=targets[i];jobs.push(p.seek(n/60,{index:n,kind:'rapid'}));await flush();}
  end=now;jobs.push(p.seek(targets.at(-1)/60,{index:targets.at(-1),final:true}));await flush();await until(end+60);await Promise.all(jobs);assert.equal(p.currentIndex,targets.at(-1));assert.equal(p.frameHeld,false);
 }
 const during=stats.draws.filter(d=>d.at<=end),gaps=[];let previous=start;for(const d of during){gaps.push(d.at-previous);previous=d.at;}gaps.push(end-previous);
 const row={scenario,scope:'virtual 30ms cancellable reads; not native/Eagle latency',requests:stats.requests,cancelled:stats.cancels,completed:stats.completed,usefulDrawsDuringInput:during.length,longestHeldMs:Math.max(...gaps),lastDrawMs:stats.draws.at(-1)?.at-start,draws:stats.draws,peakBytes:p.budget.peak};
 await p.dispose();assert.equal(p.budget.used,0);assert.equal(timers.size,0);return row;
}
async function main(){fs.mkdirSync(out,{recursive:true});const report={at:new Date().toISOString(),baseline,scope:'Deterministic same-input same-cost comparison, not actual media or P-01/P-02 acceptance',sources:Object.fromEntries(Object.entries(sources).map(([k,s])=>[k,sha(s)])),rows:[]};
 for(const scenario of ['slow','fast','reverse','seek-then-play'])for(const [name,code] of Object.entries(sources))report.rows.push({name,...await run(code,scenario)});
 const target=path.join(out,'scheduling-'+Date.now()+'.json');fs.writeFileSync(target,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({file:path.relative(root,target),rows:report.rows.map(({draws,...r})=>r)},null,2));
 const row=(name,scenario)=>report.rows.find(r=>r.name===name&&r.scenario===scenario);assert(row('candidate','fast').usefulDrawsDuringInput>row('baseline','fast').usefulDrawsDuringInput);assert(row('candidate','seek-then-play').requests<row('baseline','seek-then-play').requests);
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
