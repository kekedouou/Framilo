'use strict';
// Formal E44 source ownership and native readers; no Eagle API and no segmented producer.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const frameIndex=require('./frame-index.cjs'),preview=require('./preview-profile.cjs');
const {FilmcraftClient}=require('./native-reader.cjs');
const {createWholeProxy}=require('./whole-proxy.cjs');
const {createTaskClient}=require('./task-client.cjs');
const {createAudioTrack}=require('./native-audio.cjs');
function aborted(){return Object.assign(Error('视频准备已取消。'),{name:'AbortError',code:'MEDIA_CANCELLED'});}
function check(signal){if(signal?.aborted)throw aborted();}
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||path.resolve(fs.realpathSync(file)).toLowerCase()!==path.resolve(file).toLowerCase())throw Error('源文件或工具路径不是可确认的普通文件。');return s;}
async function hash(file,signal){const before=regular(file),h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file,{highWaterMark:1024**2})){check(signal);h.update(b);}const after=regular(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('读取时源视频发生变化。');return h.digest('hex');}
function runJson(exe,args,signal,max=64*1024**2){return new Promise((resolve,reject)=>{
 check(signal);const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),chunks=[];let size=0,tail='',failure;
 const stop=()=>{failure=aborted();child.kill();},timer=setTimeout(()=>{failure=Error('读取源帧索引超时。');child.kill();},120000);
 signal?.addEventListener('abort',stop,{once:true});child.stdout.on('data',b=>{size+=b.length;if(size>max){failure=Error('源帧索引超过64MiB安全上限。');child.kill();}else chunks.push(b);});child.stderr.on('data',b=>{tail=(tail+b).slice(-4096);});child.on('error',e=>{failure=e;});child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(failure||code!==0)return reject(failure||Error('源帧索引读取失败：'+tail));try{resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch(e){reject(e);}});
 });}
