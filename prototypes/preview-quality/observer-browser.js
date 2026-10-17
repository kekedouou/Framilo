/* Experimental controls; release packages stay frozen. Runtime copies follow the documented source revision. */
(function(){'use strict';
  const path=require('path');
  let toolRoot=null,observation=null,clip=null,qualityToken=0,opening=false,currentClose=null,checkRecorder=null;
  const bar=document.createElement('div');
  bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999;background:#303030;padding:6px;color:white;font:13px sans-serif;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
  bar.innerHTML='<strong>演进验证</strong><button id="evObserve">开始内存记录</button><button id="evStop" disabled>停止并保存</button><button id="evQuality">所选视频颜色对照</button><span id="evStatus">普通播放仍是720p JPEG；记录默认关闭</span><span id="evResources" style="width:100%" title="受管RAM是当前播放器缓存账目；进程内存还包含程序本身，不含共享Eagle/GPU，二者不能相加。">内存记录未开启</span>';
  document.body.prepend(bar);document.body.style.paddingTop='72px';
  const start=bar.querySelector('#evObserve'),stop=bar.querySelector('#evStop'),status=bar.querySelector('#evStatus'),resources=bar.querySelector('#evResources'),qualityButton=bar.querySelector('#evQuality');
  if(typeof eagle==='object'&&typeof eagle.onPluginCreate==='function')eagle.onPluginCreate(plugin=>{toolRoot=path.dirname(path.dirname(plugin.path));});
  const mib=value=>typeof value==='number'?(value/1024**2).toFixed(1)+'MiB':'—';
  function message(text){status.textContent=text;}
  async function stopObservation(){if(observation){const value=observation;observation=null;await value.stop();}start.disabled=!!currentClose;stop.disabled=true;}
  start.onclick=()=>{try{
    if(!toolRoot||!window.EVADiagnostics||currentClose)throw Error('请在普通720p播放器中开启内存记录');
    const {start:begin}=require(path.join(toolRoot,'observation.cjs'));let latest=null,system=null;
    function update(){resources.textContent='当前视频缓存：'+mib(latest&&latest.managedBytes)+' / '+mib(latest&&latest.managedLimit)+'；插件所属进程：'+mib(system&&system.pluginBytes)+'；媒体处理：'+mib(system&&system.preprocessingBytes)+'；记录工具：'+mib(system&&system.observerBytes)+'（每秒更新）';}
    observation=begin({snapshot:()=>window.EVADiagnostics.snapshot(),onStatus:value=>{
      if(value.state==='recording')message('每秒记录一次内存到本机；正常使用即可，无固定陪测时长');
      if(value.state==='sample'){latest=value.sample;update();}
      if(value.state==='resources'){system=value;update();}
      if(value.issue)message('记录停止：'+value.issue+'；播放不受影响');
      else if(value.state==='saved')message('内存记录已保存，交由Codex分析；不是长期验收结论');
    }});start.disabled=true;stop.disabled=false;
    observation.done.finally(()=>{start.disabled=!!currentClose;stop.disabled=true;});
  }catch(e){message(e.message);}};
  stop.onclick=()=>stopObservation().catch(e=>message(e.message));
  window.addEventListener('pagehide',()=>{if(observation)observation.stop();if(currentClose)currentClose();if(checkRecorder)try{checkRecorder.close();}catch(_){};});
  qualityButton.onclick=()=>openQuality().catch(e=>message(e.message));
  async function openQuality(){
    if(opening)return;opening=true;qualityButton.disabled=true;
    try{
      if(!toolRoot)throw Error('插件尚未就绪');
      const selected=await require(path.join(toolRoot,'../../plugin/eagle.cjs')).captureSelected(eagle),snapshot=window.EVADiagnostics&&window.EVADiagnostics.snapshot();
      const time=snapshot&&snapshot.source&&snapshot.source.id===selected.id&&snapshot.playback?snapshot.playback.time:0;
      await stopObservation();if(currentClose)await currentClose();
      if(typeof window.EVAEvolutionClose!=='function')throw Error('验证入口版本不匹配');
      const released=await window.EVAEvolutionClose();if(released&&released.status==='error')throw Error('普通播放器资源未释放');
      const fs=require('fs'),{sha,hashFile,identity}=require(path.join(toolRoot,'workspace.cjs')),index=require(path.join(toolRoot,'../../plugin/frame-index.cjs'));
      const profiles=require(path.join(toolRoot,'image-profiles.cjs')),nativeTool=require(path.join(toolRoot,'native-reference.cjs'));
      const panel=document.createElement('div');panel.id='evPanel';panel.style.cssText='position:fixed;inset:72px 0 0;z-index:998;background:#181818;color:#eee;padding:16px;overflow:auto;font:14px sans-serif';
      panel.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><strong id="evSource"></strong><select id="evFormat" disabled><option value="jpeg-fine">优化JPEG（候选）</option><option value="jpeg">原JPEG对照</option><option value="png">PNG诊断参考</option></select><button id="evReadSelected">读取Eagle当前选中视频</button><button id="evClose">返回普通播放器</button><button id="evCheck" disabled>重新核对颜色</button></div><p id="evScope">准备同一源片段的原JPEG、优化JPEG与PNG参考；普通播放仍720p。</p><p><label><input id="evNativeToggle" type="checkbox" disabled> 同帧原视频参考</label> <span id="evNativeState"></span></p><div id="evPictures" style="display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start"><div id="evNativeBox" hidden style="min-width:0"><p>原视频（浏览器直接显示）</p><canvas id="evNativeCanvas" style="display:none"></canvas><video id="evNative" muted playsinline style="display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:black;visibility:hidden"></video></div><div style="min-width:0"><p id="evCacheLabel">优化JPEG候选</p><canvas id="evCanvas" style="display:block;width:100%;height:auto"></canvas></div></div><input id="evRange" type="range" min="0" max="1" step="any" value="0" disabled style="width:100%"><p><button id="evPrev" disabled>上一帧【</button> <button id="evNext" disabled>下一帧】</button> <span id="evFrame"></span></p><p id="evMessage">准备中，随时可以返回或关闭。</p>';
      document.body.append(panel);start.disabled=true;stop.disabled=true;resources.textContent='仅比较短片颜色；普通播放器及内存记录已暂停';panel.querySelector('#evSource').textContent=selected.name;
      const canvas=panel.querySelector('#evCanvas'),range=panel.querySelector('#evRange'),state=panel.querySelector('#evMessage'),formatSelect=panel.querySelector('#evFormat');
      const nativeToggle=panel.querySelector('#evNativeToggle'),nativeVideo=panel.querySelector('#evNative'),nativeState=panel.querySelector('#evNativeState'),nativeCanvas=panel.querySelector('#evNativeCanvas');
      let data=null,local=null,currentFormat=null,ready=null,switching=false,checking=false,dragging=false,seekSerial=0,closingQuality=null,generator=null,dead=false,nativeRef=null,referenceSequence=0,nativeRequestKey=null,probeTask=null,probeEpoch=0;
      const checkedPacks=new Map(),fail=e=>{if(!dead)state.textContent=e.message;};
      function controls(enabled){range.disabled=!enabled;formatSelect.disabled=!enabled;nativeToggle.disabled=!enabled;for(const id of ['evPrev','evNext','evCheck'])panel.querySelector('#'+id).disabled=!enabled;}
      async function readFrame(format,ordinal){
        const display=data.displays.find(d=>d.format===format),part=display&&display.index[ordinal];if(!part)throw Error('无效图片候选或帧');
        const file=path.resolve(local.root,display.file);if(path.dirname(file)!==local.root)throw Error('图片包路径越界');const stamp=identity(file);
        if(!checkedPacks.has(file)){if(hashFile(file)!==display.sha256)throw Error('图片包核对失败');checkedPacks.set(file,JSON.stringify(stamp));}
        if(JSON.stringify(stamp)!==checkedPacks.get(file))throw Error('图片包身份已变化');
        if(part.bytes>8*1024**2)throw Error('单张JPEG/PNG超过本轮读取限制');
        const fd=await fs.promises.open(file,'r'),buffer=Buffer.alloc(part.bytes);
        try{let total=0;while(total<part.bytes){const r=await fd.read(buffer,total,part.bytes-total,part.offset+total);if(!r.bytesRead)throw Error('图片包不完整');total+=r.bytesRead;}}finally{await fd.close();}
        if(sha(buffer)!==part.sha256||JSON.stringify(identity(file))!==checkedPacks.get(file))throw Error('图片内容或身份变化');return buffer;
      }
      async function referenceFrame(ordinal,force=false){
        if(!nativeRef||dead||checking||switching||!Number.isInteger(ordinal)||ordinal<0||ordinal>=data.times.length)return;
        const token=qualityToken,ref=nativeRef,format=currentFormat,key=token+':'+format+':'+ordinal;if(!force&&nativeRequestKey===key)return;nativeRequestKey=key;const seq=++referenceSequence;
        const time=data.times[ordinal].time,end=ordinal+1<data.times.length?data.times[ordinal+1].time:Number(data.lastFrameEndTicks)*data.timeBase[0]/data.timeBase[1];
        nativeCanvas.style.visibility='hidden';nativeState.textContent='同帧对齐中……';
        try{const aligned=await ref.seek(time,end);
          if(aligned.cancelled||dead||token!==qualityToken||seq!==referenceSequence||nativeRef!==ref||currentFormat!==format||!clip||clip.snapshot().frameOrdinal!==ordinal)return;
          nativeTool.render(nativeVideo,nativeCanvas,data.width,data.height);nativeCanvas.style.visibility='visible';nativeState.textContent='已对齐源画面 '+time.toFixed(6)+' 秒；左右同尺寸显示';
        }catch(e){if(!dead&&token===qualityToken&&seq===referenceSequence){nativeRequestKey=null;nativeState.textContent=e.message;}}
      }
      function toggleReference(){
        if(nativeRef){nativeRef.dispose();nativeRef=null;}nativeRequestKey=null;++referenceSequence;
        panel.querySelector('#evNativeBox').hidden=!nativeToggle.checked;panel.querySelector('#evPictures').style.gridTemplateColumns=nativeToggle.checked?'minmax(0,1fr) minmax(0,1fr)':'minmax(0,1fr)';
        if(!nativeToggle.checked){nativeState.textContent='原视频参考已释放';return;}
        let unchanged=false;try{unchanged=JSON.stringify(identity(selected.filePath))===JSON.stringify(ready.sourceIdentity);}catch(_){}
        if(!unchanged){nativeToggle.checked=false;toggleReference();throw Error('原视频身份已变化，请重新读取');}
        nativeVideo.muted=true;nativeVideo.preload='metadata';nativeRef=nativeTool.create(nativeVideo,{origin:ready.browserTimeOrigin||0});
        nativeVideo.src=require('url').pathToFileURL(selected.filePath).href;nativeVideo.load();if(clip)referenceFrame(clip.snapshot().frameOrdinal,true);
      }
      nativeToggle.onchange=()=>{try{toggleReference();}catch(e){fail(e);}};
      function closeQuality(){if(closingQuality)return closingQuality;dead=true;++qualityToken;++referenceSequence;++probeEpoch;const current=clip;clip=null;
        closingQuality=(async()=>{if(nativeRef){nativeRef.dispose();nativeRef=null;}if(probeTask)await probeTask.catch(()=>{});if(current)await current.dispose();if(generator){const stopped=await generator.stop();if(stopped.failure)message('对照停止：'+stopped.failure.message);}nativeCanvas.width=nativeCanvas.height=1;panel.remove();
          if(currentClose===closeQuality)currentClose=null;if(window.EVAEvolutionBeforeRun===closeQuality)window.EVAEvolutionBeforeRun=null;start.disabled=false;message('对照已结束；普通播放仍720p JPEG');resources.textContent='内存记录未开启';})();return closingQuality;
      }
      currentClose=closeQuality;window.EVAEvolutionBeforeRun=closeQuality;
      panel.querySelector('#evClose').onclick=async()=>{try{await closeQuality();if(window.EVAEvolutionRun)await window.EVAEvolutionRun();}catch(e){message(e.message);}};
      panel.querySelector('#evReadSelected').onclick=async()=>{if(opening){message('正在准备或核对，仍可返回取消');return;}await openQuality().catch(e=>message(e.message));};
      generator=require(path.join(toolRoot,'selected-display-client.cjs')).start(selected,time,value=>{if(!dead&&value.state==='preparing')state.textContent='正在生成所选视频的短片候选，起点 '+value.start.toFixed(3)+' 秒';});
      try{ready=await generator.ready;}catch(e){fail(e);return;}if(dead)return;
      local=ready.location;identity(local.meta);if(sha(fs.readFileSync(local.meta))!==local.sha256)throw Error('对照索引已改变');data=JSON.parse(fs.readFileSync(local.meta));
      if(data.times.length!==ready.frames||!data.sourceSha256||data.times.length>60)throw Error('片段身份不完整');
      panel.querySelector('#evScope').textContent='所选：'+selected.name+'；源 '+ready.width+'×'+ready.height+'；预览 '+data.width+'×'+data.height+'；取样 '+data.times[0].time.toFixed(3)+'～'+(Number(data.lastFrameEndTicks)*data.timeBase[0]/data.timeBase[1]).toFixed(3)+' 秒，共 '+data.times.length+' 帧，无声。优化JPEG仍有损；PNG仅诊断。';
      async function load(format){
        if(dead||checking)return;const retained=clip&&clip.snapshot().frameOrdinal||0,token=++qualityToken;switching=true;controls(false);dragging=false;
        try{if(clip){await clip.dispose();clip=null;}if(dead||token!==qualityToken)return;
          const display=data.displays.find(d=>d.format===format);if(!display)throw Error('缺少候选');const preset=profiles.profile(format);
          const built=index.buildIndex(data.times.map((t,i)=>({id:i,file:String(i),bytes:display.index[i].bytes,ptsTicks:t.pts,timeBase:data.timeBase})),{timeBase:data.timeBase,lastFrameEndTicks:data.lastFrameEndTicks});
          const info={width:data.width,height:data.height,duration:built.videoDuration,frames:built.frames,source:{sha256:data.sourceSha256},audio:null};
          const player=new window.EVAPlayer.Player({canvas,frameIndex:index,ramBytes:1024**3,compressedRamBytes:128*1024**2,experimentMode:'compressed-ram',
            readAsset:(_info,name)=>readFrame(format,Number(name)),env:{decodeImage:bytes=>createImageBitmap(new Blob([bytes],{type:preset.mime}))},
            onChange:s=>{if(dead||token!==qualityToken)return;panel.querySelector('#evFrame').textContent='片段第 '+(s.frameOrdinal===null?'—':s.frameOrdinal+1)+' / '+data.times.length+' 帧；本片段缓存RAM '+mib(s.cacheBytes)+'（上限1GiB）';if(!dragging)range.value=s.time||0;if(!switching)referenceFrame(s.frameOrdinal);}});
          clip=player;currentFormat=format;await player.load(info);if(dead||token!==qualityToken){await player.dispose();return;}
          if(retained)await player.seek(info.frames[Math.min(retained,info.frames.length-1)].time,{kind:'release',final:true});
          if(dead||token!==qualityToken)return;range.max=info.duration;panel.querySelector('#evCacheLabel').textContent=preset.label+'；本片段图片 '+mib(display.index.reduce((n,x)=>n+x.bytes,0));
        }finally{switching=false;if(!dead&&token===qualityToken){controls(!!clip);if(nativeRef&&clip)referenceFrame(clip.snapshot().frameOrdinal,true);}}
      }
      async function runProbe(){
        if(dead||checking||!clip)return;
        if(checkRecorder&&checkRecorder.pending){
          try{if(checkRecorder.uncertain){state.textContent='上次写入结果不确定，请交由Codex核对；未重复保存或重新采样。';return;}
            checkRecorder.retry();state.textContent='上次颜色核对结果已保存，可继续比较画面。';panel.querySelector('#evCheck').textContent='重新核对颜色';}
          catch(e){state.textContent='上次结果仍未保存：'+e.message+'；画面可继续预览。';}return;
        }
        if(!nativeRef){nativeToggle.checked=true;toggleReference();}
        checking=true;controls(false);const ref=nativeRef,token=qualityToken,epoch=++probeEpoch,ordinal=clip.snapshot().frameOrdinal,scratch=document.createElement('canvas');scratch.width=data.width;scratch.height=data.height;
        const valid=()=>!dead&&probeEpoch===epoch&&qualityToken===token&&nativeRef===ref;
        const task=(async()=>{try{state.textContent='自动核对首／中／末画面与JPEG候选，完成后可直接比较颜色……';
          const result=await require(path.join(toolRoot,'color-probe.cjs')).probe({ordinals:[0,Math.floor(data.times.length/2),data.times.length-1],width:data.width,height:data.height,formats:['png','jpeg','jpeg-fine'],times:data.times,lastEnd:Number(data.lastFrameEndTicks)*data.timeBase[0]/data.timeBase[1],reference:ref,
            captureReference:()=>nativeTool.render(nativeVideo,nativeCanvas,data.width,data.height),readFrame,decode:(bytes,format)=>createImageBitmap(new Blob([bytes],{type:profiles.profile(format).mime})),
            readBitmap:bitmap=>{const ctx=scratch.getContext('2d',{alpha:false,colorSpace:'srgb'});ctx.drawImage(bitmap,0,0,data.width,data.height);return ctx.getImageData(0,0,data.width,data.height).data;},valid});
          if(!valid()||result.cancelled)return;
          if(!checkRecorder)checkRecorder=require(path.join(toolRoot,'check-recorder.cjs')).create();
          try{const saved=checkRecorder.save({kind:'native-color-suite-v1',sourceSha256:data.sourceSha256,color:data.color,node:process.versions.node,chrome:process.versions.chrome,results:result,
            scope:'Same native video frame -> same-size sRGB Canvas versus PNG/old JPEG/fine JPEG. Three source frames only; not direct native compositor or monitor calibration.',diagnosticPixelArrayBytesBound:data.width*data.height*4*3});
            state.textContent='颜色数值已自动保存。请直接看左右画面；下拉可切原JPEG或PNG参考。';
          }catch(e){state.textContent='颜色已核对，但数值尚未保存：'+e.message+'；仍可比较画面。';panel.querySelector('#evCheck').textContent=checkRecorder.uncertain?'保存待Codex核对':'重试保存上次结果';}
        }catch(e){if(valid())state.textContent='自动颜色核对未完成：'+e.message+'；可继续目视比较，不代表通过。';}
        finally{scratch.width=scratch.height=1;checking=false;if(valid()){controls(true);nativeRequestKey=null;await referenceFrame(ordinal,true);}}})();
        probeTask=task;try{await task;}finally{if(probeTask===task)probeTask=null;}
      }
      formatSelect.onchange=()=>load(formatSelect.value).catch(fail);
      range.oninput=()=>{if(clip&&!checking&&!switching){dragging=true;seekSerial++;clip.seek(Number(range.value),{kind:'drag',final:false}).catch(fail);}};
      range.onchange=()=>{if(clip&&!checking&&!switching){const serial=++seekSerial;clip.seek(Number(range.value),{kind:'release',final:true}).then(()=>{if(serial===seekSerial){dragging=false;if(clip)range.value=clip.snapshot().time;}}).catch(fail);}};
      range.onpointercancel=()=>{dragging=false;};const step=n=>{if(clip&&!checking&&!switching)clip.step(n).catch(fail);};
      panel.querySelector('#evPrev').onclick=()=>step(-1);panel.querySelector('#evNext').onclick=()=>step(1);
      panel.addEventListener('keydown',e=>{if(e.target.tagName==='SELECT')return;if(['[','【',']','】'].includes(e.key)){e.preventDefault();e.stopPropagation();step(['[','【'].includes(e.key)?-1:1);}});
      panel.querySelector('#evCheck').onclick=()=>runProbe().catch(fail);
      try{await load('jpeg-fine');if(!dead){nativeToggle.checked=true;toggleReference();await runProbe();}}catch(e){fail(e);}
    }finally{opening=false;qualityButton.disabled=false;}
  }
})();
