'use strict';
// Pure cache model plus one builtin Node thread with synthetic bytes. No media,
// native task host, library access or physical cache writes.
const assert=require('assert'),path=require('path'),{EventEmitter}=require('events'),{Worker}=require('worker_threads');
const {createReadHost}=require('../plugin/cache-read-worker.cjs'),{createReadClient,createLocalReadWorker}=require('../plugin/cache-read-client.cjs');
const {harness,prepared}=require('./t1-cache.cjs');
const owner={schema:'eva-task-owner-v1',key:'c'.repeat(64),epoch:'d'.repeat(32),guardPid:123};
const flush=async()=>{for(let n=0;n<60;n++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function client(cache,settings={}){
  const sent=[],transfers=[],failures=[];let worker;
  const api=createReadClient({pluginRoot:'D:\\fixtures\\plugin',onFailure:error=>failures.push(error),createWorker(){
    worker=new EventEmitter();const host=createReadHost({cache,send(value,transfer){transfers.push(transfer);queueMicrotask(()=>worker.emit('message',value));}});
    worker.postMessage=value=>{sent.push(value);host.receive(require('v8').deserialize(require('v8').serialize(value)));};
    worker.terminate=async()=>{worker.emit('exit',1);return 1;};
    queueMicrotask(()=>worker.emit('message',{type:'ready'}));if(settings.created)settings.created(worker);return worker;
  }});return {api,sent,transfers,failures,get worker(){return worker;}};
}
async function main(){let count=0;const test=async(name,fn)=>{await fn();count++;console.log('ok cache read thread: '+name);};
  const unsupported=()=>{throw Error('The V8 platform used by this instance of Node does not support creating Workers');};
  await test('Eagle Worker rejection falls back without fatal failure and keeps actual cache validation',async()=>{
    const h=harness({taskOwner:owner}),info=await prepared(h),cache=h.api.createCache({pluginRoot:'D:\\fixtures\\plugin'}),failures=[];
    const c=createReadClient({pluginRoot:'unused',createWorker:unsupported,createFallback:()=>createLocalReadWorker({cache}),onFailure:e=>failures.push(e)});
    await assert.rejects(c.adopt({...info},{...owner,epoch:'e'.repeat(32)}),/当前任务负责人/);
    const copy=JSON.parse(JSON.stringify(info));await c.adopt(copy,owner);assert.equal(c.mode,'host-queue');
    assert.equal((await c.readAsset(copy,copy.frames[0].file)).toString(),'frame-data');
    h.nodes.get(path.win32.join(info.cacheDir,info.frames[0].file)).data=Buffer.from('other-data');
    await assert.rejects(c.readAsset(copy,copy.frames[0].file),/改变/);
    await assert.rejects(c.close(),/未交还/);await c.detach(copy);h.cache.release(info);await c.close();
    assert.equal(failures.length,0);assert.equal(h.descriptors.size,0);await assert.rejects(c.inventory(),/关闭/);
  });
  await test('compatibility queue yields and keeps two read slots, copied identity and detach barrier',async()=>{
    const gates=[],seen=[];let active=0,peak=0,detached=false;
    const c=createReadClient({pluginRoot:'unused',createWorker:unsupported,createFallback:()=>createLocalReadWorker({cache:{
      adoptReadLease(){},readAsset:async info=>{seen.push(info.leaseId);active++;peak=Math.max(peak,active);const g=deferred();gates.push(g);await g.promise;active--;return Buffer.from('local');},
      detachReadLease(){assert.equal(active,0);detached=true;return true;}}})});
    const info={leaseId:'a'};let adopted=false;const adopting=c.adopt(info,owner).then(()=>adopted=true);await flush();assert(!adopted,'fallback must yield rather than run synchronous validation from a microtask');await adopting;
    info.leaseId='retargeted';const reads=[0,1,2].map(i=>c.readAsset(info,String(i)));for(let i=0;i<5;i++)await new Promise(setImmediate);
    assert.equal(gates.length,2);assert.equal(peak,2);const detach=c.detach(info);await flush();assert(!detached);await assert.rejects(c.readAsset(info,'late'),/失效/);
    gates[0].resolve();for(let i=0;i<5;i++)await new Promise(setImmediate);assert.equal(gates.length,3);gates[1].resolve();gates[2].resolve();
    assert.deepEqual((await Promise.all(reads)).map(b=>b.toString()),['local','local','local']);await detach;assert.deepEqual(seen,['a','a','a']);await c.close();
  });
  await test('unrelated Worker startup failures are not hidden by compatibility fallback',async()=>{
    let fallback=0;const failures=[],c=createReadClient({pluginRoot:'unused',createWorker(){throw Error('module corrupt');},createFallback(){fallback++;},onFailure:e=>failures.push(e)});
    await assert.rejects(c.adopt({leaseId:'a'},owner),/module corrupt/);assert.equal(fallback,0);assert.equal(failures.length,1);await assert.rejects(c.close(),/module corrupt/);
  });
  await test('actual cache adoption keeps guard binding, full manifest and asset hash checks',async()=>{
    const h=harness({taskOwner:owner}),info=await prepared(h),reader=h.api.createCache({pluginRoot:'D:\\fixtures\\plugin'}),c=client(reader);
    const copy=JSON.parse(JSON.stringify(info));await assert.rejects(c.api.adopt({...copy}, {...owner,epoch:'e'.repeat(32)}),/当前任务负责人/);
    const altered=JSON.parse(JSON.stringify(info));altered.frames[0].time=.01;await assert.rejects(c.api.adopt(altered,owner),/清单/);
    await c.api.adopt(copy,owner);assert.equal((await c.api.readAsset(copy,copy.frames[0].file)).toString(),'frame-data');
    h.nodes.get(path.win32.join(info.cacheDir,info.frames[0].file)).data=Buffer.from('other-data');
    await assert.rejects(c.api.readAsset(copy,copy.frames[0].file),/改变/);
    await c.api.detach(copy);assert(h.nodes.has(path.win32.join(h.root,'lease-'+info.leaseId+'.json')));h.cache.release(info);await c.api.close();assert.equal(h.descriptors.size,0);
  });
  await test('two read slots and detach barrier wait for every outstanding read',async()=>{
    const gates=[],events=[];let active=0,peak=0;
    const c=client({adoptReadLease(){},readAsset:async()=>{active++;peak=Math.max(peak,active);const g=deferred();gates.push(g);await g.promise;active--;return Buffer.alloc(8,4);},detachReadLease(){assert.equal(active,0);events.push('detach');return true;}}),info={leaseId:'x'};
    await c.api.adopt(info,owner);const reads=[0,1,2].map(n=>c.api.readAsset(info,String(n)));await flush();assert.equal(gates.length,2);assert.equal(peak,2);
    let ended=false;const detach=c.api.detach(info).then(()=>ended=true);await flush();assert(!ended);await assert.rejects(c.api.readAsset(info,'late'),/失效/);
    gates[0].resolve();await flush();assert.equal(gates.length,3);gates[1].resolve();gates[2].resolve();await Promise.all(reads);await detach;assert.deepEqual(events,['detach']);await c.api.close();
  });
  await test('caller object identity cannot be cloned or retargeted to another registered lease',async()=>{
    const seen=[],c=client({adoptReadLease(){},readAsset:async info=>{seen.push(info.leaseId);return Buffer.from('a');},detachReadLease(){return true;}}),a={leaseId:'a'},b={leaseId:'b'};
    await c.api.adopt(a,owner);await c.api.adopt(b,owner);await assert.rejects(c.api.readAsset({...a},'0'),/失效/);a.leaseId='b';await c.api.readAsset(a,'0');assert.deepEqual(seen,['a']);
    assert.equal(c.sent.find(value=>value.method==='read').leaseId,'a');await c.api.detach(a);await c.api.detach(b);await c.api.close();
  });
  await test('pooled slabs are narrowed and batch outputs have independent transferable storage',async()=>{
    const c=client({adoptReadLease(){},readAsset:async()=>Buffer.from('tiny'),readFrameBatch:async()=>[Buffer.from('aa'),Buffer.from('bbb')],detachReadLease(){return true;}}),info={leaseId:'a'};
    await c.api.adopt(info,owner);assert.equal((await c.api.readAsset(info,'0')).toString(),'tiny');const result=await c.api.readFrameBatch(info,['0','1']);assert.deepEqual(result.map(b=>b.toString()),['aa','bbb']);
    const singles=c.transfers.find(values=>values.length===1);assert.equal(singles[0].byteLength,4);const batch=c.transfers.find(values=>values.length===2);assert.notStrictEqual(batch[0],batch[1]);assert.deepEqual(batch.map(b=>b.byteLength),[2,3]);await c.api.detach(info);await c.api.close();
  });
  await test('bounded request overflow rejects without killing the reader or dropping active reads',async()=>{
    const gate=deferred(),c=client({adoptReadLease(){},readAsset:async()=>{await gate.promise;return Buffer.alloc(1);},detachReadLease(){return true;}}),info={leaseId:'a'};
    await c.api.adopt(info,owner);const tasks=Array.from({length:70},()=>c.api.readAsset(info,'0').then(()=>true,error=>{assert.equal(error.code,'CACHE_READER_BUSY');return false;}));await flush();assert(c.sent.filter(v=>v.method==='read').length<=64);gate.resolve();const result=await Promise.all(tasks);assert.equal(result.filter(Boolean).length,64);assert.equal(c.failures.length,0);await c.api.detach(info);await c.api.close();
  });
  await test('failed detach and refused close preserve ownership and allow an explicit retry',async()=>{
    let fail=true;const c=client({adoptReadLease(){},detachReadLease(){if(fail)throw Error('not detached');return true;}}),info={leaseId:'a'};await c.api.adopt(info,owner);
    await assert.rejects(c.api.detach(info),/not detached/);await assert.rejects(c.api.close(),/未交还/);fail=false;await c.api.detach(info);await c.api.close();assert.equal(c.failures.length,0);
  });
  await test('builtin worker isolates synchronous validation stalls and transfers exact bytes',async()=>{
    const modulePath=path.resolve(__dirname,'../plugin/cache-read-worker.cjs');let ticks=0;
    const c=createReadClient({pluginRoot:path.dirname(modulePath),createWorker:()=>new Worker(`const {parentPort}=require('worker_threads');const {createReadHost}=require(${JSON.stringify(modulePath)});const host=createReadHost({cache:{adoptReadLease(){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);},readAsset:async()=>Buffer.from('actual-thread'),detachReadLease:()=>true},send:(value,transfer)=>parentPort.postMessage(value,transfer)});parentPort.on('message',value=>host.receive(value));parentPort.postMessage({type:'ready'});`,{eval:true})});
    const timer=setInterval(()=>ticks++,5),info={leaseId:'synthetic'};try{await c.adopt(info,owner);assert(ticks>=3,'main event loop must continue during validation');const bytes=await c.readAsset(info,'0');assert.equal(bytes.toString(),'actual-thread');assert.equal(bytes.buffer.byteLength,13);await c.detach(info);await c.close();}finally{clearInterval(timer);}
  });
  await test('thread failure rejects inflight work and cannot claim clean closure',async()=>{
    const c=client({adoptReadLease(){},readAsset:()=>new Promise(()=>{}),detachReadLease(){return true;}}),info={leaseId:'a'};await c.api.adopt(info,owner);const pending=c.api.readAsset(info,'0');await flush();c.worker.emit('error',Error('thread died'));await assert.rejects(pending,/thread died/);await assert.rejects(c.api.close(),/thread died/);assert.equal(c.failures.length,1);
  });
  console.log('Cache read thread: '+count+' cache/transport/bounds/closure models; no media or native host.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
