/* Fast-drag-only JPEG reader. No seeking, generation, or exact-frame authority. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.EVAScrubPreview=api;})(globalThis,function(){
 'use strict';
 function create({canvas,find,read,budget,evict,isCurrent,onDraw=()=>{},onMiss=()=>{},env={}}){
  const doc=env.document||canvas.ownerDocument,overlay=doc.createElement('canvas');
  const decode=env.decode||(bytes=>createImageBitmap(new Blob([bytes],{type:'image/jpeg'})));
  overlay.width=overlay.height=1;overlay.hidden=true;overlay.setAttribute('aria-hidden','true');
  overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;z-index:1;background:#000';
  canvas.parentElement.appendChild(overlay);
  const cache=new Map(),limit=Math.min(4*1024**2,Math.floor(budget.snapshot().limit/128));
  let pending=null,work=null,closed=false,generation=0,used=0,backing=null;
  function drop(key){const e=cache.get(key);cache.delete(key);used-=e.bytes;try{e.picture.close();}finally{budget.release(e.token);}}
  function cancel(){generation++;pending=null;}
  function clear(){cancel();overlay.hidden=true;overlay.width=overlay.height=1;if(backing)budget.release(backing);backing=null;}
  function pump(){
   if(closed||work||!pending)return;
   const request=pending,frame=request.frame,epoch=generation;pending=null;
   work=(async()=>{
    let own=null,input=null;
    try{
     let e=cache.get(frame.id);
     if(e){cache.delete(frame.id);cache.set(frame.id,e);}
     else{
      const bytes=frame.width*frame.height*4;
      if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>480*270*4||bytes>limit)throw Error('低清尺寸超出预算。');
      while(cache.size&&used+bytes>limit)drop(cache.keys().next().value);
      own={bytes,token:budget.reserve(bytes,'scrub-bitmap',evict),picture:null};
      input=budget.reserve(2*1024**2,'scrub-jpeg-transfer',evict);
      const data=await read(frame);if(data.byteLength>1024**2)throw Error('低清读取超过上限。');
      if(closed||epoch!==generation)return;
      own.picture=await decode(data);
      if(own.picture.width!==frame.width||own.picture.height!==frame.height)throw Error('低清尺寸不一致。');
      e=own;
     }
     if(closed||epoch!==generation||!isCurrent())return;
     // The one queued replacement can reuse this decoded picture only when it
     // identifies the same source frame; otherwise no obsolete draw occurs.
     const current=pending||request;
     if(current.frame.id===frame.id){
      const token=backing||budget.reserve(e.bytes,'scrub-canvas',evict);
      try{if(!backing){overlay.width=frame.width;overlay.height=frame.height;}overlay.getContext('2d',{alpha:false,willReadFrequently:true}).drawImage(e.picture,0,0);backing=token;}
      catch(error){if(!backing){overlay.width=overlay.height=1;budget.release(token);}throw error;}
      overlay.hidden=false;if(pending===current)pending=null;onDraw(frame,current.settings,current.time);
     }
     if(own){cache.set(frame.id,own);used+=own.bytes;own=null;}
    }catch(_){if(!closed&&epoch===generation&&isCurrent()){const current=pending||request;pending=null;onMiss(current.time,current.settings);}}
    finally{if(input)budget.release(input);if(own){own.picture?.close();budget.release(own.token);}}
   })().finally(()=>{work=null;pump();});
  }
  return {
   request(time,settings={}){if(closed||settings.final!==false)return false;const frame=find(time);if(!frame||Math.abs(frame.time-time)>.15)return false;pending={time,frame,settings};pump();return true;},
   cancel,clear,snapshot:()=>({cachedFrames:cache.size,cachedBytes:used,pending:!!(work||pending),active:!overlay.hidden}),
   async close(){if(closed)return;closed=true;clear();if(work)await work;for(const key of [...cache.keys()])drop(key);overlay.remove();}
  };
 }
 return {create};
});
