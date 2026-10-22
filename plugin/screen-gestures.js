/* Pure mouse gesture recognition. No DOM, timers, player or filesystem. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(typeof window==='object')window.EVAScreenGestures=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const multiplier = e => e.shiftKey === e.ctrlKey ? 1 : e.shiftKey ? 2 : .5;
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  function createGesture(){
    let value=null;
    function down(e,context){
      if(value||e.button!==0||!Number.isFinite(e.x)||!Number.isFinite(e.y)||!(context.width>0)||!(context.range.end>context.range.start))return false;
      value={id:e.id,epoch:context.epoch,x:e.x,y:e.y,lastX:e.x,lastY:e.y,lastAt:e.at,at:e.at,axis:null,held:false,
        range:{...context.range},width:context.width,time:context.time,rate:context.rate,step:context.step,carry:0,axisAt:null,travel:0};
      return true;
    }
    function hold(){if(!value||value.axis||value.travel>=6)return false;value.held=true;return true;}
    function move(e){
      if(!value||value.id!==e.id||!Number.isFinite(e.x)||!Number.isFinite(e.y))return null;
      const v=value,dx=e.x-v.x,dy=e.y-v.y,first=!v.axis;
      v.travel=Math.hypot(dx,dy);
      if(!v.axis){
        if(Math.max(Math.abs(dx),Math.abs(dy))<6)return null;
        if(Math.abs(dx)>Math.abs(dy)*1.15)v.axis='x';else if(Math.abs(dy)>Math.abs(dx)*1.15)v.axis='y';else return null;
        v.axisAt=e.at;
      }
      const mx=e.x-v.lastX,my=v.lastY-e.y,dt=Math.max(1,e.at-v.lastAt),factor=multiplier(e);
      v.lastX=e.x;v.lastY=e.y;v.lastAt=e.at;
      if(v.axis==='x'){
        v.time=clamp(v.time+mx/v.width*(v.range.end-v.range.start)*factor,v.range.start,v.range.end);
        return {kind:'seek',time:v.time,direction:mx<0?'left':'right'};
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
      v.carry-=steps*28;
      v.rate=clamp(Math.round((v.rate+steps*v.step*factor)*1000)/1000,.1,4);
      return {kind:'rate',rate:v.rate,direction:my<0?'down':'up'};
    }
    function end(id){if(!value||id!==undefined&&id!==value.id)return null;const old=value;value=null;return old.axis==='x'?{kind:'seek',time:old.time,final:true}:null;}
    return {down,hold,move,end,cancel:()=>{value=null;},snapshot:()=>value?{...value,range:{...value.range}}:null};
  }
  return {createGesture,multiplier};
});
