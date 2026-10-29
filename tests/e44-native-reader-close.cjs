'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {FilmcraftClient}=require('../plugin/native-reader.cjs');
function fixture(){
 const c=Object.create(FilmcraftClient.prototype);let ends=0,resets=0,rejected=0;
 Object.assign(c,{openInfo:{protocol:2},finish:()=>{},openReject:()=>rejected++,packets:{reset:()=>resets++},proc:{stdin:{destroyed:false,writableEnded:false,end(){ends++;this.writableEnded=true;setImmediate(()=>{c.exit={code:0,signal:null};c.closedInfo={cacheBytes:0,liveDecoders:0};c.processClosed=true;c.exitResolve();});}},kill(){assert.fail('ordinary close must not kill');}}});
 return {c,counts:()=>({ends,resets,rejected})};
}
test('concurrent close drains one receipt and ends stdin once',async()=>{
 const {c,counts}=fixture(),a=c.close(),b=c.close();assert.equal(a,b);
 const [x,y]=await Promise.all([a,b]);assert.deepEqual(x,y);assert.equal(x.ack.cacheBytes,0);assert.equal(x.exit.code,0);assert.deepEqual(counts(),{ends:1,resets:1,rejected:0});
});
test('close during open settles the pending open promise',async()=>{
 const {c,counts}=fixture();c.openInfo=null;await c.close();assert.equal(counts().rejected,1);
});
test('native protocol metadata cannot silently accept an older executable',()=>{
 const c=Object.create(FilmcraftClient.prototype);assert.throws(()=>c.receive({event:'ready',protocol:1},Buffer.alloc(0)),/ready metadata/);
});
