'use strict';
const assert=require('assert'),{LIMITS}=require('../prototypes/preview-quality/workspace.cjs'),{create}=require('../prototypes/preview-quality/check-recorder.cjs');
assert.strictEqual(LIMITS.files,128);assert.strictEqual(LIMITS.slots+2,LIMITS.files);
assert(LIMITS.slots*LIMITS.slot+2*4096<=16*1024**2);assert(LIMITS.slot<=256*1024);
let opens=0,closes=0,values=[];
function open(){opens++;let bytes=0;return {capacityBytes:100,get bytes(){return bytes;},append(v){values.push(v);bytes+=Buffer.byteLength(JSON.stringify(v))+1;},flush(){},receipt(){return {file:'same-'+opens,bytes};},close(){closes++;}};}
const recorder=create({open});recorder.save({first:1});recorder.save({second:2});assert.strictEqual(opens,1);assert.strictEqual(values.length,2);
recorder.save({long:'x'.repeat(70)});assert.strictEqual(opens,2);assert.strictEqual(closes,1);recorder.close();
let deny=true,appended=0;const recover=create({open(){if(deny){const e=Error('full');e.code='EVIDENCE_CAPACITY';throw e;}return {bytes:0,capacityBytes:100,append(){appended++;},flush(){},receipt(){return {file:'recovered'};},close(){}};}});
assert.throws(()=>recover.save({original:true}),/full/);assert(recover.pending);assert(!recover.uncertain);deny=false;assert.strictEqual(recover.retry().file,'recovered');assert.strictEqual(appended,1);assert(!recover.pending);
let attempts=0;const uncertain=create({open:()=>({bytes:0,capacityBytes:100,append(){attempts++;throw Error('partial IO');},flush(){},receipt(){},close(){}})});
assert.throws(()=>uncertain.save({once:1}),/partial/);assert(uncertain.uncertain);assert.throws(()=>uncertain.retry(),/未重复/);assert.strictEqual(attempts,1);
assert.throws(()=>recorder.save({tooLarge:'x'.repeat(32769)}),/限额/);
console.log('evolution records: unchanged total/file bounds, batched checks, pre-full rotation, capacity retry without redraw, uncertain writes not duplicated passed; no files/Eagle');
