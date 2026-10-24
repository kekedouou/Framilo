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
    let press=null,timer=null,opened=null,items=[],buttons=[],childStart=null,destroyed=false,ignoreContextUntil=0,rootItems=[],children=[],wedges=[],hoverTimer=null,hoverItem=null,branch=null,branches=new Map();
    const later=(fn,ms)=>(win.setTimeout||setTimeout).call(win,fn,ms),clear=id=>(win.clearTimeout||clearTimeout).call(win,id);
    const input=e=>e.target?.closest?.('input,textarea,select,a,[contenteditable]');
    function stopTimer(){if(timer!==null)clear(timer);timer=null;}
    function stopHover(){if(hoverTimer!==null)clear(hoverTimer);hoverTimer=null;hoverItem=null;}
    function hideChildren(){for(const entry of branches.values())entry.layer.hidden=true;childStart=null;branch=null;children=[];items=rootItems;menu.setAttribute('data-level','root');panel.hidden=true;}
    function hover(item){if(item===hoverItem||item===branch)return;stopHover();if(branch)hideChildren();if(!item||item.disabled)return;if(item.children||item.id==='color'){hoverItem=item;hoverTimer=later(()=>{hoverTimer=null;if(!menu.hidden&&hoverItem===item)showChildren(item);},100);}}
    function finishClosing(){if(!menu.hidden)return;menu.setAttribute('data-closing','false');panel.hidden=true;}
    function reset(){const old=press,visible=!menu.hidden;if(visible&&menu.getBoundingClientRect){const r=menu.getBoundingClientRect();menu.style.position='fixed';menu.style.left=(r.left+r.width/2)+'px';menu.style.top=(r.top+r.height/2)+'px';}press=null;stopTimer();stopHover();branch=null;menu.hidden=true;menu.inert=true;menu.setAttribute('aria-hidden','true');menu.setAttribute('data-open','false');if(visible)menu.setAttribute('data-closing','true');opened=null;childStart=null;if(!visible)panel.hidden=true;remove(ringListeners);remove(panelListeners);if(old)try{if(screen.hasPointerCapture?.(old.id))screen.releasePointerCapture(old.id);}catch(_){} }
    on(menu,'animationend',e=>{if(e.target===menu&&e.animationName==='wheel-out')finishClosing();});
    function position(x,y,size){menu.style.position='absolute';const r=screen.getBoundingClientRect(),w=r.width||400,h=r.height||400,edge=size/2+6;menu.style.width=menu.style.height=size+'px';menu.style.left=Math.max(Math.min(edge,w/2),Math.min(w-edge,x-r.left))+'px';menu.style.top=Math.max(Math.min(edge,h/2),Math.min(h-edge,y-(r.top||0)))+'px';center.style.left=center.style.top=size/2+'px';}
    function menuCenter(){const r=screen.getBoundingClientRect();return{x:r.left+parseFloat(menu.style.left),y:(r.top||0)+parseFloat(menu.style.top)};}
    function choose(index){for(let i=0;i<buttons.length;i++){const active=items[index]?.id===buttons[i].getAttribute('data-wheel-command');if(buttons[i].getAttribute('data-active')!==String(active)){buttons[i].setAttribute('data-active',String(active));wedges[i]?.setAttribute('data-active',String(active));}}}
    function direction(e,p=press){if(!p||!items.length)return null;const at=p.held||childStart?menuCenter():p,dx=e.clientX-at.x,dy=e.clientY-at.y,dist=Math.hypot(dx,dy);
      if(childStart&&dist>83.2){items=children;const angle=Math.atan2(dy,dx);if(angle>=0)return null;return Math.min(children.length-1,Math.floor((angle+Math.PI)/Math.PI*children.length));}
      if(childStart)items=rootItems;return wheelIndex(dx,dy,items.length);}
    function show(values,at){const ctx=getContext();if(!ctx.enabled)return reset();if(!values.length)return;
      remove(ringListeners);remove(panelListeners);opened={epoch:ctx.epoch,mode:ctx.mode};items=values;ring.replaceChildren();buttons=[];wedges=[];panel.hidden=true;
      rootItems=values;children=[];branches.clear();
      const size=256;position(at.x,at.y,size);menu.setAttribute('data-mode',ctx.mode);menu.setAttribute('data-level','root');menu.setAttribute('aria-label',ctx.mode==='drawing'?'圈画菜单':'右键菜单');center.textContent='取消';
      function add(item,angle,span,inner,outer,layer=ring){if(!item.label)return;const radius=(inner+outer)/2,b=make('button','context-wheel-item');b.type='button';b.disabled=!!item.disabled;b.setAttribute('data-wheel-command',item.id);b.setAttribute('aria-label',item.label);b.setAttribute('data-secondary',String(inner>80));if(inner>80)b.title=item.label;b.setAttribute('aria-pressed',String(!!item.selected));b.style.left=128+Math.cos(angle)*radius+'px';b.style.top=128+Math.sin(angle)*radius+'px';
        const polygon=[];for(let n=0;n<=20;n++){const a=angle-span/2+.018+(span-.036)*n/20;polygon.push((128+outer*Math.cos(a))+'px '+(128+outer*Math.sin(a))+'px');}for(let n=20;n>=0;n--){const a=angle-span/2+.018+(span-.036)*n/20;polygon.push((128+inner*Math.cos(a))+'px '+(128+inner*Math.sin(a))+'px');}
        const wedge=make('div','context-wheel-wedge');wedge.style.width=wedge.style.height=size+'px';wedge.style.clipPath='polygon('+polygon.join(',')+')';wedge.setAttribute('data-disabled',String(!!item.disabled));dynamic(ringListeners,wedge,'click',e=>execute(item,e));dynamic(ringListeners,wedge,'pointerenter',()=>{if(!press&&inner<80)hover(item);});layer.appendChild(wedge);wedges.push(wedge);
        const symbol=make('span','context-wheel-symbol',(item.symbol||'')+'\ufe0e');if(item.color){symbol.style.backgroundColor=item.color;symbol.className+=' is-color';symbol.textContent='';}else if(win.EVAIcons)symbol.innerHTML=win.EVAIcons.svg(item.id==='custom-color'?'color':item.id);
        b.appendChild(symbol);b.appendChild(make('span','context-wheel-label',item.label));dynamic(ringListeners,b,'click',e=>execute(item,e));dynamic(ringListeners,b,'pointerenter',e=>{if(!press&&inner<80)hover(item);});layer.appendChild(b);buttons.push(b);
      }
      rootItems.forEach((item,i)=>add(item,i*Math.PI*2/rootItems.length-Math.PI/2,Math.PI*2/rootItems.length,33.6,80.8));
      // Build each outer branch once per opening; switching never rebuilds the root or SVG icons.
      for(const parent of rootItems){const values=childValues(parent);if(!values?.length||parent.disabled)continue;const layer=make('div','context-wheel-branch');layer.hidden=true;layer.setAttribute('data-branch',parent.id);ring.appendChild(layer);branches.set(parent.id,{layer,values});values.forEach((item,i)=>add(item,-Math.PI+(i+.5)*Math.PI/values.length,Math.PI/values.length,84.8,124,layer));}
      menu.setAttribute('data-closing','false');menu.setAttribute('data-open','true');menu.setAttribute('aria-hidden','false');menu.inert=false;menu.hidden=false;choose(null);
    }
    function childValues(item){return item.children||(item.id==='color'?['#ffd54f','#ff5252','#69d785','#65b6ff','#ffffff','#222222'].map((color,i)=>({id:'color-'+i,label:color,color})).concat({id:'custom-color',label:'自定义颜色'}):null);}
    function showChildren(item){const entry=branches.get(item.id);if(item.disabled||!entry)return;stopHover();hideChildren();branch=item;children=entry.values;childStart=menuCenter();entry.layer.hidden=false;menu.setAttribute('data-level',item.id);choose(null);}
    function showPanel(){const ctx=getContext();remove(panelListeners);panel.replaceChildren();panel.hidden=false;panel.setAttribute('data-panel','color');
      const label=make('label','context-wheel-custom','自定义'),picker=make('input','');picker.type='color';picker.value=ctx.color||'#ffd54f';picker.setAttribute('aria-label','自定义圈画颜色');dynamic(panelListeners,picker,'input',()=>command('color',picker.value));label.appendChild(picker);panel.appendChild(label);
    }
    function execute(item,e){if(!item||item.disabled)return reset();if(item.children||item.id==='color'){showChildren(item,e||{clientX:menuCenter().x,clientY:menuCenter().y});return;}if(item.id==='custom-color'){showPanel();return;}if(item.color){reset();command('color',item.color);return;}reset();command(item.id,item.value);}
    on(center,'click',reset);on(menu,'pointerleave',stopHover);on(menu,'pointermove',e=>{if(press)return;const i=direction(e,{held:true});if(items===rootItems)hover(i===null?null:items[i]);});
    on(screen,'contextmenu',e=>{if(!input(e)&&(press||getContext().enabled||now()<ignoreContextUntil))e.preventDefault();});
    on(screen,'pointerdown',e=>{if(destroyed||e.defaultPrevented||e.button!==2||input(e)||e.target?.closest?.('button,.context-wheel'))return;const ctx=getContext();if(!ctx.enabled)return;
      const cancelOnly=!menu.hidden;e.preventDefault();reset();opening();ignoreContextUntil=now()+1200;screen.tabIndex=-1;screen.focus?.({preventScroll:true});
      press={id:e.pointerId,x:e.clientX,y:e.clientY,epoch:ctx.epoch,mode:ctx.mode,moved:false,cancelOnly};items=ctx.items||[];rootItems=items;position(e.clientX,e.clientY,320);try{screen.setPointerCapture?.(e.pointerId);}catch(_){}
      timer=later(()=>{timer=null;if(press){press.held=true;if(!press.cancelOnly)show(items,press);}},420);
    });
    on(win,'pointermove',e=>{if(!press||e.pointerId!==press.id)return;const ctx=getContext();if(!ctx.enabled||ctx.epoch!==press.epoch||ctx.mode!==press.mode)return reset();if(e.buttons!==undefined&&!(e.buttons&2))return reset();
      press.moved ||= Math.hypot(e.clientX-press.x,e.clientY-press.y)>=8;e.preventDefault();if(press.cancelOnly)return;const index=direction(e);if(index!==null){stopTimer();if(menu.hidden)show(items,press);}choose(index);if(items===rootItems)hover(index===null?null:items[index]);
    });
    on(win,'pointerup',e=>{if(!press||e.pointerId!==press.id||e.button!==2)return;ignoreContextUntil=now()+800;e.preventDefault();
      const old=press,ctx=getContext(),index=direction(e,old),tap=!old.held&&!old.moved&&Math.hypot(e.clientX-old.x,e.clientY-old.y)<8;press=null;stopTimer();try{if(screen.hasPointerCapture?.(old.id))screen.releasePointerCapture(old.id);}catch(_){}
      if(!ctx.enabled||ctx.epoch!==old.epoch||ctx.mode!==old.mode||old.cancelOnly)return reset();if(tap){reset();if(ctx.tap)command(ctx.tap);return;}if(index===null)return reset();const item=items[index];if(childStart&&item?.children)return reset();if(menu.hidden)show(items,old);execute(item,e);
    });
    on(win,'pointercancel',e=>{if(press?.id===e.pointerId)reset();});on(win,'lostpointercapture',e=>{if(press?.id===e.pointerId)reset();});on(win,'blur',reset);
    on(win,'keydown',e=>{if((press||!menu.hidden)&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation?.();reset();}},true);
    on(win,'pointerdown',e=>{if(!menu.hidden&&e.button===0&&!e.target?.closest?.('.context-wheel')){e.preventDefault();e.stopImmediatePropagation?.();reset();}},true);
    return{active:()=>!!press||!menu.hidden,reset,update(){const ctx=getContext();if((press||opened)&&(!ctx.enabled||ctx.epoch!==(press||opened).epoch||ctx.mode!==(press||opened).mode))reset();},destroy(){destroyed=true;reset();listeners.forEach(([n,t,f,o])=>n.removeEventListener(t,f,o));menu.remove?.();}};
  }
  return{createContextWheel,wheelIndex};
});
