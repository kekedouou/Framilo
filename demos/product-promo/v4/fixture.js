(async()=>{
'use strict';const $=id=>document.getElementById(id),q=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms)),data=await(await fetch('/private-data.json')).json();
const media=document.createElement('video');media.muted=true;media.preload='auto';media.src='/media.mp4';media.style.display='none';document.body.append(media);await new Promise((r,j)=>{media.onloadeddata=r;media.onerror=()=>j(Error('Media decode unavailable'));});
const images=await Promise.all(data.comments.map((c,i)=>new Promise((r,j)=>{const img=new Image();img.onload=()=>r(img);img.onerror=j;img.src='/asset/thumb-'+i+'.jpg';})));
const state={epoch:1,state:'paused',duration:data.duration,source:{name:data.sourceName},memorySettings:{ramMiB:1024,ramBytes:1073741824},previewQuality:'720p',preview:{quality:'720p',width:1280,height:720,sourceWidth:2560,sourceHeight:1440},playbackBackend:'proxy',forwardPredecode:true,interactionSettings:{wheelFrames:1,showCacheStrip:true,rateStep:.1,drawingFadeSeconds:.05,drawingToolbar:true},playback:{time:7.6,frameId:228,frameOrdinal:228,frameCount:1479,transport:{rate:1,loop:{valid:false}}},comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',visible:true,records:[],styles:EVADrawingModel.defaultStyles(),draft:null}};
const frames=Array.from({length:1479},(_,i)=>({time:i/30}));let previousTime=0;let ui,drawn=-1,playing=false,mediaTime=7.6,rate=1,now=0,recordIndex=-1,applyAt=null;const fired=new Set(),audit=[];
const publish=()=>ui.update({...state,comments:{...state.comments},drawings:{...state.drawings},playback:{...state.playback}});
const session={loopFrameAt(t,b={}){const ordinal=Math.max(b.minOrdinal||0,Math.min(b.maxOrdinal??1478,b.ordinal??Math.round(t*30)));return{ordinal,time:ordinal/30};},async applyLoopRange(r){state.playback.transport.loop={valid:true,enabled:false,...r,startTime:r.startOrdinal/30,endTime:r.endOrdinal/30,endBoundary:(r.endOrdinal+1)/30};audit.push({action:'range',at:now,...r});publish();return{status:'ok'};},async setLoopEnabled(value){state.playback.transport.loop.enabled=value;if(value)mediaTime=state.playback.transport.loop.startTime;audit.push({action:'loop-enabled',at:now,value});publish();return{status:'ok'};},async clearLoop(){state.playback.transport.loop={valid:false};publish();},async toggle(){return playing?session.pause():session.play();},touchDrawing(){if(state.drawings.draft)state.drawings.draft.dirty=true;},timelineFrames:()=>frames,annotationFrame:t=>Math.round(t*30),setCommentsVisible(){},prioritizeRecords(){},refreshComments:async()=>{},memorySnapshot:()=>null,async pause(){playing=false;state.state='paused';publish();},async play(){playing=true;state.state='playing';publish();},async seek(t){mediaTime=t;state.playback.time=t;state.playback.frameId=state.playback.frameOrdinal=Math.round(t*30);publish();return{status:'drawn'};},async seekComment(id){const c=state.comments.items.find(c=>c.id===id);if(c){mediaTime=c.time;playing=false;state.state='paused';audit.push({action:'record',at:now,sourceTime:c.time});publish();}},async setPlaybackRate(value){rate=value;state.playback.transport.rate=value;audit.push({action:'rate',at:now,value});publish();return{status:'ok'};},async beginDrawing(){playing=false;state.state='paused';state.drawings.draft={id:'demo-draft',kind:'edit',status:'editing',objects:[],dirty:false,noteChoices:[]};publish();},setDrawingObjects(objects){state.drawings.draft.objects=objects;state.drawings.draft.dirty=true;publish();},setDrawingStyles(styles){state.drawings.styles=styles;publish();},setDrawingNote(text){state.drawings.draft.noteText=text;state.drawings.draft.noteDirty=true;publish();},cancelDrawing(){state.drawings.draft=null;publish();},async saveDrawing(){const d=state.drawings.draft;const record={id:'demo-saved',sourceSha256:data.sourceSha,frameOrdinal:Math.round(mediaTime*30),frameId:Math.round(mediaTime*30),time:mediaTime,objects:structuredClone(d.objects),nativeLinks:[{id:'demo-note',time:mediaTime}]};state.drawings.records=[record];state.comments.items=[{id:'demo-note',time:mediaTime,text:d.noteText,drawingId:record.id}];audit.push({action:'demo-save',at:now,objects:d.objects.length,text:d.noteText});state.drawings.draft=null;publish();return{status:'saved'};},async setDrawingsVisible(value){state.drawings.visible=value;publish();},async setDrawingToolbar(value){state.interactionSettings.drawingToolbar=value;publish();},async setPlaybackSettings(v){state.previewQuality=v.previewQuality;state.preview={...state.preview,quality:v.previewQuality,width:1920,height:1080};applyAt=now;audit.push({action:'quality-apply',at:now,quality:v.previewQuality});state.state='preparing';publish();return{status:'ok'};},async renderThumbnail(t,c){const i=data.comments.findIndex(n=>Math.abs(n.time-t)<.001);c.width=480;c.height=270;c.getContext('2d').drawImage(images[Math.max(0,i)],0,0,480,270);return{release(){c.width=c.height=1;}};}};
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


const ease=u=>{u=Math.max(0,Math.min(1,u));return u*u*(3-2*u);};
const moves=new Map(),highlights=new Map();
function move(x,y,button=0){pointer(window,'pointermove',x,y,button);cursor={x,y};}
function down(x,y,button=0){document.activeElement?.blur();pointer($('picture'),'pointerdown',x,y,button);cursor={x,y};}
function up(x,y,button=0){pointer(window,'pointerup',x,y,button);cursor={x,y,click:true};}
function openWheel(x=720,y=340){down(x,y,2);}
function glide(id,start,end,t,target,button=0){if(t<start||t>end)return;let a=moves.get(id);if(!a){a={...cursor};moves.set(id,a);}const b=typeof target==='function'?target():target,u=ease((t-start)/(end-start));move(a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u,button);}
function wheelPoint(id){const n=q('[data-wheel-command="'+id+'"]');if(!n)throw Error('Missing wheel '+id);return rectPoint(n);}
async function wheelChoice(id,start,arrive,release,t){glide('wheel-'+id+'-'+start,start,arrive,t,()=>wheelPoint(id),2);if(t>=arrive&&t<release){const p=wheelPoint(id);move(p.x,p.y,2);const n=q('[data-wheel-command="'+id+'"]');if(n?.getAttribute('data-active')==='true'&&!highlights.has(id+'-'+start))highlights.set(id+'-'+start,t);}await once('release-'+id+'-'+start,release,t,()=>{const p=wheelPoint(id),since=highlights.get(id+'-'+start);audit.push({action:'wheel-highlight',id,seconds:since===undefined?0:t-since});up(p.x,p.y,2);audit.push({action:'wheel',id,at:t});});}
function timelinePoint(time){const r=$('timeline').getBoundingClientRect();return{x:r.left+r.width*time/data.duration,y:r.top+9};}
function timelineTap(time){const p=timelinePoint(time);pointer($('timeline'),'pointerdown',p.x,p.y);up(p.x,p.y);}
function card(index){return[...document.querySelectorAll('.shell-record-card')].find(n=>n.getAttribute('aria-label')===data.comments[index].text);}
let resizeGrip=null;
window.demo={cursor,audit,wheel:null,async render(t){now=t;tick(t);cursor={...cursor,click:false};window.demo.wheel=null;
const dt=t-previousTime;previousTime=t;if(playing){mediaTime+=dt*rate;const loop=state.playback.transport.loop;if(loop.enabled&&mediaTime>=loop.endBoundary){mediaTime=loop.startTime+(mediaTime-loop.startTime)%(loop.endBoundary-loop.startTime);audit.push({action:'loop-wrap',at:t});}}
await once('start',0,t,()=>session.play());
await once('pause-gesture',2,t,()=>session.pause());
await once('seek-down',2.3,t,()=>down(720,340));
glide('seek',2.9,3.6,t,{x:676,y:340});
await once('seek-up',4.2,t,()=>up(676,340));
await once('rate-down',4.5,t,()=>down(720,280));
if(t>=5.1&&t<6.5){const u=Math.min(1,(t-5.1)/1.3);move(720,286+196*u);}
await once('rate-up',7.1,t,()=>up(720,482));
await once('brief-play',7.2,t,()=>session.play());
await once('pause-note',8.6,t,()=>{session.pause();return session.seek(8.6);});
await once('note-menu',9,t,()=>openWheel());
await wheelChoice('note',9.6,10.2,12,t);
await once('note-panels',12.7,t,()=>audit.push({action:'panels-visible',editor:!q('.shell-editor').hidden,toolbar:!q('.drawing-panel').hidden}));
await once('types-menu',13.4,t,()=>openWheel());
glide('types',14,14.5,t,{x:720,y:290},2);
if(t>=14.5&&t<15)move(720,290,2);
await wheelChoice('arrow',15,15.5,16.2,t);
const a={x:.65,y:.25},b={x:.61,y:.43};
glide('to-draw',16.3,16.7,t,()=>rectPoint($('drawingLayer'),a.x,a.y));
await once('draw-start',16.8,t,()=>{const p=rectPoint($('drawingLayer'),a.x,a.y);pointer($('drawingLayer'),'pointerdown',p.x,p.y);});
if(t>=16.8&&t<17.9){const u=ease((t-16.8)/.95),p=rectPoint($('drawingLayer'),a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u);pointer($('drawingLayer'),'pointermove',p.x,p.y);cursor=p;}
await once('draw-end',17.9,t,()=>{const p=rectPoint($('drawingLayer'),b.x,b.y);pointer($('drawingLayer'),'pointerup',p.x,p.y);});
glide('to-text',18,18.4,t,()=>rectPoint(q('.shell-editor textarea'),.45,.3));
if(t>=18.5&&t<21){const input=q('.shell-editor textarea'),text='细长拖尾，引导视线落到目标。';input.focus({preventScroll:true});input.value=text.slice(0,Math.floor((t-18.5)*8));input.dispatchEvent(new Event('input'));}
glide('to-save',21,21.5,t,{x:1040,y:330});
await once('save',21.7,t,()=>{down(1040,330,2);up(1040,330,2);});
await once('saved-visible',22.5,t,()=>{const groups=EVADrawingModel.visibleGroups(state.drawings.records,mediaTime,.05,state.playback.frameOrdinal);audit.push({action:'saved-visible-proof',groups:groups.length,objects:groups.reduce((n,g)=>n+g.record.objects.length,0),draft:!!state.drawings.draft});});
await once('beam',23.5,t,()=>{state.comments.items=data.comments;state.drawings.records=data.records;mediaTime=5.30;session.setPlaybackRate(.2);return session.play();});
if(t>=22&&t<30)cursor.hidden=true;
await once('pause-beam',29.5,t,()=>session.pause());
await once('selection-menu',30.5,t,()=>openWheel());
await wheelChoice('selection',31.1,31.6,32.3,t);
glide('to-range-start',32.7,33.3,t,()=>timelinePoint(5.25));
await once('range-start',33.5,t,()=>timelineTap(5.25));
glide('to-range-end',33.8,34.3,t,()=>timelinePoint(5.85));
await once('range-end',34.6,t,()=>timelineTap(5.85));
glide('to-confirm',34.8,35.3,t,{x:350,y:500});
await once('range-confirm',35.5,t,()=>{down(350,500,2);up(350,500,2);});
await once('loop-menu',36.6,t,()=>openWheel(720,340));
await wheelChoice('loop',37.2,37.7,38.5,t);
if(t>=39&&t<45)cursor.hidden=true;
await once('pause-loop',45,t,()=>session.pause());
await once('loop-off-key',45.1,t,()=>key('L'));
await once('records-menu',45.5,t,()=>openWheel());
await wheelChoice('records',46.1,46.7,48.6,t);
await once('records-opened',49.3,t,()=>audit.push({action:'records-open-proof',width:q('.shell-records').clientWidth}));
glide('to-grip',49.4,49.9,t,()=>rectPoint(q('.shell-record-grip')));
await once('resize-start',50,t,()=>{resizeGrip=q('.shell-record-grip');resizeGrip.setPointerCapture=()=>{};const p=rectPoint(resizeGrip);pointer(resizeGrip,'pointerdown',p.x,p.y);});
if(t>=50&&t<51.1){const u=ease((t-50)/.9),x=1440-(280-64*u),p=rectPoint(resizeGrip);pointer(resizeGrip,'pointermove',x,p.y);cursor={x,y:p.y};}
await once('resize-end',51.1,t,()=>{const p=rectPoint(resizeGrip);pointer(resizeGrip,'pointerup',p.x,p.y);audit.push({action:'record-width',value:q('.shell-records').clientWidth});});
glide('to-first-record',51.4,51.9,t,()=>rectPoint(card(2)));
await once('first-record',52.5,t,()=>click(card(2)));
await once('scroll-before',53.2,t,()=>{const list=q('.shell-record-list');audit.push({action:'scroll-geometry',before:list.scrollTop,max:list.scrollHeight-list.clientHeight,cards:list.children.length});});
if(t>=53.3&&t<54.8){const p=rectPoint(q('.shell-record-list'),.62,.48);cursor=p;window.demo.wheel={...p,delta:500*dt/1.5};}
glide('to-second-record',55,55.5,t,()=>rectPoint(card(5)));
await once('second-record',56.1,t,()=>{click(card(5));audit.push({action:'record-scroll',value:q('.shell-record-list').scrollTop});});
glide('to-close-records',57,57.5,t,()=>rectPoint(q('[aria-label="关闭记录"]')));
await once('records-close',58.1,t,()=>click(q('[aria-label="关闭记录"]')));
glide('to-settings',58.5,59.1,t,()=>rectPoint(q('[aria-label="设置"]')));
await once('settings',59.8,t,()=>click(q('[aria-label="设置"]')));
glide('to-advanced',60.4,61,t,()=>rectPoint(q('[data-setting="advanced"]')));
await once('advanced',61.7,t,()=>click(q('[data-setting="advanced"]')));
glide('to-level-three',62.3,62.9,t,()=>rectPoint(q('[data-setting="rateStep"]')));
await once('level-three',63.6,t,()=>{click(q('[data-setting="rateStep"]'));audit.push({action:'settings-three'});});
glide('leave-menu',63.9,64.4,t,{x:1100,y:800});
if(t>=64.5)cursor.hidden=true;
state.playback.time=mediaTime;state.playback.frameId=state.playback.frameOrdinal=Math.round(mediaTime*30);state.playback.transport.rate=rate;state.state=playing?'playing':'paused';publish();
await seekMedia(mediaTime);paint();animations(t);await new Promise(r=>requestAnimationFrame(r));animations(t);
q('.shell-dock')?.dispatchEvent(new PointerEvent('pointerenter'));window.demo.cursor=cursor;
}};
})().catch(e=>{window.demoError=e.stack;console.error(e);});
