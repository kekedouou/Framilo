/* Right-button commands only. No transport, media, files or Eagle access. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(typeof window==='object')window.EVAContextWheel=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  function wheelIndex(dx,dy,count){
    if(Math.hypot(dx,dy)<24)return null;
    return (Math.round((Math.atan2(dy,dx)+Math.PI/2)/(Math.PI*2/count))+count)%count;
  }
  function createContextWheel({document:doc,window:win,screen,getContext,command,opening=()=>{},now=()=>win.performance.now()}){
    const inert={update(){},reset(){},destroy(){},active:()=>false};
    if(!doc.createElement||!screen.appendChild)return inert;
    const listeners=[],on=(n,t,f,o)=>{n.addEventListener(t,f,o);listeners.push([n,t,f,o]);};
    const ringListeners=[],panelListeners=[];
    const dynamic=(group,n,t,f)=>{n.addEventListener(t,f);group.push([n,t,f]);};
    const remove=group=>{for(const[n,t,f]of group)n.removeEventListener(t,f);group.length=0;};
    const make=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
    const menu=make('div','context-wheel'),ring=make('div','context-wheel-ring'),center=make('button','context-wheel-center','取消'),panel=make('div','context-wheel-panel');
    menu.id='contextWheel';menu.hidden=true;menu.setAttribute('role','group');menu.setAttribute('aria-label','右键菜单');center.type='button';
    menu.appendChild(ring);menu.appendChild(center);menu.appendChild(panel);screen.appendChild(menu);
    let press=null,timer=null,opened=null,items=[],buttons=[],selected=null,destroyed=false,ignoreContextUntil=0;
    const later=(fn,ms)=>(win.setTimeout||setTimeout).call(win,fn,ms),clear=id=>(win.clearTimeout||clearTimeout).call(win,id);
    const input=e=>e.target?.closest?.('input,textarea,select,a,[contenteditable]');
    function stopTimer(){if(timer!==null)clear(timer);timer=null;}
    function reset(){const old=press;press=null;stopTimer();menu.hidden=true;opened=null;selected=null;panel.hidden=true;remove(ringListeners);remove(panelListeners);
      if(old)try{if(screen.hasPointerCapture?.(old.id))screen.releasePointerCapture(old.id);}catch(_){}
    }
    function position(x,y){const r=screen.getBoundingClientRect(),w=r.width||400,h=r.height||400;
      menu.style.left=Math.max(Math.min(116,w/2),Math.min(w-116,x-r.left))+'px';
      menu.style.top=Math.max(Math.min(116,h/2),Math.min(h-116,y-(r.top||0)))+'px';
      menu.style.setProperty?.('--panel-side',parseFloat(menu.style.left)>w/2?'-1':'1');
    }
    function choose(index){selected=index;for(let i=0;i<buttons.length;i++)buttons[i].setAttribute('data-active',String(i===index));
      center.textContent=index===null?'取消':items[index].label;
    }
    function direction(e,p=press){
      if(!p||Math.hypot(e.clientX-p.x,e.clientY-p.y)<8)return null;
      if(p.held){const r=screen.getBoundingClientRect();return wheelIndex(e.clientX-r.left-parseFloat(menu.style.left),e.clientY-(r.top||0)-parseFloat(menu.style.top),items.length);}
      return wheelIndex(e.clientX-p.x,e.clientY-p.y,items.length);
    }
    function show(){const ctx=getContext();if(!ctx.enabled)return reset();
      remove(ringListeners);remove(panelListeners);
      opened={epoch:ctx.epoch,mode:ctx.mode};items=ctx.items;ring.replaceChildren();buttons=[];panel.hidden=true;
      menu.setAttribute('data-mode',ctx.mode);menu.setAttribute('aria-label',ctx.mode==='drawing'?'圈画右键菜单':'观看右键菜单');
      items.forEach((item,i)=>{const b=make('button','context-wheel-item');b.type='button';b.disabled=!!item.disabled;
        b.setAttribute('data-wheel-command',item.id);b.setAttribute('aria-label',item.label);b.setAttribute('aria-pressed',String(!!item.selected));
        const angle=i*Math.PI*2/items.length-Math.PI/2;
        b.style.left=108+Math.cos(angle)*75+'px';b.style.top=108+Math.sin(angle)*75+'px';
        const symbol=make('span','context-wheel-symbol',(item.symbol||'')+'\ufe0e');
        if(item.id==='pen'||item.id==='drawing')symbol.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 17-1 4 4-1L20 8l-3-3L5 17Zm10-10 3 3M4 21h6"/></svg>';
        b.appendChild(symbol);b.appendChild(make('span','context-wheel-label',item.label));
        dynamic(ringListeners,b,'click',()=>execute(item));ring.appendChild(b);buttons.push(b);
      });menu.hidden=false;choose(selected);
    }
    function showPanel(kind){const ctx=getContext();remove(panelListeners);panel.replaceChildren();panel.hidden=false;panel.setAttribute('data-panel',kind);
      const values=kind==='color'?['#ffd54f','#ff5252','#69d785','#65b6ff','#ffffff','#222222'].map(value=>({id:'color',value,label:value})) : ctx.actions||[];
      for(const value of values){const b=make('button',kind==='color'?'context-wheel-swatch':'',kind==='color'?'':value.label);b.type='button';b.disabled=!!value.disabled;
        b.setAttribute('aria-label',kind==='color'?'设置颜色 '+value.value:value.label);b.setAttribute('data-wheel-command',value.id);
        if(value.value)b.style.backgroundColor=value.value;dynamic(panelListeners,b,'click',()=>{if(!b.disabled){reset();command(value.id,value.value);}});panel.appendChild(b);
      }
      if(kind==='color'){const label=make('label','context-wheel-custom','自定义颜色'),picker=make('input','');picker.type='color';picker.value=ctx.color||'#ffd54f';picker.setAttribute('aria-label','自定义圈画颜色');
        dynamic(panelListeners,picker,'input',()=>command('color',picker.value));label.appendChild(picker);panel.appendChild(label);
      }
    }
    function execute(item){if(!item||item.disabled)return reset();
      if(item.id==='color'||item.id==='actions'){showPanel(item.id);return;}
      reset();command(item.id,item.value);
    }
    on(center,'click',reset);
    on(screen,'contextmenu',e=>{if(!input(e)&&(press||getContext().enabled||now()<ignoreContextUntil))e.preventDefault();});
    on(screen,'pointerdown',e=>{
      if(destroyed||e.defaultPrevented||e.button!==2||input(e)||e.target?.closest?.('button,.context-wheel'))return;
      const ctx=getContext();if(!ctx.enabled)return;
      e.preventDefault();reset();opening();ignoreContextUntil=now()+1200;
      screen.tabIndex=-1;screen.focus?.({preventScroll:true});
      press={id:e.pointerId,x:e.clientX,y:e.clientY,epoch:ctx.epoch,mode:ctx.mode,moved:false};items=ctx.items;
      position(e.clientX,e.clientY);try{screen.setPointerCapture?.(e.pointerId);}catch(_){}
      timer=later(()=>{timer=null;if(press){press.held=true;show();}},420);
    });
    on(win,'pointermove',e=>{
      if(!press||e.pointerId!==press.id)return;
      const ctx=getContext();if(!ctx.enabled||ctx.epoch!==press.epoch||ctx.mode!==press.mode)return reset();
      if(e.buttons!==undefined&&!(e.buttons&2))return reset();
      const dx=e.clientX-press.x,dy=e.clientY-press.y;press.moved ||= Math.hypot(dx,dy)>=8;
      const index=direction(e);e.preventDefault();
      if(index!==null){stopTimer();if(menu.hidden)show();}choose(index);
    });
    on(win,'pointerup',e=>{
      if(!press||e.pointerId!==press.id||e.button!==2)return;
      ignoreContextUntil=now()+800;
      e.preventDefault();const old=press,ctx=getContext(),index=direction(e,old);
      press=null;stopTimer();try{if(screen.hasPointerCapture?.(old.id))screen.releasePointerCapture(old.id);}catch(_){}
      if(!ctx.enabled||ctx.epoch!==old.epoch||ctx.mode!==old.mode||index===null)return reset();
      const item=items[index];if(menu.hidden)show();execute(item);
    });
    on(win,'pointercancel',e=>{if(press?.id===e.pointerId)reset();});on(win,'blur',reset);
    on(win,'keydown',e=>{if((press||!menu.hidden)&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation?.();reset();}},true);
    on(win,'pointerdown',e=>{if(!menu.hidden&&e.button===0&&!e.target?.closest?.('.context-wheel')){e.preventDefault();e.stopImmediatePropagation?.();reset();}},true);
    return {active:()=>!!press||!menu.hidden,reset,update(){const ctx=getContext();if((press||opened)&&(!ctx.enabled||ctx.epoch!==(press||opened).epoch||ctx.mode!==(press||opened).mode))reset();},
      destroy(){destroyed=true;reset();listeners.forEach(([n,t,f,o])=>n.removeEventListener(t,f,o));menu.remove?.();}};
  }
  return {createContextWheel,wheelIndex};
});
