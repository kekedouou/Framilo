'use strict';
const assert=require('assert'),{buildTicks}=require('../plugin/timeline-strip.js');
const frames=Array.from({length:300},(_,i)=>({time:i/30}));
let r=buildTicks(frames,{start:0,end:10},1200);assert.equal(r.step,3);assert.equal(r.ticks.length,100);for(const t of r.ticks){assert.equal(t.ordinal%3,0);assert.equal(t.time,frames[t.ordinal].time);assert(Math.abs(t.x-t.time*120)<1e-8);}
r=buildTicks(frames,{start:1,end:1.2},500);assert.equal(r.step,1);assert.equal(r.ticks[0].ordinal,30);assert.equal(r.ticks.at(-1).ordinal,36);
const vfr=[0,.01,.07,.13,.5].map(time=>({time}));r=buildTicks(vfr,{start:0,end:1},500);assert.deepEqual(r.ticks.map(t=>t.x),[0,5,35,65,250]);
assert.equal(buildTicks(null,{start:0,end:1},500).ticks.length,0);assert.equal(buildTicks(frames,{start:1,end:1},500).ticks.length,0);
assert(buildTicks(frames,{start:0,end:10},10).ticks.length<=2);
console.log('E23: CFR/VFR source timestamps, integer frame stride, focused range, missing data and narrow ruler verified');
