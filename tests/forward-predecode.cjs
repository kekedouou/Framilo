'use strict';
// Actual Player with deterministic image/RAF models; no host/performance claim.
const assert = require('assert');
const { harness, sample, flush, deferred } = require('./player.cjs');
async function frames(h, n) { for (let i=0;i<n;i++) await h.frame(); }
async function main() {
  const opts={forwardPredecode:true,experimentMode:'compressed-ram',compressedRamBytes:1000,ramBytes:2000000};
  {
    const gate=deferred();gate.file='f15.jpg'; const h=harness({...opts,readGate:gate});
    try { await h.load(sample('first',null,60)); assert.equal(h.player.snapshot().state,'paused');
      assert.equal(h.player.snapshot().frameId,0); assert(h.player.snapshot().loadTimings.initialWarmDeferred);
      assert(!h.reads.has('first:f15.jpg')); // No full JPEG read blocks the first usable frame.
    } finally {gate.resolve();await h.close();}
  }
  {
    const h=harness(opts);await h.load(sample('budget',null,80));await frames(h,110);
    assert(h.player.cache.size>7,'Preparation must extend past the old three-neighbour window.');
    assert(h.player.cache.size<80);assert.equal(h.player.snapshot().forwardStatus,'budget');
    const work=h.events.filter(e=>e.phase==='image-work-start').length, evictions=h.events.filter(e=>e.phase==='evict').length;
    await frames(h,100);assert.equal(h.events.filter(e=>e.phase==='image-work-start').length,work);
    assert.equal(h.events.filter(e=>e.phase==='evict').length,evictions);assert(h.player.snapshot().cachePeakBytes<=opts.ramBytes);
    await h.close();assert.equal(h.player.snapshot().cacheBytes,0);
  }
  {
    const h=harness({...opts,ramBytes:4000000}),gate=h.gate(7);await h.load(sample('priority',null,80));await frames(h,20);
    assert(h.player.tasks.size===1);const hit=h.player.seek(.2,{kind:'drag'});const hitResult=await h.settle(hit);
    assert.equal(hitResult.frameId,2);const draw=h.events.filter(e=>e.type==='draw'&&e.frameId===2).pop();assert.equal(draw.cacheStateAtInput,'decoded');
    assert(draw.readyToSubmitMs<=16); // One simulated RAF, without waiting for gated background decode.
    const cold=await h.settle(h.player.seek(6,{kind:'drag'}));assert.equal(cold.frameId,60);assert(h.maxDecodes()<=2);
    gate.resolve();await flush();assert(!h.events.some(e=>e.type==='draw'&&e.frameId===7));await h.close();
  }
  {
    const h=harness({...opts,ramBytes:4000000}),gate=h.gate(7);await h.load(sample('toggle',null,80));await frames(h,20);
    const retained=[...h.player.cache.keys()];h.player.setForwardPredecode(false);gate.resolve();await flush();
    assert(!h.player.cache.has(7));for(const id of retained)assert(h.player.cache.has(id));
    h.player.setForwardPredecode(true);await frames(h,20);assert(h.player.cache.size>retained.length);await h.close();
  }
  {
    const gate=deferred();gate.file='f50.jpg';const h=harness({...opts,readGate:gate});await h.load(sample('race',null,80));await frames(h,100);
    assert([...h.player.tasks.values()].some(t=>t.role==='compressed-warm'));
    const target=h.player.seek(5,{kind:'drag'});await flush();gate.resolve();await h.settle(target);
    const actual=[...h.player.compressed.values()].reduce((n,e)=>n+e.bytes.byteLength,0);
    assert.equal(h.player.snapshot().budget.kinds['compressed-jpeg'],actual);assert.equal(h.player.compressedBytes,actual);await h.close();
  }
  {
    // A pending background read must not exceed the pool if foreground admissions replace its original plan.
    const h=harness(opts),info=sample('pool-race',null,160);await h.load(info);h.player.setForwardPredecode(false);
    const held=deferred();h.player.readFrameBatch=async()=>{await held.promise;return [Buffer.alloc(10)];};
    h.player._clearCompressed();h.player.compressedCapacity=20;
    const read=h.player._readCompressedBatch(h.player.info,h.player.epoch,[150]);await flush();
    h.player._rememberCompressed(151,Buffer.alloc(10));h.player._rememberCompressed(152,Buffer.alloc(10));held.resolve();await read;
    assert.equal(h.player.compressedBytes,20);assert(!h.player.compressed.has(150));await h.close();
  }
  {
    const h=harness({...opts,decodeFailure:7});await h.load(sample('failure',null,80));await frames(h,30);
    assert(h.player.cacheCoverageSnapshot().issue.includes('fake JPEG decode failure'));
    const work=h.events.filter(e=>e.phase==='image-work-start').length;await frames(h,30);
    assert.equal(h.events.filter(e=>e.phase==='image-work-start').length,work);assert.equal(h.player.snapshot().state,'paused');await h.close();
  }
  {
    const h=harness({...opts,forwardPredecode:false});await h.load(sample('enable-after-use',null,80));
    for(let i=5;i<35;i++)await h.settle(h.player.seek(i/10,{kind:'release',final:true}));
    const pool=h.player.compressedCapacity;assert(pool>0);h.player.setForwardPredecode(true);await frames(h,10);
    assert.equal(h.player.compressedCapacity,pool);assert(h.player.compressedBytes<=pool);await h.close();
  }
  console.log('E04 forward preparation: first usable frame, finite idle fill, no eviction loop, cached/cold input priority, two slots, toggle/cancel, JPEG race budget and release passed; models only.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
