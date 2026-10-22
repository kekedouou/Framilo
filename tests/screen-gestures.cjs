'use strict';
const assert=require('assert'),{createGesture,multiplier}=require('../plugin/screen-gestures.js');
let count=0;const test=(name,fn)=>{fn();count++;console.log('ok screen gesture: '+name);};
const context={epoch:1,width:1000,range:{start:2,end:12},time:5,rate:1,step:.1};
const e=(x,y,at=0,extra={})=>({id:1,button:0,x,y,at,shiftKey:false,ctrlKey:false,...extra});
test('Horizontal drag maps to the visible timeline range, locks its axis and finishes with exact final target',()=>{
  const g=createGesture();assert(g.down(e(100,100),context));assert.equal(g.move(e(110,100,10)).kind,'seek');const b=g.move(e(210,10,200));
  assert.equal(b.kind,'seek');assert.equal(b.time,6.1);assert.deepEqual(g.end(1),{kind:'seek',time:6.1,final:true});assert(!g.snapshot());
});
test('Shift doubles and Ctrl halves only the next movement; changing modifiers cannot jump the current target',()=>{
  const g=createGesture();g.down(e(100,100),context);assert.equal(g.move(e(200,100,10,{shiftKey:true})).time,7);
  assert.equal(g.move(e(300,100,20,{ctrlKey:true})).time,7.5);assert.equal(g.move(e(300,100,30,{shiftKey:true})).time,7.5);
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
console.log('Screen gesture model: '+count+' pure-input checks; no Eagle/performance conclusions.');
