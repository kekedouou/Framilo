(async()=>{
'use strict';const $=id=>document.getElementById(id),q=s=>document.querySelector(s),wait=ms=>new Promise(r=>setTimeout(r,ms)),data=await(await fetch('/private-data.json')).json();
const media=document.createElement('video');media.muted=true;media.preload='auto';media.src='/media.mp4';media.style.display='none';document.body.append(media);await new Promise((r,j)=>{media.onloadeddata=r;media.onerror=()=>j(Error('Media decode unavailable'));});
const images=await Promise.all(data.comments.map((c,i)=>new Promise((r,j)=>{const img=new Image();img.onload=()=>r(img);img.onerror=j;img.src='/asset/thumb-'+i+'.jpg';})));
const state={epoch:1,state:'paused',duration:data.duration,source:{name:data.sourceName},memorySettings:{ramMiB:1024,ramBytes:1073741824},previewQuality:'720p',preview:{quality:'720p',width:1280,height:720,sourceWidth:2560,sourceHeight:1440},playbackBackend:'proxy',forwardPredecode:true,interactionSettings:{wheelFrames:1,showCacheStrip:true,rateStep:.1,drawingFadeSeconds:.05,drawingToolbar:true},playback:{time:7.6,frameId:228,frameOrdinal:228,frameCount:1479,transport:{rate:1,loop:{valid:false}}},comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',visible:true,records:[],styles:EVADrawingModel.defaultStyles(),draft:null}};
const frames=Array.from({length:1479},(_,i)=>({time:i/30}));let ui,drawn=-1,playing=false,mediaTime=7.6,rate=1,now=0,recordIndex=-1,applyAt=null;const fired=new Set(),audit=[];
const publish=()=>ui.update({...state,comments:{...state.comments},drawings:{...state.drawings},playback:{...state.playback}});
const session={touchDrawing(){if(state.drawings.draft)state.drawings.draft.dirty=true;},timelineFrames:()=>frames,annotationFrame:t=>Math.round(t*30),setCommentsVisible(){},prioritizeRecords(){},refreshComments:async()=>{},memorySnapshot:()=>null,async pause(){playing=false;state.state='paused';publish();},async play(){playing=true;state.state='playing';publish();},async seek(t){mediaTime=t;state.playback.time=t;state.playback.frameOrdinal=Math.round(t*30);publish();},async seekComment(id){const c=state.comments.items.find(c=>c.id===id);if(c){mediaTime=c.time;playing=false;state.state='paused';audit.push({action:'record',at:now,sourceTime:c.time});publish();}},async setPlaybackRate(value){rate=value;state.playback.transport.rate=value;publish();return{status:'ok'};},async beginDrawing(){playing=false;state.state='paused';state.drawings.draft={id:'demo-draft',kind:'edit',status:'editing',objects:[],dirty:false,noteChoices:[]};publish();},setDrawingObjects(objects){state.drawings.draft.objects=objects;state.drawings.draft.dirty=true;publish();},setDrawingStyles(styles){state.drawings.styles=styles;publish();},setDrawingNote(text){state.drawings.draft.noteText=text;state.drawings.draft.noteDirty=true;publish();},cancelDrawing(){state.drawings.draft=null;publish();},async saveDrawing(){audit.push({action:'demo-save',at:now,objects:state.drawings.draft.objects.length,text:state.drawings.draft.noteText});state.drawings.draft=null;publish();},async setDrawingsVisible(value){state.drawings.visible=value;publish();},async setDrawingToolbar(value){state.interactionSettings.drawingToolbar=value;publish();},async setPlaybackSettings(v){state.previewQuality=v.previewQuality;state.preview={...state.preview,quality:v.previewQuality,width:1920,height:1080};applyAt=now;audit.push({action:'quality-apply',at:now,quality:v.previewQuality});state.state='preparing';publish();return{status:'ok'};},async renderThumbnail(t,c){const i=data.comments.findIndex(n=>Math.abs(n.time-t)<.001);c.width=480;c.height=270;c.getContext('2d').drawImage(images[Math.max(0,i)],0,0,480,270);return{release(){c.width=c.height=1;}};}};
localStorage.setItem('eva-graphite-guide','seen');ui=EVAUI.createUI({hostAction:()=>{}});ui.bindSession(session);publish();
const animationStarts=new WeakMap();function animations(t){for(const a of document.getAnimations()){if(!animationStarts.has(a)){animationStarts.set(a,t);a.pause();}const timing=a.effect.getComputedTiming();a.currentTime=Math.min((t-animationStarts.get(a))*1000,Number.isFinite(timing.endTime)?timing.endTime:1e9);}}
const pointer=(node,type,x,y,button=0)=>node.dispatchEvent(new PointerEvent(type,{pointerId:9,button,buttons:type==='pointerup'?0:button===2?2:1,clientX:x,clientY:y,bubbles:true,cancelable:true}));
const key=code=>window.dispatchEvent(new KeyboardEvent('keydown',{key:code.toLowerCase(),code:'Key'+code,bubbles:true,cancelable:true}));
const rectPoint=(n,x=.5,y=.5)=>{const r=n.getBoundingClientRect();return{x:r.left+r.width*x,y:r.top+r.height*y};};
let cursor={x:800,y:440,hidden:true},keyText='';const once=async(id,at,t,fn)=>{if(t>=at&&!fired.has(id)){fired.add(id);await fn();audit.push({action:id,at:t});}};
function click(n){if(!n)throw Error('Missing control');const p=rectPoint(n);n.click();cursor={...p,click:true};}
function paint(){const c=$('picture'),w=state.previewQuality==='1080p'?1920:1280,h=w*9/16;if(c.width!==w){c.width=w;c.height=h;window.dispatchEvent(new Event('resize'));}c.getContext('2d').drawImage(media,0,0,w,h);}
async function seekMedia(t){const frame=Math.min(1478,Math.max(0,Math.floor(t*30+.00001)));if(frame===drawn)return;const target=(frame+.2)/30;await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('Seek timeout '+target)),6000);media.onseeked=()=>{clearTimeout(timer);r();};media.currentTime=target;});drawn=frame;}
window.demo={cursor,key:'',audit,async render(t){now=t;cursor={...cursor,click:false};keyText='';
await once('loaded',5.4,t,()=>{playing=true;mediaTime=7.6;});
if(t>=5.4&&t<10.8)mediaTime=7.6+(t-5.4);await once('first-pause',10.8,t,()=>session.pause());
await once('pause-rewind',12,t,()=>session.pause());
if(t>=12&&t<15){mediaTime=13-(t-12)*(4.4/3);const rail=$('timeline').getBoundingClientRect();cursor={x:rail.left+rail.width*mediaTime/data.duration,y:rail.top+10};keyText='拖动回看';}
await once('resume',15,t,()=>session.play());
for(let i=0;i<5;i++)await once('rate-'+i,16+i*.35,t,()=>{key('X');});
if(t>=16&&t<19)keyText='X   减速至 0.5×';
if(t>=15&&t<21){let delta=Math.min(t-15,1);for(let j=0;j<5;j++)delta+=Math.max(0,Math.min(t-(16+j*.35),.35))*(.9-j*.1);delta+=Math.max(0,t-17.75)*.5;mediaTime=8.6+delta;}
await once('pause-draw',21,t,()=>{mediaTime=8.6;return session.pause();});
await once('begin-draw',24,t,()=>{click(q('[aria-label="标注（N）"]'));});
await once('wheel-open',25,t,async()=>{const p=rectPoint($('picture'),.67,.47);pointer($('picture'),'pointerdown',p.x,p.y,2);await wait(440);pointer(window,'pointermove',p.x,p.y-50,2);await wait(110);cursor={x:p.x,y:p.y-50};});
await once('arrow-tool',27,t,()=>{const b=q('[data-wheel-command="arrow"]');click(b);pointer(window,'pointerup',cursor.x,cursor.y,2);});
const a={x:.65,y:.25},b={x:.61,y:.43};
await once('draw-start',28,t,()=>{const p=rectPoint($('drawingLayer'),a.x,a.y);document.activeElement?.blur();pointer($('drawingLayer'),'pointerdown',p.x,p.y);});
if(t>=28&&t<30){const u=Math.min(1,(t-28)/1.5),p=rectPoint($('drawingLayer'),a.x+(b.x-a.x)*u,a.y+(b.y-a.y)*u);pointer($('drawingLayer'),'pointermove',p.x,p.y);cursor=p;}
await once('draw-end',30,t,()=>{const p=rectPoint($('drawingLayer'),b.x,b.y);pointer($('drawingLayer'),'pointerup',p.x,p.y);});
if(t>=30.5&&t<34.5){const input=q('.shell-editor textarea'),text='命中前的细长拖尾，引导视线落到目标。';input.focus();input.value=text.slice(0,Math.floor((t-30.5)*7));input.dispatchEvent(new Event('input'));cursor=rectPoint(input,.45,.35);}
await once('save-annotation',35,t,()=>{document.activeElement?.blur();click($('drawingSave'));});
await once('restore-original-notes',38,t,()=>{mediaTime=4.05;rate=.1;state.playback.transport.rate=.1;state.comments.items=data.comments;state.drawings.records=data.records;playing=true;publish();});
if(t>=38&&t<62){mediaTime=4.05+(t-38)*.1;cursor.hidden=true;keyText='0.1×';}
await once('beam-paused',62,t,()=>session.pause());
await once('records-open',64,t,()=>{click(q('.shell-dock [aria-label="记录"]'));});
if(t>=65&&t<67)cursor=rectPoint(q('.shell-record-grip'));
if(t>=67&&t<71){const grip=q('.shell-record-grip'),desired=t<69?280+(t-67)*88:456-(t-69)*44;const current=q('.shell-records').clientWidth;if(Math.abs(desired-current)>9)grip.dispatchEvent(new KeyboardEvent('keydown',{key:desired>current?'ArrowLeft':'ArrowRight',bubbles:true,cancelable:true}));cursor={...rectPoint(grip),click:true};}
for(let i=0;i<data.comments.length;i++)await once('jump-'+i,72+i*2,t,async()=>{const list=q('.shell-record-list'),cards=[...document.querySelectorAll('.shell-record-card')],card=cards.find(n=>n.getAttribute('aria-label')===data.comments[i].text);if(!card)throw Error('Missing record '+i);card.scrollIntoView({block:'nearest',behavior:'instant'});list.dispatchEvent(new Event('scroll'));await wait(90);click(card);recordIndex=i;});
await once('records-close',87,t,()=>click(q('[aria-label="关闭记录"]')));
await once('settings-open',89,t,()=>click(q('[aria-label="设置"]')));
await once('advanced-open',91,t,()=>click(q('[data-setting="advanced"]')));
await once('memory-open',93,t,()=>click(q('[data-setting="memoryMiB"]')));
await once('rate-menu',95,t,()=>click(q('[data-setting="rateStep"]')));
await once('quality-open',97,t,()=>click(q('[data-setting="qualitySelect"]')));
await once('quality-1080',99,t,()=>{const option=[...document.querySelectorAll('.shell-settings-level button')].find(n=>n.textContent==='1080p');click(option);});
await once('apply',101,t,()=>click($('memoryApply')));
await once('quality-ready',103,t,()=>{state.state='paused';applyAt=null;publish();});
await once('settings-close',105,t,()=>click(q('[aria-label="设置"]')));
if(t>=105){cursor.hidden=true;keyText='1080p 预览';}
state.playback.time=mediaTime;state.playback.frameId=state.playback.frameOrdinal=Math.round(mediaTime*30);state.playback.transport.rate=rate;state.state=applyAt!==null?'preparing':playing?'playing':'paused';publish();
await seekMedia(mediaTime);paint();animations(t);await new Promise(r=>requestAnimationFrame(r));animations(t);
// Keep the existing dock revealed by the same pointerenter route used by a mouse.
q('.shell-dock')?.dispatchEvent(new PointerEvent('pointerenter'));const upcoming=[[24,'[aria-label="标注（N）"]'],[27,'[data-wheel-command="arrow"]'],[35,'#drawingSave'],[64,'.shell-dock [aria-label="记录"]'],[87,'[aria-label="关闭记录"]'],[89,'[aria-label="设置"]'],[91,'[data-setting="advanced"]'],[93,'[data-setting="memoryMiB"]'],[95,'[data-setting="rateStep"]'],[97,'[data-setting="qualitySelect"]'],[101,'#memoryApply'],[105,'[aria-label="设置"]']].find(n=>t>=n[0]-.75&&t<n[0]);if(upcoming&&q(upcoming[1]))cursor=rectPoint(q(upcoming[1]));
window.demo.cursor=cursor;window.demo.key=keyText;
}};
})().catch(e=>{window.demoError=e.stack;console.error(e);});
