/* Native mouse-event checks with the real UI and an injected Session. */
(async function(){
  'use strict';const el=id=>document.getElementById(id),sleep=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];
  const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const check=(ok,text)=>{if(!ok)throw Error(text);checks.push(text);};
  const state={epoch:1,state:'paused',duration:10,source:{name:'画面手势检查（无真实视频）'},playback:{time:2,frameId:60,frameOrdinal:60,frameCount:300,transport:{rate:1,loop:{valid:false}}},
    comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',records:[],visible:true,styles:EVADrawingModel.defaultStyles(),draft:null}};
  let ui,toggles=0;const seeks=[],rates=[],publish=()=>ui.update({...state,playback:{...state.playback},drawings:{...state.drawings}});
  const session={snapshot:()=>state,setCommentsVisible(){},refreshComments:async()=>{},memorySnapshot:()=>null,
    async seek(time,options){seeks.push({time,...options});state.playback={...state.playback,time,frameId:Math.round(time*30),frameOrdinal:Math.round(time*30)};publish();return{status:'drawn'};},
    async play(){toggles++;state.state='playing';publish();return{status:'playing'};},async pause(){toggles++;state.state='paused';publish();return{status:'paused'};},
    async setPlaybackRate(rate){rates.push(rate);state.playback={...state.playback,transport:{...state.playback.transport,rate}};publish();return{status:'applied'};},
    loopFrameAt(time,b={}){const ordinal=Math.max(b.minOrdinal??0,Math.min(b.maxOrdinal??299,b.ordinal??Math.floor(time*30+1e-9)));return{ordinal,time:ordinal/30};},
    setDrawingObjects(){},setDrawingStyles:()=>({status:'saved'}),cancelDrawing(){state.drawings.draft=null;publish();return true;},
    beginDrawing:async()=>({status:'ignored'}),beginComment:async()=>({status:'ignored'})};
  function pointer(type,x,y,extra={}){const r=el('screen').getBoundingClientRect();const event=new PointerEvent(type,{pointerId:77,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+x,clientY:r.top+y,bubbles:true,cancelable:true,...extra});(type==='pointerdown'?el('picture'):window).dispatchEvent(event);return event;}
  function key(key){window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));}
  try{
    ui=EVAUI.createUI();ui.bindSession(session);publish();const before=el('screen').getBoundingClientRect();
    pointer('pointerdown',200,250);pointer('pointermove',300,250);await settle();
    check(seeks.length===1&&seeks[0].time>2&&!seeks[0].final,'Horizontal screen drag uses the existing nonfinal seek path');
    pointer('pointermove',300,40);await settle();check(rates.length===0,'Horizontal direction remains locked even after large vertical movement');
    pointer('pointerup',320,40);await settle();check(seeks.at(-1).final&&seeks.at(-1).time>seeks[0].time,'Release processes the last pointer position and requests accurate final settlement');
    const width=el('screen').getBoundingClientRect().width,start=state.playback.time;
    pointer('pointerdown',200,250);pointer('pointermove',250,250,{shiftKey:true});await settle();
    check(Math.abs(seeks.at(-1).time-start-Math.trunc(100/8)/30)<.0001,'Shift doubles horizontal sensitivity');
    pointer('pointermove',300,250,{ctrlKey:true});await settle();
    check(Math.abs(seeks.at(-1).time-start-Math.trunc(125/8)/30)<.0001,'Ctrl halves the next movement without jumping the previous target');
    pointer('pointerup',300,250);await sleep(10);
    const previousSeeks=seeks.length,rateBefore=state.playback.transport.rate;
    pointer('pointerdown',400,300);pointer('pointermove',400,270);await settle();
    check(rates.at(-1)===Number((rateBefore+.1).toFixed(3))&&el('screenRateHint').textContent.includes('×'),'Upward flick adjusts one step and shows the quiet speed hint');
    await sleep(150);pointer('pointermove',400,200);await settle();check(rates.at(-1)>rateBefore+.1,'Continued upward movement adjusts further steps');
    const stopped=rates.length;await sleep(160);check(rates.length===stopped,'Holding still never runs a repeating speed-change timer');
    pointer('pointermove',650,200);await settle();check(seeks.length===previousSeeks,'Vertical gesture cannot accidentally become a horizontal seek');
    pointer('pointerup',650,200);
    const previousRate=state.playback.transport.rate;pointer('pointerdown',400,200);pointer('pointermove',400,220,{ctrlKey:true});await settle();
    check(rates.at(-1)===Number((previousRate-.05).toFixed(3)),'Ctrl halves the configured speed step');pointer('pointerup',400,220);
    const heldSeeks=seeks.length,heldRates=rates.length;
    pointer('pointerdown',400,220);await sleep(460);
    check(el('screenGestureRing').getAttribute('data-open')==='true'&&el('screenGestureRing').getAttribute('data-held')==='true','Intentional stationary hold reveals the existing four-direction progress/speed wheel');
    check(seeks.length===heldSeeks&&rates.length===heldRates,'Opening the direction wheel does not execute any extra command');
    key('Escape');await sleep(10);check(el('screenGestureRing').getAttribute('data-open')==='false','Esc closes the direction wheel');
    pointer('pointerdown',400,220);pointer('pointercancel',400,220,{pointerId:78});pointer('pointermove',450,220);await settle();
    check(seeks.length>heldSeeks,'Cancellation from a different pointer cannot end the active drag');
    window.dispatchEvent(new Event('blur'));await sleep(10);check(seeks.at(-1).final&&el('screenGestureRing').getAttribute('data-open')==='false','Window blur settles the current drag and releases its feedback');
    state.drawings.draft={id:1,status:'editing',objects:[],original:'[]',dirty:false};publish();
    const blockedSeeks=seeks.length,blockedRates=rates.length;pointer('pointerdown',400,220);pointer('pointermove',500,140);pointer('pointerup',500,140);await settle();
    check(seeks.length===blockedSeeks&&rates.length===blockedRates,'Drawing edit state has priority over every screen gesture');
    state.drawings.draft=null;publish();
    pointer('pointerdown',400,220);await sleep(460);state.epoch++;publish();check(el('screenGestureRing').getAttribute('data-open')==='false','Changing the source epoch discards pending gesture state');
    check(before.width===el('screen').getBoundingClientRect().width&&before.height===el('screen').getBoundingClientRect().height,'Direction wheel and speed hints never resize the video area');
    const countToggles=()=>toggles;
    const toggleBefore=countToggles();pointer('pointerdown',500,260);pointer('pointerup',500,260);await settle();
    check(countToggles()===toggleBefore+1&&state.state==='playing','A plain left click starts playback exactly once');
    pointer('pointerdown',500,260);pointer('pointerup',500,260);await settle();
    check(countToggles()===toggleBefore+2&&state.state==='paused','A second plain click pauses playback exactly once');
    state.state='seeking';state.playback.buffering=true;publish();check(!el('play').disabled&&el('play').textContent==='暂停','The play control stays available to pause pending automatic buffer recovery');pointer('pointerdown',500,260);pointer('pointerup',500,260);await settle();check(state.state==='paused','A screen click can cancel waiting playback');state.playback.buffering=false;publish();
    pointer('pointerdown',500,260);await sleep(460);pointer('pointerup',500,260);await settle();
    check(countToggles()===toggleBefore+3,'Holding for the wheel and releasing never toggles playback');
    pointer('pointerdown',500,260);pointer('pointermove',540,260);pointer('pointerup',540,260);await settle();
    check(countToggles()===toggleBefore+3,'Seeking with a drag never toggles playback on release');
    key('c');await settle();check(el('screenRateHint').getAttribute('data-placement')==='keyboard','Keyboard speed commands show their separate upper-left feedback');
    pointer('pointerdown',400,300);pointer('pointermove',400,280);await settle();
    check(el('screenRateHint').getAttribute('data-placement')==='up','An upward flick displays the rate above its direction hint');
    await sleep(160);pointer('pointermove',400,210);await settle();
    check(el('screenRateHint').getAttribute('data-placement')==='center','Continued adjustment moves rate feedback into the wheel center');pointer('pointerup',400,210);
    pointer('pointerdown',400,210);pointer('pointermove',400,230);await settle();
    check(el('screenRateHint').getAttribute('data-placement')==='down','A downward flick displays the rate below its direction hint');pointer('pointerup',400,230);
    pointer('pointerdown',400,220);await sleep(460);pointer('pointermove',400,200);await settle();
    check(el('screenRateHint').getAttribute('data-placement')==='center','Rate changes after a stationary hold appear in the wheel center');pointer('pointerup',400,200);

    // Each seek publishes through the actual UI. A stale speed-hint epoch used
    // to cancel the new gesture on its first seek, until another speed change.
    for(const kind of ['keyboard','vertical'])for(const expired of [false,true]){
      if(kind==='keyboard')key('c');else{pointer('pointerdown',400,300);pointer('pointermove',400,280);await settle();pointer('pointerup',400,280);}
      await settle();if(expired)await sleep(850);
      state.epoch++;state.state='paused';state.playback={...state.playback,time:5};publish();
      check(el('screenRateHint').getAttribute('data-open')==='false',kind+' speed feedback is retired on source switch (expired='+expired+')');
      const baseline=seeks.length,rateCount=rates.length,w=el('screen').getBoundingClientRect().width;
      pointer('pointerdown',300,260);pointer('pointermove',340,260);await settle();
      pointer('pointermove',420,260);await settle();
      check(seeks.length===baseline+2&&Math.abs(state.playback.time-5-Math.trunc(120/8)/30)<.0001,kind+' hint cannot interrupt successive seek/UI refreshes after switching (expired='+expired+')');
      pointer('pointermove',320,260);await settle();
      check(Math.abs(state.playback.time-5-Math.trunc(20/8)/30)<.0001,'Reverse movement continues in the same new-video drag ('+kind+', expired='+expired+')');
      pointer('pointerup',360,260);await settle();
      check(seeks.at(-1).final&&Math.abs(state.playback.time-5-Math.trunc(60/8)/30)<.0001&&rates.length===rateCount,'Release settles the latest position without a speed-change workaround ('+kind+', expired='+expired+')');
    }
    for(let source=0;source<3;source++){
      state.epoch++;state.playback={...state.playback,time:5};publish();const baseline=seeks.length;
      pointer('pointerdown',300,260);pointer('pointermove',330,260);await settle();pointer('pointermove',390,260);await settle();pointer('pointerup',410,260);await settle();
      check(seeks.length===baseline+3&&seeks.at(-1).final,'Repeated source switch '+(source+1)+' needs no rate adjustment to restore dragging');
    }

    ui.destroy();const destroyedCount=seeks.length+rates.length;pointer('pointerdown',400,220);pointer('pointermove',500,140);pointer('pointerup',500,140);await settle();
    check(destroyedCount===seeks.length+rates.length,'Destroy removes gesture listeners and timers');
    ui=EVAUI.createUI();ui.bindSession(session);publish();pointer('pointerdown',400,220);await sleep(460);pointer('pointermove',400,200);await settle();await sleep(160);
    const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed:true,checks});document.body.appendChild(out);
  }catch(error){ui?.destroy();const out=document.createElement('pre');out.id='drawing-results';out.hidden=true;out.textContent=JSON.stringify({passed:false,checks,seeks,rates,time:state.playback.time,width:el('screen').getBoundingClientRect().width,error:error.stack});document.body.appendChild(out);}
})();
