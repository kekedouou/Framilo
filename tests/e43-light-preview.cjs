'use strict';
const assert=require('assert'),{create}=require('../prototypes/e43-source-preview/light.js');
const gate=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
async function main(){
 const frames=[0,.1,.2].map(time=>({time})),draws=[],reads=[],pending=new Map();let closed=0;
 const consumer=create({frames,read:n=>{reads.push(n);const g=gate();pending.set(n,g);return g.promise;},decode:async()=>({width:480,height:270,close(){closed++;}}),draw:(_,f)=>draws.push(f),limit:480*270*4});
 const a=consumer.request(0),b=consumer.request(.2);assert.equal((await a).status,'superseded');pending.get(0).resolve(new Uint8Array());
 for(let i=0;i<12;i++)await Promise.resolve();assert.deepEqual(reads,[0,2]);assert.equal(draws.length,0);pending.get(2).resolve(new Uint8Array());assert.equal((await b).time,.2);
 assert.equal((await consumer.request(.19,{final:true})).status,'needs-exact');assert.equal((await consumer.request(.2,{final:true})).status,'preview');assert.equal(draws.length,2);
 assert(consumer.snapshot().peakBytes<=480*270*4);assert.equal(closed,1);
 const c=consumer.request(.1),closing=consumer.close();pending.get(1).resolve(new Uint8Array());assert.equal((await c).status,'closed');await closing;assert.equal(draws.length,2);assert.equal(consumer.snapshot().bytes,0);assert.equal(closed,3);
 assert.equal((await consumer.request(.2)).status,'closed');console.log('ok E43 latest intent, exact refusal, close, bounded bitmap lifetime');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
