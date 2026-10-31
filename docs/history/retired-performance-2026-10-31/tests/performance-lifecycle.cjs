'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {scratch}=require('./support/annotation-scratch.cjs');
const {createMonitor}=require('../plugin/performance-runtime.cjs');
const report=require('../plugin/performance-report.cjs'),inbox=require('../plugin/performance-inbox.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const temp=scratch('e41-performance'),monitors=[];let clock=0,serial=0;
 const context={source:{sha256:'fixture',duration:10},config:{backend:'proxy'},measurementScope:'isolated lifecycle model; no performance claim'};
 function create(name,limits={}){const m=createMonitor({root:path.resolve(__dirname,'../plugin'),outputRoot:path.join(temp.root,name),context:()=>context,now:()=>clock,collectorLimits:limits,drainTimeoutMs:50,seek:()=>{},pause:()=>{}});monitors.push(m);return m;}
 function input(m){const id=++serial;clock+=10;m.observe({type:'request',phase:'input',at:clock,inputAt:clock,epoch:1,requestId:id,frameId:id,sourceTime:0,targetTime:0});return id;}
 function draw(m,id){clock+=2;m.observe({type:'draw',at:clock,epoch:1,requestId:id,frameId:id,time:0});}
 try{
  const bounded=require('../plugin/performance-core.cjs').createCollector({now:()=>clock,excludeThrough:{sessionEpoch:3,epoch:2,requestId:7}});
  bounded.observe({type:'draw',at:clock,epoch:2,requestId:7},{sessionEpoch:3});assert.equal(bounded.snapshot().capacity.orphanEvents,0,'pre-capture request completions are outside the window');
  bounded.observe({type:'draw',at:clock,epoch:2,requestId:8},{sessionEpoch:3});assert.equal(bounded.snapshot().capacity.orphanEvents,1,'genuinely missing admitted identities are still rejected');
  const m=create('capacity',{events:20});await m.start();for(let n=0;n<100;n++)draw(m,input(m));
  for(let n=0;n<250&&m.view().state!=='review';n++)await wait(10);
  assert.equal(m.view().state,'review');assert.match(m.view().notice,/上限/);
  const saved=m.view().last;await report.validate(saved.dir);const d=await report.json(path.join(saved.dir,'requests.json'));
  assert.equal(d.requests.length,8);assert(!d.capacity.truncated);assert.equal(d.capacity.orphanEvents,0);assert(d.requests.every(r=>r.status==='shown'));
  // New input after stopping admission cannot contaminate pending completions.
  const drain=create('drain');await drain.start();const id=input(drain),finished=drain.finish();await wait(5);input(drain);draw(drain,id);
  const drained=await finished;assert.equal((await report.json(path.join(drained.dir,'requests.json'))).requests.length,1);
  const timeout=create('timeout');await timeout.start();input(timeout);const timed=await timeout.finish();
  assert.equal((await report.json(path.join(timed.dir,'metrics.json'))).outcomes.timeout,1,'bounded capture timeout is explicit, not a fake successful frame');
  // A save failure leaves memory retryable and removes only its unpublished files.
  const failure=create('failure');await failure.start();draw(failure,input(failure));const original=fs.promises.writeFile;let injected=false;
  fs.promises.writeFile=async function(file,...args){if(!injected&&String(file).endsWith('metrics.json')){injected=true;throw Error('model disk full');}return original.call(this,file,...args);};
  try{await assert.rejects(failure.finish(),/disk full/);}finally{fs.promises.writeFile=original;}
  assert(failure.view().needsConfirmation);assert.equal(fs.readdirSync(path.join(temp.root,'failure/runs')).length,0);
  const retried=await failure.finish();await report.validate(retried.dir);assert.equal((await report.list(path.join(temp.root,'failure'))).length,1);
  const indexFailure=create('index-failure');await indexFailure.start();draw(indexFailure,input(indexFailure));const originalIndex=report.index;
  report.index=async()=>{throw Error('model index failure');};
  try{await assert.rejects(indexFailure.finish(),/index failure/);}finally{report.index=originalIndex;}
  const indexRetried=await indexFailure.finish();assert(indexRetried.runId);assert(!indexRetried.needsConfirmation);await report.validate(indexRetried.dir);
  assert.equal((await report.list(path.join(temp.root,'index-failure'))).length,1,'retry after pointer publication never asks to overwrite itself or duplicates a run');
  await failure.start();draw(failure,input(failure));assert((await failure.finish()).needsConfirmation);await failure.archive();
  assert.equal((await report.list(path.join(temp.root,'failure'))).length,1);assert.equal((await inbox.read(path.join(temp.root,'failure'))).slots.manual,retried.runId);
  const stopped=create('stopped');await stopped.start();draw(stopped,input(stopped));const discarded=await stopped.stop();assert(discarded.discarded);assert.equal((await report.list(path.join(temp.root,'stopped'))).length,0);
  const invalid=JSON.parse(JSON.stringify(d));invalid.capacity.truncated=true;
  await assert.rejects(report.save(path.join(temp.root,'capacity'),{...(await report.json(path.join(saved.dir,'manifest.json'))),runId:report.runId()},invalid),/截断/);
  assert.equal((await report.entries(path.join(temp.root,'capacity'))).length,1);
  // A restarted host removes a confirmed dead writer's staging folder only.
  const root=path.join(temp.root,'recover'),stage=path.join(root,'runs/.pending-interrupted');fs.mkdirSync(stage,{recursive:true});
  fs.writeFileSync(path.join(stage,'owner.json'),JSON.stringify({owner:'eva-performance-stage-v1',runId:'interrupted',pid:2147483647}));fs.writeFileSync(path.join(stage,'requests.json'),'partial');
  await report.recover(root);assert(!fs.existsSync(stage));
  console.log('E41 record lifecycle: capacity auto-save, draining/new input, explicit timeout, failed-save retry, overwrite refusal, cancellation discard, invalid rejection, restart staging cleanup passed.');
 }finally{await Promise.allSettled(monitors.map(m=>m.destroy()));temp.clean();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
