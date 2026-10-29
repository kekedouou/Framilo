'use strict';
// Deterministic JPEG Player transport regression, not Eagle timing evidence.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness,sample,audio}=require('./player.cjs');
const flush=async()=>{for(let n=0;n<48;n++)await Promise.resolve();};

test('JPEG play does not wait for a blocked next-frame predecode',async()=>{
 const h=harness({forwardPredecode:false}),gate=h.gate(1);try{
  await h.load(sample('play-held-next',audio(0,2),20,10));let result;
  h.player.play().then(v=>{result=v;});await flush();
  assert.equal(result?.status,'playing');assert.equal(h.player.snapshot().state,'playing');assert(!h.player.cache.has(1));
  assert(h.contexts[0].sources[0].startPlan);assert.equal(h.maxDecodes()<=2,true);
 }finally{gate.resolve();await h.close();}
});

test('JPEG pause stops sound and clock immediately while exact pause alignment remains pending',async()=>{
 const h=harness({forwardPredecode:false});let gate;try{
  await h.load(sample('pause-align',audio(0,2),20,10));await h.player.play();await h.elapse(350);gate=h.gate(3);
  const paused=h.player.pause();assert.equal(h.player.snapshot().state,'paused');assert.equal(h.player.anchor,null);assert(h.contexts[0].sources[0].stopped);
  assert.equal(h.player.snapshot().frameOrdinal,0);assert.equal(h.player.snapshot().pendingTargets,1);
  await h.elapse(100);assert.equal(h.player._clockTime(),0,'stopped clock must not advance with the old audio graph');
  gate.resolve();assert.equal((await h.settle(paused)).frameId,3);assert.equal(h.player.snapshot().frameOrdinal,3);assert.equal(h.player.snapshot().state,'paused');
 }finally{gate?.resolve();await h.close();}
});

test('a newer JPEG seek supersedes pending pause alignment without a late old picture',async()=>{
 const h=harness({forwardPredecode:false});let gate;try{
  await h.load(sample('pause-new-seek',audio(0,2),20,10));await h.player.play();await h.elapse(350);gate=h.gate(3);
  const paused=h.player.pause(),newer=h.player.seek(.9,{final:true});assert.equal((await h.settle(newer)).frameId,9);const draws=h.player.drawCount;
  gate.resolve();assert.equal((await paused).status,'superseded');await h.frame();assert.equal(h.player.snapshot().frameOrdinal,9);assert.equal(h.player.drawCount,draws);
 }finally{gate?.resolve();await h.close();}
});

test('a new JPEG play intent supersedes pending pause refinement and can start on the confirmed frame',async()=>{
 const h=harness({forwardPredecode:false});let gate;try{
  await h.load(sample('pause-new-play',audio(0,2),20,10));await h.player.play();await h.elapse(350);gate=h.gate(3);
  const paused=h.player.pause();let result;h.player.play().then(v=>{result=v;});await flush();
  assert.equal(result?.status,'playing');assert.equal((await paused).status,'superseded');assert.equal(h.player.snapshot().frameOrdinal,0);const draws=h.player.drawCount;
  gate.resolve();await flush();assert.equal(h.player.drawCount,draws);assert.equal(h.player.snapshot().state,'playing');assert.equal(h.contexts[0].sources.length,2);
 }finally{gate?.resolve();await h.close();}
});


test('a new intent issued by the immediate paused notification cannot be replaced by pause refinement',async()=>{
 let armed=false,newer;const h=harness({forwardPredecode:false,onEvent(e,p){if(armed&&e.type==='state'&&e.state==='paused'){armed=false;newer=p.seek(.9,{final:true});}}});try{
  await h.load(sample('pause-reentrant',audio(0,2),20,10));await h.player.play();await h.elapse(350);armed=true;
  assert.equal((await h.player.pause()).status,'superseded');assert.equal((await h.settle(newer)).frameId,9);assert.equal(h.player.snapshot().frameOrdinal,9);
 }finally{await h.close();}
});
