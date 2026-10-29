/* Developer-only Eagle integration gate, formal modules + read-only fixed source. */
(function(){'use strict';if(typeof require!=='function')return;
const fs=require('fs'),path=require('path');let here;eagle.onPluginCreate(p=>{here=p.path;});
const button=document.createElement('button');button.textContent='运行体验版完整检查';document.body.appendChild(button);
const wait=ms=>new Promise(r=>setTimeout(r,ms)),pct=(a,p)=>a.sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]??null;
button.onclick=async()=>{button.disabled=true;const status=document.getElementById('status'),project=path.resolve(here,'../..'),dir=path.join(project,'verification-runs/e44/experience'),profile=JSON.parse(fs.readFileSync(path.join(project,'verification-runs/e44/profile.json'))),rows=[],drift=[];
 let backend,player;const record={created:new Date().toISOString(),host:'real-Eagle-formal-native-modules',complete:false,rows,drift,visibility:document.visibilityState,window:{width:innerWidth,height:innerHeight},binarySha256:require('crypto').createHash('sha256').update(fs.readFileSync(path.join(project,'plugin/bin/filmcraft-media.exe'))).digest('hex')};
 try{
  backend=require(path.join(project,'plugin/native-backend.cjs')).createNativeBackend({pluginRoot:path.join(project,'plugin'),tools:profile.tools,automaticProxy:false,proxyEncoder:'nvidia',cacheRoot:path.join(dir,'cache'),limitBytes:1024**3});
  status.textContent='体验版 · 打开原片';const at=performance.now(),info=await backend.media.prepare({id:'e44-fixed-readonly',filePath:profile.source},{previewQuality:'720p',proxyEncoder:'nvidia'});
  if(info.source.sha256!==profile.sourceHash)throw Error('fixed source changed');
  const index=require(path.join(project,'plugin/frame-index.cjs'));
  player=new window.EVANativePlayer.Player({mediaInfo:info,nativeRuntime:info.nativeRuntime,frameIndex:index,canvas:document.querySelector('canvas'),ramBytes:1024**3,forwardPredecode:true,env:{raf:fn=>requestAnimationFrame(t=>{fn(t);if(player?.state==='playing'&&player.audio)drift.push({proxy:!!player.proxyActive,ms:(player._clock()-player.time)*1000});})},onChange:()=>{}});
  await player.load(info);record.openMs=performance.now()-at;
  status.textContent='体验版 · 原片播放与声音';await player.play();await wait(3000);await player.pause();record.originalPlayed=player.drawCount;record.audio={present:!!player.audio,paused:player.audio?.paused,currentTime:player.audio?.currentTime,error:player.audio?.error?.message||null};
  status.textContent='体验版 · 同帧GPU色彩核对';let cpuReader;
  try{const n=player.currentIndex,yuv=await player.reader.request(n);cpuReader=await require(path.join(project,'plugin/native-reader.cjs')).FilmcraftClient.create({exe:path.join(project,'plugin/bin/filmcraft-media.exe'),source:profile.source,frames:info.frames,height:720,width:info.width,outputHeight:info.height,cacheBytes:128*1024**2,gpuDrawing:false});const rgba=await cpuReader.request(n);
   if(yuv.status!=='exact'||rgba.status!=='exact')throw Error('color frame unavailable');const c=document.createElement('canvas');c.width=yuv.metrics.width;c.height=yuv.metrics.height;const ctx=c.getContext('2d');ctx.drawImage(player.renderer.render(yuv.pixels,yuv.metrics),0,0);const actual=ctx.getImageData(0,0,c.width,c.height).data;let maximum=0,sum=0,over2=0;
   for(let k=0;k<actual.length;k++){const d=Math.abs(actual[k]-rgba.pixels[k]);maximum=Math.max(maximum,d);sum+=d;if(d>2)over2++;}record.color={frameId:info.frames[n].id,format:yuv.metrics.pixelFormat,renderer:player.renderer.snapshot(),maximum,mean:sum/actual.length,over2};if(over2)throw Error('GPU color mismatch');
  }finally{if(cpuReader)record.colorReaderClose=await cpuReader.close();}
  status.textContent='体验版 · 完整代理同帧接管';const before=player.snapshot();info.nativeRuntime.startProxy();const start=performance.now();while(!player.proxyActive){if(['failed','cancelled'].includes(info.nativeRuntime.status().status))throw Error(info.nativeRuntime.status().message);if(performance.now()-start>60000)throw Error('proxy handover bound');await wait(50);}record.takeover={beforeFrame:before.frameId,afterFrame:player.snapshot().frameId,ms:performance.now()-start};
  for(let round=0;round<3;round++){
   status.textContent='体验版 · 代理固定轨迹 '+(round+1)+'/3';const requests=[];
   const input=(s,kind)=>{const began=performance.now(),done=player.seek(s,{kind,final:kind!=='drag',inputAt:began});const cursor=new Promise(r=>requestAnimationFrame(()=>r(performance.now()-began)));const p=done.then(async r=>({round,kind,seconds:s,status:r.status,ms:performance.now()-began,cursorMs:await cursor,frameId:r.frameId,target:info.frames[index.frameAt(info.frames,s)].id}));requests.push(p);return p;};
   for(const s of [58.4,22.7,44.2,1.5,72.4,12.3])await input(s,'remote');
   for(let n=0;n<12;n++)await input(12.3+n/60,'step');
   for(let n=0;n<60;n++){input(5+n*.92,'drag');await wait(16);}await input(59.28,'release');
   for(let n=0;n<12;n++)await input(59.28-n/60,'reverse');rows.push(...await Promise.all(requests));
  }
  status.textContent='体验版 · 代理播放与声音';await player.seek(10,{final:true});await player.play();await wait(3000);await player.pause();
  const exact=rows.filter(x=>['drawn','reused'].includes(x.status));record.summary={requests:rows.length,drawn:exact.length,superseded:rows.filter(x=>x.status==='superseded').length,errors:rows.filter(x=>!['drawn','reused','superseded'].includes(x.status)).length,wrong:exact.filter(x=>x.frameId!==x.target).length,cursorP95:pct(rows.map(x=>x.cursorMs),.95),cursorMax:Math.max(...rows.map(x=>x.cursorMs)),remoteP95:pct(exact.filter(x=>x.kind==='remote').map(x=>x.ms),.95),stepP95:pct(exact.filter(x=>x.kind==='step').map(x=>x.ms),.95),releaseP95:pct(exact.filter(x=>x.kind==='release').map(x=>x.ms),.95),driftP95:pct(drift.map(x=>Math.abs(x.ms)),.95),driftMax:Math.max(...drift.map(x=>Math.abs(x.ms)))};
  record.renderer=player.renderer?.mode;record.decoder=player.reader?.snapshot();record.technicalPassed=record.summary.cursorP95<=16.7&&record.summary.cursorMax<=50&&record.summary.remoteP95<=80&&record.summary.stepP95<=50&&record.summary.driftP95<=40;
  if(record.summary.errors||record.summary.wrong||record.takeover.beforeFrame!==record.takeover.afterFrame||record.audio.error)throw Error('integration gate failed');record.complete=true;status.textContent='体验版检查完成';
 }catch(e){record.error=String(e.stack||e);status.textContent='体验版检查失败 · '+e.message;}
 finally{if(player){await player.dispose();record.afterClose=player.snapshot().budget;}if(backend)await backend.close();fs.writeFileSync(path.join(dir,'eagle-experience-'+Date.now()+'.json'),JSON.stringify(record,null,2));button.disabled=false;}
};})();
