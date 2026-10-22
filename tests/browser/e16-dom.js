/* Native DOM/SVG; actual UI controllers, in-memory Session and synthetic picture. */
(async function(){
 'use strict';
 const el=id=>document.getElementById(id),checks=[],copy=v=>JSON.parse(JSON.stringify(v)),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const settle=async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));};
 const check=(ok,text)=>{if(!ok)throw Error(text);checks.push(text);};
 const state={epoch:1,state:'paused',duration:10,source:{name:'E-16 界面检查（无真实视频）'},memorySettings:{ramMiB:1024,ramBytes:1073741824},
  interactionSettings:{wheelFrames:1,showCacheStrip:true,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false},
  playback:{time:2,frameId:60,frameOrdinal:60,frameCount:300,transport:{rate:1,loop:{valid:false,enabled:false}}},
  comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',records:[],visible:true,styles:EVADrawingModel.defaultStyles(),draft:null}};
 let ui,serial=0,applies=0,clears=0,noteWrites=0,noteChecks=0,drawingSaves=0,noteFail=false,noteUnknown=false,drawingFail=false,stored=[];
 const publish=()=>ui.update({...state,comments:{...state.comments},drawings:{...state.drawings},playback:{...state.playback}});
 const session={setCommentsVisible(){},refreshComments:async()=>{},memorySnapshot:()=>null,
  async pause(){state.state='paused';publish();},async play(){state.state='playing';publish();},
  loopFrameAt(time,b={}){const ordinal=Math.max(b.minOrdinal??0,Math.min(b.maxOrdinal??299,b.ordinal??Math.floor(time*30+1e-6)));return{ordinal,time:ordinal/30};},
  async seek(time,o={}){const frame=this.loopFrameAt(time,{ordinal:o.index});state.state='paused';state.playback={...state.playback,time:frame.time,frameOrdinal:frame.ordinal,frameId:frame.ordinal};publish();return{status:'drawn'};},
  async applyLoopRange(v){applies++;state.playback.transport.loop={...v,valid:true,enabled:true,startTime:v.startOrdinal/30,endTime:v.endOrdinal/30,endBoundary:(v.endOrdinal+1)/30};state.state='playing';publish();return{status:'playing'};},
  async clearLoop(){clears++;state.playback.transport.loop={valid:false,enabled:false};publish();},
  async setLoopEnabled(v){state.playback.transport.loop.enabled=v;publish();return{status:'applied'};},
  async beginComment(){state.state='paused';const old=state.comments.items.find(n=>Math.abs(n.time-state.playback.time)<1/30);state.comments.draft={id:++serial,status:'editing',kind:old?'edit':undefined,time:state.playback.time,text:old?.text||'',original:old?copy(old):null};publish();return{status:'editing'};},
  setCommentText(text){if(!state.comments.draft||!['editing','failed'].includes(state.comments.draft.status))return;state.comments.draft={...state.comments.draft,text};publish();},
  cancelComment(){if(['saving','unknown','checking'].includes(state.comments.draft?.status))return{status:'ignored'};state.comments.draft=null;publish();return{status:'cancelled'};},
  async saveComment(){const d=state.comments.draft;if(!d||!['editing','failed'].includes(d.status))return{status:'ignored'};if(!d.text.trim())return this.cancelComment();noteWrites++;state.comments.draft={...d,status:'saving'};publish();await sleep(25);
   if(noteFail){state.comments.draft={...d,status:'failed',message:'模拟保存失败，内容保留'};publish();return{status:'failed'};}
   if(noteUnknown){state.comments.draft={...d,status:'unknown',message:'模拟结果未知，请核对'};publish();return{status:'unknown'};}
   const item={id:d.original?.id||'note-'+d.id,time:d.time,text:d.text};state.comments.items=[...state.comments.items.filter(n=>n.id!==item.id),item];state.comments.draft=null;publish();return{status:'saved'};},
  async checkComment(){noteChecks++;state.comments.draft=null;publish();return{status:'saved'};},
  async beginDrawing(){state.state='paused';state.drawings.draft={id:++serial,status:'editing',kind:'edit',objects:copy(stored),dirty:false};publish();return{status:'editing'};},
  setDrawingObjects(objects){state.drawings.draft={...state.drawings.draft,objects:copy(objects),dirty:true};publish();},touchDrawing(){state.drawings.draft={...state.drawings.draft,dirty:true};publish();},
  setDrawingStyles(styles){state.drawings.styles=styles;publish();return{status:'saved'};},setDrawingToolbar(visible){state.interactionSettings={...state.interactionSettings,drawingToolbar:visible};publish();return{status:'saved'};},
  async saveDrawing(){const d=state.drawings.draft;if(!d||!['editing','failed'].includes(d.status))return{status:'ignored'};drawingSaves++;state.drawings.draft={...d,status:'saving'};publish();await sleep(25);if(drawingFail){state.drawings.draft={...d,status:'failed',message:'模拟圈画保存失败'};publish();return{status:'failed'};}stored=copy(d.objects);state.drawings.records=stored.length?[{id:'saved-drawing',frameOrdinal:state.playback.frameOrdinal,frameId:state.playback.frameId,time:state.playback.time,objects:stored}]:[];state.drawings.draft=null;publish();return{status:'saved'};},
  cancelDrawing(){state.drawings.draft=null;publish();return true;},setDrawingsVisible(visible){state.drawings.visible=visible;publish();}
 };
 function key(value,extra={},target=window){const e=new KeyboardEvent('keydown',{key:value,code:value.length===1?'Key'+value.toUpperCase():value,bubbles:true,cancelable:true,...extra});target.dispatchEvent(e);return e;}
 function pointer(target,type,x,y,button=2){target.dispatchEvent(new PointerEvent(type,{pointerId:81,button,buttons:type==='pointerup'?0:button===2?2:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));}
 const origin=()=>{const r=el('screen').getBoundingClientRect();return{x:r.left+r.width*.45,y:r.top+r.height*.45};};
 function down(){const p=origin();pointer(el('picture'),'pointerdown',p.x,p.y);return p;}
 async function right(dx=0,dy=0,hold=false){const p=down();if(hold)await sleep(450);if(dx||dy)pointer(window,'pointermove',p.x+dx,p.y+dy);pointer(window,'pointerup',p.x+dx,p.y+dy);await settle();}
 function input(text){el('commentText').value=text;el('commentText').dispatchEvent(new Event('input',{bubbles:true}));}
 async function note(){el('screen').focus();key('n');await settle();}
 function timeline(time){const r=el('timeline').getBoundingClientRect(),x=r.left+r.width*time/10,y=r.top+r.height/2;pointer(el('timeline'),'pointerdown',x,y,0);pointer(window,'pointerup',x,y,0);}
 function draw(){const r=el('drawingLayer').getBoundingClientRect();pointer(el('drawingLayer'),'pointerdown',r.left+r.width*.25,r.top+r.height*.25,0);pointer(window,'pointermove',r.left+r.width*.65,r.top+r.height*.65,0);pointer(window,'pointerup',r.left+r.width*.65,r.top+r.height*.65,0);}
 async function tool(kind){const p=down();pointer(window,'pointermove',p.x,p.y-40);const b=el('contextWheel').querySelector('[data-wheel-command="'+kind+'"]').getBoundingClientRect();pointer(window,'pointermove',b.left+b.width/2,b.top+b.height/2);pointer(window,'pointerup',b.left+b.width/2,b.top+b.height/2);await settle();}
 try{
  ui=EVAUI.createUI();ui.bindSession(session);publish();
  const ctx=el('picture').getContext('2d');ctx.fillStyle='#303238';ctx.fillRect(0,0,1280,720);ctx.strokeStyle='#41434a';ctx.lineWidth=1;for(let x=0;x<1280;x+=64){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,720);ctx.stroke();}for(let y=0;y<720;y+=64){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1280,y);ctx.stroke();}
  let p=down();await sleep(450);let menu=el('contextWheel');
  check(parseFloat(getComputedStyle(menu).width)===120&&Number(getComputedStyle(menu).opacity)<.85,'Right wheel has a 120px layout size and stays visually subdued during its entrance');
  check(menu.querySelectorAll('.context-wheel-item').length===4,'Viewing wheel retains four commands');pointer(window,'pointerup',p.x,p.y);check(menu.hidden,'Held center release cancels without action');
  await right(-60,0);check(el('timeline').getAttribute('data-selecting')==='true','Left viewing flick enters selection');
  await right();check(el('timeline').getAttribute('data-selecting')!=='true'&&applies===0&&clears===0,'Empty selection right tap cancels without making a range');
  await right(-60,0);timeline(2);await right();check(applies===0&&clears===0&&el('timeline').getAttribute('data-selecting')!=='true','Half selection right tap cancels and exits');
  await right(-60,0);timeline(2);await right(-60,0);p=origin();pointer(el('picture'),'pointerdown',p.x,p.y,0);pointer(window,'pointermove',p.x+25,p.y,0);pointer(window,'pointerup',p.x+25,p.y,0);await settle();
  check(el('loopHandleEnd').hidden&&state.playback.frameOrdinal>60,'Explicit head control overrides the missing-tail default during picture dragging');await right();
  await right(-60,0);timeline(3);timeline(3);await right();check(clears===1&&!state.playback.transport.loop.valid&&el('timeline').getAttribute('data-selecting')!=='true','Coincident endpoints right tap clears and exits');
  await right(-60,0);timeline(2);timeline(5);await right();check(applies===1&&state.playback.transport.loop.enabled&&state.state==='playing','Complete selection right tap commits and starts looping');
  await right(-60,0);await right();check(applies===2&&state.state==='playing','An unchanged valid range also confirms and loops');
  await right(-60,0);await right(-60,0);check(state.playback.frameOrdinal===60&&el('timeline').getAttribute('data-selecting')==='true','Selection left flick controls and seeks the head without exiting');
  await right(60,0);check(state.playback.frameOrdinal===150,'Selection right flick controls and seeks the tail');
  await right(-60,0,true);check(state.playback.frameOrdinal===60,'A held selection wheel uses the same head direction');
  const range=JSON.stringify(state.playback.transport.loop);key('Escape');await settle();check(JSON.stringify(state.playback.transport.loop)===range,'Esc restores the saved range after endpoint control');
  await note();const editor=el('commentEditor').getBoundingClientRect(),screen=el('screen').getBoundingClientRect(),rail=el('timeline').getBoundingClientRect();
  check(el('commentEditor').parentElement===el('screen')&&!el('commentEditor').closest('aside')&&editor.top>=screen.top&&editor.bottom<=screen.bottom&&editor.bottom<=rail.top+1,'Time-note editor floats inside the picture above the timeline');
  check(el('commentSave').hidden&&el('commentCancel').hidden&&document.querySelectorAll('aside textarea').length===0,'Normal note editing has no save/cancel buttons or sidebar input');
  input('观察起手与收尾');check(el('commentDraftPreview').textContent.includes('观察起手与收尾')&&noteWrites===0,'Sidebar previews the draft before any save');
  const nativeMenu=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el('commentText').dispatchEvent(nativeMenu);check(!nativeMenu.defaultPrevented,'Note input keeps its native right-click menu');
  el('commentText').dispatchEvent(new Event('compositionstart'));key('Enter',{},el('commentText'));await right();check(noteWrites===0&&!!state.comments.draft,'Chinese composition blocks both Enter and right-tap saves');
  el('commentText').dispatchEvent(new Event('compositionend'));key('Enter',{},el('commentText'));check(noteWrites===0,'The composition-ending Enter cannot also save');await sleep(60);
  key('Enter',{shiftKey:true},el('commentText'));check(noteWrites===0,'Shift+Enter remains available for a newline');
  key('Enter',{},el('commentText'));key('Enter',{repeat:true},el('commentText'));key('Enter',{},el('commentText'));await sleep(45);check(noteWrites===1&&!state.comments.draft,'Enter saves exactly once and exits');
  check(el('commentDraftPreview').hidden&&el('commentList').textContent.includes('观察起手与收尾'),'Successful save replaces the sidebar draft with a normal note');
  await note();input('');await right();check(!state.comments.draft&&noteWrites===1&&state.comments.items[0].text==='观察起手与收尾','Clearing an existing note and right exiting cancels while preserving original text');
  state.comments.items=[];publish();await note();await right();check(!state.comments.draft&&noteWrites===1,'A blank new note right exit creates no placeholder');
  await note();input('暂存文字');await right(0,0,true);await right(70,0);check(!!state.comments.draft&&noteWrites===1,'Note hold and flick never become a save');key('Escape');check(!state.comments.draft,'Esc cancels a note draft');
  await note();input('失败后保留的文字');noteFail=true;await right();await sleep(45);check(state.comments.draft?.status==='failed'&&el('commentText').value==='失败后保留的文字','Failed right-save retains the note editor and all text');
  noteFail=false;await right();await sleep(45);check(!state.comments.draft,'An explicit retry can save and exit after failure');
  await note();input('待核对文字');noteUnknown=true;await right();await sleep(45);const writesBeforeCheck=noteWrites;check(state.comments.draft?.status==='unknown','Unknown save results retain the editor');
  await right();check(noteChecks===1&&noteWrites===writesBeforeCheck&&!state.comments.draft,'Right tap on an unknown save checks without repeating the write');noteUnknown=false;
  await right(0,60);check(!!state.drawings.draft&&el('drawingPanel').hidden,'Drawing starts with its toolbar hidden by default');
  p=down();await sleep(450);check(menu.querySelectorAll('.context-wheel-item').length===4&&['types','color','eraser','undo'].every(id=>menu.querySelector('[data-wheel-command="'+id+'"]')),'Drawing primary wheel contains only type, color, eraser and undo');
  check(!menu.textContent.includes('更多')&&!menu.textContent.includes('保存')&&!menu.textContent.includes('工具条'),'Removed commands do not remain in the primary wheel');pointer(window,'pointerup',p.x,p.y);
  const toolBefore=el('drawingTool').getAttribute('data-tool'),savesBefore=drawingSaves;p=down();pointer(window,'pointermove',p.x,p.y-40);check(menu.getAttribute('data-level')==='types'&&menu.querySelectorAll('.context-wheel-item').length===5,'Entering the Type sector automatically opens the five-type secondary wheel');pointer(window,'pointerup',p.x,p.y-40);
  check(el('drawingTool').getAttribute('data-tool')===toolBefore&&drawingSaves===savesBefore,'Releasing immediately on secondary opening neither chooses a tool nor saves');
  const edge=el('screen').getBoundingClientRect();pointer(el('picture'),'pointerdown',edge.left+2,edge.top+2);await sleep(450);const types=menu.querySelector('[data-wheel-command="types"]').getBoundingClientRect();pointer(window,'pointermove',types.left+types.width/2,types.top+types.height/2);const secondary=menu.getBoundingClientRect();
  check(secondary.left>=edge.left-1&&secondary.top>=edge.top-1,'Secondary wheel also stays inside the picture at the corner');pointer(window,'pointerup',types.left+types.width/2,types.top+types.height/2);check(el('drawingTool').getAttribute('data-tool')===toolBefore,'Clamping the secondary wheel cannot select a tool without further movement');
  for(const kind of ['pen','arrow','rect','ellipse','text']){await tool(kind);check(el('drawingTool').getAttribute('data-tool')===kind,'Continuous right movement selects '+kind+' through the secondary wheel');}
  await tool('rect');draw();check(state.drawings.draft.objects.length===1,'A secondary-selected type draws through the existing SVG editor');
  await right(-60,0);check(state.drawings.draft.objects.length===0&&drawingSaves===savesBefore,'Primary left flick undoes the whole drawing operation without saving');draw();
  await right(60,0);check(!menu.querySelector('.context-wheel-panel').hidden,'Primary right flick opens a compact color palette');menu.querySelector('.context-wheel-swatch').click();check(menu.hidden,'Picking a color closes only the palette');
  await right(0,60);check(el('drawingTool').getAttribute('data-tool')==='eraser','Primary down flick selects eraser directly');
  el('drawingToolbar').checked=true;el('drawingToolbar').dispatchEvent(new Event('change',{bubbles:true}));await settle();check(!el('drawingPanel').hidden&&state.interactionSettings.drawingToolbar,'Settings can reveal and remember the toolbar during drawing');
  p=down();await sleep(450);key('Escape');pointer(window,'pointerup',p.x,p.y);check(!!state.drawings.draft&&drawingSaves===savesBefore&&el('drawingExit').hidden,'Esc closes a drawing menu without saving or opening the exit dialog '+JSON.stringify({draft:state.drawings.draft?.status,saves:drawingSaves,before:savesBefore,exitHidden:el('drawingExit').hidden,menuHidden:menu.hidden}));
  p=down();await sleep(450);window.dispatchEvent(new Event('blur'));pointer(window,'pointerup',p.x,p.y);check(!!state.drawings.draft&&drawingSaves===savesBefore&&menu.hidden,'Focus loss cancels the wheel while keeping the unsaved drawing');
  p=down();pointer(window,'pointerup',p.x,p.y);p=down();pointer(window,'pointerup',p.x,p.y);await sleep(45);check(!state.drawings.draft&&drawingSaves===savesBefore+1,'Repeated right taps during drawing save submit once and exit');
  await right(0,60);check(!el('drawingPanel').hidden,'Remembered toolbar choice survives leaving and reopening drawing');
  el('drawingToolbar').checked=false;el('drawingToolbar').dispatchEvent(new Event('change',{bubbles:true}));await tool('rect');draw();drawingFail=true;await right();await sleep(45);check(state.drawings.draft?.status==='failed'&&state.drawings.draft.objects.length>0,'Failed drawing save retains all SVG objects');drawingFail=false;
  p=down();pointer(window,'pointermove',p.x,p.y-40);pointer(window,'pointermove',p.x,p.y-80);key('Escape');pointer(window,'pointerup',p.x,p.y-80);check(state.drawings.draft?.status==='failed','Cancelling a secondary menu leaves the failed draft intact');
  key('Escape');check(!el('drawingExit').hidden,'Esc outside the menu preserves the unsaved drawing exit protection');el('drawingExitDiscard').click();await settle();
  stored=[];await right(0,60);await right();await sleep(45);check(state.drawings.records.length===0&&!state.drawings.draft,'An empty drawing session exits without an empty stored group');
  await right(0,60);p=down();await sleep(450);state.epoch++;publish();pointer(window,'pointerup',p.x,p.y-50);check(menu.hidden&&drawingSaves===savesBefore+3,'A source change cannot execute an old menu command');session.cancelDrawing();
  if(window.E16_SCREENSHOT==='note'){state.comments.items=[];await note();input('观察起手：亮点先出现，随后展开冲击环。\n对比收尾的消散节奏。');}
  else{stored=[];await right(0,60);await tool('rect');draw();p=down();if(window.E16_SCREENSHOT==='types')pointer(window,'pointermove',p.x,p.y-40);else await sleep(450);}
  const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed:true,checks});document.body.appendChild(out);
 }catch(error){ui?.destroy();const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed:false,checks,error:error.stack,state});document.body.appendChild(out);}
})();
