'use strict';
const assert=require('assert'),{EventEmitter}=require('events');
const {describeFrame,describeCanvas,bridge}=require('../prototypes/preview-quality/display-output.cjs');
function fixture(properties={}){
  const video=new EventEmitter(),callbacks=new Map(),history=[],timers=new Map(),calls=[];
  let nextCallback=0,nextTimer=0,resolvePlay,rejectPlay;
  const playPromise=new Promise((resolve,reject)=>{resolvePlay=resolve;rejectPlay=reject;});
  const track={stops:0,requests:0,stop(){this.stops++;},requestFrame(){this.requests++;calls.push('requestFrame');}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]};
  const originalState={globalAlpha:0.25,globalCompositeOperation:'multiply',filter:'blur(1px)',shadowColor:'red',shadowBlur:5,shadowOffsetX:4,shadowOffsetY:3,transform:'translated'};
  const states=[],ctx={...originalState,draws:0,hook:null,
    save(){states.push(Object.fromEntries(Object.keys(originalState).map(key=>[key,this[key]])));calls.push('save');},
    restore(){Object.assign(this,states.pop());calls.push('restore');},resetTransform(){this.transform='identity';},
    drawImage(source,x,y){assert.strictEqual(source,canvas);assert.deepStrictEqual([x,y],[0,0]);assert.strictEqual(this.transform,'identity');
      assert.strictEqual(this.globalAlpha,1);assert.strictEqual(this.globalCompositeOperation,'copy');assert.strictEqual(this.filter,'none');
      assert.strictEqual(this.shadowColor,'transparent');assert.strictEqual(this.shadowBlur,0);assert(track.requests>0,'capture must be requested before the redraw');
      this.draws++;calls.push('drawSameCanvas');if(this.hook)this.hook();},
    getImageData(){throw Error('no pixel readback');}};
  Object.assign(video,{srcObject:null,readyState:0,videoWidth:0,videoHeight:0,currentTime:0,seeking:false,pauses:0,loads:0,
    play(){calls.push('play');return playPromise;},pause(){this.pauses++;},load(){this.loads++;},
    addEventListener:video.on.bind(video),removeEventListener:video.off.bind(video),
    requestVideoFrameCallback(fn){const id=++nextCallback;callbacks.set(id,fn);history.push(fn);calls.push('requestCallback');return id;},
    cancelVideoFrameCallback(id){callbacks.delete(id);}},properties);
  const canvas={width:1920,height:1080,captureStream(rate){assert.strictEqual(rate,0);calls.push('captureStream');return stream;},
    getContext(type){assert.strictEqual(type,'2d');return ctx;},
    getImageData(){throw Error('no pixels');},toDataURL(){throw Error('no encoding');}};
  const options={setTimeout(fn,ms){assert.strictEqual(ms,8000);const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},VideoFrame:null};
  return {video,canvas,ctx,originalState,states,track,stream,callbacks,history,timers,calls,resolvePlay,rejectPlay,
    start(extra={}){return bridge(canvas,video,{...options,...extra});},
    metadata(){video.readyState=1;video.videoWidth=canvas.width;video.videoHeight=canvas.height;video.emit('loadedmetadata');},
    frame(time=0){assert(callbacks.size,'expected pending frame');video.readyState=2;const [id,fn]=callbacks.entries().next().value;callbacks.delete(id);fn(1,{mediaTime:time});},
    timeout(){assert(timers.size);timers.values().next().value();}};
}
async function tick(){await Promise.resolve();await Promise.resolve();}
function cleanWait(h){assert.strictEqual(h.callbacks.size,0);assert.strictEqual(h.timers.size,0);assert.strictEqual(h.video.listenerCount('loadedmetadata'),0);assert.strictEqual(h.video.listenerCount('error'),0);}
function clean(h){cleanWait(h);assert.strictEqual(h.track.stops,1);assert.strictEqual(h.video.srcObject,null);}
function late(h){const requests=h.track.requests,pauses=h.video.pauses;for(const fn of h.history)fn(1,{mediaTime:0});h.video.emit('loadedmetadata');assert.strictEqual(h.track.requests,requests);assert.strictEqual(h.video.pauses,pauses);}
(async()=>{
  let closes=0;
  class Frame{
    constructor(video){assert.strictEqual(video,'the video');Object.assign(this,{format:'I420',codedWidth:1920,codedHeight:1088,displayWidth:1920,displayHeight:1080,timestamp:12345,duration:null,
      colorSpace:{toJSON(){return {primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false,private:'not copied'};}}});}
    close(){closes++;}
  }
  const metadata=describeFrame('the video',{VideoFrame:Frame});
  assert.deepStrictEqual(metadata,{available:true,format:'I420',codedWidth:1920,codedHeight:1088,displayWidth:1920,displayHeight:1080,timestamp:12345,duration:null,
    colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false}});assert.strictEqual(closes,1);
  assert.deepStrictEqual(describeFrame({}, {VideoFrame:null}),{available:false,reason:'unsupported'});
  class Broken extends Frame{get format(){throw Error('cannot read');}set format(_){}}
  assert.strictEqual(describeFrame('the video',{VideoFrame:Broken}).reason,'read-failed');assert.strictEqual(closes,2,'failed metadata still closes handle');
  class Unreadable{constructor(){throw Error('cannot construct');}}
  assert.strictEqual(describeFrame({}, {VideoFrame:Unreadable}).reason,'read-failed');
  class Opaque{constructor(){this.format=null;this.timestamp=NaN;this.colorSpace={toJSON:()=>({primaries:null,transfer:null,matrix:null,fullRange:null})};}close(){closes++;}}
  assert.deepStrictEqual(describeFrame({}, {VideoFrame:Opaque}),{available:true,format:null,colorSpace:{primaries:null,transfer:null,matrix:null,fullRange:null}});
  assert.strictEqual(closes,3,'opaque or unreported fields are preserved without invented dimensions or timestamps');
  assert.deepStrictEqual(describeCanvas({getContextAttributes(){return {alpha:false,colorSpace:'srgb',desynchronized:false,willReadFrequently:false,secret:'omit'};}}),
    {available:true,alpha:false,desynchronized:false,willReadFrequently:false,colorSpace:'srgb'});
  assert.strictEqual(describeCanvas({}).reason,'unsupported');assert.strictEqual(describeCanvas({getContextAttributes(){return null;}}).reason,'unreported');
  assert.strictEqual(describeCanvas({getContextAttributes(){throw Error('unavailable');}}).reason,'read-failed');

  let h=fixture(),job=h.start();assert.strictEqual(h.track.requests,1);assert.strictEqual(h.video.srcObject,h.stream);
  assert.strictEqual(h.ctx.draws,1,'static Canvas must draw again to trigger capture');
  assert.deepStrictEqual(h.calls,['captureStream','requestCallback','play','requestFrame','save','drawSameCanvas','restore']);
  assert.deepStrictEqual(Object.fromEntries(Object.keys(h.originalState).map(key=>[key,h.ctx[key]])),h.originalState,'self-copy must restore Canvas state');
  assert.strictEqual(h.states.length,0);h.metadata();
  h.frame(0.4);let result=await job.ready;
  assert.strictEqual(result.actualMediaTime,0.4);assert.strictEqual(result.width,1920);assert.strictEqual(result.height,1080);
  assert.strictEqual(result.pixelReadback,false);assert.strictEqual(result.cacheEncoding,false);assert.strictEqual(result.targetSourcePtsVerified,false);
  assert.strictEqual(result.userVisualResult,'pending');assert.strictEqual(result.decodedFrame.reason,'unsupported');
  assert.strictEqual(h.video.pauses,1);assert.strictEqual(h.track.stops,0,'successful static display retains its track');assert.strictEqual(h.video.srcObject,h.stream);cleanWait(h);
  h.resolvePlay();await tick();assert.strictEqual(h.video.pauses,1,'late play resolution must not resume the paused output');
  job.cancel();job.cancel();assert.strictEqual(await job.ready,result);clean(h);assert.strictEqual(h.video.loads,1);late(h);

  // Model the real bootstrap ordering: metadata requires a requested Canvas draw,
  // and play() does not resolve until after a submitted frame. Waiting for either
  // before requesting/redrawing would leave this job pending until its deadline.
  h=fixture();let playResolved=false;
  h.ctx.hook=()=>Promise.resolve().then(()=>{h.metadata();h.frame(0.7);});
  job=h.start();h.resolvePlay=(()=>{const resolve=h.resolvePlay;return ()=>{playResolved=true;resolve();};})();
  result=await job.ready;assert.strictEqual(result.actualMediaTime,0.7);assert.strictEqual(playResolved,false,'first frame must not wait for play Promise');
  h.resolvePlay();await tick();assert.strictEqual(h.video.pauses,1);job.cancel();clean(h);

  h=fixture();job=h.start();job.cancel();assert.deepStrictEqual(await job.ready,{cancelled:true});clean(h);
  h.resolvePlay();await tick();assert.strictEqual(h.track.requests,1);late(h);

  h=fixture();job=h.start();h.metadata();h.resolvePlay();await tick();job.cancel();clean(h);late(h);
  let valid=true;h=fixture();job=h.start({valid:()=>valid});valid=false;h.resolvePlay();await tick();assert.deepStrictEqual(await job.ready,{cancelled:true});clean(h);
  valid=true;h=fixture();job=h.start({valid:()=>valid});h.metadata();h.resolvePlay();await tick();valid=false;h.frame();assert.deepStrictEqual(await job.ready,{cancelled:true});clean(h);late(h);
  h=fixture();job=h.start({valid:()=>false});assert.deepStrictEqual(await job.ready,{cancelled:true});assert.strictEqual(h.track.stops,0);assert.strictEqual(h.video.srcObject,null);

  h=fixture();job=h.start();h.rejectPlay(Error('autoplay denied'));await assert.rejects(job.ready,/无法开始/);clean(h);late(h);
  h=fixture({play(){throw Error('play failed synchronously');}});job=h.start();await assert.rejects(job.ready,/play failed synchronously/);clean(h);late(h);
  h=fixture();job=h.start();h.video.emit('error');await assert.rejects(job.ready,/输出失败/);clean(h);h.resolvePlay();await tick();late(h);
  h=fixture();job=h.start();h.timeout();await assert.rejects(job.ready,/超时/);clean(h);h.resolvePlay();await tick();late(h);
  h=fixture();job=h.start();h.metadata();h.resolvePlay();await tick();h.video.videoWidth=10;h.frame();await assert.rejects(job.ready,/尺寸已变化/);clean(h);late(h);
  for(const time of [-1,NaN,undefined]){
    h=fixture();job=h.start();h.metadata();h.resolvePlay();await tick();h.frame(time===undefined?NaN:time);await assert.rejects(job.ready,/尚未确认/);clean(h);late(h);
  }
  h=fixture();h.track.requestFrame=()=>{throw Error('request failed');};job=h.start();h.metadata();h.resolvePlay();await tick();await assert.rejects(job.ready,/request failed/);clean(h);late(h);
  h=fixture();delete h.track.requestFrame;job=h.start();await assert.rejects(job.ready,/不支持手动/);assert.strictEqual(h.track.stops,1);cleanWait(h);
  h=fixture();h.stream.getVideoTracks=()=>[];job=h.start();await assert.rejects(job.ready,/不支持手动/);assert.strictEqual(h.track.stops,1);cleanWait(h);
  h=fixture();h.ctx.drawImage=()=>{throw Error('redraw failed');};job=h.start();await assert.rejects(job.ready,/redraw failed/);clean(h);assert.strictEqual(h.states.length,0,'draw failure restores Canvas state');late(h);
  h=fixture();delete h.ctx.resetTransform;job=h.start();await assert.rejects(job.ready,/不支持保持画布/);assert.strictEqual(h.track.stops,0);cleanWait(h);
  for(const key of ['captureStream','requestVideoFrameCallback','cancelVideoFrameCallback']){
    h=fixture();delete (key==='captureStream'?h.canvas:h.video)[key];job=h.start();await assert.rejects(job.ready,/不支持/);assert.strictEqual(h.track.stops,0);cleanWait(h);
  }
  for(const [width,height] of [[0,1080],[1921,1080],[1920,1081],[1919,1080],[1920,1079],[NaN,1080]]){
    h=fixture();Object.assign(h.canvas,{width,height});job=h.start();await assert.rejects(job.ready,/偶数尺寸/);assert.strictEqual(h.track.stops,0);cleanWait(h);
  }
  h=fixture();h.video.srcObject={old:true};job=h.start();await assert.rejects(job.ready,/仍有旧流/);assert.deepStrictEqual(h.video.srcObject,{old:true});assert.strictEqual(h.track.stops,0);cleanWait(h);
  console.log('Evolution display-output metadata and one-frame lifecycle models passed (not Eagle color verification).');
})().catch(error=>{console.error(error);process.exitCode=1;});
