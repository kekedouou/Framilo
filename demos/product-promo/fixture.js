(async function(){
 'use strict';const $=id=>document.getElementById(id),q=s=>document.querySelector(s),checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms)),settle=()=>sleep(260);
 const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};let ui,leases=0,host=[],plays=0;
 const state={epoch:1,state:'paused',duration:10,source:{name:'炎舞连斩 · 正式界面检查'},memorySettings:{ramMiB:512,ramBytes:536870912},interactionSettings:{wheelFrames:1,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:true},playback:{time:2,frameId:60,frameOrdinal:60,frameCount:300,transport:{rate:1,loop:{valid:false}}},comments:{status:'ready',items:Array.from({length:35},(_,i)=>({id:'n'+i,time:i/5,text:'火焰边缘散开，主体轮廓开始消失。'})),draft:null},drawings:{status:'ready',visible:true,records:[],styles:EVADrawingModel.defaultStyles(),draft:null}};
 state.comments.items[5].time=1;state.comments.items[6].time=1+1/30;state.comments.items[7].time=1+2/30;state.comments.items[8].time=1+3/30;state.comments.items[0].drawingId='art';state.drawings.records=[{id:'art',time:2,frameOrdinal:60,objects:[{id:'label',kind:'text',a:{x:.4,y:.4},text:'画面标注',size:.04,color:'#69d785'},{id:'arrow1',kind:'arrow',a:{x:.2,y:.7},b:{x:.7,y:.3},color:'#ffffff',width:.004,erasures:[{width:.04,points:[{x:.4,y:.5}]}]}]}];
 const publish=()=>ui.update({...state,comments:{...state.comments},drawings:{...state.drawings},playback:{...state.playback}});
 const frames=Array.from({length:300},(_,i)=>({time:i/30}));
 const session={deleteComment(id){state.comments.draft={id:'delete-1',kind:'delete',status:'editing',text:'测试',time:0,message:'确认删除？'};publish();},cancelComment(){state.comments.draft=null;publish();},saveComment(){state.comments.draft=null;publish();},timelineFrames:()=>frames,setCommentsVisible(){},refreshComments:async()=>{},memorySnapshot:()=>null,annotationFrame:t=>Math.round(t*30),async pause(){state.state='paused';publish();},async play(){plays++;state.state='playing';publish();},async seekComment(id){state.playback.time=state.comments.items.find(n=>n.id===id).time;state.state='paused';publish();},async beginDrawing(id){check(id==null||typeof id==='string','Annotation action never passes a DOM event as a record id');state.state='paused';state.drawings.draft={id:'d1',kind:'edit',status:'editing',objects:[],dirty:false};publish();state.drawings.draft.noteChoices=[];publish();},setDrawingNote(text,id){const d=state.drawings.draft;d.noteText=text;if(id){d.noteOriginal=d.noteChoices.find(n=>n.id===id);d.noteText=d.noteOriginal.text;}d.noteDirty=!!d.noteText;publish();},cancelDrawing(){state.drawings.draft=null;publish();},async saveDrawing(){state.drawings.draft=null;publish();},setDrawingObjects(objects){state.drawings.draft.objects=objects;publish();},setDrawingStyles(styles){state.drawings.styles=styles;publish();},renderThumbnail:async(t,c)=>{c.width=240;c.height=135;paint(c,t);leases++;let done=false;return{release(){if(!done){done=true;leases--;c.width=c.height=1;}}};}};
 function paint(c,t=0){
 const x=c.getContext('2d'),w=1280,h=720;x.setTransform(c.width/w,0,0,c.height/h,0,0);
 x.fillStyle='#13191e';x.fillRect(0,0,w,h);
 const g=x.createRadialGradient(w*.53,h*.55,0,w*.53,h*.55,w*.53);g.addColorStop(0,'#24343c');g.addColorStop(1,'#12171c');x.fillStyle=g;x.fillRect(0,0,w,h);
 x.strokeStyle='#52636e22';x.lineWidth=1;for(let j=0;j<9;j++){x.beginPath();x.moveTo(0,h*(.67+j*.04));x.lineTo(w,h*(.67+j*.04));x.stroke();}
 const phase=t%3/3,head=-2.9+phase*5.6,cx=w*.5,cy=h*.49,rx=w*.28,ry=h*.29;
 x.globalCompositeOperation='lighter';
 for(let j=0;j<95;j++){const k=j/94,a=head-k*1.9,fade=Math.pow(1-k,1.7),px=cx+Math.cos(a)*rx,py=cy+Math.sin(a)*ry;
 const g=x.createRadialGradient(px,py,0,px,py,30+fade*22);g.addColorStop(0,'rgba(130,220,255,'+fade*.32+')');g.addColorStop(.28,'rgba(38,153,232,'+fade*.17+')');g.addColorStop(1,'rgba(0,80,160,0)');x.fillStyle=g;x.fillRect(px-55,py-55,110,110);
 x.strokeStyle='rgba(146,229,255,'+fade*.7+')';x.lineWidth=1+fade*3;x.beginPath();x.moveTo(px,py);x.lineTo(cx+Math.cos(a-.04)*rx,cy+Math.sin(a-.04)*ry);x.stroke();
 }
 for(let i=0;i<75;i++){const k=((i*.618+phase)%1),a=head-k*2.4,spread=Math.sin(i*127.1)*k*60,px=cx+Math.cos(a)*(rx+spread),py=cy+Math.sin(a)*(ry+spread);x.fillStyle='rgba(109,205,255,'+(1-k)*.65+')';x.fillRect(px,py,1+(i%3),1+(i%3));}
 x.globalCompositeOperation='source-over';x.fillStyle='#8496a2';x.font='14px Segoe UI';x.fillText('ENERGY ARC  /  SYNTHETIC STUDY',28,h-26);
 }
 const geometry=()=>{const r=$('picture').getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round).join(',');};
 function aligned(label){const a=$('drawingLayer').getBoundingClientRect(),b=EVADrawingModel.imageRect($('picture').getBoundingClientRect(),$('picture').width,$('picture').height);check(! $('drawingLayer').hidden&&Math.max(Math.abs(a.x-b.left),Math.abs(a.y-b.top),Math.abs(a.width-b.width),Math.abs(a.height-b.height))<1.1,label);}
 function pointer(target,type,x,y){target.dispatchEvent(new PointerEvent(type,{pointerId:5,button:2,buttons:type==='pointerup'?0:2,clientX:x,clientY:y,bubbles:true,cancelable:true}));}

 localStorage.setItem('eva-graphite-guide','seen');
 state.source.name='能量弧线 · 观察练习';state.comments.items=[];state.drawings.records=[];state.duration=3;frames.length=90;state.playback.frameCount=90;
 ui=EVAUI.createUI({hostAction:()=>{}});ui.bindSession(session);publish();
 document.head.insertAdjacentHTML('beforeend','<style>*,*::before,*::after{animation:none!important;transition:none!important}.shell-dock{opacity:1!important;pointer-events:auto!important}.shell-guide,.shell-alerts{display:none!important}</style>');
 const arrow={id:'demo-arrow',kind:'arrow',a:{x:.78,y:.18},b:{x:.72,y:.30},color:'#ffd54f',width:.004};
 let last=-1,annotation=false,records=false,drawStarted=false,drawEnded=false,toolChosen=false,recordSelected=-1;
 window.demo={cursor:{x:600,y:500},async render(t){
 const stage=t<8?0:t<15?1:t<23?2:3;
 if(stage!==last){
 if(stage===1)state.playback.transport.loop={valid:true,enabled:true,startTime:.8,endTime:1.8,endBoundary:1.833333,startOrdinal:24,endOrdinal:54};
 if(stage===2){state.playback.transport.loop={valid:false};state.playback.time=1.2;state.playback.frameOrdinal=36;await session.beginDrawing();annotation=true;}
 if(stage===3){state.drawings.draft=null;state.comments.items=[{id:'a',time:1.2,text:'弧线前缘：观察亮部与拖尾的衔接',drawingId:'arc'},{id:'b',time:2.2,text:'拖尾消散：比较粒子的分布'}];state.drawings.records=[{id:'arc',time:1.2,frameOrdinal:36,objects:[arrow]}];publish();q('.shell-dock [aria-label="记录"]').click();records=true;}
 last=stage;
 }
 let media=stage===0?(t<2?t*.55:t<5?1.1+Math.floor((t-2)*3)/30:1.4+.6*Math.sin((t-5)*1.8)):stage===1?.8+(t-8)%1:1.2;
 if(stage===3&&t>27)media=2.2;
 state.playback.time=media;state.playback.frameOrdinal=Math.round(media*30);state.state=stage===1?'playing':'paused';

 if(stage===2&&t>=17){if(!toolChosen){$('drawingToolArrow').click();toolChosen=true;}
 const r=$('drawingLayer').getBoundingClientRect(),p=Math.min(1,Math.max(0,(t-18)/1.1));
 const fire=(type,x,y)=>$('drawingLayer').dispatchEvent(new PointerEvent(type,{pointerId:8,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+r.width*x,clientY:r.top+r.height*y,bubbles:true,cancelable:true}));
 if(t>=18&&!drawStarted){fire('pointerdown',arrow.a.x,arrow.a.y);drawStarted=true;}
 if(drawStarted&&!drawEnded){fire('pointermove',arrow.a.x+(arrow.b.x-arrow.a.x)*p,arrow.a.y+(arrow.b.y-arrow.a.y)*p);if(p===1){fire('pointerup',arrow.b.x,arrow.b.y);drawEnded=true;}}
 if(t>=20){const input=q('.shell-editor textarea'),text='弧线前缘：亮部与拖尾的衔接';input.value=text.slice(0,Math.floor((t-20)*10));input.dispatchEvent(new Event('input'));}
 }

 publish();paint($('picture'),media);
 if(stage===3&&t>=24){const index=t>=27?1:0;if(recordSelected!==index){document.querySelectorAll('.shell-record-card')[index]?.click();recordSelected=index;}}
 const r=$('picture').getBoundingClientRect(),rail=$('timeline').getBoundingClientRect();let cur={x:rail.left+rail.width*media/3,y:rail.top+8};
 if(stage===0&&t<2)cur={x:r.left+r.width*.78,y:r.top+r.height*.73,visible:false};
 if(stage===1)cur={x:rail.left+rail.width*.9,y:rail.top+7};
 if(stage===2){const r=$('drawingLayer').getBoundingClientRect();const p=Math.min(1,Math.max(0,(t-18)/1.1));cur={x:r.left+r.width*(.78-.06*p),y:r.top+r.height*(.18+.12*p),click:t>=18&&t<18.2};if(t>=20){const b=q('.shell-editor textarea').getBoundingClientRect();cur={x:b.left+130,y:b.top+28};}}
 if(stage===3){const card=document.querySelectorAll('.shell-record-card')[t>=27?1:0];if(card){const b=card.getBoundingClientRect();cur={x:b.left+b.width*.55,y:b.top+b.height*.5,click:Math.abs(t-24)<.15||Math.abs(t-27)<.15};}}
 window.demo.cursor=cur;
 await new Promise(resolve=>requestAnimationFrame(resolve));
 }};
})();
