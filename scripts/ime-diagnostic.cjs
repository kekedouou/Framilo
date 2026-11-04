'use strict';
// Opt-in development recorder. No text, asset identifiers, network or default disk writes.
function install({window:win,document:doc,ui,session,enabled=false,maxEvents=384,durationMs=300000,onStop=()=>{}}){
 if(!enabled)return null;
 const rows=[],undo=[],ids=new WeakMap(),events=new WeakMap(),observedSession=Object.isFrozen(session)?{...session}:session,encoder=new TextEncoder(),counts={unchangedPropertyWrites:0,unchangedUpdates:0};let serial=0,eventId=0,closed=false,bytes=0,timer,capturing=doc.activeElement?.tagName==='TEXTAREA',commandDepth=0,lastUpdate='';
 const start=win.performance.now(),limit=Math.max(1,Math.min(384,maxEvents)),duration=Math.max(1,Math.min(600000,durationMs));
 const input=n=>n?.tagName==='TEXTAREA';
 const identity=n=>{if(!n)return null;if(!ids.has(n))ids.set(n,++serial);return {node:ids.get(n),role:input(n)?(n.id==='commentText'?'comment':n.closest?.('.shell-editor')?'shell':'textarea'):String(n.tagName||'document')};};
 const state=n=>input(n)?{...identity(n),length:n.value.length,start:n.selectionStart,end:n.selectionEnd,readOnly:n.readOnly,disabled:n.disabled,connected:n.isConnected}:identity(n);
 const snapshot=s=>({epoch:s?.epoch,comment:s?.comments?.draft?{id:s.comments.draft.id,status:s.comments.draft.status,length:s.comments.draft.text?.length}:null,drawing:s?.drawings?.draft?{id:s.drawings.draft.id,status:s.drawings.draft.status,length:s.drawings.draft.noteText?.length}:null});
 function stop(reason='manual'){if(closed)return;closed=true;win.clearTimeout(timer);for(const f of undo.reverse())f();try{onStop({schema:1,reason,counts:{...counts},rows:rows.slice()});}catch(_){/* Diagnostics never own input or persistence. */}}
 function record(type,detail={}){if(closed)return;if(type==='event'||type==='dom.focus.before'||type==='user-marker')capturing=true;if(!capturing&&type!=='start')return;const row={seq:rows.length,ms:Math.round((win.performance.now()-start)*1000)/1000,type,...detail,documentFocused:doc.hasFocus?.(),active:state(doc.activeElement)};
  const size=encoder.encode(JSON.stringify(row)).length+1;if(rows.length>=limit||bytes+size>60000){stop('cap');return;}rows.push(row);bytes+=size;}
 function wrap(owner,key,make){const original=owner?.[key];if(typeof original!=='function')return;const replacement=make(original);owner[key]=replacement;undo.push(()=>{if(owner[key]===replacement)owner[key]=original;});}
 const types=['focus','blur','keydown','keyup','beforeinput','input','compositionstart','compositionupdate','compositionend'];
 for(const type of types){for(const capture of [true,false]){const handler=e=>{if(!input(e.target))return;if(!events.has(e))events.set(e,++eventId);record('event',{event:events.get(e),phase:capture?'capture':'bubble',name:e.type,target:state(e.target),trusted:e.isTrusted,isComposing:e.isComposing,inputType:e.inputType,keyCode:e.keyCode,controlKey:['Enter','Escape','Backspace','ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)?e.key:undefined,defaultPrevented:e.defaultPrevented});};doc.addEventListener(type,handler,capture);undo.push(()=>doc.removeEventListener(type,handler,capture));}}
 for(const type of ['focus','blur']){const handler=()=>record('window.'+type);win.addEventListener(type,handler);undo.push(()=>win.removeEventListener(type,handler));}
 for(const key of ['value','readOnly','disabled']){const proto=win.HTMLTextAreaElement.prototype,d=Object.getOwnPropertyDescriptor(proto,key);if(!d?.set||!d.configurable)continue;
  const setter=function(value){const changed=d.get.call(this)!==value;if(!changed){counts.unchangedPropertyWrites++;return d.set.call(this,value);}record('dom.set.before',{property:key,target:state(this),changed,nextLength:key==='value'?String(value).length:undefined,nextFlag:key==='value'?undefined:!!value});const result=d.set.call(this,value);record('dom.set.after',{property:key,target:state(this)});return result;};
  Object.defineProperty(proto,key,{...d,set:setter});undo.push(()=>{if(Object.getOwnPropertyDescriptor(proto,key)?.set===setter)Object.defineProperty(proto,key,d);});
 }
 for(const key of ['focus','blur'])wrap(win.HTMLElement.prototype,key,original=>function(...args){if(input(this))record('dom.'+key+'.before',{target:state(this)});const result=original.apply(this,args);if(input(this))record('dom.'+key+'.after',{target:state(this)});return result;});
 for(const key of ['setCommentText','setDrawingNote'])wrap(observedSession,key,original=>function(...args){record('session.'+key+'.before',{length:typeof args[0]==='string'?args[0].length:undefined});commandDepth++;try{return original.apply(session,args);}finally{commandDepth--;record('session.'+key+'.after',snapshot(session.snapshot?.()));}});
 wrap(ui,'update',original=>function(s){const key=JSON.stringify([snapshot(s),state(doc.activeElement)]),repeated=!commandDepth&&key===lastUpdate;lastUpdate=key;if(repeated){counts.unchangedUpdates++;return original.call(this,s);}record('ui.update.before',snapshot(s));try{return original.call(this,s);}finally{record('ui.update.after',snapshot(s));}});
 if(win.MutationObserver){const observer=new win.MutationObserver(changes=>{for(const c of changes){const nodes=c.type==='childList'?[...c.addedNodes,...c.removedNodes].flatMap(n=>[n,...(n.querySelectorAll?.('textarea')||[])]):[...(c.target.querySelectorAll?.('textarea')||[]),c.target];for(const n of nodes)if(input(n))record('dom.mutation',{kind:c.type,attribute:c.attributeName,target:state(n)});}});observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','readonly','disabled','style','class']});undo.push(()=>observer.disconnect());}
 const unload=()=>stop('unload');win.addEventListener('unload',unload);undo.push(()=>win.removeEventListener('unload',unload));
 timer=win.setTimeout(()=>stop('expired'),duration);record('start');
 return {session:observedSession,stop,read:()=>({schema:1,closed,counts:{...counts},rows:rows.slice()}),mark:()=>record('user-marker')};
}
// Local host adapter: explicit expiring config only, immutable bounded output under this task.
function attachHost(win,doc,ui,session,pluginRoot){
 const fs=require('fs'),path=require('path'),base=path.resolve(pluginRoot,'../verification-runs/bugfix-four'),dir=path.join(base,'ime-sync'),config=path.join(dir,'enabled.local.json');
 if(!fs.existsSync(config))return null;
 const c=JSON.parse(fs.readFileSync(config,'utf8'));if(c.enabled!==true||c.expiresAt<=Date.now()||c.expiresAt>Date.now()+600000)return null;
 const size=p=>fs.readdirSync(p,{withFileTypes:true}).reduce((n,e)=>{if(e.isSymbolicLink())throw Error('Evidence link refused');const f=path.join(p,e.name);return n+(e.isDirectory()?size(f):fs.statSync(f).size);},0);
 if(size(base)+65536>2*1024*1024)return null;
 const started=Date.now(),output=path.join(dir,'host-'+started+'.json'),crypto=require('crypto');
 const sourceSha256=Object.fromEntries(['ui.js','graphite-shell.js','app.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(pluginRoot,name))).digest('hex')]));
 return install({window:win,document:doc,ui,session,enabled:true,durationMs:c.expiresAt-Date.now(),onStop:value=>{
  const text=JSON.stringify({startedAt:new Date(started).toISOString(),sourceSha256,versions:{chrome:process.versions.chrome,electron:process.versions.electron},...value});
  if(Buffer.byteLength(text)<=65536&&size(base)+Buffer.byteLength(text)<=2*1024*1024)fs.writeFileSync(output,text,{flag:'wx'});
 }});
}
module.exports={install,attachHost};
