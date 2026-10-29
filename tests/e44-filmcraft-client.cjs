'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {PacketReader}=require('../prototypes/e44-filmcraft/wire.cjs');
const {FilmcraftClient,targetAt}=require('../prototypes/e44-filmcraft/client.cjs');
function packet(header,pixels=Buffer.alloc(0)){
 const json=Buffer.from(JSON.stringify(header)),prefix=Buffer.alloc(8);
 prefix.writeUInt32LE(json.length);prefix.writeUInt32LE(pixels.length,4);return Buffer.concat([prefix,json,pixels]);
}
test('all framing boundaries preserve multiple messages and pixel identity',()=>{
 const a=packet({event:'ready'}),pixels=Buffer.from([1,2,3,4,5,6,7,8]),b=packet({event:'frame',id:1},pixels),wire=Buffer.concat([a,b]);
 for(let split=1;split<wire.length;split++){
  const out=[],parser=new PacketReader((h,p)=>out.push([h,Buffer.from(p)]));
  parser.push(wire.subarray(0,split));parser.push(wire.subarray(split));
  assert.equal(out.length,2);assert.equal(out[1][0].id,1);assert.deepEqual(out[1][1],pixels);
 }
 const out=[],parser=new PacketReader((h,p)=>out.push(h));for(const byte of wire)parser.push(Buffer.from([byte]));assert.equal(out.length,2);
});
test('hostile allocation lengths rejected before allocating payload',()=>{
 for(const [h,p] of [[0,0],[8193,0],[5,64*1024*1024+1]]){
  const b=Buffer.alloc(8);b.writeUInt32LE(h);b.writeUInt32LE(p,4);
  assert.throws(()=>new PacketReader(()=>{}).push(b),/Invalid native packet/);
 }
});
test('VFR target resolves actual source PTS, not nominal frame numbers',()=>{
 const index={timeBase:'1/16000',sorted:[{pts:0,n:0},{pts:17000,n:2},{pts:33000,n:1}],packets:[{sourcePts:0},{sourcePts:528},{sourcePts:272}]};
 assert.deepEqual(targetAt(index,.032),{pts:17000,ticks:4318272000});
});
test('stale / wrong PTS cannot draw; exact current PTS draws once',()=>{
 const c=Object.create(FilmcraftClient.prototype),draws=[],results=[];
 Object.assign(c,{dead:false,stats:{stale:0,wrong:0,frames:0,hwFrames:0,hwFallbacks:0},draw:(p,h)=>draws.push(h.id),current:{id:2,target:{ticks:100,pts:1}},finish:(status)=>results.push(status)});
 const frame={event:'frame',id:1,ptsTicks:100,width:1,height:1,hwFrames:1,hwFallbacks:0};
 c.receive(frame,Buffer.alloc(4));assert.equal(c.stats.stale,1);assert.equal(draws.length,0);
 c.receive({...frame,id:2,ptsTicks:99},Buffer.alloc(4));assert.equal(c.stats.wrong,1);assert.equal(draws.length,0);
 c.receive({...frame,id:2},Buffer.alloc(4));assert.deepEqual(draws,[2]);assert.deepEqual(results,['wrong-frame','exact']);
});
test('malformed image shape cannot draw',()=>{
 const c=Object.create(FilmcraftClient.prototype);Object.assign(c,{stats:{},current:{id:1,target:{ticks:0}},draw:()=>assert.fail('must not draw')});
 assert.throws(()=>c.receive({event:'frame',id:1,ptsTicks:0,width:2,height:2},Buffer.alloc(4)),/shape/);
});
