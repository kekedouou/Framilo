'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{install}=require('../scripts/ime-diagnostic.cjs');
function fixture(){
 const listeners=new Map(),windowListeners=new Map(),timers=new Map();let now=0,receipt;
 class Element {focus(){doc.activeElement=this;}blur(){doc.activeElement=null;}}
 class Textarea extends Element {constructor(){super();this.tagName='TEXTAREA';this.id='commentText';this.data='';this.selectionStart=0;this.selectionEnd=0;this.isConnected=true;}get value(){return this.data;}set value(v){this.data=v;}get readOnly(){return false;}set readOnly(v){}get disabled(){return false;}set disabled(v){}}
 const doc={activeElement:null,focused:true,hasFocus(){return this.focused;},addEventListener(type,fn,capture){listeners.set(type+capture,fn);},removeEventListener(type,fn,capture){listeners.delete(type+capture);}};
 const win={HTMLElement:Element,HTMLTextAreaElement:Textarea,performance:{now:()=>++now},setTimeout(fn){timers.set(1,fn);return 1;},clearTimeout(id){timers.delete(id);},addEventListener(type,fn){windowListeners.set(type,fn);},removeEventListener(type){windowListeners.delete(type);}};
 const input=new Textarea();input.focus();let text='';const ui={update(s){input.value=s.comments.draft.text;}};
 const session=Object.freeze({setCommentText(v){text=v;ui.update(this.snapshot());},snapshot:()=>({epoch:1,comments:{draft:{id:1,status:'editing',text}}})});
 return {win,doc,input,ui,session,timers,listeners,windowListeners,options:{window:win,document:doc,ui,session,enabled:true,onStop:r=>receipt=r},get receipt(){return receipt;}};
}
test('disabled diagnostics install nothing; explicit recording orders Session/UI/value without retaining text',()=>{
 const h=fixture(),originalUpdate=h.ui.update,originalValue=Object.getOwnPropertyDescriptor(h.win.HTMLTextAreaElement.prototype,'value');
 assert.equal(install({...h.options,enabled:false}),null);assert.equal(h.listeners.size,0);
 const p=install(h.options);p.session.setCommentText('不可记录的完整私人内容');const rows=p.read().rows;
 const seq=name=>rows.findIndex(r=>r.type===name);assert(seq('session.setCommentText.before')<seq('ui.update.before'));assert(seq('ui.update.before')<seq('dom.set.before'));assert(seq('dom.set.after')<seq('session.setCommentText.after'));
 assert(!JSON.stringify(rows).includes('不可记录'));assert.equal(rows.find(r=>r.type==='dom.set.before').nextLength,11);
 p.stop();assert.equal(h.ui.update,originalUpdate);assert.equal(Object.getOwnPropertyDescriptor(h.win.HTMLTextAreaElement.prototype,'value').set,originalValue.set);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0);assert.equal(p.session.setCommentText,h.session.setCommentText);
});
test('event and time caps stop and restore wrappers; sink errors never escape into editing',()=>{
 const h=fixture(),p=install({...h.options,maxEvents:3,onStop(){throw Error('sink failure');}});for(let n=0;n<20;n++)p.session.setCommentText('输入');assert(p.read().closed);assert(p.read().rows.length<=3);assert.equal(h.input.value,'输入');assert.equal(h.listeners.size,0);
 const second=fixture(),q=install(second.options);second.timers.get(1)();assert(q.read().closed);assert.equal(second.receipt.reason,'expired');assert.equal(second.listeners.size,0);
});
test('unchanged background updates are counted without exhausting the fault capture; real mutations stay visible',()=>{
 const h=fixture(),p=install(h.options);for(let n=0;n<400;n++)h.ui.update(h.session.snapshot());
 assert(!p.read().closed);assert(p.read().rows.length<10);assert(p.read().counts.unchangedUpdates>=399);assert(p.read().counts.unchangedPropertyWrites>=400);
 h.input.value='新的测试';assert(p.read().rows.some(r=>r.type==='dom.set.before'&&r.changed));p.stop();
});
test('window focus loss remains distinguishable from an unchanged DOM active element',()=>{
 const h=fixture(),p=install(h.options);h.doc.focused=false;h.windowListeners.get('blur')();
 const [first,last]=[p.read().rows[0],p.read().rows.at(-1)];assert.equal(first.documentFocused,true);assert.equal(last.type,'window.blur');assert.equal(last.documentFocused,false);assert.equal(last.active.node,first.active.node);
 p.stop();assert.equal(h.windowListeners.size,0);
});
