'use strict';
// Explicit E41 read-only source / owned scratch experiment. No shared cache edits.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const repo=path.resolve(__dirname,'..'),base=path.join(repo,'verification-runs/e41');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function main(){
 const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],variant=get('--variant'),source=path.resolve(get('--source')||'');
 assert(['before','cpu','gpu'].includes(variant)&&args.includes('--source')&&args.includes('--tools'),'Explicit --variant before|cpu|gpu --source --tools required');
 const tools=JSON.parse(fs.readFileSync(path.resolve(get('--tools')))),sourceHash=hash(fs.readFileSync(source));
 assert.equal(sourceHash,'c6e025b647bf733411779212b8a99580b5bfc012a14c8e974720234877513f8f','Only the approved source');
 const browser=args.includes('--browser');const pilot=args.includes('--pilot');const label=args.includes('--label')?get('--label'):'';assert(/^[a-z0-9-]{0,32}$/.test(label));const suffix=(pilot?'-pilot':'')+(label?'-'+label:'');const output=path.join(base,(browser?'browser-':'media-')+variant+suffix+'.json');assert(!fs.existsSync(output),'Never overwrite an experiment');
 const rounds=pilot?1:args.includes('--rounds')?Number(get('--rounds')):3;assert(Number.isSafeInteger(rounds)&&rounds>=1&&rounds<=3);
 let priorBytes=0;for(const name of fs.readdirSync(base).filter(n=>/^(media|browser)-.*\.json$/.test(n))){const prior=JSON.parse(fs.readFileSync(path.join(base,name)));priorBytes+=(prior.cleanup||[]).reduce((n,r)=>n+r.bytes,0);}
 assert(priorBytes<2*1024**3,'Cumulative E41 scratch budget exhausted');
 const record={variant,at:new Date().toISOString(),sourceHash,status:'running',priorGeneratedBytes:priorBytes,scope:browser?'Windows guard / formal media and Player in independent Chromium; no Eagle acceptance':'Windows guard / formal media and cache; ends at compressed frame bytes, not displayed picture',rounds:[],cleanup:[]};
 fs.writeFileSync(output,JSON.stringify(record,null,2));
 for(let round=0;round<rounds;round++){
  const scratch=path.join(base,(browser?'browser-':'media-')+variant+suffix+'-'+round);fs.mkdirSync(scratch);const worker=path.join(scratch,'plugin');fs.mkdirSync(worker);
  for(const f of require('./package-release.cjs').RUNTIME){const original=variant==='before'&&fs.existsSync(path.join(base,'source-before',f))?path.join(base,'source-before',f):path.join(repo,'plugin',f),to=path.join(worker,f);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(original,to,fs.constants.COPYFILE_EXCL);}
  const row={round,targets:[]};record.rounds.push(row);const controller=new AbortController();let client,info,safe=false;
  const deadline=setTimeout(()=>controller.abort(),600000);const diskWatch=setInterval(()=>{let total=0;function size(at){for(const e of fs.readdirSync(at,{withFileTypes:true})){const f=path.join(at,e.name);if(e.isDirectory())size(f);else total+=fs.statSync(f).size;}}try{size(scratch);if(priorBytes+total>1.98*1024**3){row.budgetExceeded=true;controller.abort();client?.close().catch(()=>{});}}catch(_){}},1000);const began=performance.now();
  try{
   client=require(path.join(worker,'task-client.cjs')).createTaskClient({pluginRoot:worker,discoverTools:async()=>tools,onFailure:e=>{row.ownerError={code:e.code,message:e.message};}});
   info=await client.media.prepare({id:'e41-read-only',filePath:source,ext:'mp4'},{playbackBackend:'proxy',proxyEncoder:variant==='gpu'?'nvidia':'cpu',previewQuality:'720p',signal:controller.signal});
   row.prepareMs=performance.now()-began;row.source={codec:info.source.codec,width:info.source.width,height:info.source.height,frames:info.frames.length,duration:info.duration};row.videoEncoding=info.videoEncoding;
   if(browser)row.browser=await require('../tests/support/e41-browser.cjs').check({worker,scratch,client,info,source,targets:pilot?[84.6]:[84.6,257.2,28.4,303.4,158.8,328.4],signal:controller.signal,before:variant==='before'});
   else {
   for(const target of (pilot?[84.6]:[84.6,257.2,28.4,303.4,158.8,328.4])){
    assert(!controller.signal.aborted,'experiment deadline');const ordinal=info.frames.findIndex(f=>f.time<=target&&f.end>target);assert(ordinal>=0);
    const frame=info.frames[ordinal],ready=client.cache.isFrameReady(info,ordinal),trace=[];client.cache.target(info,target);const start=performance.now();
    const bytes=await client.cache.readAsset(info,frame.file,(phase,from,to,begin)=>{if(trace.length<60)trace.push({phase,ms:Number.isFinite(to)?to-from:null,begin:!!begin});});
    const elapsed=performance.now()-start;require(path.join(worker,'proxy-decoder.js')).annexB(bytes);
    row.targets.push({target,ordinal,alreadyPrepared:ready,ms:elapsed,frameBytes:bytes.byteLength,trace});fs.writeFileSync(output,JSON.stringify(record,null,2));
   }
   }
   if(browser&&!pilot&&round===0&&variant!=='before')row.quality=await require('../tests/support/e41-quality.cjs').check({client,info,source,ffmpeg:tools.ffmpeg,variant,output:path.join(base,'quality')});
   row.production=[];const cacheRoot=path.join(worker,'cache');for(const name of fs.readdirSync(cacheRoot))if(name.startsWith('media-')){const f=path.join(cacheRoot,name,'manifest.json');if(fs.existsSync(f)){const m=JSON.parse(fs.readFileSync(f));row.production.push({metrics:m.metrics,bytes:m.framePack?.bytes,frames:m.frames.length,duration:m.frames.at(-1).end});}}
  }catch(e){row.error={message:e.message,code:e.code};record.status='failed';fs.writeFileSync(output,JSON.stringify(record,null,2));}finally{clearInterval(diskWatch);clearTimeout(deadline);try{if(info)await client.cache.release(info);if(client)await client.close();safe=true;}catch(e){row.closeError=e.message;}}
  assert(safe&&!row.ownerError,'owner and resource close must succeed');
  const files=[],dirs=[];function walk(dir){assert(dir===scratch||dir.startsWith(scratch+path.sep));const d=fs.lstatSync(dir);assert(d.isDirectory()&&!d.isSymbolicLink());for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),st=fs.lstatSync(file);assert(!st.isSymbolicLink());if(st.isDirectory())walk(file);else files.push({file,bytes:st.size,ino:st.ino,dev:st.dev,sha256:hash(fs.readFileSync(file))});}dirs.push(dir);}walk(scratch);
  const bytes=files.reduce((n,f)=>n+f.bytes,0);priorBytes+=bytes;assert(priorBytes<2*1024**3,'E41 cumulative disk budget');row.generatedBytes=bytes;record.cleanup.push({round,files:files.map(f=>({path:path.relative(base,f.file),bytes:f.bytes,sha256:f.sha256})),bytes});fs.writeFileSync(output,JSON.stringify(record,null,2));
  for(const f of files){const st=fs.lstatSync(f.file);assert(!st.isSymbolicLink()&&st.ino===f.ino&&st.dev===f.dev&&st.size===f.bytes&&hash(fs.readFileSync(f.file))===f.sha256);fs.unlinkSync(f.file);}for(const d of dirs)fs.rmdirSync(d);
  row.cleaned=true;fs.writeFileSync(output,JSON.stringify(record,null,2));if(row.error)throw Error(row.error.message);console.log(JSON.stringify({variant,round,prepareMs:row.prepareMs,targets:row.targets.map(t=>({target:t.target,ms:t.ms,ready:t.alreadyPrepared}))}));
 }
 assert.equal(hash(fs.readFileSync(source)),sourceHash);record.status='completed';fs.writeFileSync(output,JSON.stringify(record,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
