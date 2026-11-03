'use strict';
// Interaction/ownership model only. Timing numbers here are not performance evidence.
const assert=require('node:assert/strict'),{test}=require('node:test');
const index=require('../plugin/frame-index.cjs');
global.EVAPlaybackCommon=require('../plugin/playback-common.js');
global.EVAPlayer=global.EVAPlaybackCommon;
global.ImageData=class ImageData{constructor(data,width,height){if(data.length!==width*height*4)throw Error('bad fake image');Object.assign(this,{data,width,height});}};
function canvas(){
 const c={width:1,height:1,style:{},draws:[],visibilityWrites:[]};let visibility;
 Object.defineProperty(c.style,'visibility',{get:()=>visibility,set:value=>{visibility=value;c.visibilityWrites.push(value);}});
 const ctx={image:null,putImageData(im){this.image=im;c.draws.push(im.data[0]);},drawImage(source){this.image=source.getContext().image;},getImageData(x,y,w,h){return new ImageData(new Uint8ClampedArray(w*h*4).fill(this.image?.data[0]||0),w,h);}};
 c.getContext=()=>ctx;return c;
}
global.document={createElement(type){if(type!=='canvas')throw Error('Unexpected DOM element '+type);return canvas();}};
const {Player}=require('../plugin/native-player.js');
const turn=()=>new Promise(r=>setImmediate(r));
function reader(name){
 const r={name,requests:[],cancels:0,closed:0,
  request(ordinal){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});this.requests.push({ordinal,resolve,reject,promise});return promise;},
  complete(at=this.requests.length-1){const q=this.requests[at];if(!q||q.done)throw Error('No pending fake request');q.done=true;q.resolve({status:'exact',pixels:Buffer.from([q.ordinal,0,0,255]),metrics:{width:1,height:1}});},
  cancel(){this.cancels++;},snapshot(){return {closed:!!this.closed};}
 };return r;
}
async function fixture(options={}){
 let now=0,next=0;const callbacks=new Map(),primary=reader('source'),proxies=[],closed=[],view=options.canvas||canvas(),changes=[];
 let listener=null,asset=null;
 const runtime={nativeBytes:4096,
  async createReader({proxy=false}={}){if(!proxy)return primary;const r=reader('proxy-'+proxies.length);proxies.push(r);return r;},
  async closeReader(r){r.closed++;closed.push(r.name);for(const q of r.requests)if(!q.done){q.done=true;q.resolve({status:'closed'});}return {ack:{cacheBytes:0,liveDecoders:0}};},
  subscribeProxy(fn){listener=fn;return()=>{listener=null;};},proxyAsset(){return asset;},
  publish(){asset={filePath:'verified-proxy.mp4'};listener?.();}
 };
 if(options.audioTrack){runtime.audioTrack=options.audioTrack;runtime.cancelAudio=options.cancelAudio||(()=>{});}
 const points=options.frameCount?Array.from({length:options.frameCount},(_,n)=>100+n):[100,117,150,200];
 const frames=index.buildIndex(points.map((pts,id)=>({id:pts,ptsTicks:String(pts),file:'frame-'+id,bytes:1})),{timeBase:[1,1000],lastFrameEndTicks:options.frameCount?String(100+options.frameCount):'250'});
 const info={width:1,height:1,duration:frames.videoDuration,frames:frames.frames,source:{filePath:'D:/source.mp4'},metrics:{sourceVideoOrigin:options.origin??.1}};
 const audio={paused:true,ended:false,currentTime:0,playbackRate:1,playCount:0,pause(){this.paused=true;},async play(){this.playCount++;this.paused=false;},removeAttribute(){},load(){}};
 if(options.eventAudio){
  let time=0;const listeners=new Map();audio.seeking=false;audio.pauseCount=0;audio.playGates=[];audio.playRejects=[];
  Object.defineProperty(audio,'currentTime',{get:()=>time,set:value=>{if(Math.abs(value-time)>.000001){time=value;audio.seeking=true;}}});
  audio.addEventListener=(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);};
  audio.removeEventListener=(name,fn)=>listeners.get(name)?.delete(fn);
  audio.listenerCount=()=>[...listeners.values()].reduce((sum,items)=>sum+items.size,0);
  audio.completeSeek=()=>{audio.seeking=false;for(const fn of [...(listeners.get('seeked')||[])])fn();};
  audio.pause=()=>{audio.pauseCount++;audio.paused=true;};
  audio.play=()=>{audio.playCount++;if(!options.deferredPlay){audio.paused=false;return Promise.resolve();}
   return new Promise((resolve,reject)=>{audio.playGates.push(()=>{audio.paused=false;resolve();});audio.playRejects.push(reject);});};
 }
 if(options.audio)info.audio={file:'audio',bytes:1,start:0,duration:info.duration,channels:2,sampleRate:48000};
 const p=new Player({nativeRuntime:runtime,frameIndex:index,canvas:view,ramBytes:options.ramBytes||64*1024,createAudio:()=>audio,
  onChange:s=>changes.push(s),env:{now:()=>now,raf:fn=>{const n=++next;callbacks.set(n,fn);return n;},caf:n=>callbacks.delete(n)}});
 const loading=p.load(info);await turn();if(!options.holdAudio){assert.equal(primary.requests.length,1);if(!options.holdInitial){primary.complete(0);await loading;}}
 return {p,primary,proxies,runtime,view,closed,changes,audio,info,loading,
  advance(seconds){now+=seconds*1000;audio.currentTime=.1+seconds;const pending=[...callbacks.values()];callbacks.clear();for(const fn of pending)fn(now);},
  advanceSilent(seconds){now+=seconds*1000;const pending=[...callbacks.values()];callbacks.clear();for(const fn of pending)fn(now);},
  rafPending:()=>callbacks.size,
  async cleanup(){await p.dispose();await turn();}};
}
test('late seek result cannot replace the newest target or picture',{timeout:2000},async()=>{
 const h=await fixture();try{
  const a=h.p.seek(.017),b=h.p.seek(.05);assert.equal(h.p.snapshot().targetTime,.05);assert.equal(h.view.style.visibility,'visible');assert.equal(h.p.snapshot().frameHeld,true);
  h.primary.complete(1);assert.equal((await a).status,'superseded');assert.equal(h.p.snapshot().targetTime,.05);assert.equal(h.p.snapshot().frameId,117);assert.equal(h.p.snapshot().frameHeld,true);
  h.primary.complete(2);assert.equal((await b).status,'drawn');assert.equal(h.p.snapshot().frameId,150);assert.equal(h.view.draws.at(-1),2);
 }finally{await h.cleanup();}
});
test('RAM hit cancels old native work and late completion cannot repaint',{timeout:2000},async()=>{
 const h=await fixture();try{
  const old=h.p.seek(.05),before=h.primary.cancels,r=await h.p.seek(0);assert.equal(r.status,'reused');assert.equal(h.primary.cancels,before+1);
  h.primary.complete(1);assert.equal((await old).status,'superseded');assert.equal(h.p.snapshot().frameId,100);assert.equal(h.view.draws.at(-1),0);
 }finally{await h.cleanup();}
});
test('record completion cannot release the foreground decoder ownership',{timeout:2000},async()=>{
 const h=await fixture();try{
  h.p.primeRecords([3]);await turn();assert.equal(h.primary.requests[1].ordinal,3);
  const foreground=h.p.seek(.05);assert.equal(h.p.snapshot().activeImageTasks,1);
  h.primary.complete(1);await turn();assert.equal(h.p.snapshot().activeImageTasks,1);assert.equal(h.p.snapshot().frameId,100);
  h.primary.complete(2);await foreground;assert.equal(h.p.snapshot().frameId,150);assert(!h.view.draws.includes(3));
 }finally{await h.cleanup();}
});
test('playback takes priority over a waiting record and uses the original audio clock',{timeout:2000},async()=>{
 const h=await fixture({audio:true});try{
  h.p.primeRecords([3]);await turn();const before=h.primary.cancels;
  assert.equal((await h.p.play()).status,'playing');assert(h.primary.cancels>before);assert.equal(h.audio.playCount,1);assert.equal(h.audio.currentTime,.1);
  h.advance(.05);assert.equal(h.primary.requests[2].ordinal,2);
  h.primary.complete(1);await turn();assert.equal(h.p.snapshot().activeImageTasks,1);
  h.primary.complete(2);await turn();assert.equal(h.p.snapshot().frameId,150);assert.equal(h.p.snapshot().state,'playing');
 }finally{await h.cleanup();}
});
test('proxy old-frame completion cannot jump back after a new target',{timeout:2000},async()=>{
 const h=await fixture();try{
  h.runtime.publish();await turn();assert.equal(h.proxies.length,1);assert.equal(h.proxies[0].requests[0].ordinal,0);
  const newer=h.p.seek(.05);h.primary.complete(1);await newer;h.proxies[0].complete(0);await turn();
  assert.equal(h.p.snapshot().frameId,150);assert.equal(h.p.snapshot().targetTime,.05);assert(!h.view.draws.slice(1).includes(0));
 }finally{await h.cleanup();}
});
test('dispose closes pending work and releases all managed reservations',{timeout:2000},async()=>{
 const h=await fixture();const pending=h.p.seek(.05),draws=h.view.draws.length;
 await h.p.dispose();assert.equal((await pending).status,'superseded');assert.equal(h.p.snapshot().state,'disposed');assert.equal(h.p.snapshot().budget.used,0);
 assert.equal(h.primary.closed,1);assert.equal(h.view.draws.length,draws);
});
test('transport retains rate, loop validity and source frame identities',{timeout:2000},async()=>{
 const h=await fixture();try{
  await h.p.setPlaybackRate(2.5);const applying=h.p.applyLoopRange({startOrdinal:1,endOrdinal:3});h.primary.complete(1);await applying;
  const t=h.p.transportSnapshot();assert.equal(t.rate,2.5);assert.equal(t.loop.valid,true);assert.equal(t.loop.startId,117);assert.equal(t.loop.endId,200);
  await h.p.restoreTransport({rate:.5,loop:{...t.loop,enabled:false}});assert.equal(h.p.transportSnapshot().rate,.5);assert.equal(h.p.transportSnapshot().loop.enabled,false);
  await assert.rejects(async()=>h.p.restoreTransport({rate:1,loop:{...t.loop,startId:999}}),/源帧|身份|source/i);
 }finally{await h.cleanup();}
});
async function promptly(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('operation stayed pending after cancellation')),150);})]);}finally{clearTimeout(timer);}}
test('pause settles an event-driven pending audio seek immediately',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true});try{
  const starting=h.p.play();await turn();assert.equal(h.audio.seeking,true);assert.equal(h.audio.listenerCount(),2);
  await h.p.pause();assert.equal((await promptly(starting)).status,'superseded');assert.equal(h.audio.playCount,0);
  assert.equal(h.audio.listenerCount(),0);assert.equal(h.p.snapshot().state,'paused');assert.equal(h.p.snapshot().lastIssue,null);
 }finally{await h.cleanup();}
});
test('dispose settles a pending audio seek without waiting its error timeout',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true}),starting=h.p.play();await turn();assert.equal(h.audio.seeking,true);
 await promptly(h.p.dispose());assert.equal((await promptly(starting)).status,'superseded');assert.equal(h.audio.playCount,0);
 assert.equal(h.audio.listenerCount(),0);assert.equal(h.p.snapshot().budget.used,0);
});
test('an older delayed audio play cannot pause a newer successful play',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true,deferredPlay:true});try{
  const first=h.p.play();await turn();h.audio.completeSeek();await turn();assert.equal(h.audio.playGates.length,1);
  const second=h.p.play();await turn();assert.equal(h.audio.playGates.length,2);h.audio.playGates[1]();assert.equal((await promptly(second)).status,'playing');
  const pauses=h.audio.pauseCount;h.audio.playGates[0]();assert.equal((await promptly(first)).status,'superseded');
  assert.equal(h.audio.pauseCount,pauses);assert.equal(h.audio.paused,false);assert.equal(h.p.snapshot().state,'playing');
 }finally{await h.cleanup();}
});
test('confirming a complete clip locates its source start and automatically plays',{timeout:2000},async()=>{
 const h=await fixture();try{
  const confirming=h.p.applyLoopRange({startOrdinal:1,endOrdinal:3});h.primary.complete(1);
  assert.equal((await confirming).status,'playing');const s=h.p.snapshot();assert.equal(s.state,'playing');assert.equal(s.frameId,117);
  assert.equal(s.transport.loop.enabled,true);assert.equal(s.transport.loop.startId,117);assert.equal(s.transport.loop.endId,200);
 }finally{await h.cleanup();}
});
test('pause during clip confirmation leaves the previous range and does not resume',{timeout:2000},async()=>{
 const h=await fixture();try{
  const confirming=h.p.applyLoopRange({startOrdinal:1,endOrdinal:3});await h.p.pause();h.primary.complete(1);
  assert.equal((await confirming).status,'superseded');assert.equal(h.p.snapshot().state,'paused');assert.equal(h.p.transportSnapshot().loop.enabled,false);assert.equal(h.p.transportSnapshot().loop.startId,null);
 }finally{await h.cleanup();}
});
for(const playing of [false,true])test('enabling a clip outside its range locates the start and '+(playing?'resumes prior playback':'preserves pause'),{timeout:2000},async()=>{
 const h=await fixture();try{
  await h.p.restoreTransport({rate:1,loop:{startOrdinal:1,endOrdinal:3,startId:117,endId:200,enabled:false}});if(playing)await h.p.play();
  const enabling=h.p.setLoopEnabled(true);await turn();assert.equal(h.primary.requests[1].ordinal,1);h.primary.complete(1);await enabling;
  const s=h.p.snapshot();assert.equal(s.frameId,117);assert.equal(s.transport.loop.enabled,true);assert.equal(s.state,playing?'playing':'paused');
 }finally{await h.cleanup();}
});
test('a newer seek supersedes a pending clip confirmation without auto playback',{timeout:2000},async()=>{
 const h=await fixture();try{
  const confirming=h.p.applyLoopRange({startOrdinal:1,endOrdinal:3}),newer=h.p.seek(.05);h.primary.complete(1);assert.equal((await confirming).status,'superseded');
  h.primary.complete(2);await newer;assert.equal(h.p.snapshot().frameId,150);assert.equal(h.p.snapshot().targetTime,.05);assert.equal(h.p.snapshot().state,'paused');assert.equal(h.p.transportSnapshot().loop.enabled,false);
 }finally{await h.cleanup();}
});
async function reachPendingWrap(h){
 await h.p.restoreTransport({rate:1,loop:{startOrdinal:1,endOrdinal:2,startId:117,endId:150,enabled:true}});
 const atEnd=h.p.seek(.05);h.primary.complete(1);await atEnd;await h.p.play();h.advance(.06);await turn();
 assert.equal(h.primary.requests[2].ordinal,1);assert.equal(h.p.snapshot().pendingTargets,1);
}
test('a completed loop wrap resumes playback at the exact start',{timeout:2000},async()=>{
 const h=await fixture();try{
  await reachPendingWrap(h);h.primary.complete(2);await turn();assert.equal(h.p.snapshot().state,'playing');assert.equal(h.p.snapshot().frameId,117);
 }finally{await h.cleanup();}
});
test('pause while a loop wrap is locating the start prevents late auto resume',{timeout:2000},async()=>{
 const h=await fixture();try{
  await reachPendingWrap(h);await h.p.pause();h.primary.complete(2);await turn();assert.equal(h.p.snapshot().state,'paused');
 }finally{await h.cleanup();}
});
test('a new seek during loop wrap keeps the newest target paused',{timeout:2000},async()=>{
 const h=await fixture();try{
  await reachPendingWrap(h);assert.equal((await h.p.seek(0)).status,'reused');h.primary.complete(2);await turn();
  assert.equal(h.p.snapshot().state,'paused');assert.equal(h.p.snapshot().frameId,100);assert.equal(h.p.snapshot().targetTime,0);
 }finally{await h.cleanup();}
});
test('consecutive uncached seeks keep confirmed pixels visible and preserve actual identity',{timeout:2000},async()=>{
 const h=await fixture();try{
  h.view.visibilityWrites.length=0;const a=h.p.seek(.017),b=h.p.seek(.05),c=h.p.seek(.1);
  const pending=h.p.snapshot();assert.equal(pending.frameHeld,true);assert.equal(pending.frameId,100);assert.equal(pending.time,0);assert.equal(pending.targetTime,.1);
  assert.equal(h.view.style.visibility,'visible');assert(!h.view.visibilityWrites.includes('hidden'));
  h.primary.complete(1);await a;assert.equal(h.primary.requests.length,3);h.primary.complete(2);await c;await b;
  assert.equal(h.p.snapshot().frameId,200);assert.equal(h.p.snapshot().frameHeld,false);assert(!h.view.visibilityWrites.includes('hidden'));
 }finally{await h.cleanup();}
});
test('a RAM target clears held status without hiding or accepting an older completion',{timeout:2000},async()=>{
 const h=await fixture();try{
  h.view.visibilityWrites.length=0;const old=h.p.seek(.05);assert.equal(h.p.snapshot().frameHeld,true);
  await h.p.seek(0);assert.equal(h.p.snapshot().frameHeld,false);h.primary.complete(1);await old;
  assert.equal(h.p.snapshot().frameId,100);assert.equal(h.p.snapshot().targetTime,0);assert.equal(h.p.snapshot().frameHeld,false);assert(!h.view.visibilityWrites.includes('hidden'));
 }finally{await h.cleanup();}
});
for(const synchronous of [false,true])test((synchronous?'synchronous request throw':'rejected request')+' settles seeking while retaining held-frame protection',{timeout:2000},async()=>{
 const h=await fixture();try{
  if(synchronous)h.primary.request=()=>{throw Error('reader sync failure');};
  const seeking=h.p.seek(.05);if(!synchronous){h.primary.requests[1].done=true;h.primary.requests[1].reject(Error('reader async failure'));}
  assert.equal((await seeking).status,'error');const s=h.p.snapshot();assert.equal(s.pendingTargets,0);assert.equal(s.activeImageTasks,0);assert.equal(s.state,'paused');
  assert.equal(s.frameHeld,true);assert.equal(s.frameId,100);assert.equal(s.time,0);assert.equal(s.targetTime,.05);assert.equal(h.view.style.visibility,'visible');
  h.runtime.publish();await turn();assert.equal(h.proxies.length,0,'proxy may not declare a failed target ready by resubmitting the old actual frame');
  await h.p.seek(0);assert.equal(h.p.snapshot().frameHeld,false);assert.equal(h.p.snapshot().lastIssue,null);
 }finally{await h.cleanup();}
});
test('an older response after the latest request failed cannot clear held-frame protection',{timeout:2000},async()=>{
 const h=await fixture();try{
  const old=h.p.seek(.017),newer=h.p.seek(.05,{final:true});h.primary.requests[2].done=true;h.primary.requests[2].reject(Error('latest target failed'));await newer;
  h.primary.complete(1);assert.equal((await old).status,'superseded');const s=h.p.snapshot();assert.equal(s.frameHeld,true);assert.equal(s.frameId,100);assert.equal(s.targetTime,.05);assert.equal(s.lastIssue,'latest target failed');
 }finally{await h.cleanup();}
});
test('a fresh source hides a shared previous-source canvas until its own first confirmed frame',{timeout:2000},async()=>{
 const view=canvas();view.getContext().putImageData(new ImageData(new Uint8ClampedArray([99,0,0,255]),1,1));view.style.visibility='visible';
 const h=await fixture({canvas:view,holdInitial:true});try{
  assert.equal(view.style.visibility,'hidden');assert.equal(h.p.snapshot().frameId,null);assert.equal(h.p.snapshot().frameHeld,true);
  h.primary.complete(0);await h.loading;assert.equal(view.style.visibility,'visible');assert.equal(view.draws.at(-1),0);assert.equal(h.p.snapshot().frameId,100);assert.equal(h.p.snapshot().frameHeld,false);
 }finally{await h.cleanup();}
});
test('a cached confirmed target retries a ready proxy blocked during held failure',{timeout:2000},async()=>{
 const h=await fixture();try{
  const failed=h.p.seek(.05);h.primary.requests[1].done=true;h.primary.requests[1].reject(Error('target failed'));await failed;
  h.runtime.publish();await turn();assert.equal(h.proxies.length,0);assert.equal(h.p.snapshot().frameHeld,true);
  assert.equal((await h.p.seek(0)).status,'reused');await turn();assert.equal(h.proxies.length,1);assert.equal(h.proxies[0].requests[0].ordinal,0);
  h.runtime.publish();await turn();assert.equal(h.proxies.length,1,'completion notifications cannot start parallel candidates');
  h.proxies[0].complete(0);await turn();assert.equal(h.p.snapshot().proxyActive,true);assert.equal(h.p.snapshot().frameId,100);assert.equal(h.p.snapshot().targetTime,0);assert.equal(h.p.snapshot().frameHeld,false);
 }finally{await h.cleanup();}
});
test('a new cached intent replaces a proxy candidate without overlap or target rollback',{timeout:2000},async()=>{
 const h=await fixture();try{
  const warm=h.p.seek(.017);h.primary.complete(1);await warm;
  const failed=h.p.seek(.1);h.primary.requests[2].done=true;h.primary.requests[2].reject(Error('target failed'));await failed;h.runtime.publish();await turn();
  await h.p.seek(0);await turn();assert.equal(h.proxies.length,1);assert.equal(h.proxies[0].requests[0].ordinal,0);
  await h.p.seek(.017);const afterNew=h.view.draws.length;assert.equal(h.proxies.length,1);
  h.proxies[0].complete(0);await turn();assert.equal(h.p.snapshot().frameId,117);assert.equal(h.p.snapshot().targetTime,.017);assert(!h.view.draws.slice(afterNew).includes(0));
  assert.equal(h.proxies[0].closed,1);assert.equal(h.proxies.filter(r=>!r.closed).length,1);assert.equal(h.proxies[1].requests[0].ordinal,1);
  h.proxies[1].complete(0);await turn();assert.equal(h.p.snapshot().proxyActive,true);assert.equal(h.p.snapshot().frameId,117);assert.equal(h.p.snapshot().targetTime,.017);
 }finally{await h.cleanup();}
});
test('pending or failed held frames cannot be fixed as clip endpoints',{timeout:2000},async()=>{
 const h=await fixture();try{
  assert.equal((await h.p.setLoopPoint('start')).status,'applied');assert.equal(h.p.transportSnapshot().loop.startId,100);
  const waiting=h.p.seek(.05);assert.deepEqual(await h.p.setLoopPoint('end'),{status:'ignored',reason:'frame-not-ready'});assert.equal(h.p.transportSnapshot().loop.endId,null);
  h.primary.requests[1].done=true;h.primary.requests[1].reject(Error('target failed'));await waiting;
  assert.deepEqual(await h.p.setLoopPoint('end'),{status:'ignored',reason:'frame-not-ready'});assert.equal(h.p.transportSnapshot().loop.endId,null);
  const retry=h.p.seek(.05);h.primary.complete(2);await retry;assert.equal((await h.p.setLoopPoint('end')).status,'applied');
  assert.equal(h.p.transportSnapshot().loop.endId,150);assert.equal(h.p.transportSnapshot().loop.valid,true);
 }finally{await h.cleanup();}
});

