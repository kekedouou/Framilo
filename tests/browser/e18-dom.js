/* Native layout, mask, transient feedback, motion and repeated-lifecycle checks. */
(async function(){
 'use strict';const el=id=>document.getElementById(id),checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms)),settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const check=(ok,text)=>{if(!ok)throw Error(text);checks.push(text);},rect=id=>{const r=el(id).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
 let ui,writes=0,cancelled=0,toggles=0,seeks=0,fail=false,serial=0,observers=0;
 const NativeObserver=window.ResizeObserver;if(NativeObserver)window.ResizeObserver=class extends NativeObserver{constructor(fn){super(fn);this.owned=true;observers++;}disconnect(){if(this.owned){this.owned=false;observers--;}super.disconnect();}};
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const state={epoch:1,state:'paused',duration:10,source:{name:'E18 交互检查（合成画面）'},memorySettings:{ramMiB:512,ramBytes:536870912},interactionSettings:{wheelFrames:1,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false},
  playback:{time:2,frameId:60,frameOrdinal:60,frameCount:300,transport:{rate:1,loop:{valid:false}}},comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',visible:true,records:[],styles:EVADrawingModel.defaultStyles(),draft:null}};
 const publish=()=>ui.update({...state,comments:{...state.comments},drawings:{...state.drawings},playback:{...state.playback}});
 const session={setCommentsVisible(){},refreshComments:async()=>{},memorySnapshot:()=>null,async pause(){state.state='paused';publish();},async play(){toggles++;state.state='playing';publish();},
  async seek(time){seeks++;state.playback.time=time;publish();return{status:'drawn'};},async beginComment(){state.state='paused';state.comments.draft={id:++serial,status:'editing',time:state.playback.time,text:''};publish();return{status:'editing'};},
  setCommentText(text){state.comments.draft={...state.comments.draft,text};publish();},cancelComment(){cancelled++;state.comments.draft=null;publish();},
  async saveComment(){const d=state.comments.draft;if(!d.text.trim())return this.cancelComment();if(!['editing','failed'].includes(d.status))return;writes++;state.comments.draft={...d,status:'saving'};publish();await sleep(25);if(fail){state.comments.draft={...d,status:'failed',message:'保存失败，内容保留'};publish();}else{state.comments.draft=null;publish();}},
  async beginDrawing(){state.drawings.draft={id:++serial,status:'editing',kind:'edit',objects:[{id:'seed',kind:'rect',a:{x:.1,y:.1},b:{x:.25,y:.25},width:.004,color:'#ffffff'}],dirty:false};publish();return{status:'editing'};},cancelDrawing(){state.drawings.draft=null;publish();},touchDrawing(){state.drawings.draft={...state.drawings.draft,dirty:true};publish();},setDrawingObjects(objects){state.drawings.draft={...state.drawings.draft,objects,dirty:true};publish();},setDrawingStyles(styles){state.drawings.styles=styles;publish();return{status:'saved'};}
 };
 function key(k,extra={},target=window){const e=new KeyboardEvent('keydown',{key:k,code:k.length===1?'Key'+k.toUpperCase():k,bubbles:true,cancelable:true,...extra});target.dispatchEvent(e);return e;}
 function pointer(target,type,x,y,button=2){target.dispatchEvent(new PointerEvent(type,{pointerId:82,button,buttons:type==='pointerup'?0:button===2?2:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));}
 function origin(){const r=el('screen').getBoundingClientRect();return{x:r.left+r.width*.35,y:r.top+r.height*.28};}
 async function right(dx=0,dy=0,held=false){const p=origin();pointer(el('picture'),'pointerdown',p.x,p.y);if(held)await sleep(450);if(dx||dy)pointer(window,'pointermove',p.x+dx,p.y+dy);pointer(window,'pointerup',p.x+dx,p.y+dy);await settle();}
 const text=value=>{el('commentText').value=value;el('commentText').dispatchEvent(new Event('input',{bubbles:true}));};
 async function note(){el('screen').focus();key('n');await settle();}
 try{
  ui=EVAUI.createUI();ui.bindSession(session);publish();const canvas=el('picture'),ctx=canvas.getContext('2d');ctx.fillStyle='#34383e';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#a28d5f';ctx.fillRect(180,100,470,470);
  const before={screen:rect('screen'),timeline:rect('timeline')};await note();
  check(el('commentEditor').parentElement===el('screen'),'Text editor floats inside the screen');
  check(JSON.stringify(before.screen)===JSON.stringify(rect('screen'))&&JSON.stringify(before.timeline)===JSON.stringify(rect('timeline')),'Opening text edit never shifts or resizes video/timeline');
  const screen=rect('screen'),editor=rect('commentEditor');check(editor.y+editor.height/2>screen.y+screen.height/2&&editor.y>=screen.y&&editor.y+editor.height<=screen.y+screen.height,'Editor stays in the lower video area and fully inside a small window');
  check(Math.abs(editor.x+editor.width/2-screen.x-screen.width/2)<1,'Floating editor is centered');
  check(!el('commentShade').hidden&&Number(getComputedStyle(el('commentShade')).backgroundColor.match(/[\d.]+/g).at(-1))>0,'Video outside the editor has a translucent dark mask');
  check(docActive()===el('commentText'),'Entering text edit focuses the input');
  const p=origin();pointer(el('commentShade'),'pointerdown',p.x,p.y,0);pointer(window,'pointermove',p.x+70,p.y,0);pointer(window,'pointerup',p.x+70,p.y,0);await settle();
  check(!seeks&&!toggles&&!writes&&!cancelled&&!!state.comments.draft,'Mask left drag neither changes playback nor commits/cancels a draft');
  check(document.activeElement===el('commentText'),'Mask click preserves the editor focus');
  text('悬浮文字第一行\n第二行');check(el('commentDraftPreview').textContent.includes('第二行'),'Sidebar mirrors floating editor text');
  const nativeMenu=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el('commentText').dispatchEvent(nativeMenu);check(!nativeMenu.defaultPrevented,'Input retains its native right-click menu');
  key('Enter',{isComposing:true},el('commentText'));check(writes===0,'IME confirmation cannot save');key('Enter',{shiftKey:true},el('commentText'));check(writes===0,'Shift+Enter remains multiline input');
  fail=true;key('Enter',{},el('commentText'));await sleep(40);check(state.comments.draft?.status==='failed'&&el('commentText').value.includes('第二行')&&!el('commentShade').hidden,'Failure keeps input, mask and draft intact');
  fail=false;await right();await sleep(40);check(!state.comments.draft&&el('commentShade').hidden&&el('commentEditor').hidden,'Right click saves the floating note and removes its mask');
  check(JSON.stringify(before.screen)===JSON.stringify(rect('screen')),'Saving restores the same unchanged video geometry');
  await note();text('');key('Enter',{},el('commentText'));await settle();check(!state.comments.draft,'An empty floating note cancels');
  await note();text('放弃');key('Escape',{},el('commentText'));await settle();check(!state.comments.draft&&el('commentShade').hidden,'Esc cancels and clears the mask');
  await note();text('长文\n'.repeat(60));check(rect('commentEditor').height<=rect('screen').height&&el('commentText').scrollHeight>el('commentText').clientHeight,'Long notes scroll inside the bounded floating area');key('Escape',{},el('commentText'));await settle();
  canvas.width=405;canvas.height=720;await note();await settle();const portrait=rect('commentEditor');check(portrait.width<=rect('screen').height*405/720+1,'Portrait-frame note width stays within the actual image');
  const workspace=document.querySelector('.workspace'),oldHeight=workspace.style.height;workspace.style.height=Math.max(360,window.innerHeight-80)+'px';await settle();check(rect('commentEditor').y>=rect('screen').y&&rect('commentEditor').y+rect('commentEditor').height<=rect('screen').y+rect('screen').height,'Resizing during editing keeps the overlay inside the video');
  workspace.style.height=oldHeight;key('Escape',{},el('commentText'));canvas.width=1280;canvas.height=720;await settle();
  el('screen').focus();key('l');await settle();check(!el('loopHelp').hidden&&el('loopHelp').textContent.includes('请先选择'),'Missing-loop notice appears');await sleep(1870);check(Number(getComputedStyle(el('loopHelp')).opacity)<1,'Notice fades before its two-second deadline');await sleep(200);check(el('loopHelp').hidden,'Notice is fully gone after two seconds');
  key('l');await sleep(1100);key('l');await sleep(1100);check(!el('loopHelp').hidden,'Repeated attempts renew the hint deadline');state.epoch++;publish();check(el('loopHelp').hidden,'Source switch clears old loop notice');
  key('l');await settle();key('r');window.dispatchEvent(new KeyboardEvent('keyup',{key:'r',code:'KeyR',bubbles:true}));await settle();check(!el('loopHelp').textContent.includes('请先选择'),'Entering selection replaces the transient hint with edit guidance');key('Escape');await settle();
  let o=origin();pointer(el('picture'),'pointerdown',o.x,o.y);pointer(window,'pointermove',o.x+60,o.y);await sleep(25);let menu=el('contextWheel');check((getComputedStyle(menu).animationName==='none')===reduced,'Right wheel entrance follows the reduced-motion preference');pointer(window,'pointerup',o.x+60,o.y);await settle();
  // Select-loop flick above may be ignored by the model; always return to watch.
  key('Escape');await settle();
  o=origin();pointer(el('picture'),'pointerdown',o.x,o.y);await sleep(450);pointer(window,'pointerup',o.x,o.y);check(menu.hidden&&menu.inert&&menu.getAttribute('aria-hidden')==='true','Wheel closes logically and stops input before its exit animation ends');check(reduced?getComputedStyle(menu).animationName==='none':getComputedStyle(menu).animationName.includes('out'),'Right wheel exit follows the reduced-motion preference');await sleep(150);check(getComputedStyle(menu).display==='none','Closed wheel leaves no visible or interactive overlay');
  await session.beginDrawing();const seed=el('drawingLayer').firstElementChild;for(let n=0;n<40;n++)publish();check(el('drawingLayer').firstElementChild===seed,'Unchanged editor updates preserve existing SVG nodes');
  el('drawingToolRect').click();let layer=el('drawingLayer').getBoundingClientRect();pointer(el('drawingLayer'),'pointerdown',layer.left+layer.width*.45,layer.top+layer.height*.4,0);pointer(window,'pointermove',layer.left+layer.width*.65,layer.top+layer.height*.6,0);pointer(window,'pointerup',layer.left+layer.width*.65,layer.top+layer.height*.6,0);check(state.drawings.draft.objects.length===2,'Real pointer edits still render and publish a new object immediately');key('z',{ctrlKey:true});check(state.drawings.draft.objects.length===1,'Undo still updates the image after cached editor rendering');
  o=origin();pointer(el('picture'),'pointerdown',o.x,o.y);pointer(window,'pointermove',o.x,o.y-40);await sleep(25);check(menu.getAttribute('data-level')==='types'&&(getComputedStyle(menu).animationName==='none')===reduced,'Drawing secondary wheel follows the reduced-motion preference');pointer(window,'pointerup',o.x,o.y-40);await sleep(140);
  await right(60,0);const panel=menu.querySelector('.context-wheel-panel');check(!panel.hidden&&(getComputedStyle(panel).animationName==='none')===reduced,'Color panel shares the wheel motion preference');panel.querySelector('button').click();
  o=origin();pointer(el('picture'),'pointerdown',o.x,o.y);pointer(window,'pointermove',o.x,o.y-40);menu.dispatchEvent(new AnimationEvent('animationend',{animationName:'wheel-out',bubbles:true}));check(!menu.hidden&&menu.getAttribute('aria-hidden')==='false','A late old exit-animation event cannot close a newly opened wheel');pointer(window,'pointerup',o.x,o.y-40);key('Escape');session.cancelDrawing();await settle();
  // Repeated UI lifecycles and pending feedback own no leaked DOM overlays.
  for(let n=0;n<36;n++){state.epoch++;publish();el('screen').focus();key('l');ui.destroy();ui=EVAUI.createUI();ui.bindSession(session);publish();}
  check(document.querySelectorAll('#contextWheel').length===1&&el('loopHelp').hidden&&el('commentShade').hidden,'Thirty-six destroy/recreate cycles leave one inactive menu and no stale mask/hint');
  check(!NativeObserver||observers===1,'Repeated lifecycles retain only the current resize observer');
  ctx.fillStyle='#34383e';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#a28d5f';ctx.fillRect(180,100,470,470);
  await note();text('浮层标注示例');await settle();
  const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed:true,checks});document.body.appendChild(out);
 }catch(error){ui?.destroy();const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed:false,checks,error:error.stack});document.body.appendChild(out);}
 function docActive(){return document.activeElement;}
})();
