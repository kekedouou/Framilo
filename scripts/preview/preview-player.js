/* Browser-only media adapter. Production Session/UI owns annotations and gestures. */
window.PreviewPlayer = class {
  constructor({canvas,onChange}) {
    this.canvas=canvas;this.changed=onChange;this.state='empty';this.currentIndex=0;this.time=0;this.targetTime=0;
    this.loopStart=this.loopEnd=null;this.loopEnabled=false;this.playbackRate=1;this.generation=0;
    this.video=document.createElement('video');this.video.muted=true;this.video.preload='auto';this.video.src='sample.mp4';
    this.thumbnail=document.createElement('video');this.thumbnail.muted=true;this.thumbnail.preload='auto';this.thumbnail.src='sample.mp4';
    this.index=PreviewModules.load('frame-index.cjs');this.thumbTail=Promise.resolve();this.abort=new AbortController();
  }
  async ready(video) {if(video.readyState>=2)return;await this.event(video,'loadeddata');}
  event(video,name) {return new Promise((resolve,reject)=>{
    const finish=e=>{clearTimeout(timer);video.removeEventListener(name,ok);video.removeEventListener('error',fail);this.abort.signal.removeEventListener('abort',fail);e?reject(e):resolve();};
    const ok=()=>finish(),fail=()=>finish(Error('预览画面未就绪'));const timer=setTimeout(fail,8000);
    video.addEventListener(name,ok,{once:true});video.addEventListener('error',fail,{once:true});this.abort.signal.addEventListener('abort',fail,{once:true});
  });}
  emit(){if(!this.disposed)this.changed(this.snapshot());}
  snapshot(){return{state:this.state,time:this.time,targetTime:this.targetTime,frameId:this.currentIndex,frameOrdinal:this.currentIndex,frameCount:this.info?.frames.length||0,
    frameHeld:!!this.pending,pendingTargets:this.pending?1:0,transport:this.transportSnapshot(),budget:{used:0,limit:1024**3,kinds:{}},audioAvailable:false};}
  async load(info){this.info=info;this.canvas.width=info.width;this.canvas.height=info.height;await this.ready(this.video);await this.seek(0);}
  draw(){this.canvas.getContext('2d').drawImage(this.video,0,0,this.canvas.width,this.canvas.height);}
  async seek(time,{index}={}) {
    const generation=++this.generation;this.video.pause();cancelAnimationFrame(this.raf);
    const ordinal=index??this.index.frameAt(this.info.frames,time),frame=this.info.frames[ordinal];
    if(!frame)throw Error('预览帧越界');this.targetTime=frame.time;this.state='seeking';this.pending=true;this.emit();
    // Latest-target wins; HTML video seeks are only UI demonstrations, never native precision evidence.
    if(Math.abs(this.video.currentTime-(frame.time+.001))>.0005){const wait=this.event(this.video,'seeked');this.video.currentTime=frame.time+.001;await wait;}
    if(this.disposed||generation!==this.generation)return{status:'superseded'};
    this.currentIndex=ordinal;this.time=frame.time;this.pending=false;this.state='paused';this.draw();this.emit();return{status:'drawn',frameId:frame.id};
  }
  async play(){if(this.video.ended)await this.seek(0);if(this.pending)await this.seek(this.targetTime);if(this.loopEnabled&&(this.currentIndex<this.loopStart||this.currentIndex>this.loopEnd))await this.seek(this.info.frames[this.loopStart].time);
    this.video.playbackRate=this.playbackRate;await this.video.play();this.state='playing';this.emit();
    const tick=()=>{if(this.disposed||this.state!=='playing')return;
      if(this.loopEnabled&&this.video.currentTime>=this.info.frames[this.loopEnd].end){this.seek(this.info.frames[this.loopStart].time).then(()=>this.play()).catch(()=>{});return;}
      this.time=Math.min(this.info.duration,this.video.currentTime);this.targetTime=this.time;this.currentIndex=this.index.frameAt(this.info.frames,this.time);this.draw();
      if(this.video.ended){this.state='paused';this.time=this.info.frames[this.currentIndex].time;this.targetTime=this.time;}this.emit();if(this.state==='playing')this.raf=requestAnimationFrame(tick);};this.raf=requestAnimationFrame(tick);return{status:'playing'};}
  async pause(){this.video.pause();cancelAnimationFrame(this.raf);await this.seek(this.pending?this.targetTime:this.video.currentTime);return{status:'paused'};}
  step(delta){return this.seek(0,{index:this.index.stepIndex(this.info.frames,this.currentIndex,delta)});}
  transportSnapshot(){const valid=this.loopStart!==null&&this.loopEnd!==null&&this.loopStart<this.loopEnd,frames=this.info?.frames;
    return{rate:this.playbackRate,loop:{enabled:this.loopEnabled&&valid,valid,startId:this.loopStart,endId:this.loopEnd,startOrdinal:this.loopStart,endOrdinal:this.loopEnd,startTime:frames?.[this.loopStart]?.time??null,endTime:frames?.[this.loopEnd]?.time??null,endBoundary:valid?frames[this.loopEnd].end:null}};}
  async setPlaybackRate(rate){this.playbackRate=rate;this.video.playbackRate=rate;this.emit();return{status:'applied'};}
  async setLoopPoint(point){await this.pause();this[point==='start'?'loopStart':'loopEnd']=this.currentIndex;this.loopEnabled=false;this.emit();return{status:'applied'};}
  async applyLoopRange({startOrdinal,endOrdinal}){await this.seek(0,{index:startOrdinal});this.loopStart=startOrdinal;this.loopEnd=endOrdinal;this.loopEnabled=true;return this.play();}
  async clearLoop(){this.loopStart=this.loopEnd=null;this.loopEnabled=false;this.emit();return{status:'applied'};}
  async setLoopEnabled(enabled){if(enabled&&!this.transportSnapshot().loop.valid)return{status:'ignored',reason:'invalid-loop'};this.loopEnabled=enabled;this.emit();return{status:'applied'};}
  loopFrameAt(time,bounds={}){const ordinal=Math.max(bounds.minOrdinal??0,Math.min(bounds.maxOrdinal??359,bounds.ordinal??this.index.frameAt(this.info.frames,time)));return{ordinal,frameId:ordinal,time:this.info.frames[ordinal].time};}
  async restoreTransport(value){this.playbackRate=value.rate;this.loopStart=value.loop.startOrdinal;this.loopEnd=value.loop.endOrdinal;this.loopEnabled=value.loop.enabled;this.emit();}
  cacheCoverageSnapshot(){return null;}
  setForwardPredecode(){}
  paintThumbnail(time,canvas){const task=this.thumbTail.catch(()=>{}).then(async()=>{
    if(this.disposed)return null;await this.ready(this.thumbnail);const t=this.info.frames[this.index.frameAt(this.info.frames,time)].time+.001;
    if(Math.abs(this.thumbnail.currentTime-t)>.0005){const ready=this.event(this.thumbnail,'seeked');this.thumbnail.currentTime=t;await ready;}
    if(this.disposed)return null;canvas.width=240;canvas.height=135;canvas.getContext('2d').drawImage(this.thumbnail,0,0,240,135);
    return{release(){canvas.width=canvas.height=1;}};
  });this.thumbTail=task;return task;}
  async dispose(){this.disposed=true;++this.generation;this.abort.abort();cancelAnimationFrame(this.raf);for(const v of [this.video,this.thumbnail]){v.pause();v.removeAttribute('src');v.load();}await this.thumbTail.catch(()=>{});}
};
