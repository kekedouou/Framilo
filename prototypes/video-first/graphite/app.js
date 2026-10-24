/* UI-01 only. No Eagle, media preparation, formal settings or network writes. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id), root = $('viewer');
  let model = VFModel.createModel(), aspect = 'wide', drawingTool = 'pen', color = '#edf0ee', width = .003;
  let pointer = null, pendingObject = null, dockTimer, noticeTimer, noticeFade, rateTimer, holdTimer;
  let frameRequest = 0, lastTick = 0, recordsKey = '', markerKey = '', editorKey = '', composing = false, compositionEnd = 0;
  let dockHover = false, fault = 'none', confirmJob = null, wheelOrigin = null, wheelSelection = null, wheelLevel = 'root', canvasTextPoint=null;
  const defaults = { glassOpacity: .2, blur: 22, panelWidth: 288, radius: 3, hideDelay: 650, editorHeight: 82 };
  const ranges = { glassOpacity: [.08,.55], blur: [0,36], panelWidth: [220,360], radius: [0,8], hideDelay: [150,1800], editorHeight: [48,128] };
  let params = { ...defaults };
  const rect = el => { const b = el.getBoundingClientRect(); return { x:b.x,y:b.y,width:b.width,height:b.height }; };
  const state = () => model.state;
  const editableTarget = el => !!el?.closest('textarea,input,select,[contenteditable="true"]');
  const icon = name => { const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'), use = document.createElementNS(svg.namespaceURI,'use'); use.setAttribute('href','#i-'+name); svg.appendChild(use); return svg; };
  function tellParent() { if (parent !== window) parent.postMessage({ type:'vf-state',params:{...params},aspect,mode:state().mode },location.origin); }
  function setParams(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some(k => !ranges[k] || typeof p[k] !== 'number' || !Number.isFinite(p[k]) || p[k]<ranges[k][0] || p[k]>ranges[k][1])) return false;
    params = { ...params,...p };
    const styles = { '--glass-alpha':params.glassOpacity,'--glass-blur':params.blur+'px','--panel-width':params.panelWidth+'px','--radius':params.radius+'px','--editor-height':params.editorHeight+'px' };
    for (const [k,v] of Object.entries(styles)) root.style.setProperty(k,String(v));
    layout(); tellParent(); return true;
  }
  function setAspect(value) { if (!['wide','portrait','square'].includes(value)) return false; aspect=value; recordsKey=''; layout(); render(); return true; }
  function layout() {
    const b=$('mediaRegion').getBoundingClientRect(), ratio=aspect==='portrait'?9/16:aspect==='square'?1:16/9;
    const w=Math.max(1,Math.min(b.width,b.height*ratio)), h=w/ratio;
    $('scene').style.width=w+'px'; $('scene').style.height=h+'px'; redraw();
  }
  function shownObjects() {
    const s=state();
    if (s.draft) return pendingObject ? [...s.draft.objects,pendingObject] : s.draft.objects;
    return s.records.filter(r=>Math.abs(r.frame-s.frame)<=2).flatMap(r=>r.objects);
  }
  function redraw() { VFScene.draw($('scene'),{frame:state().frame,count:state().count,aspect,objects:shownObjects(),editing:state().mode==='annotation'}); }
  function revealDock() { clearTimeout(dockTimer); root.dataset.dock='true'; }
  function hideDockSoon() {
    clearTimeout(dockTimer); dockTimer=setTimeout(()=>{
      if (dockHover || pointer || state().mode!=='watch' || state().settingsOpen || !$('contextWheel').hidden || $('dock').contains(document.activeElement)) return;
      root.dataset.dock='false';
    },params.hideDelay);
  }
  function notice(text,persistent=false) {
    clearTimeout(noticeTimer);clearTimeout(noticeFade);$('transientNotice').style.opacity='1';$('transientNotice').textContent=text;$('transientNotice').hidden=!text;
    if(text&&!persistent){noticeFade=setTimeout(()=>$('transientNotice').style.opacity='0',1800);noticeTimer=setTimeout(()=>$('transientNotice').hidden=true,1960);}
  }
  function rateFeedback() {clearTimeout(rateTimer);$('rateHint').value=String(Math.round(state().rate*100)/100)+'×';$('rateHint').hidden=false;rateTimer=setTimeout(()=>$('rateHint').hidden=true,850);}
  function updateTimeline() {
    const s=state(),at=s.frame/(s.count-1)*100,range=s.selection||s.loop;
    $('playhead').style.left=at+'%';$('timelineProgress').style.width=at+'%';$('timeline').setAttribute('aria-valuenow',String(s.frame));
    $('cacheStrip').hidden=!s.settings?.cache;
    root.dataset.loop=String(s.loop.enabled);
    for(const [id,endpoint] of [['headHandle','start'],['tailHandle','end']]) {
      $(id).hidden=range[endpoint]===null||range[endpoint]===undefined;
      if(!$(id).hidden)$(id).style.left=range[endpoint]/(s.count-1)*100+'%';
      $(id).dataset.active=String(s.selection?.active===endpoint);
    }
    $('loopBand').hidden=range.start===null||range.end===null;
    if(!$('loopBand').hidden){$('loopBand').style.left=Math.min(range.start,range.end)/(s.count-1)*100+'%';$('loopBand').style.width=Math.abs(range.end-range.start)/(s.count-1)*100+'%';}
    const key=s.records.map(r=>r.id+':'+r.frame).join('|');
    if(markerKey!==key){markerKey=key;$('timelineMarkers').replaceChildren();for(const record of s.records){const b=document.createElement('button');b.className='timeline-marker';b.dataset.recordId=record.id;b.dataset.frame=record.frame;b.style.left=record.frame/(s.count-1)*100+'%';b.setAttribute('aria-label','跳转标注画面');b.addEventListener('pointerdown',e=>e.stopPropagation());b.addEventListener('click',e=>{e.stopPropagation();if(s.mode==='watch'){model.seek(record.frame);s.selectedId=record.id;render();}});$('timelineMarkers').append(b);}}
  }
  function renderRecords() {
    const s=state(),key=aspect+JSON.stringify(s.records);
    if(key!==recordsKey){recordsKey=key;$('recordGrid').replaceChildren();for(const record of s.records){const b=document.createElement('button');b.className='record-card';b.dataset.recordId=record.id;b.setAttribute('aria-label',record.entries[0]?.text||'圈画标注');b.appendChild(VFScene.thumbnail(record.frame,record.objects,aspect));b.addEventListener('click',()=>{model.selectRecord(record.id);render();});$('recordGrid').appendChild(b);}}
    for(const b of $('recordGrid').children){b.setAttribute('aria-pressed',String(b.dataset.recordId===s.selectedId));b.disabled=s.mode!=='watch';}
    const found=s.records.find(r=>r.id===s.selectedId);$('selectedInfo').replaceChildren();
    const summary=document.createElement('p');summary.className='record-summary';summary.textContent=found?(found.entries.map(e=>e.text).join(' / ')||'圈画标注'):'选一张画面，回看观察';$('selectedInfo').append(summary);
    if(found){const actions=document.createElement('div');actions.className='selected-actions';const edit=document.createElement('button');edit.textContent='编辑';edit.addEventListener('click',()=>beginAnnotation(found.id));const del=document.createElement('button');del.textContent='删除';del.addEventListener('click',()=>confirm('删除这帧的示例标注？',()=>{s.records.splice(s.records.indexOf(found),1);s.selectedId=null;render();},null));actions.append(edit,del);$('selectedInfo').appendChild(actions);}
  }
  function render() {
    const s=state();if(!s.settings)s.settings={cache:false,quality:'1080p',ram:1024,predecode:true};
    const prevReserve=root.dataset.records;root.dataset.records=String(s.recordsOpen);root.dataset.mode=s.mode;
    $('recordsPanel').hidden=!s.recordsOpen;$('settingsPopover').hidden=!s.settingsOpen;$('annotationEditor').hidden=s.mode!=='annotation';
    document.querySelector('[data-action="annotation"]').setAttribute('aria-pressed',String(s.mode==='annotation'));
    document.querySelector('[data-action="clip"]').setAttribute('aria-pressed',String(s.mode==='selection'||s.loop.enabled));
    for(const name of ['records','settings'])document.querySelector('[data-action="'+name+'"]').setAttribute('aria-expanded',String(s[name+'Open']));
    for(const b of $('dock').querySelectorAll('button'))b.disabled=s.mode!=='watch'&&b.dataset.action!==(s.mode==='annotation'?'annotation':'clip');
    $('modeHint').hidden=s.mode!=='selection';
    if(s.selection)$('modeHint').textContent='选择片段'+(s.selection.active==='end'?'尾部':'头部')+' · R / 右键确认 · Esc取消';
    if(s.mode==='annotation'){
      const d=s.draft,key=d.frame+':'+d.recordId+':'+d.entryId;
      if(editorKey!==key){editorKey=key;$('annotationInput').value=d.text;}
      $('annotationInput').disabled=d.status==='unknown';$('saveStatus').hidden=!d.message;$('saveStatus').textContent=d.message;$('checkSave').hidden=d.status!=='unknown';
      const choice=$('entryChoice');choice.hidden=d.entryChoices.length<2;
      if(!choice.hidden){const keys=d.entryChoices.map(e=>e.id).join('|');if(choice.dataset.keys!==keys){choice.dataset.keys=keys;choice.replaceChildren(new Option('选择要编辑的文字',''),...d.entryChoices.map(e=>new Option(e.text.slice(0,16),e.id)));}choice.value=d.entryId||'';}
      const names={pen:'手写',arrow:'箭头',rect:'矩形',ellipse:'椭圆',text:'画面文字',eraser:'橡皮'};$('toolHint').textContent=names[drawingTool]+' · 滚轮调整'+(drawingTool==='eraser'?'大小':'粗细');
    }else editorKey='';
    $('quality').value=s.settings.quality;$('cacheToggle').checked=s.settings.cache;$('ram').value=s.settings.ram;$('predecode').checked=s.settings.predecode;
    renderRecords();updateTimeline();if(prevReserve!==root.dataset.records)requestAnimationFrame(layout);else redraw();
    if(s.mode!=='watch'||s.settingsOpen)revealDock();else hideDockSoon();tellParent();
  }
  function beginAnnotation(recordId,entryId){if(model.beginAnnotation(recordId,entryId)){notice('');render();requestAnimationFrame(()=>$('annotationInput').focus());}}
  function saveAnnotation(){if(composing||performance.now()-compositionEnd<80)return;commitCanvasText();model.updateText($('annotationInput').value);const result=model.saveDraft(fault);fault='none';if(result==='saved'||result==='cancelled'){$('viewer').focus();notice(result==='saved'?'已保存':'');}render();}
  function cancelAnnotation(){const result=model.cancelDraft();if(result==='confirm')confirm('这次标注尚未保存。',()=>{model.cancelDraft(true);render();},saveAnnotation);else if(result==='blocked')notice('请先核对保存结果',true);render();}
  function confirm(message,discard,save){confirmJob={discard,save};$('confirmMessage').textContent=message;$('confirmSave').hidden=!save;$('confirmDiscard').textContent=save?'放弃':'删除';$('confirmDialog').showModal();}
  function clipAction(){if(state().mode==='selection')model.finishSelection();else model.beginSelection();notice('');render();}
  function toggleLoop(){if(!model.toggleLoop())notice('请先选择循环片段');else notice(state().loop.enabled?'循环开启':'循环关闭');render();}
  function act(action){closeWheel();if(action==='annotation'){if(state().mode==='annotation')saveAnnotation();else beginAnnotation();}else if(action==='clip')clipAction();else if(action==='records'){model.toggleRecords();render();}else if(action==='settings'){state().settingsOpen?model.closeSettings():model.openSettings();render();}}
  $('dock').addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(action)act(action);});
  $('edgeTrigger').addEventListener('pointerenter',()=>{dockHover=true;revealDock();});$('edgeTrigger').addEventListener('pointerleave',()=>{dockHover=false;hideDockSoon();});
  $('dock').addEventListener('pointerenter',()=>{dockHover=true;revealDock();});$('dock').addEventListener('pointerleave',()=>{dockHover=false;hideDockSoon();});$('dock').addEventListener('focusin',revealDock);$('dock').addEventListener('focusout',hideDockSoon);
  root.addEventListener('click',e=>{const close=e.target.closest('[data-close]')?.dataset.close;if(close==='records'){model.toggleRecords();render();}if(close==='settings'){model.closeSettings();render();}if(close==='annotation')cancelAnnotation();});
  $('annotationInput').addEventListener('input',()=>model.updateText($('annotationInput').value));$('annotationInput').addEventListener('compositionstart',()=>composing=true);$('annotationInput').addEventListener('compositionend',()=>{composing=false;compositionEnd=performance.now();model.updateText($('annotationInput').value);});
  $('entryChoice').addEventListener('change',()=>{model.chooseEntry($('entryChoice').value);render();});$('checkSave').addEventListener('click',()=>{model.checkDraft();render();});
  $('quality').addEventListener('change',()=>state().settings.quality=$('quality').value);$('cacheToggle').addEventListener('change',()=>{state().settings.cache=$('cacheToggle').checked;updateTimeline();});$('ram').addEventListener('change',()=>state().settings.ram=Number($('ram').value));$('predecode').addEventListener('change',()=>state().settings.predecode=$('predecode').checked);$('clearDemoCache').addEventListener('click',()=>notice('示例缓存已清理'));
  function showGuide(){model.closeSettings();$('guide').hidden=false;revealDock();render();}function dismissGuide(){$('guide').hidden=true;try{localStorage.setItem('vf-ui05-guide','seen');}catch(_){}hideDockSoon();}
  $('showGuide').addEventListener('click',showGuide);$('dismissGuide').addEventListener('click',dismissGuide);
  $('confirmBack').addEventListener('click',()=>$('confirmDialog').close());$('confirmDiscard').addEventListener('click',()=>{$('confirmDialog').close();confirmJob?.discard();});$('confirmSave').addEventListener('click',()=>{$('confirmDialog').close();confirmJob?.save?.();});
  function point(e){const b=$('scene').getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-b.x)/b.width)),y:Math.max(0,Math.min(1,(e.clientY-b.y)/b.height))};}
  function frameAt(e){const b=$('timeline').getBoundingClientRect();return Math.round(Math.max(0,Math.min(1,(e.clientX-b.left)/b.width))*(state().count-1));}
  function startPointer(e,kind,extra={}){pointer={id:e.pointerId,x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,frame:state().frame,rate:state().rate,kind,axis:null,moved:false,...extra};revealDock();}
  $('timeline').addEventListener('pointerdown',e=>{if(e.button!==0||state().mode==='annotation'||state().settingsOpen)return;e.preventDefault();let endpoint=e.target.closest('.range-handle')?.id==='headHandle'?'start':e.target.closest('.range-handle')?.id==='tailHandle'?'end':state().selection?.active;if(endpoint&&state().selection)model.controlEndpoint(endpoint);startPointer(e,'timeline',{endpoint:endpoint||'start'});moveTimeline(e);});
  function moveTimeline(e){if(state().mode==='selection')model.setEndpoint(frameAt(e),pointer.endpoint);else model.seek(frameAt(e));updateTimeline();redraw();}
  $('scene').addEventListener('pointerdown',e=>{
    if(e.button===2){e.preventDefault();if(state().settingsOpen||state().draft?.status==='unknown')return;startPointer(e,'right');wheelOrigin={x:e.clientX,y:e.clientY};wheelLevel='root';holdTimer=setTimeout(()=>openWheel(wheelOrigin.x,wheelOrigin.y),420);return;}
    if(e.button!==0||state().settingsOpen)return;e.preventDefault();root.focus();
    if(state().mode==='annotation'){
      if(state().draft.status==='unknown')return;
      const p=point(e);startPointer(e,'draw',{start:p});
      if(drawingTool==='eraser'){model.beginErase();model.eraseAt(p.x,p.y,width*8);render();return;}
      if(drawingTool==='text'){canvasTextPoint=p;$('canvasText').value='';$('canvasText').style.left=Math.min(innerWidth-240,Math.max(16,e.clientX))+'px';$('canvasText').style.top=Math.min(innerHeight-56,e.clientY)+'px';$('canvasText').hidden=false;pointer=null;$('canvasText').focus();return;}
      pendingObject=drawingTool==='pen'?{type:'pen',color,width,points:[p]}:{type:drawingTool,color,width,x:p.x,y:p.y,x2:p.x,y2:p.y};redraw();return;
    }
    startPointer(e,'left',{endpoint:state().selection?.active||'start'});holdTimer=setTimeout(()=>{if(pointer?.kind==='left'&&!pointer.moved){$('gestureWheel').hidden=false;$('gestureWheel').style.left=e.clientX+'px';$('gestureWheel').style.top=e.clientY+'px';}},420);
  });
  root.addEventListener('contextmenu',e=>{if(!editableTarget(e.target))e.preventDefault();});
  window.addEventListener('pointermove',e=>{
    if(!pointer||e.pointerId!==pointer.id)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    pointer.moved=pointer.moved||Math.hypot(dx,dy)>6;
    if(pointer.kind==='timeline')moveTimeline(e);
    else if(pointer.kind==='draw'){
      const p=point(e);if(drawingTool==='eraser')model.eraseAt(p.x,p.y,width*8);
      else if(pendingObject?.type==='pen'){if(pendingObject.points.length<2048)pendingObject.points.push(p);}else if(pendingObject){pendingObject.x2=p.x;pendingObject.y2=p.y;}redraw();
    }else if(pointer.kind==='left'&&pointer.moved){
      clearTimeout(holdTimer);$('gestureWheel').hidden=true;pointer.axis=pointer.axis||(Math.abs(dx)>Math.abs(dy)?'x':'y');const gain=e.shiftKey?2:(e.ctrlKey ? .5 : 1);
      if(pointer.axis==='x'){const target=pointer.frame+dx/Math.max(1,$('scene').getBoundingClientRect().width)*state().count*gain;if(state().mode==='selection')model.setEndpoint(target,pointer.endpoint);else model.seek(target);}
      else if(state().mode==='watch'){state().rate=Math.max(.1,Math.min(4,Math.round((pointer.rate-dy/140*gain)*10)/10));rateFeedback();}
      updateTimeline();redraw();
    }else if(pointer.kind==='right'&&Math.hypot(dx,dy)>20){clearTimeout(holdTimer);if($('contextWheel').hidden)openWheel(wheelOrigin.x,wheelOrigin.y);selectWheel(e.clientX,e.clientY);}
    pointer.lastX=e.clientX;pointer.lastY=e.clientY;
  });
  window.addEventListener('pointerup',e=>{
    if(!pointer||e.pointerId!==pointer.id)return;const p=pointer;clearTimeout(holdTimer);$('gestureWheel').hidden=true;
    if(p.kind==='right'){
      const menuShown=!$('contextWheel').hidden,command=wheelSelection;pointer=null;
      if(menuShown){if(command)wheelCommand(command);else closeWheel();}
      else if(state().mode==='annotation')saveAnnotation();else if(state().mode==='selection'){model.finishSelection();render();}
    }else{
      if(p.kind==='draw'){model.endErase();if(pendingObject){model.addObject(pendingObject);pendingObject=null;}}
      if(p.kind==='left'&&!p.moved){if(state().mode==='watch')model.togglePlay();else if(state().mode==='selection')model.setEndpoint(state().frame,p.endpoint);}
      if((p.kind==='timeline'||p.kind==='left')&&state().selection&&p.endpoint==='start'&&state().selection.start!==null&&state().selection.end===null)state().selection.active='end';
      pointer=null;render();
    }hideDockSoon();
  });
  function cancelPointer(){clearTimeout(holdTimer);model.endErase();pendingObject=null;pointer=null;$('gestureWheel').hidden=true;closeWheel();redraw();hideDockSoon();}
  window.addEventListener('pointercancel',cancelPointer);window.addEventListener('blur',cancelPointer);
  $('scene').addEventListener('wheel',e=>{e.preventDefault();if(state().mode==='annotation'){width=Math.max(.001,Math.min(.025,width+(e.deltaY>0?-.001:.001)));render();}else if(state().mode==='selection'){model.setEndpoint(state().frame+(e.deltaY>0?1:-1));render();}else if(!state().settingsOpen){model.seek(state().frame+(e.deltaY>0?1:-1));render();}},{passive:false});
  const typeItems=[{id:'pen',label:'手写',icon:'pen'},{id:'arrow',label:'箭头',icon:'arrow'},{id:'rect',label:'矩形',icon:'rect'},{id:'ellipse',label:'椭圆',icon:'ellipse'},{id:'text',label:'文字',icon:'text'}];
  const swatches=['#edf0ee','#9abbd5','#a7c1a0','#dba5a2','#c1acd6'];
  function wheelItems(){
    if(state().mode==='annotation')return[{id:'types',label:'类型',icon:'shapes'},{id:'undo',label:'撤销',icon:'undo'},{id:'eraser',label:'橡皮',icon:'eraser'},{id:'colors',label:'颜色',icon:'palette'}];
    if(state().mode==='selection')return[{id:'none',label:'',icon:'clip'},{id:'start',label:'头部',icon:'start'},{id:'none',label:'',icon:'clip'},{id:'end',label:'尾部',icon:'end'}];
    return[{id:'annotation',label:'标注',icon:'pen'},{id:'clip',label:'片段',icon:'clip'},{id:'records',label:'记录',icon:'records'},{id:'loop',label:'循环',icon:'loop'}];
  }
  function polar(r,a){return[160+r*Math.cos(a*Math.PI/180),160+r*Math.sin(a*Math.PI/180)];}
  function sectorPath(inner,outer,start,end){const a=polar(outer,start),b=polar(outer,end),c=polar(inner,end),d=polar(inner,start);return `M${a} A${outer},${outer} 0 0 1 ${b} L${c} A${inner},${inner} 0 0 0 ${d} Z`;}
  function drawWheel(){
    const menu=$('contextWheel');menu.dataset.level=wheelLevel;menu.replaceChildren();
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 320 320');svg.classList.add('wheel-sectors');menu.append(svg);
    function add(item,inner,outer,angle,span,secondary=false){
      if(item.id==='none')return;
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',sectorPath(inner,outer,angle-span/2+1.2,angle+span/2-1.2));path.dataset.command=item.id;path.classList.add('wheel-sector');if(secondary)path.classList.add('secondary');svg.append(path);
      const b=document.createElement('button');b.className='radial-label';b.dataset.command=item.id;b.setAttribute('role','menuitem');b.setAttribute('aria-label',item.label);const at=polar((inner+outer)/2,angle);b.style.left=at[0]+'px';b.style.top=at[1]+'px';
      b.append(icon(item.icon||'palette'));const label=document.createElement('span');label.textContent=item.label;b.append(label);if(item.color)b.style.color=item.color;menu.append(b);
      const choose=()=>{if(item.id==='types'||item.id==='colors'){wheelLevel=item.id;wheelSelection=null;drawWheel();}else wheelCommand(item.id);};
      b.addEventListener('click',choose);path.addEventListener('click',choose);
      b.addEventListener('pointerenter',()=>{if(!pointer){if((item.id==='types'||item.id==='colors')&&wheelLevel!==item.id){wheelLevel=item.id;drawWheel();}highlightWheel(item.id);}});
      b.addEventListener('focus',()=>highlightWheel(item.id));
    }
    wheelItems().forEach((item,n)=>add(item,43,101,[-90,180,90,0][n],90));
    if(wheelLevel==='types')typeItems.forEach((item,n)=>add(item,106,155,-162+n*36,36,true));
    if(wheelLevel==='colors')swatches.forEach((c,n)=>add({id:'color:'+n,label:['白','蓝','绿','粉','紫'][n],color:c,icon:'dot'},106,155,-72+n*36,36,true));
    const center=document.createElement('button');center.className='wheel-center';center.setAttribute('aria-label','取消轮盘');center.innerHTML='<span>'+(state().mode==='annotation'?'圈画':state().mode==='selection'?'片段':'观察')+'</span><small>回中取消</small>';center.addEventListener('click',closeWheel);menu.append(center);highlightWheel(wheelSelection);
  }
  function highlightWheel(id){for(const child of $('contextWheel').querySelectorAll('[data-command]'))child.dataset.selected=String(child.dataset.command===id || (wheelLevel!=='root'&&child.dataset.command===wheelLevel));}
  function openWheel(x,y){const menu=$('contextWheel');menu.hidden=false;wheelSelection=null;const cx=Math.max(162,Math.min(innerWidth-162,x)),cy=Math.max(200,Math.min(innerHeight-162,y));menu.style.left=cx+'px';menu.style.top=cy+'px';drawWheel();revealDock();}
  function selectWheel(x,y){
    const b=$('contextWheel').getBoundingClientRect(),dx=x-b.left-b.width/2,dy=y-b.top-b.height/2,distance=Math.hypot(dx,dy),angle=Math.atan2(dy,dx)*180/Math.PI;
    if(distance<40){wheelSelection=null;if(wheelLevel!=='root'){wheelLevel='root';drawWheel();}highlightWheel(null);return;}
    if(distance>105&&wheelLevel==='types'){const i=Math.floor((angle+180)/36);wheelSelection=angle<0?typeItems[i]?.id:null;}
    else if(distance>105&&wheelLevel==='colors'){const i=Math.floor((angle+90)/36);wheelSelection=angle>=-90&&angle<90?'color:'+i:null;}
    else {const index=Math.abs(dx)>Math.abs(dy)?dx>0?3:1:dy>0?2:0;const item=wheelItems()[index];wheelSelection=item.id==='none'?null:item.id;
      if(wheelSelection==='types'||wheelSelection==='colors'){if(wheelLevel!==wheelSelection){wheelLevel=wheelSelection;drawWheel();}wheelSelection=null;}
      else if(wheelLevel!=='root'){wheelLevel='root';drawWheel();}
    }highlightWheel(wheelSelection);
  }
  function closeWheel(){$('contextWheel').hidden=true;wheelSelection=null;wheelLevel='root';hideDockSoon();}
  function wheelCommand(id){
    if(id==='types'||id==='colors'){wheelLevel=id;drawWheel();return;}
    closeWheel();if(id.startsWith('color:')){color=swatches[Number(id.split(':')[1])]||color;render();}
    else if(['pen','arrow','rect','ellipse','text','eraser'].includes(id)){drawingTool=id;render();}else if(id==='undo'){model.undoObject();render();}else if(id==='start'||id==='end'){model.controlEndpoint(id);render();}else if(id==='loop')toggleLoop();else act(id);
  }

  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await root.requestFullscreen();}catch(_){notice('请在独立预览窗口中使用全屏');}}
  $('fullscreen').addEventListener('click',fullscreen);$('maximizeWindow').addEventListener('click',fullscreen);$('minimizeWindow').addEventListener('click',()=>notice('隔离样稿：最小化需接入 Eagle 窗口'));$('closeWindow').addEventListener('click',()=>notice('隔离样稿：关闭需接入 Eagle 窗口'));
  function commitCanvasText(){const p=canvasTextPoint;if(!p)return;canvasTextPoint=null;const text=$('canvasText').value;$('canvasText').hidden=true;if(text.trim())model.addObject({type:'text',x:p.x,y:p.y,x2:p.x+.15,y2:p.y+.06,text,color,width});redraw();}
  $('canvasText').addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Enter'){e.preventDefault();e.stopPropagation();commitCanvasText();root.focus();}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();canvasTextPoint=null;$('canvasText').hidden=true;root.focus();}});
  $('canvasText').addEventListener('blur',commitCanvasText);
  window.addEventListener('keydown',e=>{
    if(e.isComposing||composing||performance.now()-compositionEnd<80)return;
    if(e.code==='F11'){e.preventDefault();fullscreen();return;}
    if(e.key==='Escape'){if(!$('confirmDialog').open){if(!$('contextWheel').hidden)closeWheel();else if(state().mode==='annotation')cancelAnnotation();else if(state().mode==='selection'){model.cancelSelection();render();}else if(state().settingsOpen){model.closeSettings();render();}else if(!$('guide').hidden)dismissGuide();else if(state().recordsOpen){model.toggleRecords();render();}}return;}
    if(editableTarget(e.target)){if(e.key==='Enter'&&!e.shiftKey&&e.target===$('annotationInput')){e.preventDefault();saveAnnotation();}return;}
    if(e.repeat||$('confirmDialog').open)return;
    const k=e.key.toLowerCase();
    if((e.ctrlKey||e.metaKey)&&k==='z'&&state().mode==='annotation'){e.preventDefault();model.undoObject();render();return;}
    if(k==='n'||k==='d'){e.preventDefault();if(state().mode==='annotation'){if(k==='d')saveAnnotation();else $('annotationInput').focus();}else beginAnnotation();}
    else if(k==='r'){e.preventDefault();clipAction();}
    else if(k==='l'){e.preventDefault();toggleLoop();}
    else if(k===' '){e.preventDefault();model.togglePlay();render();}
    else if(e.key==='Enter'&&state().mode==='annotation'){e.preventDefault();saveAnnotation();}
    else if(['[',']','【','】','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const n=['[','【','ArrowLeft'].includes(e.key)?-1:1;if(state().mode==='selection')model.setEndpoint(state().frame+n);else model.seek(state().frame+n);render();}
    else if(['ArrowUp','ArrowDown'].includes(e.key)&&state().mode==='watch'){e.preventDefault();state().rate=Math.max(.1,Math.min(4,Math.round((state().rate+(e.key==='ArrowUp'?.1:-.1))*10)/10));rateFeedback();}
  });
  document.addEventListener('pointerdown',e=>{if(!$('contextWheel').hidden&&!$('contextWheel').contains(e.target)){e.preventDefault();e.stopPropagation();closeWheel();return;}if(state().settingsOpen&&!$('settingsPopover').contains(e.target)&&!$('dock').contains(e.target)){e.preventDefault();e.stopPropagation();model.closeSettings();render();}},true);
  const observer=new ResizeObserver(layout);observer.observe($('mediaRegion'));
  function tick(at){if(!lastTick)lastTick=at;const changed=model.tick(Math.min(.08,(at-lastTick)/1000));lastTick=at;if(changed){redraw();updateTimeline();}frameRequest=requestAnimationFrame(tick);}
  document.addEventListener('visibilitychange',()=>lastTick=0);
  function reset(){cancelPointer();model=VFModel.createModel();recordsKey='';markerKey='';editorKey='';render();layout();}
  window.VFPreview={get model(){return model;},render,setParams,getParams:()=>({...params}),ranges,defaults,setAspect,reset,geometry:()=>({scene:rect($('scene')),mediaRegion:rect($('mediaRegion')),records:rect($('recordsPanel')),editor:rect($('annotationEditor'))}),setFault(value){if(['none','failed','partial','unknown'].includes(value))fault=value;},dismissGuide,showGuide};
  window.graphiteShowcase = async function(mode){
 reset();dismissGuide();model.state.playing=false;model.seek(96);
 if(mode==='records'){model.toggleRecords();model.selectRecord(model.state.records[1].id);}
 if(mode==='annotation'||mode==='types'){model.beginAnnotation();model.updateText('火焰边缘散开，主体轮廓开始消失。');}
 if(mode==='settings')model.openSettings();
 render();layout();root.dataset.dock='true';
 if(mode==='wheel'||mode==='types'){wheelOrigin={x:innerWidth*.52,y:innerHeight*.49};wheelLevel=mode==='types'?'types':'root';openWheel(wheelOrigin.x,wheelOrigin.y);highlightWheel(mode==='types'?'arrow':'annotation');}
 await new Promise(r=>setTimeout(r,180));return true;
 };
  setParams({});render();layout();frameRequest=requestAnimationFrame(tick);
  try{$('guide').hidden=localStorage.getItem('vf-ui05-guide')==='seen';}catch(_){$('guide').hidden=false;}
  window.DESIGN_READY=new Promise(resolve=>setTimeout(async()=>{const sample=new URLSearchParams(location.search).get('show');if(sample)await graphiteShowcase(sample);resolve(true);},100));
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(frameRequest);observer.disconnect();[dockTimer,noticeTimer,noticeFade,rateTimer,holdTimer].forEach(clearTimeout);});
})();
