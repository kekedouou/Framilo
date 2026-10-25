'use strict';
// Real segment reader under a delayed producer cancellation acknowledgement.
const assert=require('assert'),{createSegmentReader}=require('../plugin/segment-reader.cjs');
const flush=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
const cancelled=()=>Object.assign(Error('视频准备已取消。'),{code:'MEDIA_CANCELLED'});
function model(){
 const pending=[],calls=[],released=[];
 const info={duration:6,frames:Array.from({length:6},(_,n)=>({file:`frame-${n}.avc`,time:n,ptsTicks:String(n)})),segments:[0,2,4].map(n=>({start:n,end:n+2,first:n,last:n+1}))};
 const reader=createSegmentReader({info,acquire:(ordinal,signal)=>{calls.push(ordinal);return new Promise((resolve,reject)=>pending.push({ordinal,signal,resolve:()=>resolve({ordinal,frames:info.frames.slice(ordinal*2,ordinal*2+2),audio:{file:'pcm',start:0,duration:2}}),reject}));},release:async v=>released.push(v.ordinal),readAsset:async()=>Buffer.from('bytes')});
 return {reader,pending,calls,released};
}
async function main(){
 for(const kind of ['frame','audio']){
  const h=model();h.reader.prefetch(0,null);assert.deepEqual(h.calls,[1,2]);
  h.reader.cancelExcept(0);assert(h.pending[0].signal.aborted);
  let failure,value;const work=(kind==='frame'?h.reader.frame('frame-2.avc'):h.reader.audio(1)).then(v=>value=v,e=>failure=e);
  h.pending[0].reject(cancelled());h.pending[1].reject(cancelled());await flush();
  assert(!failure,`${kind}: a new demand joined a cancelled prefetch and failed: ${failure?.message}`);
  assert.equal(h.calls.filter(n=>n===1).length,2,'new demand must wait for cancellation acknowledgement, then acquire a fresh segment');
  h.pending[2].resolve();await work;assert(value);await h.reader.close();assert.deepEqual(h.released,[1]);
  console.log('ok segment cancellation: new '+kind+' demand after cancelled prefetch');
 }
 {
  const h=model();let value;
  const work=h.reader.frame('frame-0.avc').then(v=>value=v);
  h.reader.cancelExcept(4);h.reader.cancelExcept(0);h.pending[0].reject(cancelled());await flush();
  assert.equal(h.calls.length,2);h.pending[1].resolve();await work;assert(value);await h.reader.close();
  console.log('ok segment cancellation: returning target retries only after owned cancellation settles');
 }
 {
  const h=model();h.reader.prefetch(0,null);h.reader.cancelExcept(0);
  const one=h.reader.frame('frame-2.avc'),two=h.reader.audio(1);
  h.pending[0].reject(cancelled());h.pending[1].reject(cancelled());await flush();
  assert.deepEqual(h.calls,[1,2,1]);h.pending[2].resolve();await Promise.all([one,two]);await h.reader.close();assert.deepEqual(h.released,[1]);
  console.log('ok segment cancellation: replacement frame and PCM share one lease');
 }
 {
  const h=model();h.reader.prefetch(0,null);h.reader.cancelExcept(0);
  const work=h.reader.audio(1).catch(e=>e);const close=h.reader.close();
  h.pending[0].reject(cancelled());h.pending[1].reject(cancelled());await Promise.all([work,close]);assert.deepEqual(h.calls,[1,2]);
  console.log('ok segment cancellation: close never restarts cancelled work');
 }
 {
  const h=model();h.reader.prefetch(0,null);h.reader.cancelExcept(0);
  const work=h.reader.audio(1).catch(e=>e);h.pending[0].reject(Object.assign(Error('cleanup failed'),{code:'MEDIA_CLEANUP_FAILED',name:'AbortError'}));h.pending[1].reject(cancelled());
  assert.equal((await work).code,'MEDIA_CLEANUP_FAILED');assert.deepEqual(h.calls,[1,2]);await h.reader.close();
  console.log('ok segment cancellation: cleanup failure is not mistaken for cancellation');
 }
 const h=model();let outcome;const work=h.reader.frame('frame-0.avc').catch(e=>outcome=e);
 h.pending[0].reject(cancelled());await flush();assert(outcome,'unexpected producer cancellation must surface rather than retry forever');await work;assert.equal(h.calls.length,1);await h.reader.close();
 console.log('ok segment cancellation: unrequested producer cancellation is not retried');
 // Formal Player + formal reader: a recently cancelled lookahead is demanded
 // again by play(). Previously this transitioned the whole player to error.
 const {harness,sample}=require('./player.cjs'),p=harness({forwardPredecode:false});
 const data=sample('cancel-play',null,12,60);data.streaming='segments-v1';
 data.frames.forEach((f,n)=>{f.file=`frame-${n}.jpg`;});
 data.segments=[0,2,4,6,8,10].map(n=>({start:n/60,end:(n+2)/60,first:n,last:n+1}));
 let cold=true,rejectOld,oldSignal;const prepared=[];
 const reader=createSegmentReader({info:data,acquire:(n,signal)=>{prepared.push(n);if(n===1&&cold){cold=false;oldSignal=signal;return new Promise((_,reject)=>rejectOld=reject);}
  return Promise.resolve({frames:data.frames.slice(n*2,n*2+2)});},release:async()=>{},readAsset:async(v,file)=>{const bytes=Buffer.alloc(10);bytes[0]=Number(file.match(/\d+/)[0]);bytes.writeUInt16LE(data.width,1);bytes.writeUInt16LE(data.height,3);return bytes;}});
 p.player.readAsset=(_,file)=>reader.frame(file);p.player.setMediaTarget=t=>reader.cancelExcept(t);p.player.cancelMediaReads=()=>reader.cancelAll();
 await p.load(data);reader.prefetch(0,null);reader.cancelExcept(0);assert(oldSignal.aborted);
 const play=p.player.play();await flush();rejectOld(cancelled());await p.settle(play);
 assert.equal(p.player.snapshot().state,'playing');assert(!p.events.some(e=>e.type==='error'));assert.equal(prepared.filter(n=>n===1).length,2);
 await p.close();await reader.close();
 console.log('ok segment cancellation: formal Player resumes without fatal cancelled page');
 {
  const {createSegmentAudio}=require('../plugin/segment-audio.cjs'),{Budget}=require('../plugin/player.js');
  const budget=new Budget(32*1024**2),calls=[];let rejectOld;
  const info={duration:4,segments:[{start:0,end:2},{start:2,end:4}],audio:{channels:1}};
  const audio=createSegmentAudio({info,budget,context:{sampleRate:48000,decodeAudioData:async()=>({length:96000,numberOfChannels:1,duration:2})},read:n=>{
   calls.push(n);if(n===1&&calls.filter(v=>v===1).length===1)return new Promise((_,reject)=>rejectOld=reject);
   return Promise.resolve({bytes:Buffer.alloc(8),start:n*2});},onError:()=>assert.fail('unexpected audio failure')});
  const old=audio.prime(0,null).catch(e=>e);await flush();assert(rejectOld);audio.stop();
  const next=audio.prime(0,null);rejectOld(cancelled());await next;await old;
  assert.deepEqual(calls,[0,1,1]);await audio.close();assert.equal(budget.used,0);
  console.log('ok segment cancellation: new play generation cannot inherit old PCM cancellation');
 }
 for(const stop of ['close','real-error']){
  const {createSegmentAudio}=require('../plugin/segment-audio.cjs'),{Budget}=require('../plugin/player.js');
  const budget=new Budget(32*1024**2),calls=[];let rejectOld;
  const audio=createSegmentAudio({info:{duration:4,segments:[{start:0,end:2},{start:2,end:4}],audio:{channels:1}},budget,context:{sampleRate:48000},read:n=>{calls.push(n);return new Promise((_,reject)=>rejectOld=reject);},onError:()=>{}});
  const old=audio.prime(0,null).catch(e=>e);await flush();audio.stop();const next=audio.prime(0,null).catch(e=>e);
  const closing=stop==='close'?audio.close():null;
  const failure=stop==='close'?cancelled():Object.assign(Error('damaged PCM'),{code:'MEDIA_DECODE'});rejectOld(failure);
  assert.strictEqual(await next,failure);await old;if(closing)await closing;else await audio.close();assert.deepEqual(calls,[0]);assert.equal(budget.used,0);
  console.log('ok segment cancellation: '+stop+' prevents audio retry');
 }
 {
  const p=harness();p.player.readAsset=async()=>{throw Object.assign(Error('damaged first frame'),{code:'MEDIA_CORRUPT'});};
  await assert.rejects(p.load(sample()),e=>e.code==='MEDIA_CORRUPT');assert.equal(p.player.snapshot().lastErrorCode,'MEDIA_CORRUPT');await p.close();
  console.log('ok segment cancellation: first-frame error code survives load');
 }
}
const watchdog=setTimeout(()=>{console.error('Cancellation regression did not settle');process.exitCode=1;},5000);
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
