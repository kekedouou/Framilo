
'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{Budget}=require('../plugin/player.js');
test('E47 RAM kind totals stay exact through reserve, shrinking across kinds, duplicate release and eviction',()=>{
 const b=new Budget(1000),a=b.reserve(300,'a'),z=b.reserve(0,'zero'),c=b.reserve(250,'b');assert.deepEqual(b.snapshot().kinds,{a:300,zero:0,b:250});
 b.shrink(a,120,'b');assert.deepEqual(b.snapshot().kinds,{zero:0,b:370});assert.equal(b.used,370);assert.equal(b.peak,550);
 b.shrink(z,0,'empty');assert.deepEqual(b.snapshot().kinds,{b:370,empty:0});b.release(z);b.release(z);assert.deepEqual(b.snapshot().kinds,{b:370});
 b.snapshot().kinds.b=999999;assert.equal(b.snapshot().kinds.b,370);assert.throws(()=>b.shrink(c,251,'bad'));assert.equal(b.snapshot().kinds.b,370);
 const d=b.reserve(800,'c',()=>{b.release(c);b.release(a);return true;});assert.deepEqual(b.snapshot().kinds,{c:800});assert.equal(b.used,800);b.release(d);assert.deepEqual(b.snapshot().kinds,{});assert.equal(b.used,0);
});
test('E47 dense-cache snapshots do not traverse tokens, and hostile-looking kind names remain plain own keys',()=>{
 const b=new Budget(100000);for(let n=0;n<10000;n++)b.reserve(1,n%2?'decoded':'compressed');b.reserve(2,'__proto__');
 b.tokens.forEach=()=>{throw Error('snapshot traversed every allocation');};const s=b.snapshot();assert.equal(s.used,10002);assert.equal(s.kinds.decoded,5000);assert.equal(s.kinds.compressed,5000);assert.equal(Object.getPrototypeOf(s.kinds),Object.prototype);assert.equal(s.kinds.__proto__,2);s.kinds.decoded=1;assert.equal(b.snapshot().kinds.decoded,5000);
});