// The old exact-clock gate discarded every late image and visibly froze playback.
test('continuous playback displays a late valid frame and never paints backwards',async()=>{
 const h=await fixture({audio:true});try{await h.p.play();h.advance(.017);const q=h.primary.requests.length-1;assert.equal(h.primary.requests[q].ordinal,1);
  h.advance(.05);h.primary.complete(q);await turn();assert.equal(h.p.snapshot().frameId,117);assert.equal(h.p.snapshot().state,'playing');
  h.advance(.07);const next=h.primary.requests.length-1;await h.p.pause();h.primary.complete(next);await turn();assert.equal(h.p.snapshot().frameId,117);
 }finally{await h.cleanup();}
});


// E46 transport responsiveness: decoder/audio gates are deliberately held, so
// a fast return cannot merely be a lucky warm decoder completion.
test('play starts while lookahead frames remain unready instead of waiting for four serial decodes',{timeout:2000},async()=>{
 const h=await fixture();try{
  h.p.setForwardPredecode(true);const at=h.primary.requests.length;
  assert.equal((await promptly(h.p.play())).status,'playing');assert.equal(h.p.snapshot().state,'playing');
  assert.equal(h.primary.requests.length,at+1);assert.equal(h.primary.requests.at(-1).ordinal,1);
  assert.equal(h.p.cache.has(1),false,'unready lookahead must not gate the play response');
  await promptly(h.p.pause());assert.equal(h.p.snapshot().state,'paused');assert.equal(h.p.snapshot().activeImageTasks,0);
  h.primary.complete(h.primary.requests.length-1);await turn();assert.equal(h.p.snapshot().frameOrdinal,0);
 }finally{await h.cleanup();}
});

