'use strict';
const assert=require('assert'),{createScrubBackground}=require('../plugin/scrub-background.cjs'),profile=require('../plugin/preview-profile.cjs');
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
async function main(){
 for(const video of [{width:3840,height:2160},{width:1080,height:1920},{width:320,height:240},{width:1920,height:1080,side_data_list:[{rotation:90}]}]){const p=profile.scrubDimensions(video);profile.validate(p,video);assert(Math.max(p.width,p.height)<=480&&Math.min(p.width,p.height)<=270);assert.throws(()=>profile.validate({...p,width:p.width+1},video));profile.validate(profile.dimensions(video),video);}
 const segments=[0,1,2].map(n=>({start:n*2,end:n*2+2}));let creates=0,stops=0;const seen=[],released=[];
 const value=n=>({frames:[{bytes:10}],leaseId:String(n)});
 const bg=createScrubBackground({info:{segments},enqueue:fn=>Promise.resolve().then(fn),lookup:async n=>n===0?value(n):null,publish:async n=>value(n),stream:start=>{creates++;let n=start;return{end:3,async next(){return{ordinal:n++,items:[{}],bytes:10};},async close(){stops++;}};},budget:async()=>({usedBytes:0,diskLimitBytes:1024**3}),release:async v=>released.push(v.leaseId),onSegment:n=>seen.push(n)});
 bg.start();bg.start();await flush();assert.equal(bg.snapshot().stage,'complete');assert.deepEqual(seen,[0,1,2]);assert.equal(creates,1);assert.equal(stops,1);await bg.close();assert.deepEqual(released,['0','1','2']);
 let done;const cancelled=[];const b=createScrubBackground({info:{segments},enqueue:fn=>Promise.resolve().then(fn),lookup:()=>new Promise(r=>done=r),publish(){throw Error('unexpected');},stream(){throw Error('unexpected');},budget:async()=>({usedBytes:0,diskLimitBytes:1024**3}),release:async v=>cancelled.push(v.leaseId)});
 b.start();await flush();b.stop();done(value(0));await b.close();assert.deepEqual(cancelled,['0']);assert.equal(b.snapshot().ready,0);
 console.log('ok sparse profile and continuous background: cache reuse, window reuse, cancel during lease acquisition, release');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
