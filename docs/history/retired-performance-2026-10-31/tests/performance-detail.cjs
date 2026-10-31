'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const {scratch}=require('./support/annotation-scratch.cjs');
const {harness,sample,flush}=require('./player.cjs');
const {createCollector}=require('../plugin/performance-core.cjs');
const {breakdown}=require('../plugin/performance-stages.cjs');
const {createMonitor}=require('../plugin/performance-runtime.cjs');
const inbox=require('../plugin/performance-inbox.cjs'),report=require('../plugin/performance-report.cjs');
const protocol=require('../plugin/performance-protocol.cjs');
async function main(){
 const tmp=scratch('e40-detail'),monitors=[];let h;
 try{
  const migration=path.join(tmp.root,'migration');
  for(const id of ['old','recent']){
    const c=createCollector({now:()=>5});c.observe({type:'request',phase:'input',at:1,requestId:1,epoch:1,frameId:1,sourceTime:0});c.observe({type:'draw',at:2,requestId:1,epoch:1,frameId:1,time:0});c.end();
    await report.save(migration,{runId:id,mode:'manual',status:'completed',source:{sha256:'model'},code:{workspaceHash:'fixture'},environment:{model:true},measurementScope:'unit fixture'},c.snapshot());
  }
  const pending=await inbox.read(migration);assert.equal(pending.slots.manual,'recent');await inbox.replace(migration,'standard',pending.slots.standard,pending.slots.standard);
  const recent=JSON.parse(fs.readFileSync(path.join(migration,'runs/recent/manifest.json')));recent.analysis='complete';fs.writeFileSync(path.join(migration,'runs/recent/manifest.json'),JSON.stringify(recent));
  await inbox.acknowledge(migration,'recent');assert.equal((await inbox.read(migration)).slots.manual,null,'analysis must not resurrect older archived runs');
  const c=createCollector();h=harness({forwardPredecode:false,onEvent:e=>c.observe(e)});h.player.observePerformance=true;await h.load(sample('detail',null,40));
  await h.settle(h.player.seek(0,{final:true}));let row=c.snapshot().requests.at(-1),parts=breakdown(row,row.end);
  assert(parts.find(p=>p.name==='renderWait').ms>0,'RAM hit still waits for RAF');assert.equal(parts.find(p=>p.name==='other').ms,0);
  const a=h.gate(10),b=h.gate(20);const first=h.player.seek(1,{final:true});await flush();const second=h.player.seek(2,{final:true});await flush();
  const third=h.player.seek(3,{final:true});await h.elapse(25);a.resolve();b.resolve();await h.settle(third);await first;await second;
  row=c.snapshot().requests.at(-1);parts=breakdown(row,row.end);assert(parts.find(p=>p.name==='queue').ms>=25,'slot wait is independently observed: '+JSON.stringify(row));
  assert(Math.abs(parts.reduce((s,p)=>s+(p.ms||0),0)-row.latencyMs)<1e-6,'nested stages partition wall time');
  const g=h.gate(25);const one=h.player.seek(2.5,{final:true});await flush();await h.elapse(10);const joined=h.player.seek(2.5,{final:true});await flush();await h.elapse(20);g.resolve();await h.settle(joined);await one;
  row=c.snapshot().requests.at(-1);assert(row.stages.some(p=>p.name==='decode'&&p.end>p.start),'reused inflight decode belongs to latest target');assert(breakdown(row,row.end).find(p=>p.name==='other').ms<1);
  await h.close();h=null;
  const overlap=breakdown({start:0,end:100,status:'shown',readyAt:80,submitStartedAt:95,stages:[{name:'asset',start:0,end:60},{name:'prepare',start:0,end:40},{name:'readIO',start:40,end:60},{name:'decode',start:60,end:80},{name:'decodeNative',start:60,end:75},{name:'convert',start:75,end:80}]},100);
  assert.equal(overlap.reduce((s,p)=>s+(p.ms||0),0),100);assert.equal(overlap.find(p=>p.name==='prepare').ms,40);assert.equal(overlap.find(p=>p.name==='submit').ms,5);assert.equal(overlap.find(p=>p.name==='transfer').ms,null);
  let clock=0,serial=0,held=false,released=0;const context={source:{sha256:'model',duration:2},config:{backend:'proxy'},environment:{scope:'model'},proxyStage:'complete',canRun:true,
   measurementScope:'isolated model; not Eagle or real performance',holdIdleFill:()=>{held=true;return()=>{held=false;released++;};},cacheState:()=>({pending:held?0:1,decoded:[0],compressed:[]})};
  const root=path.join(tmp.root,'runtime');let runtime;
  const legacyValue={protocol:'ready-review-v2',options:protocol.FIXED,...protocol.identity(context)},legacyKey=protocol.hash(legacyValue);
  fs.mkdirSync(root);fs.writeFileSync(path.join(root,'test-conditions.json'),JSON.stringify({version:1,active:legacyKey,groups:[{key:legacyKey,value:legacyValue}]}));
  const migrated=await protocol.reference(root,context);assert.equal(migrated.version,'ready-review-v3');
  const groups=JSON.parse(fs.readFileSync(path.join(root,'test-conditions.json'))).groups;assert.equal(groups.length,2);assert.deepEqual(groups[0].value,legacyValue);
  await assert.rejects(protocol.reference(root,{...context,config:{backend:'jpeg'}}),/测试组不同/);
  const input=()=>{const id=++serial;clock+=20;runtime.observe({type:'request',phase:'input',at:clock,inputAt:clock,requestId:id,epoch:1,frameId:id,sourceTime:0,targetTime:0,cacheStateAtInput:'decoded'});clock+=2;runtime.observe({type:'draw',at:clock,requestId:id,epoch:1,frameId:id,time:0});};
  runtime=createMonitor({root:path.resolve(__dirname,'../plugin'),outputRoot:root,context:()=>context,now:()=>clock,pause:()=>{},seek:async(t,o)=>{const id=++serial;clock+=33;runtime.observe({type:'request',phase:'input',at:clock,inputAt:clock,requestId:id,epoch:1,frameId:id,sourceTime:t,targetTime:t,kind:o.kind,final:o.final,cacheStateAtInput:'decoded'});clock+=2;runtime.observe({type:'draw',at:clock,requestId:id,epoch:1,frameId:id,time:t});return{status:'drawn'};}});monitors.push(runtime);
  await runtime.start();input();const finishA=runtime.finish(),finishB=runtime.finish();assert.strictEqual(finishA,finishB,'double save shares one write');const saved=await finishA;const original=fs.readFileSync(path.join(saved.dir,'requests.json'));
  await runtime.start();input();assert((await runtime.finish()).needsConfirmation);assert.equal((await inbox.read(root)).slots.manual,saved.runId);assert.equal((await report.list(root)).length,1);
  const replacement=await runtime.finish('completed',null,{replace:true});assert.notEqual(replacement.runId,saved.runId);assert.deepEqual(fs.readFileSync(path.join(saved.dir,'requests.json')),original);
  assert.equal((await inbox.read(root)).slots.manual,replacement.runId);assert.equal((await inbox.acknowledge(root,saved.runId)).slots.manual,replacement.runId);
  fs.writeFileSync(path.join(root,'pending.json.next'),'interrupted');await assert.rejects(inbox.replace(root,'manual',null,replacement.runId),e=>e.code==='EEXIST');assert.equal((await inbox.read(root)).slots.manual,replacement.runId);fs.unlinkSync(path.join(root,'pending.json.next'));
  await runtime.start();input();await runtime.finish();await runtime.archive();assert.equal((await inbox.read(root)).slots.manual,replacement.runId,'declining overwrite keeps slot');
  const standard=await runtime.standard();assert.equal(standard.status,'completed');assert.equal(held,false);assert.equal(released,1);assert.equal((await inbox.read(root)).slots.standard,standard.runId);
  await report.validate(standard.dir);await inbox.acknowledge(root,replacement.runId);assert.equal((await inbox.read(root)).slots.manual,null);assert.equal((await inbox.read(root)).slots.standard,standard.runId);
  context.proxyStage='preparing';const count=(await report.list(root)).length;await assert.rejects(runtime.standard(),/代理/);assert.equal((await report.list(root)).length,count);
  await runtime.disable();await runtime.destroy();console.log('E40: RAM/RAF attribution, queue slots, shared inflight, nested intervals, durable pending slots/overwrite/refusal/interruption/ack, standard idle-fill hold/restore and preflight passed (models).');
 }finally{await h?.close();await Promise.allSettled(monitors.map(m=>m.destroy()));tmp.clean();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
