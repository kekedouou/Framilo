'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createWindowDrag}=require('../plugin/window-drag.cjs');
test('windowed drag skips fullscreen transition, native DIP cursor wins across negative-coordinate displays',async()=>{
 const positions=[],scheduled=[];let reads=0,point={x:-1450,y:200};
 const host={setFullScreen:()=>assert.fail('windowed drag must not restore fullscreen'),isMaximized:async()=>false,getSize:async()=>[1000,700],setPosition:async(x,y)=>positions.push([x,y])};
 const d=createWindowDrag({host,screen:{getCursorScreenPoint:async()=>{reads++;return point;}},schedule:f=>{scheduled.push(f);return scheduled.length;}});
 await d.start({fullscreen:false,x:3000,y:400,ratio:.5,offsetY:20});assert.deepEqual(positions,[[-1950,180]]);
 for(let n=0;n<50;n++)d.move({x:3200+n,y:450});assert.equal(scheduled.length,1);
 point={x:-1200,y:210};await scheduled.shift()();assert.deepEqual(positions.at(-1),[-1700,190]);assert.equal(reads,2);d.cancel();
});
test('cancel during native cursor lookup cannot issue a stale window move',async()=>{
 let done,moves=0;const d=createWindowDrag({host:{setFullScreen:async()=>{},setPosition:async()=>moves++},screen:{getCursorScreenPoint:()=>new Promise(r=>done=r)}});
 const opening=d.start({x:1,y:2,ratio:.5,restore:{size:[1000,700],maximized:false}});await Promise.resolve();await Promise.resolve();d.cancel();done({x:10,y:20});await opening;assert.equal(moves,0);
});
