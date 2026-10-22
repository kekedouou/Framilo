/* Bounded real DOM/Canvas/JPEG measurements; in-memory source, no Eagle/media. */
(async function(){
 'use strict';
 const el=id=>document.getElementById(id),checks=[],metrics={},sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(ok,text)=>{if(!ok)throw Error(text);checks.push(text);},settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return{count:values.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],maxMs:sorted.at(-1),totalMs:values.reduce((a,b)=>a+b,0),samplesMs:values};};
 let ui,player,rects=0,rebuilds=0,bitmaps=0,liveRaf=new Set(),peakBitmaps=0;
 const state={epoch:1,state:'paused',duration:2,source:{name:'E18 synthetic same-frame benchmark'},memorySettings:{ramMiB:512,ramBytes:536870912},interactionSettings:{wheelFrames:1,rateStep:.1,drawingFadeSeconds:.25,showCacheStrip:true,drawingToolbar:false},
  preview:{quality:'720p',sourceWidth:1280,sourceHeight:720,width:1280,height:720},previewQuality:'720p',playback:{time:0,frameOrdinal:0,frameId:0,frameCount:60,transport:{rate:1,loop:{valid:false}}},comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',visible:true,records:[],styles:EVADrawingModel.defaultStyles(),draft:null}};
 const publish=()=>ui.update({...state,playback:{...state.playback},drawings:{...state.drawings}});
 const session={setCommentsVisible(){},refreshComments:async()=>{},memorySnapshot:()=>null,pause:async()=>{},seek:async(time,o)=>{state.playback={...state.playback,time,frameOrdinal:Math.round(time*30)};publish();return{status:'drawn'};},setDrawingObjects(){},setDrawingStyles(){},cancelDrawing(){state.drawings.draft=null;publish();}};
 const output=passed=>{const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed,checks,metrics});document.body.appendChild(out);};
 try{
  const screen=el('screen'),bounds=screen.getBoundingClientRect.bind(screen);screen.getBoundingClientRect=()=>{rects++;return bounds();};
  const layer=el('drawingLayer'),replace=layer.replaceChildren.bind(layer);layer.replaceChildren=(...nodes)=>{rebuilds++;return replace(...nodes);};
  ui=EVAUI.createUI();ui.bindSession(session);publish();await settle();
  function batch(label,count){const times=[],before=rects,nodes=rebuilds;for(let i=0;i<count+40;i++){state.playback.time=(i%60)/30;const at=performance.now();publish();if(i>=40)times.push(performance.now()-at);}metrics[label]={...stats(times),screenRectReads:rects-before,svgRebuilds:rebuilds-nodes};}
  batch('watchUpdates',400);
  const objects=Array.from({length:24},(_,i)=>({id:'rect-'+i,kind:'rect',a:{x:.02+i*.02,y:.1},b:{x:.25+i*.02,y:.7},width:.004,color:'#ffffff'}));
  state.drawings.draft={id:1,status:'editing',kind:'edit',objects,dirty:false};publish();await settle();batch('unchangedDrawingUpdates',160);
  state.drawings.draft=null;publish();await settle();
  const start=rects;function pointer(type,x){const r=bounds();(type==='pointerdown'?el('picture'):window).dispatchEvent(new PointerEvent(type,{pointerId:91,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+x,clientY:r.top+100,bubbles:true,cancelable:true}));}
  pointer('pointerdown',200);for(let i=0;i<36;i++){pointer('pointermove',201+i*2);await new Promise(r=>requestAnimationFrame(r));}pointer('pointerup',275);await settle();metrics.drag={moves:36,screenRectReads:rects-start};
  ui.destroy();ui=null;
  const picture=el('picture'),ctx=picture.getContext('2d');picture.width=1280;picture.height=720;ctx.fillStyle='#343b45';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#d6ae65';ctx.fillRect(90,90,360,360);
  const blob=await new Promise(r=>picture.toBlob(r,'image/jpeg',.85)),jpeg=new Uint8Array(await blob.arrayBuffer());
  const index=EVAFrameIndex.buildIndex(Array.from({length:8},(_,i)=>({id:i,ptsTicks:String(i),file:'f'+i+'.jpg',bytes:jpeg.length})),{timeBase:[1,30],lastFrameEndTicks:'8'});
  const info={cacheDir:'e18-memory',source:{key:'e18-synthetic'},width:1280,height:720,duration:index.videoDuration,frames:index.frames,audio:null};
  player=new EVAPlayer.Player({canvas:picture,frameIndex:EVAFrameIndex,ramBytes:536870912,experimentMode:'compressed-ram',forwardPredecode:false,readAsset:async()=>jpeg,
   env:{raf(fn){let id=requestAnimationFrame(()=>{liveRaf.delete(id);fn();});liveRaf.add(id);return id;},caf(id){liveRaf.delete(id);cancelAnimationFrame(id);},async decodeImage(bytes){const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));bitmaps++;peakBitmaps=Math.max(peakBitmaps,bitmaps);return{width:bitmap.width,height:bitmap.height,close(){bitmaps--;bitmap.close();},bitmap};}}});
  // Canvas receives a native ImageBitmap, while the wrapper counts ownership.
  const draw=player.ctx.drawImage.bind(player.ctx);player.ctx.drawImage=(bitmap,...rest)=>draw(bitmap.bitmap||bitmap,...rest);
  // Align the first input with a frame boundary; otherwise the cold sample can
  // gain/lose one whole refresh interval depending on earlier DOM work.
  await settle();
  const first=[];for(let source=0;source<8;source++){const at=performance.now();await player.load({...info,source:{key:'e18-'+source}});first.push(performance.now()-at);check(player.snapshot().frameOrdinal===0,'Source '+source+' opens on its first frame');}
  for(let i=0;i<8;i++)await player.seek(i/30,{index:i,final:true});
  const seeks=[];for(let i=0;i<48;i++){const n=(i*5+1)%8,at=performance.now();await player.seek(n/30,{index:n,final:true});seeks.push(performance.now()-at);check(player.snapshot().frameOrdinal===n,'Accurate measured seek '+i+' displays its requested ordinal');}
  metrics.player={input:'one locally encoded 1280x720 JPEG repeated across an eight-frame PTS index; no disk/audio',ramBytes:536870912,firstFrame:stats(first),warmSeek:stats(seeks),peakBitmaps,managedPeakBytes:player.snapshot().cachePeakBytes};
  const switched=await Promise.all(Array.from({length:24},(_,n)=>player.load({...info,source:{key:'e18-race-'+n}})));
  check(switched.slice(0,-1).every(n=>n.status==='superseded')&&switched.at(-1).status==='drawn'&&player.info.source.key==='e18-race-23','Twenty-four competing source loads leave only the latest source drawable');
  await player.dispose();check(player.snapshot().cacheBytes===0&&bitmaps===0&&liveRaf.size===0,'Player releases all measured RAM reservations, ImageBitmaps and RAF callbacks');player=null;
  metrics.scope='UI cost and Canvas submission, not physical presentation/Eagle/video decode/audio/long-term stability';output(true);
 }catch(error){metrics.error=error.stack;ui?.destroy();if(player)await player.dispose();output(false);}
})();