test('play intent is immediately pausable while native audio seek is pending',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true});try{
  const starting=h.p.play();await turn();assert.equal(h.audio.seeking,true);assert.equal(h.p.snapshot().state,'playing');
  await promptly(h.p.pause());assert.equal(h.p.snapshot().state,'paused');assert.equal((await promptly(starting)).status,'superseded');
  assert.equal(h.audio.playCount,0);assert.equal(h.audio.listenerCount(),0);
 }finally{await h.cleanup();}
});

test('pause and resume reuse a valid audio cursor without rewinding it to the previous picture',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true});try{
  h.audio.completeSeek();assert.equal((await promptly(h.p.play())).status,'playing');
  h.advance(.011);h.audio.completeSeek();assert.equal(h.p.snapshot().frameOrdinal,0);await h.p.pause();
  assert.equal(h.audio.currentTime,.111);assert.equal((await promptly(h.p.play())).status,'playing');
  assert.equal(h.audio.currentTime,.111);assert.equal(h.audio.listenerCount(),0);assert.equal(h.audio.playCount,2);
 }finally{await h.cleanup();}
});

test('E49 paused audio cursor settling never forces a new source seek on unchanged-picture resume',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true});try{
  h.audio.completeSeek();await h.p.play();h.advance(.011);h.audio.completeSeek();await h.p.pause();
  h.audio.currentTime=.116;h.audio.completeSeek();const cursor=h.audio.currentTime;
  assert.equal((await promptly(h.p.play())).status,'playing');assert.equal(h.audio.currentTime,cursor);assert.equal(h.audio.seeking,false);assert.equal(h.audio.listenerCount(),0);
 }finally{await h.cleanup();}
});

