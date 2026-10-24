'use strict';
// SDK adapter only. Pointer positions are screen coordinates, never video coordinates.
function createWindowDrag({host,sync=async()=>{},report=()=>{},schedule=fn=>setTimeout(fn,0),cancel=clearTimeout}) {
 let current=null,serial=0;
 const point=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
 function fail(error,s){if(current!==s)return;current=null;if(s.timer)cancel(s.timer);report(error);}
 async function flush(s){
  s.timer=null;if(current!==s||!s.ready||s.busy)return;s.busy=true;
  try{if(current===s&&s.latest){const p=s.latest;s.latest=null;const x=Math.round(p.x-s.anchorX),y=Math.round(p.y-s.anchorY);if(s.lastX!==x||s.lastY!==y){s.lastX=x;s.lastY=y;await host.setPosition(x,y);}}}
  catch(e){fail(e,s);}finally{s.busy=false;if(current===s){if(s.ended&&!s.latest)current=null;else if(s.latest)queue(s);}}
 }
 function queue(s){if(s.ready&&!s.busy&&!s.timer)s.timer=schedule(()=>flush(s));}
 return {
  async start(p){if(!point(p))return;const previous=current;if(previous?.timer)cancel(previous.timer);const s=current={id:++serial,latest:{x:p.x,y:p.y},ratio:Math.max(0,Math.min(1,p.ratio||0)),anchorY:Math.max(0,Math.min(43,p.offsetY||0)),ready:false,busy:false,ended:false,timer:null};
   try{await host.setFullScreen(false);if(current!==s)return;let [maximized,size]=p.restore&&Array.isArray(p.restore.size)?[p.restore.maximized,p.restore.size]:await Promise.all([host.isMaximized(),host.getSize()]);if(current!==s)return;if(maximized){await host.unmaximize();size=await host.getSize();}if(current!==s)return;if(!Array.isArray(size)||!Number.isFinite(size[0])||size[0]<=0)throw Error('无法读取恢复后的窗口尺寸');s.anchorX=Math.max(16,Math.min(size[0]-16,size[0]*s.ratio));s.ready=true;await flush(s);await sync();}catch(e){fail(e,s);}
  },
  move(p){const s=current;if(!s||s.ended||!point(p))return;s.latest={x:p.x,y:p.y};queue(s);},
  end(p){const s=current;if(!s)return;if(point(p))s.latest={x:p.x,y:p.y};s.ended=true;queue(s);},
  cancel(){const s=current;current=null;serial++;if(s?.timer)cancel(s.timer);}
 };
}
module.exports={createWindowDrag};
