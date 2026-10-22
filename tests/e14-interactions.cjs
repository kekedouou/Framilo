'use strict';
// Real UI/selection controllers under deterministic DOM/Session stand-ins.
const assert=require('assert'),{harness,flush}=require('./timeline-ui.cjs'),uiAPI=require('../plugin/ui.js');
async function main(){let count=0;
 const test=async(name,fn)=>{await fn();console.log('ok E14 UI: '+name);count++;};
 await test('1080p, portrait, small sources and SAR expose distinct effective preview choices only',async()=>{
  const choices=(w,h,sar='1:1',rotation=0)=>uiAPI.previewChoices({sourceWidth:w,sourceHeight:h,sampleAspectRatio:sar,rotation}).map(n=>n.value);
  assert.deepEqual(choices(1920,1080),['720p','1080p']);assert.deepEqual(choices(1080,1920),['720p','1080p']);
  assert.deepEqual(choices(640,360),['720p']);assert.deepEqual(choices(3840,2160),['720p','1080p','1440p']);
  assert.deepEqual(choices(1440,2560),['720p','1080p','1440p']);assert.deepEqual(choices(1920,1080,'1:1',90),['720p','1080p']);
  assert.deepEqual(choices(720,576,'16:15'),['720p']);
 });
 await test('Screen seeking remains available while an earlier locate is pending',async()=>{
  const h=harness();h.state.state='seeking';h.update();const before=h.calls.length;
  h.el('screen').fire('pointerdown',{clientX:200,clientY:200});h.win.fire('pointermove',{clientX:300,clientY:200});
  h.win.fire('pointerup',{clientX:350,clientY:200,buttons:0});await flush();
  assert(h.calls.slice(before).some(n=>n[0]==='seek'&&n[2].final));h.ui.destroy();
 });
 await test('R hold allows source-frame endpoint adjustment directly on the picture and settles on key release',async()=>{
  const h=harness(true);h.key('R');h.hold();await flush();const before=h.calls.length;
  h.el('screen').fire('pointerdown',{clientX:200,clientY:200});h.win.fire('pointermove',{clientX:300,clientY:200});
  h.win.fire('pointerup',{clientX:320,clientY:200,buttons:0});await flush();
  assert(h.calls.slice(before).some(n=>n[0]==='seek'&&n[2].kind==='loop-select'));
  h.win.fire('keyup',{key:'r',code:'KeyR'});await flush();assert(h.calls.some(n=>n[0]==='apply'));h.ui.destroy();
 });
 console.log('E14 UI: '+count+' checks; no actual Eagle or user-data writes.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
