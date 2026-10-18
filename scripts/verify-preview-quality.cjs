'use strict';
// Explicit, bounded local regression. No Eagle UI, real assets or formal cache.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..'), sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const profiles=require('../plugin/preview-profile.cjs'),{_test:media}=require('../plugin/media.cjs');
const {createCache}=require('../plugin/cache.cjs'),{createMemoryPreferences}=require('../plugin/preferences.cjs');
const MIB=1024**2, recordRoot=path.join(root,'verification-runs/e03-local');
function plain(file,dir=false){const s=fs.lstatSync(file);assert(!s.isSymbolicLink()&&(dir?s.isDirectory():s.isFile()&&s.nlink===1));assert.equal(fs.realpathSync(file).toLowerCase(),path.resolve(file).toLowerCase());return s;}
function recordPreflight(){
  plain(path.dirname(recordRoot),true);
  if(!fs.existsSync(recordRoot)){fs.mkdirSync(recordRoot);fs.writeFileSync(path.join(recordRoot,'owner.json'),JSON.stringify({owner:'eva-e03-local-v1'}),{flag:'wx'});}
  plain(recordRoot,true);plain(path.join(recordRoot,'owner.json'));assert.equal(JSON.parse(fs.readFileSync(path.join(recordRoot,'owner.json'))).owner,'eva-e03-local-v1');
  const names=fs.readdirSync(recordRoot);assert(names.every(n=>n==='owner.json'||/^run-[0-9a-f]{16}\.json$/.test(n)));
  assert(names.length<=8,'Local verification record slots exhausted; retain existing records.');
  assert(names.reduce((n,f)=>n+plain(path.join(recordRoot,f)).size,0)+65536<=512*1024);
}
function tool(file,args,input){plain(file);const r=spawnSync(file,args,{input,encoding:null,windowsHide:true,timeout:30000,maxBuffer:8*MIB});
  if(r.error||r.status!==0)throw Error('Existing media tool failed: '+String(r.error||r.stderr).slice(-1200));return r.stdout;}
