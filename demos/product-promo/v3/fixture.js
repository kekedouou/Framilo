(async()=>{
'use strict';const $=id=>document.getElementById(id),q=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms)),data=await(await fetch('/private-data.json')).json();
const media=document.createElement('video');media.muted=true;media.preload='auto';media.src='/media.mp4';media.style.display='none';document.body.append(media);await new Promise((r,j)=>{media.onloadeddata=r;media.onerror=()=>j(Error('Media decode unavailable'));});
const images=await Promise.all(data.comments.map((c,i)=>new Promise((r,j)=>{const img=new Image();img.onload=()=>r(img);img.onerror=j;img.src='/asset/thumb-'+i+'.jpg';})));
const state={epoch:1,state:'paused',duration:data.duration,source:{name:data.sourceName},memorySettings:{ramMiB:1024,ramBytes:1073741824},previewQuality:'720p',preview:{quality:'720p',width:1280,height:720,sourceWidth:2560,sourceHeight:1440},playbackBackend:'proxy',forwardPredecode:true,interactionSettings:{wheelFrames:1,showCacheStrip:true,rateStep:.1,drawingFadeSeconds:.05,drawingToolbar:true},playback:{time:7.6,frameId:228,frameOrdinal:228,frameCount:1479,transport:{rate:1,loop:{valid:false}}},comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',visible:true,records:[],styles:EVADrawingModel.defaultStyles(),draft:null}};
const frames=Array.from({length:1479},(_,i)=>({time:i/30}));let previousTime=0;let ui,drawn=-1,playing=false,mediaTime=7.6,rate=1,now=0,recordIndex=-1,applyAt=null;const fired=new Set(),audit=[];
const publish=()=>ui.update({...state,comments:{...state.comments},drawings:{...state.drawings},playback:{...state.playback}});
const session={loopFrameAt(t,b={}){const ordinal=Math.max(b.minOrdinal||0,Math.min(b.maxOrdinal??1478,b.ordinal??Math.round(t*30)));return{ordinal,time:ordinal/30};},async applyLoopRange(r){state.playback.transport.loop={valid:true,enabled:false,...r,startTime:r.startOrdinal/30,endTime:r.endOrdinal/30,endBoundary:(r.endOrdinal+1)/30};audit.push({action:'range',at:now,...r});publish();return{status:'ok'};},async setLoopEnabled(value){state.playback.transport.loop.enabled=value;if(value)mediaTime=state.playback.transport.loop.startTime;audit.push({action:'loop-enabled',at:now,value});publish();return{status:'ok'};},async clearLoop(){state.playback.transport.loop={valid:false};publish();},async toggle(){return playing?session.pause():session.play();},touchDrawing(){if(state.drawings.draft)state.drawings.draft.dirty=true;},timelineFrames:()=>frames,annotationFrame:t=>Math.round(t*30),setCommentsVisible(){},prioritizeRecords(){},refreshComments:async()=>{},memorySnapshot:()=>null,async pause(){playing=false;state.state='paused';publish();},async play(){playing=true;state.state='playing';publish();},async seek(t){mediaTime=t;state.playback.time=t;state.playback.frameId=state.playback.frameOrdinal=Math.round(t*30);publish();return{status:'drawn'};},async seekComment(id){const c=state.comments.items.find(c=>c.id===id);if(c){mediaTime=c.time;playing=false;state.state='paused';audit.push({action:'record',at:now,sourceTime:c.time});publish();}},async setPlaybackRate(value){rate=value;state.playback.transport.rate=value;audit.push({action:'rate',at:now,value});publish();return{status:'ok'};},async beginDrawing(){playing=false;state.state='paused';state.drawings.draft={id:'demo-draft',kind:'edit',status:'editing',objects:[],dirty:false,noteChoices:[]};publish();},setDrawingObjects(objects){state.drawings.draft.objects=objects;state.drawings.draft.dirty=true;publish();},setDrawingStyles(styles){state.drawings.styles=styles;publish();},setDrawingNote(text){state.drawings.draft.noteText=text;state.drawings.draft.noteDirty=true;publish();},cancelDrawing(){state.drawings.draft=null;publish();},async saveDrawing(){audit.push({action:'demo-save',at:now,objects:state.drawings.draft.objects.length,text:state.drawings.draft.noteText});state.drawings.draft=null;publish();},async setDrawingsVisible(value){state.drawings.visible=value;publish();},async setDrawingToolbar(value){state.interactionSettings.drawingToolbar=value;publish();},async setPlaybackSettings(v){state.previewQuality=v.previewQuality;state.preview={...state.preview,quality:v.previewQuality,width:1920,height:1080};applyAt=now;audit.push({action:'quality-apply',at:now,quality:v.previewQuality});state.state='preparing';publish();return{status:'ok'};},async renderThumbnail(t,c){const i=data.comments.findIndex(n=>Math.abs(n.time-t)<.001);c.width=480;c.height=270;c.getContext('2d').drawImage(images[Math.max(0,i)],0,0,480,270);return{release(){c.width=c.height=1;}};}};
// Drive UI timers and gestures with the film clock; media I/O timeouts use the real timer.
const realSetTimeout=window.setTimeout.bind(window),realClearTimeout=window.clearTimeout.bind(window);let clockMs=0,timerId=0;const timers=new Map();
window.setTimeout=(fn,ms=0,...args)=>{const id=++timerId;timers.set(id,{at:clockMs+ms,fn,args});return id;};window.clearTimeout=id=>timers.delete(id);
Object.defineProperty(performance,'now',{value:()=>clockMs,configurable:true});
function tick(t){clockMs=t*1000;for(let round=0;round<12;round++){const due=[...timers].filter(([,v])=>v.at<=clockMs);if(!due.length)break;for(const[id,v]of due){timers.delete(id);v.fn(...v.args);}}}
const nativeFocus=HTMLElement.prototype.focus;HTMLElement.prototype.focus=function(options={}){return nativeFocus.call(this,{...options,preventScroll:true});};
localStorage.setItem('eva-graphite-guide','seen');ui=EVAUI.createUI({hostAction:()=>{}});ui.bindSession(session);publish();
const animationStarts=new WeakMap();function animations(t){for(const a of document.getAnimations()){if(!animationStarts.has(a)){animationStarts.set(a,t);a.pause();}const timing=a.effect.getComputedTiming();a.currentTime=Math.min((t-animationStarts.get(a))*1000,Number.isFinite(timing.endTime)?timing.endTime:1e9);}}
const pointer=(node,type,x,y,button=0)=>node.dispatchEvent(new PointerEvent(type,{pointerId:9,button,buttons:type==='pointerup'?0:button===2?2:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
const key=code=>window.dispatchEvent(new KeyboardEvent('keydown',{key:code.toLowerCase(),code:'Key'+code,bubbles:true,cancelable:true}));
const rectPoint=(n,x=.5,y=.5)=>{const r=n.getBoundingClientRect();return{x:r.left+r.width*x,y:r.top+r.height*y};};
let cursor={x:800,y:440,hidden:true},keyText='';const once=async(id,at,t,fn)=>{if(t>=at&&!fired.has(id)){fired.add(id);await fn();audit.push({action:id,at:t});}};
function click(n){if(!n)throw Error('Missing control');const p=rectPoint(n);n.click();cursor={...p,click:true};}
function paint(){const c=$('picture'),w=state.previewQuality==='1080p'?1920:1280,h=w*9/16;if(c.width!==w){c.width=w;c.height=h;window.dispatchEvent(new Event('resize'));}c.getContext('2d').drawImage(media,0,0,w,h);}
async function seekMedia(t){const frame=Math.min(1478,Math.max(0,Math.floor(t*30+.00001)));if(frame===drawn)return;const target=(frame+.2)/30;await new Promise((r,j)=>{const timer=realSetTimeout(()=>j(Error('Seek timeout '+target)),6000);media.onseeked=()=>{realClearTimeout(timer);r();};media.currentTime=target;});drawn=frame;}

function point(x=720,y=340){return{x,y};}
function move(x,y,button=0){pointer(window,'pointermove',x,y,button);cursor={x,y};}
function down(x,y,button=0){document.activeElement?.blur();pointer($('picture'),'pointerdown',x,y,button);cursor={x,y};}
function up(x,y,button=0){pointer(window,'pointerup',x,y,button);cursor={x,y,click:true};}
function openWheel(x=720,y=340){down(x,y,2);}
function wheelRelease(id){const node=q('[data-wheel-command="'+id+'"]');if(!node)throw Error('Missing wheel '+id);const p=rectPoint(node);move(p.x,p.y,2);up(p.x,p.y,2);audit.push({action:'wheel',id,at:now});}
function timelineTap(time){const r=$('timeline').getBoundingClientRect(),x=r.left+r.width*time/data.duration,y=r.top+9;pointer($('timeline'),'pointerdown',x,y);up(x,y);cursor={x,y,click:true};}
let resizeGrip=null;
window.demo={cursor,audit,wheel:null,async render(t){now=t;tick(t);cursor={...cursor,click:false};window.demo.wheel=null;
const dt=t-previousTime;previousTime=t;if(playing){mediaTime+=dt*rate;const loop=state.playback.transport.loop;if(loop.enabled&&mediaTime>=loop.endBoundary){mediaTime=loop.startTime+(mediaTime-loop.startTime)%(loop.endBoundary-loop.startTime);audit.push({action:'loop-wrap',at:t});}}
await once('start',0,t,()=>session.play());
await once('pause-gesture',2,t,()=>session.pause());
await once('seek-down',2.3,t,()=>down(720,340));
if(t>=3&&t<4){const u=Math.min(1,(t-3)/.85);move(720-44*u,340);}
await once('seek-up',4,t,()=>up(676,340));
await once('rate-down',4.3,t,()=>down(720,280));
if(t>=5&&t<6.25){const u=Math.min(1,(t-5)/1.15);move(720,286+196*u);}
await once('rate-up',6.25,t,()=>up(720,482));
await once('brief-play',6.4,t,()=>session.play());
await once('pause-note',7.6,t,()=>{session.pause();return session.seek(8.6);});
await once('note-menu',8,t,()=>openWheel());
await once('note-select',9.1,t,()=>wheelRelease('note'));
await once('types-menu',9.7,t,()=>openWheel());
if(t>=10.2&&t<10.7)move(720,290,2);
await once('arrow-select',10.8,t,()=>wheelRelease('arrow'));
const a={x:.65,y:.25},b={x:.61,y:.43};
await once('draw-start',11.4,t,()=>{const p=rectPoint($('drawingLayer'),a.x,a.y);pointer($('drawingLayer'),'pointerdown',p.x,p.y);});
if(t>=11.4&&t<12.4){const u=Math.min(1,(t-11.4)/.85),p=rectPoint($('drawingLayer'),a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u);pointer($('drawingLayer'),'pointermove',p.x,p.y);cursor=p;}
await once('draw-end',12.4,t,()=>{const p=rectPoint($('drawingLayer'),b.x,b.y);pointer($('drawingLayer'),'pointerup',p.x,p.y);});
if(t>=12.6&&t<15){const input=q('.shell-editor textarea'),text='细长拖尾，引导视线落到目标。';input.focus({preventScroll:true});input.value=text.slice(0,Math.floor((t-12.6)*8));input.dispatchEvent(new Event('input'));cursor=rectPoint(input,.5,.3);}
await once('save',15.3,t,()=>{down(1040,330,2);up(1040,330,2);});
await once('beam',16,t,()=>{state.comments.items=data.comments;state.drawings.records=data.records;mediaTime=4.05;session.setPlaybackRate(.2);return session.play();});
if(t>=16&&t<28)cursor.hidden=true;
await once('pause-beam',28,t,()=>session.pause());
await once('selection-menu',28.1,t,()=>openWheel());
await once('selection-command',29.2,t,()=>wheelRelease('selection'));
await once('range-start',30.1,t,()=>timelineTap(5.25));
await once('range-end',30.85,t,()=>timelineTap(5.85));
await once('range-confirm',31.4,t,()=>{down(350,500,2);up(350,500,2);});
await once('loop-menu',32,t,()=>openWheel(350,500));
await once('loop-command',33.1,t,()=>wheelRelease('loop'));
if(t>=33.7&&t<40.2)cursor.hidden=true;
await once('pause-loop',40.2,t,()=>session.pause());
await once('stop-loop-menu',40.4,t,()=>openWheel());
await once('stop-loop-command',41.35,t,()=>wheelRelease('loop'));
await once('records-menu',41.8,t,()=>openWheel());
await once('records-command',42.9,t,()=>wheelRelease('records'));
await once('resize-start',43.7,t,()=>{resizeGrip=q('.shell-record-grip');resizeGrip.setPointerCapture=()=>{};const p=rectPoint(resizeGrip);pointer(resizeGrip,'pointerdown',p.x,p.y);});
if(t>=43.7&&t<44.5){const u=Math.min(1,(t-43.7)/.65),x=1440-(280-64*u),p=rectPoint(resizeGrip);pointer(resizeGrip,'pointermove',x,p.y);cursor={x,y:p.y};}
await once('resize-end',44.5,t,()=>{const p=rectPoint(resizeGrip);pointer(resizeGrip,'pointerup',p.x,p.y);audit.push({action:'record-width',value:q('.shell-records').clientWidth});});
await once('first-record',45,t,()=>{const card=[...document.querySelectorAll('.shell-record-card')].find(n=>n.getAttribute('aria-label')===data.comments[2].text);click(card);});
if(t>=46&&t<47.4){const p=rectPoint(q('.shell-record-list'),.62,.48);cursor=p;window.demo.wheel={...p,delta:300*dt/1.4};}
await once('second-record',48,t,()=>{const card=[...document.querySelectorAll('.shell-record-card')].find(n=>n.getAttribute('aria-label')===data.comments[5].text);click(card);audit.push({action:'record-scroll',value:q('.shell-record-list').scrollTop});});
await once('records-close',50,t,()=>click(q('[aria-label="关闭记录"]')));
await once('settings',51,t,()=>click(q('[aria-label="设置"]')));
await once('advanced',52,t,()=>click(q('[data-setting="advanced"]')));
await once('level-three',53,t,()=>{click(q('[data-setting="rateStep"]'));audit.push({action:'settings-three'});});
if(t>=54)cursor.hidden=true;
state.playback.time=mediaTime;state.playback.frameId=state.playback.frameOrdinal=Math.round(mediaTime*30);state.playback.transport.rate=rate;state.state=playing?'playing':'paused';publish();
await seekMedia(mediaTime);paint();animations(t);await new Promise(r=>requestAnimationFrame(r));animations(t);
q('.shell-dock')?.dispatchEvent(new PointerEvent('pointerenter'));
const upcoming=[[45,data.comments[2].text],[48,data.comments[5].text]].find(n=>t>=n[0]-.45&&t<n[0]);if(upcoming){const card=[...document.querySelectorAll('.shell-record-card')].find(n=>n.getAttribute('aria-label')===upcoming[1]);if(card)cursor=rectPoint(card);}
window.demo.cursor=cursor;
}};
})().catch(e=>{window.demoError=e.stack;console.error(e);});
