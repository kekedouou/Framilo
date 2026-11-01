'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fitBounds,createWindowFit}=require('../plugin/window-fit.cjs');
const area={x:-1920,y:0,width:1920,height:1040},bounds={x:-1800,y:70,width:1120,height:760};
test('landscape/portrait fit display work area and reserve actual header/timeline height',()=>{
 for(const [width,height]of [[1920,1080],[1080,1920],[2560,1080],[1080,1080]]){
  const b=fitBounds({width,height},bounds,area);
  assert(Math.abs(b.width/(b.height-112)-width/height)<.005);assert(b.x>=area.x&&b.y>=area.y);
  assert(b.x+b.width<=area.x+area.width&&b.y+b.height<=area.y+area.height);
 }
 assert(fitBounds({width:1080,height:1920},bounds,area).width<720);
 assert.equal(fitBounds({width:0,height:0},bounds,area),null);
});
test('one fit per source; never resize fullscreen/maximized, a changed window or a disposed request',async()=>{
 let full=false,max=false,current={...bounds},writes=[],release;
 const host={isFullScreen:async()=>full,isMaximized:async()=>max,getBounds:async()=>({...current}),setBounds:async b=>{writes.push(b);current=b;}};
 const screen={getDisplayNearestPoint:async()=>({workArea:area})};
 const s=id=>({source:{id,filePath:id+'.mp4'},preview:{width:1080,height:1920}});
 const f=createWindowFit({host,screen});await f.update(s('a'));assert.equal(writes.length,1);await f.update(s('a'));assert.equal(writes.length,1);
 full=true;await f.update(s('b'));full=false;max=true;await f.update(s('c'));max=false;assert.equal(writes.length,1);
 screen.getDisplayNearestPoint=()=>new Promise(r=>{release=r;});const pending=f.update(s('d'));while(!release)await Promise.resolve();current.width++;release({workArea:area});await pending;assert.equal(writes.length,1);
 release=null;const stale=f.update(s('e'));while(!release)await Promise.resolve();f.update({source:{id:'f',filePath:'f.mp4'},state:'preparing'});release({workArea:area});await stale;assert.equal(writes.length,1);
 release=null;const closing=f.update(s('f'));while(!release)await Promise.resolve();f.destroy();release({workArea:area});await closing;assert.equal(writes.length,1);
});
