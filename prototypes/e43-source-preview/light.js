/* Isolated sparse preview consumer. Approximate pictures never claim exactness. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;root.createLightExperiment=api.create;})(globalThis,function(){
 'use strict';
 function create({frames,read,decode,draw,limit=8*1024**2,now=()=>performance.now()}){
  if(!Array.isArray(frames)||!frames.length||frames.some((f,n)=>!Number.isFinite(f.time)||f.time<0||n&&f.time<=frames[n-1].time))throw Error('Invalid preview index');
  let latest=null,active=null,closed=false,used=0,serial=0;const cache=new Map(),stats={reads:0,hits:0,draws:0,peakBytes:0};
  const nearest=time=>{let l=0,h=frames.length;while(l<h){const m=(l+h)>>>1;if(frames[m].time<time)l=m+1;else h=m;}if(l===frames.length)return l-1;return l&&time-frames[l-1].time<=frames[l].time-time?l-1:l;};
  function release(key){const e=cache.get(key);if(!e)return;cache.delete(key);used-=e.bytes;e.picture.close();}
  function finish(r,status,extra={}){r.resolve({status,ms:now()-r.at,requested:r.time,...extra});}
  async function pump(){
   if(closed||active||!latest)return;
   const request=latest,index=nearest(request.time),frame=frames[index];
   if(request.final&&Math.abs(frame.time-request.time)>0.000001){latest=null;finish(request,'needs-exact');return;}
   if(Math.abs(frame.time-request.time)>0.15){latest=null;finish(request,'uncovered');return;}
   const operation=active={index,promise:null};
   operation.promise=(async()=>{
    let picture,bytes,owned=false;
    try{
     const hit=cache.get(index);
     if(hit){stats.hits++;picture=hit.picture;bytes=hit.bytes;cache.delete(index);cache.set(index,hit);}
     else{
      // Budget before decoding, including one in-flight bitmap; no hidden unbounded pool.
      bytes=480*270*4;if(bytes>limit)throw Error('Preview memory limit');
      while(used+bytes>limit&&cache.size)release(cache.keys().next().value);
      used+=bytes;stats.peakBytes=Math.max(stats.peakBytes,used);stats.reads++;
      try{picture=await decode(await read(index));owned=true;}catch(e){used-=bytes;throw e;}
      if(picture.width!==480||picture.height!==270)throw Error('Unexpected preview geometry');
     }
     if(closed)return;
     const current=latest;
     if(current&&nearest(current.time)===index&&(!current.final||Math.abs(current.time-frame.time)<=0.000001)){
      draw(picture,{time:frame.time,requested:current.time,approximate:frame.time!==current.time});stats.draws++;
      latest=null;finish(current,'preview',{time:frame.time,errorMs:(frame.time-current.time)*1000});
     }
     if(owned){cache.set(index,{picture,bytes});owned=false;}
    }catch(error){if(latest&&nearest(latest.time)===index){const current=latest;latest=null;finish(current,'error',{error:error.message});}}
    finally{if(owned){picture.close();used-=bytes;}if(active===operation)active=null;if(latest&&!closed)pump();}
   })();
  }
  return {
   request(time,{final=false}={}){if(closed)return Promise.resolve({status:'closed'});if(!Number.isFinite(time)||time<0)return Promise.reject(Error('Invalid target'));if(latest)finish(latest,'superseded');return new Promise(resolve=>{latest={id:++serial,time,final,at:now(),resolve};pump();});},
   snapshot(){return {...stats,bytes:used,frames:cache.size,pending:!!latest};},
   async close(){closed=true;if(latest){finish(latest,'closed');latest=null;}if(active)await active.promise;for(const key of cache.keys())release(key);}
  };
 }
 return {create};
});
