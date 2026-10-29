/* E44 native video, one original-audio clock, bounded displayed-frame RAM. */
(function(root){
 'use strict';
 class Player{
  constructor(o){
   this.o=o;this.info=null;this.runtime=o.nativeRuntime;this.index=o.frameIndex;this.canvas=o.canvas;this.ctx=this.canvas.getContext('2d',{alpha:false});
   this.budget=new root.EVAPlayer.ManagedBudget(o.ramBytes);this.nativeToken=this.budget.reserve(this.runtime.nativeBytes,'native-gop');
   this.cache=new Map();this.revision=0;this.state='empty';this.currentIndex=null;this.time=0;this.targetTime=0;this.pendingTargets=0;this.frameHeld=true;this.serial=0;this.epoch=1;this.drawCount=0;
   this.playbackRate=1;this.loopStart=null;this.loopEnd=null;this.loopEnabled=false;this.forwardPredecode=!!o.forwardPredecode;this.disposed=false;this.lastIssue=null;this.lastErrorCode=null;
   this.now=o.env?.now||(()=>performance.now());this.raf=o.env?.raf||(fn=>requestAnimationFrame(fn));this.caf=o.env?.caf||(id=>cancelAnimationFrame(id));
   this.audio=null;this.audioResume=null;this.reader=null;this.readerBusy=false;this.playToken=0;this.playIntent=0;this.thumbQueue=[];this.thumbCache=new Map();this.thumbBytes=0;this.playReadMs=20;this.playRequest=0;this.switchTask=null;this.leases=new Set();this.canvasLeases=new WeakMap();
  }
  _emit(type,extra={}){try{this.o.emit?.({type,at:this.now(),epoch:this.epoch,...extra});}catch(_){} }
  _change(){if(!this.disposed)try{this.o.onChange?.(this.snapshot());}catch(_){} }
  _beginRead(reader){const lease={reader,at:this.now()};this.readOwner=lease;this.readerBusy=true;return lease;}
  _endRead(lease){if(this.readOwner===lease){this.readOwner=null;this.readerBusy=false;}}
  snapshot(){return {state:this.state,time:this.time,frameId:this.info?.frames[this.currentIndex]?.id??null,frameOrdinal:this.currentIndex,frameCount:this.info?.frames.length||0,targetTime:this.targetTime,pendingTargets:this.pendingTargets,frameHeld:this.frameHeld||this.pendingTargets>0,
   budget:this.budget.snapshot(),cacheBytes:this.budget.used,cachePeakBytes:this.budget.peak,activeImageTasks:this.readerBusy?1:0,drawCount:this.drawCount,epoch:this.epoch,
   audioAvailable:!!this.audio,playbackRate:this.playbackRate,transport:this.transportSnapshot(),lastIssue:this.lastIssue,lastErrorCode:this.lastErrorCode,
   frameDecoder:this.reader?.snapshot(),native:true,proxyActive:!!this.proxyActive,forwardPredecode:this.forwardPredecode,forwardStatus:this.readerBusy?'preparing':'idle',memoryScope:'managed YUV/RGBA frames, thumbnails, render-surface allowance and native GOP reservation; OS audio and decoder/driver internal buffers excluded'};}
  auxiliaryBudget(){return {budget:this.budget,evict:()=>this._evict()};}
  _evict(){for(const [n,e] of this.cache){if(n===this.currentIndex)continue;this.cache.delete(n);this.budget.release(e.token);this.revision++;return true;}return false;}
  _entry(n,r){if(this.cache.has(n))return this.cache.get(n);const bytes=r.pixels.byteLength;
   const token=this.budget.reserve(bytes+256,'native-frame-pixels',()=>this._evict());
   const image=this.renderer?null:new ImageData(new Uint8ClampedArray(r.pixels.buffer,r.pixels.byteOffset,bytes),r.metrics.width,r.metrics.height),entry={image,token,pixels:r.pixels,header:r.metrics};
   this.cache.set(n,entry);this.revision++;return entry;
  }
  _draw(n,e){if(this.disposed)return;const im=e.image||e.header;
   if(this.canvas.width!==im.width||this.canvas.height!==im.height){this.canvas.width=im.width;this.canvas.height=im.height;}
   if(this.renderer)this.ctx.drawImage(this.renderer.render(e.pixels,e.header),0,0);else this.ctx.putImageData(im,0,0);this.canvas.style.visibility='visible';this.currentIndex=n;this.time=this.info.frames[n].time;this.drawCount++;this.frameHeld=false;this.lastIssue=null;this.lastErrorCode=null;
   this.cache.delete(n);this.cache.set(n,e);
  }
  async load(info){this.canvas.style.visibility='hidden';this.frameHeld=true;this.info=info;this.index.validateIndex(info);this.state='loading';this._change();
   if(root.EVANativeRenderer){this.renderToken=this.budget.reserve(info.width*info.height*20,'video-render-surfaces');this.renderer=root.EVANativeRenderer.create({document:root.document,width:info.width,height:info.height,enabled:this.o.gpuDrawing!==false});}
   this.reader=await this.runtime.createReader();if(this.disposed){await this.runtime.closeReader(this.reader);return;}
   if(info.audio){const a=this.o.createAudio?.()||document.createElement('audio');a.preload='auto';a.src=require('url').pathToFileURL(info.source.filePath).href;a.playbackRate=this.playbackRate;this.audio=a;}
   this.unsub=this.runtime.subscribeProxy(()=>{this._takeProxy().catch(e=>{this.lastIssue='代理接管失败，继续原片：'+e.message;this._change();});});
   this.state='paused';await this.seek(0,{final:true,kind:'initial'});if(this.runtime.proxyAsset())await this._takeProxy();return this.snapshot();
  }
  async _takeProxy(){if(this.disposed||this.frameHeld||this.pendingTargets||this.proxyActive||this.switchTask)return this.switchTask;
   let retry=false;
   this.switchTask=(async()=>{let extra=null,candidate=null;try{
    extra=this.budget.reserve(this.runtime.nativeBytes,'native-handover',()=>this._evict());candidate=await this.runtime.createReader({proxy:true});this.candidateReader=candidate;
    if(this.disposed)return;const n=this.currentIndex??0,version=this.serial,r=await candidate.request(n);
    if(this.disposed)return;if(r.status!=='exact')throw Error('代理目标帧未校验通过。');
    if(version!==this.serial||this.pendingTargets){retry=true;return;}
    const old=this.reader;this.reader=candidate;candidate=null;this.proxyActive=true;this.readerBusy=false;old.cancel();await this.runtime.closeReader(old);
    // The cached/displayed frame is still the same source identity. Never restore an old target.
    if(version===this.serial&&!this.pendingTargets&&this.state==='paused')this._draw(n,this._entry(n,r));this._change();
   }finally{if(candidate)await this.runtime.closeReader(candidate);this.candidateReader=null;if(extra)this.budget.release(extra);}})();
   try{await this.switchTask;}finally{this.switchTask=null;if(retry&&!this.disposed&&!this.pendingTargets)this._takeProxy().catch(()=>{});}
  }
  async seek(time,settings={}){
   if(this.disposed||!this.info)return {status:'superseded'};
   this.pause(false,!!settings.keepPlayIntent);this.audioResume=null;const version=++this.serial,n=settings.index??this.index.frameAt(this.info.frames,Math.max(0,Math.min(this.info.duration,time)));
   if(!this.info.frames[n])throw Error('源帧编号无效。');this.targetTime=Math.max(0,Math.min(this.info.duration,time));this.pendingTargets=1;this.frameHeld=true;this.state='seeking';this._change();
   const began=settings.inputAt??this.now(),cached=this.cache.get(n),frame=this.info.frames[n];if(settings.final)this._primeAudio(frame.time);this._emit('request',{phase:'input',requestId:version,kind:settings.kind||'seek',frameId:frame.id,frameOrdinal:n,ptsTicks:frame.ptsTicks,timeBase:frame.timeBase,sourceTime:frame.time,targetTime:this.targetTime,inputAt:began,final:!!settings.final,cacheStateAtInput:cached?'decoded':'miss'});
   if(cached){this.reader.cancel();const submit=this.now();this._draw(n,cached);this.pendingTargets=0;this.state='paused';this._change();this._emit('reused',{requestId:version,inputAt:began,frameId:frame.id,time:frame.time,readyAt:began,submitStartedAt:submit,drawAt:this.now()});if(this.runtime.proxyAsset())this._takeProxy().catch(()=>{});return {status:'reused',frameId:frame.id};}
   // Keep the last confirmed pixels while the new intent is pending. Its source
   // identity stays unchanged and frameHeld prevents treating it as the target.
   if(this.currentIndex===null)this.canvas.style.visibility='hidden';
   const reader=this.reader,lease=this._beginRead(reader),startedAt=this.now();this._emit('stage-begin',{requestId:version,phase:'native',startedAt});let r;
   try{r=await reader.request(n);}catch(failure){r={status:'error',error:failure?.message||String(failure)};}
   finally{this._endRead(lease);this._emit('stage',{requestId:version,phase:'native',startedAt});}
   if(this.disposed||version!==this.serial){this._emit('superseded',{requestId:version});return {status:'superseded'};}
   if(r.status!=='exact'){this._emit('error',{requestId:version});this.pendingTargets=0;this.state='paused';this.lastIssue=r.error||'目标画面暂未准备完成，请重试。';this.lastErrorCode='NATIVE_FRAME_FAILED';this._change();return {status:'error',error:this.lastIssue};}
   const readyAt=this.now(),entry=this._entry(n,r),submit=this.now();this._draw(n,entry);this.pendingTargets=0;this.state='paused';this.lastIssue=null;this._change();
   this._emit('draw',{requestId:version,kind:settings.kind||'seek',frameId:frame.id,time:frame.time,inputAt:began,readyAt,submitStartedAt:submit,drawAt:this.now(),source:'native',nativeMetrics:r.metrics});this._drainThumbnails();if(this.runtime.proxyAsset())this._takeProxy().catch(()=>{});
   return {status:'drawn',frameId:this.info.frames[n].id,actualPtsTicks:this.info.frames[n].ptsTicks};
  }
  step(delta){const start=this.pendingTargets?this.index.frameAt(this.info.frames,this.targetTime):this.currentIndex??0;const n=Math.max(0,Math.min(this.info.frames.length-1,start+delta));return this.seek(this.info.frames[n].time,{index:n,kind:'step',final:true});}
  pause(notify=true,keepIntent=false){if(!keepIntent)this.playIntent++;this.playToken++;this.audioSeekCancel?.();if(this.rafId!==undefined)this.caf(this.rafId);this.rafId=undefined;
   const wasPlaying=this.state==='playing';this.audio?.pause();
   if(wasPlaying){this.audioResume=this.audio&&!this.audio.seeking&&!this.audio.ended?{ordinal:this.currentIndex,time:this.audio.currentTime}:null;this.reader?.cancel();this.readOwner=null;this.readerBusy=false;}
   this.anchor=null;if(!this.disposed&&this.info&&wasPlaying)this.state='paused';if(notify)this._change();return Promise.resolve({status:'paused'});}
  async play(){if(this.disposed||!this.info)return {status:'superseded'};const intent=++this.playIntent;await this.pause(false,true);if(this.disposed||intent!==this.playIntent)return {status:'superseded'};if(this.pendingTargets){const r=await this.seek(this.targetTime,{final:true,keepPlayIntent:true});if(!['drawn','reused'].includes(r.status)||this.disposed||intent!==this.playIntent)return {status:'superseded'};}
   // Foreground playback owns the decoder; a record thumbnail must not delay it.
   this.serial++;this.reader.cancel();this.readOwner=null;this.readerBusy=false;
   if(this.currentIndex===this.info.frames.length-1&&!this.loopEnabled){const r=await this.seek(0,{final:true,keepPlayIntent:true});if(!['drawn','reused'].includes(r.status)||this.disposed||intent!==this.playIntent)return {status:'superseded'};}
   const token=++this.playToken,audio=this.audio,resume=this.audioResume;
   const resumeTime=audio&&resume&&resume.ordinal===this.currentIndex&&!audio.seeking&&!audio.ended&&Math.abs(audio.currentTime-resume.time)<.001?resume.time:null;
   const media=resumeTime===null?this.time:Math.max(0,resumeTime-(this.info.metrics.sourceVideoOrigin||0));
   this.anchor={at:this.now(),time:media};
   // A play intent is immediately pausable. Decoder lookahead belongs to _tick,
   // never to a serial four-frame gate before starting audio/video.
   this.state='playing';this._change();
   if(audio){try{if(resumeTime===null)await this._audioSeek(Math.max(0,media+(this.info.metrics.sourceVideoOrigin||0)));if(this.disposed||token!==this.playToken||this.audio!==audio)return {status:'superseded'};audio.playbackRate=this.playbackRate;
    await audio.play();if(this.disposed||token!==this.playToken||this.audio!==audio){
     // A delayed play() promise can resolve after the user paused/closed. Stop
     // only that obsolete playback; never pause a newer play of the same audio.
     if(this.disposed||this.audio!==audio||this.state!=='playing')audio.pause();return {status:'superseded'};
    }}catch(e){if(this.disposed||token!==this.playToken)return {status:'superseded'};this.state='paused';this.lastIssue='声音未能启动：'+e.message;this._change();return {status:'error'};}}
   if(this.disposed||token!==this.playToken)return {status:'superseded'};
   this.anchor={at:this.now(),time:media};this.audioResume=null;this._tick(token);return {status:'playing'};
  }
  _primeAudio(time){const a=this.audio;if(!a)return;const target=Math.max(0,time+(this.info.metrics.sourceVideoOrigin||0));
   // Exact final seeks prepare the paused audio alongside picture decoding. Do
   // not wait here or restart an already pending seek to the same timestamp.
   if(Math.abs(a.currentTime-target)<.0001)return;try{a.currentTime=target;}catch(_){}
  }
  _audioSeek(time){const a=this.audio;if(!a)return Promise.resolve();return new Promise((resolve,reject)=>{let timer;const clean=()=>{clearTimeout(timer);a.removeEventListener?.('seeked',done);a.removeEventListener?.('error',bad);if(this.audioSeekCancel===cancel)this.audioSeekCancel=null;},done=()=>{clean();resolve();},bad=()=>{clean();reject(Error('音频定位失败。'));},cancel=()=>{clean();resolve();};
   // Test clocks and sources already at the requested point need no asynchronous seek.
   if(typeof a.addEventListener!=='function'){a.currentTime=time;resolve();return;}if(Math.abs(a.currentTime-time)<.0001&&!a.seeking){resolve();return;}
   this.audioSeekCancel=cancel;a.addEventListener('seeked',done,{once:true});a.addEventListener('error',bad,{once:true});timer=setTimeout(bad,3000);try{if(Math.abs(a.currentTime-time)>=.0001)a.currentTime=time;}catch(e){clean();reject(e);}
  });}
  _clock(){if(this.audio&&!this.audio.paused&&!this.audio.ended)return Math.max(0,this.audio.currentTime-(this.info.metrics.sourceVideoOrigin||0));return this.anchor?this.anchor.time+(this.now()-this.anchor.at)/1000*this.playbackRate:this.time;}
  _tick(token){if(this.disposed||token!==this.playToken||this.state!=='playing')return;
   let t=this._clock();const loop=this._range();
   if(loop&&t>=loop.end){const intent=this.playIntent;this.pause(false,true);const located=this.seek(loop.start,{index:this.loopStart,kind:'loop-wrap',final:true,keepPlayIntent:true}),version=this.serial;
    located.then(r=>{if(!this.disposed&&intent===this.playIntent&&version===this.serial&&this.state==='paused'&&this.loopEnabled&&['drawn','reused'].includes(r.status))return this.play();})
     .catch(e=>{if(!this.disposed&&intent===this.playIntent&&version===this.serial){this.lastIssue=e.message;this.pause();}});return;}
   if(t>=this.info.duration){this.pause(false);this.seek(this.info.frames[this.info.frames.length-1].time,{final:true});return;}
   const n=this.index.frameAt(this.info.frames,t);this.targetTime=t;
   // Display the newest available picture at/before the clock. A result arriving
   // one refresh late is still useful; discarding all late frames freezes 2K playback.
   let display=n;while(display>this.currentIndex&&!this.cache.has(display))display--;
   if(display>this.currentIndex&&this.cache.has(display)){this._draw(display,this.cache.get(display));this._change();}
   const lead=this.forwardPredecode?Math.min(.2,Math.max(.04,this.playReadMs/1000*1.8))*this.playbackRate:0;
   const end=this.index.frameAt(this.info.frames,Math.min(this.info.duration,t+lead));
   let wanted=null;for(let i=n;i<=end;i++)if(!this.cache.has(i)){wanted=i;break;}
   if(wanted!==null&&!this.readerBusy){const serial=this.serial,reader=this.reader,lease=this._beginRead(reader),target=wanted,startedAt=this.now(),requestId='play-'+(++this.playRequest),frame=this.info.frames[target];
    this._emit('request',{phase:'input',requestId,kind:'playback',frameId:frame.id,frameOrdinal:target,sourceTime:frame.time,targetTime:frame.time,inputAt:startedAt,cacheStateAtInput:'miss'});
    this._emit('stage-begin',{requestId,phase:'native',startedAt});
    reader.request(target).then(r=>{this._emit('stage',{requestId,phase:'native',startedAt});
     if(this.disposed||token!==this.playToken||serial!==this.serial){this._emit('superseded',{requestId});return;}
     if(r.status==='exact'){this.playReadMs=this.playReadMs*.7+(this.now()-startedAt)*.3;const readyAt=this.now(),e=this._entry(target,r),clockFrame=this.index.frameAt(this.info.frames,this._clock());
      if(target>this.currentIndex&&target<=clockFrame){const submit=this.now();this._draw(target,e);this._change();this._emit('draw',{requestId,frameId:frame.id,time:frame.time,readyAt,submitStartedAt:submit,drawAt:this.now()});}
      else this._emit('superseded',{requestId});
     }else{this._emit('error',{requestId});if(r.status==='error'){this.lastIssue=r.error;this._change();}}
    }).catch(e=>{if(!this.disposed&&token===this.playToken){this._emit('error',{requestId});this.lastIssue=e.message;this.pause();}}).finally(()=>{this._endRead(lease);if(!this.disposed&&token===this.playToken&&serial===this.serial&&this.state==='playing'){if(this.rafId!==undefined)this.caf(this.rafId);this._tick(token);}});}
   this.rafId=this.raf(()=>this._tick(token));
  }
  setForwardPredecode(on){this.forwardPredecode=!!on;this._change();return {status:'applied'};}
  setPlaybackRate(rate){if(!root.EVAPlayer.validRate(rate))return Promise.reject(Error('播放速度须为0.1×至4×。'));const resume=this.state==='playing';this.pause(false);this.playbackRate=rate;if(this.audio)this.audio.playbackRate=rate;this._change();return resume?this.play():Promise.resolve({status:'applied'});}
  _range(){return this.loopEnabled&&this.loopStart!==null&&this.loopEnd!==null?{start:this.info.frames[this.loopStart].time,end:this.info.frames[this.loopEnd].end}:null;}
  transportSnapshot(){const f=this.info?.frames,valid=this.loopStart!==null&&this.loopEnd!==null&&this.loopStart<this.loopEnd;return {rate:this.playbackRate,loop:{enabled:this.loopEnabled,valid,startId:f?.[this.loopStart]?.id??null,endId:f?.[this.loopEnd]?.id??null,startOrdinal:this.loopStart,endOrdinal:this.loopEnd,startTime:f?.[this.loopStart]?.time??null,endTime:f?.[this.loopEnd]?.time??null,endBoundary:valid?f?.[this.loopEnd]?.end:null}};}
  setLoopPoint(p){if(this.frameHeld||this.pendingTargets)return Promise.resolve({status:'ignored',reason:'frame-not-ready'});this.pause();if(p==='start'){this.loopStart=this.currentIndex;if(this.loopEnd!==null&&this.loopEnd<=this.loopStart)this.loopEnd=null;}else if(p==='end'){this.loopEnd=this.currentIndex;if(this.loopStart!==null&&this.loopStart>=this.loopEnd)this.loopStart=null;}else throw Error('循环端点无效。');this.loopEnabled=false;this._change();return Promise.resolve({status:'applied'});}
  clearLoop(){this.loopStart=this.loopEnd=null;this.loopEnabled=false;this._change();return Promise.resolve({status:'applied'});}
  loopFrameAt(time,b={}){if(!this.info)return null;const ordinal=Math.max(b.minOrdinal??0,Math.min(b.maxOrdinal??this.info.frames.length-1,b.ordinal??this.index.frameAt(this.info.frames,time)));const frame=this.info.frames[ordinal];return {ordinal,frameId:frame.id,time:frame.time};}
  async applyLoopRange(v){const first=v?.startOrdinal,last=v?.endOrdinal,info=this.info;if(!info||this.disposed||!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<0||first>=last||last>=info.frames.length)throw Error('请选择两个不同的源帧。');
   const intent=++this.playIntent,located=this.seek(info.frames[first].time,{index:first,kind:'loop-confirm',final:true,keepPlayIntent:true}),version=this.serial,r=await located;
   if(this.disposed||this.info!==info||intent!==this.playIntent||version!==this.serial)return {status:'superseded'};if(!['drawn','reused'].includes(r.status))return r;
   this.loopStart=first;this.loopEnd=last;this.loopEnabled=true;this._change();
   if(this.disposed||intent!==this.playIntent||version!==this.serial)return {status:'superseded'};return this.play();}
  async setLoopEnabled(on){if(typeof on!=='boolean')throw Error('循环状态必须为开或关。');if(!this.info||this.disposed)return {status:'superseded'};
   if(on&&!(this.loopStart!==null&&this.loopEnd!==null&&this.loopStart<this.loopEnd))return {status:'ignored',reason:'incomplete-loop'};
   const resume=this.state==='playing',intent=++this.playIntent,info=this.info;await this.pause(false,true);
   if(this.disposed||this.info!==info||intent!==this.playIntent)return {status:'superseded'};
   const current=this.pendingTargets?this.index.frameAt(info.frames,this.targetTime):this.currentIndex;
   if(on&&(this.pendingTargets||current===null||current<this.loopStart||current>this.loopEnd)){const n=current!==null&&current>=this.loopStart&&current<=this.loopEnd?current:this.loopStart;
    const located=this.seek(info.frames[n].time,{index:n,kind:'loop-enable',final:true,keepPlayIntent:true}),version=this.serial,r=await located;
    if(this.disposed||this.info!==info||intent!==this.playIntent||version!==this.serial)return {status:'superseded'};if(!['drawn','reused'].includes(r.status))return r;}
   this.loopEnabled=on;this._change();if(this.disposed||intent!==this.playIntent)return {status:'superseded'};return resume?this.play():{status:'applied'};}
  restoreTransport(v){if(!v||!root.EVAPlayer.validRate(v.rate))throw Error('恢复播放速度无效。');if(v.loop){for(const [n,id] of [[v.loop.startOrdinal,v.loop.startId],[v.loop.endOrdinal,v.loop.endId]])if(n!==null&&(!Number.isSafeInteger(n)||n<0||n>=this.info.frames.length||this.info.frames[n].id!==id))throw Error('恢复片段源帧身份不匹配。');this.loopStart=v.loop.startOrdinal;this.loopEnd=v.loop.endOrdinal;this.loopEnabled=!!v.loop.enabled;}this.playbackRate=v.rate;this._change();return Promise.resolve({status:'applied'});}
  cacheCoverageSnapshot(){return {epoch:this.epoch,revision:this.revision,duration:this.info?.duration||0,decodedFrames:this.cache.size,totalFrames:this.info?.frames.length||0,ranges:root.EVAPlayer.decodedRanges(this.info?.frames||[],this.cache.keys(),this.info?.duration),enabled:this.forwardPredecode,phase:this.readerBusy?'preparing':'idle'};}
  _lease(canvas,n){this.canvasLeases.get(canvas)?.release();const token=this.budget.reserve(canvas.width*canvas.height*4,'record-output',()=>this._evict());let released=false;const lease={frameId:this.info.frames[n].id,release:()=>{if(released)return;released=true;this.budget.release(token);this.leases.delete(lease);if(this.canvasLeases.get(canvas)===lease){this.canvasLeases.delete(canvas);canvas.width=canvas.height=1;}}};this.leases.add(lease);this.canvasLeases.set(canvas,lease);return lease;}
  async paintThumbnail(time,canvas){if(this.disposed||!this.info)return null;this.canvasLeases.get(canvas)?.release();const n=this.index.frameAt(this.info.frames,time),small=this.thumbCache.get(n),entry=this.cache.get(n);if(small){canvas.width=small.width;canvas.height=small.height;canvas.getContext('2d').putImageData(small.image,0,0);return this._lease(canvas,n);}if(!entry){this.primeRecords([n]);return null;}this._thumbnail(n,entry,canvas);return this._lease(canvas,n);}
  _thumbnail(n,e,canvas){const im=e.image||e.header,scale=Math.min(1,240/im.width,135/im.height);canvas.width=Math.max(1,Math.round(im.width*scale));canvas.height=Math.max(1,Math.round(im.height*scale));let staging;if(this.renderer)staging=this.renderer.render(e.pixels,e.header);else{staging=document.createElement('canvas');staging.width=im.width;staging.height=im.height;staging.getContext('2d').putImageData(im,0,0);}const ctx=canvas.getContext('2d');ctx.drawImage(staging,0,0,canvas.width,canvas.height);if(!this.renderer)staging.width=staging.height=1;
   if(!this.thumbCache.has(n)){const image=ctx.getImageData(0,0,canvas.width,canvas.height);while(this.thumbCache.size>=96){const k=this.thumbCache.keys().next().value;this.budget.release(this.thumbCache.get(k).token);this.thumbCache.delete(k);}try{const token=this.budget.reserve(image.data.byteLength,'record-thumbnail',()=>this._evict());this.thumbCache.set(n,{image,width:canvas.width,height:canvas.height,token});}catch(_){} }
   return {frameId:this.info.frames[n].id};}
  primeRecords(order){const ordinals=Array.isArray(order)?order:[...(order?.visible||[]),...(order?.all||[])];for(const n of ordinals)if(this.info?.frames[n]&&!this.thumbCache.has(n)&&!this.thumbQueue.includes(n))this.thumbQueue.push(n);this.thumbQueue=this.thumbQueue.slice(0,96);this._drainThumbnails();}
  async _drainThumbnails(){if(this.thumbRunning||this.disposed||this.state!=='paused'||this.pendingTargets||this.readerBusy)return;this.thumbRunning=true;
   try{while(this.thumbQueue.length&&!this.disposed&&this.state==='paused'&&!this.pendingTargets){const n=this.thumbQueue.shift();let e=this.cache.get(n);if(!e){const version=this.serial,lease=this._beginRead(this.reader),r=await this.reader.request(n);this._endRead(lease);if(this.disposed||version!==this.serial||this.state!=='paused')break;if(r.status!=='exact')continue;e=this._entry(n,r);}this._thumbnail(n,e,document.createElement('canvas'));this._change();await new Promise(r=>setTimeout(r,0));}}
   finally{this.thumbRunning=false;}
  }
  dispose(){if(this.disposeTask)return this.disposeTask;this.disposed=true;this.serial++;this.pause(false);this.state='disposed';this.unsub?.();if(this.audio){this.audio.pause();this.audio.removeAttribute('src');this.audio.load();this.audio=null;}
   this.disposeTask=(async()=>{await this.runtime.cancelReaders?.();if(this.candidateReader)await this.runtime.closeReader(this.candidateReader);if(this.reader)await this.runtime.closeReader(this.reader);await this.switchTask?.catch(()=>{});for(const lease of [...this.leases])lease.release();for(const e of this.cache.values())this.budget.release(e.token);this.cache.clear();for(const e of this.thumbCache.values())this.budget.release(e.token);this.thumbCache.clear();this.renderer?.dispose();this.budget.release(this.renderToken);this.budget.release(this.nativeToken);})();return this.disposeTask;
  }
 }
 root.EVANativePlayer={Player};if(typeof module==='object')module.exports={Player};
})(typeof window==='object'?window:globalThis);