test('E49 audio completion anchors the silent tail at its current cursor instead of the original play input',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true,deferredPlay:true});try{
  for(let n=1;n<h.info.frames.length;n++)h.p._entry(n,{pixels:Buffer.from([n,0,0,255]),metrics:{width:1,height:1}});
  h.audio.completeSeek();const starting=h.p.play();await turn();h.audio.paused=false;h.advance(.06);h.audio.completeSeek();h.audio.playGates[0]();await starting;
  assert(Math.abs(h.p.anchor.time-.06)<1e-9);h.audio.ended=true;h.advanceSilent(.01);assert(Math.abs(h.p._clock()-.07)<1e-9);
 }finally{await h.cleanup();}
});

test('final seeks preposition paused audio alongside picture decoding and invalidate the old resume cursor',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true});try{
  h.audio.completeSeek();await h.p.play();h.advance(.011);h.audio.completeSeek();await h.p.pause();
  const locating=h.p.seek(.05,{final:true});assert(Math.abs(h.audio.currentTime-.15)<1e-9);assert.equal(h.audio.seeking,true);
  h.audio.completeSeek();h.primary.complete(h.primary.requests.length-1);await locating;
  assert.equal(h.p.snapshot().frameOrdinal,2);assert.equal((await promptly(h.p.play())).status,'playing');
  assert(Math.abs(h.audio.currentTime-.15)<1e-9);assert.equal(h.audio.listenerCount(),0);
 }finally{await h.cleanup();}
});

