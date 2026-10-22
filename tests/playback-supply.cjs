'use strict';
// Actual Player under deterministic clock/decoder/audio models; no real host.
const assert=require('assert'),{harness,sample,audio}=require('./player.cjs');
async function starve(){
 const h=harness();await h.load(sample('missing',audio(0,10),20,2));await h.settle(h.player.play());const gate=h.gate(4);
 for(let n=0;n<4;n++)await h.frame(500);await h.frame(40);await h.frame(100);await h.frame(80);assert(h.player.snapshot().buffering);return{h,gate};
}
async function main(){
 let count=0;const test=async(name,fn)=>{await fn();console.log('ok playback supply: '+name);count++;};
 await test('User pause during buffering cancels automatic resume, even when decode finishes later',async()=>{
  const{h,gate}=await starve();const paused=h.player.pause();gate.resolve();await h.settle(paused);for(let n=0;n<8;n++)await h.frame();
  assert.equal(h.player.snapshot().state,'paused');assert.equal(h.contexts[0].sources.length,1);await h.close();
 });
 await test('A newer seek owns the final image; old buffered completion cannot restart sound',async()=>{
  const{h,gate}=await starve();const request=h.player.seek(1,{final:true});gate.resolve();await h.settle(request);for(let n=0;n<8;n++)await h.frame();
  assert.equal(h.player.snapshot().frameOrdinal,2);assert.equal(h.player.snapshot().state,'paused');assert.equal(h.contexts[0].sources.length,1);await h.close();
 });
 await test('Close during buffering releases resources and cannot resume disposed audio',async()=>{
  const{h,gate}=await starve();const ended=h.player.dispose();gate.resolve();await ended;assert.equal(h.player.snapshot().state,'disposed');assert.equal(h.player.snapshot().cacheBytes,0);
 });
 await test('4x playback predicts display-time frames and leaves single-frame stepping accurate',async()=>{
  const h=harness();await h.load(sample('fast',null,240,60));await h.player.setPlaybackRate(4);
  const next=h.player._playAheadOrdinals(0,0,3);assert.deepEqual(next,[4,8,12]);
  await h.settle(h.player.play());for(let n=0;n<35;n++)await h.frame(16);
  assert(!h.events.some(e=>e.type==='error'));assert(h.player.snapshot().frameOrdinal>100);
  await h.settle(h.player.pause());const before=h.player.snapshot().frameOrdinal;await h.settle(h.player.step(1));assert.equal(h.player.snapshot().frameOrdinal,before+1);
  assert(h.maxDecodes()<=2);assert(h.player.snapshot().cacheBytes<=h.player.snapshot().budget.limit);await h.close();
 });
 await test('Slow decoder at 4x keeps the audio clock running and displays available past frames, then pauses and steps exactly',async()=>{
  const h=harness({decodeMs:90,readMs:50});await h.load(sample('slow',audio(0,8),240,30));await h.player.setPlaybackRate(4);await h.settle(h.player.play());
  const start=h.player._clockTime(),draws=h.player.snapshot().drawCount;
  for(let n=0;n<50;n++)await h.frame(16);
  assert(!h.events.some(e=>e.type==='error'));assert(!h.events.some(e=>e.phase==='supply-buffer-start'));assert.equal(h.player.snapshot().state,'playing');
  assert(h.player._clockTime()-start>2.8);assert(h.player.snapshot().drawCount>draws+3);assert.equal(h.contexts[0].sources.length,1);
  const target=Math.floor(h.player._clockTime()*30+1e-7);await h.settle(h.player.pause());assert.equal(h.player.snapshot().frameOrdinal,target);
  await h.settle(h.player.step(1));assert.equal(h.player.snapshot().frameOrdinal,target+1);assert(h.maxDecodes()<=2);assert(h.player.snapshot().budget.used<=h.player.snapshot().budget.limit);await h.close();
 });
 await test('Fast loop display stays inside its source-frame range across multiple wraps',async()=>{
  const h=harness({decodeMs:45});await h.load(sample('loop-fast',null,120,30));await h.player.setPlaybackRate(4);
  await h.settle(h.player.applyLoopRange({startOrdinal:20,endOrdinal:49}));const from=h.events.length;
  for(let n=0;n<80;n++)await h.frame(16);assert.equal(h.player.snapshot().state,'playing');
  const frames=h.events.slice(from).filter(e=>e.type==='draw');assert(frames.length>5);assert(frames.every(e=>e.frameOrdinal>=20&&e.frameOrdinal<=49));
  assert(!h.events.some(e=>e.phase==='supply-buffer-start'));await h.close();
 });
 await test('Real image decode errors remain errors and never trigger an automatic retry loop',async()=>{
  const h=harness({decodeFailure:7});await h.load(sample());const result=await h.settle(h.player.seek(.7,{final:true}));
  assert.equal(result.status,'error');assert.equal(h.player.snapshot().state,'error');assert(!h.player.snapshot().buffering);await h.close();
 });
 await test('Fast playback still reports a real damaged frame instead of hiding it behind frame skipping',async()=>{
  const h=harness({decodeFailure:17});await h.load(sample('fast-bad',null,120,30));await h.player.setPlaybackRate(4);await h.settle(h.player.play());
  h.player._decode(17,'play-ahead',null).catch(()=>{});
  for(let n=0;n<35&&h.player.snapshot().state!=='error';n++)await h.frame(16);assert.equal(h.player.snapshot().state,'error');await h.close();
 });
 console.log('Playback supply: '+count+' deterministic recovery/scheduling checks; not actual performance.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
