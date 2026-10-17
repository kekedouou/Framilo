/* Experimental host controls only; formal app.js and Player remain unchanged. */
(function(){'use strict';
  const path=require('path');let toolRoot=null,observation=null,clip=null,qualityToken=0;
  const bar=document.createElement('div');bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:999;background:#303030;padding:6px;color:white;font:13px sans-serif;display:flex;gap:8px;align-items:center';
  bar.innerHTML='<strong>演进验证</strong><button id="evObserve">开始本机观察</button><button id="evStop" disabled>停止并保存</button><button id="evQuality">1080p画质／逐帧对照</button><span id="evStatus">观察默认关闭；原视频与标注只读验收</span>';
  document.body.prepend(bar);document.body.style.paddingTop='42px';
  const start=bar.querySelector('#evObserve'),stop=bar.querySelector('#evStop'),status=bar.querySelector('#evStatus');
  if(typeof eagle==='object'&&typeof eagle.onPluginCreate==='function')eagle.onPluginCreate(plugin=>{toolRoot=path.dirname(path.dirname(plugin.path));});
  function message(text){status.textContent=text;}
  async function stopObservation(){if(observation){const value=observation;observation=null;await value.stop();}start.disabled=false;stop.disabled=true;}
  start.onclick=()=>{try{
    if(!toolRoot||!window.EVADiagnostics)throw Error('插件尚未就绪');
    const {start:begin}=require(path.join(toolRoot,'observation.cjs'));
    observation=begin({snapshot:()=>window.EVADiagnostics.snapshot(),onStatus:value=>{
      if(value.state==='recording')message('本机观察中：每秒一次；可正常使用、换片、关闭');
      if(value.issue)message('观察已停止：'+value.issue+'；播放不受影响');
      else if(value.state==='saved')message('观察已保存；不代表长期验收通过');
    }});start.disabled=true;stop.disabled=false;
    observation.done.finally(()=>{start.disabled=false;stop.disabled=true;});
  }catch(e){message(e.message);}};
  stop.onclick=()=>stopObservation().catch(e=>message(e.message));
  window.addEventListener('pagehide',()=>{if(observation)observation.stop();if(clip)clip.dispose();});
  bar.querySelector('#evQuality').onclick=()=>openQuality().catch(e=>message(e.message));
  async function openQuality(){
    if(!toolRoot)throw Error('插件尚未就绪');await stopObservation();
    if(typeof window.EVAEvolutionClose!=='function')throw Error('验证入口版本不匹配');
    const released=await window.EVAEvolutionClose();if(released&&released.status==='error')throw Error('普通播放器资源未释放');
    if(document.getElementById('evPanel'))return;
    const fs=require('fs'),{sha,hashFile,identity,store}=require(path.join(toolRoot,'workspace.cjs')),index=require(path.join(toolRoot,'../../plugin/frame-index.cjs'));
    const local=JSON.parse(fs.readFileSync(path.join(toolRoot,'display.local.json')));identity(local.meta);if(sha(fs.readFileSync(local.meta))!==local.sha256)throw Error('对照数据已改变');
    const data=JSON.parse(fs.readFileSync(local.meta)),panel=document.createElement('div');panel.id='evPanel';
    panel.style.cssText='position:fixed;inset:42px 0 0;z-index:998;background:#181818;color:#eee;padding:16px;overflow:auto;font:14px sans-serif';
    panel.innerHTML='<div style="display:flex;gap:10px;align-items:center"><strong>原生1080p样本 · 1秒无声片段</strong><select id="evFormat"><option value="jpeg">JPEG轻量</option><option value="png">PNG无损</option></select><button id="evClose">返回播放器</button><button id="evCheck">核对30帧并保存</button><button id="evSize">原尺寸／适应窗口</button></div><p>两种格式来自相同源帧。画质对照不代表整段视频已接入无损模式。观察在此面板开启时已停止。</p><div style="overflow:auto;max-height:65vh"><canvas id="evCanvas" style="display:block;max-width:100%;height:auto"></canvas></div><input id="evRange" type="range" min="0" max="1" step="any" value="0" style="width:100%"><p><button id="evPrev">上一帧【</button> <button id="evNext">下一帧】</button> <span id="evFrame"></span></p><p id="evMessage">载入中</p>';
    document.body.append(panel);start.disabled=true;stop.disabled=true;
    const canvas=panel.querySelector('#evCanvas'),range=panel.querySelector('#evRange'),state=panel.querySelector('#evMessage'),formatSelect=panel.querySelector('#evFormat');
    let currentFormat=null,checking=false,dragging=false,seekSerial=0,closingQuality=null,qualityObserver=null;
    function closeQuality(){if(closingQuality)return closingQuality;++qualityToken;const current=clip;clip=null;
      closingQuality=(async()=>{if(current)await current.dispose();if(qualityObserver)await qualityObserver.stop();panel.remove();window.EVAEvolutionBeforeRun=null;start.disabled=false;message('画质对照已结束；在Eagle再次调用此入口可载入选中视频。');})();return closingQuality;}
    window.EVAEvolutionBeforeRun=closeQuality;
    qualityObserver=require(path.join(toolRoot,'observation.cjs')).start({scope:'quality',snapshot:()=>({state:'paused',epoch:qualityToken,playback:clip?clip.snapshot():null}),onStatus:value=>{if(value.issue){message('画质观察停止：'+value.issue);closeQuality().catch(e=>message(e.message));}}});
    const fail=e=>{state.textContent=e.message;};
    async function load(format){
      const token=++qualityToken;formatSelect.disabled=true;range.disabled=true;dragging=false;if(clip){await clip.dispose();clip=null;}
      if(token!==qualityToken)return;
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
        onChange:s=>{if(token!==qualityToken)return;panel.querySelector('#evFrame').textContent=`第${s.frameOrdinal===null?'—':s.frameOrdinal+1} / ${data.times.length}帧；受管RAM ${(s.cacheBytes/1024**2).toFixed(1)}MiB`;if(!dragging)range.value=s.time||0;}
      });
      clip=player;currentFormat=format;await player.load(info);if(token!==qualityToken){await player.dispose();return;}range.max=info.duration;range.disabled=false;formatSelect.disabled=false;state.textContent='可以拖动、逐帧；切换格式观察同片段细节';
    }
    panel.querySelector('#evClose').onclick=()=>closeQuality().catch(fail);
    panel.querySelector('#evSize').onclick=()=>{canvas.style.maxWidth=canvas.style.maxWidth==='none'?'100%':'none';};
    formatSelect.onchange=()=>load(formatSelect.value).catch(fail);
    range.oninput=()=>{if(clip&&!checking){dragging=true;seekSerial++;clip.seek(Number(range.value),{kind:'drag',final:false}).catch(fail);}};
    range.onchange=()=>{if(clip&&!checking){const serial=++seekSerial;clip.seek(Number(range.value),{kind:'release',final:true}).then(()=>{if(serial===seekSerial){dragging=false;if(clip)range.value=clip.snapshot().time;}}).catch(fail);}};
    range.onpointercancel=()=>{dragging=false;};
    const step=n=>{if(clip&&!checking)clip.step(n).catch(fail);};panel.querySelector('#evPrev').onclick=()=>step(-1);panel.querySelector('#evNext').onclick=()=>step(1);
    panel.addEventListener('keydown',e=>{if(e.target.tagName==='SELECT')return;if(['[','【',']','】'].includes(e.key)){e.preventDefault();e.stopPropagation();step(['[','【'].includes(e.key)?-1:1);}});
    panel.querySelector('#evCheck').onclick=async()=>{if(!clip||checking)return;checking=true;formatSelect.disabled=true;const player=clip,token=qualityToken,results=[];
      try{for(let n=0;n<data.times.length;n++){if(token!==qualityToken)throw Error('核对已取消');const t=performance.now(),r=await player.seek(player.info.frames[n].time,{kind:'accuracy-check',final:true}),elapsedMs=performance.now()-t;
        if(r.status!=='drawn')throw Error('目标帧未显示');const pixels=canvas.getContext('2d').getImageData(0,0,data.width,data.height).data,rgb=Buffer.alloc(data.width*data.height*3);
        for(let i=0,j=0;i<pixels.length;i+=4){rgb[j++]=pixels[i];rgb[j++]=pixels[i+1];rgb[j++]=pixels[i+2];}
        results.push({ordinal:n,elapsedMs,displayOrdinal:player.snapshot().frameOrdinal,rgbSha256:sha(rgb),referenceEqual:sha(rgb)===data.referenceHashes[n]});
      }
      const saved=store().save('eagle-canvas-check',{format:currentFormat,node:process.versions.node,chrome:process.versions.chrome,results,
        allOrdinalsMatch:results.every(r=>r.ordinal===r.displayOrdinal),allReferencePixelsEqual:results.every(r=>r.referenceEqual),scope:'One-second sequential actualCanvas check; no full preparation, physical display or formal P01/P02 result.'});
      state.textContent='核对已保存：'+saved.file;
      }catch(e){fail(e);}finally{checking=false;if(token===qualityToken)formatSelect.disabled=false;}
    };
    await load('jpeg');
  }
})();