test('a delayed audio play completion after pause is stopped and cannot restart sound',{timeout:2000},async()=>{
 const h=await fixture({audio:true,eventAudio:true,deferredPlay:true});try{
  h.audio.completeSeek();const starting=h.p.play();await turn();assert.equal(h.audio.playGates.length,1);
  await h.p.pause();const pauses=h.audio.pauseCount;h.audio.playGates[0]();assert.equal((await promptly(starting)).status,'superseded');
  assert.equal(h.audio.paused,true);assert.equal(h.audio.pauseCount,pauses+1);assert.equal(h.p.snapshot().state,'paused');
 }finally{await h.cleanup();}
});

test('E49 verified proxy and resident pictures follow an advancing audio clock before play promise settles',async()=>{
 const h=await fixture({audio:true,eventAudio:true,deferredPlay:true});try{
  h.audio.completeSeek();for(let n=1;n<h.info.frames.length;n++)h.p._entry(n,{pixels:Buffer.from([n,0,0,255]),metrics:{width:1,height:1}});
  h.runtime.publish();await turn();h.proxies[0].complete();await h.p.switchTask;assert.equal(h.p.proxyActive,true);
  let settled=false;const starting=h.p.play().then(r=>{settled=true;return r;});await turn();assert.equal(settled,false);assert.equal(h.rafPending(),1);
  const requests=h.proxies[0].requests.length;h.advance(.017);assert.equal(h.p.snapshot().frameOrdinal,1);assert.equal(settled,false);assert.equal(h.proxies[0].requests.length,requests);
  h.audio.playGates[0]();assert.equal((await starting).status,'playing');assert.equal(h.rafPending(),1,'Promise settlement must not start a second animation chain');
 }finally{await h.cleanup();}
});
test('E49 a pending paused audio clock never lets cached video run ahead on the free clock',async()=>{
 const h=await fixture({audio:true,eventAudio:true,deferredPlay:true});try{
  h.audio.completeSeek();for(let n=1;n<h.info.frames.length;n++)h.p._entry(n,{pixels:Buffer.from([n,0,0,255]),metrics:{width:1,height:1}});
  const starting=h.p.play();await turn();assert.equal(h.audio.paused,true);const draws=h.p.drawCount;
  h.advanceSilent(.08);assert.equal(h.p.snapshot().frameOrdinal,0);assert.equal(h.p.drawCount,draws);assert.equal(h.rafPending(),1);
  h.audio.playGates[0]();await starting;assert.equal(h.rafPending(),1);
 }finally{await h.cleanup();}
});
test('E49 audio start rejection stops the active picture loop and invalidates late decoded pictures',async()=>{
 const h=await fixture({audio:true,eventAudio:true,deferredPlay:true});try{
  h.audio.completeSeek();const starting=h.p.play();await turn();assert.equal(h.rafPending(),1);h.advance(.017);const request=h.primary.requests.length-1,draws=h.p.drawCount;assert.equal(h.primary.requests[request].ordinal,1);
  h.audio.playRejects[0](Error('play denied'));assert.equal((await starting).status,'error');assert.equal(h.p.snapshot().state,'paused');assert.match(h.p.lastIssue,/play denied/);
  assert.equal(h.audio.paused,true);assert.equal(h.rafPending(),0);assert.equal(h.p.snapshot().activeImageTasks,0);assert.equal(h.p.audioStartToken,null);
  h.primary.complete(request);await turn();assert.equal(h.p.drawCount,draws);assert.equal(h.rafPending(),0);
 }finally{await h.cleanup();}
});
test('E49 an older rejected audio start cannot stop a newer playing clock or its rAF chain',async()=>{
 const h=await fixture({audio:true,eventAudio:true,deferredPlay:true});try{
  h.audio.completeSeek();const first=h.p.play();await turn();const second=h.p.play();await turn();h.audio.playGates[1]();assert.equal((await second).status,'playing');const pauses=h.audio.pauseCount;
  h.audio.playRejects[0](Error('obsolete rejection'));assert.equal((await first).status,'superseded');assert.equal(h.audio.pauseCount,pauses);assert.equal(h.p.state,'playing');assert.equal(h.rafPending(),1);
 }finally{await h.cleanup();}
});
test('E49 closing a pending audio start clears its picture loop and late completion cannot revive it',async()=>{
 const h=await fixture({audio:true,eventAudio:true,deferredPlay:true});
 h.audio.completeSeek();const starting=h.p.play();await turn();assert.equal(h.rafPending(),1);const draws=h.p.drawCount;await h.cleanup();
 assert.equal(h.rafPending(),0);assert.equal(h.p.budget.used,0);h.audio.playGates[0]();assert.equal((await starting).status,'superseded');assert.equal(h.audio.paused,true);assert.equal(h.p.drawCount,draws);
});


test('E47 resident native frames publish one atomic ready notification and do not cancel an idle decoder',async()=>{
 const h=await fixture();try{
  const preparing=h.p.seek(.017);h.primary.complete();await preparing;
  h.changes.length=0;const cancels=h.primary.cancels,requests=h.primary.requests.length;
  assert.equal((await h.p.seek(0,{kind:'rapid',final:false})).status,'reused');
  assert.equal(h.changes.length,1);assert.equal(h.changes[0].state,'paused');assert.equal(h.changes[0].frameHeld,false);assert.equal(h.changes[0].pendingTargets,0);assert.equal(h.changes[0].frameOrdinal,0);
  assert.equal(h.primary.cancels,cancels);assert.equal(h.primary.requests.length,requests);
 }finally{await h.cleanup();}
});
test('E47 repeated native RAM target settles without uploading or repainting the same picture',async()=>{
 const h=await fixture();try{const draws=h.p.drawCount,cancels=h.primary.cancels;h.changes.length=0;
  for(let n=0;n<40;n++)assert.equal((await h.p.seek(.001,{kind:'rapid',final:false})).status,'reused');
  assert.equal(h.p.drawCount,draws);assert.equal(h.primary.cancels,cancels);assert.equal(h.changes.length,40);assert.equal(h.p.snapshot().targetTime,.001);assert.equal(h.p.snapshot().frameHeld,false);
 }finally{await h.cleanup();}
});
test('E47 misses retain immediate held-frame protection; a synchronous newer intent prevents stale native work',async()=>{
 const h=await fixture();try{let armed=true;h.p.o.onChange=s=>{h.changes.push(s);if(armed&&s.state==='seeking'){armed=false;h.p.seek(0,{kind:'rapid'});}};
  const before=h.primary.requests.length;assert.equal((await h.p.seek(.05,{kind:'rapid'})).status,'superseded');
  const held=h.changes.find(s=>s.state==='seeking');assert(held);assert.equal(held.frameHeld,true);assert.equal(held.pendingTargets,1);assert.equal(h.primary.requests.length,before);assert.equal(h.p.snapshot().frameOrdinal,0);assert.equal(h.p.snapshot().frameHeld,false);
 }finally{await h.cleanup();}
});

