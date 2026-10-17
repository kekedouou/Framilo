/* Experimental controls; release packages stay frozen. Runtime copies follow the documented source revision. */
(function(){'use strict';
  const path=require('path');
  let toolRoot=null,observation=null,clip=null,qualityToken=0,opening=false,currentClose=null,checkRecorder=null;
  const bar=document.createElement('div');
  bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999;background:#303030;padding:6px;color:white;font:13px sans-serif;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
  bar.innerHTML='<strong>演进验证</strong><button id="evObserve">开始内存记录</button><button id="evStop" disabled>停止并保存</button><button id="evQuality">所选视频1080p JPEG／PNG对照</button><span id="evStatus">普通播放仍是720p JPEG；记录默认关闭</span><span id="evResources" style="width:100%" title="受管RAM是当前播放器缓存账目；进程内存还包含程序本身，不含共享Eagle/GPU，二者不能相加。">内存记录未开启</span>';
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
      const adapter=require(path.join(toolRoot,'../../plugin/eagle.cjs'));
      // Capture the current Eagle selection before any close/wait can change it.
      const selected=await adapter.captureSelected(eagle),snapshot=window.EVADiagnostics&&window.EVADiagnostics.snapshot();
      const time=snapshot&&snapshot.source&&snapshot.source.id===selected.id&&snapshot.playback?snapshot.playback.time:0;
      await stopObservation();if(currentClose)await currentClose();
      if(typeof window.EVAEvolutionClose!=='function')throw Error('验证入口版本不匹配');
      const released=await window.EVAEvolutionClose();if(released&&released.status==='error')throw Error('普通播放器资源未释放');
      const fs=require('fs'),{sha,hashFile,identity,store}=require(path.join(toolRoot,'workspace.cjs')),index=require(path.join(toolRoot,'../../plugin/frame-index.cjs'));
      const panel=document.createElement('div');panel.id='evPanel';
      panel.style.cssText='position:fixed;inset:72px 0 0;z-index:998;background:#181818;color:#eee;padding:16px;overflow:auto;font:14px sans-serif';
      panel.innerHTML='<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><strong id="evSource"></strong><select id="evFormat" disabled><option value="jpeg">JPEG轻量</option><option value="png">PNG无损</option></select><button id="evReadSelected">读取Eagle当前选中视频</button><button id="evClose">返回普通播放器</button><button id="evCheck" disabled>核对本片段并保存</button><button id="evSize">原尺寸／适应窗口</button></div><p id="evScope">准备当前所选视频的1080p短片段；JPEG与PNG使用完全相同的源帧。准备中也可以返回或关闭。</p><p><label><input id="evNativeToggle" type="checkbox" disabled> 同帧原视频颜色参考（保存核对数值）</label> <span id="evNativeState"></span></p><div id="evPictures" style="display:grid;grid-template-columns:1fr;gap:12px;align-items:start"><div id="evNativeBox" hidden><p>原视频（Eagle浏览器解码）</p><video id="evNative" muted playsinline style="width:100%;display:block;visibility:hidden"></video></div><div style="overflow:auto;max-height:60vh"><p id="evCacheLabel" hidden>修复后的缓存预览</p><canvas id="evCanvas" style="display:block;max-width:100%;height:auto"></canvas></div></div><input id="evRange" type="range" min="0" max="1" step="any" value="0" disabled style="width:100%"><p><button id="evPrev" disabled>上一帧【</button> <button id="evNext" disabled>下一帧】</button> <span id="evFrame"></span></p><p id="evMessage">正在生成JPEG／PNG，请稍候……</p>';
      document.body.append(panel);start.disabled=true;stop.disabled=true;resources.textContent='对照面板只显示本片段缓存RAM；普通播放器已释放，内存记录已暂停';
      panel.querySelector('#evSource').textContent=selected.name;
      const canvas=panel.querySelector('#evCanvas'),range=panel.querySelector('#evRange'),state=panel.querySelector('#evMessage'),formatSelect=panel.querySelector('#evFormat');
      let data=null,local=null,currentFormat=null,checking=false,dragging=false,seekSerial=0,closingQuality=null,generator=null,dead=false;
      let nativeRef=null,nativeRequestKey=null;const nativeSaved=new Set(),nativeToggle=panel.querySelector('#evNativeToggle'),nativeVideo=panel.querySelector('#evNative'),nativeState=panel.querySelector('#evNativeState');
      async function referenceFrame(ordinal){
        if(!nativeRef||dead||checking||!Number.isInteger(ordinal)||ordinal<0||ordinal>=data.times.length)return;
        const token=qualityToken,format=currentFormat,key=token+':'+format+':'+ordinal;if(nativeRequestKey===key)return;nativeRequestKey=key;
        const time=data.times[ordinal].time,end=ordinal+1<data.times.length?data.times[ordinal+1].time:Number(data.lastFrameEndTicks)*data.timeBase[0]/data.timeBase[1];
        nativeState.textContent='原视频同帧对齐中……';
        try{const aligned=await nativeRef.seek(time,end);
          if(aligned.cancelled||dead||token!==qualityToken||!nativeRef||!clip||clip.snapshot().frameOrdinal!==ordinal)return;
          nativeState.textContent=`已对齐同一源帧：${time.toFixed(6)}秒；左为原视频，右为${format.toUpperCase()}`;
          if(!nativeSaved.has(format)){
            const metrics=require(path.join(toolRoot,'native-reference.cjs')).compare(nativeVideo,canvas,document);
            if(!checkRecorder)checkRecorder=require(path.join(toolRoot,'check-recorder.cjs')).create();
            try{checkRecorder.save({kind:'native-color-check',format,sourceSha256:data.sourceSha256,sourceTime:time,actualSourceTime:aligned.actual,color:data.color,metrics,node:process.versions.node,chrome:process.versions.chrome});nativeSaved.add(format);}
            catch(e){nativeState.textContent+='；核对数值未保存：'+e.message;}
          }
        }catch(e){if(!dead&&token===qualityToken){nativeRequestKey=null;nativeState.textContent=e.message;}}
      }
      nativeToggle.onchange=()=>{
        if(nativeRef){nativeRef.dispose();nativeRef=null;}nativeRequestKey=null;
        panel.querySelector('#evNativeBox').hidden=!nativeToggle.checked;panel.querySelector('#evCacheLabel').hidden=!nativeToggle.checked;
        panel.querySelector('#evPictures').style.gridTemplateColumns=nativeToggle.checked?'1fr 1fr':'1fr';canvas.style.maxWidth='100%';
        if(!nativeToggle.checked){nativeState.textContent='原视频参考已释放';return;}
        let unchanged=false;try{unchanged=JSON.stringify(identity(selected.filePath))===JSON.stringify(ready.sourceIdentity);}catch(_){}
        if(!unchanged){nativeToggle.checked=false;nativeToggle.onchange();nativeState.textContent='原视频身份已变化，未进行颜色对照；请重新读取所选视频';return;}
        nativeVideo.muted=true;nativeVideo.controls=false;nativeVideo.preload='metadata';
        nativeRef=require(path.join(toolRoot,'native-reference.cjs')).create(nativeVideo,{origin:ready.browserTimeOrigin||0});
        nativeVideo.src=require('url').pathToFileURL(selected.filePath).href;nativeVideo.load();
        if(clip)referenceFrame(clip.snapshot().frameOrdinal);
      };
      const fail=e=>{if(!dead)state.textContent=e.message;};
      function closeQuality(){if(closingQuality)return closingQuality;dead=true;++qualityToken;const current=clip;clip=null;
        closingQuality=(async()=>{if(nativeRef){nativeRef.dispose();nativeRef=null;}if(current)await current.dispose();if(generator){const result=await generator.stop();if(result.failure)message('对照停止：'+result.failure.message);}panel.remove();
          if(currentClose===closeQuality)currentClose=null;if(window.EVAEvolutionBeforeRun===closeQuality)window.EVAEvolutionBeforeRun=null;start.disabled=false;
          message('对照已结束；普通播放仍是720p JPEG');resources.textContent='内存记录未开启';})();return closingQuality;
      }
      currentClose=closeQuality;window.EVAEvolutionBeforeRun=closeQuality;
      panel.querySelector('#evClose').onclick=async()=>{try{await closeQuality();if(window.EVAEvolutionRun)await window.EVAEvolutionRun();}catch(e){message(e.message);}};
      panel.querySelector('#evReadSelected').onclick=async()=>{if(opening){message('请等待本次准备结束，或先点击返回取消');return;}await openQuality().catch(e=>message(e.message));};
      panel.querySelector('#evSize').onclick=()=>{if(!nativeToggle.checked)canvas.style.maxWidth=canvas.style.maxWidth==='none'?'100%':'none';};
      generator=require(path.join(toolRoot,'selected-display-client.cjs')).start(selected,time,value=>{
        if(!dead&&value.state==='preparing')state.textContent='正在为所选视频生成1080p JPEG／PNG，取样起点'+value.start.toFixed(3)+'秒';
      });
      let ready;
      try{ready=await generator.ready;}catch(e){fail(e);return;}
      if(dead)return;
      local=ready.location;identity(local.meta);if(sha(fs.readFileSync(local.meta))!==local.sha256)throw Error('对照数据已改变');
      data=JSON.parse(fs.readFileSync(local.meta));
      if(data.sourceSha256===undefined||data.times.length!==ready.frames)throw Error('对照样本身份不完整');
      const native=ready.width===data.width&&ready.height===data.height;
      panel.querySelector('#evScope').textContent=`本次所选：${selected.name}；源尺寸${ready.width}×${ready.height}；预览${data.width}×${data.height}${native?'（原始尺寸，JPEG仍有损压缩）':'（经过缩放及必要留边）'}；原片${data.times[0].time.toFixed(3)}～${(Number(data.lastFrameEndTicks)*data.timeBase[0]/data.timeBase[1]).toFixed(3)}秒，${data.times.length}帧，无声。这里只对照短片段，不是整段无损播放器。`;
      async function load(format){
        if(dead)return;const retained=clip&&clip.snapshot().frameOrdinal||0,token=++qualityToken;
        formatSelect.disabled=true;range.disabled=true;dragging=false;if(clip){await clip.dispose();clip=null;}if(dead||token!==qualityToken)return;
        const display=data.displays.find(d=>d.format===format),file=path.resolve(local.root,display.file);identity(file);
        if(path.dirname(file)!==local.root||hashFile(file)!==display.sha256)throw Error('图片包核对失败');
        const rows=data.times.map((t,i)=>({id:i,file:String(i),bytes:display.index[i].bytes,ptsTicks:t.pts,timeBase:data.timeBase}));
        const built=index.buildIndex(rows,{timeBase:data.timeBase,lastFrameEndTicks:data.lastFrameEndTicks});
        const info={width:data.width,height:data.height,duration:built.videoDuration,frames:built.frames,source:{sha256:data.sourceSha256},audio:null};
        const player=new window.EVAPlayer.Player({canvas,frameIndex:index,ramBytes:1024**3,compressedRamBytes:128*1024**2,experimentMode:'compressed-ram',
          readAsset:async(_info,name)=>{const part=display.index[Number(name)];if(!part)throw Error('无效帧');const fd=await fs.promises.open(file,'r'),buffer=Buffer.alloc(part.bytes);
            try{let total=0;while(total<part.bytes){const r=await fd.read(buffer,total,part.bytes-total,part.offset+total);if(!r.bytesRead)throw Error('图片包不完整');total+=r.bytesRead;}}finally{await fd.close();}
            if(sha(buffer)!==part.sha256)throw Error('帧摘要错误');return buffer;},
          env:{decodeImage:bytes=>createImageBitmap(new Blob([bytes],{type:format==='png'?'image/png':'image/jpeg'}))},
          onChange:s=>{if(dead||token!==qualityToken)return;panel.querySelector('#evFrame').textContent=`片段第${s.frameOrdinal===null?'—':s.frameOrdinal+1} / ${data.times.length}帧；本片段缓存RAM ${mib(s.cacheBytes)}（上限1GiB）`;if(!dragging)range.value=s.time||0;if(nativeRef)referenceFrame(s.frameOrdinal);}
        });
        clip=player;currentFormat=format;await player.load(info);if(dead||token!==qualityToken){await player.dispose();return;}
        if(retained)await player.seek(info.frames[Math.min(retained,info.frames.length-1)].time,{kind:'release',final:true});
        if(dead||token!==qualityToken)return;range.max=info.duration;range.disabled=false;formatSelect.disabled=false;
        for(const id of ['evPrev','evNext','evCheck'])panel.querySelector('#'+id).disabled=false;
        nativeToggle.disabled=false;if(nativeRef)referenceFrame(player.snapshot().frameOrdinal);
        state.textContent='颜色转换已修正。勾选同帧原视频参考比较颜色；PNG仅作诊断参考，不开发整段无损模式。';
      }
      formatSelect.onchange=()=>load(formatSelect.value).catch(fail);
      range.oninput=()=>{if(clip&&!checking){dragging=true;seekSerial++;clip.seek(Number(range.value),{kind:'drag',final:false}).catch(fail);}};
      range.onchange=()=>{if(clip&&!checking){const serial=++seekSerial;clip.seek(Number(range.value),{kind:'release',final:true}).then(()=>{if(serial===seekSerial){dragging=false;if(clip)range.value=clip.snapshot().time;}}).catch(fail);}};
      range.onpointercancel=()=>{dragging=false;};
      const step=n=>{if(clip&&!checking)clip.step(n).catch(fail);};panel.querySelector('#evPrev').onclick=()=>step(-1);panel.querySelector('#evNext').onclick=()=>step(1);
      panel.addEventListener('keydown',e=>{if(e.target.tagName==='SELECT')return;if(['[','【',']','】'].includes(e.key)){e.preventDefault();e.stopPropagation();step(['[','【'].includes(e.key)?-1:1);}});
      panel.querySelector('#evCheck').onclick=async()=>{if(!clip||checking)return;
        if(checkRecorder&&checkRecorder.pending){try{const saved=checkRecorder.retry();state.textContent='上次核对结果已保存：'+saved.file;panel.querySelector('#evCheck').textContent='核对本片段并保存';}
          catch(e){state.textContent=(checkRecorder.uncertain?'保存结果尚未确认，未重复写入：':'上次画面核对已完成，记录仍未保存：')+e.message+'；可以继续预览。';}return;}
        checking=true;formatSelect.disabled=true;const player=clip,token=qualityToken,results=[];
        try{for(let n=0;n<data.times.length;n++){if(dead||token!==qualityToken)throw Error('核对已取消');const t=performance.now(),r=await player.seek(player.info.frames[n].time,{kind:'accuracy-check',final:true}),elapsedMs=performance.now()-t;
          if(r.status!=='drawn')throw Error('目标帧未显示');const pixels=canvas.getContext('2d').getImageData(0,0,data.width,data.height).data,rgb=Buffer.alloc(data.width*data.height*3);
          for(let i=0,j=0;i<pixels.length;i+=4){rgb[j++]=pixels[i];rgb[j++]=pixels[i+1];rgb[j++]=pixels[i+2];}
          const hash=sha(rgb);results.push({ordinal:n,elapsedMs,displayOrdinal:player.snapshot().frameOrdinal,rgbSha256:hash,referenceEqual:hash===data.referenceHashes[n]});
        }
        if(!checkRecorder)checkRecorder=require(path.join(toolRoot,'check-recorder.cjs')).create();
        try{const saved=checkRecorder.save({format:currentFormat,sourceSha256:data.sourceSha256,node:process.versions.node,chrome:process.versions.chrome,results,capturedAt:new Date().toISOString(),
          allOrdinalsMatch:results.every(r=>r.ordinal===r.displayOrdinal),allReferencePixelsEqual:results.every(r=>r.referenceEqual),scope:'Selected source short sequential Canvas check; not full preparation or formal P01/P02.'});
          state.textContent='画面核对完成，记录已保存，交由Codex分析：'+saved.file;
        }catch(e){state.textContent=(checkRecorder.uncertain?'画面核对已完成，但保存结果尚未确认：':'画面核对已完成，但记录未保存：')+e.message+'；不影响继续预览。';panel.querySelector('#evCheck').textContent=checkRecorder.uncertain?'保存待Codex核对':'重试保存上次核对';}
        }catch(e){fail(e);}finally{checking=false;if(!dead&&token===qualityToken){formatSelect.disabled=false;if(nativeRef)referenceFrame(player.snapshot().frameOrdinal);}}
      };
      try{await load('jpeg');}catch(e){fail(e);}
    }finally{opening=false;qualityButton.disabled=false;}
  }
})();
