'use strict';
const assert=require('assert');const {createUI}=require('../plugin/ui.js');let count=0;
function node(tag='div',doc){const handlers=new Map();const n={tagName:tag.toUpperCase(),style:{},dataset:{},children:[],attributes:{},hidden:false,disabled:false,value:'',textContent:'',replacements:0,
 addEventListener(t,f){if(!handlers.has(t))handlers.set(t,[]);handlers.get(t).push(f);},removeEventListener(t,f){handlers.set(t,(handlers.get(t)||[]).filter(x=>x!==f));},
 fire(t,event={}){const e={target:n,preventDefault(){this.prevented=true;},...event};for(const f of handlers.get(t)||[])f(e);return e;},
 replaceChildren(){this.children=[];this.replacements++;},appendChild(c){this.children.push(c);c.parentElement=this;},focus(){doc.activeElement=this;},
 closest(selector){const match=selector.split(',').some(s=>s==='button[data-comment-id]'?this.tagName==='BUTTON'&&this.dataset.commentId:s==='[role="slider"]'?this.attributes.role==='slider':s.toUpperCase()===this.tagName);return match?this:this.parentElement?this.parentElement.closest(selector):null;},
 setAttribute(k,v){this.attributes[k]=v;},getBoundingClientRect(){return {left:0,width:100};},offsetWidth:80};return n;}
