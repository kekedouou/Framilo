/* Screen input and quiet direction feedback; calls existing transport only. */
(function(root,factory){const api=factory(typeof window==='object'?window.EVAScreenGestures:require('./screen-gestures.js'));if(typeof module==='object'&&module.exports)module.exports=api;if(typeof window==='object')window.EVAScreenGestureUI=api;})(typeof globalThis==='object'?globalThis:this,function(model){
  'use strict';
  function createScreenGestureUI({document:doc,window:win,getContext,seek,rate,toggle=()=>{},start=()=>{},release:released=()=>{},now=()=>win.performance.now()}){
    const screen=doc.getElementById('screen'),ring=doc.getElementById('screenGestureRing'),toast=doc.getElementById('screenRateHint'),machine=model.createGesture();
    if(!screen||!ring||!toast)throw Error('画面手势提示元素缺失。');
    const listeners=[],on=(n,t,f,o)=>{n.addEventListener(t,f,o);listeners.push([n,t,f,o]);};
    const later=(fn,ms)=>(win.setTimeout||setTimeout).call(win,fn,ms),clear=id=>(win.clearTimeout||clearTimeout).call(win,id);
    let holdTimer=null,hideTimer=null,frame=null,queued=null,epoch=null,destroyed=false,origin=null,hintEpoch=null;
    const event=e=>({id:e.pointerId,x:e.clientX,y:e.clientY,at:now(),button:e.button,shiftKey:!!e.shiftKey,ctrlKey:!!e.ctrlKey});
    function cancelTimer(){if(holdTimer!==null)clear(holdTimer);holdTimer=null;}
    function flush(final=false){
      if(frame!==null){(win.cancelAnimationFrame||clearTimeout).call(win,frame);frame=null;}
      const item=queued;queued=null;if(item)seek(item.time,final,item.ordinal);
    }
    function release(old=machine.snapshot()){machine.cancel();cancelTimer();queued=null;
      if(frame!==null){(win.cancelAnimationFrame||clearTimeout).call(win,frame);frame=null;}
      ring.setAttribute('data-open','false');ring.setAttribute('aria-hidden','true');
      if(old)try{if(screen.hasPointerCapture?.(old.id))screen.releasePointerCapture(old.id);}catch(_){}
      origin=null;
      released();
    }
    function show(direction){
      const value=machine.snapshot();if(!value||!origin)return;
      const r=screen.getBoundingClientRect();
      ring.style.left=Math.max(58,Math.min(Math.max(58,r.width-58),origin.x-r.left))+'px';
      ring.style.top=Math.max(58,Math.min(Math.max(58,r.height-58),origin.y-r.top))+'px';
      ring.setAttribute('data-open','true');ring.setAttribute('aria-hidden','false');
      ring.setAttribute('data-direction',direction||'');ring.setAttribute('data-held',String(value.held));
      ring.setAttribute('data-selection',String(value.horizontalOnly));
    }
    function hideHint(){
      if(hideTimer!==null)clear(hideTimer);
      hideTimer=null;hintEpoch=null;toast.setAttribute('data-open','false');
    }
    function hint(value,placement='keyboard') {
      hintEpoch=getContext().epoch;toast.textContent=Number(value.toFixed(3))+'×';toast.setAttribute('data-placement',placement);
      if(placement==='keyboard'){toast.style.left='18px';toast.style.top='16px';}
      else if(origin){const r=screen.getBoundingClientRect(),offset=placement==='up'?-82:placement==='down'?82:0;
        toast.style.left=Math.max(45,Math.min(r.width-45,(parseFloat(ring.style.left)||origin.x-r.left)))+'px';
        toast.style.top=Math.max(24,Math.min(r.height-24,(parseFloat(ring.style.top)||origin.y-r.top)+offset))+'px';}
      toast.setAttribute('data-open','true');if(hideTimer!==null)clear(hideTimer);
      hideTimer=later(hideHint,800);
    }
    function apply(action){
      if(!action)return;
      show(action.direction);
      if(action.kind==='seek'){
        queued=action;
        if(frame===null)frame=(win.requestAnimationFrame||((fn)=>later(fn,16))).call(win,()=>{frame=null;const pending=queued;queued=null;if(pending)seek(pending.time,false,pending.ordinal);});
      }else if(action.kind==='rate'){
        if(getContext().canRate===false)return;
        const v=machine.snapshot();rate(action.rate);
        if(v&&getContext().enabled&&epoch===getContext().epoch)hint(action.rate,v.held||v.sustained?'center':action.direction);
      }
    }
    on(screen,'pointerdown',e=>{
      const context=getContext();
      if(destroyed||!context.enabled||!context.canStart||e.button!==0||e.altKey||e.metaKey||e.target?.closest?.('button,input,textarea,select,a,[contenteditable],.drawing-panel'))return;
      // A new down proves the old same mouse press has ended even if its up
      // was swallowed by the OS without a blur/cancel notification.
      if(machine.snapshot()?.id===e.pointerId)release();
      if(!machine.down(event(e),context))return;
      start();
      hideHint();
      e.preventDefault();screen.tabIndex=-1;screen.focus?.({preventScroll:true});epoch=context.epoch;origin={x:e.clientX,y:e.clientY};
      try{screen.setPointerCapture?.(e.pointerId);}catch(_){}
      holdTimer=later(()=>{holdTimer=null;if(machine.hold())show();},420);
    });
    on(win,'pointermove',e=>{
      const current=machine.snapshot();if(!current||current.id!==e.pointerId)return;
      if(!getContext().enabled||epoch!==getContext().epoch)return release();
      if(e.buttons!==undefined&&!(e.buttons&1)){const action=machine.end(e.pointerId);if(action?.kind==='seek'){queued=action;flush(true);}release(current);return;}
      e.preventDefault();const action=machine.move(event(e));if(action){cancelTimer();apply(action);}
    });
    function end(e){
      const current=machine.snapshot();if(!current||e&&e.pointerId!==current.id)return;
      const context=getContext();
      if(e?.type==='pointerup'&&context.enabled&&context.epoch===epoch)apply(machine.move(event(e)));
      const action=machine.end(current.id);
      if(action&&context.enabled&&context.epoch===epoch){
        if(action.kind==='seek'){queued=action;flush(true);}
        else if(action.kind==='toggle'&&e?.type==='pointerup'&&e.button===0&&context.canStart)toggle();
      }
      release(current);
    }
    on(win,'pointerup',end);
    on(win,'pointercancel',e=>{if(machine.snapshot()?.id===e.pointerId)end();});
    on(win,'blur',()=>end());
    on(win,'keydown',e=>{if(machine.snapshot()&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation?.();end();}},true);
    on(screen,'wheel',e=>{if(machine.snapshot())e.preventDefault();},{capture:true,passive:false});
    function reset(){release();hideHint();}
    return {hint,finish:()=>end(),active:()=>!!machine.snapshot(),update(){if(machine.snapshot()&&(!getContext().enabled||getContext().epoch!==epoch||machine.snapshot().horizontalOnly!==!!getContext().horizontalOnly)||hintEpoch!==null&&getContext().epoch!==hintEpoch)reset();},
      reset,destroy(){destroyed=true;release();hideHint();listeners.forEach(([n,t,f,o])=>n.removeEventListener(t,f,o));}};
  }
  return {createScreenGestureUI};
});
