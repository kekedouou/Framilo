'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {scratch}=require('./support/annotation-scratch.cjs');
const {createCollector,metrics}=require('../plugin/performance-core.cjs');
const {explain,phases}=require('../plugin/performance-explainer.cjs');
const {createMonitor}=require('../plugin/performance-runtime.cjs');
const protocol=require('../plugin/performance-protocol.cjs'),report=require('../plugin/performance-report.cjs');
const {createProxyBackground}=require('../plugin/proxy-background.cjs');
const {proxyRanges}=require('../plugin/timeline-strip.js');
async function main(){
 const temp=scratch('e39-readable');let clock=0;
 try{
  const c=createCollector({now:()=>clock});c.sample({backend:'proxy',generating:true});
  c.observe({type:'request',phase:'input',at:0,inputAt:0,requestId:1,epoch:1,frameId:'a',sourceTime:0,targetTime:0,cacheStateAtInput:'disk'},{targetPrepared:false});
  clock=5;c.observe({type:'stage-begin',phase:'asset',at:clock,startedAt:clock,requestId:1,epoch:1});clock=120;
  let x=explain(c.snapshot(),{backend:'proxy'},clock);assert.equal(x.title,'分段准备中');assert.equal(x.phases[0].ms,115);
  x=explain(c.snapshot(),{backend:'proxy',previewActive:true},clock);assert.equal(x.title,'低清预览');
  c.observe({type:'stage',phase:'asset',at:clock,startedAt:5,requestId:1,epoch:1});c.observe({type:'stage-begin',phase:'decode',at:clock,startedAt:clock,requestId:1,epoch:1});
  assert.equal(explain(c.snapshot(),{},150).title,'解码中');clock=160;c.observe({type:'stage',phase:'decode',at:clock,startedAt:120,requestId:1,epoch:1});clock=170;c.observe({type:'draw',at:clock,drawAt:clock,requestId:1,epoch:1,frameId:'a',time:0});
  x=explain(c.snapshot(),{},clock);assert.equal(x.title,'画面已跟上');assert.equal(x.phases.find(p=>p.name==='submit').ms,10);assert.equal(x.phases.find(p=>p.name==='other').ms,5);
  assert.equal(phases({start:0,end:100,status:'shown',stages:[{name:'asset',start:0,end:80},{name:'decode',start:40,end:90}]},100).at(-1).ms,0,'overlaps cannot fabricate extra time');
  const ctx={source:{sha256:'fixture-source',duration:2,width:1280,height:720},config:{backend:'proxy',quality:'720p',ramBytes:536870912},environment:{host:'fixture'},canRun:true,proxyStage:'complete',cacheState:()=>({decoded:[0,1],compressed:[],pending:0})};
  const ref=await protocol.reference(temp.root,ctx);assert.equal(ref.verified,false);assert.equal((await protocol.reference(temp.root,ctx)).key,ref.key);
  await assert.rejects(protocol.reference(temp.root,{...ctx,config:{...ctx.config,quality:'1080p'}}),/不同/);
  assert.throws(()=>protocol.ready({...ctx,proxyStage:'budget'}),/全部就绪/);
  const changed=await protocol.reference(temp.root,{...ctx,config:{...ctx.config,quality:'1080p'}},{replace:true});assert.notEqual(changed.key,ref.key);
  let captures=0;await protocol.settleCache({capture:()=>({pending:++captures<3?1:0,decoded:[1]}),pollMs:1,stableMs:2});assert(captures>=4);
  await assert.rejects(protocol.settleCache({capture:()=>({pending:1}),timeoutMs:3,pollMs:1}),e=>e.code==='TIMEOUT');
  let serial=0,runtime;const events=[];
  runtime=createMonitor({root:path.resolve(__dirname,'../plugin'),outputRoot:path.join(temp.root,'runtime'),context:()=>ctx,now:()=>clock,pause:()=>{},
    onUpdate:v=>events.push(v.state),seek:async(t,o)=>{clock+=33;const id=++serial;runtime.observe({type:'request',phase:'input',at:clock,inputAt:clock,requestId:id,epoch:1,frameId:'f'+id,sourceTime:t,targetTime:t,cacheStateAtInput:'decoded',kind:o.kind,final:o.final});clock+=3;runtime.observe({type:'draw',at:clock,requestId:id,epoch:1,frameId:'f'+id,time:t});return{status:'drawn'};}});
  const saved=await runtime.standard();assert.equal(saved.status,'completed');const m=await report.json(path.join(saved.dir,'manifest.json'));assert(m.benchmark.verified);assert.equal((await report.json(path.join(saved.dir,'metrics.json'))).requests,288);assert(events.includes('warming')&&events.includes('testing'));await runtime.disable();await runtime.destroy();
  const original=fs.readFileSync(path.join(saved.dir,'report.html'),'utf8');assert(!original.includes('<pre>'));assert(!original.includes('workspaceHash'));assert(original.includes('P95'));assert(original.includes('视频解码'));
  assert.equal(report.compare({manifest:{...m,mode:'manual'},metrics:metrics(c.snapshot())},{manifest:m,metrics:metrics(c.snapshot())}).eligible,false);
  // Stop while preparation is awaiting disk IO must never restart the timed run.
  let cancelled,stopping=null,seeks=0;
  cancelled=createMonitor({root:path.resolve(__dirname,'../plugin'),outputRoot:path.join(temp.root,'cancelled'),context:()=>ctx,now:()=>clock,pause:()=>{},seek:()=>{seeks++;throw Error('cancelled preparation resumed');},onUpdate:v=>{if(v.state==='warming'&&!stopping)stopping=cancelled.stop();}});
  await cancelled.standard();await stopping;assert.equal(seeks,0);assert.equal(cancelled.view().state,'cancelled');assert.equal(cancelled.view().last,null);assert.equal((await report.list(path.join(temp.root,'cancelled'))).length,0);await cancelled.destroy();
  // A condition change is discarded and never enters the report.
  let changing,current=ctx;
  changing=createMonitor({root:path.resolve(__dirname,'../plugin'),outputRoot:path.join(temp.root,'changed'),context:()=>current,now:()=>clock,pause:()=>{},seek:async()=>{clock+=33;current={...ctx,config:{...ctx.config,quality:'1080p'}};return{status:'drawn'};}});
  const failed=await changing.standard();assert.equal(failed.status,'failed');assert(changing.view().error.includes('改变'));assert(failed.discarded);assert.equal((await report.list(path.join(temp.root,'changed'))).length,0);await changing.destroy();
  // Closing during preparation remains closed; a later start cannot create timers.
  let closing,closingPromise=null;
  closing=createMonitor({root:path.resolve(__dirname,'../plugin'),outputRoot:path.join(temp.root,'closed'),context:()=>ctx,now:()=>clock,pause:()=>{},seek:()=>{throw Error('closed preparation resumed');},onUpdate:v=>{if(v.state==='warming'&&!closingPromise)closingPromise=closing.destroy();}});
  await closing.standard();await closingPromise;await assert.rejects(()=>closing.start(),/关闭/);assert.equal(closing.view().last,null);assert.equal((await report.list(path.join(temp.root,'closed'))).length,0);
  const gate={};gate.promise=new Promise(resolve=>gate.resolve=resolve);
  const bg=createProxyBackground({info:{segments:[{start:0,end:1},{start:1,end:2},{start:2,end:3}]},prepare:()=>{},release:async()=>{},enqueue:f=>f(),idle:()=>false,budget:()=>({}),closeBatch:async()=>{},emit:()=>{},onSegment:n=>n===1?gate.promise:undefined});
  bg.mark(0);assert.deepEqual(bg.snapshot().readyRanges,[]);await bg.retain(0,{leaseId:'0'});await bg.retain(2,{leaseId:'2'});
  assert.deepEqual(bg.snapshot().readyRanges,[{start:0,end:1},{start:2,end:3}]);const retaining=bg.retain(1,{leaseId:'1'});assert.equal(bg.snapshot().readyRanges.length,2,'unpublished segment stays absent');gate.resolve();await retaining;
  assert.deepEqual(bg.snapshot().readyRanges,[{start:0,end:3}]);assert.deepEqual(proxyRanges([{start:0,end:1},{start:2,end:3}],{start:.5,end:2.5},200),[{x:0,width:50},{x:150,width:50}]);await bg.close();assert.deepEqual(bg.snapshot().readyRanges,[]);
  console.log('E39: live waiting/preview/exact stages, overlaps, fixed-reference reopen/change guards, warmup excluded, 288 fixed inputs, stop/change/close while preparing, plain report, published-only proxy coverage passed; models only.');
 }finally{temp.clean();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
