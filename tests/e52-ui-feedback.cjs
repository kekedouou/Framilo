'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {markerCells}=require('../plugin/timeline-view.js');
require('../plugin/settings-view.js');
require('../plugin/graphite-shell.js');
const {harness,flush}=require('./timeline-ui.cjs');
test('marker hit cells split at midpoints and keep source times, same-frame notes and dense groups',()=>{
 const cells=markerCells([8,4.1,4,4,4.033,1],{start:0,end:12},960);
 for(let i=1;i<cells.length;i++)assert(cells[i-1].right<=cells[i].left);
 assert.deepEqual(cells.map(p=>p.time),[1,4,4,4.033,4.1,8]);
 assert.deepEqual(cells[1].group,[2,3,4,1]);assert.equal(cells[0].group.length,1);
 assert.equal(cells[1].x,320);assert(Math.abs(cells[4].x-328)<1e-7);
 const focused=markerCells([1,4,4.033,8],{start:3.99,end:4.06},800);
 assert.equal(focused.length,2);assert(focused.every(p=>p.group.length===1));
 assert.deepEqual(markerCells([1],{start:0,end:2},0),[]);
});
test('scrub steps, bounds, pointer ownership, cancellation and keyboard input remain separate from Apply',()=>{
 const handlers=new Map(),node={value:'0.25',min:'0',max:'1',dataset:{},focus(){},setPointerCapture(){},releasePointerCapture(){},dispatchEvent(e){events.push(e.type);}},win={Event},events=[],phases=[];
 const on=(n,t,f)=>{const key=(n===node?'node:':'win:')+t;if(!handlers.has(key))handlers.set(key,[]);handlers.get(key).push(f);};
 const fire=(key,args={})=>{const e={button:0,buttons:1,pointerId:1,clientX:100,preventDefault(){},stopPropagation(){},...args};for(const f of handlers.get(key)||[])f(e);};
 const stop=globalThis.EVASettingsView.bindSecondsScrub(node,win,on,v=>phases.push(v));
 fire('node:pointerdown');fire('win:pointermove',{clientX:108,pointerId:2});assert.equal(node.value,'0.25');
 fire('win:pointermove',{clientX:108});assert.equal(node.value,'0.30');
 fire('win:pointermove',{clientX:124});assert.equal(node.value,'0.40');
 fire('win:pointerup');assert.deepEqual(events,['input','input','change']);assert.deepEqual(phases,[true,false]);
 fire('node:pointerdown');fire('win:pointermove',{clientX:1000});assert.equal(node.value,'1.00');fire('node:keydown',{key:'Escape'});assert.equal(node.value,'0.40');
 fire('node:pointerdown');fire('win:pointermove',{clientX:-1000});assert.equal(node.value,'0.00');fire('win:pointercancel');assert.equal(node.value,'0.40');
 node.disabled=true;fire('node:pointerdown');fire('win:pointermove',{clientX:108});assert.equal(node.value,'0.40');node.disabled=false;
 fire('node:pointerdown');fire('win:pointermove',{clientX:108});stop();assert.equal(node.value,'0.40');
 node.value='0.65';fire('node:keydown',{key:'ArrowLeft'});assert.equal(node.value,'0.65');
});
test('dense marker menu seeks only the chosen record once, preserves data and cancels on view change',async()=>{
 const h=harness();
 // Extend the bounded DOM model only for popover lifecycle/keyboard behaviour.
 const original=h.doc.createElement;h.doc.createElement=tag=>{const n=original(tag);n.getAttribute=k=>n.attributes[k];n.contains=t=>t===n||n.children.includes(t);n.remove=()=>{const p=n.parentElement;if(p)p.children=p.children.filter(c=>c!==n);};return n;};
 const items=[{id:'a',time:4,text:'A'},{id:'b',time:4.033,text:'B'},{id:'c',time:4.067,text:'C'}];h.state.comments.items=items;h.update();
 const markers=h.el('commentMarkers'),owner=markers.children[1];
 markers.fire('click',{target:owner});const panel=markers.children.at(-1);assert.equal(panel.attributes.role,'dialog');assert.equal(h.calls.length,0);
 assert.deepEqual(panel.children.map(n=>n.dataset.commentId),['a','b','c']);
 panel.fire('click',{target:panel.children[2],stopPropagation(){}});await flush();
 assert.equal(h.calls.filter(c=>c[0]==='seek').length,1);assert.equal(h.calls.find(c=>c[0]==='seek')[1],4.067);assert.strictEqual(h.state.comments.items,items);assert(!markers.children.includes(panel));
 markers.fire('click',{target:owner});const next=markers.children.at(-1);next.fire('keydown',{key:'Escape',stopPropagation(){}});assert(!markers.children.includes(next));
 markers.fire('click',{target:owner});h.width=320;h.win.fire('resize');assert(!markers.children.some(n=>n.attributes.role==='dialog'));h.ui.destroy();
});
test('single marker selection returns focus to transport; Space toggles once without reselecting the note',async()=>{
 const h=harness();h.session.toggle=async()=>{h.calls.push(['toggle']);};
 const marker=h.el('commentMarkers').children[0];marker.focus();
 h.el('commentMarkers').fire('click',{target:marker});await flush();
 assert.equal(h.doc.activeElement,h.el('timeline'));assert.equal(h.calls.filter(c=>c[0]==='seek').length,1);
 const event=h.win.fire('keydown',{code:'Space',key:' ',target:h.doc.activeElement});await flush();assert(event.defaultPrevented);
 h.win.fire('keydown',{code:'Space',key:' ',repeat:true,target:h.doc.activeElement});h.win.fire('keyup',{code:'Space',key:' ',target:h.doc.activeElement});await flush();
 assert.equal(h.calls.filter(c=>c[0]==='toggle').length,1);assert.equal(h.calls.filter(c=>c[0]==='seek').length,1);
 h.el('commentText').tagName='textarea';h.win.fire('keydown',{code:'Space',key:' ',target:h.el('commentText')});await flush();assert.equal(h.calls.filter(c=>c[0]==='toggle').length,1);h.ui.destroy();
});
function visualHarness(){
 let serial=0;const timers=new Map(),nodes=[];
 const node=()=>{const handlers=new Map(),attrs=new Map(),n={isConnected:true,hidden:false,style:{},dataset:{},classList:{add(){}},children:[],offsetWidth:68,offsetHeight:30,
 setAttribute:(k,v)=>attrs.set(k,v),getAttribute:k=>attrs.get(k)??null,removeAttribute:k=>attrs.delete(k),hasAttribute:k=>attrs.has(k),
 append(c){this.children.push(c);},remove(){this.isConnected=false;},querySelectorAll(){return[];},querySelector(){return null;},contains(t){return t===this;},closest(){return this;},matches(){return true;},
 getBoundingClientRect(){return{left:10,top:200,right:48,width:38,height:38};},
 addEventListener(t,f){if(!handlers.has(t))handlers.set(t,[]);handlers.get(t).push(f);},removeEventListener(t,f){handlers.set(t,(handlers.get(t)||[]).filter(x=>x!==f));},fire(t,e){for(const f of handlers.get(t)||[])f(e);},
 cloneNode(){return node();},animate(frames,options){this.animation={frames,options,cancel(){this.cancelled=true;}};return this.animation;}};nodes.push(n);return n;};
 const win=node();Object.assign(win,{innerWidth:800,innerHeight:600,reduced:false,matchMedia(){return{matches:this.reduced};},setTimeout(f){const id=++serial;timers.set(id,f);return id;},clearTimeout(id){timers.delete(id);}});
 return{win,workspace:node(),doc:{createElement:node},node,nodes,timers,run(){for(const[id,f]of [...timers]){timers.delete(id);f();}}};
}
test('editor exit preserves geometry, cannot receive input, cleans up and respects reduced motion/reopen',()=>{
 const h=visualHarness(),editor=h.node(),exit=globalThis.EVAGraphite.createEditorExit(h.doc,h.win,h.workspace);
 exit.start(editor);const first=h.workspace.children.at(-1);assert.equal(first.getAttribute('aria-hidden'),'true');assert(first.hasAttribute('inert'));assert.equal(first.style.left,'10px');assert.equal(first.animation.options.duration,140);
 exit.cancel();assert.equal(first.isConnected,false);assert.equal(h.timers.size,0);assert.equal(editor.isConnected,true);
 exit.start(editor);const second=h.workspace.children.at(-1);second.animation.onfinish();assert.equal(second.isConnected,false);
 h.win.reduced=true;const length=h.workspace.children.length;exit.start(editor);assert.equal(h.workspace.children.length,length);
 h.win.reduced=false;exit.start(editor);h.run();assert.equal(h.workspace.children.at(-1).isConnected,false);
});
test('button hints replace native titles after dwell and leave on click, blur and destruction',()=>{
 const h=visualHarness(),b=h.node();b.setAttribute('title','记录');h.workspace.querySelectorAll=()=>[b];
 const hints=globalThis.EVAGraphite.createButtonHints(h.doc,h.win,h.workspace),tip=h.workspace.children[0];assert(!b.hasAttribute('title'));assert(tip.hidden);
 h.workspace.fire('pointerover',{target:b});assert(tip.hidden);h.run();assert.equal(tip.textContent,'记录');assert.equal(tip.hidden,false);assert.equal(b.getAttribute('aria-describedby'),tip.id);
 h.workspace.fire('pointerdown',{});assert(tip.hidden);assert.equal(b.getAttribute('aria-describedby'),null);
 h.workspace.fire('focusin',{target:b});h.run();assert(!tip.hidden);h.win.fire('blur',{});assert(tip.hidden);
 h.workspace.fire('pointerover',{target:b});hints.destroy();assert.equal(h.timers.size,0);assert(!tip.isConnected);assert.equal(b.getAttribute('title'),'记录');
});
test('annotation marker tooltip is centred above its actual frame tick and clamps to the window',()=>{
 const h=visualHarness(),b=h.node();b.setAttribute('title','标注');b.classList.contains=name=>name==='comment-marker';b.style.getPropertyValue=()=> '6px';b.getBoundingClientRect=()=>({left:100,top:200,right:138,width:38,height:38});
 h.workspace.querySelectorAll=()=>[b];const hints=globalThis.EVAGraphite.createButtonHints(h.doc,h.win,h.workspace),tip=h.workspace.children[0];
 h.workspace.fire('pointerover',{target:b});h.run();assert.equal(tip.style.left,'72px');assert.equal(tip.style.top,'158px');hints.destroy();
});
test('removing redundant drawing success does not suppress failures or unknown results',()=>{
 const h=harness();h.state.drawings={status:'ready',message:'圈画与文字已保存。',records:[]};h.update();assert.equal(h.el('drawingStatus').textContent,'');
 for(const message of ['保存失败，请重试。','保存结果未知，请核对。']){h.state.drawings={...h.state.drawings,message};h.update();assert.equal(h.el('drawingStatus').textContent,message);}h.ui.destroy();
});
