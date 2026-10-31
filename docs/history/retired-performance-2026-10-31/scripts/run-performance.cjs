'use strict';
// Explicit E38 real-media check; does not reuse or erase historical experiment budgets.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const api=require('../plugin/performance-report.cjs'),{createCollector}=require('../plugin/performance-core.cjs');
const root=path.resolve(__dirname,'..'),base=path.join(root,'artifacts/performance'),evidence=path.join(root,'verification-runs/e38');
async function main(suppliedArgs){
 const args=suppliedArgs||process.argv.slice(2),value=k=>args[args.indexOf(k)+1],source=args.includes('--source')?path.resolve(value('--source')):null;
 if(!source)throw Error('必须显式指定 --source 和 --tools 配置，不扫描素材');
 const fixed=args.includes('--fixed-v2'),evidence=fixed?path.join(root,'verification-runs/performance-standard'):path.join(root,'verification-runs/e38');
 fs.mkdirSync(evidence,{recursive:true});if(!fixed&&fs.readdirSync(evidence).filter(n=>/^attempt-.*\.json$/.test(n)).length>=3)throw Error('E38三次独立运行预算已满');
 const quality=fixed?value('--quality'):'720p',ramBytes=fixed?Number(value('--ram-bytes')):512*1024**2;if(!['720p','1080p','1440p'].includes(quality)||!Number.isSafeInteger(ramBytes)||ramBytes<512*1024**2||ramBytes>10*1024**3)throw Error('固定测试配置无效');
 const runId=api.runId(),scratch=path.join(evidence,'scratch-'+runId);fs.mkdirSync(scratch);
 const record={runId,status:'running',scratch,sourceHash:null},receipt=path.join(evidence,'attempt-'+runId+'.json');
 fs.writeFileSync(receipt,JSON.stringify(record,null,2));
 const code=await api.codeSnapshot(path.join(root,'plugin')),controller=new AbortController();let client,info,result,safe=false;
 const deadline=setTimeout(()=>controller.abort(),600000);
 const diskWatch=setInterval(()=>{let bytes=0;const scan=dir=>{for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('unexpected link');if(s.isDirectory())scan(p);else bytes+=s.size;}};try{scan(scratch);if(bytes>450*1024**2)controller.abort();}catch(_){controller.abort();}},2000);
 const manifest={runId,createdAt:new Date().toISOString(),mode:'standard',status:'failed',code,source:{sha256:null},config:{quality,backend:args.includes('--jpeg')?'jpeg':'proxy',ramBytes,forwardPredecode:true},
   environment:api.environment(),conditions:{osCache:'unknown; not cleared',applicationCache:'new isolated cache, progressively warmed',proxyAtStart:'preparing'},measurementScope:'独立 Chrome / 正式 Player + task-client + Windows guard + 真实解码；不是 Eagle 窗口，音频不参与本次测量'};
 try{
  const tools=JSON.parse(fs.readFileSync(path.resolve(value('--tools')),'utf8'));
  assert(fs.statSync(source).isFile());record.sourceHash=api.hash(fs.readFileSync(source));manifest.source.sha256=record.sourceHash;
  const worker=path.join(scratch,'plugin');fs.mkdirSync(worker);for(const file of require('./package-release.cjs').RUNTIME){const to=path.join(worker,file);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(root,'plugin',file),to,fs.constants.COPYFILE_EXCL);}
  client=require('../plugin/task-client.cjs').createTaskClient({pluginRoot:worker,discoverTools:async()=>({ffmpeg:tools.ffmpeg,ffprobe:tools.ffprobe}),onFailure:e=>{record.ownerError={code:e.code,message:e.message};}});
  info=await client.media.prepare({id:'e38-read-only',filePath:source,ext:'mp4'},{playbackBackend:manifest.config.backend,previewQuality:quality,signal:controller.signal});
  if(fixed&&manifest.config.backend==='proxy'){const started=Date.now();while(client.cache.backgroundStatus(info)?.stage!=='complete'){const stage=client.cache.backgroundStatus(info)?.stage;if(controller.signal.aborted||Date.now()-started>300000||['error','budget'].includes(stage))throw Error('代理未能在本轮准备预算内全部就绪');await new Promise(r=>setTimeout(r,200));}manifest.preparationMs=Date.now()-started;}
  result=await require('../tests/support/performance-browser.cjs').check({root,scratch,client,info,fixed,ramBytes,chrome:args.includes('--chrome')?value('--chrome'):'C:/Program Files/Google/Chrome/Application/chrome.exe',signal:controller.signal});
  if(fixed){manifest.benchmark={version:'isolated-ready-v2',verified:!!result.cacheStart,preparation:'new-owned-cache then complete proxy then fixed warmup'};manifest.conditions={osCache:'unknown; not cleared',applicationCache:'new owned cache, fixed warmup',proxyAtStart:false,initialCache:result.cacheStart?api.hash(result.cacheStart):null};}
  manifest.status=result.status;manifest.error=result.error;manifest.source=result.source;manifest.protocol=result.protocol?.protocol||require('../plugin/performance-runner.cjs').DEFAULTS;
  manifest.environment.browser=result.browser;manifest.environment.actualDecoder=result.decoder?{codec:result.decoder.codec,hardwarePreference:result.decoder.hardwarePreference,hardwareVerified:false}:null;
  record.overhead=result.overhead;record.geometry=result.geometry;fs.copyFileSync(path.join(scratch,'monitor.png'),path.join(evidence,'monitor-'+runId+'.png'));
  manifest.monitorOverheadComparison=result.overhead.map(x=>({enabled:x.enabled,...require('../plugin/performance-core.cjs').distribution(x.times),collector:x.collector}));
 }catch(e){manifest.status=controller.signal.aborted?'timeout':'failed';manifest.error=e.message;record.error=e.stack;}
 finally{clearTimeout(deadline);clearInterval(diskWatch);try{if(info)await client.cache.release(info);if(client)await client.close();safe=true;}catch(e){record.cleanupError=e.message;manifest.status='failed';}}
 const fallback=createCollector();fallback.end('failed');
 let saved=null;try{saved=await api.save(base,manifest,result?.data||fallback.snapshot(),await api.previous(base,manifest));await api.index(base);await require('./performance.cjs').status(saved.dir);}
 catch(e){record.discarded=true;record.reportError=e.message;manifest.status='failed';}
 record.status=manifest.status;record.report=saved?.dir||null;record.sourceUnchanged=fs.existsSync(source)&&api.hash(fs.readFileSync(source))===record.sourceHash;
 // Exact identity/hash receipt before deleting this run's own generated files only.
 if(safe){const files=[],dirs=[];const walk=dir=>{assert(path.resolve(dir).startsWith(path.resolve(scratch)+path.sep)||dir===scratch);const st=fs.lstatSync(dir);assert(st.isDirectory()&&!st.isSymbolicLink());for(const n of fs.readdirSync(dir)){const p=path.join(dir,n),s=fs.lstatSync(p);assert(!s.isSymbolicLink());if(s.isDirectory())walk(p);else files.push({path:p,bytes:s.size,dev:String(s.dev),ino:String(s.ino),sha256:crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')});}dirs.push(dir);};
  walk(scratch);record.generatedBytes=files.reduce((n,f)=>n+f.bytes,0);assert(record.generatedBytes<=512*1024**2,'E38生成物超限，保留待查');record.cleanup=files.map(f=>({...f,path:path.relative(evidence,f.path)}));fs.writeFileSync(receipt,JSON.stringify(record,null,2));
  for(const f of files){const s=fs.lstatSync(f.path);assert(!s.isSymbolicLink()&&String(s.dev)===f.dev&&String(s.ino)===f.ino&&s.size===f.bytes&&crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex')===f.sha256);fs.unlinkSync(f.path);}for(const dir of dirs)fs.rmdirSync(dir);record.cleaned=true;
 }
 fs.writeFileSync(receipt,JSON.stringify(record,null,2));console.log(JSON.stringify({status:record.status,report:record.report,sourceUnchanged:record.sourceUnchanged,cleaned:record.cleaned}));if(record.status!=='completed')process.exitCode=1;
}
module.exports={main};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
