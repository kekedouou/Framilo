'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {harness,flush}=require('./timeline-ui.cjs');
test('E58 a superseded cold release cannot pin the cursor once native playback owns the clock',async()=>{
 const h=harness(),pending=[];h.session.seek=(time,settings)=>{h.state.state='seeking';h.state.playback={...h.state.playback,native:true,pendingTargets:1,frameHeld:true,targetTime:time};h.update();return new Promise(resolve=>pending.push(resolve));};
 h.el('timeline').fire('pointerdown',{clientX:420});h.win.fire('pointerup',{clientX:420,buttons:0});assert.equal(parseFloat(h.el('thumb').style.left),40);
 pending.forEach(r=>r({status:'superseded'}));await flush();h.state.state='playing';h.state.playback={...h.state.playback,pendingTargets:0,frameHeld:false,time:4.2,frameOrdinal:42};h.update();assert(Math.abs(parseFloat(h.el('thumb').style.left)-42)<1e-8);
 h.state.playback.time=4.4;h.update();assert(Math.abs(parseFloat(h.el('thumb').style.left)-44)<1e-8);h.ui.destroy();
});
test('E58 cancelled resume settles its exact paused frame without clearing a newer pending drag',async()=>{
 const h=harness(),pending=[];h.session.seek=(time,settings)=>new Promise(resolve=>pending.push(resolve));
 h.el('timeline').fire('pointerdown',{clientX:420});h.win.fire('pointerup',{clientX:420,buttons:0});pending.forEach(r=>r({status:'superseded'}));await flush();
 h.state.playback={...h.state.playback,time:4,frameOrdinal:40,pendingTargets:0,frameHeld:false};h.update();h.state.playback.time=4.1;h.update();assert.equal(parseFloat(h.el('thumb').style.left),41);
 h.el('timeline').fire('pointerdown',{clientX:500});h.state.state='playing';h.state.playback.time=4.2;h.update();assert.equal(parseFloat(h.el('thumb').style.left),50,'active pointer still owns the cursor');h.ui.destroy();
});
test('E58 capacity choice hides secondary proxy copy while keeping its one-shot expiry',()=>{
 const h=harness(),value={...h.state,playbackBackend:'proxy',proxyPreparation:{stage:'complete'},decision:{id:1,kind:'large-proxy'}};h.el('proxyState').removeAttribute=k=>delete h.el('proxyState').attributes[k];
 h.ui.update(value);assert.equal(h.el('proxyState').hidden,true);const timers=[...h.timers];h.ui.update({...value,decision:{...value.decision,id:2}});assert.deepEqual([...h.timers],timers);
 for(const[id,f]of timers){h.timers.delete(id);f();}h.ui.update({...value,decision:null});assert.equal(h.el('proxyState').hidden,false);assert.equal(h.el('proxyState').attributes['data-faded'],'true');
 h.ui.update({...value,decision:null,proxyPreparation:{stage:'preparing',progress:.2}});assert.equal(h.el('proxyState').hidden,false);assert.equal(h.el('proxyState').attributes['data-faded'],undefined);h.ui.destroy();
});
test('E58 preparation publishes before a paint boundary and destroy releases the pending wait',async()=>{
 const h=harness(),frames=new Map();let serial=0;h.win.requestAnimationFrame=f=>{frames.set(++serial,f);return serial;};h.win.cancelAnimationFrame=id=>frames.delete(id);
 const initial=fs.readFileSync(path.join(__dirname,'../plugin/index.html'),'utf8');assert.match(initial,/<div id="notice"[^>]*>正在打开视频…/);
 let done=false;const p=h.ui.prepareEntry().then(()=>{done=true;});assert.equal(h.el('notice').hidden,false);assert.match(h.el('notice').textContent,/准备视频/);assert.equal(done,false);
 const first=[...frames];frames.clear();for(const[,f]of first)f();await flush();assert.equal(done,false);assert(frames.size>=1);h.ui.destroy();await p;assert.equal(done,true);assert.equal(frames.size,0);
});