// Explicitly advance idle boundaries; these are ownership/budget models, not
// measurements of native decoder throughput or Eagle presentation latency.
function stopFillTimer(p){clearTimeout(p.fillTimer);p.fillTimer=undefined;}
function beginFill(h){stopFillTimer(h.p);h.p._fillAround();}
async function completeFill(h,r=h.primary){const task=h.p.fillTask;r.complete();await task;stopFillTimer(h.p);}
test('E48 paused native inspection fills a finite source-time window and stops',async()=>{
 const h=await fixture();try{h.p.setForwardPredecode(true);stopFillTimer(h.p);const draws=h.p.drawCount;
  for(let i=0;i<3;i++){beginFill(h);await Promise.resolve();await completeFill(h);}
  assert.equal(h.p.cache.size,4);assert.equal(h.p.drawCount,draws);assert.equal(h.p.snapshot().frameOrdinal,0);
  const requests=h.primary.requests.length;beginFill(h);await Promise.resolve();assert.equal(h.primary.requests.length,requests);assert.equal(h.p.fillStatus,'ready');assert.equal(h.p.fillTimer,undefined);
  assert(h.p.budget.peak<=h.p.budget.limit);
 }finally{await h.cleanup();}
});
test('E48 continuous native RAM hits do not cancel useful single-reader fill',async()=>{
 const h=await fixture();try{h.p.setForwardPredecode(true);beginFill(h);await Promise.resolve();const cancels=h.primary.cancels,request=h.primary.requests.at(-1),draws=h.p.drawCount;
  assert.equal(request.ordinal,1);for(let i=0;i<30;i++)assert.equal((await h.p.seek(0,{kind:'rapid'})).status,'reused');
  assert.equal(h.primary.cancels,cancels);await completeFill(h);assert(h.p.cache.has(1));assert.equal(h.p.drawCount,draws);assert.equal(h.p.snapshot().frameOrdinal,0);
 }finally{await h.cleanup();}
});
test('E48 a cold native target immediately preempts idle fill and cannot be overwritten',async()=>{
 const h=await fixture();try{h.p.setForwardPredecode(true);beginFill(h);await Promise.resolve();const fill=h.p.fillTask,cancels=h.primary.cancels,background=h.primary.requests.length-1;
  const seeking=h.p.seek(.05,{kind:'rapid'});assert.equal(h.primary.cancels,cancels+1);assert.equal(h.primary.requests.at(-1).ordinal,2);
  h.primary.complete(background);await fill;assert(!h.p.cache.has(1));assert.equal(h.p.snapshot().activeImageTasks,1);assert.equal(h.p.snapshot().frameHeld,true);
  h.primary.complete();await seeking;stopFillTimer(h.p);assert.equal(h.p.snapshot().frameOrdinal,2);assert.equal(h.p.snapshot().frameHeld,false);
 }finally{await h.cleanup();}
});
test('E48 native fill respects loop boundaries, tiny budgets and stationary convergence',async()=>{
 const h=await fixture({frameCount:40,ramBytes:6000});try{h.p.setForwardPredecode(true);stopFillTimer(h.p);
  for(let i=0;i<5;i++){beginFill(h);await Promise.resolve();if(h.p.fillTask)await completeFill(h);}
  assert.equal(h.p.cache.size,3);const warm=h.primary.requests.length;
  for(let i=0;i<8;i++){beginFill(h);await Promise.resolve();}assert.equal(h.primary.requests.length,warm);
  h.p.loopStart=20;h.p.loopEnd=22;h.p.loopEnabled=true;const locating=h.p.seek(h.info.frames[21].time,{index:21,final:true});h.primary.complete();await locating;stopFillTimer(h.p);
  const first=h.primary.requests.length;for(let i=0;i<5;i++){beginFill(h);await Promise.resolve();if(h.p.fillTask)await completeFill(h);}
  assert(h.primary.requests.slice(first).every(q=>q.ordinal>=20&&q.ordinal<=22));assert(h.p.cache.has(20)&&h.p.cache.has(21)&&h.p.cache.has(22));
  const settled=h.primary.requests.length;for(let i=0;i<8;i++){beginFill(h);await Promise.resolve();}assert.equal(h.primary.requests.length,settled);assert(h.p.budget.peak<=6000);
 }finally{await h.cleanup();}
});
test('E48 failed native fill is skipped without repeated requests or a foreground error',async()=>{
 const h=await fixture();try{h.p.setForwardPredecode(true);beginFill(h);await Promise.resolve();const task=h.p.fillTask,q=h.primary.requests.at(-1);q.done=true;q.reject(Error('background failure'));await task;stopFillTimer(h.p);
  assert.equal(h.p.snapshot().lastIssue,null);assert.equal(h.p.snapshot().forwardIssue,'background failure');
  for(let i=0;i<3;i++){beginFill(h);await Promise.resolve();if(h.p.fillTask)await completeFill(h);}
  assert.equal(h.primary.requests.filter(r=>r.ordinal===1).length,1);assert.equal(h.p.fillTimer,undefined);
 }finally{await h.cleanup();}
});
test('E48 closing during native fill releases its reservation and never draws the result',async()=>{
 const h=await fixture();h.p.setForwardPredecode(true);beginFill(h);await Promise.resolve();const draws=h.p.drawCount;assert(h.p.budget.snapshot().kinds['native-fill-pending']>0);
 await promptly(h.cleanup());assert.equal(h.p.budget.used,0);assert.equal(h.p.drawCount,draws);assert.equal(h.p.fillTimer,undefined);
});
test('E48 foreground preemption before idle dispatch cannot be superseded by the queued fill',async()=>{
 const h=await fixture();try{h.p.setForwardPredecode(true);beginFill(h);const fill=h.p.fillTask;
  const seeking=h.p.seek(.05,{kind:'rapid'});await Promise.resolve();assert.equal(h.primary.requests.length,2);assert.equal(h.primary.requests.at(-1).ordinal,2);
  h.primary.complete();await seeking;await fill;stopFillTimer(h.p);assert.equal(h.p.snapshot().frameOrdinal,2);assert.equal(h.p.snapshot().activeImageTasks,0);
 }finally{await h.cleanup();}
});
test('E48 verified proxy takeover invalidates old fill and only fills the new reader afterward',async()=>{
 const h=await fixture();try{h.p.setForwardPredecode(true);beginFill(h);await Promise.resolve();const fill=h.p.fillTask,old=h.primary.requests.at(-1);
  h.runtime.publish();await turn();h.proxies[0].complete();await h.p.switchTask;await fill;stopFillTimer(h.p);
  assert.equal(h.p.proxyActive,true);assert.equal(h.primary.closed,1);assert(!h.p.cache.has(old.ordinal));assert.equal(h.p.snapshot().frameOrdinal,0);
  beginFill(h);await Promise.resolve();assert.equal(h.proxies[0].requests.at(-1).ordinal,1);await completeFill(h,h.proxies[0]);assert(h.p.cache.has(1));assert.equal(h.p.snapshot().frameOrdinal,0);
 }finally{await h.cleanup();}
});
test('E48 record requests take the next idle slot ahead of surrounding fill',async()=>{
 const h=await fixture();try{h.p.setForwardPredecode(true);beginFill(h);await Promise.resolve();assert.equal(h.primary.requests.at(-1).ordinal,1);
  const requests=h.primary.requests.length;h.p.primeRecords([3]);assert.equal(h.primary.requests.length,requests);await completeFill(h);
  assert.equal(h.primary.requests.at(-1).ordinal,3);assert.equal(h.p.readOwner.kind,'foreground');h.primary.complete();await turn();stopFillTimer(h.p);assert(h.p.thumbCache.has(3));
 }finally{await h.cleanup();}
});
test('E48 a synchronous record-reader failure releases ownership so idle fill can continue',async()=>{
 const h=await fixture();try{const request=h.primary.request;h.primary.request=()=>{throw Error('record synchronous failure');};h.p.primeRecords([3]);await turn();
  assert.equal(h.p.readerBusy,false);assert.equal(h.p.thumbRunning,false);assert.equal(h.p.forwardIssue,'record synchronous failure');
  h.primary.request=request;h.p.setForwardPredecode(true);beginFill(h);await Promise.resolve();assert.equal(h.primary.requests.at(-1).ordinal,1);await completeFill(h);assert(h.p.cache.has(1));
 }finally{await h.cleanup();}
});

