'use strict';
const assert=require('assert'),{Budget}=require('../plugin/player.js'),{create}=require('../plugin/scrub-preview.js');
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
async function main(){
 const budget=new Budget(128*1024**2),draws=[],reads=[],resolvers=[];let freed=0,current=true;
 const overlay={style:{},setAttribute(){},getContext(_,options){assert(options.willReadFrequently);return{drawImage(){}};},remove(){this.removed=true;}};
 const canvas={ownerDocument:{createElement:()=>overlay},parentElement:{appendChild(){}}};
 const frames=[0,.1,.2].map((time,id)=>({time,id,width:480,height:270}));
 const consumer=create({canvas,find:t=>frames.find(f=>Math.abs(f.time-t)<.001),read:f=>{reads.push(f.id);return new Promise(r=>resolvers.push(r));},budget,isCurrent:()=>current,onDraw:f=>draws.push(f.id),env:{decode:async()=>({width:480,height:270,close(){freed++;}})}});
 assert.equal(consumer.request(0,{final:true}),false);assert.equal(reads.length,0);
 assert(consumer.request(0,{final:false}));assert(consumer.request(.2,{final:false}));resolvers.shift()(new Uint8Array(10));await flush();assert.deepEqual(reads,[0,2]);assert.deepEqual(draws,[]);
 resolvers.shift()(new Uint8Array(10));await flush();assert.deepEqual(draws,[2]);assert.equal(overlay.hidden,false);
 consumer.request(.1,{final:false});consumer.clear();resolvers.shift()(new Uint8Array(10));await flush();assert.deepEqual(draws,[2]);assert(overlay.hidden);
 consumer.request(.2,{final:false});await flush();assert.deepEqual(draws,[2,2]);
 current=false;consumer.request(0,{final:false});await flush();assert.deepEqual(draws,[2,2]);
 const closing=consumer.close();if(resolvers.length)resolvers.shift()(new Uint8Array(10));await closing;assert(overlay.removed);assert.equal(consumer.snapshot().cachedBytes,0);assert.equal(budget.snapshot().used,0);assert.equal(freed,2);
 let fallback=null;current=true;
 const broken=create({canvas,find:()=>frames[0],read:async()=>{throw Error('read failed');},budget,isCurrent:()=>current,onMiss:t=>fallback=t});
 broken.request(0,{final:false});await flush();assert.equal(fallback,0);assert.equal(budget.snapshot().used,0);await broken.close();
 console.log('ok scrub renderer: final refusal, latest intent, cancel, stale source, shared RAM and close');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
