'use strict';
// Producer reads outside the cache queue; each verified small publication uses
// the one existing writer. At most one window and one pending batch per source.
function createScrubBackground({info,enqueue,lookup,publish,stream,budget,release,onSegment=()=>{},emit=()=>{}}){
 const controller=new AbortController(),held=new Map();let task=null,current=null,stopped=false,closed=false,failure=null,bytes=0,state='idle';
 const cap=64*1024**2;
 function check(){if(stopped||controller.signal.aborted)throw Object.assign(Error('低清后台已停止。'),{code:'MEDIA_CANCELLED'});}
 function notify(){emit({stage:state,ready:held.size,total:info.segments.length,bytes,limit:cap,...(failure?{error:failure.message}:{})});}
 async function retain(n,value){
  if(!value)return;if(stopped){await release(value);check();}if(held.has(n))throw Error('低清分段重复登记。');held.set(n,value);bytes+=value.framePack?.bytes||value.frames.reduce((sum,f)=>sum+f.bytes,0);await onSegment(n,value);notify();
 }
 function start(){
  if(task||stopped)return;state='preparing';notify();
  task=(async()=>{
   for(let n=0;n<info.segments.length;n++){
    check();const cached=await enqueue(async()=>{check();const disk=await budget(controller.signal);if(bytes>=cap||disk.usedBytes>disk.diskLimitBytes-128*1024**2){state='budget';return false;}return lookup(n,controller.signal);});
    if(cached===false)break;if(cached)await retain(n,cached);check();
    if(current&&n>=current.end){await current.close();current=null;}
    if(cached&&!current)continue;
    if(!current)current=stream(n,controller.signal);
    const chunk=await current.next();check();if(!chunk||chunk.ordinal!==n)throw Error('低清生成次序无效。');
    if(cached)continue;
    if(bytes+chunk.bytes>cap){state='budget';break;}
    if(chunk.items.length)await retain(n,await enqueue(async()=>{check();return publish(n,chunk.items,controller.signal);}));
   }
   if(!stopped&&state==='preparing')state='complete';
  })().catch(error=>{if(error.code!=='MEDIA_CANCELLED'&&error.name!=='AbortError'){failure=error;state='error';}}).finally(async()=>{if(current){await current.close();current=null;}notify();});
  task.catch(error=>{failure=error;state='error';notify();});
 }
 function stop(){stopped=true;controller.abort();state='stopped';}
 async function close(){stop();if(task)await task;const results=await Promise.allSettled([...held].map(async([n,value])=>{await release(value);held.delete(n);}));const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;if(failure?.code==='MEDIA_CLEANUP_FAILED')throw failure;closed=true;}
 return {start,stop,close,snapshot:()=>({stage:state,ready:held.size,bytes,closed,error:failure?.message||null})};
}
module.exports={createScrubBackground};
