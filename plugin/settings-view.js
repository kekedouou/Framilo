/* Cascading presentation. Original controls/listeners remain the sole settings writers. */
(function(root){'use strict';
 function create({document:doc,window:win,workspace,settings}){
  const original=[...settings.childNodes],placements=[],listeners=[],make=(t,c,text)=>{const n=doc.createElement(t);n.className=c;if(text)n.textContent=text;return n;},find=id=>doc.getElementById(id),on=(n,t,f)=>{n.addEventListener(t,f);listeners.push(()=>n.removeEventListener(t,f));};
  const storage=make('div','settings-original');storage.hidden=true;for(const n of original)if(!n.classList?.contains('shell-panel-heading'))storage.append(n);settings.append(storage);
  const move=(p,n)=>{if(!n)return;if(!placements.some(x=>x.n===n))placements.push({n,parent:n.parentNode,next:n.nextSibling});p.append(n);};
  const body=make('div','shell-settings-body'),footer=make('div','shell-settings-footer'),tooltip=make('div','shell-setting-tooltip');tooltip.hidden=true;settings.append(body,footer);workspace.append(tooltip);
  const panels=[1,2].map(()=>{const p=make('section','shell-advanced shell-settings-level'),content=make('div','shell-settings-body');p.append(content);p.hidden=true;workspace.append(p);return{node:p,content};});
  let path=[],hintTimer=null,signature='',rendering=false,alignFrame=null;
  const names={qualitySelect:'画质',display:'显示',drawingFadeSeconds:'标注淡入淡出',wheelFrames:'滚轮逐帧',advanced:'高级',memoryMiB:'内存额度',rateStep:'倍速步长',playbackBackend:'播放方式'};
  const helps={qualitySelect:'保持比例，不放大小视频；应用后生效。',drawingFadeSeconds:'标注帧前后淡入淡出时长，0为关闭。应用后生效。',wheelFrames:'每次滚轮移动的源帧数，应用后生效。',memoryMiB:'播放器管理的缓存额度，不是整个Eagle或GPU的内存。',rateStep:'每次调整的倍速步长，应用后生效。',playbackBackend:'切换后重新准备视频，应用后保持暂停。',showDrawings:'立即生效，H也可切换；隐藏不删除标注。',drawingToolbar:'立即生效；隐藏后仍可用轮盘选工具。',showCacheStrip:'应用后生效。',forwardPredecode:'提前准备周围帧，应用后生效。'};
  function hideHint(){clearTimeout(hintTimer);hintTimer=null;tooltip.hidden=true;}
  function help(n,id){if(!helps[id])return;n.onpointerenter=n.onfocus=()=>{hideHint();hintTimer=setTimeout(()=>{if(settings.hidden||!n.isConnected)return;tooltip.textContent=helps[id];tooltip.hidden=false;const r=n.getBoundingClientRect();tooltip.style.left=Math.max(8,Math.min(win.innerWidth-tooltip.offsetWidth-8,r.left))+'px';tooltip.style.top=Math.max(8,Math.min(win.innerHeight-tooltip.offsetHeight-8,r.bottom+6))+'px';},450);};n.onpointerleave=n.onblur=hideHint;}
  function button(label,fn){const b=make('button','shell-setting-choice',label);b.type='button';b.onclick=fn;return b;}
  const triggers=new Map();
  for(const id of ['qualitySelect','display','drawingFadeSeconds','wheelFrames','advanced']){const b=button(names[id],()=>openPath(path[0]===id?[]:[id]));b.setAttribute('aria-expanded','false');b.dataset.setting=id;if(id==='advanced')b.classList.add('shell-settings-advanced');help(b,id);body.append(b);triggers.set(id,b);}
  const apply=find('memoryApply');move(footer,apply);move(footer,find('memoryStatus'));
  function openPath(next){path=next;signature='';hideHint();render();position();}
  function restoreControls(){for(const {n,parent,next} of placements)if(panels.some(p=>p.node.contains(n)))parent.insertBefore(n,next?.parentNode===parent?next:null);}
  function toggle(parent,id,label){const row=make('label','shell-setting-row is-toggle'),text=make('span','',label);row.append(text);move(row,find(id));help(row,id);parent.append(row);}
  function render(){if(rendering)return;rendering=true;restoreControls();for(const p of panels)p.content.replaceChildren();
   for(const [id,b]of triggers){b.setAttribute('aria-expanded',String(path[0]===id));const control=find(id);b.disabled=!!control?.disabled;}
   panels.forEach((p,i)=>{const id=path[i];p.node.hidden=settings.hidden||!id;if(!id)return;p.node.setAttribute('aria-label',names[id]);
    if(id==='display'){toggle(p.content,'showDrawings','画面标注');toggle(p.content,'drawingToolbar','圈画工具条');toggle(p.content,'showCacheStrip','缓存绿条');}
    else if(id==='advanced'){for(const key of ['memoryMiB','rateStep','playbackBackend']){if(!find(key))continue;const b=button(names[key],()=>openPath(path[1]===key?['advanced']:['advanced',key]));help(b,key);b.dataset.setting=key;b.setAttribute('aria-expanded',String(path[1]===key));b.disabled=!!find(key)?.disabled;p.content.append(b);}toggle(p.content,'forwardPredecode','提前解压');for(const key of ['memoryUsage','memoryAllowance','cacheStatus','cacheClearOther','cacheClearStatus'])move(p.content,find(key));}
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
  function update(){if(settings.hidden){if(path.length)openPath([]);hideHint();return;}const ids=['qualitySelect','drawingFadeSeconds','wheelFrames','memoryMiB','rateStep','playbackBackend'],key=JSON.stringify(ids.map(id=>{const n=find(id);if(!n)return null;return[n.disabled,n.value,n.tagName==='SELECT'?[...n.options].map(o=>[o.textContent,o.hidden,o.disabled]):null];}))+path.join('/');if(key!==signature){signature=key;render();}position();}
  on(settings,'animationstart',followReveal);on(settings,'animationend',position);on(body,'scroll',position);for(const p of panels)on(p.content,'scroll',position);
  on(win,'resize',()=>{hideHint();position();});on(win,'keydown',e=>{if(!settings.hidden&&e.key==='Escape'&&path.length){openPath(path.slice(0,-1));e.preventDefault();}});
  return{advanced:panels[0].node,contains:n=>settings.contains(n)||panels.some(p=>p.node.contains(n))||tooltip.contains(n),close:()=>openPath([]),update,destroy(){if(alignFrame!==null)win.cancelAnimationFrame(alignFrame);hideHint();listeners.forEach(f=>f());for(const {n,parent,next}of placements.reverse())parent.insertBefore(n,next?.parentNode===parent?next:null);for(const n of original)settings.append(n);body.remove();footer.remove();storage.remove();tooltip.remove();panels.forEach(p=>p.node.remove());settings.style.removeProperty('--settings-width');}};
 }
 root.EVASettingsView={create};
})(typeof window==='object'?window:globalThis);
