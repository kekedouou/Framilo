'use strict';
// Isolated clocks/text inputs only; no filesystem, host, media or annotations.
const {test}=require('node:test'),assert=require('node:assert/strict');
require('../plugin/graphite-shell.js');
const {createEditorMessage,createNoteInput}=globalThis.EVAGraphite;
function clock(){let now=0,serial=0;const tasks=new Map();return{tasks,now:()=>now,
 setTimeout(fn,ms){const id=++serial;tasks.set(id,{fn,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);},
 advance(ms){now+=ms;for(const [id,t]of [...tasks])if(t.at<=now){tasks.delete(id);t.fn();}}};}
test('quick save exits without flashing text; pending completion cannot revive it',()=>{
 const win=clock(),node={dataset:{},textContent:''},view=createEditorMessage(node,win);
 view.update('1:a','saving','正在保存');const late=[...win.tasks.values()][0].fn;win.advance(299);assert.equal(node.textContent,'');
 view.clear();late();win.advance(1);assert.equal(node.textContent,'');assert.equal(win.tasks.size,0);
});
test('slow save has one deadline through phase changes; errors and unknown results remain immediate',()=>{
 const win=clock(),node={dataset:{},textContent:''},view=createEditorMessage(node,win);
 view.update('1:a','saving','核对文字');win.advance(200);view.update('1:a','saving','保存圈画');win.advance(100);
 assert.equal(node.textContent,'保存圈画');assert.equal(node.dataset.saving,'true');
 view.update('1:a','saving','再次读回');assert.equal(node.textContent,'再次读回');assert.equal(win.tasks.size,0);
 for(const status of ['failed','unknown']){view.update('1:a',status,'草稿保留');win.advance(10000);assert.equal(node.textContent,'草稿保留');assert.equal(node.dataset.saving,undefined);}
 view.update('1:a','saving','重试');assert.equal(node.textContent,'');win.advance(300);assert.equal(node.textContent,'重试');view.clear();
});
test('source change, fast reopen and destruction revoke the old save notice',()=>{
 const win=clock(),node={dataset:{},textContent:''},view=createEditorMessage(node,win);
 view.update('1:a','saving','旧结果');const late=[...win.tasks.values()][0].fn;win.advance(150);
 view.update('2:a','editing','新草稿');late();assert.equal(node.textContent,'新草稿');
 view.update('2:b','saving','新保存');win.advance(299);assert.equal(node.textContent,'');win.advance(1);assert.equal(node.textContent,'新保存');
 view.clear();win.advance(1000);assert.equal(node.textContent,'');assert.equal(win.tasks.size,0);
});
function inputFixture(){
 const doc={activeElement:null},parent={children:[],insertBefore(node,old){node.parentNode=this;this.children.splice(this.children.indexOf(old),0,node);}};
 doc.createElement=()=>{const handlers=new Map();let readOnly=false;return{value:'',readOnlyWrites:0,blurs:[],get readOnly(){return readOnly;},set readOnly(value){readOnly=!!value;this.readOnlyWrites++;},attributes:{},setAttribute(k,v){this.attributes[k]=v;},
  addEventListener(k,fn){if(!handlers.has(k))handlers.set(k,new Set());handlers.get(k).add(fn);},removeEventListener(k,fn){handlers.get(k)?.delete(fn);},
  fire(type,extra={}){const e={key:'',preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};for(const fn of handlers.get(type)||[])fn(e);return e;},
  focus(){doc.activeElement=this;},blur(){this.blurs.push({readOnly:this.readOnly,focused:doc.activeElement===this});if(doc.activeElement===this)doc.activeElement=null;this.fire('compositionend');this.fire('input');},
  remove(){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;},listeners(){return [...handlers.values()].reduce((n,v)=>n+v.size,0);}};};
 const initial=doc.createElement();initial.parentNode=parent;parent.children.push(initial);const writes=[],win=clock();let saves=0;
 const view=createNoteInput(initial,doc,text=>writes.push(text),()=>saves++,win.now);
 return{view,doc,parent,writes,win,get input(){return parent.children[0];},get saves(){return saves;}};
}
test('visible note publishes one final commit, not preedit or the trailing input echo',()=>{
 const h=inputFixture();h.view.update('1:a','',false);const node=h.input;
 node.fire('compositionstart');node.value='ni';node.fire('input',{isComposing:true});h.view.update('1:a','',false);assert.equal(node.value,'ni');assert.deepEqual(h.writes,[]);
 node.value='你好';node.fire('compositionend');node.fire('input',{isComposing:false});assert.deepEqual(h.writes,['你好']);
 for(const value of ['你好a','粘贴','粘','']){node.value=value;node.fire('input');assert.equal(h.writes.at(-1),value);}h.view.destroy();
});
test('IME selection Enter cannot save; committed input and normal Enter/Shift+Enter retain behavior',()=>{
 const h=inputFixture();h.view.update('1:a','已提交',false);h.input.fire('compositionstart');h.input.value='已提交中文';h.input.fire('input');
 h.input.fire('keydown',{key:'Enter',isComposing:true});assert.equal(h.saves,0);assert.equal(h.writes.length,0);assert(h.view.blocked());
 h.input.fire('compositionend');assert.equal(h.writes.at(-1),'已提交中文');h.input.fire('keydown',{key:'Enter'});assert.equal(h.saves,0);
 h.win.advance(80);assert(!h.view.blocked());h.input.fire('keydown',{key:'Enter',shiftKey:true});assert.equal(h.saves,0);
 h.input.fire('keydown',{key:'Enter'});assert.equal(h.saves,1);h.view.destroy();
});
test('exit/reopen retires the composing node and rejects synchronous blur and late old events',()=>{
 const h=inputFixture();h.view.update('1:a','原文字',false);const old=h.input;old.fire('compositionstart');old.value='原文字nihao';
 h.view.update(null,'',true);assert.equal(h.doc.activeElement,null);assert.equal(old.listeners(),0);assert.equal(old.value,'');assert(!h.view.blocked());assert.equal(h.writes.length,0);
 h.view.update('1:b','新草稿',false);assert.notEqual(h.input,old);old.value='迟到中文';old.fire('compositionend');old.fire('input');old.fire('keydown',{key:'Enter'});
 assert.equal(h.writes.length,0);assert.equal(h.saves,0);assert.equal(h.input.value,'新草稿');assert.equal(h.doc.activeElement,h.input);assert.equal(h.parent.children.length,1);
 h.input.value='新输入';h.input.fire('input');assert.equal(h.writes.at(-1),'新输入');h.view.destroy();assert.equal(h.input.listeners(),0);assert.equal(h.doc.activeElement,null);
});
test('source replacement clears IME but ordinary draft updates and failed saves retain the input',()=>{
 const h=inputFixture();h.view.update('1:a','已提交',false);const node=h.input;
 node.fire('compositionstart');node.value='已提交zhong';h.view.update('1:a','已提交',false);assert.equal(h.input,node);assert.equal(node.value,'已提交zhong');
 h.view.update('2:a','另一素材',false);assert.notEqual(h.input,node);assert.equal(node.listeners(),0);assert.equal(h.writes.length,0);assert(!h.view.blocked());
 const next=h.input;h.view.update('2:a','保留的草稿',true);assert.notEqual(h.input,next);const locked=h.input;h.view.update('2:a','保留的草稿',false);assert.equal(h.input,locked);assert.equal(locked.value,'保留的草稿');h.view.destroy();
});

test('default Chinese composing input survives repeated unchanged render updates without readonly writes',()=>{
 const h=inputFixture();h.view.update('1:a','',false);const node=h.input;node.readOnlyWrites=0;
 node.fire('compositionstart');node.value='aaf';node.fire('input',{isComposing:true});
 for(let n=0;n<100;n++)h.view.update('1:a','',false);
 assert.equal(node.readOnlyWrites,0);assert.equal(h.doc.activeElement,node);assert.equal(node.value,'aaf');assert.equal(h.writes.length,0);
 node.value='中文';node.fire('compositionend');assert.equal(h.writes.at(-1),'中文');h.view.destroy();
});
test('saving an uncommitted composition blurs while writable, discards only pending text and releases IME guards',()=>{
 const h=inputFixture();h.view.update('1:a','已提交',false);const node=h.input;node.blurs.length=0;
 node.fire('compositionstart');node.value='已提交aaf';node.fire('input',{isComposing:true});
 h.view.update('1:a','已提交',true);
 assert.deepEqual(node.blurs,[{readOnly:false,focused:true}]);assert.equal(h.input.value,'已提交');assert.equal(h.input.readOnly,true);assert.notEqual(h.input,node);
 assert.equal(h.writes.length,0);assert(!h.view.blocked());assert.equal(h.doc.activeElement,null);
 // A failed save keeps the committed draft editable; native blur callbacks may
 // not publish the abandoned candidate, and typing must work without an IME toggle.
 h.view.update('1:a','已提交',false);const retry=h.input;node.value='迟到候选';node.fire('compositionend');node.fire('input');assert.equal(h.writes.length,0);retry.focus();retry.fire('compositionstart');retry.value='已提交新字';retry.fire('compositionend');assert.equal(h.writes.at(-1),'已提交新字');h.view.destroy();
});
test('beforeinput and composing input protect preedit even if compositionstart was not observed',()=>{
 for(const type of ['beforeinput','input']){const h=inputFixture();h.view.update('1:a','',false);const node=h.input;
 node.fire(type,{isComposing:true,inputType:'insertCompositionText'});node.value='nihao';h.view.update('1:a','',false);assert.equal(node.value,'nihao');assert.equal(h.writes.length,0);
 node.value='你好';node.fire('compositionend');assert.equal(h.writes.at(-1),'你好');h.view.destroy();}
});

test('explicit save/exit focus transfer drops preedit and remains editable if the action is cancelled',()=>{
 const h=inputFixture();h.view.update('1:a','',false);const old=h.input;old.fire('compositionstart');old.value='aaf';
 h.view.finishComposition();assert.equal(old.blurs.at(-1).readOnly,false);assert.notEqual(h.input,old);assert.equal(h.input.value,'');assert.equal(h.doc.activeElement,null);assert.equal(h.writes.length,0);
 old.fire('compositionend');old.fire('input');assert.equal(h.writes.length,0);
 h.input.focus();h.input.fire('compositionstart');h.input.value='中文';h.input.fire('compositionend');assert.equal(h.writes.at(-1),'中文');h.view.destroy();
});
test('prepare releases the old input before the surrounding editor is hidden',()=>{
 const h=inputFixture();h.view.update('1:a','已保存',false);const old=h.input;old.fire('compositionstart');old.value='已保存aaf';
 let hidden=false;const blur=old.blur;old.blur=function(){assert.equal(hidden,false);assert.equal(this.readOnly,false);blur.call(this);};
 h.view.prepare(null,true);hidden=true;h.view.update(null,'',true);assert.equal(h.writes.length,0);assert(!h.view.blocked());h.view.destroy();
});
