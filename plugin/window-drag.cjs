'use strict';
// SDK adapter only. Pointer positions are screen coordinates, never video coordinates.
function createWindowDrag({host,screen,sync=async()=>{},report=()=>{},trace=()=>{},schedule=fn=>setTimeout(fn,16),cancel=clearTimeout}) {
 let current=null,serial=0;
 const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
 const record=(stage,value)=>{try{trace(stage,value);}catch(_){}};
 async function call(method,...args){try{return await host[method](...args);}catch(e){throw Error(method+'('+args.map(x=>String(x)).join(', ')+'): '+e.message);}}
 function fail(error,s){if(current!==s)return;current=null;if(s.timer!==null)cancel(s.timer);record('drag-error',{message:error.message});report(error);}
 async function flush(s){
  s.timer=null;if(current!==s||!s.ready||s.busy)return;s.busy=true;
  try{if(current===s&&s.latest){let p=s.latest;s.latest=null;
   // Electron screen points and window positions share device-independent units.
   // Browser screenX can change coordinate scale at mixed-DPI monitor boundaries.
   if(screen?.getCursorScreenPoint){const live=await screen.getCursorScreenPoint();if(point(live))p=live;}
   if(current!==s)return;
   const x=Math.round(p.x-s.anchorX),y=Math.round(p.y-s.anchorY);
   // Electron converts these to signed 32-bit integers, not arbitrary JS numbers.
   if(![x,y].every(v=>Number.isInteger(v)&&v>=-2147483648&&v<=2147483647))throw Error('setPosition坐标超出有效范围: '+x+', '+y);
   if(s.lastX!==x||s.lastY!==y){if(s.lastX===undefined)record('drag-first-position',{x,y,anchorX:s.anchorX,anchorY:s.anchorY});s.lastX=x;s.lastY=y;await call('setPosition',x,y);}}}
  catch(e){fail(e,s);}finally{s.busy=false;if(current===s){if(s.ended&&!s.latest)current=null;else if(s.latest)queue(s);}}
 }
 function queue(s){if(s.ready&&!s.busy&&s.timer===null)s.timer=schedule(()=>flush(s));}
 return {
  async start(p){if(!point(p))return;const previous=current;if(previous?.timer!==null&&previous?.timer!==undefined)cancel(previous.timer);const s=current={id:++serial,latest:{x:p.x,y:p.y},ratio:Math.max(0,Math.min(1,p.ratio||0)),anchorY:Math.max(0,Math.min(43,p.offsetY||0)),ready:false,busy:false,ended:false,timer:null};
   record('drag-start',{x:p.x,y:p.y,ratio:s.ratio,offsetY:s.anchorY,fullscreen:p.fullscreen!==false,cached:!!p.restore});
   try{
    if(p.fullscreen!==false)await call('setFullScreen',false);
    if(current!==s)return;
    let [maximized,size]=p.restore&&Array.isArray(p.restore.size)?[p.restore.maximized,p.restore.size]:await Promise.all([call('isMaximized'),call('getSize')]);
    if(current!==s)return;if(maximized){await call('unmaximize');size=await call('getSize');}
    if(current!==s)return;if(!Array.isArray(size)||!Number.isFinite(size[0])||size[0]<=0)throw Error('无法读取恢复后的窗口尺寸');
    s.anchorX=Math.max(16,Math.min(size[0]-16,size[0]*s.ratio));record('drag-restored',{width:size[0],maximized:!!maximized});s.ready=true;await flush(s);if(current===s||s.ended)await sync();
   }catch(e){fail(e,s);}
  },
  move(p){const s=current;if(!s||s.ended||!point(p))return;s.latest={x:p.x,y:p.y};queue(s);},
  end(p){const s=current;if(!s)return;if(point(p))s.latest={x:p.x,y:p.y};s.ended=true;queue(s);},
  cancel(){const s=current;current=null;serial++;if(s?.timer!==null&&s?.timer!==undefined)cancel(s.timer);}
 };
}
module.exports={createWindowDrag};