test('E49 audio-only Blob is budgeted, used without the original video and revoked on close',async()=>{
 const saved={URL:global.URL,Blob:global.Blob},revoked=[];global.Blob=class{constructor(parts,options){this.parts=parts;this.type=options.type;}};global.URL={createObjectURL(blob){assert.equal(blob.type,'audio/mp4');return 'blob:audio-unit';},revokeObjectURL:url=>revoked.push(url)};
 let h;try{h=await fixture({audio:true,origin:0,ramBytes:512*1024,audioTrack:async max=>{assert(max>=64*1024);return{bytes:Buffer.alloc(1234),mime:'audio/mp4',verification:{stream:{start_pts:'0'}}};}});
  assert.equal(h.audio.src,'blob:audio-unit');assert.equal(h.p.snapshot().audioSource,'audio-only-copy');assert.equal(h.p.budget.snapshot().kinds['audio-source'],2468);
  await h.cleanup();assert.equal(h.p.budget.used,0);assert.deepEqual(revoked,['blob:audio-unit']);
 }finally{await h?.cleanup();global.URL=saved.URL;global.Blob=saved.Blob;}
});

test('E49 unsupported independent audio safely retains original sound and releases its reservation',async()=>{
 const h=await fixture({audio:true,origin:0,ramBytes:512*1024,audioTrack:async()=>{throw Error('unsupported audio copy');}});try{
  assert.equal(h.p.snapshot().audioSource,'original');assert.match(h.audio.src,/source\.mp4/);assert.match(h.p.snapshot().audioSourceIssue,/unsupported/);
  assert.equal(h.p.budget.snapshot().kinds['audio-source-inflight'],undefined);assert.equal((await h.p.play()).status,'playing');
 }finally{await h.cleanup();}
});

test('E49 closing during independent audio preparation cancels it before Blob creation or initial draw',async()=>{
 let reject,cancelled=0;const waiting=new Promise((resolve,fail)=>{reject=fail;});const h=await fixture({audio:true,origin:0,ramBytes:512*1024,holdAudio:true,audioTrack:()=>waiting,cancelAudio(){cancelled++;reject(Object.assign(Error('cancelled'),{name:'AbortError'}));}});
 assert.equal(h.primary.requests.length,0);await h.cleanup();await h.loading;assert.equal(cancelled,1);assert.equal(h.p.budget.used,0);assert.equal(h.p.drawCount,0);assert.equal(h.p.audio,null);
});

test('E49 unverified nonzero media origins retain original audio without remuxing',async()=>{
 let copies=0;const h=await fixture({audio:true,ramBytes:512*1024,audioTrack:async()=>{copies++;throw Error('must not copy');}});try{
  assert.equal(copies,0);assert.equal(h.p.snapshot().audioSource,'original');assert.match(h.p.snapshot().audioSourceIssue,/非零/);assert.match(h.audio.src,/source\.mp4/);
 }finally{await h.cleanup();}
});

test('E57 nearby drag keeps one active read and only the latest queued target, showing protected progress',async()=>{
 const h=await fixture({frameCount:80});try{
  const cancels=h.primary.cancels,first=h.p.seek(.001,{index:1,kind:'rapid'}),waiting=[];
  for(let n=2;n<=12;n++)waiting.push(h.p.seek(h.info.frames[n].time,{index:n,kind:'rapid'}));
  assert.equal(h.primary.requests.length,2);assert.equal(h.p.queuedRead.n,12);assert.equal(h.primary.cancels,cancels);
  h.primary.complete();await first;assert.equal(h.primary.requests.length,3);assert.equal(h.primary.requests.at(-1).ordinal,12);
  assert(h.p.cache.has(1));assert.equal(h.p.currentIndex,1);assert.equal(h.p.targetTime,.012);assert.equal(h.p.frameHeld,true);assert.equal(h.p.pendingTargets,1);
  assert.equal((await h.p.setLoopPoint('start')).status,'ignored');h.primary.complete();const results=await Promise.all(waiting);
  assert(results.slice(0,-1).every(r=>r.status==='superseded'));assert.equal(results.at(-1).status,'drawn');assert.equal(h.p.currentIndex,12);assert.equal(h.p.frameHeld,false);
  assert.equal(h.p.queuedRead,null);assert.equal(h.p.foregroundRead,null);assert(h.p.budget.peak<=h.p.budget.limit);
 }finally{await h.cleanup();}
});

