/* Cascading presentation. Original controls/listeners remain the sole settings writers. */
(function(root){'use strict';
 // Pointer scrubbing changes the existing input; Apply remains the only writer.
 function bindSecondsScrub(node,win,on,active){
  let drag=null;
  const emit=type=>node.dispatchEvent(new (win.Event||Event)(type,{bubbles:true}));
  function finish(cancel=false){if(!drag)return;const old=drag;drag=null;if(cancel){node.value=old.text;emit('input');}else if(node.value!==old.text)emit('change');try{node.releasePointerCapture(old.id);}catch(_){}node.dataset.scrubbing='false';active(false);}
  on(node,'pointerdown',e=>{if(e.button!==0||node.disabled||drag)return;e.preventDefault();e.stopPropagation();node.focus();drag={id:e.pointerId,x:e.clientX,text:node.value,value:Number(node.value)||0};active(true);node.dataset.scrubbing='true';try{node.setPointerCapture(e.pointerId);}catch(_){}});
  on(win,'pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;if(!(e.buttons&1)){finish();return;}e.preventDefault();const steps=Math.trunc((e.clientX-drag.x)/8),value=Math.max(Number(node.min)||0,Math.min(Number(node.max)||1,Math.round((drag.value+steps*.05)*100)/100));if(Number(node.value)!==value){node.value=value.toFixed(2);emit('input');}});
  on(win,'pointerup',e=>{if(drag&&e.pointerId===drag.id)finish();});
  on(win,'pointercancel',e=>{if(drag&&e.pointerId===drag.id)finish(true);});
  on(node,'lostpointercapture',()=>finish(true));on(win,'blur',()=>finish(true));
  on(node,'keydown',e=>{if(e.key==='Escape'&&drag){e.preventDefault();e.stopPropagation();finish(true);}});
  return()=>finish(true);
 }
 function create({document:doc,window:win,workspace,settings}){
  const original=[...settings.childNodes],placements=[],listeners=[],make=(t,c,text)=>{const n=doc.createElement(t);n.className=c;if(text)n.textContent=text;return n;},find=id=>doc.getElementById(id),on=(n,t,f)=>{n.addEventListener(t,f);listeners.push(()=>n.removeEventListener(t,f));};
  const storage=make('div','settings-original');storage.hidden=true;for(const n of original)if(!n.classList?.contains('shell-panel-heading'))storage.append(n);settings.append(storage);
  const move=(p,n)=>{if(!n)return;if(!placements.some(x=>x.n===n))placements.push({n,parent:n.parentNode,next:n.nextSibling});p.append(n);};
  const body=make('div','shell-settings-body'),footer=make('div','shell-settings-footer'),tooltip=make('div','shell-setting-tooltip');tooltip.hidden=true;settings.append(body,footer);workspace.append(tooltip);
  const panels=[1,2].map(()=>{const p=make('section','shell-advanced shell-settings-level'),content=make('div','shell-settings-body');p.append(content);p.hidden=true;workspace.append(p);return{node:p,content};});
  let path=[],hintTimer=null,signature='',rendering=false,alignFrame=null,scrubbing=false;
  const fade=find('drawingFadeSeconds'),cancelScrub=fade?bindSecondsScrub(fade,win,on,value=>{scrubbing=value;if(!value)signature='';}):()=>{};
  const names={qualitySelect:'画质',display:'显示',drawingFadeSeconds:'标注淡入淡出',wheelFrames:'滚轮逐帧',advanced:'高级',memoryMiB:'内存额度',rateStep:'倍速步长',proxyEncoder:'代理生成',decoderPreference:'播放解码'};
  const helps={proxyEncoder:'GPU使用NVIDIA NVENC；需兼容显卡与驱动。整片代理后台生成，应用后保持暂停。',decoderPreference:'原生播放器使用系统硬件解码；不支持时明确回退CPU。优先CPU会关闭硬件解码，应用后生效。',qualitySelect:'保持比例，不放大小视频；应用后生效。',drawingFadeSeconds:'标注帧前后淡入淡出时长，0为关闭。应用后生效。',wheelFrames:'每次滚轮移动的源帧数，应用后生效。',memoryMiB:'播放器管理的缓存额度，不是整个Eagle或GPU的内存。',rateStep:'每次调整的倍速步长，应用后生效。',showDrawings:'立即生效，H也可切换；隐藏不删除标注。',drawingToolbar:'立即生效；隐藏后仍可用轮盘选工具。',showCacheStrip:'绿色表示RAM中已还原的画面，应用后生效。',showProxyStrip:'蓝色表示完整且已校验的代理位置；不代表已进入RAM。应用后生效。',forwardPredecode:'提前准备周围帧，应用后生效。'};
  helps.autoProxy='打开视频后从头到尾生成完整代理；关闭会取消当前生成。点击应用生效，原片可继续播放。';
  helps.gpuAcceleration='代理模式统一加速代理编码、播放解码和视频绘制；硬件不支持时回退CPU。GPU绘制不降低分辨率，代理压缩画质由编码方式决定。应用后生效。';
  helps.gpuDrawing='只控制视频色彩转换与绘制，不是整个Eagle的GPU开关。关闭后由CPU准确转换；点击应用生效。';
  function hideHint(){clearTimeout(hintTimer);hintTimer=null;tooltip.hidden=true;}
  function help(n,id){if(!helps[id])return;n.onpointerenter=n.onfocus=()=>{hideHint();hintTimer=setTimeout(()=>{if(settings.hidden||!n.isConnected)return;tooltip.textContent=helps[id];tooltip.hidden=false;const r=n.getBoundingClientRect();tooltip.style.left=Math.max(8,Math.min(win.innerWidth-tooltip.offsetWidth-8,r.left))+'px';tooltip.style.top=Math.max(8,Math.min(win.innerHeight-tooltip.offsetHeight-8,r.bottom+6))+'px';},450);};n.onpointerleave=n.onblur=hideHint;}
  function button(label,fn){const b=make('button','shell-setting-choice',label);b.type='button';b.onclick=fn;return b;}
  const triggers=new Map();
  for(const id of ['qualitySelect','display','drawingFadeSeconds','wheelFrames','advanced']){const b=button(names[id],()=>openPath(path[0]===id?[]:[id]));b.setAttribute('aria-expanded','false');b.dataset.setting=id;if(id==='advanced')b.classList.add('shell-settings-advanced');help(b,id);body.append(b);triggers.set(id,b);}
  const apply=find('memoryApply');move(footer,apply);move(footer,find('performanceMonitor'));
  function openPath(next){cancelScrub();path=next;signature='';hideHint();render();position();}
  function restoreControls(){for(const {n,parent,next} of placements)if(panels.some(p=>p.node.contains(n)))parent.insertBefore(n,next?.parentNode===parent?next:null);}
  function toggle(parent,id,label){const row=make('label','shell-setting-row is-toggle'),text=make('span','',label);row.append(text);move(row,find(id));help(row,id);parent.append(row);}
  function render(){if(rendering)return;rendering=true;restoreControls();for(const p of panels)p.content.replaceChildren();
   for(const [id,b]of triggers){b.setAttribute('aria-expanded',String(path[0]===id));const control=find(id);b.disabled=!!control?.disabled;}
   panels.forEach((p,i)=>{const id=path[i];p.node.hidden=settings.hidden||!id;if(!id)return;p.node.setAttribute('aria-label',names[id]);
    if(id==='display'){toggle(p.content,'showDrawings','画面标注');toggle(p.content,'drawingToolbar','圈画工具条');toggle(p.content,'showCacheStrip','缓存绿条');}
    else if(id==='advanced'){for(const key of ['memoryMiB','rateStep']){if(!find(key))continue;const b=button(names[key],()=>openPath(path[1]===key?['advanced']:['advanced',key]));help(b,key);b.dataset.setting=key;b.setAttribute('aria-expanded',String(path[1]===key));b.disabled=!!find(key)?.disabled;p.content.append(b);}if(find('gpuAcceleration'))toggle(p.content,'gpuAcceleration','GPU加速');for(const key of ['cacheClearOther'])move(p.content,find(key));}
    else{const control=find(id);if(!control)return;if(control.tagName==='SELECT'){for(const option of control.options){if(option.hidden)continue;const b=button(option.textContent,()=>{control.value=option.value;control.dispatchEvent(new Event('change',{bubbles:true}));signature='';render();position();});b.disabled=control.disabled||option.disabled;b.setAttribute('aria-pressed',String(control.value===option.value));p.content.append(b);}}
     else{const row=make('label','shell-setting-row',id==='drawingFadeSeconds'?'时长（秒）':names[id]);move(row,control);p.content.append(row);}}
   });rendering=false;
  }
  function position(){if(settings.hidden)return;
   const occupied=workspace.dataset.records==='true'?(workspace.querySelector('.shell-records')?.clientWidth||0):0,available=Math.max(220,win.innerWidth-occupied-80),width=Math.min(200,(available-path.length*4)/(path.length+1));
   settings.style.setProperty('--settings-width',width+'px');
   panels.forEach((p,i)=>{if(p.node.hidden)return;const parent=i?panels[i-1].content.querySelector('[data-setting="'+path[i]+'"]'):triggers.get(path[0]);if(!parent)return;
    const rect=parent.getBoundingClientRect(),origin=workspace.getBoundingClientRect();
    p.node.style.width=width+'px';p.node.style.maxHeight=Math.max(44,workspace.clientHeight-88)+'px';
    const height=p.node.offsetHeight,top=Math.max(44,Math.min(rect.top-origin.top+rect.height/2-height/2,workspace.clientHeight-44-height));
    p.node.style.left=(64+(i+1)*(width+4))+'px';p.node.style.top=top+'px';
   });
  }
  function followReveal(){if(alignFrame!==null)return;const frame=()=>{alignFrame=null;position();if(!settings.hidden&&settings.getAnimations().some(a=>a.playState==='running'))alignFrame=win.requestAnimationFrame(frame);};alignFrame=win.requestAnimationFrame(frame);}
  function update(){if(settings.hidden){if(path.length)openPath([]);hideHint();return;}if(scrubbing)return;const ids=['qualitySelect','drawingFadeSeconds','wheelFrames','memoryMiB','rateStep'],key=JSON.stringify(ids.map(id=>{const n=find(id);if(!n)return null;return[n.disabled,n.value,n.tagName==='SELECT'?[...n.options].map(o=>[o.textContent,o.hidden,o.disabled]):null];}))+path.join('/');if(key!==signature){signature=key;render();}position();}
  on(settings,'animationstart',followReveal);on(settings,'animationend',position);on(body,'scroll',position);for(const p of panels)on(p.content,'scroll',position);
  on(win,'resize',()=>{hideHint();position();});on(win,'keydown',e=>{if(!settings.hidden&&e.key==='Escape'&&path.length){openPath(path.slice(0,-1));e.preventDefault();}});
  return{advanced:panels[0].node,contains:n=>settings.contains(n)||panels.some(p=>p.node.contains(n))||tooltip.contains(n),close:()=>openPath([]),update,destroy(){cancelScrub();if(alignFrame!==null)win.cancelAnimationFrame(alignFrame);hideHint();listeners.forEach(f=>f());for(const {n,parent,next}of placements.reverse())parent.insertBefore(n,next?.parentNode===parent?next:null);for(const n of original)settings.append(n);body.remove();footer.remove();storage.remove();tooltip.remove();panels.forEach(p=>p.node.remove());settings.style.removeProperty('--settings-width');}};
 }
 root.EVASettingsView={create,bindSecondsScrub};
})(typeof window==='object'?window:globalThis);
