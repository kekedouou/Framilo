/* View composition only. Session owns media and persistence; app owns SDK calls. */
(function(root){'use strict';
function createShell({document:doc,window:win,getState,getSession,getRange,annotate,clip,exitDrawing,hostAction=()=>{}}){
 const workspace=doc.querySelector?.('.workspace');if(!workspace||!root.EVAIcons)return{update(){},destroy(){},records(){}};
 const $=id=>doc.getElementById(id),listeners=[],on=(el,type,fn,opts)=>{el.addEventListener(type,fn,opts);listeners.push(()=>el.removeEventListener(type,fn,opts));};
 const make=(tag,cls,text)=>{const n=doc.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
 const button=(name,label,fn)=>{const b=make('button','shell-icon');b.type='button';b.innerHTML=root.EVAIcons.svg(name);b.setAttribute('aria-label',label);b.title=label;b.onclick=fn;return b;};
 const gesture=$('screenGestureRing');if(gesture){for(const [i,d]of ['up','right','down','left'].entries()){const n=gesture.querySelector('.gesture-'+d);if(n){const points=[],angle=i*Math.PI/2-Math.PI/2;for(const [r,reverse]of [[56,false],[18,true]])for(let step=0;step<=16;step++){const a=angle-Math.PI/4+.025+(Math.PI/2-.05)*(reverse?16-step:step)/16;points.push((56+r*Math.cos(a))+'px '+(56+r*Math.sin(a))+'px');}n.style.clipPath='polygon('+points.join(',')+')';n.innerHTML=root.EVAIcons.svg('arrow')+'<small>'+['加速','前进','减速','后退'][i]+'</small>';}}}
 workspace.dataset.graphite='true';const header=make('header','shell-header'),title=make('span','shell-title');
 header.append(title);const windows=make('div','shell-windows');
 for(const [id,label]of[['minimize','最小化'],['fullscreen','全屏 / 退出全屏（F11）'],['close','关闭']])windows.append(button(id,label,()=>hostAction(id)));header.append(windows);workspace.prepend(header);
 const headerEdge=make('div','shell-header-edge');workspace.append(headerEdge);let headerTimer=null;
 const full=()=>doc.documentElement.dataset.evaFullscreen==='true'||!!doc.fullscreenElement;
 const revealHeader=()=>{clearTimeout(headerTimer);workspace.dataset.headerOpen='true';};
 const hideHeader=()=>{clearTimeout(headerTimer);if(full()&&!headerDrag?.active)headerTimer=setTimeout(()=>{if(!(header.contains(doc.activeElement)&&doc.activeElement?.matches?.(':focus-visible')))workspace.dataset.headerOpen='false';},650);};
 const fullscreenChanged=()=>{workspace.dataset.fullscreen=String(full());workspace.dataset.headerOpen=String(!full());};
 on(win,'eva-fullscreen-change',fullscreenChanged);on(doc,'fullscreenchange',fullscreenChanged);on(headerEdge,'pointerenter',revealHeader);on(header,'pointerenter',revealHeader);on(header,'pointerleave',hideHeader);on(header,'focusin',revealHeader);on(header,'focusout',hideHeader);fullscreenChanged();
 let headerDrag=null;
 const dragPoint=e=>({x:e.screenX,y:e.screenY});
 on(header,'pointerdown',e=>{if(e.button!==0||!full()||e.target.closest('button'))return;headerDrag={id:e.pointerId,x:e.clientX,y:e.clientY,ratio:e.clientX/win.innerWidth,active:false};try{header.setPointerCapture?.(e.pointerId);}catch(_){}e.preventDefault();});
 on(win,'pointermove',e=>{const d=headerDrag;if(!d||d.id!==e.pointerId)return;if(!d.active&&Math.hypot(e.clientX-d.x,e.clientY-d.y)>6){d.active=true;workspace.dataset.windowDragging='true';revealHeader();hostAction('window-drag-start',{...dragPoint(e),ratio:d.ratio,offsetY:d.y});}else if(d.active)hostAction('window-drag-move',dragPoint(e));});
 const endHeaderDrag=e=>{const d=headerDrag;if(!d)return;headerDrag=null;if(d.active)hostAction('window-drag-end',e?.type==='pointerup'?dragPoint(e):null);delete workspace.dataset.windowDragging;try{if(header.hasPointerCapture?.(d.id))header.releasePointerCapture(d.id);}catch(_){} };
 on(win,'pointerup',endHeaderDrag);on(win,'pointercancel',endHeaderDrag);on(header,'lostpointercapture',endHeaderDrag);on(win,'blur',endHeaderDrag);
 const toastState=new Map();
 const data=(node,key,value)=>{const next=String(value);if(node.dataset[key]!==next)node.dataset[key]=next;};
 function updateToasts(s){for(const id of ['drawingStatus','commentStatus']){const n=$(id),text=n?.textContent||'',draft=id==='drawingStatus'?s.drawings?.draft:s.comments?.draft,key=s.epoch+':'+text+':'+!!draft;let old=toastState.get(id);if(old?.key===key)continue;if(old)clearTimeout(old.timer);n.removeAttribute('data-faded');old={key,timer:null};toastState.set(id,old);
 const persistent=!!draft||/失败|未保存|未知|无法|错误|仍保留|核对|冲突|未完成|重试|丢失|中断/.test(text);
 if(text&&!persistent){for(const [other,v]of toastState)if(other!==id&&!v.persistent){clearTimeout(v.timer);$(other).setAttribute('data-faded','true');}old.timer=setTimeout(()=>n.setAttribute('data-faded','true'),2200);}old.persistent=persistent;}}
 const strip=root.EVATimelineStrip?.create({document:doc,window:win,getSession,getState,getRange});
 const pane=doc.querySelector('.player-pane'),edge=make('div','shell-edge'),dock=make('nav','shell-dock');dock.setAttribute('aria-label','观察工具');
 const records=make('aside','shell-records'),heading=make('div','shell-panel-heading'),info=make('div','shell-record-info'),list=make('div','shell-record-list');records.hidden=true;heading.append(make('span','','记录'),button('close','关闭记录',()=>toggleRecords()));records.append(heading,info,list);workspace.append(edge,dock,records);
 const restore=[];const remember=n=>{if(n&&!restore.some(v=>v.n===n))restore.push({n,parent:n.parentNode,next:n.nextSibling});return n;};
 const settingsSource=doc.querySelector('.memory-settings'),settings=make('section','memory-settings shell-settings');while(settingsSource.firstChild)settings.append(settingsSource.firstChild);settings.hidden=true;
 const settingsHeading=make('div','shell-panel-heading');settingsHeading.append(make('span','','设置'),button('close','关闭设置',()=>toggleSettings(false)));settings.prepend(settingsHeading);workspace.append(settings);
 const settingsView=root.EVASettingsView.create({document:doc,window:win,workspace,settings});
 const toolPanel=remember($('drawingPanel'));workspace.append(toolPanel);
 const alerts=make('div','shell-alerts');for(const id of ['error','retry','commentStatus','drawingStatus'])alerts.append(remember($(id)));workspace.append(alerts);
 const guide=make('section','shell-guide');guide.hidden=true;guide.append(make('strong','','把注意力留给画面'),make('p','','点击播放 · 滚轮逐帧'),make('p','','按住左键：左右定位，上下调速'),make('p','','右键甩动或长按：标注、片段、记录、循环'),button('close','关闭提示',()=>{guide.hidden=true;try{win.localStorage.setItem('eva-graphite-guide','seen');}catch(_){}}));workspace.append(guide);
 const help=make('button','shell-help','重看操作提示');on(help,'click',()=>{guide.hidden=false;});settings.querySelector('.shell-settings-footer').append(help);
 try{guide.hidden=win.localStorage.getItem('eva-graphite-guide')==='seen';}catch(_){}
 let recordsOpen=false,settingsOpen=false,hover=false,hideTimer=null,epoch=null,listRef=null,loopKey=null,draftId=null,groups=[],selected=null,thumbBusy=false,version=0,disposed=false,recordRenderKey='';
 const live=new Map(),parked=new Map();const set=(n,k,v)=>{if(n[k]!==v)n[k]=v;};const buttons={};
 const reveal=()=>{clearTimeout(hideTimer);hideTimer=null;data(dock,'open',true);};
 const hide=()=>{if(hideTimer!==null||dock.dataset.open==='false'||hover||recordsOpen||settingsOpen||getState().drawings?.draft||getState().comments?.draft||dock.contains(doc.activeElement))return;hideTimer=setTimeout(()=>{hideTimer=null;if(!hover&&!recordsOpen&&!settingsOpen&&!getState().drawings?.draft&&!getState().comments?.draft&&!dock.contains(doc.activeElement))data(dock,'open',false);},650);};
 for(const [id,label,fn]of[['note','标注（N）',()=>getState().drawings?.draft?exitDrawing():annotate()],['selection','片段（R）',clip],['records','记录',()=>toggleRecords()],['settings','设置',()=>toggleSettings(!settingsOpen)]]){buttons[id]=button(id,label,fn);dock.append(buttons[id]);}
 on(win,'pointerdown',e=>{if(!settingsOpen||settingsView.contains(e.target)||dock.contains(e.target)||header.contains(e.target))return;toggleSettings(false);e.preventDefault();e.stopImmediatePropagation();},true);
 on(edge,'pointerenter',reveal);on(dock,'pointerenter',()=>{hover=true;reveal();});on(dock,'pointerleave',()=>{hover=false;hide();});on(dock,'focusin',reveal);on(dock,'focusout',hide);
 function layout(){workspace.dataset.records=String(recordsOpen);records.hidden=!recordsOpen;settings.hidden=!settingsOpen;buttons.records.setAttribute('aria-expanded',String(recordsOpen));buttons.settings.setAttribute('aria-expanded',String(settingsOpen));settingsView.update();win.dispatchEvent(new Event('resize'));}
 function release(keep=false){clearTimeout(thumbTimer);thumbTimer=null;version++;recordRenderKey='';for(const [key,entry]of live){if(keep&&entry.lease&&entry.canvas.width>1){parked.delete(key);parked.set(key,entry);}else{entry.lease?.release();entry.canvas.width=entry.canvas.height=1;}}live.clear();if(!keep){for(const e of parked.values())e.lease?.release();parked.clear();}while(parked.size>20){const key=parked.keys().next().value;parked.get(key).lease?.release();parked.delete(key);}list.replaceChildren();}
 function toggleRecords(){if(settingsOpen)toggleSettings(false);if(getState().drawings?.draft||getState().comments?.draft)return;recordsOpen=!recordsOpen;if(recordsOpen){reveal();selectedInfo();renderRecords();}else release(true);layout();hide();}
 function toggleSettings(open){if(open&&(getState().drawings?.draft||getState().comments?.draft))return;settingsOpen=open;if(!open)settingsView.close();if(open){getSession()?.pause?.();reveal();}layout();hide();}
 function groupItems(state){const map=new Map();for(const row of state.comments?.items||[]){const frame=getSession()?.annotationFrame?.(row.time)??row.drawingFrameOrdinal??row.time;const loop=state.playback?.transport?.loop;if(loop?.enabled&&loop.valid&&(frame<loop.startOrdinal||frame>loop.endOrdinal))continue;const key=String(frame);if(!map.has(key))map.set(key,{key,time:row.time,rows:[]});map.get(key).rows.push(row);}return[...map.values()];}
 function selectedInfo(){info.replaceChildren();const found=groups.find(g=>g.key===selected);if(!found){info.append(make('p','muted',groups.length?'选一张画面，回看观察':getState().playback?.transport?.loop?.enabled?'当前片段暂无标注':'暂无标注'));return;}
  const text=make('div','shell-record-text');for(const row of found.rows){const p=make('p','',row.localDrawing?'圈画标注':row.text);text.append(p);const actions=make('div','shell-record-actions');const edit=button('note','编辑这条标注',()=>annotate(row.id));const del=button('close',row.localDrawing?'清除圈画':'删除这条文字',()=>{if(row.localDrawing)annotate(row.id,'delete');else getSession()?.deleteComment?.(row.id);});actions.append(edit,del);text.append(actions);}info.append(text);
 }
 function renderRecords(){if(!recordsOpen)return;const scroll=list.scrollTop;const width=Math.max(100,records.clientWidth-24),height=width/Math.max(.1,$('picture').width/$('picture').height)+4,first=Math.max(0,Math.floor(scroll/height)-1),last=Math.min(groups.length,first+10),top=make('div','');const rk=[first,last,width,version].join(':');if(rk===recordRenderKey)return;recordRenderKey=rk;top.style.height=first*height+'px';const wanted=new Set(groups.slice(first,last).map(g=>g.key));for(const [key,e]of live){if(!wanted.has(key)){e.lease?.release();e.canvas.width=e.canvas.height=1;live.delete(key);}}while(parked.size+live.size>10){const key=parked.keys().next().value;if(key===undefined)break;parked.get(key).lease?.release();parked.delete(key);}const nodes=[top];
  for(const group of groups.slice(first,last)){const existing=live.get(group.key)||parked.get(group.key);if(existing&&existing.canvas.width>1){parked.delete(group.key);live.set(group.key,existing);nodes.push(existing.button);continue;}if(existing){existing.lease?.release();parked.delete(group.key);}const b=make('button','shell-record-card'),canvas=doc.createElement('canvas'),hint=make('span','shell-thumb-hint','预览准备中');canvas.width=canvas.height=1;b.type='button';b.setAttribute('aria-label',group.rows.map(n=>n.text).join(' / ')||'圈画标注');b.setAttribute('aria-pressed',String(selected===group.key));b.disabled=!!getState().drawings?.draft||!!getState().comments?.draft;b.style.aspectRatio=String($('picture').width/$('picture').height);b.append(canvas,hint);b.onclick=()=>{selected=group.key;getSession()?.seekComment?.(group.rows[0].id);selectedInfo();for(const [key,e]of live)e.button.setAttribute('aria-pressed',String(key===selected));};nodes.push(b);live.set(group.key,{canvas,button:b,hint,group,lease:null});}
  const bottom=make('div','');bottom.style.height=Math.max(0,groups.length-last)*height+'px';nodes.push(bottom);list.replaceChildren(...nodes);list.scrollTop=scroll;scheduleThumbnails();
 }
 let scrollTimer;on(list,'scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(renderRecords,80);});
 async function thumbnails(){if(disposed||!recordsOpen||thumbBusy)return;const task=[...live.values()].find(n=>!n.lease&&(!n.nextTry||Date.now()>=n.nextTry));if(!task){scheduleThumbnails();return;}const token=version;thumbBusy=true;
  try{const lease=await getSession()?.renderThumbnail?.(task.group.time,task.canvas);if(disposed||token!==version||live.get(task.group.key)!==task){lease?.release();return;}if(lease){task.lease=lease;task.hint.hidden=true;drawOverlay(task);}else task.nextTry=Date.now()+1000;}
  catch(_){task.nextTry=Date.now()+1000;/* Retry without a per-frame failure loop. */}
  finally{thumbBusy=false;scheduleThumbnails();}
 }
 function drawOverlay(entry){const s=getState(),row=entry.group.rows.find(n=>n.drawingId),record=s.drawings?.records?.find(n=>n.id===row?.drawingId);if(!record)return;
  const width=$('picture').width,height=$('picture').height,scale=Math.min(width,height),maskPrefix='thumbnail-'+version+'-'+entry.group.key+'-';
  const node=(name,attrs={})=>{const n=doc.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
  const svg=node('svg',{viewBox:'0 0 '+width+' '+height,'aria-hidden':'true'});svg.classList.add('shell-thumb-drawing');
  for(const o of record.objects){const key=o.id;
        const g = node('g', { 'data-object-id': o.id, fill: 'none', stroke: o.color, 'stroke-width': o.width * scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
        const x = o.a?.x * width, y = o.a?.y * height, x2 = o.b?.x * width, y2 = o.b?.y * height;
        if (o.kind === 'pen') {
          if (o.points.length === 1) g.appendChild(node('circle', { cx: o.points[0].x * width, cy: o.points[0].y * height, r: o.width * scale / 2, fill: o.color }));
          else g.appendChild(node('polyline', { points: o.points.map(p => p.x * width + ',' + p.y * height).join(' ') }));
        }
        if (o.kind === 'rect') g.appendChild(node('rect', { x: Math.min(x, x2), y: Math.min(y, y2), width: Math.max(1, Math.abs(x2 - x)), height: Math.max(1, Math.abs(y2 - y)) }));
        if (o.kind === 'ellipse') g.appendChild(node('ellipse', { cx: (x + x2) / 2, cy: (y + y2) / 2, rx: Math.max(1, Math.abs(x2 - x) / 2), ry: Math.max(1, Math.abs(y2 - y) / 2) }));
        if (o.kind === 'arrow') {
          const angle = Math.atan2(y2 - y, x2 - x), size = Math.max(12, o.width * scale * 5);
          g.appendChild(node('line', { x1: x, y1: y, x2, y2 }));
          g.appendChild(node('polyline', { points: [[x2 - Math.cos(angle - .45) * size, y2 - Math.sin(angle - .45) * size], [x2, y2], [x2 - Math.cos(angle + .45) * size, y2 - Math.sin(angle + .45) * size]].map(p => p.join(',')).join(' ') }));
        }
        if (o.kind === 'text') {
          const text = node('text', { x, y, fill: o.color, stroke: 'none', 'font-size': o.size * scale, 'font-family': 'Segoe UI, Microsoft YaHei UI, sans-serif', 'dominant-baseline': 'hanging' });
          o.text.split('\n').forEach((line, i) => { const span = node('tspan', { x, dy: i ? o.size * scale * 1.25 : 0 }); span.textContent = line || ' '; text.appendChild(span); }); g.appendChild(text);
        }
        if (o.erasures?.length) {
          const maskId = maskPrefix + key, defs = node('defs'), mask = node('mask', { id: maskId, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse', x: 0, y: 0, width, height, 'mask-type': 'luminance' });
          mask.appendChild(node('rect', { x: 0, y: 0, width, height, fill: 'white', stroke: 'none' }));
          for (const cut of o.erasures) {
            const attrs = { fill: 'none', stroke: 'black', 'stroke-width': cut.width * scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
            mask.appendChild(cut.points.length === 1 ? node('circle', { cx: cut.points[0].x * width, cy: cut.points[0].y * height, r: cut.width * scale / 2, fill: 'black', stroke: 'none' })
              : node('polyline', { ...attrs, points: cut.points.map(p => p.x * width + ',' + p.y * height).join(' ') }));
          }
          defs.appendChild(mask); g.appendChild(defs); g.setAttribute('mask', 'url(#' + maskId + ')');
        }

    svg.append(g);
  }entry.button.append(svg);
 }
 const grip=make('div','shell-record-grip');grip.setAttribute('role','separator');grip.setAttribute('aria-label','调整记录栏宽度');grip.setAttribute('aria-orientation','vertical');grip.tabIndex=0;records.append(grip);
 let resizing=null;const resizeTo=value=>{const width=Math.max(200,Math.min(Math.min(560,win.innerWidth-400),value));workspace.style.setProperty('--record-width',width+'px');grip.setAttribute('aria-valuenow',String(width));renderRecords();win.dispatchEvent(new Event('resize'));};
 on(grip,'pointerdown',e=>{if(e.button!==0)return;e.preventDefault();resizing=e.pointerId;workspace.dataset.recordResizing='true';grip.setPointerCapture?.(e.pointerId);});on(grip,'pointermove',e=>{if(resizing===e.pointerId)resizeTo(win.innerWidth-e.clientX);});const endResize=()=>{resizing=null;delete workspace.dataset.recordResizing;};on(grip,'pointerup',endResize);on(win,'resize',()=>{const max=Math.max(200,Math.min(560,win.innerWidth-400));if(records.clientWidth>max)resizeTo(max);else renderRecords();});on(grip,'pointercancel',endResize);on(grip,'lostpointercapture',endResize);on(grip,'keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();resizeTo(records.clientWidth+(e.key==='ArrowLeft'?16:-16));}});
 let thumbTimer=null;
 function scheduleThumbnails(){if(thumbTimer!==null||disposed||!recordsOpen||doc.hidden||thumbBusy||![...live.values()].some(n=>!n.lease))return;const waiting=[...live.values()].filter(n=>!n.lease);const delay=Math.max(0,Math.min(...waiting.map(n=>(n.nextTry||0)-Date.now())));thumbTimer=setTimeout(()=>{thumbTimer=null;win.requestAnimationFrame(()=>thumbnails());},delay);}
 on(doc,'visibilitychange',()=>{if(doc.hidden){clearTimeout(thumbTimer);thumbTimer=null;}else scheduleThumbnails();});
 const editor=make('section','shell-editor'),editorHead=make('div','shell-editor-heading'),input=doc.createElement('textarea'),choice=doc.createElement('select'),message=make('p','shell-editor-message'),save=make('button','shell-check','核对保存结果');editor.hidden=true;input.maxLength=4096;input.rows=3;input.placeholder='记录这一帧的观察';input.setAttribute('aria-label','标注文字');choice.setAttribute('aria-label','选择同帧文字');editorHead.append(make('span','','标注'),button('close','退出标注',exitDrawing));editor.append(editorHead,choice,input,make('p','shell-editor-help','Enter / 画面右键保存 · Shift+Enter换行'),message,save);pane.append(editor);
 let choicesKey='',composing=false,compositionEnd=-Infinity;on(input,'compositionstart',()=>composing=true);on(input,'compositionend',()=>{composing=false;compositionEnd=Date.now();getSession()?.setDrawingNote?.(input.value);});on(input,'input',()=>{if(!composing)getSession()?.setDrawingNote?.(input.value);});on(choice,'change',()=>getSession()?.setDrawingNote?.('',choice.value));on(save,'click',()=>$('drawingSave').click());
 on(input,'keydown',e=>{if(e.key==='Enter'){if(composing||e.isComposing||e.keyCode===229||Date.now()-compositionEnd<80){e.stopPropagation();return;}if(!e.shiftKey){e.preventDefault();e.stopPropagation();if(!e.repeat){getSession()?.setDrawingNote?.(input.value);$('drawingSave').click();}}}});
 on(win,'keydown',e=>{if(e.code==='F11'){e.preventDefault();hostAction('fullscreen');}else if(e.key==='Escape'&&!e.defaultPrevented&&!getState().drawings?.draft&&!getState().comments?.draft){if(settingsOpen){toggleSettings(false);e.preventDefault();}else if(recordsOpen){toggleRecords();e.preventDefault();}}});
 const deleteBox=make('section','shell-delete-confirm'),deleteText=make('p',''),deleteSave=make('button','','确认删除'),deleteCancel=make('button','','取消');deleteBox.append(deleteText,deleteSave,deleteCancel);deleteBox.hidden=true;info.append(deleteBox);
 const cancelDelete=()=>{const s=getState(),d=s.drawings?.draft?.kind==='delete'?s.drawings.draft:s.comments?.draft;if(!d||!['editing','failed','pausing','obsolete','choosing'].includes(d.status))return;if(s.drawings?.draft?.kind==='delete')getSession()?.cancelDrawing?.();else getSession()?.cancelComment?.();};
 deleteCancel.onclick=cancelDelete;deleteSave.onclick=()=>{const s=getState();if(s.drawings?.draft?.kind==='delete')$('drawingSave').click();else $('commentSave').click();};
 on(win,'keydown',e=>{if(e.key==='Escape'&&(getState().drawings?.draft?.kind==='delete'||getState().comments?.draft?.kind==='delete')){cancelDelete();e.preventDefault();}},true);
 function updateDeletion(s){const drawing=s.drawings?.draft?.kind==='delete',d=drawing?s.drawings.draft:s.comments?.draft?.kind==='delete'?s.comments.draft:null;data(workspace,'deleting',!!d);set(deleteBox,'hidden',!d);if(!d)return;if(!recordsOpen){recordsOpen=true;layout();renderRecords();}if(deleteBox.parentNode!==info)info.append(deleteBox);for(const n of info.children)n.hidden=n!==deleteBox;deleteText.textContent=d.message||'确认删除这条标注？';deleteSave.textContent=d.status==='unknown'?'核对删除结果':'确认删除';deleteSave.disabled=!['editing','failed','unknown'].includes(d.status);deleteCancel.disabled=!['editing','failed','pausing','obsolete','choosing'].includes(d.status);}
 let toolGeometry='';
 function positionTools(){const active=!toolPanel.hidden,key=[active,win.innerHeight,win.innerWidth].join(':');if(key===toolGeometry)return;toolGeometry=key;data(workspace,'toolrail',active);dock.style.removeProperty('top');dock.style.removeProperty('transform');if(!active)return;const top=dock.getBoundingClientRect().top;toolPanel.style.top='auto';toolPanel.style.bottom=(win.innerHeight-top+8)+'px';toolPanel.style.setProperty('--toolrail-height',Math.max(40,top-60)+'px');}
 on(win,'resize',positionTools);
 function update(s){settingsView.update();positionTools();updateToasts(s);strip?.update();set(title,'textContent',s.source?.name||'逐帧观察');if(epoch!==s.epoch){epoch=s.epoch;selected=null;listRef=null;release();settingsOpen=false;layout();}
  const loop=s.playback?.transport?.loop,nextLoop=loop?.enabled&&loop.valid?[loop.startOrdinal,loop.endOrdinal].join(':'):'';
  if(listRef!==s.comments?.items||loopKey!==nextLoop){const changed=loopKey!==null&&loopKey!==nextLoop;loopKey=nextLoop;listRef=s.comments?.items;release();groups=groupItems(s);if(changed)list.scrollTop=0;if(!groups.some(g=>g.key===selected))selected=null;selectedInfo();renderRecords();if(changed&&recordsOpen&&!win.matchMedia('(prefers-reduced-motion: reduce)').matches)list.animate?.([{opacity:.15,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:180,easing:'ease-out'});}
  const d=s.drawings?.draft,active=!!d&&d.kind!=='delete'&&d.status!=='pausing';set(editor,'hidden',!active);data(workspace,'annotating',active);set(buttons.note,'disabled',!!s.comments?.draft||!['paused','playing'].includes(s.state));for(const b of [buttons.selection,buttons.records,buttons.settings])set(b,'disabled',!!d||!!s.comments?.draft);for(const entry of live.values())set(entry.button,'disabled',!!d||!!s.comments?.draft);
  if(active){reveal();const parent=recordsOpen?info:pane;editor.classList.toggle('in-records',recordsOpen);if(editor.parentNode!==parent)parent.append(editor);info.classList.toggle('is-editing',recordsOpen);for(const n of info.children)if(n!==editor)n.hidden=recordsOpen;const key=s.epoch+':'+d.id;if(key!==draftId){draftId=key;input.value=d.noteText||'';input.focus();}const ck=key+JSON.stringify(d.noteChoices||[]);if(choicesKey!==ck){choicesKey=ck;choice.replaceChildren(new Option('选择要修改的文字',''),...(d.noteChoices||[]).map(n=>new Option(n.text,n.id)));}choice.value=d.noteOriginal?.id||'';choice.hidden=(d.noteChoices?.length||0)<2;choice.disabled=!!d.noteDirty&&!!d.noteOriginal;set(input,'readOnly',!['editing','failed'].includes(d.status));if(!composing)set(input,'value',d.noteText||'');set(message,'textContent',d.message||'');save.hidden=d.status!=='unknown';}
  else{if(editor.parentNode===info)pane.append(editor);if(info.classList.contains('is-editing'))info.classList.remove('is-editing');for(const n of info.children)if(n!==deleteBox)set(n,'hidden',false);draftId=null;hide();}if(s.comments?.draft&&settingsOpen)toggleSettings(false);updateDeletion(s);
 }
 return{update,records:toggleRecords,blocked:()=>settingsOpen||composing||Date.now()-compositionEnd<80,destroy(){endHeaderDrag();delete workspace.dataset.toolrail;clearTimeout(headerTimer);for(const v of toastState.values())clearTimeout(v.timer);headerEdge.remove();delete workspace.dataset.fullscreen;delete workspace.dataset.headerOpen;strip?.destroy();disposed=true;clearTimeout(thumbTimer);clearTimeout(hideTimer);clearTimeout(scrollTimer);release();listeners.forEach(fn=>fn());settingsView.destroy();for(const {n,parent,next}of restore.reverse())parent.insertBefore(n,next?.parentNode===parent?next:null);settingsHeading.remove();help.remove();while(settings.firstChild)settingsSource.append(settings.firstChild);settings.remove();delete workspace.dataset.graphite;delete workspace.dataset.records;delete workspace.dataset.annotating;[header,edge,dock,records,guide,editor,alerts].forEach(n=>n.remove());}};
}
root.EVAGraphite={createShell};
})(typeof window==='object'?window:globalThis);
