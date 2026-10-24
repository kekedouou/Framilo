'use strict';
const assert=require('assert'),{harness,sample,flush}=require('./player.cjs');
async function run(){
 const h=harness(),p=h.player;await h.load(sample());await flush();
 const canvas=()=>({width:1,height:1,getContext:()=>({fillRect(){},drawImage(){}})});
 const time=p.time,index=p.currentIndex,c=canvas(),before=p.budget.snapshot().used;
 const lease=await p.paintThumbnail(time,c);assert(lease);assert.equal(c.width,240);assert.equal(c.height,Math.round(72*240/352),'Thumbnail preserves source aspect without artificial bars');assert.equal(p.time,time);assert.equal(p.currentIndex,index);assert.equal(p.budget.snapshot().kinds['record-thumbnail'],129600);
 lease.release();lease.release();assert.equal(c.width,1);assert.equal(p.budget.snapshot().used,before);
 // A missing thumbnail cannot schedule a decoder while video is playing.
 const oldDecode=p._decode;let calls=0;p._decode=async()=>{calls++;return null;};const cached=p.cache.get(15);p.cache.delete(15);p.state='playing';assert.equal(await p.paintThumbnail(1.5,canvas()),null);assert.equal(calls,0);p.state='paused';p._decode=oldDecode;if(cached)p.cache.set(15,cached);
 const retained=await p.paintThumbnail(time,canvas());assert(retained);await h.close();await flush();assert.equal(p.thumbnailLeases.size,0);assert.equal(p.budget.snapshot().used,0);retained.release();
 console.log('E19 thumbnails: shared RAM accounting, idempotent release, exact playback state, no playing decode and shutdown release passed (model only).');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});module.exports={run};
