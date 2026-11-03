'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),{PacketReader}=require('../plugin/native-wire.cjs');
function packet(h,p=Buffer.alloc(0)){const header=Buffer.from(JSON.stringify(h)),prefix=Buffer.alloc(8);prefix.writeUInt32LE(header.length,0);prefix.writeUInt32LE(p.length,4);return Buffer.concat([prefix,header,p]);}
test('E57 shipped framing retains byte-split, empty, concatenated and arbitrary pixel packets',()=>{
 const payload=Buffer.alloc(65537,123),wire=Buffer.concat([packet({event:'ready'}),packet({event:'frame',id:1},payload),packet({event:'closed'})]);
 for(const step of [1,7,64,4096,wire.length]){const out=[],p=new PacketReader((h,b)=>out.push({h,b}));for(let at=0;at<wire.length;at+=step)p.push(wire.subarray(at,at+step));assert.equal(out.length,3);assert.deepEqual(out[1].b,payload);assert.equal(out[2].h.event,'closed');assert.equal(p.stage,'prefix');}
});
test('E57 obsolete frame payloads are drained without allocating pixels and the following packet stays exact',()=>{
 let current=2;const out=[],p=new PacketReader((h,b)=>out.push({h,b}),h=>h.event!=='frame'||h.id===current),old=packet({event:'frame',id:1},Buffer.alloc(1024,1));
 p.push(old.subarray(0,100));assert.equal(p.pixels,null);assert.equal(p.skipped,true);p.push(Buffer.concat([old.subarray(100),packet({event:'frame',id:2},Buffer.from([7,8]))]));assert.equal(out[0].b.length,0);assert.deepEqual([...out[1].b],[7,8]);
 current=3;p.push(packet({event:'closed'}));assert.equal(out[2].h.event,'closed');
});
test('E57 cancellation during a current payload releases its buffer and never shifts the next header',()=>{
 let current=1;const out=[],p=new PacketReader((h,b)=>out.push({h,b}),h=>h.event!=='frame'||h.id===current),old=packet({event:'frame',id:1},Buffer.alloc(1024,1));
 p.push(old.subarray(0,100));assert.equal(p.pixels.length,1024);current=2;p.push(old.subarray(100,200));assert.equal(p.pixels,null);p.push(Buffer.concat([old.subarray(200),packet({event:'frame',id:2},Buffer.from([9]))]));assert.equal(out[0].b.length,0);assert.equal(out[1].b[0],9);
});
test('E57 invalid packet limits remain rejected before image allocation',()=>{
 for(const [h,pixels] of [[1,0],[8193,0],[2,64*1024**2+1]]){const prefix=Buffer.alloc(8);prefix.writeUInt32LE(h);prefix.writeUInt32LE(pixels,4);assert.throws(()=>new PacketReader(()=>{}).push(prefix),/Invalid native packet/);}
 assert.throws(()=>new PacketReader(()=>{}).push(Buffer.concat([Buffer.from([2,0,0,0,0,0,0,0]),Buffer.from('xx')])),/JSON|Unexpected/);
});
