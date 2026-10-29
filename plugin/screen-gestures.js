/* Pure mouse gesture recognition. No DOM, timers, player or filesystem. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(typeof window==='object')window.EVAScreenGestures=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const multiplier = e => e.shiftKey === e.ctrlKey ? 1 : e.shiftKey ? 2 : .5;
  const PIXELS_PER_FRAME=8;
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  function createGesture(){
    let value=null;
    function down(e,context){
      if(value||e.button!==0||!Number.isFinite(e.x)||!Number.isFinite(e.y)||!(context.width>0)||!(context.range.end>context.range.start))return false;
      // Frame mapping belongs to the owning player. Keep source ordinals rather
      // than inferring frame count from duration/FPS, including for VFR media.
      const bounds={minOrdinal:context.minOrdinal,maxOrdinal:context.maxOrdinal},frameAt=context.frameAt;
      const first=typeof frameAt==='function'?frameAt(context.range.start,bounds):null,last=typeof frameAt==='function'?frameAt(context.range.end,bounds):null;
      const frame=typeof frameAt==='function'?frameAt(context.time,bounds):null;
      const mapped=first&&last&&frame&&[first.ordinal,last.ordinal,frame.ordinal].every(Number.isSafeInteger);
      value={id:e.id,epoch:context.epoch,x:e.x,y:e.y,lastX:e.x,lastY:e.y,lastAt:e.at,at:e.at,axis:null,held:false,moved:false,sustained:false,
        range:{...context.range},width:context.width,time:mapped?frame.time:context.time,ordinal:mapped?frame.ordinal:null,
        minOrdinal:mapped?first.ordinal:null,maxOrdinal:mapped?last.ordinal:null,frameAt,frameOrigin:mapped?frame.ordinal:null,frameOffset:0,
        rate:context.rate,step:context.step,carry:0,axisAt:null,travel:0,horizontalOnly:!!context.horizontalOnly};
      return true;
    }
    function hold(){if(!value||value.axis||value.moved)return false;value.held=true;return true;}
    function move(e){
      if(!value||value.id!==e.id||!Number.isFinite(e.x)||!Number.isFinite(e.y))return null;
      const v=value,dx=e.x-v.x,dy=e.y-v.y,first=!v.axis;
      v.travel=Math.hypot(dx,dy); v.moved ||= v.travel >= 6;
      if(!v.axis){
        if(v.horizontalOnly){if(Math.abs(dx)<6)return null;v.axis='x';}
        else {
        if(Math.max(Math.abs(dx),Math.abs(dy))<6)return null;
        if(Math.abs(dx)>Math.abs(dy)*1.15)v.axis='x';else if(Math.abs(dy)>Math.abs(dx)*1.15)v.axis='y';else return null;
        }
        v.axisAt=e.at;
      }
      const mx=e.x-v.lastX,my=v.lastY-e.y,dt=Math.max(1,e.at-v.lastAt),factor=multiplier(e);
      v.lastX=e.x;v.lastY=e.y;v.lastAt=e.at;
      if(v.axis==='x'){
        const direction=mx<0?'left':'right';
        if(v.ordinal===null)return {kind:'direction',direction};
        v.frameOffset=clamp(v.frameOffset+mx/PIXELS_PER_FRAME*factor,v.minOrdinal-v.frameOrigin,v.maxOrdinal-v.frameOrigin);
        const next=v.frameOrigin+Math.trunc(v.frameOffset);
        const frame=v.frameAt(v.time,{ordinal:next,minOrdinal:v.minOrdinal,maxOrdinal:v.maxOrdinal});
        if(!frame||frame.ordinal!==next||!Number.isFinite(frame.time))return {kind:'direction',direction};
        v.ordinal=next;v.time=frame.time;
        return {kind:'seek',time:v.time,ordinal:v.ordinal,direction};
      }
      if(!mx&&!my)return null;
      if(first){
        v.rate=clamp(Math.round((v.rate+Math.sign(my)*v.step*factor)*1000)/1000,.1,4);
        return {kind:'rate',rate:v.rate,direction:my<0?'down':'up'};
      }
      // A brief fast flick changes one step. Slow or sustained movement repeats
      // by travelled distance; holding still never runs a repeating timer.
      if(e.at-v.axisAt<140&&Math.abs(my)/dt>.6)return {kind:'direction',direction:my<0?'down':'up'};
      if(v.carry&&Math.sign(v.carry)!==Math.sign(my))v.carry=0;
      v.carry+=my;
      const steps=Math.trunc(v.carry/28);
      if(!steps)return {kind:'direction',direction:my<0?'down':'up'};
      v.carry-=steps*28;v.sustained=true;
      v.rate=clamp(Math.round((v.rate+steps*v.step*factor)*1000)/1000,.1,4);
      return {kind:'rate',rate:v.rate,direction:my<0?'down':'up'};
    }
    function end(id){if(!value||id!==undefined&&id!==value.id)return null;const old=value;value=null;return old.axis==='x'?(old.ordinal===null?null:{kind:'seek',time:old.time,ordinal:old.ordinal,final:true}):!old.moved&&!old.held?{kind:'toggle'}:null;}
    return {down,hold,move,end,cancel:()=>{value=null;},snapshot:()=>value?{...value,range:{...value.range}}:null};
  }
  return {createGesture,multiplier,PIXELS_PER_FRAME};
});
