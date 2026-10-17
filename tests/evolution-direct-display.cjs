'use strict';
const assert=require('assert'),{EventEmitter}=require('events');
const {firstFrame}=require('../prototypes/preview-quality/direct-display.cjs');

function fixture(properties={}){
  const video=new EventEmitter(),callbacks=new Map(),timers=new Map(),history=[],draws=[],resets=[];
  let callbackId=0,timerId=0,width=1,height=1;
  Object.assign(video,{videoWidth:1920,videoHeight:1080,duration:10,currentTime:0,readyState:2,seeking:false,pauses:0,
    pause(){this.pauses++;},play(){throw Error('a paused display comparison must not start playback');},
    addEventListener:video.on.bind(video),removeEventListener:video.off.bind(video),
    requestVideoFrameCallback(fn){const id=++callbackId;callbacks.set(id,fn);history.push(fn);return id;},
    cancelVideoFrameCallback(id){callbacks.delete(id);}},properties);
  const ctx={fillStyle:null,fillRect(){},drawImage(...args){draws.push(args);},
    getContextAttributes(){return {colorSpace:'srgb'};},getImageData(){throw Error('display-only comparison must not read pixels');}};
  const canvas={getContext(type,options){assert.strictEqual(type,'2d');assert.deepStrictEqual(options,{alpha:false,colorSpace:'srgb'});return ctx;}};
  Object.defineProperties(canvas,{width:{get:()=>width,set:x=>{width=x;resets.push(['width',x]);}},height:{get:()=>height,set:x=>{height=x;resets.push(['height',x]);}}});
  const options={setTimeout(fn,ms){assert.strictEqual(ms,8000);const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
  return {video,canvas,ctx,callbacks,timers,history,draws,resets,
    start(extra={}){return firstFrame(video,canvas,{...options,...extra});},
    frame(time=0){assert(callbacks.size,'expected a pending frame callback');const [id,fn]=callbacks.entries().next().value;callbacks.delete(id);fn(1,{mediaTime:time});},
    timeout(){assert(timers.size,'expected a pending deadline');timers.values().next().value();}};
}
function clean(h){assert.strictEqual(h.callbacks.size,0);assert.strictEqual(h.timers.size,0);
  assert.strictEqual(h.video.listenerCount('loadedmetadata'),0);assert.strictEqual(h.video.listenerCount('error'),0);}
function lateCannotDraw(h){const before=h.draws.length;for(const fn of h.history)fn(1,{mediaTime:0});assert.strictEqual(h.draws.length,before);clean(h);}

(async()=>{
  let h=fixture(),job=h.start();
  assert.strictEqual(h.draws.length,0,'must wait for the browser actual-frame callback');
  assert.strictEqual(h.video.pauses,1);assert.strictEqual(h.callbacks.size,1);assert.strictEqual(h.timers.size,1);
  h.video.emit('loadedmetadata');assert.strictEqual(h.draws.length,0,'metadata is not a decoded-frame confirmation');
  h.frame();let result=await job.ready;
  assert.strictEqual(h.draws.length,1);assert.strictEqual(h.draws[0][0],h.video,'draw the exact paused video that provided the callback');
  assert.strictEqual(h.video.pauses,2);assert.strictEqual(result.actualMediaTime,0);assert.strictEqual(result.currentTime,0);
  assert.strictEqual(result.width,1920);assert.strictEqual(result.height,1080);assert.strictEqual(result.scaled,false);
  assert.strictEqual(result.pixelReadback,false);assert.strictEqual(result.cacheEncoding,false);assert.strictEqual(result.canvasColorSpace,'srgb');
  assert.strictEqual(result.canvasPixelBytes,1920*1080*4);assert.strictEqual(result.userVisualResult,'pending');clean(h);
  const pauses=h.video.pauses,resets=h.resets.length;job.cancel();assert.strictEqual(await job.ready,result);
  assert.strictEqual(h.video.pauses,pauses);assert.strictEqual(h.resets.length,resets);lateCannotDraw(h);

  h=fixture({readyState:0});job=h.start();assert.strictEqual(h.callbacks.size,0,'a fresh video must register the frame callback after metadata, not before src/load');
  assert.strictEqual(h.draws.length,0);assert.strictEqual(h.timers.size,1);
  h.video.readyState=1;h.video.emit('loadedmetadata');assert.strictEqual(h.callbacks.size,1);assert.strictEqual(h.draws.length,0);
  h.video.emit('loadedmetadata');assert.strictEqual(h.callbacks.size,1,'duplicate metadata must not create duplicate frame callbacks');
  h.video.readyState=2;h.frame();assert.strictEqual((await job.ready).actualMediaTime,0);assert.strictEqual(h.draws.length,1);clean(h);
  h=fixture({readyState:0});job=h.start();job.cancel();assert.deepStrictEqual(await job.ready,{cancelled:true});
  h.video.readyState=2;h.video.emit('loadedmetadata');assert.strictEqual(h.draws.length,0);clean(h);

  for(const [sourceWidth,sourceHeight,width,height,scaled] of [[3840,2160,1920,1080,true],[640,360,640,360,false],[1440,1080,1440,1080,false]]){
    h=fixture({videoWidth:sourceWidth,videoHeight:sourceHeight});job=h.start();h.frame();result=await job.ready;
    assert.deepStrictEqual([result.sourceWidth,result.sourceHeight,result.width,result.height,result.scaled],[sourceWidth,sourceHeight,width,height,scaled]);
    assert(width<=1920&&height<=1080&&width<=sourceWidth&&height<=sourceHeight);clean(h);
  }
  h=fixture();job=h.start();job.cancel();assert.deepStrictEqual(await job.ready,{cancelled:true});assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);

  let valid=true;h=fixture();job=h.start({valid:()=>valid});valid=false;h.frame();
  assert.deepStrictEqual(await job.ready,{cancelled:true});assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);
  h=fixture();job=h.start({valid:()=>false});h.video.emit('loadedmetadata');
  assert.deepStrictEqual(await job.ready,{cancelled:true});assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);

  h=fixture();job=h.start();h.video.emit('error');await assert.rejects(job.ready,/解码失败/);
  assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);
  h=fixture();job=h.start();h.timeout();await assert.rejects(job.ready,/超时/);
  assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);

  for(const missing of ['requestVideoFrameCallback','cancelVideoFrameCallback']){
    h=fixture();delete h.video[missing];job=h.start();await assert.rejects(job.ready,/无法确认实际视频帧/);
    assert.strictEqual(h.draws.length,0);clean(h);
  }
  for(const properties of [{duration:30.001},{duration:Infinity},{duration:0},{videoWidth:0},{videoHeight:undefined},{videoWidth:4096,videoHeight:2160}]){
    h=fixture(properties);job=h.start();h.video.emit('loadedmetadata');await assert.rejects(job.ready,/本次显示对照仅支持/);
    assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);
  }
  for(const properties of [{readyState:1},{seeking:true}]){
    h=fixture(properties);job=h.start();h.frame();await assert.rejects(job.ready,/首帧时间或解码状态/);
    assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);
  }
  for(const time of [-1,NaN,11]){
    h=fixture();job=h.start();h.frame(time);await assert.rejects(job.ready,/首帧时间或解码状态/);
    assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);
  }
  h=fixture();h.canvas.getContext=()=>null;job=h.start();h.frame();await assert.rejects(job.ready,/无法创建sRGB画布/);
  assert.strictEqual(h.draws.length,0);clean(h);lateCannotDraw(h);
  console.log('direct display: actual-frame gate, exact paused source, bounded/no-upscale dimensions, cancel/stale/error/deadline/unsupported/invalid cleanup checked with simulated browser; no real color conclusion');
})().catch(e=>{console.error(e);process.exitCode=1;});
