/* Native DOM and actual UI controllers; Session/video are stand-ins. */
(async function(){
 'use strict';
 const el=id=>document.getElementById(id),checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const check=(ok,text)=>{if(!ok)throw Error(text);checks.push(text);};
 const state={epoch:1,state:'paused',duration:10,source:{name:'E-14 操作检查（无真实视频）'},previewQuality:'1440p',
  preview:{quality:'1440p',width:1920,height:1080,sourceWidth:1920,sourceHeight:1080,sampleAspectRatio:'1:1',rotation:0,originalResolution:true},
  memorySettings:{ramMiB:1024,ramBytes:1073741824},playback:{time:2,frameId:60,frameOrdinal:60,frameCount:300,transport:{rate:1,loop:{valid:false,enabled:false}}},
  comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',records:[],visible:true,styles:EVADrawingModel.defaultStyles(),draft:null}};
 let ui,notes=0,toggles=0,applies=0,saves=0,settings=0,serial=0;
 const seeks=[],publish=()=>ui.update({...state,drawings:{...state.drawings},playback:{...state.playback}});
 const session={setCommentsVisible(){},refreshComments:async()=>{},memorySnapshot:()=>null,
  async pause(){state.state='paused';toggles++;publish();return{status:'paused'};},async play(){state.state='playing';toggles++;publish();return{status:'playing'};},
  async seek(time,o={}){const ordinal=o.index??Math.max(0,Math.min(299,Math.floor(time*30+1e-7)));seeks.push({time,...o});state.state='paused';state.playback={...state.playback,time:ordinal/30,frameOrdinal:ordinal,frameId:ordinal};publish();return{status:'drawn'};},
  loopFrameAt(time,b){const ordinal=Math.max(b.minOrdinal??0,Math.min(b.maxOrdinal??299,b.ordinal??Math.floor(time*30+1e-7)));return{ordinal,time:ordinal/30};},
  async applyLoopRange(v){applies++;state.playback.transport.loop={...v,valid:true,enabled:true,startTime:v.startOrdinal/30,endTime:v.endOrdinal/30,endBoundary:(v.endOrdinal+1)/30};publish();return{status:'applied'};},
  async setLoopEnabled(enabled){state.playback.transport.loop.enabled=enabled;publish();return{status:'applied'};},
  async setPlaybackRate(rate){state.playback.transport.rate=rate;publish();return{status:'applied'};},
  async beginComment(){notes++;return{status:'ignored'};},
  async beginDrawing(){state.state='paused';state.drawings.draft={id:'draw-'+(++serial),status:'editing',kind:'edit',objects:[],dirty:false};publish();return{status:'editing'};},
  setDrawingObjects(objects){state.drawings.draft={...state.drawings.draft,objects,dirty:true};publish();},touchDrawing(){state.drawings.draft.dirty=true;publish();},
  setDrawingStyles(styles){state.drawings.styles=styles;publish();return{status:'saved'};},
  async saveDrawing(){saves++;state.drawings.draft=null;publish();return{status:'saved'};},cancelDrawing(){state.drawings.draft=null;publish();return true;},
  async setPlaybackSettings(v){settings++;state.previewQuality=v.previewQuality;state.interactionSettings=v;publish();return{status:'applied'};}};
 const objects=()=>state.drawings.draft?.objects||[];
 function ptr(type,x,y,button=0,target=null){const r=el('screen').getBoundingClientRect();const e=new PointerEvent(type,{pointerId:17,button,buttons:type==='pointerup'?0:button===2?2:1,clientX:r.left+x,clientY:r.top+y,bubbles:true,cancelable:true});(target||(type==='pointerdown'?el('picture'):window)).dispatchEvent(e);return e;}
 async function right(dx,dy,x=320,y=220){ptr('pointerdown',x,y,2);ptr('pointermove',x+dx,y+dy,2);ptr('pointerup',x+dx,y+dy,2);await settle();}
 function key(type,key){window.dispatchEvent(new KeyboardEvent(type,{key,code:key.length===1?'Key'+key.toUpperCase():key,bubbles:true,cancelable:true}));}
 async function left(dx=70){ptr('pointerdown',220,230);ptr('pointermove',220+dx,230);ptr('pointerup',220+dx,230);await settle();}
 function shape(){const n=el('drawingLayer'),r=n.getBoundingClientRect();for(const[type,x,y]of[['pointerdown',.25,.35],['pointermove',.45,.55],['pointerup',.45,.55]])n.dispatchEvent(new PointerEvent(type,{pointerId:18,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+r.width*x,clientY:r.top+r.height*y,bubbles:true,cancelable:true}));}
 try{
  ui=EVAUI.createUI();ui.bindSession(session);publish();await settle();
  check(el('qualitySelect').querySelector('[value="1440p"]').hidden,'1080p source hides the redundant 2K option');
  check(el('qualitySelect').value==='1080p','Remembered 2K maps to the current effective 1080p selection');
  check(settings===0&&state.previewQuality==='1440p','Filtering does not silently overwrite the remembered quality');
  check([...el('qualitySelect').options].filter(n=>!n.hidden&&n.textContent.includes('原始分辨率')).length===1,'Only one visible option is labelled original resolution');
  state.preview={...state.preview,sourceWidth:3840,sourceHeight:2160};publish();check(!el('qualitySelect').querySelector('[value="1440p"]').hidden&&el('qualitySelect').value==='1440p','A later 4K source restores the remembered 2K option');
  state.preview={...state.preview,sourceWidth:1920,sourceHeight:1080};publish();el('memoryApply').click();await settle();check(settings===1&&state.previewQuality==='1080p','Explicit Apply saves the effective visible quality');
  state.state='seeking';publish();const before=seeks.length;await left();check(seeks.length>before&&seeks.at(-1).final,'Picture drag can replace a pending seek immediately');
  ptr('pointerdown',200,230);ptr('pointermove',250,230);ptr('pointerdown',220,230);ptr('pointermove',340,230);ptr('pointerup',340,230);await settle();check(seeks.at(-1).final,'A fresh press recovers a swallowed pointer-up');
  const n=notes,t=toggles;ptr('pointerdown',320,220,2);ptr('pointerup',320,220,2);await settle();check(notes===n&&toggles===t&&el('contextWheel').hidden,'A short right click executes no command and does not toggle playback');
  await right(0,-70);check(notes===n+1,'Right-up flick invokes the existing annotation entry exactly once');
  ptr('pointerdown',320,220,2);await sleep(450);check(!el('contextWheel').hidden&&el('contextWheel').getAttribute('data-mode')==='watch','Right hold reveals the four viewing commands');
  key('keydown','Escape');ptr('pointerup',320,150,2);check(notes===n+1&&el('contextWheel').hidden,'Esc cancels a held menu without invoking the selected direction');
  ptr('pointerdown',320,220,2);ptr('pointermove',320,150,2);ptr('pointermove',320,220,2);ptr('pointerup',320,220,2);await settle();check(notes===n+1,'Returning to the gesture center cancels the command');
  await right(-70,0);check(el('timeline').getAttribute('data-selecting')==='true','Right-left begins range selection without clearing a prior range');
  await left(60);check(seeks.at(-1).kind==='loop-select','The first picture drag sets a source-frame endpoint');await left(90);el('loopSelect').click();await settle();check(applies===1,'A second picture drag plus confirmation commits both source-frame endpoints');
  await right(70,0);check(!state.playback.transport.loop.enabled,'Right-right switches an existing valid loop off');
  key('keydown','r');await sleep(280);const a=applies;await left(-25);key('keyup','r');await settle();check(applies===a+1,'Holding R adjusts an existing endpoint on the picture and commits on R release');
  const range=JSON.stringify(state.playback.transport.loop);key('keydown','r');await sleep(280);await left(25);key('keydown','Escape');key('keyup','r');await settle();check(JSON.stringify(state.playback.transport.loop)===range,'Esc cancels picture endpoint edits and preserves the saved range');
  await right(0,70);check(!!state.drawings.draft&&el('drawingPanel').hidden,'Right-down enters drawing with the old toolbar collapsed');
  ptr('pointerdown',320,220,2);await sleep(450);check(el('contextWheel').getAttribute('data-mode')==='drawing'&&el('contextWheel').querySelectorAll('.context-wheel-item').length===8,'Drawing uses its own eight-entry tool wheel');
  check(!el('contextWheel').textContent.includes('线宽')&&!el('contextWheel').textContent.includes('字号'),'The right menu excludes wheel-adjustable size controls');ptr('pointerup',320,220,2);
  await right(70,70);check(el('drawingToolEllipse').getAttribute('aria-pressed')==='true','Drawing diagonal flick selects ellipse');shape();check(objects().length===1&&objects()[0].kind==='ellipse','The selected right-menu tool draws through the existing editor');
  const width=objects()[0].width;el('drawingLayer').dispatchEvent(new WheelEvent('wheel',{deltaY:-1,bubbles:true,cancelable:true}));check(objects()[0].width>width,'Mouse wheel still adjusts line width while the toolbar is collapsed');
  await right(-70,0);check(!el('contextWheel').querySelector('.context-wheel-panel').hidden,'The color entry opens a local palette');el('contextWheel').querySelector('.context-wheel-swatch').click();await settle();check(state.drawings.styles.color==='#ffd54f','Palette changes use the existing style persistence operation');
  await right(-70,-70);check([...el('contextWheel').querySelectorAll('.context-wheel-panel button')].every(n=>!n.textContent.includes('字号')),'More actions contains no size settings');
  [...el('contextWheel').querySelectorAll('.context-wheel-panel button')].find(n=>n.textContent==='撤销').click();await settle();check(objects().length===1,'Undo restores the previous style edit without discarding other objects');
  shape();const beforeDelete=objects().length;await right(-70,-70);[...el('contextWheel').querySelectorAll('.context-wheel-panel button')].find(n=>n.textContent==='删除选中').click();await settle();check(objects().length===beforeDelete-1,'Delete selected removes only the selected local object through the editor');
  await right(-70,-70);[...el('contextWheel').querySelectorAll('.context-wheel-panel button')].find(n=>n.textContent==='撤销').click();await settle();check(objects().length===beforeDelete,'Right-menu undo restores an object deleted through the menu');
  await right(-70,-70);[...el('contextWheel').querySelectorAll('.context-wheel-panel button')].find(n=>n.textContent==='暂时隐藏圈画').click();check(el('drawingLayer').hidden,'Right-menu visibility temporarily hides drawing without deleting it');
  await right(-70,-70);[...el('contextWheel').querySelectorAll('.context-wheel-panel button')].find(n=>n.textContent==='显示圈画').click();check(!el('drawingLayer').hidden,'A hidden drawing remains recoverable from the right menu');
  await right(-70,-70);[...el('contextWheel').querySelectorAll('.context-wheel-panel button')].find(n=>n.textContent==='显示工具条').click();check(!el('drawingPanel').hidden,'The original toolbar can be revealed explicitly from More');
  await right(-70,-70);[...el('contextWheel').querySelectorAll('.context-wheel-panel button')].find(n=>n.textContent==='保存并退出').click();await settle();check(saves===1&&!state.drawings.draft,'Save and exit reuses the protected drawing save flow');
  const oldNotes=notes;ptr('pointerdown',2,2,2);await sleep(450);const rect=el('contextWheel').getBoundingClientRect(),screen=el('screen').getBoundingClientRect();check(rect.left>=screen.left-1&&rect.top>=screen.top-1,'A corner hold keeps the menu inside the picture area');ptr('pointerup',2,2,2);check(notes===oldNotes,'A corner hold and release never executes a displaced menu option');
  ptr('pointerdown',2,2,2);await sleep(450);const topItem=el('contextWheel').querySelector('[data-wheel-command="note"]').getBoundingClientRect();const topX=topItem.left+topItem.width/2-screen.left,topY=topItem.top+topItem.height/2-screen.top;ptr('pointermove',topX,topY,2);ptr('pointerup',topX,topY,2);await settle();check(notes===oldNotes+1,'A clamped corner wheel selects the visibly pointed option after a hold');
  const field=document.createElement('textarea');el('screen').appendChild(field);ptr('pointerdown',320,220,2,field);ptr('pointerup',320,150,2,field);const nativeTextMenu=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});field.dispatchEvent(nativeTextMenu);check(!nativeTextMenu.defaultPrevented&&notes===oldNotes+1,'Text inputs keep their native right-click actions');field.remove();
  ptr('pointerdown',320,220,2);await sleep(450);state.epoch++;publish();check(el('contextWheel').hidden,'A source-generation change clears the active right menu');ptr('pointerup',320,150,2);
  const context=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el('picture').dispatchEvent(context);check(context.defaultPrevented,'The picture suppresses the native context menu for this operation');
  ptr('pointerdown',320,220,2);await sleep(1300);ptr('pointermove',320,150,2);ptr('pointerup',320,150,2);await settle();state.state='preparing';publish();const afterLongHold=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});el('picture').dispatchEvent(afterLongHold);check(afterLongHold.defaultPrevented,'A long hold also suppresses the release context menu after command state changes');state.state='paused';publish();
  await right(0,70);shape();await right(-70,-70);[...el('contextWheel').querySelectorAll('.context-wheel-panel button')].find(n=>n.textContent==='退出圈画').click();await settle();check(!el('drawingExit').hidden&&!!state.drawings.draft,'Exit from the right menu preserves the unsaved-drawing confirmation');el('drawingExitDiscard').click();await settle();check(!state.drawings.draft,'Explicit discard in the existing confirmation releases the draft');
  if(!window.E14_WATCH_SCREENSHOT){await right(0,70);ptr('pointerdown',320,220,2);await sleep(450);}else{ptr('pointerdown',320,220,2);await sleep(450);}
  const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed:true,checks});document.body.appendChild(out);
 }catch(error){ui?.destroy();const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed:false,checks,error:error.stack});document.body.appendChild(out);}
})();
