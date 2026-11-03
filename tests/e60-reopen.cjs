'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {pendingLegacy,cleanLegacy}=require('../plugin/legacy-media-cleanup.cjs');
const {harness}=require('./t1-app.cjs'),{harness:uiHarness}=require('./timeline-ui.cjs');
const tick=()=>new Promise(r=>setTimeout(r,5));
function fixture(){const base=path.resolve(__dirname,'../verification-runs/e60');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'audit-fixture-'));fs.mkdirSync(path.join(root,'cache'));return{root,cache:path.join(root,'cache'),dispose(){assert(fs.realpathSync(root).startsWith(fs.realpathSync(base)+path.sep));fs.rmSync(root,{recursive:true});}};}
test('receipt-only legacy root does not start a maintenance worker, change receipts or create locks',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.cache,'owner.json'),'preserve owner');
  for(let i=0;i<160;i++){const name='cleanup-'+i.toString(16).padStart(24,'0');for(const suffix of ['.json','.result.json'])fs.writeFileSync(path.join(f.cache,name+suffix),'preserve historical bytes');}
  for(const d of ['sessions-v1','e44-whole/whole-v1','e44-whole/leases-v1'])fs.mkdirSync(path.join(f.cache,d),{recursive:true});
  const before=fs.readdirSync(f.cache).sort(),phases=[];
  assert.deepEqual(await pendingLegacy(f.root),{sequence:false,proxy:false});
  await cleanLegacy({pluginRoot:f.root,createClient(){assert.fail('receipt-only root must not launch worker');},onPhase:p=>phases.push(p)});
  assert.deepEqual(phases,['preflight','settled']);assert.deepEqual(fs.readdirSync(f.cache).sort(),before);
  for(const n of before.filter(n=>n.startsWith('cleanup-')))assert.equal(fs.readFileSync(path.join(f.cache,n),'utf8'),'preserve historical bytes');
 }finally{f.dispose();}
});
test('old media, incomplete receipts and unknown files still use existing validation; active proxy stays work',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.cache,'owner.json'),'fixture');
  for(const name of ['media-'+ 'a'.repeat(64)+'-'+ 'b'.repeat(12),'writer.lock','cleanup-'+ 'c'.repeat(24)+'.json','reap-'+ 'd'.repeat(24)+'.json','unknown.bin']){
   fs.writeFileSync(path.join(f.cache,name),'untouched');assert.equal((await pendingLegacy(f.root)).sequence,true);
   let stopped=false;await assert.rejects(cleanLegacy({pluginRoot:f.root,createClient:()=>({cache:{clearOther:async()=>{throw Error('old validator retained data');}},close:async()=>{stopped=true;}})}),/old validator/);
   assert(stopped);assert.equal(fs.readFileSync(path.join(f.cache,name),'utf8'),'untouched');fs.unlinkSync(path.join(f.cache,name));
  }
  fs.mkdirSync(path.join(f.cache,'e44-whole/leases-v1'),{recursive:true});fs.writeFileSync(path.join(f.cache,'e44-whole/leases-v1/active.json'),'untouched');
  assert.equal((await pendingLegacy(f.root)).proxy,true);
 }finally{f.dispose();}
});
test('slow close shows waiting state, delayed hide cannot suppress it, latest run alone opens',async()=>{
 let release,finishHide,shown=0,selected=0;
 const gate=new Promise(r=>release=r),hidden=new Promise(r=>finishHide=r);
 const h=harness({closeSession:()=>gate,capture:async()=>({id:'selection-'+(++selected)}),hostWindow:{hide:()=>hidden,show:async()=>shown++}});
 await h.hooks.onPluginCreate({path:h.root});const beforeShown=shown,closing=h.hooks.onPluginBeforeExit();
 const first=h.hooks.onPluginRun(),latest=h.hooks.onPluginRun();await tick();
 assert.equal(h.updates.at(-1).reopening,true);assert.equal(h.log.filter(x=>x.type==='selected').length,1);
 finishHide();await tick();assert.equal(shown-beforeShown,1,'only latest pending run restores after delayed hide');
 release({status:'closed'});await Promise.all([closing,first,latest]);assert.equal(h.log.filter(x=>x.type==='selected').length,2);
 assert.equal((await h.config.eagleAdapter.captureSelected()).id,'selection-3');await h.hooks.onPluginBeforeExit();
});
test('explicit close cancels queued reopen and actual native exit remains allowed',async()=>{
 let release;const gate=new Promise(r=>release=r);const h=harness({closeSession:()=>gate,deferNativeAck:true});
 await h.hooks.onPluginCreate({path:h.root});h.requestClose();const reopening=h.hooks.onPluginRun();await h.ui.hostAction('close');
 release({status:'closed'});await reopening;await h.flushNativeTasks();assert.equal(h.windowState().destroyed,true);assert.equal(h.log.filter(x=>x.type==='selected').length,1);
});
test('legacy failure stays retryable after temporary media deletion, without reopening early',async()=>{
 let attempts=0;const h=harness({modules:{'native-backend.cjs':{createNativeBackend:()=>({media:{prepare:async()=>({})},cache:{release:async()=>{}},beginClose(){},close:async()=>{},retireLegacy:async()=>{if(++attempts===1)throw Error('legacy still pending');}})}}});
 await h.hooks.onPluginCreate({path:h.root});const prepared=h.config.media.prepare({filePath:'D:/fixture.mp4'},{playbackBackend:'proxy'});await tick();h.discoveries[0].resolve({ffmpeg:'model-only'});await prepared;
 await assert.rejects(h.hooks.onPluginBeforeExit(),/legacy still pending/);await h.hooks.onPluginRun();assert.equal(h.log.filter(x=>x.type==='selected').length,1);
 await h.hooks.onPluginBeforeExit();assert.equal(attempts,2);await h.hooks.onPluginRun();assert.equal(h.log.filter(x=>x.type==='selected').length,2);await h.hooks.onPluginBeforeExit();
});
test('actual closing surface always has persistent text, prioritizes errors and offers close',()=>{
 const h=uiHarness();h.doc.body=h.doc.createElement('body');h.ui.destroy({closing:true});
 const surface=h.doc.body.children.find(n=>Object.hasOwn(n.attributes,'data-eva-closing'));assert(surface);
 h.ui.update({state:'closing',reopening:true,error:null});assert.match(surface.children[0].textContent,/完成后自动打开/);
 h.ui.update({state:'closed',error:null});assert.match(surface.children[0].textContent,/完成后自动打开/,'late session close must retain reopen intent');
 assert.equal(surface.children[1].textContent,'关闭窗口');h.ui.update({state:'closed',error:{message:'保留文件，释放失败'}});assert.equal(surface.children[0].textContent,'保留文件，释放失败');
 h.ui.update({state:'closing',reopening:false,error:null});assert.match(surface.children[0].textContent,/释放临时文件/);
});
