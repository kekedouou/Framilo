'use strict';
const assert=require('assert'),{createProxyBackground}=require('../plugin/proxy-background.cjs');
const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function harness(options={}){
  const total=options.total||10,info={frames:Array.from({length:total*2},(_,n)=>({time:n})),segments:Array.from({length:total},(_,n)=>({start:n*2,end:n*2+2}))};
  const timers=new Map(),calls=[],released=[],events=[];let id=0,idle=true,closes=0;
  const bg=createProxyBackground({info,prepare:async(n,signal)=>{calls.push(['segment',n]);return options.prepare?options.prepare(n,signal):{leaseId:'s'+n};},
    prepareRecord:async(n,signal)=>{calls.push(['record',n]);return options.prepareRecord?options.prepareRecord(n,signal):{leaseId:'r'+n};},
    release:async value=>{released.push(value.leaseId);if(options.release)await options.release(value);},
    enqueue:fn=>Promise.resolve().then(fn),idle:()=>idle,budget:()=>({usedBytes:options.full?500*1024**2:0,diskLimitBytes:options.full?512*1024**2:5*1024**3}),
    closeBatch:async()=>{closes++;},emit:value=>events.push(value),schedule:fn=>{timers.set(++id,fn);return id;},cancel:n=>timers.delete(n)});
  return {bg,info,calls,released,events,setIdle:value=>idle=value,get closes(){return closes;},async tick(){const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());await flush();}};
}
async function main(){let count=0;const test=async(name,fn)=>{await fn();count++;console.log('ok proxy priority: '+name);};
  await test('latest position and direction precede distant records and sequential remainder',async()=>{
    const h=harness();h.bg.prioritizeRecords({all:[18],visible:[16]});h.bg.target(10);h.bg.target(12);
    for(let n=0;n<8;n++)await h.tick();assert.deepEqual(h.calls.slice(0,7),[['segment',6],['segment',7],['segment',5],['segment',8],['segment',4],['record',16],['record',18]]);await h.bg.close();
  });
  await test('same segment intentions and same foreground demand do not abort ongoing work',async()=>{
    const gate=deferred();let signal;const h=harness({prepare:(n,s)=>{signal=s;return gate.promise;}});h.bg.target(12);await h.tick();assert.deepEqual(h.calls,[['segment',6]]);
    for(let n=0;n<240;n++)h.bg.target(12+n/1000);h.bg.foreground(6);assert(!signal.aborted);const closing=h.bg.close();assert(signal.aborted);gate.resolve({leaseId:'late'});await closing;assert.deepEqual(h.released,['late']);
  });
  await test('distant cold target cancels old background then replaces it without queueing every move',async()=>{
    let first=true,aborts=0;const h=harness({prepare:(n,signal)=>{if(!first)return {leaseId:'s'+n};first=false;return new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(Object.assign(Error('cancelled'),{code:'MEDIA_CANCELLED'}));},{once:true}));}});
    h.bg.kick();await h.tick();for(let n=1;n<=9;n++)h.bg.target(n*2);await flush();assert.equal(aborts,1);await h.tick();assert.deepEqual(h.calls.slice(0,2),[['segment',0],['segment',9]]);await h.bg.close();
  });
  await test('visible static frames precede other annotations and no completed record is regenerated',async()=>{
    const h=harness();h.bg.prioritizeRecords({all:[18,14,10],visible:[14]});for(let n=0;n<4;n++)await h.tick();assert.deepEqual(h.calls.slice(0,3),[['record',14],['record',18],['record',10]]);
    h.bg.prioritizeRecords({all:[10,14,18],visible:[18]});for(let n=0;n<10;n++)await h.tick();assert.equal(h.calls.filter(v=>v[0]==='record').length,3);await h.bg.close();
  });
  await test('static lease pool stays bounded and cannot evict an actively borrowed record',async()=>{
    const h=harness({total:40});await h.bg.retainRecord(0,{leaseId:'r0'});const borrowed=h.bg.borrowRecord(0);for(let n=1;n<40;n++)await h.bg.retainRecord(n,{leaseId:'r'+n});
    assert.strictEqual(h.bg.getRecord(0),borrowed);assert.equal(h.released.length,8);assert(!h.released.includes('r0'));await assert.rejects(h.bg.close(),/仍在读取/);h.bg.returnRecord(borrowed);await h.bg.close();assert.equal(new Set(h.released).size,40);
  });
  await test('records added after full proxy completion are still prepared and closed',async()=>{
    const h=harness({total:2});h.bg.kick();for(let n=0;n<3;n++)await h.tick();assert.equal(h.bg.snapshot().stage,'complete');h.bg.prioritizeRecords({all:[3],visible:[3]});await h.tick();assert.deepEqual(h.calls,[['segment',0],['segment',1],['record',3]]);assert.equal(h.bg.snapshot().stage,'complete');await h.bg.close();
  });
  await test('budget floor covers records and refuses preparation before any new output',async()=>{
    const h=harness({full:true});h.bg.prioritizeRecords({all:[1],visible:[1]});await h.tick();assert.equal(h.bg.snapshot().stage,'budget');assert.equal(h.calls.length,0);await h.bg.close();
  });
  await test('record cleanup failures preserve their lease and remain retryable',async()=>{
    let fail=true;const h=harness({release:async value=>{if(value.leaseId==='r1'&&fail)throw Error('cannot release static');}});await h.bg.retainRecord(1,{leaseId:'r1'});await assert.rejects(h.bg.close(),/cannot release static/);assert.equal(h.bg.getRecord(1),undefined);assert.equal(h.bg.borrowRecord(1),null);fail=false;await h.bg.close();assert.equal(h.released.filter(value=>value==='r1').length,2);
  });
  await test('retiring a static lease withdraws its fast borrow before asynchronous release finishes',async()=>{
    const gate=deferred(),h=harness({total:40,release:async value=>{if(value.leaseId==='r0')await gate.promise;}});for(let n=0;n<32;n++)await h.bg.retainRecord(n,{leaseId:'r'+n});
    const retiring=h.bg.retainRecord(32,{leaseId:'r32'});await flush();assert.equal(h.bg.getRecord(0),undefined);assert.equal(h.bg.borrowRecord(0),null);const active=h.bg.borrowRecord(1);assert(active);gate.resolve();await retiring;assert(h.bg.getRecord(32));h.bg.returnRecord(active);await h.bg.close();assert.equal(h.released.filter(value=>value==='r0').length,1);assert.equal(new Set(h.released).size,33);
  });
  await test('failed retirement cannot be borrowed and both old and incoming capabilities survive for cleanup',async()=>{
    const gate=deferred();let fail=true;const h=harness({total:40,release:async value=>{if(value.leaseId==='r0'&&fail){await gate.promise;throw Error('retire failed');}}});for(let n=0;n<32;n++)await h.bg.retainRecord(n,{leaseId:'r'+n});
    const retiring=h.bg.retainRecord(32,{leaseId:'r32'});await flush();assert.equal(h.bg.borrowRecord(0),null);gate.resolve();await assert.rejects(retiring,/retire failed/);assert.equal(h.bg.getRecord(0),undefined);assert.equal(h.bg.borrowRecord(0),null);assert.equal(h.bg.getRecord(32),undefined);fail=false;await h.bg.close();assert(h.released.includes('r32'));assert.equal(h.released.filter(value=>value==='r0').length,2);
  });
  await test('invalid or out-of-source annotation ordinals do not create background work',async()=>{
    const h=harness();for(const value of [{all:[-1],visible:[]},{all:[20],visible:[]},{all:[.5],visible:[]},{all:[],visible:[NaN]}])assert.throws(()=>h.bg.prioritizeRecords(value),/无效/);assert.equal(h.calls.length,0);await h.bg.close();
  });
  console.log('Proxy priority: '+count+' latest-target, static-frame and bounded ownership models; no media.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
