'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {createAudit}=require('../plugin/startup-audit.js'),{createWindowDrag}=require('../plugin/window-drag.cjs');
const {harness}=require('./timeline-ui.cjs');
test('suppressed browser animation frames cannot indefinitely block entry; late frames stay cancelled',async()=>{
 const h=harness(),frames=new Map();let next=0;h.win.requestAnimationFrame=f=>{frames.set(++next,f);return next;};h.win.cancelAnimationFrame=id=>frames.delete(id);
 const began=Date.now(),wait=h.ui.prepareEntry(),entryFrame=next;await wait;assert(Date.now()-began<1000);assert.equal(h.el('notice').hidden,false);assert.equal(frames.has(entryFrame),false);h.ui.destroy();
});
test('audit is opt-in, finite, excludes object payloads, preserves early navigation time and stops',()=>{
 let at=4000;const a=createAudit({performance:{now:()=>at,timeOrigin:1}});a.mark('early',{pixels:new Uint8Array(30),x:Infinity});assert.equal(a.snapshot()[0].navigationMs,4000);assert.equal(a.snapshot()[0].pixels,undefined);assert.equal(a.snapshot()[0].x,'Infinity');
 for(let i=0;i<1000;i++){at++;a.mark('bounded');}assert.equal(a.snapshot().length,160);a.stop();a.mark('late');assert.deepEqual(a.snapshot(),[]);
});
test('opt-in file logger enforces expiry and 10-window capacity, never creates directories or logs by default',()=>{
 const base=path.resolve(__dirname,'../verification-runs/e60');fs.mkdirSync(base,{recursive:true});const project=fs.mkdtempSync(path.join(base,'audit-fixture-')),plugin=path.join(project,'plugin'),out=path.join(project,'verification-runs/e60');
 try{
  fs.mkdirSync(plugin);fs.mkdirSync(path.join(project,'.git'));fs.mkdirSync(out,{recursive:true});
  for(const n of ['app.js','ui.js','window-drag.cjs','native-player.js','index.html','startup-audit.js'])fs.writeFileSync(path.join(plugin,n),'fixture');
  const create=()=>createAudit({performance:{now:()=>12,timeOrigin:1}});let a=create();a.mark('first-script');a.connect(plugin);assert.deepEqual(fs.readdirSync(out),[]);a.stop();
  const config=path.join(plugin,'startup-audit.local.json');fs.writeFileSync(config,JSON.stringify({stage:'E60',expiresAt:Date.now()-1}));a=create();a.connect(plugin);assert.deepEqual(fs.readdirSync(out),[]);a.stop();
  fs.writeFileSync(config,JSON.stringify({stage:'E60',expiresAt:Date.now()+10000}));a=create();a.mark('first-script');a.connect(plugin);a.mark('drag-error',{message:'setPosition(-100, 20)'});a.stop();let files=fs.readdirSync(out);assert.equal(files.length,1);const rows=fs.readFileSync(path.join(out,files[0]),'utf8').trim().split('\n').map(JSON.parse);assert.deepEqual(rows.map(r=>r.stage),['first-script','audit-connected','drag-error']);assert.equal(rows[2].message,'setPosition(-100, 20)');
  for(let i=1;i<10;i++)fs.writeFileSync(path.join(out,'startup-host-fixture-'+i+'.jsonl'),'');a=create();a.connect(plugin);a.mark('must-not-write');a.stop();assert.equal(fs.readdirSync(out).length,10);
 }finally{assert(fs.realpathSync(project).startsWith(fs.realpathSync(base)+path.sep));fs.rmSync(project,{recursive:true});}
});
test('drag rejects non-int32 derived positions before SDK and attributes a native rejection to its actual method',async()=>{
 const errors=[],events=[];let calls=0;const host={getSize:async()=>[1000,700],isMaximized:async()=>false,setPosition:async()=>{calls++;throw Error('conversion failure at index 0');}};
 const d=createWindowDrag({host,report:e=>errors.push(e.message),trace:(stage,v)=>events.push({stage,...v})});
 await d.start({fullscreen:false,x:1e20,y:5,ratio:.5});assert.equal(calls,0);assert.match(errors[0],/setPosition/);
 await d.start({fullscreen:false,x:-100,y:50,ratio:.5});assert.equal(calls,1);assert.match(errors[1],/setPosition\(-600, 50\).*conversion/);assert(events.some(e=>e.stage==='drag-error'));d.cancel();
});
