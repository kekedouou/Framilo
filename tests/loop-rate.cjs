'use strict';
const assert=require('assert');
const {harness,sample,audio}=require('./player.cjs');
const near=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const frames=async(h,n)=>{for(let i=0;i<n;i++)await h.frame();};
async function mark(h,first,last){
  await h.settle(h.player.seek(h.player.info.frames[first].time,{index:first,kind:'release',final:true}));await h.settle(h.player.setLoopPoint('start'));
  await h.settle(h.player.seek(h.player.info.frames[last].time,{index:last,kind:'release',final:true}));await h.settle(h.player.setLoopPoint('end'));
  await h.settle(h.player.setLoopEnabled(true));
}
async function main(){
  {
    const h=harness(),index=require('../plugin/frame-index.cjs'),info=sample('visible-vfr',null,4);
    info.frames=index.buildIndex([0,30,80,210].map((n,id)=>({id,file:'f'+id+'.jpg',bytes:10,ptsTicks:String(n)})),{timeBase:[1,1000],lastFrameEndTicks:'400'}).frames;info.duration=.4;
    await h.load(info);await h.settle(h.player.applyLoopRange({startOrdinal:0,endOrdinal:2}));
    near(h.player.transportSnapshot().loop.endTime,.08);near(h.player.transportSnapshot().loop.endBoundary,.21);
    await h.settle(h.player.seek(.15,{kind:'annotation',final:true}));assert.equal(h.player.snapshot().frameOrdinal,2);assert(h.player.loopEnabled);
    await h.settle(h.player.seek(.22,{kind:'annotation',final:true}));assert.equal(h.player.snapshot().frameOrdinal,3);assert(!h.player.loopEnabled);
    assert.equal(h.player.transportSnapshot().loop.startOrdinal,0);assert.equal(h.player.transportSnapshot().loop.endOrdinal,2);assert.equal(h.player.snapshot().state,'paused');
    await h.settle(h.player.applyLoopRange({startOrdinal:1,endOrdinal:3}));near(h.player.transportSnapshot().loop.endBoundary,.4);
    await h.settle(h.player.clearLoop());assert.equal(h.player.transportSnapshot().loop.endBoundary,null);await h.close();
  }
  {
    const h=harness();await h.load(sample('range-atomic',audio(0,2),20));
    assert.deepEqual(h.player.loopFrameAt(.249,{maxOrdinal:18}),{ordinal:2,frameId:2,time:.2});
    assert.equal(h.player.loopFrameAt(2,{maxOrdinal:18}).ordinal,18);
    assert.equal(h.player.loopFrameAt(0,{minOrdinal:5}).ordinal,5);
    assert.equal(h.player.loopFrameAt(.2,{ordinal:4}).ordinal,4);
    assert.equal(h.player.loopFrameAt(0,{minOrdinal:5,maxOrdinal:4}),null);
    await h.settle(h.player.setPlaybackRate(.5));await h.settle(h.player.applyLoopRange({startOrdinal:2,endOrdinal:8}));
    assert.equal(h.player.snapshot().state,'playing');assert.equal(h.player.snapshot().frameOrdinal,2);
    assert.equal(h.player.transportSnapshot().loop.enabled,true);assert.equal(h.player.playbackRate,.5);
    assert.equal(h.contexts[0].sources[0].loopStart,.2);assert.equal(h.contexts[0].sources[0].loopEnd,.9);
    await h.settle(h.player.pause());const saved=h.player.transportSnapshot();
    const pending=h.player.applyLoopRange({startOrdinal:3,endOrdinal:9});
    const seek=h.player.seek(1.5,{final:true});await h.settle(seek);assert.equal((await pending).status,'superseded');
    assert.deepEqual(h.player.transportSnapshot(),saved);assert.equal(h.player.snapshot().state,'paused');
    await assert.rejects(h.player.applyLoopRange({startOrdinal:3,endOrdinal:3}));
    const closing=h.player.applyLoopRange({startOrdinal:4,endOrdinal:9});await h.close();assert.equal((await closing).status,'superseded');
  }
  for(const sound of [false,true])for(const rate of [.1,.25,.5,1,1.1,2,4]){
    const h=harness();await h.load(sample('rate',sound?audio(0,4):null,80));await h.settle(h.player.setPlaybackRate(rate));
    assert.equal(h.player.snapshot().state,'paused');await h.settle(h.player.play());await h.elapse(30);
    const before=h.player._clockTime();await h.elapse(1000);near(h.player._clockTime()-before,rate);
    if(sound)assert.equal(h.contexts[0].sources[0].playbackRate.value,rate);await h.close();
  }
  {
    const h=harness();await h.load(sample('delay',audio(.4,.6),80));await h.settle(h.player.setPlaybackRate(.25));await h.settle(h.player.play());
    const graph=h.contexts[0].sources[0];near(graph.startPlan.when-h.player.anchor.context,1.6);near(graph.startPlan.offset,0);await h.close();
  }
  {
    const h=harness({forwardPredecode:true});await h.load(sample('loop',audio(0,1),10));await mark(h,1,4);
    assert.equal(h.player.transportSnapshot().loop.enabled,true);await h.settle(h.player.play());await frames(h,100);
    const draws=h.events.filter(e=>e.type==='draw'&&e.kind==='play');assert(draws.some(e=>e.frameId===1));assert(draws.some(e=>e.frameId===4));assert(draws.every(e=>e.frameId>=1&&e.frameId<=4));
    assert.equal(h.player.snapshot().state,'playing');assert.equal(h.contexts[0].sources.length,1);assert.equal(h.contexts[0].buffers.length,0);
    const source=h.contexts[0].sources[0];assert(source.loop);near(source.loopStart,.1);near(source.loopEnd,.5);
    assert(!h.events.some(e=>e.code==='UNDERRUN'));await h.settle(h.player.pause());assert(source.stopped);await h.close();
  }
  {
    const h=harness();await h.load(sample('silence',audio(.2,.1),10));await mark(h,0,4);await h.settle(h.player.play());
    const ctx=h.contexts[0],buffer=ctx.sources[0].buffer;assert.equal(ctx.buffers.length,1);near(buffer.duration,.5);
    const data=buffer.getChannelData(0);assert.equal(data[0],0);assert.equal(data[9599],0);assert(Math.abs(data[9600]-.1)<1e-7);assert.equal(data[14400],0);assert.equal(data[data.length-1],0);
    const bytes=buffer.length*buffer.numberOfChannels*4;assert.equal(h.player.snapshot().budget.kinds['loop-audio'],bytes);
    await frames(h,400);assert.equal(ctx.buffers.length,1);assert.equal(ctx.sources.length,1);
    await h.settle(h.player.pause());assert(!h.player.snapshot().budget.kinds['loop-audio']);assert(ctx.sources[0].stopped);await h.close();
  }
  {
    const h=harness();await h.load(sample('silent-range',audio(.6,.2),10));await mark(h,0,2);await h.settle(h.player.play());await frames(h,40);
    assert.equal(h.player.snapshot().state,'playing');assert.equal(h.contexts[0].sources.length,0);await h.close();
  }
  {
    const h=harness();await h.load(sample('negative-offset',audio(-.2,.3),10));h.player.audioBuffer.getChannelData(0)[9600]=.75;
    await mark(h,0,2);await h.settle(h.player.play());const data=h.contexts[0].sources[0].buffer.getChannelData(0);
    near(data[0],.75);assert(Math.abs(data[4799]-.1)<1e-7);assert.equal(data[4800],0);await h.close();
  }
  {
    const h=harness();await h.load(sample('single',null,10));await mark(h,3,3);await h.settle(h.player.play());await frames(h,50);
    assert.equal(h.player.snapshot().frameId,3);assert.equal(h.player.snapshot().state,'playing');await h.settle(h.player.clearLoop());assert(!h.player.transportSnapshot().loop.enabled);
    await h.settle(h.player.pause());await h.settle(h.player.setLoopPoint('end'));await h.settle(h.player.seek(.8,{final:true}));await h.settle(h.player.setLoopPoint('start'));
    assert.equal(h.player.transportSnapshot().loop.endOrdinal,null);assert.equal(h.player.transportSnapshot().loop.valid,false);assert.equal((await h.settle(h.player.setLoopEnabled(true))).status,'ignored');await h.close();
  }
  {
    const h=harness();await h.load(sample('edit',audio(0,2),20));await h.settle(h.player.play());await frames(h,8);
    const before=h.player.snapshot().frameOrdinal;await h.settle(h.player.setPlaybackRate(.5));assert.equal(h.player.snapshot().state,'playing');assert(h.player.snapshot().frameOrdinal>=before);
    assert.equal(h.contexts[0].sources[1].playbackRate.value,.5);assert(h.contexts[0].sources[0].stopped);
    const changing=h.player.setPlaybackRate(.25),seeking=h.player.seek(1.2,{final:true});await h.settle(seeking);assert.equal((await changing).status,'superseded');assert.equal(h.player.playbackRate,.5);
    await h.settle(h.player.setLoopPoint('start'));const saved=h.player.transportSnapshot();await h.load(sample('other',null,20));assert.equal(h.player.playbackRate,1);assert.equal(h.player.transportSnapshot().loop.startId,null);
    await h.settle(h.player.restoreTransport(saved));assert.equal(h.player.playbackRate,.5);assert.equal(h.player.transportSnapshot().loop.startId,saved.loop.startId);await h.close();
  }
  {
    const h=harness(),index=require('../plugin/frame-index.cjs'),info=sample('duplicates',null,3);
    info.frames=index.buildIndex([0,0,1].map((n,id)=>({id,file:'f'+id+'.jpg',bytes:10,ptsTicks:String(n)})),{timeBase:[1,10],lastFrameEndTicks:'2'}).frames;info.duration=.2;
    await h.load(info);await mark(h,0,0);assert(!h.player.transportSnapshot().loop.valid);assert.equal(h.player.snapshot().state,'paused');
    for(const rate of [0,-1,.09,4.01,NaN,Infinity,'2'])await assert.rejects(h.player.setPlaybackRate(rate));await h.close();
  }
  {
    const h=harness();await h.load(sample('close-edit',audio(.1,.2),10));await mark(h,0,4);await h.settle(h.player.play());
    const change=h.player.setPlaybackRate(.25);await h.close();assert.equal((await change).status,'superseded');
    assert.equal(h.player.snapshot().cacheBytes,0);assert(h.contexts[0].sources.every(s=>s.stopped));
  }
  {
    const h=harness();await h.load(sample('intermediate-speed',audio(0,4),80));await h.settle(h.player.applyLoopRange({startOrdinal:10,endOrdinal:20}));
    const before=h.player.transportSnapshot().loop,ordinal=h.player.snapshot().frameOrdinal;
    await h.settle(h.player.setPlaybackRate(1.35));assert.equal(h.player.snapshot().state,'playing');assert.equal(h.player.snapshot().frameOrdinal,ordinal);
    assert.deepEqual(h.player.transportSnapshot().loop,before);await h.settle(h.player.pause());const saved=h.player.transportSnapshot();
    await h.settle(h.player.setPlaybackRate(4));await h.settle(h.player.restoreTransport(saved));assert.equal(h.player.playbackRate,1.35);assert.equal(h.player.snapshot().state,'paused');
    assert.deepEqual(h.player.transportSnapshot().loop,before);await h.close();await assert.rejects(h.player.setPlaybackRate(1.35));
  }
  console.log('Player rate/loop: 0.1/0.25/0.5/1/1.1/2/4 with and without audio, nonpreset restore, preserved frame/range/state, inclusive loop and lifecycle races passed; deterministic models, not real sound or high-rate performance.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
