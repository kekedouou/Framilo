/* Source-frame ruler only; transport positions and hit targets remain in UI. */
(function(root){'use strict';
 function buildTicks(frames,range,width){
  if(!Array.isArray(frames)||!frames.length||!range||!(range.end>range.start)||!Number.isFinite(width)||width<=0)return{step:1,ticks:[]};
  const lower=t=>{let lo=0,hi=frames.length;while(lo<hi){const mid=(lo+hi)>>>1;if(frames[mid].time<t)lo=mid+1;else hi=mid;}return lo;};
  const first=lower(range.start),last=lower(range.end),count=last-first;
  const step=Math.max(1,Math.ceil(count/Math.max(1,Math.floor(width/10)))),ticks=[];
  for(let ordinal=Math.ceil(first/step)*step;ordinal<frames.length&&frames[ordinal].time<=range.end;ordinal+=step){const time=frames[ordinal].time;ticks.push({ordinal,time,x:(time-range.start)/(range.end-range.start)*width});}
  return{step,ticks};
 }
 function create({document:doc,window:win,getState,getSession,getRange}){
  const timeline=doc.getElementById('timeline'),canvas=doc.createElement('canvas');canvas.className='timeline-ticks';canvas.setAttribute('aria-hidden','true');timeline.prepend(canvas);
  let key='',previousFrames=null,dead=false,cachedWidth=null,geometryKey='';
  function update(){if(dead)return;const state=getState(),frames=getSession()?.timelineFrames?.(),range=getRange?.()||{start:0,end:state.duration},rangeKey=[range.start,range.end,state.epoch].join(':');
   // Frame notifications do not resize the ruler. Read layout only when its
   // geometry changed; zero widths are retried so a hidden ruler can recover.
   if(cachedWidth===null||cachedWidth<=0||geometryKey!==rangeKey){cachedWidth=Math.round(timeline.getBoundingClientRect().width);geometryKey=rangeKey;}
   const width=cachedWidth,dpr=Math.min(2,win.devicePixelRatio||1),next=[width,dpr,range.start,range.end,state.epoch].join(':');if(next===key&&frames===previousFrames)return;key=next;previousFrames=frames;
   canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=48*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
   const result=buildTicks(frames,range,width);ctx.fillStyle='#50575f';for(const tick of result.ticks)ctx.fillRect(Math.min(Math.max(0,width-2),Math.round(tick.x)),34,2,10);
   canvas.dataset.ticks=String(result.ticks.length);canvas.dataset.frameStep=String(result.step);
  }
  function resized(){cachedWidth=null;update();}
  const observer=win.ResizeObserver?new win.ResizeObserver(resized):null;observer?.observe(timeline);win.addEventListener('resize',resized);
  return{update,destroy(){dead=true;observer?.disconnect();win.removeEventListener('resize',resized);canvas.remove();}};
 }
 const api={create,buildTicks};if(typeof module==='object'&&module.exports)module.exports=api;root.EVATimelineStrip=api;
})(typeof window==='object'?window:globalThis);
