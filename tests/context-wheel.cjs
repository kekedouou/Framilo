'use strict';
const assert=require('assert'),{wheelIndex,createContextWheel}=require('../plugin/context-wheel.js');
function harness(){let time=0,serial=0,listeners=0;const timers=new Map(),calls=[];
 function node(tag='div'){const events=new Map();return{tag,style:{},attributes:{},children:[],hidden:false,
  addEventListener(t,f){if(!events.has(t))events.set(t,new Set());if(!events.get(t).has(f)){events.get(t).add(f);listeners++;}},
  removeEventListener(t,f){if(events.get(t)?.delete(f))listeners--;},emit(t,v={}){const e={type:t,pointerId:1,button:2,buttons:2,clientX:300,clientY:200,preventDefault(){this.defaultPrevented=true;},...v};for(const f of [...(events.get(t)||[])])f(e);return e;},
  setAttribute(k,v){this.attributes[k]=v;},appendChild(c){this.children.push(c);},replaceChildren(...c){this.children=c;},getBoundingClientRect:()=>({left:0,top:0,width:800,height:500}),closest(){return null;},focus(){},setPointerCapture(){},hasPointerCapture(){return false;}};
 }
 const screen=node(),win=node();win.setTimeout=(f)=>{const id=++serial;timers.set(id,f);return id;};win.clearTimeout=id=>timers.delete(id);
 const ctx={epoch:1,mode:'watch',enabled:true,items:['up','right','down','left'].map(id=>({id,label:id}))};
 const api=createContextWheel({document:{createElement:node},window:win,screen,getContext:()=>ctx,now:()=>time,command:id=>calls.push(id)});
 return{api,screen,win,ctx,calls,timers,count:()=>listeners,hold(){time+=500;for(const[id,f]of [...timers]){timers.delete(id);f();}}};
}
let count=0;function test(name,fn){fn();console.log('ok right wheel: '+name);count++;}
test('Four and eight direction choice has a center dead zone',()=>{assert.equal(wheelIndex(1,1,4),null);assert.equal(wheelIndex(0,-60,4),0);assert.equal(wheelIndex(60,0,4),1);assert.equal(wheelIndex(0,60,4),2);assert.equal(wheelIndex(-60,0,4),3);assert.equal(wheelIndex(60,60,8),3);});
test('Only release executes once; returning to the center cancels',()=>{const h=harness();h.screen.emit('pointerdown',{target:h.screen});h.win.emit('pointermove',{clientY:130});assert.equal(h.calls.length,0);h.win.emit('pointerup',{clientY:130,buttons:0});assert.deepEqual(h.calls,['up']);h.screen.emit('pointerdown',{target:h.screen});h.win.emit('pointermove',{clientX:360});h.win.emit('pointermove',{});h.win.emit('pointerup',{buttons:0});assert.equal(h.calls.length,1);h.api.destroy();});
test('Repeated opening/closing releases dynamic listeners instead of growing retained menu state',()=>{const h=harness(),base=h.count();for(let n=0;n<120;n++){h.screen.emit('pointerdown',{target:h.screen});h.hold();h.win.emit('pointerup',{buttons:0});assert.equal(h.count(),base);}h.api.destroy();assert.equal(h.count(),0);assert.equal(h.timers.size,0);});
test('Mode/source changes, cancellation and blur cannot execute a stale command',()=>{const h=harness();for(const event of ['pointercancel','blur']){h.screen.emit('pointerdown',{target:h.screen});h.hold();h.win.emit(event);h.win.emit('pointerup',{clientY:130,buttons:0});}h.screen.emit('pointerdown',{target:h.screen});h.hold();h.ctx.epoch++;h.api.update();h.win.emit('pointerup',{clientY:130,buttons:0});assert.equal(h.calls.length,0);assert(!h.api.active());h.api.destroy();});
console.log('Right wheel: '+count+' model lifecycle checks; no real Eagle.');