function harness(settings={}){
 const els=new Map(),calls=[],doc=node('document');
 doc.getElementById=id=>{if(!els.has(id))els.set(id,node(id==='commentText'?'textarea':'div',doc));return els.get(id);};
 doc.createElement=tag=>node(tag,doc);doc.hasFocus=()=>settings.focused!==false;
 const win=node('window',doc),ui=createUI({document:doc,window:win,now:settings.now});
 const session=Object.fromEntries(['toggle','seek','step','retry','beginComment','setCommentText','saveComment','checkComment','cancelComment','seekComment','editComment','deleteComment','beginExport','loadExportFolders','cancelExport','checkExport'].map(k=>[k,(...args)=>{calls.push([k,...args]);}]));
 const comments=Object.freeze({status:'ready',libraryPath:'library',items:Object.freeze([{id:'note',time:2,text:'<img onerror=bad> 标注'},{id:'outside',time:11,text:'超出'}]),draft:null,message:''});
 let s={epoch:1,state:'paused',duration:10,source:{name:'测试视频'},playback:{time:2,frameId:2},comments};
 ui.bindSession(session);ui.update(s);return {ui,doc,win,calls,session,el:id=>doc.getElementById(id),get state(){return s;},update:patch=>{s={...s,...patch};ui.update(s);}};
}
function test(name,fn){fn();count++;console.log('ok '+name);}
test('Comment list and markers use literal text and actual seconds; out-of-range data permits management without a seek',()=>{const h=harness();assert.equal(h.el('commentList').children.length,2);assert(h.el('commentList').children[0].children[0].textContent.includes('<img onerror=bad>'));assert.equal(h.el('commentMarkers').children.length,1);assert.equal(h.el('commentMarkers').children[0].style.left,'20%');const row=h.el('commentList').children[1];assert(!row.children[0].disabled);h.el('commentList').fire('click',{target:row.children[0]});assert(!row.children[1].hidden);assert.equal(h.calls.length,0);h.ui.destroy();});
test('Normal per-frame updates never rebuild the annotation DOM',()=>{const h=harness(),list=h.el('commentList'),replacements=list.replacements,first=list.children[0];for(let i=0;i<120;i++)h.update({playback:{time:i/60,frameId:i}});assert.equal(list.replacements,replacements);assert.strictEqual(list.children[0],first);h.ui.destroy();});
test('Clicking a marker or list item invokes only annotation seek',()=>{const h=harness();h.el('commentMarkers').fire('click',{target:h.el('commentMarkers').children[0]});h.el('commentList').fire('click',{target:h.el('commentList').children[0].children[0]});assert.deepEqual(h.calls,[['seekComment','note'],['seekComment','note']]);h.ui.destroy();});
test('A fixed proposal disables playback/drag, focuses editor and protects typing spaces',()=>{const h=harness();const draft={id:1,status:'editing',time:2,text:'中文 空格',message:''};h.update({comments:{...h.state.comments,draft}});assert.equal(h.el('play').disabled,true);assert.equal(h.el('previous').disabled,true);assert.equal(h.el('commentText').value,'中文 空格');assert.equal(h.doc.activeElement,h.el('commentText'));assert.equal(h.el('commentEditor').hidden,false);assert(h.el('commentTime').textContent.includes('0:02.000'));h.win.fire('keydown',{code:'Space',target:h.el('commentText')});assert.equal(h.calls.length,0);h.el('commentText').value='新的 空格';h.el('commentText').fire('input');assert.deepEqual(h.calls[0],['setCommentText','新的 空格']);h.el('commentSave').fire('click');assert.deepEqual(h.calls[1],['saveComment']);h.ui.destroy();});
test('Unknown outcome preserves selectable text and offers only read-only checking',()=>{const h=harness();h.update({comments:{...h.state.comments,draft:{id:2,status:'unknown',time:2,text:'保留 文字',message:'结果未知'}}});assert.equal(h.el('commentText').value,'保留 文字');assert.equal(h.el('commentText').readOnly,true);assert.equal(h.el('commentText').disabled,false);assert.equal(h.el('commentCancel').disabled,true);assert.equal(h.el('commentSave').textContent,'核对保存结果');h.el('commentSave').fire('click');assert.deepEqual(h.calls,[['checkComment']]);h.ui.destroy();});
test('Source reset removes old markers/editor; read error never enables Add',()=>{const h=harness();h.update({epoch:2,state:'preparing',duration:0,comments:{status:'loading',items:[],draft:null,message:'正在读取标注'}});assert.equal(h.el('commentMarkers').children.length,0);assert.equal(h.el('commentList').children.length,0);assert.equal(h.el('commentEditor').hidden,true);h.update({state:'paused',comments:{status:'error',items:[],draft:null,message:'读取失败'}});assert.equal(h.el('commentAdd').disabled,true);assert.equal(h.el('commentStatus').textContent,'读取失败');h.ui.destroy();});
test('Existing note actions enter edit or deletion confirmation without seeking',()=>{const h=harness(),actions=h.el('commentList').children[0].children[1].children;h.el('commentList').fire('click',{target:actions[0]});h.el('commentList').fire('click',{target:actions[1]});assert.deepEqual(h.calls,[['editComment','note'],['deleteComment','note']]);h.ui.destroy();});
test('Deletion confirmation shows the original note read-only and requires the explicit save action',()=>{const h=harness();h.update({comments:{...h.state.comments,draft:{id:4,kind:'delete',status:'editing',time:2,text:'原文字',message:'确认删除？'}}});assert.equal(h.el('commentText').readOnly,true);assert.equal(h.el('commentText').value,'原文字');assert.equal(h.el('commentSave').textContent,'确认删除');assert.equal(h.calls.length,0);h.el('commentCancel').fire('click');assert.deepEqual(h.calls,[['cancelComment']]);h.ui.destroy();});
test('Export UI uses local or the selected Eagle folder and requires a valid committed clip range',()=>{const h=harness();h.el('exportFrame').fire('click');assert.deepEqual(h.calls,[['beginExport','frame',{destination:'local',folderId:''}]]);assert.equal(h.el('exportClip').disabled,true);h.el('exportDestination').value='eagle';h.el('exportDestination').fire('change');assert.equal(h.calls[1][0],'loadExportFolders');h.update({exportFolders:{status:'ready',items:[{id:'folder',label:'中文 / <b>文件夹</b>'}]},playback:{time:2,frameId:2,transport:{loop:{valid:true}}}});assert.equal(h.el('exportFolder').children[1].textContent,'中文 / <b>文件夹</b>');h.el('exportFolder').value='folder';h.el('exportFolder').fire('change');h.el('exportClip').fire('click');assert.deepEqual(h.calls[2],['beginExport','clip',{destination:'eagle',folderId:'folder'}]);h.ui.destroy();});
test('Busy export disables interaction; a dispatched import cannot advertise cancellation or resending',()=>{const h=harness();h.update({exportState:{status:'busy',cancellable:false,message:'正在保存'}});assert.equal(h.el('exportFrame').disabled,true);assert.equal(h.el('play').disabled,true);assert.equal(h.el('exportCancel').disabled,true);h.update({exportState:{status:'unknown',message:'请核对'}});assert.equal(h.el('exportFrame').disabled,true);assert.equal(h.el('exportCheck').hidden,false);assert.equal(h.el('play').disabled,false);h.el('exportCheck').fire('click');assert.deepEqual(h.calls,[['checkExport']]);h.ui.destroy();});
test('Enter saves a new or edited note using the current text; Shift+Enter and modified Enter keep native input behavior',()=>{
 for(const kind of [undefined,'edit']){const h=harness();h.update({comments:{...h.state.comments,draft:{id:10,kind,status:'editing',time:2,text:'初始'}}});
  h.el('commentText').value='当前文字\n第二行';const shifted=h.el('commentText').fire('keydown',{key:'Enter',shiftKey:true});
  assert(!shifted.prevented);assert.equal(h.calls.length,0);
  for(const modifier of ['ctrlKey','altKey','metaKey']){h.el('commentText').fire('keydown',{key:'Enter',[modifier]:true});assert.equal(h.calls.length,0);}
  const enter=h.el('commentText').fire('keydown',{key:'Enter'});assert(enter.prevented);assert.deepEqual(h.calls,[['setCommentText','当前文字\n第二行'],['saveComment']]);h.ui.destroy();}
});
test('Composition, candidate confirmation, keyCode229 and held Enter never submit a note',()=>{
 let time=100;const h=harness({now:()=>time});h.update({comments:{...h.state.comments,draft:{id:11,status:'editing',time:2,text:''}}});
 h.el('commentText').fire('compositionstart');h.el('commentText').fire('keydown',{key:'Enter'});assert.equal(h.calls.length,0);
 h.el('commentText').value='中文';h.el('commentText').fire('compositionend');assert.deepEqual(h.calls,[['setCommentText','中文']]);h.calls.length=0;
 h.el('commentText').fire('keydown',{key:'Enter'});assert.equal(h.calls.length,0);time+=60;
 h.el('commentText').fire('keydown',{key:'Enter',keyCode:229});h.el('commentText').fire('keydown',{key:'Enter',isComposing:true});
 const repeated=h.el('commentText').fire('keydown',{key:'Enter',repeat:true});assert(repeated.prevented);assert.equal(h.calls.length,0);
 h.el('commentText').fire('keydown',{key:'Enter'});assert.equal(h.calls.filter(value=>value[0]==='saveComment').length,1);h.ui.destroy();
});
test('Enter cannot confirm deletion, resend an unknown result, or save an obsolete/saving proposal',()=>{
 for(const draft of [{kind:'delete',status:'editing'},{status:'unknown'},{status:'obsolete'},{status:'saving'}]){const h=harness();
  h.update({comments:{...h.state.comments,draft:{id:12,time:2,text:'保留文字',...draft}}});h.el('commentText').fire('keydown',{key:'Enter'});assert.equal(h.calls.length,0);h.ui.destroy();}
});
test('Successful save returns keyboard focus to the timeline; failure, another source and an unfocused window never steal it',()=>{
 const h=harness(),draft={id:13,status:'editing',time:2,text:'保留文字'};h.update({comments:{...h.state.comments,draft}});
 let editorHidden=false;Object.defineProperty(h.el('commentEditor'),'hidden',{get:()=>editorHidden,set:value=>{editorHidden=value;if(value&&h.doc.activeElement===h.el('commentText'))h.doc.activeElement=h.doc;}});
 h.update({comments:{...h.state.comments,draft:{...draft,status:'saving'}}});h.update({comments:{...h.state.comments,draft:null,message:'已保存'}});
 assert.equal(h.doc.activeElement,h.el('timeline'));h.win.fire('keydown',{code:'Space',target:h.el('timeline')});assert.deepEqual(h.calls,[['toggle']]);h.ui.destroy();
 for(const mode of ['failed','source','unfocused']){const x=harness({focused:mode!=='unfocused'});x.update({comments:{...x.state.comments,draft}});
  x.update({comments:{...x.state.comments,draft:{...draft,status:'saving'}}});
  x.update({...(mode==='source'?{epoch:2,state:'preparing'}:{}),comments:{...x.state.comments,draft:mode==='failed'?{...draft,status:'failed'}:null}});
  assert.equal(x.doc.activeElement,x.el('commentText'));if(mode==='failed')assert.equal(x.el('commentText').value,'保留文字');x.ui.destroy();}
});
test('Background list updates and conflicts do not overwrite a Chinese composition already in progress',()=>{
 const h=harness(),draft={id:14,status:'editing',time:2,text:'原草稿'};h.update({comments:{...h.state.comments,draft}});h.el('commentText').fire('compositionstart');h.el('commentText').value='正在拼写';
 h.update({comments:{...h.state.comments,items:[{id:'external',time:1,text:'新增'}],draft:{...draft,status:'obsolete',message:'外部冲突'}}});
 assert.equal(h.el('commentText').value,'正在拼写');assert.equal(h.el('commentText').readOnly,false);assert.equal(h.el('commentSave').disabled,true);
 h.el('commentText').fire('compositionend');assert.deepEqual(h.calls,[['setCommentText','正在拼写']]);h.ui.destroy();
});
test('Visibility/focus signals stop or resume session synchronization and are removed on destroy',()=>{
 const h=harness();h.session.setCommentsVisible=visible=>h.calls.push(['visible',visible]);h.session.refreshComments=()=>h.calls.push(['refresh']);h.ui.bindSession(h.session);h.calls.length=0;
 h.doc.hidden=true;h.doc.fire('visibilitychange');assert.deepEqual(h.calls,[['visible',false]]);h.calls.length=0;
 h.doc.hidden=false;h.win.fire('focus');assert.deepEqual(h.calls,[['visible',true],['refresh']]);h.calls.length=0;
 h.ui.destroy();assert.deepEqual(h.calls,[['visible',false]]);h.calls.length=0;h.win.fire('focus');h.doc.fire('visibilitychange');assert.equal(h.calls.length,0);
});
test('Actions expand one row at a time, stay open during editing, and collapse on outside click or source change',()=>{
 const h=harness(),row=h.el('commentList').children[0],action=row.children[1];assert(action.hidden);
 h.el('commentList').fire('click',{target:row.children[0]});assert(!action.hidden);assert.equal(row.children[0].attributes['aria-expanded'],'true');
 h.update({comments:{...h.state.comments,draft:{id:99,status:'editing',time:2,text:'编辑'}}});h.win.fire('pointerdown');assert(!action.hidden);
 h.update({comments:{...h.state.comments,draft:null}});h.win.fire('pointerdown');assert(action.hidden);
 h.el('commentList').fire('click',{target:row.children[0]});assert(!action.hidden);h.update({epoch:2});assert(action.hidden);h.ui.destroy();
});
test('Composition input stays local through synchronous Session/UI echoes and commits once in either Chromium event order',()=>{
 for(const order of ['input-before-end','end-before-input']){
  const h=harness(),draft={id:201,status:'editing',time:2,text:'原文'};h.update({comments:{...h.state.comments,draft}});
  h.session.setCommentText=text=>{h.calls.push(['setCommentText',text]);h.update({comments:{...h.state.comments,draft:{...draft,text}}});};
  const input=h.el('commentText');input.fire('compositionstart');
  for(const text of ['原文n','原文ni','原文你好']){input.value=text;input.fire('input',{isComposing:true,inputType:'insertCompositionText'});h.update({playback:{time:2}});assert.equal(input.value,text);}
  assert.deepEqual(h.calls,[],'preedit must not enter Session');
  if(order==='input-before-end')input.fire('input',{isComposing:false});
  input.fire('compositionend');if(order==='end-before-input')input.fire('input',{isComposing:false,inputType:'insertText'});
  assert.deepEqual(h.calls,[['setCommentText','原文你好']]);
  for(const text of ['原文你好abc','粘贴文本','粘贴','']){input.value=text;input.fire('input',{isComposing:false});assert.equal(h.calls.at(-1)[1],text);}
  h.ui.destroy();
 }
});
test('beforeinput/input composition signals protect preedit even without compositionstart; a new draft revokes that state',()=>{
 for(const signal of ['beforeinput','input']){const h=harness(),draft={id:202,status:'editing',time:2,text:''};h.update({comments:{...h.state.comments,draft}});
  const input=h.el('commentText');input.value='nihao';input.fire(signal,{isComposing:true,inputType:'insertCompositionText'});
  h.update({comments:{...h.state.comments,draft:{...draft,text:''}}});assert.equal(input.value,'nihao');assert.deepEqual(h.calls,[]);
  input.value='你好';input.fire('compositionend');input.fire('input',{isComposing:false});assert.deepEqual(h.calls,[['setCommentText','你好']]);
  input.fire('compositionstart');h.update({epoch:2,comments:{...h.state.comments,draft:{...draft,text:'新素材'}}});assert.equal(input.value,'新素材');
  input.value='新素材英文';input.fire('input');assert.equal(h.calls.at(-1)[1],'新素材英文');h.ui.destroy();
 }
});
test('229 Space and frame-step keys stay with IME even when isComposing is false and target is not a textarea',()=>{
 const h=harness();for(const key of [' ','[',']']){const event=h.win.fire('keydown',{key,keyCode:229,isComposing:false,target:h.el('screen')});assert(!event.prevented);}
 assert.deepEqual(h.calls,[]);h.win.fire('keydown',{key:' ',target:h.el('screen')});h.win.fire('keydown',{key:'[',target:h.el('screen')});h.win.fire('keydown',{key:']',target:h.el('screen')});assert.deepEqual(h.calls.map(v=>v[0]),['toggle','step','step']);h.ui.destroy();
});
console.log('T3 UI checks: '+count+'; DOM model only, no actual Eagle layout/input');
