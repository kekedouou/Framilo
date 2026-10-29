'use strict';
const assert=require('assert'),{createGesture,multiplier}=require('../plugin/screen-gestures.js');
let count=0;const test=(name,fn)=>{fn();count++;console.log('ok screen gesture: '+name);};
const frameAt=(time,b={})=>{const ordinal=Math.max(b.minOrdinal??0,Math.min(b.maxOrdinal??360,b.ordinal??Math.floor(time*30+1e-9)));return{ordinal,time:ordinal/30};};
const context={epoch:1,width:1000,range:{start:2,end:12},time:5,rate:1,step:.1,frameAt};
const e=(x,y,at=0,extra={})=>({id:1,button:0,x,y,at,shiftKey:false,ctrlKey:false,...extra});
test('Horizontal drag moves source ordinals at eight pixels per frame, locks its axis and settles the exact frame',()=>{
  const g=createGesture();assert(g.down(e(100,100),context));assert.equal(g.move(e(110,100,10)).kind,'seek');const b=g.move(e(210,10,200));
  assert.equal(b.kind,'seek');assert.equal(b.ordinal,163);assert.equal(b.time,163/30);assert.deepEqual(g.end(1),{kind:'seek',time:163/30,ordinal:163,final:true});assert(!g.snapshot());
});
test('Shift doubles and Ctrl halves only the next movement; changing modifiers cannot jump the current target',()=>{
  const g=createGesture();g.down(e(100,100),context);assert.equal(g.move(e(200,100,10,{shiftKey:true})).ordinal,175);
  assert.equal(g.move(e(300,100,20,{ctrlKey:true})).ordinal,181);assert.equal(g.move(e(300,100,30,{shiftKey:true})).ordinal,181);
  assert.equal(multiplier(e(0,0,0,{ctrlKey:true,shiftKey:true})),1);
});
test('A fast vertical flick changes one speed step and never seeks, while continued motion repeats by distance',()=>{
  const g=createGesture();g.down(e(100,300),context);let a=g.move(e(101,200,10));assert.equal(a.kind,'rate');assert.equal(a.rate,1.1);
  a=g.move(e(200,100,20));assert.equal(a.kind,'direction');assert.equal(g.snapshot().rate,1.1);
  a=g.move(e(100,44,250));assert.equal(a.rate,1.3);assert.equal(g.end(1),null);
});
test('Downward movement and multiplier-adjusted rates stay within 0.1 through 4; holding still makes no changes',()=>{
  const g=createGesture();g.down(e(100,100),{...context,rate:.15});assert.equal(g.move(e(100,120,20,{shiftKey:true})).rate,.1);
  assert.equal(g.move(e(100,120,500)),null);assert.equal(g.snapshot().rate,.1);
  g.cancel();g.down(e(100,100),{...context,rate:3.9});assert.equal(g.move(e(100,80,20,{shiftKey:true})).rate,4);
});
test('Long hold opens only the same direction gesture; it cannot add new commands or reclassify an active axis',()=>{
  const g=createGesture();g.down(e(100,100),context);assert(g.hold());assert(g.snapshot().held);
  assert.equal(g.move(e(200,100,600)).kind,'seek');assert(!g.hold());assert.equal(g.move(e(200,-300,700)).kind,'seek');
});
test('Wrong pointer, invalid range, slight jitter, ambiguous large diagonal and cancellation leave no stale gesture',()=>{
  const g=createGesture();assert(!g.down(e(0,0),{...context,width:0}));assert(g.down(e(100,100),context));assert(!g.down(e(0,0),context));
  assert.equal(g.move(e(103,103,10)),null);assert.equal(g.move(e(200,100,20,{id:2})),null);assert.equal(g.end(2),null);assert(g.snapshot());
  g.cancel();assert(!g.snapshot());g.down(e(100,100),context);g.move(e(180,180,20));assert(!g.hold());g.cancel();
});
test('Large horizontal movement respects loop-range boundaries and speed modifiers retain fractional steps',()=>{
  const g=createGesture();g.down(e(0,0),context);assert.equal(g.move(e(9999,0,20)).time,12);assert.equal(g.move(e(-9999,0,40)).time,2);
  g.cancel();g.down(e(0,0),{...context,step:.25});assert.equal(g.move(e(0,-10,10,{ctrlKey:true})).rate,1.125);
});
test('Only a true short click can toggle playback; long holds and returned diagonal motion cannot',()=>{const g=createGesture();g.down(e(100,100),context);g.move(e(102,101,50));assert.deepEqual(g.end(1),{kind:'toggle'});g.down(e(100,100),context);g.hold();assert.equal(g.end(1),null);g.down(e(100,100),context);g.move(e(140,140,30));g.move(e(100,100,60));assert.equal(g.end(1),null);});
test('Long video duration and window width never change the number of dragged frames, including modifiers',()=>{
 for(const width of [480,1000,3840])for(const duration of [12,3600])for(const [mods,frames]of [[{},2],[{shiftKey:true},4],[{ctrlKey:true},1]]){
  const g=createGesture();g.down(e(100,100),{...context,width,range:{start:0,end:duration},frameAt:(time,b={})=>{const ordinal=Math.max(0,Math.min(duration*30,b.ordinal??Math.floor(time*30)));return{ordinal,time:ordinal/30};}});assert.equal(g.move(e(116,100,20,mods)).ordinal,150+frames);
 }
});
test('Fractional fine motion accumulates symmetrically and modifier changes with no motion do not jump',()=>{
 for(const direction of [-1,1]){const g=createGesture();g.down(e(100,100),context);assert.equal(g.move(e(100+direction*8,100,10,{ctrlKey:true})).ordinal,150);assert.equal(g.move(e(100+direction*16,100,20,{ctrlKey:true})).ordinal,150+direction);assert.equal(g.move(e(100+direction*16,100,30,{shiftKey:true})).ordinal,150+direction);}
});
test('VFR motion follows actual ordinal timestamps, and loop bounds are source frame bounds',()=>{
 const times=[0,.011,.09,.41,.9,1.8,2,4.7],frameAt=(time,b={})=>{let n=b.ordinal??times.findLastIndex(t=>t<=time);n=Math.max(b.minOrdinal??0,Math.min(b.maxOrdinal??times.length-1,n));return{ordinal:n,time:times[n]};};
 const g=createGesture();g.down(e(0,0),{...context,range:{start:0,end:5},time:.09,frameAt});assert.equal(g.move(e(16,0,20)).time,.9);assert.equal(g.move(e(24,0,40)).time,1.8);assert.equal(g.end().ordinal,5);
 const h=createGesture();h.down(e(0,0),{...context,range:{start:.09,end:2},time:.41,frameAt,minOrdinal:2,maxOrdinal:5});assert.equal(h.move(e(999,0,20)).ordinal,5);assert.equal(h.move(e(-999,0,40)).ordinal,2);
});
test('Reversing a drag has the same ordinal as direct motion to the same weighted position',()=>{
 const a=createGesture(),b=createGesture();a.down(e(0,0),context);b.down(e(0,0),context);a.move(e(120,0,20));assert.equal(a.move(e(20,0,40)).ordinal,b.move(e(20,0,20)).ordinal);
});
test('Missing frame mapping never invents seek timestamps from duration or average frame rate',()=>{
 const g=createGesture();g.down(e(0,0),{...context,frameAt:null});assert.equal(g.move(e(40,0,20)).kind,'direction');assert.equal(g.end(),null);
});
console.log('Screen gesture model: '+count+' pure-input checks; no Eagle/performance conclusions.');
