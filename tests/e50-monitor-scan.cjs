'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module');
const {usage}=require('../plugin/proxy-storage.cjs');
async function fixture(t){const base=path.resolve('verification-runs/e50/unit');await fs.promises.mkdir(base,{recursive:true});const root=await fs.promises.mkdtemp(path.join(base,'monitor-'));t.after(async()=>{assert.equal(path.dirname(root),base);assert.equal(await fs.promises.realpath(root),root);await fs.promises.rm(root,{recursive:true});});return root;}
function meter(options){const file=path.resolve('docs/history/retired-monitor-e55/plugin/live-resources.cjs'),module={exports:{}};const local=createRequire(file);vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,process,AbortController,require:name=>name==='child_process'?{execFile(_exe,_args,_opts,cb){setImmediate(()=>cb(null,JSON.stringify([{WorkingSet64:1024}])));return{kill(){}};}}:local(name)});return module.exports.createResources(options);}
test('scan yields to the event loop, uses no synchronous file metadata, and keeps exact byte counts',async t=>{
 const root=await fixture(t);for(let n=0;n<150;n++)await fs.promises.writeFile(path.join(root,n+'.json'),'1234567890');
 let ticks=0;const original=fs.lstatSync,real=fs.realpathSync;fs.lstatSync=fs.realpathSync=()=>{throw Error('synchronous filesystem in monitor');};
 const timer=setInterval(()=>ticks++,1);try{assert.equal(await usage(root),1500);assert(ticks>0);}finally{clearInterval(timer);fs.lstatSync=original;fs.realpathSync=real;}
});
test('cancelled scan rejects without publishing a partial count; missing roots remain zero',async t=>{
 const root=await fixture(t),c=new AbortController();for(let n=0;n<60;n++)await fs.promises.writeFile(path.join(root,n+'.json'),'123');
 const pending=usage(root,{signal:c.signal});setImmediate(()=>c.abort());await assert.rejects(pending,{name:'AbortError'});assert.equal(await usage(path.join(root,'absent')),0);
});
test('monitor disk totals distinguish JPEG, proxy partials and other metadata without creating cache roots',async t=>{
 const root=await fixture(t),source='a'.repeat(64),dir=path.join(root,'cache'),jpeg=path.join(dir,'media-'+source+'-sample'),pending=path.join(dir,'e44-whole/whole-v1/.pending-unit');
 await fs.promises.mkdir(jpeg,{recursive:true});await fs.promises.mkdir(pending,{recursive:true});await fs.promises.writeFile(path.join(jpeg,'frame.jpg'),'jpeg');await fs.promises.writeFile(path.join(dir,'receipt.json'),'receipt');
 await fs.promises.writeFile(path.join(pending,'owner.json'),JSON.stringify({schema:'e44-whole-proxy-v1',sourceHash:source}));await fs.promises.writeFile(path.join(pending,'video.mp4'),'partial');
 const m=meter({root,context:()=>({source:{sha256:source},managedBytes:12})});try{await m.sample();const v=m.view();assert.equal(v.diskTotal,await usage(dir));assert.equal(v.diskParts.jpeg,4);assert.equal(v.diskParts.other,7);assert.equal(v.diskParts.proxy,v.diskParts.pending);assert.equal(v.diskVideo,v.diskTotal-7);}finally{m.close();}
 const absent=path.join(root,'empty');const empty=meter({root:absent,context:()=>({})});await empty.sample();assert.equal(empty.view().diskTotal,0);assert(!fs.existsSync(absent));empty.close();
});
test('closing or changing source during disk sampling cannot publish the previous source count',async t=>{
 const root=await fixture(t);let source='a',entered,unblock;const gate=new Promise(r=>unblock=r),started=new Promise(r=>entered=r);let signal;
 const m=meter({root,context:()=>({source:{sha256:source},diskUsage:async opts=>{signal=opts.signal;entered();await gate;return{currentBytes:100,totalBytes:100};}})});
 const work=m.sample();await started;source='b';m.pause();assert(signal.aborted);unblock();await work;assert.equal(m.view().diskVideo,null);assert.equal(m.view().diskTotal,null);m.close();
});
test('monitor disables in-flight work, reopens fresh and refreshes elapsed waiting without rebuilding metrics',()=>{
 const {createMonitor}=require('../docs/history/retired-monitor-e55/plugin/performance-runtime.cjs');let time=0,pauses=0,resumes=0;const m=createMonitor({root:'.',context:()=>({source:{sha256:'a'},state:'seeking'}),now:()=>time,resources:{sample:async()=>{},pause(){pauses++;},resume(){resumes++;},close(){},view:()=>({})}});
 try{m.enable();m.observe({type:'request',phase:'input',at:0,requestId:1});const a=m.view();time=900;const b=m.view();assert.equal(a.data,b.data);assert.equal(a.metrics,b.metrics);assert.equal(b.explanation.delay,900);m.disable();assert.equal(pauses,1);m.enable();assert.equal(resumes,2);assert.equal(m.view().data.requests.length,0);}finally{m.destroy();}
});
