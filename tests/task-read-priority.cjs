'use strict';
// Execute the actual client and worker protocols. Only OS process endpoints and
// the read thread's already separately tested cache boundary are models here.
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto'),vm=require('vm'),{EventEmitter}=require('events');
const root=path.resolve(__dirname,'../plugin'),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const flush=async()=>{for(let n=0;n<100;n++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const owner={schema:'eva-task-owner-v1',key:sha(root.toLowerCase()),epoch:'d'.repeat(32),guardPid:123};
function manifest(count=4){return {leaseId:'a'.repeat(24),streaming:'segments-v1',source:{sha256:'b'.repeat(64)},videoEncoding:{format:'annexb-idr-v1',codec:'avc1.42001f'},width:16,height:8,duration:count,
  frames:Array.from({length:count},(_,n)=>({file:`frame-${n}.avc`,time:n,ptsTicks:String(n)})),segments:Array.from({length:Math.ceil(count/2)},(_,n)=>({start:n*2,end:n*2+2,first:n*2,last:Math.min(count-1,n*2+1)}))};}
function client(options={}){
  const messages=[],events=[],info=manifest(options.count),segments=new Map(),module={exports:{}},host=new EventEmitter();host.pid=123;
  const port=()=>{const emitter=new EventEmitter();emitter.setEncoding=()=>{};return emitter;};host.stdout=port();host.stderr=port();
  const emit=value=>host.stdout.emit('data',JSON.stringify(value)+'\n');let failReturn=!!options.failReturn;
  const read={async adopt(value,taskOwner){events.push(['adopt',value.leaseId,taskOwner]);if(options.adopt)await options.adopt(value);},async readAsset(value,file){events.push(['read',value.leaseId,file]);if(options.read)await options.read(value);return Buffer.from('jpeg-or-avc');},async detach(value){events.push(['detach',value.leaseId]);return true;},async readFrameBatch(){return [];},async inventory(){return {readOnly:true};},async close(){events.push(['thread-close']);}};
  host.stdin=new EventEmitter();host.stdin.writable=true;host.stdin.end=()=>{};host.stdin.write=text=>{
    assert(Buffer.byteLength(text)<=32768);const value=JSON.parse(text);messages.push(value);if(value.type==='guard'||['target','prioritizeRecords','cancel'].includes(value.method))return;
    queueMicrotask(()=>{let result=true,error;
      if(value.method==='prepare')result=options.count>1000?{modelPacked:true}:info;
      if(value.method==='segment'){let segment=segments.get(value.ordinal);if(!segment){const range=info.segments[value.ordinal];segment={leaseId:String(value.ordinal+1).repeat(24),videoEncoding:info.videoEncoding,frames:info.frames.slice(range.first,range.last+1).map((f,n)=>({...f,file:n+'.avc'}))};segments.set(value.ordinal,segment);}result=segment;}
      if(value.method==='recordStill')result={leaseId:'e'.repeat(24),width:16,height:8,frames:[{file:'0.jpg',ptsTicks:String(value.ordinal)}]};
      if(value.method==='releaseRecord'&&failReturn){failReturn=false;error={code:'MODEL_RETURN',message:'record release failed'};}
      emit({type:'response',id:value.id,...(error?{error}:{result})});
      if(value.method==='close'){emit({type:'guard',event:'finished',exitCode:0});queueMicrotask(()=>host.emit('close',0));}
    });
  };
  const binary=Buffer.from('model guard'),source=Buffer.from('model source'),build=Buffer.from(JSON.stringify({schema:'eva-task-guard-build-v1',bytes:binary.length,executableSha256:sha(binary),sourceSha256:sha(source)}));
  vm.runInNewContext(fs.readFileSync(path.join(root,'task-client.cjs'),'utf8'),{module,exports:module.exports,Buffer,process:{execPath:'model-node'},AbortController,console,
    require(name){if(name==='fs')return {realpathSync:value=>value,lstatSync:()=>({isSymbolicLink:()=>false}),readFileSync:file=>file.endsWith('.json')?build:file.endsWith('.exe')?binary:source};
      if(name==='child_process')return {spawn(){queueMicrotask(()=>emit({type:'ready',taskOwner:owner}));return host;}};
      if(name==='./cache-read-client.cjs')return {createReadClient:()=>read};if(name==='./media-wire.cjs')return {unpackInfo:value=>value.modelPacked?info:value};return require(name.startsWith('.')?path.resolve(root,name):name);}
  },{filename:'plugin/task-client.cjs'});
  const api=module.exports.createTaskClient({pluginRoot:root,discoverTools:async()=>({})});return {api,info,messages,events,emit,prepare:()=>api.media.prepare({}),read};
}
function worker(options={}){
  const input=new EventEmitter(),timers=new Map(),responses=new Map(),messages=[],calls=[],info=manifest(),records=new Map();let next=0,timer=0;
  const cache={release:async value=>{calls.push(['release',value.leaseId]);return true;},clearOther:async()=>true};
  const media={prepare:async()=>info,prepareSegment:async(_info,n,{signal})=>{calls.push(['segment',n]);if(options.segment)await options.segment(n,signal);return {leaseId:String(n+1).repeat(24)};},
    prepareStill:async(_info,n,{signal})=>{calls.push(['still',n]);if(options.still)await options.still(n,signal);const value={leaseId:'r'+n,frames:[{file:'0.jpg'}]};records.set(n,value);return value;},
    proxyBudget:async()=>({usedBytes:0,diskLimitBytes:5*1024**3}),closeProxyBatch:async()=>{calls.push(['close-batch']);},releaseLong:async()=>{calls.push(['release-source']);}};
  const proc={env:{EVA_TASK_ROOT:root,EVA_TASK_KEY:owner.key,EVA_TASK_EPOCH:owner.epoch,EVA_TASK_GUARD_PID:'123'},versions:{node:process.versions.node},pid:1,stdin:new EventEmitter(),stderr:{write(){}},stdout:{write(text,callback){if(text){const value=JSON.parse(text);messages.push(value);if(value.type==='response')responses.get(value.id)?.resolve(value);}if(callback)callback();}},exit:code=>calls.push(['exit',code])};input.close=()=>{};proc.stdin.destroy=()=>{};
  vm.runInNewContext(fs.readFileSync(path.join(root,'task-worker.cjs'),'utf8'),{__dirname:root,Buffer,process:proc,console,AbortController,require(name){if(name==='fs')return {realpathSync:()=>root};if(name==='readline')return {createInterface:()=>input};if(name==='./process-identity.cjs')return {createIdentity:()=>({self:()=>({pid:1}),inspect:()=>({safe:false})})};if(name==='./cache.cjs')return {createCache:()=>cache};if(name==='./media.cjs')return {createMedia:()=>media};if(name==='./media-wire.cjs')return {packInfo:value=>value};if(name==='./proxy-background.cjs')return {createProxyBackground:settings=>require('../plugin/proxy-background.cjs').createProxyBackground({...settings,schedule:fn=>{timers.set(++timer,fn);return timer;},cancel:id=>timers.delete(id)})};return require(name.startsWith('.')?path.resolve(root,name):name);}});
  function start(method,fields={}){const id=++next,gate=deferred();responses.set(id,gate);input.emit('line',JSON.stringify({id,method,...fields}));return gate.promise.then(value=>{responses.delete(id);if(value.error)throw Object.assign(Error(value.error.message),{code:value.error.code});return value.result;});}
  return {calls,info,messages,start,get lastId(){return next;},control:message=>input.emit('line',JSON.stringify(message)),async pump(){const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());await flush();}};
}
async function main(){let count=0;const test=async(name,fn)=>{await fn();count++;console.log('ok task read priority: '+name);};
  await test('segment events become ready only after asynchronous adoption and duplicate events coalesce',async()=>{
    const gate=deferred(),h=client({adopt:()=>gate.promise}),info=await h.prepare(),segment={leaseId:'c'.repeat(24),videoEncoding:info.videoEncoding,frames:info.frames.slice(0,2).map((f,n)=>({...f,file:n+'.avc'}))};
    h.emit({type:'proxy-segment',parentLeaseId:info.leaseId,ordinal:0,value:segment});h.emit({type:'proxy-segment',parentLeaseId:info.leaseId,ordinal:0,value:segment});assert.equal(h.api.cache.isFrameReady(info,0),false);assert.equal(h.events.filter(v=>v[0]==='adopt').length,1);gate.resolve();await flush();assert(h.api.cache.isFrameReady(info,0));
    await h.api.cache.readAsset(info,info.frames[0].file);assert.equal(h.messages.filter(v=>v.method==='segment').length,0);await h.api.cache.release(info);await h.api.close();
  });
  await test('120000 annotation ordinals use bounded bitmaps and target intentions need no response IDs',async()=>{
    const h=client({count:120000}),info=await h.prepare(),all=Array.from({length:120000},(_,n)=>n);h.api.cache.prioritizeRecords(info,{all,visible:[0,119999]});h.api.cache.prioritizeRecords(info,{all,visible:[0,119999]});for(let n=0;n<240;n++)h.api.cache.target(info,n);
    const values=h.messages.filter(v=>v.method==='prioritizeRecords');assert.equal(values.length,2);assert(values.every(value=>Buffer.byteLength(JSON.stringify(value))<32768&&!value.id));assert.equal(Buffer.from(values[0].bits,'base64').length,15000);assert.equal(h.messages.filter(v=>v.method==='target').length,240);await h.api.cache.release(info);await h.api.close();
  });
  await test('source release waits for cancelled record byte reads, detach and record return before release',async()=>{
    const gate=deferred(),h=client({read:()=>gate.promise}),info=await h.prepare();const read=h.api.cache.readRecordFrame(info,1).catch(error=>error);await flush();let done=false;const closing=h.api.cache.release(info).then(()=>done=true);await flush();assert(!done);gate.resolve();const result=await read;assert.equal(result.code,'MEDIA_CANCELLED');await closing;
    assert(h.events.some(v=>v[0]==='detach'&&v[1]==='e'.repeat(24)));const methods=h.messages.map(v=>v.method);assert(methods.indexOf('releaseRecord')<methods.indexOf('release'));await h.api.close();
  });
  await test('failed record return remains known and source release retries it before succeeding',async()=>{
    const h=client({failReturn:true}),info=await h.prepare();await assert.rejects(h.api.cache.readRecordFrame(info,0),/record release failed/);await h.api.cache.release(info);assert.equal(h.messages.filter(v=>v.method==='releaseRecord').length,2);await h.api.close();
  });
  await test('idle prewarm priority reaches the worker without changing demand paint or return ownership',async()=>{
    const h=client(),info=await h.prepare();await h.api.cache.readRecordFrame(info,0,{priority:'idle'});await h.api.cache.readRecordFrame(info,1,{});
    const requests=h.messages.filter(value=>value.method==='recordStill');assert.equal(requests[0].priority,'idle');assert.equal(requests[1].priority,undefined);assert.equal(h.messages.filter(value=>value.method==='releaseRecord').length,2);await h.api.cache.release(info);await h.api.close();
  });
  await test('worker target and record bitmaps bypass the queued writer job and invalid bits do not close it',async()=>{
    const gate=deferred();let signal;const h=worker({segment:async(_,s)=>{signal=s;await gate.promise;if(s.aborted)throw Object.assign(Error('cancelled'),{code:'MEDIA_CANCELLED'});}});await h.start('prepare');await h.pump();assert.deepEqual(h.calls.find(v=>v[0]==='segment'),['segment',0]);
    h.control({method:'target',leaseId:h.info.leaseId,time:3});assert(signal.aborted);h.control({method:'prioritizeRecords',leaseId:h.info.leaseId,kind:'visible',bits:'!invalid!'});gate.resolve();await flush();await h.start('ping');assert(!h.calls.some(v=>v[0]==='exit'));await h.start('release',{leaseId:h.info.leaseId});await h.start('close');
  });
  await test('cold frame demand cancels active and queued record transcodes before taking the writer',async()=>{
    const entered=deferred();let aborts=0;const h=worker({still:async(_,signal)=>{entered.resolve();await new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(Object.assign(Error('cancelled'),{code:'MEDIA_CANCELLED'}));},{once:true}));}});await h.start('prepare');
    const one=h.start('recordStill',{leaseId:h.info.leaseId,ordinal:0}).catch(error=>error);await entered.promise;const two=h.start('recordStill',{leaseId:h.info.leaseId,ordinal:1}).catch(error=>error);const segment=await h.start('segment',{leaseId:h.info.leaseId,ordinal:1});assert(segment);assert.equal((await one).code,'MEDIA_CANCELLED');assert.equal((await two).code,'MEDIA_CANCELLED');assert.equal(aborts,1);assert.equal(h.calls.filter(v=>v[0]==='still').length,1);await h.start('release',{leaseId:h.info.leaseId});await h.start('close');
  });
  await test('idle record prewarm does not interrupt a near segment and remains cancellable by foreground demand',async()=>{
    const gate=deferred();let nearSignal;const h=worker({segment:async(n,signal)=>{if(n!==0)return;nearSignal=signal;await gate.promise;if(signal.aborted)throw Object.assign(Error('cancelled'),{code:'MEDIA_CANCELLED'});}});await h.start('prepare');await h.pump();assert(nearSignal&&!nearSignal.aborted);
    const idle=h.start('recordStill',{leaseId:h.info.leaseId,ordinal:0,priority:'idle'}).catch(error=>error);await flush();assert(!nearSignal.aborted,'prewarming a record must not cancel nearby proxy production');assert.equal(h.calls.filter(value=>value[0]==='still').length,0);
    const foreground=h.start('segment',{leaseId:h.info.leaseId,ordinal:1});assert(nearSignal.aborted);gate.resolve();await foreground;assert.equal((await idle).code,'MEDIA_CANCELLED');assert.equal(h.calls.filter(value=>value[0]==='still').length,0);await h.start('release',{leaseId:h.info.leaseId});await h.start('close');assert(h.calls.some(value=>value[0]==='release-source'));assert(h.calls.some(value=>value[0]==='exit'&&value[1]===0));
  });
  await test('borrowed static leases prevent source close and releasing one does not abort background',async()=>{
    const h=worker();await h.start('prepare');const value=await h.start('recordStill',{leaseId:h.info.leaseId,ordinal:1});await assert.rejects(h.start('release',{leaseId:h.info.leaseId}),/未交还/);await h.start('releaseRecord',{leaseId:h.info.leaseId,recordLeaseId:value.leaseId});await h.start('release',{leaseId:h.info.leaseId});assert(h.calls.some(v=>v[0]==='release'&&v[1]===value.leaseId));await h.start('close');
  });
  await test('cached static borrow and return bypass blocked producer while the read host can still deliver bytes',async()=>{
    const gate=deferred();let signal;const h=worker({segment:async(n,s)=>{signal=s;await gate.promise;if(s.aborted)throw Object.assign(Error('cancelled'),{code:'MEDIA_CANCELLED'});}});await h.start('prepare');const first=await h.start('recordStill',{leaseId:h.info.leaseId,ordinal:1});await h.start('releaseRecord',{leaseId:h.info.leaseId,recordLeaseId:first.leaseId});await h.pump();assert(signal&&!signal.aborted);
    let borrowed=false;const pending=h.start('recordStill',{leaseId:h.info.leaseId,ordinal:1,priority:'idle'}).then(value=>{borrowed=true;return value;});await flush();assert(borrowed,'cached lease must not wait behind producer queue');const value=await pending;assert.equal(value.leaseId,first.leaseId);assert(!signal.aborted);
    const replies=[],reader=require('../plugin/cache-read-worker.cjs').createReadHost({cache:{adoptReadLease:info=>assert.equal(info.leaseId,value.leaseId),readAsset:async()=>Buffer.from('verified-read-model'),detachReadLease:()=>true},send:reply=>replies.push(reply)});
    reader.receive({id:1,method:'adopt',info:value,taskOwner:owner});await flush();reader.receive({id:2,method:'read',leaseId:value.leaseId,file:'0.jpg'});await flush();assert.equal(Buffer.from(replies.find(reply=>reply.id===2).result).toString(),'verified-read-model');
    await assert.rejects(h.start('releaseRecord',{leaseId:'wrong-source',recordLeaseId:value.leaseId}),/未知/);let returned=false;const returning=h.start('releaseRecord',{leaseId:h.info.leaseId,recordLeaseId:value.leaseId}).then(()=>returned=true);await flush();assert(returned,'cached return must not wait behind producer queue');await returning;assert(!signal.aborted);reader.receive({id:3,method:'detach',leaseId:value.leaseId});await flush();reader.receive({id:4,method:'close'});await flush();assert.equal(replies.find(reply=>reply.id===4).result,true);
    gate.resolve();await flush();await h.start('release',{leaseId:h.info.leaseId});await h.start('close');assert.equal(h.calls.filter(call=>call[0]==='release'&&call[1]===value.leaseId).length,1);
  });
  await test('late cancellation of a cached response keeps its known borrow until the client returns it',async()=>{
    const h=worker();await h.start('prepare');const seed=await h.start('recordStill',{leaseId:h.info.leaseId,ordinal:0});await h.start('releaseRecord',{leaseId:h.info.leaseId,recordLeaseId:seed.leaseId});
    const pending=h.start('recordStill',{leaseId:h.info.leaseId,ordinal:0});h.control({method:'cancel',id:h.lastId});const value=await pending;await assert.rejects(h.start('release',{leaseId:h.info.leaseId}),/未交还/);assert(!h.calls.some(call=>call[0]==='release-source'));await h.start('releaseRecord',{leaseId:h.info.leaseId,recordLeaseId:value.leaseId});await h.start('release',{leaseId:h.info.leaseId});await h.start('close');assert(h.calls.some(call=>call[0]==='release-source'));
  });
  await test('worker close cannot claim success while a known static borrow remains unreturned',async()=>{
    const h=worker();await h.start('prepare');await h.start('recordStill',{leaseId:h.info.leaseId,ordinal:0});await assert.rejects(h.start('close'),/尚未交还/);assert(!h.calls.some(call=>call[0]==='release-source'||call[0]==='exit'&&call[1]===0));
  });
  console.log('Task read priority: '+count+' actual client/worker protocol models; no native host or media.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