async function inspect(source,tools,quality,signal,onProgress=()=>{}){
 onProgress({stage:"source-index",message:"读取源帧索引"});
 const sourceBefore=regular(source.filePath),sourceStamp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
 const raw=await runJson(tools.ffprobe,['-v','error','-show_streams','-show_format','-show_packets','-select_streams','v:0','-show_entries','packet=pts,duration:stream=index,codec_type,codec_name,width,height,time_base,duration,duration_ts,start_pts,sample_aspect_ratio,color_space,color_transfer,color_primaries,color_range:stream_tags=rotate:stream_side_data=rotation','-of','json',source.filePath],signal);
 const video=raw.streams?.find(x=>x.codec_type==='video');if(!video||!raw.packets?.length)throw Error('未找到可靠的视频源帧。');
 const tb=String(video.time_base).split('/').map(Number);if(tb.length!==2||tb.some(x=>!Number.isSafeInteger(x)||x<=0))throw Error('源时间基无效。');
 const packets=raw.packets.map(x=>{if(!Number.isSafeInteger(x.pts))throw Error('源帧时间缺失或超出整数精度。');return x;}).sort((a,b)=>a.pts-b.pts);
 if(packets.length>120000||packets.some((x,n)=>n&&x.pts===packets[n-1].pts))throw Error('源帧数量超过120000或存在重复源时间。');
 const last=packets[packets.length-1];let end;
 if(Number.isSafeInteger(last.duration)&&last.duration>0)end=BigInt(last.pts)+BigInt(last.duration);
 else if(Number.isSafeInteger(video.duration_ts)&&Number.isSafeInteger(video.start_pts))end=BigInt(video.start_pts)+BigInt(video.duration_ts);
 else throw Error('末帧结束时间无法确认，已停止准备。');
 if(end<=BigInt(last.pts))throw Error('源末帧结束时间无效。');
 const indexed=frameIndex.buildIndex(packets.map((x,n)=>({id:n,ptsTicks:String(x.pts),file:'native:'+n,bytes:1})),{timeBase:tb,lastFrameEndTicks:String(end)});
 const geometry=preview.dimensions(video,quality);
 onProgress({stage:"audio-index",message:"读取音轨信息"});
 const audioProbe=await runJson(tools.ffprobe,['-v','error','-select_streams','a:0','-show_entries','stream=codec_type,duration,start_time,channels,sample_rate','-of','json',source.filePath],signal,1024**2);
 const a=audioProbe.streams?.[0],origin=Number(indexed.originPtsTicks)*tb[0]/tb[1];
 const audio=a?{file:'native-audio',bytes:1,start:(Number(a.start_time)||0)-origin,duration:Number(a.duration)||indexed.videoDuration,sampleRate:Number(a.sample_rate)||48000,channels:Number(a.channels)||2}:null;
 onProgress({stage:"source-hash",message:"校验源视频身份"});
 const sha256=await hash(source.filePath,signal);check(signal);
 if(sourceStamp(sourceBefore)!==sourceStamp(regular(source.filePath)))throw Error('源视频在建立帧索引期间发生变化，已停止准备。');
 return {schema:1,owner:'e44-native',source:{...source,sha256,nativeStamp:sourceStamp(sourceBefore),codec:video.codec_name,width:video.width,height:video.height,hasAudioStream:!!audio},
 width:geometry.width,height:geometry.height,duration:Math.max(indexed.videoDuration,audio?audio.start+audio.duration:0),frames:indexed.frames,audio,preview:geometry,sourceVideo:video,videoEncoding:'filmcraft-native',metrics:{reused:false,sourceVideoOrigin:origin}};
}
function createNativeBackend({pluginRoot,tools,onBackground=()=>{},ramBytes=1024**3,decoderPreference='prefer-hardware',proxyEncoder='cpu',automaticProxy=true,gpuDrawing=true,cacheRoot,limitBytes=5*1024**3}){
 const exe=path.join(pluginRoot,'bin/filmcraft-media.exe');regular(exe);let closing=false,maintenance=null,cleaning=null;const owners=new Set(),ownerSources=new Map(),preparing=new Set();
 const cacheDir=cacheRoot||path.join(pluginRoot,'cache/e44-whole');
 const producer=createWholeProxy({cacheRoot:cacheDir,capacityRoot:cacheDir,tools,limitBytes,onChange:onBackground});
 async function prepare(selected,settings={}){
  if(closing)throw Error('播放器正在关闭。');check(settings.signal);
  const controller=new AbortController(),relay=()=>controller.abort();settings.signal?.addEventListener('abort',relay,{once:true});
  const promise=inspect({...selected,filePath:path.resolve(selected.filePath)},tools,settings.previewQuality||'720p',controller.signal,settings.onProgress),pending={controller,promise};preparing.add(pending);
  let info;try{info=await promise;check(settings.signal);if(closing)throw aborted();}finally{preparing.delete(pending);settings.signal?.removeEventListener('abort',relay);}
  frameIndex.validateIndex(info);const readers=new Set(),listeners=new Set(),audioJobs=new Set();let released=false,asset=null,job=null,releasing=null;
  const nativeBytes=Math.max(128*1024**2,Math.min(192*1024**2,Math.floor(ramBytes/4)));
  const runtime={nativeBytes,async audioTrack(maxBytes){
    if(released||closing)throw aborted();const task=createAudioTrack({source:info.source,tools,maxBytes,expectedStamp:info.source.nativeStamp});audioJobs.add(task);
    try{const result=await task.promise;if(released||closing)throw aborted();return result;}finally{audioJobs.delete(task);}
   },cancelAudio(){for(const task of audioJobs)task.cancel();},async createReader({proxy=false}={}){
    if(released||closing)throw aborted();const file=proxy?asset?.filePath:info.source.filePath;if(!file)throw Error('完整代理尚未就绪。');
    const frames=proxy?info.frames.map((f,n)=>({...f,ptsTicks:asset.proxyPts[n],timeBase:asset.proxyTimeBase})):info.frames;
    const reader=new FilmcraftClient({exe,source:file,frames,software:(settings.decoderPreference||decoderPreference)==='prefer-software',height:parseInt(info.preview.quality),width:info.width,outputHeight:info.height,gpuDrawing,cacheBytes:nativeBytes});
    readers.add(reader);
    try{await reader.ready;if(released||closing)throw aborted();return reader;}
    catch(failure){await reader.close();readers.delete(reader);throw failure;}
   },async closeReader(r){readers.delete(r);return r.close();},async cancelReaders(){await Promise.allSettled([...readers].map(r=>r.close()));},proxyAsset:()=>asset,
   subscribeProxy(fn){listeners.add(fn);return()=>listeners.delete(fn);},
   resourcePids:()=>[...readers].map(r=>r.proc?.pid).concat(producer.pids(),...[...audioJobs].map(t=>t.pids())).filter(Number.isSafeInteger),
   diskUsage:async()=>{const proxy=await producer.measure(info.source.sha256);return {...proxy,scope:'proxy'};},
   status(){return job?.snapshot()||{stage:'idle',status:'idle',ready:0,total:info.frames.length,readyRanges:[]};},
   startProxy(){if(released)return null;if(job&&['queued','checking','encoding','validating','ready'].includes(job.snapshot().status))return job;
    try{job=producer.start({source:info.source,frames:info.frames,width:info.width,height:info.height,duration:info.frames[info.frames.length-1].end,encoder:settings.proxyEncoder||proxyEncoder,video:info.sourceVideo,validationHardware:(settings.decoderPreference||decoderPreference)!=='prefer-software'});}
    catch(failure){const state={status:'failed',stage:'error',ready:0,total:info.frames.length,readyRanges:[],message:failure.message,error:{code:failure.code||'WHOLE_START',message:failure.message}};job={ready:Promise.resolve(null),snapshot:()=>state,cancel:async()=>null};try{onBackground();}catch(_){}return job;}
    job.ready.then(value=>{if(!value||released||closing)return;asset=value;try{onBackground();}catch(_){}for(const fn of listeners)try{fn(value);}catch(_){}}).catch(()=>{});try{onBackground();}catch(_){}return job;},
   async cancelProxy(){if(job)await job.cancel();try{onBackground();}catch(_){}return runtime.status();},
   release(){if(releasing)return releasing;released=true;runtime.cancelAudio();ownerSources.delete(runtime);listeners.clear();releasing=(async()=>{await Promise.allSettled([...audioJobs].map(t=>t.promise));await job?.cancel();await Promise.allSettled([...readers].map(r=>r.close()));readers.clear();await job?.release?.();owners.delete(runtime);})();return releasing;}
  };info.nativeRuntime=runtime;owners.add(runtime);ownerSources.set(runtime,info.source.sha256);if(automaticProxy)runtime.startProxy();return info;
 }
 function clearOther(settings={}){
  if(cleaning)return cleaning;cleaning=performClearOther(settings).finally(()=>{cleaning=null;});return cleaning;
 }
 async function performClearOther({sourceSha256}={}){
  if(closing||preparing.size||!/^[a-f0-9]{64}$/.test(sourceSha256||'')||![...ownerSources.values()].includes(sourceSha256))throw Object.assign(Error('请等待视频就绪后清理其它缓存。'),{code:'CACHE_CLEAN_BUSY'});
  // Legacy ownership is independent from whole-proxy ownership. A native-only
  // root never acquires authority to delete unknown legacy data.
  let result={cleared:0,freedBytes:0};
  if(fs.existsSync(path.join(pluginRoot,'cache/owner.json'))){
    maintenance=maintenance||createTaskClient({pluginRoot,discoverTools:async()=>tools});
    result=await maintenance.cache.clearOther({sourceSha256,independentWholeProxy:true});
  }
  let proxy;
  try{proxy=await producer.clearOther?.(sourceSha256);}catch(failure){if(result.cleared)failure.message='已清理'+result.cleared+'个旧序列缓存；代理清理未完成：'+failure.message;throw failure;}
  result={...result,cleared:result.cleared+(proxy?.removed||0),freedBytes:result.freedBytes+(proxy?.freed||0)};
  try{onBackground();}catch(_){}
  return{status:result.cleared?'cleared':'unchanged',...result,message:result.cleared?'已清除'+result.cleared+'个其它视频缓存，释放'+(result.freedBytes/1024**2).toFixed(1)+' MB；当前与占用中的缓存保留。':'没有可清理的其它视频缓存；当前、占用中及身份不明的文件保留。'};
 }
 const cache={readAsset(){return Promise.reject(Error('原生视频不读取JPEG或旧分段资源。'));},readFrameBatch(){return Promise.reject(Error('原生视频不读取旧帧包。'));},release:info=>info.nativeRuntime.release(),backgroundStatus:info=>info.nativeRuntime.status(),target(){},prefetch(){},cancelReads(){},isFrameReady:()=>false,prioritizeRecords(){},clearOther};
 return {media:{prepare},cache,beginClose(){closing=true;for(const p of preparing)p.controller.abort();for(const r of owners)r.release().catch(()=>{});},async close(){closing=true;for(const p of preparing)p.controller.abort();await Promise.allSettled([...preparing].map(p=>p.promise));await Promise.allSettled([...owners].map(r=>r.release()));await producer.close();await cleaning?.catch(()=>{});await maintenance?.close();}};
}
module.exports={createNativeBackend,inspect,runJson};
