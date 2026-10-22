'use strict';
// Real gesture input controller with owned timer/capture models; no DOM or Eagle.
const assert=require('assert'),{createScreenGestureUI}=require('../plugin/screen-gesture-ui.js');
function harness(){
  const timers=new Map(),frames=new Map(),captures=new Set(),calls=[],nodes=new Map();let serial=0,time=0,ctx={epoch:1,enabled:true,canStart:true,width:1000,range:{start:0,end:10},time:2,rate:1,step:.1};
  function node(id){const handlers=new Map();return{id,style:{},attributes:{},textContent:'',focus(){},closest(){return null;},
    addEventListener(t,f){if(!handlers.has(t))handlers.set(t,[]);handlers.get(t).push(f);},removeEventListener(t,f){handlers.set(t,(handlers.get(t)||[]).filter(n=>n!==f));},
    setAttribute(k,v){this.attributes[k]=v;},getBoundingClientRect(){return{left:0,top:0,width:1000,height:600};},
    emit(t,e={}){e={type:t,pointerId:1,button:0,buttons:1,clientX:100,clientY:100,preventDefault(){},...e};for(const f of handlers.get(t)||[])f(e);},
    setPointerCapture(id){captures.add(id);},hasPointerCapture:id=>captures.has(id),releasePointerCapture(id){captures.delete(id);},
    listenerCount:()=>[...handlers.values()].reduce((n,a)=>n+a.length,0)};}
  const win=node('window'),doc={getElementById(id){if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);}};
  win.setTimeout=function(fn){assert.strictEqual(this,win);const id=++serial;timers.set(id,fn);return id;};
  win.clearTimeout=function(id){assert.strictEqual(this,win);timers.delete(id);};
  win.requestAnimationFrame=function(fn){assert.strictEqual(this,win);const id=++serial;frames.set(id,fn);return id;};
  win.cancelAnimationFrame=function(id){assert.strictEqual(this,win);frames.delete(id);};
  const api=createScreenGestureUI({document:doc,window:win,getContext:()=>ctx,now:()=>time,seek:(v,final)=>calls.push({seek:v,final}),rate:v=>calls.push({rate:v})});
  const screen=doc.getElementById('screen');return{api,win,doc,screen,calls,captures,timers,frames,ctx,
    move(x,y,more={}){time+=20;win.emit('pointermove',{clientX:x,clientY:y,...more});},
    down(){screen.emit('pointerdown',{target:screen});},flush(){for(const[id,fn]of [...frames]){frames.delete(id);fn();}},
    hold(){time+=500;for(const[id,fn]of [...timers]){timers.delete(id);fn();}}};
}
let count=0;function test(name,fn){fn();count++;console.log('ok gesture controller: '+name);}
test('Hold uses Window-owned timers, a single horizontal frame request is coalesced and release frees capture',()=>{
  const h=harness();h.down();assert(h.captures.has(1));h.hold();assert.equal(h.doc.getElementById('screenGestureRing').attributes['data-held'],'true');
  h.move(200,100);h.move(300,100);assert.equal(h.frames.size,1);h.flush();assert.equal(h.calls.length,1);
  h.win.emit('pointerup',{clientX:310,clientY:100,buttons:0});assert(h.calls.at(-1).final);assert(!h.captures.size);assert(!h.frames.size);h.api.destroy();
});
test('Lost physical mouse buttons settle once and release the captured pointer without waiting for pointerup',()=>{
  const h=harness();h.down();h.move(200,100);h.move(220,100,{buttons:0});
  assert(h.calls.at(-1).final);assert.equal(h.calls.length,1);assert(!h.api.active());assert(!h.captures.size);assert(!h.frames.size);h.api.destroy();
});
test('Foreign pointer cancellation cannot end the active gesture; own cancellation clears capture/timer',()=>{
  const h=harness();h.down();h.win.emit('pointercancel',{pointerId:2});assert(h.api.active());h.win.emit('pointercancel',{pointerId:1});
  assert(!h.api.active());assert(!h.captures.size);assert(!h.timers.size);h.api.destroy();
});
test('Epoch change cancels queued work without submitting a stale frame request',()=>{
  const h=harness();h.down();h.move(200,100);h.ctx.epoch++;h.api.update();h.flush();
  assert.equal(h.calls.length,0);assert(!h.captures.size);assert(!h.frames.size);assert(!h.timers.size);h.api.destroy();
});
test('Drawing/input state disables start and later mode change clears the speed hint',()=>{
  const h=harness();h.ctx.enabled=false;h.down();assert(!h.api.active());h.ctx.enabled=true;h.down();h.move(100,80);
  assert(h.calls[0].rate>1);h.ctx.enabled=false;h.api.update();assert.equal(h.doc.getElementById('screenRateHint').attributes['data-open'],'false');assert(!h.timers.size);h.api.destroy();
});
test('Destroy removes all listeners, animation callbacks, timers and pointer capture',()=>{
  const h=harness();h.down();h.move(200,100);h.api.destroy();
  assert.equal(h.win.listenerCount()+h.screen.listenerCount(),0);assert(!h.frames.size);assert(!h.timers.size);assert(!h.captures.size);
});
console.log('Screen gesture controller: '+count+' ownership/cancellation checks; not real Eagle.');
