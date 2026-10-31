'use strict';
// Explicit fixed cold/ready/RAM experiment. No shared cache or baseline edits.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const repo=path.resolve(__dirname,'..'),base=path.join(repo,'verification-runs/e42');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function main(){
 const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],variant=get('--variant'),phase=get('--phase');
 if(variant==='all'){
  for(const name of ['cpu','gpu']){const next=args.slice();next[next.indexOf('--variant')+1]=name;
   const code=await new Promise((resolve,reject)=>{const child=require('child_process').spawn(process.execPath,[__filename,...next],{stdio:'inherit',windowsHide:true});child.on('error',reject);child.on('close',resolve);});assert.equal(code,0,'Automatic pair stopped after failed evidence');}
  return;
 }
 assert(['cpu','gpu'].includes(variant)&&['before','after'].includes(phase),'--phase before|after --variant cpu|gpu required');
 const profile=JSON.parse(fs.readFileSync(path.join(base,'profile.json'))),source=profile.source,tools=profile.tools,sourceHash=hash(fs.readFileSync(source));
 assert(profile.quality==='720p'&&profile.ramBytes===10*1024**3&&profile.rounds===2,'This fixed group requires 720p / 10GiB / two rounds; create a new protocol for different conditions');
 assert.equal(sourceHash,profile.sourceHash);for(const [k,p]of Object.entries(tools))assert.equal(hash(fs.readFileSync(p)),profile.toolHashes[k]);
 const label=args.includes('--label')?get('--label'):phase,suffix='-'+label,rounds=profile.rounds;
 assert(/^[a-z0-9-]{1,40}$/.test(label),'Invalid evidence label');
 const output=path.join(base,'browser-'+variant+suffix+'.json');assert(!fs.existsSync(output),'Never overwrite an experiment');
 let priorBytes=0;for(const name of fs.readdirSync(base).filter(n=>/^(media|browser)-.*\.json$/.test(n))){const prior=JSON.parse(fs.readFileSync(path.join(base,name)));priorBytes+=(prior.cleanup||[]).reduce((n,r)=>n+r.bytes,0);}
 assert(priorBytes<profile.limits.cumulativeBytes,'Cumulative scratch budget exhausted');
 const record={phase,label,protocol:profile.protocol,variant,at:new Date().toISOString(),sourceHash,toolHashes:profile.toolHashes,helperHash:hash(fs.readFileSync(path.join(repo,'tests/support/cold-browser.cjs'))),status:'running',priorGeneratedBytes:priorBytes,scope:'Windows guard / formal media and Player in independent Chromium; no Eagle acceptance',rounds:[],cleanup:[]};
 fs.writeFileSync(output,JSON.stringify(record,null,2));
 for(let round=0;round<rounds;round++){
  const scratch=path.join(base,'browser-'+variant+suffix+'-'+round);fs.mkdirSync(scratch);const worker=path.join(scratch,'plugin');fs.mkdirSync(worker);
  for(const f of require('./package-release.cjs').RUNTIME){const original=phase==='before'?path.join(base,'source-before',f):path.join(repo,'plugin',f),to=path.join(worker,f);assert(fs.existsSync(original),'Frozen runtime missing '+f);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(original,to,fs.constants.COPYFILE_EXCL);}
  const row={round,runtimeHash:hash(Buffer.from(require('./package-release.cjs').RUNTIME.map(f=>f+':'+hash(fs.readFileSync(path.join(worker,f)))).join('\n')))};record.rounds.push(row);const controller=new AbortController();let client,info,safe=false;
  const deadline=setTimeout(()=>controller.abort(),600000);const diskWatch=setInterval(()=>{let total=0;function size(at){for(const e of fs.readdirSync(at,{withFileTypes:true})){const f=path.join(at,e.name);if(e.isDirectory())size(f);else total+=fs.statSync(f).size;}}try{size(scratch);if(priorBytes+total>1.98*1024**3){row.budgetExceeded=true;controller.abort();client?.close().catch(()=>{});}}catch(_){}},1000);const began=performance.now();
  try{
   client=require(path.join(worker,'task-client.cjs')).createTaskClient({pluginRoot:worker,discoverTools:async()=>tools,onFailure:e=>{row.ownerError={code:e.code,message:e.message};}});
   info=await client.media.prepare({id:'e42-read-only',filePath:source,ext:'mp4'},{playbackBackend:'proxy',proxyEncoder:variant==='gpu'?'nvidia':'cpu',previewQuality:profile.quality,signal:controller.signal});
   row.prepareMs=performance.now()-began;row.source={codec:info.source.codec,width:info.source.width,height:info.source.height,frames:info.frames.length,duration:info.duration};row.videoEncoding=info.videoEncoding;
   row.browser=await require('../tests/support/cold-browser.cjs').check({worker,scratch,client,info,source,targets:profile.targets,dragStart:profile.dragStart,signal:controller.signal});
   row.production=[];const cacheRoot=path.join(worker,'cache');for(const name of fs.readdirSync(cacheRoot))if(name.startsWith('media-')){const f=path.join(cacheRoot,name,'manifest.json');if(fs.existsSync(f)){const m=JSON.parse(fs.readFileSync(f));row.production.push({metrics:m.metrics,bytes:m.framePack?.bytes,frames:m.frames.length,duration:m.frames.at(-1).end});}}
  }catch(e){row.error={message:e.message,code:e.code};record.status='failed';fs.writeFileSync(output,JSON.stringify(record,null,2));}finally{clearInterval(diskWatch);clearTimeout(deadline);try{const closeAt=performance.now();if(info)await client.cache.release(info);if(client)await client.close();row.cleanupMs=performance.now()-closeAt;safe=true;}catch(e){row.closeError=e.message;}}
  assert(safe&&!row.ownerError,'owner and resource close must succeed');
  const files=[],dirs=[];function walk(dir){assert(dir===scratch||dir.startsWith(scratch+path.sep));const d=fs.lstatSync(dir);assert(d.isDirectory()&&!d.isSymbolicLink());for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),st=fs.lstatSync(file);assert(!st.isSymbolicLink());if(st.isDirectory())walk(file);else files.push({file,bytes:st.size,ino:st.ino,dev:st.dev,sha256:hash(fs.readFileSync(file))});}dirs.push(dir);}walk(scratch);
  const bytes=files.reduce((n,f)=>n+f.bytes,0);priorBytes+=bytes;assert(priorBytes<profile.limits.cumulativeBytes,'Cumulative disk budget');row.generatedBytes=bytes;record.cleanup.push({round,files:files.map(f=>({path:path.relative(base,f.file),bytes:f.bytes,sha256:f.sha256})),bytes});fs.writeFileSync(output,JSON.stringify(record,null,2));
  for(const f of files){const st=fs.lstatSync(f.file);assert(!st.isSymbolicLink()&&st.ino===f.ino&&st.dev===f.dev&&st.size===f.bytes&&hash(fs.readFileSync(f.file))===f.sha256);fs.unlinkSync(f.file);}for(const d of dirs)fs.rmdirSync(d);
  row.cleaned=true;fs.writeFileSync(output,JSON.stringify(record,null,2));if(row.error)throw Error(row.error.message);console.log(JSON.stringify({variant,round,prepareMs:row.prepareMs,coldMs:row.browser.cold.rows.map(x=>Math.round(x.ms))}));
 }
 assert.equal(hash(fs.readFileSync(source)),sourceHash);record.status='completed';fs.writeFileSync(output,JSON.stringify(record,null,2));
 if(phase==='after'&&['cpu','gpu'].every(v=>fs.existsSync(path.join(base,'browser-'+v+suffix+'.json'))))
  await require('./report-cold-performance.cjs').main(label);
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