async function main(){
  recordPreflight();const config=JSON.parse(fs.readFileSync(path.join(root,'prototypes/preview-quality/config.local.json'),'utf8'));
  const token=crypto.randomBytes(8).toString('hex'),parent=path.join(root,'tests/preview-quality-scratch');
  if(!fs.existsSync(parent))fs.mkdirSync(parent);plain(parent,true);
  const scratch=path.join(parent,'run-'+token+' 中文 空格');fs.mkdirSync(scratch);fs.writeFileSync(path.join(scratch,'owner.json'),JSON.stringify({owner:'eva-e03-local-v1',token}),{flag:'wx'});
  const report={schema:'eva-e03-local-v1',node:process.versions.node,electron:process.versions.electron||null,frames:[],checks:[],limitBytes:2*MIB};
  report.runtimeSources=Object.fromEntries(['preview-profile.cjs','media.cjs','cache.cjs','preferences.cjs','session.cjs','task-client.cjs','task-worker.cjs','ui.js','index.html']
    .map(n=>[n,sha(fs.readFileSync(path.join(root,'plugin',n)))]));
  let generated=0;const images=new Map();
  for(const [w,h,q,sar]of [[1920,1080,'720p'],[1920,1080,'1080p'],[1080,1920,'720p'],[640,360,'1080p'],[1919,1079,'1080p'],[720,576,'720p','16:15']]){
    const video={width:w,height:h,color_space:'bt709',color_range:'tv',sample_aspect_ratio:sar||'1:1'},preview=profiles.dimensions(video,q);
    const args=media.ffmpegArgs('unused',false,'h264',video,preview),out=args.slice(args.indexOf('-map'));out.splice(out.indexOf('-fps_mode'),0,'-frames:v','1');
    const jpeg=tool(config.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i',`testsrc=size=${w}x${h}:rate=1,setsar=${(sar||'1:1').replace(':','/')}`,...out]);
    generated+=jpeg.length;assert(generated<=8*MIB);const probe=JSON.parse(tool(config.ffprobe,['-v','error','-show_entries','stream=width,height','-of','json','pipe:0'],jpeg));
    assert.equal(probe.streams[0].width,preview.width);assert.equal(probe.streams[0].height,preview.height);
    report.frames.push({source:[w,h],quality:q,actual:[preview.width,preview.height],sar:sar||'1:1',bytes:jpeg.length,sha256:sha(jpeg)});
    if(w===1920&&h===1080)images.set(q,jpeg);
  }
  const content='a'.repeat(64),source={sha256:content,codec:'h264',width:1920,height:1080,hasAudioStream:false,itemId:'local-only',filePath:path.join(scratch,'not-a-real-source.mp4')};
  const make=()=>createCache({pluginRoot:scratch,diskBytes:2*MIB});let cache=make();
  for(const q of profiles.QUALITIES){const tx=cache.begin({sourceSha256:content,previewQuality:q});const a=await tx.writeAsset('0.jpg',images.get(q));const preview=profiles.dimensions(source,q);
    const info=await tx.finish({source,preview,width:preview.width,height:preview.height,duration:1/24,frames:[{...a,id:0,ptsTicks:'0',timeBase:[1,24],time:0,end:1/24}],audio:null},source);
    tx.close();await cache.release(info);}
  cache=make();assert.equal(cache.inventory().caches.length,2);
  for(const q of profiles.QUALITIES){const tx=cache.begin({sourceSha256:content,previewQuality:q}),manifest=await tx.readComplete();assert.equal(manifest.preview.quality,q);
    const info=await tx.finish(manifest,source);tx.close();assert((await cache.readAsset(info,'0.jpg')).equals(images.get(q)));await cache.release(info);}
  assert.equal((await cache.clearOther({sourceSha256:content})).cleared,0);
  const cancel=cache.begin({sourceSha256:content,previewQuality:'1080p'});await cancel.writeAsset('cancel.jpg',Buffer.from('cancelled'));await cancel.abort();cancel.close();
  assert.equal(make().inventory().caches.length,2);report.checks.push('Windows dual-quality publish/reopen/read/release/clear-current/cancel/reopen');
  let prefs=createMemoryPreferences({pluginRoot:scratch,totalRamBytes:16*1024**3});assert.equal(prefs.quality(),'720p');prefs.save(1024,'1080p');
  prefs=createMemoryPreferences({pluginRoot:scratch,totalRamBytes:16*1024**3});assert.equal(prefs.quality(),'1080p');prefs.save(2048);assert.equal(createMemoryPreferences({pluginRoot:scratch,totalRamBytes:16*1024**3}).quality(),'1080p');
  report.checks.push('Windows atomic settings persist/reopen/retain quality on RAM change');
  if(process.argv.includes('--with-worker')){
    assert(process.versions.node.startsWith('16.'),'Run the worker regression with Eagle Node16.');
    const workerRoot=path.join(scratch,'worker');fs.mkdirSync(workerRoot);fs.mkdirSync(path.join(workerRoot,'native'));
    for(const n of ['media.cjs','cache.cjs','preview-profile.cjs','frame-index.cjs','frame-pack.cjs','process-identity.cjs','task-worker.cjs',
      'native/task-host.cs','native/task-host.local.exe','native/task-host.local.json']){
      const b=fs.readFileSync(path.join(root,'plugin',n));assert(b.length<256*1024);fs.writeFileSync(path.join(workerRoot,n),b,{flag:'wx'});
    }
    const file=path.join(scratch,'fixture.mp4');
    tool(config.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-n','-f','lavfi','-i','testsrc=size=1920x1080:rate=24',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.083333','-frames:v','2','-c:v','libx264','-preset','ultrafast',
      '-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-fs',String(MIB),file]);
    assert(plain(file).size<=MIB);const sourceHash=sha(fs.readFileSync(file));
    const selected={id:'e03-local-synthetic',filePath:file,name:'local fixture',ext:'mp4'};
    const {createTaskClient}=require('../plugin/task-client.cjs');
    for(const mode of ['720p','1080p','cancel','1080p']){
      const client=createTaskClient({pluginRoot:workerRoot,discoverTools:async()=>({ffmpeg:config.ffmpeg,ffprobe:config.ffprobe})}),controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),30000);
      try{
        const operation=client.media.prepare(selected,{previewQuality:mode==='cancel'?'720p':mode,signal:controller.signal,
          onProgress:value=>{if(mode==='cancel'&&value.stage==='analyze')controller.abort();}});
        if(mode==='cancel')await assert.rejects(()=>operation,e=>e.code==='MEDIA_CANCELLED'||e.name==='AbortError');
        else{const info=await operation;assert.equal(info.preview.quality,mode);assert.equal(info.frames.length,2);assert(info.audio);
          assert.equal(info.width,mode==='1080p'?1920:1280);assert((await client.cache.readAsset(info,info.frames[0].file)).length>0);
          await client.cache.release(info);}
      }finally{clearTimeout(timeout);await client.close();assert(client.stopped);}
    }
    assert.equal(sha(fs.readFileSync(file)),sourceHash);assert(!fs.existsSync(path.join(workerRoot,'cache/writer.lock')));
    report.checks.push('Real Windows guard/worker IPC: both qualities and audio, close/reopen, prepare cancellation, completed-cache reuse; original fixture hash unchanged');
  }
  const leaves=[],dirs=[];function scan(dir){plain(dir,true);dirs.push(dir);for(const n of fs.readdirSync(dir)){const file=path.join(dir,n),s=fs.lstatSync(file);assert(!s.isSymbolicLink());if(s.isDirectory())scan(file);else{plain(file);leaves.push({file,bytes:s.size,sha256:sha(fs.readFileSync(file)),dev:s.dev,ino:s.ino});}}}scan(scratch);
  report.scratchBytes=leaves.reduce((n,f)=>n+f.bytes,0);assert(report.scratchBytes<=2*MIB);
  assert.equal(JSON.parse(fs.readFileSync(path.join(scratch,'owner.json'))).token,token);
  for(const f of leaves){const s=plain(f.file);assert.equal(s.dev,f.dev);assert.equal(s.ino,f.ino);assert.equal(s.size,f.bytes);assert.equal(sha(fs.readFileSync(f.file)),f.sha256);}
  report.cleanup={state:'planned-before-deletion',files:leaves.length,bytes:report.scratchBytes,inventorySha256:sha(Buffer.from(JSON.stringify(leaves.map(f=>({file:path.relative(scratch,f.file),bytes:f.bytes,sha256:f.sha256})))))};
  report.scope='Local FFmpeg single frames and Windows filesystem only; not Eagle UI, performance or long stability.';
  // Save the cleanup inventory before removing only freshly owned test output.
  report.cleanup.inventory=leaves.map(f=>({file:path.relative(scratch,f.file),bytes:f.bytes,sha256:f.sha256}));
  const output=path.join(recordRoot,'run-'+token+'.json'),bytes=Buffer.from(JSON.stringify(report,null,2));assert(bytes.length<=65536);fs.writeFileSync(output,bytes,{flag:'wx'});
  for(const f of leaves){const s=plain(f.file);assert.equal(s.ino,f.ino);assert.equal(s.dev,f.dev);assert.equal(sha(fs.readFileSync(f.file)),f.sha256);fs.unlinkSync(f.file);}
  for(const d of dirs.reverse()){plain(d,true);fs.rmdirSync(d);}console.log(JSON.stringify({record:path.relative(root,output),node:report.node,frames:report.frames,checks:report.checks,cleanedBytes:report.scratchBytes}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
