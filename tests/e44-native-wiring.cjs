'use strict';
const assert=require('node:assert/strict');
const {harness,bounded}=require('./t1-app.cjs');
const tick=()=>new Promise(r=>setTimeout(r,5));
async function main(){
 let ramBytes=1024**3,auto=true,gpu=true;const calls=[],created=[];
 const preferences={snapshot:()=>({ramBytes,compressedRamBytes:ramBytes/8}),decoderPreference:()=> 'prefer-hardware',proxyEncoder:()=> 'cpu',automaticProxy:()=>auto,gpuDrawing:()=>gpu,gpuAcceleration:()=>gpu,forwardPredecode:()=>true};
 function NativePlayer(options){this.nativeOptions=options;}
 const h=harness({preferences,nativePlayer:NativePlayer,modules:{'native-backend.cjs':{createNativeBackend(options){
  const id=created.length+1,cache={readAsset(info,file){calls.push(['read',id,info.id,file]);return Buffer.from(String(id));},async release(info){calls.push(['release',id,info.id]);}};
  const backend={cache,media:{async prepare(source){return {id:'native-'+id,videoEncoding:'filmcraft-native',nativeRuntime:{id},source};}},beginClose(){calls.push(['beginClose',id]);},async close(){calls.push(['close',id]);}};
  created.push({options,backend});return backend;
 }}}});
 await h.hooks.onPluginCreate({path:h.root});
 const first=h.config.media.prepare({id:'source',filePath:'D:/synthetic/source.mp4'},{playbackBackend:'proxy'});await tick();assert.equal(h.discoveries.length,1);h.discoveries[0].resolve({ffmpeg:'existing-only'});
 const info=await bounded(first);assert.equal(created.length,1);assert.equal(created[0].options.automaticProxy,true);assert.equal(created[0].options.proxyEncoder,'nvidia');assert.equal(created[0].options.decoderPreference,'prefer-hardware');
 const native=h.config.createPlayer({mediaInfo:info,onChange(){}});assert(native instanceof NativePlayer);assert.strictEqual(native.nativeOptions.nativeRuntime,info.nativeRuntime);assert.equal(native.nativeOptions.gpuDrawing,true);
 const previews=h.config.createPreviewServices({info,player:{auxiliaryBudget(){assert.fail('old preview layer attached');}}});assert.equal(Object.keys(previews).length,0);
 ramBytes=2*1024**3;auto=false;const next=await h.config.media.prepare({id:'source',filePath:'D:/synthetic/source.mp4'},{playbackBackend:'proxy'});
 assert.equal(created.length,2);assert.deepEqual(calls[0],['close',1]);assert.equal(created[1].options.automaticProxy,true);assert.equal(h.discoveries.length,1,'cached SDK tools do not trigger another discovery');
 assert.equal((await h.config.cache.readAsset(info,'old')).toString(),'1');assert.equal((await h.config.cache.readAsset(next,'new')).toString(),'2');
 await h.config.cache.release(info);await h.config.cache.release(next);
 assert.deepEqual(calls.slice(-4),[['read',1,'native-1','old'],['read',2,'native-2','new'],['release',1,'native-1'],['release',2,'native-2']]);
 gpu=false;const cpuInfo=await h.config.media.prepare({id:'source',filePath:'D:/synthetic/source.mp4'},{playbackBackend:'proxy'});assert.equal(created.length,3);assert.equal(created[2].options.gpuDrawing,false);assert.equal(created[2].options.proxyEncoder,'cpu');assert.equal(created[2].options.decoderPreference,'prefer-software');assert.equal(created[2].options.automaticProxy,true);assert.equal(h.config.createPlayer({mediaInfo:cpuInfo}).nativeOptions.gpuDrawing,false);await h.config.cache.release(cpuInfo);
 await h.hooks.onPluginBeforeExit();assert(calls.some(x=>x[0]==='beginClose'&&x[1]===3));
 console.log('E44 native app wiring: native/JPEG boundary, unified GPU switch/automatic proxy, exact runtime, no old previews, settings rebuild, original lease ownership and close passed (host model).');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
