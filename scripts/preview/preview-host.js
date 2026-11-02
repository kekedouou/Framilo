/* Development only. No Node bridge, filesystem, Eagle data, native decoding or real performance claims. */
(async()=>{'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x)), source={id:'preview-synthetic',name:'Framilo · 合成交互样本',filePath:'/sample.mp4',sha256:'e'.repeat(64)},libraryPath='/preview-only';
 const frames=Array.from({length:360},(_,id)=>({id,time:id/30,end:(id+1)/30,file:'sample.mp4',bytes:1}));
 const defaults=()=>({comments:[{id:'sample-1',time:1,text:'观察运动方向'},{id:'sample-2',time:4,text:'同帧文字与圈画可一起编辑'},{id:'sample-3',time:8,text:'检查片段范围和记录切换'}],records:[],quality:'720p',ramMiB:1024,interaction:PreviewModules.load('preferences.cjs').DEFAULT_INTERACTION,visible:true,styles:EVADrawingModel.defaultStyles(),version:0});
 const scenario=new URLSearchParams(location.search).get('scenario'),dense=scenario==='dense',storageKey='motionote-ui-preview-v1'+(scenario?'-'+scenario:'');
 const sample=()=>{const value=defaults();if(dense)value.comments.splice(2,0,{id:'dense-same',time:4,text:'同帧：检查亮部边缘'},{id:'dense-1',time:4+1/30,text:'运动开始扩散'},{id:'dense-2',time:4+2/30,text:'轮廓变化'},{id:'dense-3',time:4.1,text:'拖尾开始消失'});return value;};
 let data;try{data=JSON.parse(sessionStorage.getItem(storageKey))||sample();}catch(_){data=sample();}
 const persist=()=>sessionStorage.setItem(storageKey,JSON.stringify(data));
 let ui,session;
 const bar=document.createElement('aside');bar.setAttribute('aria-label','开发预览状态');bar.style.cssText='position:fixed;top:8px;left:170px;z-index:90;color:#a6b7c5;font:11px sans-serif;display:flex;gap:12px;align-items:center;';
 const label=document.createElement('span');label.textContent='交互预览 · 示例数据';label.title='正式UI与Session；浏览器样本播放。不能验证原生编解码、帧精度、性能或Eagle保存。';
 const reset=document.createElement('button');reset.textContent='重置示例';reset.onclick=async()=>{if(session.hasDrawingDraft()&&!await ui.confirmDrawingExit())return;await session.close();sessionStorage.removeItem(storageKey);location.reload();};if(dense)label.textContent='交互预览 · 密集标注示例';bar.append(label,reset);document.body.append(bar);
 ui=EVAUI.createUI({hostAction:async action=>{if(action==='fullscreen'){if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}else label.textContent='预览不支持原生窗口操作；请在Eagle中体验';}});
 document.addEventListener('fullscreenchange',()=>{document.documentElement.dataset.evaFullscreen=String(!!document.fullscreenElement);dispatchEvent(new Event('eva-fullscreen-change'));});
 // Host-specific controls have no simulated success path.
 for(const id of ['gpuAcceleration','cacheClearOther']){const node=document.getElementById(id);if(node){node.dataset.previewUnsupported='true';node.title='此项需在Eagle中验证';}}
 for(const label of ['最小化','关闭']){const node=document.querySelector('.shell-header button[aria-label="'+label+'"]');if(node){node.dataset.previewUnsupported='true';node.title='此项需在Eagle中验证';}}
 const disableNative=()=>{for(const node of document.querySelectorAll('[data-preview-unsupported]'))node.disabled=true;};
 const preferences={snapshot:()=>({ramMiB:data.ramMiB,ramBytes:data.ramMiB*1024**2,compressedRamBytes:data.ramMiB*1024**2/8,totalRamBytes:8*1024**3,optionsMiB:[512,1024,2048,4096],persisted:true}),quality:()=>data.quality,backend:()=> 'proxy',interaction:()=>data.interaction,forwardPredecode:()=>true,gpuAcceleration:()=>false,proxyEncoder:()=> 'cpu',decoderPreference:()=> 'prefer-software',gpuDrawing:()=>false,automaticProxy:()=>false,proxyDiskGiB:()=>5,
   preview:ramMiB=>({...preferences.snapshot(),ramMiB,ramBytes:ramMiB*1024**2}),save:(ramMiB,quality=data.quality,predecode=true,interaction=data.interaction)=>{data.ramMiB=ramMiB;data.quality=quality;data.interaction=interaction;persist();return preferences.snapshot();}};
 const store={read:()=>({records:clone(data.records),token:String(data.version)}),save:(_binding,records,token)=>{if(token!==String(data.version))throw Error('预览记录已经变化');data.records=clone(records);data.version++;persist();return store.read();},readVisibility:()=>({visible:data.visible,token:'preview'}),saveVisibility:visible=>{data.visible=visible;persist();return store.readVisibility();},readStyles:()=>({styles:data.styles,token:'preview'}),saveStyles:styles=>{data.styles=clone(styles);persist();return store.readStyles();}};
 const adapter={captureSelected:async()=>{if(scenario==='unsupported')throw Object.assign(Error('unsupported preview fixture'),{code:'SELECTION_NOT_MP4'});return {...source};},drawingLibrary:()=>libraryPath,readComments:async()=>({libraryPath,items:clone(data.comments)}),saveComment:async draft=>{
   const id=draft.original?.id||crypto.randomUUID();if(draft.kind==='delete')data.comments=data.comments.filter(n=>n.id!==id);else if(draft.original)data.comments=data.comments.map(n=>n.id===id?{...n,text:draft.text}:n);else data.comments.push({id,time:draft.time,text:draft.text});persist();
   const read=await adapter.readComments();return{status:'saved',items:read.items,commentId:id,message:'示例标注已保存。'};
 }};
 session=PreviewModules.load('session.cjs').createSession({eagleAdapter:adapter,annotationStore:store,memoryPreferences:preferences,
   media:{prepare:async(_source,opts)=>({source:{...source,itemId:source.id},duration:12,width:640,height:360,frames,preview:PreviewModules.load('preview-profile.cjs').dimensions({width:640,height:360},opts.previewQuality)})},
   cache:{readAsset:async()=>{throw Error('预览不读取本机素材');},release:async()=>{},clearOther:async()=>{throw Error('预览没有磁盘缓存');}},
   createPlayer:opts=>new PreviewPlayer({...opts,canvas:ui.canvas}),onChange:value=>{ui.update(value);disableNative();}
 });
 ui.bindSession(session);window.MotionotePreview={session,source:'production Session + UI / browser media adapter'};
 window.addEventListener('beforeunload',event=>{if(session.hasDrawingDraft()){event.preventDefault();event.returnValue='';}});
 await session.loadSelected();disableNative();
})().catch(error=>{const node=document.getElementById('error');node.hidden=false;node.textContent='交互预览未启动：'+error.message;console.error(error);});
