/* Right-button commands and transient menu hierarchy. No SDK, files or transport. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(typeof window==='object')window.EVAContextWheel=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function wheelIndex(dx,dy,count){if(!count||Math.hypot(dx,dy)<24)return null;return(Math.round((Math.atan2(dy,dx)+Math.PI/2)/(Math.PI*2/count))+count)%count;}
  function createContextWheel({document:doc,window:win,screen,getContext,command,opening=()=>{},now=()=>win.performance.now()}){
    const inert={update(){},reset(){},destroy(){},active:()=>false};if(!doc.createElement||!screen.appendChild)return inert;
    const listeners=[],ringListeners=[],panelListeners=[];
    const on=(n,t,f,o)=>{n.addEventListener(t,f,o);listeners.push([n,t,f,o]);};
    const dynamic=(list,n,t,f)=>{n.addEventListener(t,f);list.push([n,t,f]);};
    const remove=list=>{for(const[n,t,f]of list)n.removeEventListener(t,f);list.length=0;};
    const make=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
    const menu=make('div','context-wheel'),ring=make('div','context-wheel-ring'),center=make('button','context-wheel-center','·'),panel=make('div','context-wheel-panel');
    menu.id='contextWheel';menu.hidden=true;menu.inert=true;menu.setAttribute('data-open','false');menu.setAttribute('aria-hidden','true');menu.setAttribute('role','group');menu.setAttribute('aria-label','右键菜单');center.type='button';center.setAttribute('aria-label','取消菜单');
    menu.appendChild(ring);menu.appendChild(center);menu.appendChild(panel);screen.appendChild(menu);
    let press=null,timer=null,opened=null,items=[],buttons=[],childStart=null,destroyed=false,ignoreContextUntil=0;
    const later=(fn,ms)=>(win.setTimeout||setTimeout).call(win,fn,ms),clear=id=>(win.clearTimeout||clearTimeout).call(win,id);
    const input=e=>e.target?.closest?.('input,textarea,select,a,[contenteditable]');
    function stopTimer(){if(timer!==null)clear(timer);timer=null;}
    function finishClosing(){if(!menu.hidden)return;menu.setAttribute('data-closing','false');panel.hidden=true;}
    function reset(){const old=press,visible=!menu.hidden;press=null;stopTimer();menu.hidden=true;menu.inert=true;menu.setAttribute('aria-hidden','true');menu.setAttribute('data-open','false');if(visible)menu.setAttribute('data-closing','true');opened=null;childStart=null;if(!visible)panel.hidden=true;remove(ringListeners);remove(panelListeners);if(old)try{if(screen.hasPointerCapture?.(old.id))screen.releasePointerCapture(old.id);}catch(_){} }
    on(menu,'animationend',e=>{if(e.target===menu&&e.animationName==='wheel-out')finishClosing();});
    function position(x,y,size){const r=screen.getBoundingClientRect(),w=r.width||400,h=r.height||400,edge=size/2+6;menu.style.width=menu.style.height=size+'px';menu.style.left=Math.max(Math.min(edge,w/2),Math.min(w-edge,x-r.left))+'px';menu.style.top=Math.max(Math.min(edge,h/2),Math.min(h-edge,y-(r.top||0)))+'px';center.style.left=center.style.top=size/2+'px';}
    function menuCenter(){const r=screen.getBoundingClientRect();return{x:r.left+parseFloat(menu.style.left),y:(r.top||0)+parseFloat(menu.style.top)};}
    function choose(index){for(let i=0;i<buttons.length;i++)buttons[i].setAttribute('data-active',String(i===index));}
    function direction(e,p=press){if(!p||!items.length)return null;const origin=childStart||p;if(Math.hypot(e.clientX-origin.x,e.clientY-origin.y)<8)return null;const at=p.held||childStart?menuCenter():origin;return wheelIndex(e.clientX-at.x,e.clientY-at.y,items.length);}
    function show(values,at,secondary=false){const ctx=getContext();if(!ctx.enabled)return reset();if(!values.length)return;
      remove(ringListeners);remove(panelListeners);opened={epoch:ctx.epoch,mode:ctx.mode};items=values;ring.replaceChildren();buttons=[];panel.hidden=true;
      const size=secondary?132:120;position(at.x,at.y,size);menu.setAttribute('data-mode',ctx.mode);menu.setAttribute('data-level',secondary?'types':'root');menu.setAttribute('aria-label',secondary?'选择圈画类型':'右键菜单');
      items.forEach((item,i)=>{const b=make('button','context-wheel-item');b.type='button';b.disabled=!!item.disabled;b.setAttribute('data-wheel-command',item.id);b.setAttribute('aria-label',item.label);b.setAttribute('aria-pressed',String(!!item.selected));
        const angle=i*Math.PI*2/items.length-Math.PI/2,radius=secondary?45:40;b.style.left=size/2+Math.cos(angle)*radius+'px';b.style.top=size/2+Math.sin(angle)*radius+'px';
        const symbol=make('span','context-wheel-symbol',(item.symbol||'')+'\ufe0e');if(item.id==='pen'||item.id==='drawing')symbol.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 17-1 4 4-1L20 8l-3-3L5 17Zm10-10 3 3M4 21h6"/></svg>';
        b.appendChild(symbol);b.appendChild(make('span','context-wheel-label',item.label));dynamic(ringListeners,b,'click',e=>execute(item,e));ring.appendChild(b);buttons.push(b);
      });menu.setAttribute('data-closing','false');menu.setAttribute('data-open','true');menu.setAttribute('aria-hidden','false');menu.inert=false;menu.hidden=false;choose(null);
    }
    function showChildren(item,e){if(item.disabled||!item.children?.length)return;const at={x:e.clientX,y:e.clientY};childStart=at;show(item.children,at,true);choose(null);}
    function showPanel(){const ctx=getContext();remove(panelListeners);panel.replaceChildren();panel.hidden=false;panel.setAttribute('data-panel','color');
      for(const value of ['#ffd54f','#ff5252','#69d785','#65b6ff','#ffffff','#222222']){const b=make('button','context-wheel-swatch');b.type='button';b.setAttribute('aria-label','设置颜色 '+value);b.setAttribute('data-wheel-command','color');b.style.backgroundColor=value;dynamic(panelListeners,b,'click',()=>{reset();command('color',value);});panel.appendChild(b);}
      const label=make('label','context-wheel-custom','自定义'),picker=make('input','');picker.type='color';picker.value=ctx.color||'#ffd54f';picker.setAttribute('aria-label','自定义圈画颜色');dynamic(panelListeners,picker,'input',()=>command('color',picker.value));label.appendChild(picker);panel.appendChild(label);
    }
    function execute(item,e){if(!item||item.disabled)return reset();if(item.children){showChildren(item,e||{clientX:menuCenter().x,clientY:menuCenter().y});return;}if(item.id==='color'){showPanel();return;}reset();command(item.id,item.value);}
    on(center,'click',reset);
    on(screen,'contextmenu',e=>{if(!input(e)&&(press||getContext().enabled||now()<ignoreContextUntil))e.preventDefault();});
    on(screen,'pointerdown',e=>{if(destroyed||e.defaultPrevented||e.button!==2||input(e)||e.target?.closest?.('button,.context-wheel'))return;const ctx=getContext();if(!ctx.enabled)return;
      const cancelOnly=!menu.hidden;e.preventDefault();reset();opening();ignoreContextUntil=now()+1200;screen.tabIndex=-1;screen.focus?.({preventScroll:true});
      press={id:e.pointerId,x:e.clientX,y:e.clientY,epoch:ctx.epoch,mode:ctx.mode,moved:false,cancelOnly};items=ctx.items||[];position(e.clientX,e.clientY,120);try{screen.setPointerCapture?.(e.pointerId);}catch(_){}
      timer=later(()=>{timer=null;if(press){press.held=true;if(!press.cancelOnly)show(items,press);}},420);
    });
    on(win,'pointermove',e=>{if(!press||e.pointerId!==press.id)return;const ctx=getContext();if(!ctx.enabled||ctx.epoch!==press.epoch||ctx.mode!==press.mode)return reset();if(e.buttons!==undefined&&!(e.buttons&2))return reset();
      press.moved ||= Math.hypot(e.clientX-press.x,e.clientY-press.y)>=8;e.preventDefault();if(press.cancelOnly)return;const index=direction(e);if(index!==null){stopTimer();if(menu.hidden)show(items,press);}choose(index);if(!childStart&&index!==null&&items[index]?.children&&!items[index].disabled)showChildren(items[index],e);
    });
    on(win,'pointerup',e=>{if(!press||e.pointerId!==press.id||e.button!==2)return;ignoreContextUntil=now()+800;e.preventDefault();
      const old=press,ctx=getContext(),index=direction(e,old),tap=!old.held&&!old.moved&&Math.hypot(e.clientX-old.x,e.clientY-old.y)<8;press=null;stopTimer();try{if(screen.hasPointerCapture?.(old.id))screen.releasePointerCapture(old.id);}catch(_){}
      if(!ctx.enabled||ctx.epoch!==old.epoch||ctx.mode!==old.mode||old.cancelOnly)return reset();if(tap){reset();if(ctx.tap)command(ctx.tap);return;}if(index===null)return reset();const item=items[index];if(menu.hidden)show(items,old);execute(item,e);
    });
    on(win,'pointercancel',e=>{if(press?.id===e.pointerId)reset();});on(win,'lostpointercapture',e=>{if(press?.id===e.pointerId)reset();});on(win,'blur',reset);
    on(win,'keydown',e=>{if((press||!menu.hidden)&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation?.();reset();}},true);
    on(win,'pointerdown',e=>{if(!menu.hidden&&e.button===0&&!e.target?.closest?.('.context-wheel')){e.preventDefault();e.stopImmediatePropagation?.();reset();}},true);
    return{active:()=>!!press||!menu.hidden,reset,update(){const ctx=getContext();if((press||opened)&&(!ctx.enabled||ctx.epoch!==(press||opened).epoch||ctx.mode!==(press||opened).mode))reset();},destroy(){destroyed=true;reset();listeners.forEach(([n,t,f,o])=>n.removeEventListener(t,f,o));menu.remove?.();}};
  }
  return{createContextWheel,wheelIndex};
});