test('E57 repeated in-flight target and immediate play reuse one decode and one audio positioning',async()=>{
 const h=await fixture({audio:true,eventAudio:true});try{
  h.audio.completeSeek();const seeking=h.p.seek(.05,{final:true});const requests=h.primary.requests.length,cancels=h.primary.cancels;
  const playing=h.p.play();await turn();assert.equal(h.primary.requests.length,requests);assert.equal(h.primary.cancels,cancels);assert(Math.abs(h.audio.currentTime-.15)<1e-9);
  h.primary.complete();await seeking;await turn();assert.equal(h.p.currentIndex,2);assert.equal(h.audio.playCount,0,'audio must still settle before video can run');
  h.audio.completeSeek();assert.equal((await playing).status,'playing');assert.equal(h.audio.playCount,1);assert.equal(h.primary.requests.length,requests);assert.equal(h.p.rafId!==undefined,true);
 }finally{await h.cleanup();}
});

test('E57 release preempts a different active target and discards the queued intermediate',async()=>{
 const h=await fixture();try{
  const first=h.p.seek(.017),middle=h.p.seek(.05),cancels=h.primary.cancels,final=h.p.seek(.1,{final:true});
  assert.equal((await middle).status,'superseded');assert.equal(h.primary.cancels,cancels+1);assert.equal(h.primary.requests.length,3);assert.equal(h.primary.requests.at(-1).ordinal,3);
  h.primary.complete(2);await final;h.primary.complete(1);await first;assert.equal(h.p.currentIndex,3);assert(!h.p.cache.has(1));assert.equal(h.p.queuedRead,null);
 }finally{await h.cleanup();}
});

test('E57 a far jump preempts nearby work without waiting for its completion',async()=>{
 const h=await fixture({frameCount:600});try{
  const old=h.p.seek(.001,{index:1}),cancels=h.primary.cancels,far=h.p.seek(.5,{index:500});assert.equal(h.primary.cancels,cancels+1);assert.equal(h.primary.requests.at(-1).ordinal,500);
  h.primary.complete();await far;h.primary.complete(1);await old;assert.equal(h.p.currentIndex,500);assert(!h.p.cache.has(1));
 }finally{await h.cleanup();}
});

test('E57 reversal caches completed work without displaying a frame beyond the new target',async()=>{
 const h=await fixture({frameCount:80});try{
  const first=h.p.seek(.01,{index:10}),reversed=h.p.seek(.004,{index:4});h.primary.complete();await first;
  assert.equal(h.p.currentIndex,0);assert.equal(h.p.targetTime,.004);assert(h.p.cache.has(10));h.primary.complete();await reversed;assert.equal(h.p.currentIndex,4);assert.equal(h.p.seekDirection,-1);
  h.p.setForwardPredecode(true);beginFill(h);await Promise.resolve();assert.equal(h.primary.requests.at(-1).ordinal,3);await completeFill(h);
 }finally{await h.cleanup();}
});

test('E57 close settles the latest queued target and releases all completed and in-flight resources',async()=>{
 const h=await fixture();const first=h.p.seek(.017),latest=h.p.seek(.05);await h.cleanup();assert.equal((await first).status,'superseded');assert.equal((await latest).status,'superseded');assert.equal(h.p.queuedRead,null);assert.equal(h.p.foregroundRead,null);assert.equal(h.p.budget.used,0);
});

test('E57 a second play toggle can cancel pending resume without restarting sound after decode',async()=>{
 const h=await fixture({audio:true,eventAudio:true});try{
  h.audio.completeSeek();const seek=h.p.seek(.05,{final:true}),playing=h.p.play();await turn();assert.equal(h.p.snapshot().playRequested,true);
  await h.p.pause();assert.equal(h.p.snapshot().playRequested,false);h.primary.complete();await seek;assert.equal((await playing).status,'superseded');assert.equal(h.audio.playCount,0);assert.equal(h.p.state,'paused');
 }finally{await h.cleanup();}
});

test('E57 slow completed transfers retain immediate-preemption policy rather than queuing extra payloads',async()=>{
 const h=await fixture();try{
  h.p.seekReadMs=60;const old=h.p.seek(.017),cancels=h.primary.cancels,latest=h.p.seek(.05);assert.equal(h.primary.cancels,cancels+1);assert.equal(h.p.queuedRead,null);assert.equal(h.primary.requests.length,3);
  h.primary.complete(2);await latest;h.primary.complete(1);await old;assert.equal(h.p.currentIndex,2);assert(!h.p.cache.has(1));
 }finally{await h.cleanup();}
});

test('E57 failed active drag read does not lose the latest target or publish an obsolete error',async()=>{
 const h=await fixture();try{
  const old=h.p.seek(.017),latest=h.p.seek(.05);h.primary.requests[1].reject(Error('old failed'));h.primary.requests[1].done=true;await old;
  assert.equal(h.p.lastIssue,null);assert.equal(h.primary.requests.at(-1).ordinal,2);h.primary.complete();assert.equal((await latest).status,'drawn');assert.equal(h.p.currentIndex,2);
 }finally{await h.cleanup();}
});

test('E57 idle slots alternate nearby preparation and records instead of draining every record first',async()=>{
 const h=await fixture({frameCount:80});try{
  h.p.setForwardPredecode(true);h.p.primeRecords([50,60]);stopFillTimer(h.p);beginFill(h);await Promise.resolve();assert.equal(h.primary.requests.at(-1).ordinal,1);
  await completeFill(h);assert.equal(h.primary.requests.at(-1).ordinal,50);h.primary.complete();await turn();stopFillTimer(h.p);assert(h.p.thumbCache.has(50));assert(!h.p.thumbCache.has(60));
  beginFill(h);await Promise.resolve();assert.equal(h.primary.requests.at(-1).ordinal,2);await completeFill(h);assert.equal(h.primary.requests.at(-1).ordinal,60);h.primary.complete();await turn();stopFillTimer(h.p);assert(h.p.thumbCache.has(60));
 }finally{await h.cleanup();}
});

test('E57 disabled or full nearby preparation still drains a finite record queue and stops',async()=>{
 for(const enabled of [false,true]){const h=await fixture();try{
  for(let n=1;n<4;n++)h.p._entry(n,{pixels:Buffer.from([n,0,0,255]),metrics:{width:1,height:1}});if(enabled)h.p.setForwardPredecode(true);
  h.p.primeRecords([1,2,3]);for(let i=0;i<20&&!h.p.thumbCache.has(3);i++)await new Promise(r=>setTimeout(r,2));assert.equal(h.p.thumbCache.size,3);
  await new Promise(r=>setTimeout(r,5));assert.equal(h.p.fillTimer,undefined);assert.equal(h.p.thumbRunning,false);assert.equal(h.p.readerBusy,false);
 }finally{await h.cleanup();}}
});
