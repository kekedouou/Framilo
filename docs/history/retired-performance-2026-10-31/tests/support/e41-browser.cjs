'use strict';
// Real Chrome + shipped Player/QuickPreview + native guarded media task.
// A loopback adapter replaces Eagle only. Results never claim Eagle acceptance.
const fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function check({worker,scratch,client,info,source,targets,signal,before=false}){
 const scripts={};
 for(const [file,name]of [['frame-index.cjs','FrameIndex'],['performance-core.cjs','PerfCore']])scripts['/'+file]=`{const module={exports:{}};${fs.readFileSync(path.join(worker,file),'utf8')};window.${name}=module.exports;}`;
 for(const f of ['player.js','proxy-decoder.js','quick-preview.js'])scripts['/'+f]=fs.readFileSync(path.join(worker,f),'utf8');
 const sockets=new Set(),sourceBytes=fs.statSync(source).size,reads=[];
 const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://localhost');res.setHeader('cache-control','no-store');
  if(scripts[u.pathname]){res.setHeader('content-type','text/javascript');return res.end(scripts[u.pathname]);}
  if(u.pathname==='/'){res.setHeader('content-type','text/html');return res.end('<!doctype html><style>body{margin:0;background:#000}.screen{position:relative;width:1280px;height:720px}canvas{width:100%;height:100%}</style><div class="screen"><canvas></canvas></div>'+Object.keys(scripts).map(s=>`<script src="${s}"></script>`).join(''));}
  if(u.pathname==='/source'){
   res.setHeader('content-type','video/mp4');res.setHeader('accept-ranges','bytes');
   const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');let start=0,end=sourceBytes-1;
   if(range){start=Number(range[1]);end=Math.min(end,range[2]?Number(range[2]):end);if(start>end){res.statusCode=416;return res.end();}res.statusCode=206;res.setHeader('content-range',`bytes ${start}-${end}/${sourceBytes}`);}
   res.setHeader('content-length',end-start+1);const stream=fs.createReadStream(source,{start,end});res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());return stream.pipe(res);
  }
  if(u.pathname==='/info')return res.end(JSON.stringify({...info,audio:null}));
  if(u.pathname==='/target'){client.cache.target(info,Number(u.searchParams.get('time')));return res.end('ok');}
  if(u.pathname==='/ready')return res.end(JSON.stringify({ready:client.cache.isFrameReady(info,Number(u.searchParams.get('ordinal'))),ranges:client.cache.backgroundStatus(info)?.readyRanges||[]}));
  if(u.pathname==='/frame'){
   const trace=[],start=performance.now(),bytes=await client.cache.readAsset(info,u.searchParams.get('file'),(phase,a,b,begin)=>{if(trace.length<40)trace.push({phase,ms:Number.isFinite(b)?b-a:null,begin:!!begin});});
   reads.push({file:u.searchParams.get('file'),ms:performance.now()-start,trace});return res.end(bytes);
  }
  res.statusCode=404;res.end();
 }catch(e){res.statusCode=500;res.end(String(e.code||e.message));}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);if(!chrome)throw Error('No installed Chromium');
 let child,ws,session,serial=0;const pending=new Map(),profile=path.join(scratch,'browser');
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},60000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const abort=()=>child?.kill();signal?.addEventListener('abort',abort,{once:true});
 try{
  child=spawn(chrome,['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--no-default-browser-check','--remote-debugging-port=0','--proxy-server=127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--user-data-dir='+profile,'--disk-cache-size=1048576','--window-size=1280,800','about:blank'],{windowsHide:true,stdio:'ignore'});
  child.on('error',()=>{});let port;
  for(let n=0;n<150&&!port;n++){if(signal?.aborted)throw Error('Cancelled');try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await wait(50);}}
  if(!port)throw Error('Chromium failed to start');ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
  const target=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  for(let n=0;n<150;n++){if(await evaluate('!!window.EVAQuickPreview'))break;await wait(30);}
  await evaluate(`(async()=>{
    window.info=await(await fetch('/info')).json();window.collector=null;window.quick=null;window.provisional=[];window.requestAt=0;
    window.player=new EVAPlayer.Player({canvas:document.querySelector('canvas'),frameIndex:FrameIndex,ramBytes:10*1024**3,experimentMode:'compressed-ram',forwardPredecode:true,
      createFrameDecoder:s=>EVAProxyDecoder.createProxyDecoder(s),readAsset:async(_,file)=>{const r=await fetch('/frame?file='+encodeURIComponent(file));if(!r.ok)throw Error(await r.text());return new Uint8Array(await r.arrayBuffer());},
      setMediaTarget:t=>fetch('/target?time='+t),emit:e=>collector?.observe(e),onChange:s=>{if(quick&&s.pendingTargets===0)quick.clear();}});
    player.performanceIdleHold=true;await player.load(info);player.observePerformance=true;
    quick=EVAQuickPreview.createQuickPreview({canvas:player.canvas,info,sourceUrl:location.origin+'/source',...player.auxiliaryBudget(),isCurrent:()=>player.snapshot().pendingTargets>0,
      onPerformance:e=>{provisional.push({ms:performance.now()-requestAt,time:e.time});collector?.observe(e);}});
    window.go=async(t,final=true)=>{const o=FrameIndex.frameAt(info.frames,t),prepared=await(await fetch('/ready?ordinal='+o)).json();provisional=[];requestAt=performance.now();
      const promise=player.seek(t,{final,kind:final?'release':'drag'});
      if(${before?'!final&&!prepared.ready':'true'}&&player.snapshot().pendingTargets)quick.request(t,{delayMs:${before?0:80},final,performanceIdentity:{requestId:player.requestId,epoch:player.epoch}});
      const result=await promise,ms=performance.now()-requestAt,actual=player.snapshot();return{target:t,ordinal:o,prepared,ms,preview:provisional.slice(),result:result.status,actual:{frameId:actual.frameId,time:actual.time},previewDisabled:quick.snapshot().disabled};};
  })()`);
  const cold=await evaluate(`(async()=>{collector=PerfCore.createCollector();const rows=[];for(const t of ${JSON.stringify(targets)})rows.push(await go(t));collector.end();const data=collector.snapshot();collector=null;return{rows,data};})()`);
  const drag=await evaluate(`(async()=>{collector=PerfCore.createCollector();provisional=[];requestAt=performance.now();const input=[],jobs=[];
    for(let n=0;n<24;n++){const t=190+n*.16;input.push({ms:performance.now()-requestAt,target:t});jobs.push(player.seek(t,{final:false,kind:'drag'}));
      quick.request(t,{delayMs:${before?0:80},performanceIdentity:{requestId:player.requestId,epoch:player.epoch}});await new Promise(r=>setTimeout(r,32));}
    const releaseAt=performance.now()-requestAt,t=193.68,promise=player.seek(t,{final:true,kind:'release'});
    ${before?'':"quick.request(t,{delayMs:80,final:true,performanceIdentity:{requestId:player.requestId,epoch:player.epoch}});"}
    const result=await promise;await Promise.all(jobs);collector.end();const data=collector.snapshot();collector=null;return{input,releaseAt,exactAt:performance.now()-requestAt,preview:provisional.slice(),actual:player.snapshot().time,result:result.status,data};})()`);
  // Reconstruct the Player to get genuinely empty RAM while retaining disk leases.
  const disk=await evaluate(`(async()=>{await quick.close();quick=null;await player.load(info);player.performanceIdleHold=true;const rows=[];for(const t of ${JSON.stringify(targets)}){const start=performance.now(),result=await player.seek(t,{final:true});rows.push({target:t,ms:performance.now()-start,result:result.status});}return rows;})()`);
  const hot=await evaluate(`(async()=>{const rows=[];for(let n=0;n<3;n++)for(const t of ${JSON.stringify(targets)}){const start=performance.now(),result=await player.seek(t,{final:true});rows.push({target:t,ms:performance.now()-start,result:result.status});}return rows;})()`);
  const decoder=await evaluate('player.snapshot().frameDecoder'),browser=await evaluate('navigator.userAgent');
  const metrics=await call('SystemInfo.getInfo',{},null);
  await evaluate('player.dispose()');await Promise.race([call('Browser.close',{},null).catch(()=>{}),wait(1000)]);await wait(300);
  return {cold,drag,disk,hot,decoder,browser,reads,gpu:metrics.gpu?.devices,scope:'independent Chromium software canvas submission; no Eagle host/audio acceptance; idle RAM fill held'};
 }finally{
  signal?.removeEventListener('abort',abort);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('browser ended'));}pending.clear();ws?.close();
  if(child&&child.exitCode===null){child.kill();await wait(400);}for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));
 }
}
module.exports={check};
