const assert=require('node:assert/strict'),{create}=require('../plugin/timeline-strip.js');
function fixture(width=640,withObserver=true){let reads=0,notify,disconnected=false,paints=0,range={start:0,end:10};const listeners=new Map(),frames=Array.from({length:300},(_,i)=>({time:i/30}));
 const canvas={dataset:{},setAttribute(){},getContext:()=>({scale(){},fillRect(){paints++;}}),remove(){this.removed=true;}};
 const timeline={prepend(){},getBoundingClientRect(){reads++;return{width};}};
 const win={devicePixelRatio:1,addEventListener(t,fn){listeners.set(t,fn);},removeEventListener(t,fn){if(listeners.get(t)===fn)listeners.delete(t);}};
 if(withObserver)win.ResizeObserver=class{constructor(fn){notify=fn;}observe(){}disconnect(){disconnected=true;}};
 const api=create({document:{getElementById:()=>timeline,createElement:()=>canvas},window:win,getState:()=>({duration:10,epoch:1}),getRange:()=>range,getSession:()=>({timelineFrames:()=>frames})});
 return{api,canvas,listeners,reads:()=>reads,paints:()=>paints,setWidth:v=>{width=v;},setRange:v=>{range=v;},resize:()=>listeners.get('resize')?.(),observe:()=>notify?.(),disconnected:()=>disconnected};}
{
 const h=fixture();h.api.update();const initial=h.paints();for(let i=0;i<240;i++)h.api.update();assert.equal(h.reads(),1);assert.equal(h.paints(),initial);
 h.setWidth(800);h.observe();assert.equal(h.reads(),2);assert.equal(h.canvas.width,800);h.setRange({start:2,end:4});h.api.update();assert.equal(h.reads(),3);h.resize();assert.equal(h.reads(),4);h.api.destroy();assert(h.disconnected());assert.equal(h.listeners.size,0);assert(h.canvas.removed);
}
{
 const h=fixture(0,false);h.api.update();assert.equal(h.canvas.width,1);h.setWidth(640);h.api.update();assert.equal(h.canvas.width,640);assert.equal(h.reads(),2,'Zero-width hidden initialization must recover without a ResizeObserver');h.api.destroy();
}
console.log('E47 ruler geometry: repeated notifications reuse width, resize/range invalidate, hidden zero width recovers; no browser/media/Eagle.');
