'use strict';
// Real Session ownership/preview wiring with deterministic Player/services.
// No files are written, no media tools, host or real annotation store is used.
const assert=require('assert'),path=require('path');
const {createSession}=require('../plugin/session.cjs'),index=require('../plugin/frame-index.cjs');
const drawingModel=require('../plugin/drawing-model.js');
const SHA='a'.repeat(64),selected=Object.freeze({id:'preview-model',itemId:'preview-model',name:'preview',filePath:path.resolve('preview-model.mp4'),ext:'mp4'});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const flush=async()=>{for(let n=0;n<80;n++)await Promise.resolve();};
function model(settings={}){
  const events=[],updates=[],bindings=[];let config,player,quickState={active:false,approximate:false,time:null};
  const frames=index.buildIndex(['0','1','3','4'].map((ptsTicks,id)=>({id,ptsTicks,file:`frame-${id}.${settings.jpeg?'jpg':'avc'}`,bytes:32})),{timeBase:[1,4],lastFrameEndTicks:'6'}).frames;
  const info={leaseId:'b'.repeat(24),source:{...selected,sha256:SHA},width:1280,height:720,duration:1.5,preview:{quality:'720p',width:1280,height:720},frames,
    ...(!settings.jpeg?{streaming:'segments-v1',videoEncoding:{format:'annexb-idr-v1',codec:'avc1.42001f'}}:{})};
  const quick={snapshot:()=>({...quickState}),request(time,options){events.push(['quick-request',time,options]);quickState={active:true,approximate:true,time};config.onChange();},cancel(){events.push(['quick-cancel']);},clear(){events.push(['quick-clear']);quickState={active:false,approximate:false,time:null};config.onChange();},close(){events.push(['quick-close']);return settings.quickClose?settings.quickClose():Promise.resolve();}};
  const records={prioritize(value){events.push(['record-prioritize',value]);},paint(ordinal,canvas){events.push(['paint',ordinal,canvas]);return Promise.resolve({painted:true,ordinal});},close(){events.push(['records-close']);return settings.recordsClose?settings.recordsClose():Promise.resolve();}};
  const cache={readAsset:async(value,file)=>{events.push(['asset',value,file]);return Buffer.from('registered-jpeg');},readRecordFrame:async(value,ordinal,options)=>{events.push(['still',value,ordinal,options]);return {bytes:Buffer.from('single-jpeg'),width:value.width,height:value.height,ordinal};},
    release:async value=>{events.push(['release',value]);},isFrameReady:()=>!!settings.ready,prioritizeRecords(value,order){events.push(['cache-prioritize',value,order]);},cancelReads:value=>events.push(['cancel-reads',value])};
  const session=createSession({eagleAdapter:{captureSelected:()=>selected,drawingLibrary:()=>path.resolve('model-library')},media:{prepare:async()=>info},cache,
    annotationStore:{read(binding){bindings.push(binding);return {records:[]};}},onChange:value=>updates.push(value),
    createPlayer(options){
      player={options,state:{state:'loading',time:0,frameId:null,frameOrdinal:null,pendingTargets:0},snapshot(){return {...this.state};},
        change(value){this.state={...this.state,...value};options.onChange(this.snapshot());},
        async load(value){assert.strictEqual(value,info);await Promise.resolve();this.change({state:'paused',time:0,frameId:0,frameOrdinal:0});},
        async seek(time,options={}){const ordinal=options.index??drawingModel.frameIndex(info.frames,time,info.duration);this.change({state:'seeking',pendingTargets:1,targetTime:time});if(settings.seek)await settings.seek(time,options);else await Promise.resolve();this.change({state:'paused',time:info.frames[ordinal].time,frameId:info.frames[ordinal].id,frameOrdinal:ordinal,pendingTargets:0});return {status:'drawn',frameId:info.frames[ordinal].id};},
        async play(){this.change({state:'playing'});return {status:'playing'};},async pause(){this.change({state:'paused',pendingTargets:0});return {status:'paused'};},step(delta){return this.seek(info.frames[Math.max(0,Math.min(info.frames.length-1,this.state.frameOrdinal+delta))].time);},
        dispose(){events.push(['player-close']);return settings.playerClose?settings.playerClose():Promise.resolve();}};return player;
    },createPreviewServices(value){config=value;assert.strictEqual(value.info,info);assert.strictEqual(value.player,player);events.push(['factory']);value.register('quick',settings.jpeg?null:quick);if(settings.factoryThrow)throw Error('second preview factory failed');value.register('records',records);return {quick:settings.jpeg?null:quick,records};}
  });
  return {session,info,quick,records,cache,events,updates,bindings,get config(){return config;},get player(){return player;},setApprox(value){quickState={...quickState,...value};config.onChange();}};
}
async function main(){let count=0;const test=async(name,fn)=>{await fn();count++;console.log('ok preview session: '+name);};
  await test('approximate preview merges its status while exact frame and original SHA remain unchanged',async()=>{
    const gate=deferred(),h=model({seek:()=>gate.promise});assert.equal((await h.session.loadSelected()).status,'ready');assert(h.config.isCurrent());
    const pending=h.session.seek(.9,{kind:'drag'});await flush();assert(h.config.busy());h.setApprox({active:true,approximate:true,time:1.4});
    const state=h.session.snapshot();assert.equal(state.preview.quality,'720p');assert.equal(state.preview.width,1280);assert.equal(state.preview.active,true);assert.equal(state.preview.time,1.4);assert.equal(state.playback.frameOrdinal,0);assert.equal(state.playback.time,0);assert.equal(state.sourceIdentity.sha256,SHA);assert(h.bindings.every(value=>value.sourceSha256===SHA));
    gate.resolve();await pending;assert.equal(h.session.snapshot().playback.frameOrdinal,2);assert.equal(h.session.snapshot().preview.active,false);assert.equal(h.session.snapshot().playback.time,.75);assert(!h.config.busy());await h.session.close();assert(!h.config.isCurrent());
  });
  await test('final seek cancels temporary requests and exact commit clears the overlay at its real source frame',async()=>{
    const gate=deferred(),h=model({seek:()=>gate.promise});await h.session.loadSelected();h.setApprox({active:true,approximate:true,time:.2});const before=h.events.filter(value=>value[0]==='quick-request').length;
    const pending=h.session.seek(1.2,{kind:'drag',final:true});await flush();assert(h.events.some(value=>value[0]==='quick-cancel'));assert.equal(h.events.filter(value=>value[0]==='quick-request').length,before);assert.equal(h.session.snapshot().playback.frameOrdinal,0);
    gate.resolve();await pending;assert.equal(h.session.snapshot().playback.frameOrdinal,3);assert.equal(h.session.snapshot().playback.time,1);assert.equal(h.session.snapshot().preview.active,false);assert(h.events.some(value=>value[0]==='quick-clear'));await h.session.close();
  });
  await test('source release waits for Player and both asynchronous preview closures',async()=>{
    const player=deferred(),quick=deferred(),records=deferred(),h=model({playerClose:()=>player.promise,quickClose:()=>quick.promise,recordsClose:()=>records.promise});await h.session.loadSelected();let done=false;const closing=h.session.close().then(value=>{done=true;return value;});await flush();
    assert.deepEqual(h.events.filter(value=>/-close$/.test(value[0])).map(value=>value[0]),['player-close','quick-close','records-close']);assert(!h.config.isCurrent());assert(!done);assert(!h.events.some(value=>value[0]==='release'));
    player.resolve();quick.resolve();await flush();assert(!done);assert(!h.events.some(value=>value[0]==='release'));records.resolve();assert.equal((await closing).status,'closed');assert.strictEqual(h.events.find(value=>value[0]==='release')[1],h.info);
  });
  await test('a synchronous close failure still waits for the other service and keeps the source leased',async()=>{
    const records=deferred(),h=model({quickClose:()=>{throw Error('quick synchronous close failure');},recordsClose:()=>records.promise});await h.session.loadSelected();let done=false;const closing=h.session.close().then(value=>{done=true;return value;});await flush();assert(!done);assert(h.events.some(value=>value[0]==='records-close'));assert(!h.events.some(value=>value[0]==='release'));
    records.resolve();const result=await closing;assert.equal(result.status,'error');assert.match(result.error.message,/quick synchronous close failure/);assert(!h.events.some(value=>value[0]==='release'));
  });
  await test('registered first service is closed when construction of the next service throws',async()=>{
    const quick=deferred(),h=model({factoryThrow:true,quickClose:()=>quick.promise});let done=false;const loading=h.session.loadSelected().then(value=>{done=true;return value;});await flush();assert(!done);assert(h.events.some(value=>value[0]==='quick-close'));assert(h.events.some(value=>value[0]==='player-close'));assert(!h.events.some(value=>value[0]==='records-close'));assert(!h.events.some(value=>value[0]==='release'));
    quick.resolve();const result=await loading;assert.equal(result.status,'error');assert.match(result.error.message,/second preview factory failed/);assert.equal(h.events.filter(value=>value[0]==='quick-close').length,1);assert.strictEqual(h.events.find(value=>value[0]==='release')[1],h.info);await h.session.close();
  });
  await test('record times map to exact VFR ordinals and pass original info to cache and read capabilities',async()=>{
    const h=model();await h.session.loadSelected();h.session.prioritizeRecords({all:[0,.1,.6,.76,1.4,NaN,-1,2,.6],visible:[.76,1.4,.76]});
    const target=h.events.find(value=>value[0]==='record-prioritize')[1];assert.deepEqual(target,{all:[0,1,2,3],visible:[2,3]});const routed=h.events.find(value=>value[0]==='cache-prioritize');assert.strictEqual(routed[1],h.info);assert.strictEqual(routed[2],target);
    const canvas={},painted=await h.session.renderThumbnail(.9,canvas);assert.equal(painted.ordinal,2);const paint=h.events.find(value=>value[0]==='paint');assert.strictEqual(paint[2],canvas);const controller=new AbortController(),read=await h.config.read(2,{signal:controller.signal});assert.equal(read.ordinal,2);assert.strictEqual(h.events.find(value=>value[0]==='still')[1],h.info);await h.player.options.readAsset({...h.info},h.info.frames[0].file);assert.strictEqual(h.events.find(value=>value[0]==='asset')[1],h.info);await h.session.close();
  });
  await test('already prepared JPEG records read their registered asset without invoking proxy still preparation',async()=>{
    const h=model({jpeg:true});await h.session.loadSelected();const read=await h.config.read(1,{});assert.equal(read.bytes.toString(),'registered-jpeg');assert.equal(read.ordinal,1);assert.equal(read.width,1280);assert.equal(read.height,720);assert(!h.events.some(value=>value[0]==='still'));const routed=h.events.find(value=>value[0]==='asset');assert.strictEqual(routed[1],h.info);assert.equal(routed[2],h.info.frames[1].file);assert.equal(h.session.snapshot().preview.quality,'720p');await h.session.close();
  });
  console.log('Preview Session: '+count+' exact identity, temporary overlay, routing and closure models; no media or host.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
