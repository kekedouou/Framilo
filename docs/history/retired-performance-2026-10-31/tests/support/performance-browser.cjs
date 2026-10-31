'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),{spawn}=require('child_process');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function check({root,scratch,client,info,chrome,signal,fixed=false,ramBytes=512*1024**2}){
 const scripts={};
 for(const [file,name]of [['frame-index.cjs','FrameIndex'],['performance-core.cjs','PerfCore'],['performance-runner.cjs','PerfRunner'],['performance-explainer.cjs','PerfExplain']])scripts['/'+file]=`{const module={exports:{}};${fs.readFileSync(path.join(root,'plugin',file),'utf8')};window.${name}=module.exports;}`;
 for(const file of ['player.js','proxy-decoder.js','performance-view.js'])scripts['/'+file]=fs.readFileSync(path.join(root,'plugin',file));
 scripts['/performance-settle.js']='window.settlePerformanceCache='+require('../../plugin/performance-protocol.cjs').settleCache.toString()+';';
 const sockets=new Set(),server=http.createServer(async(req,res)=>{try{
   const u=new URL(req.url,'http://localhost');res.setHeader('cache-control','no-store');
   if(scripts[u.pathname]){res.setHeader('content-type','text/javascript');return res.end(scripts[u.pathname]);}
   if(u.pathname==='/'){res.setHeader('content-type','text/html');return res.end('<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#000;color:#a8cbe1;font:16px Segoe UI}canvas{width:100%;height:80vh;object-fit:contain}button{padding:10px}</style><link rel="stylesheet" href="/style"><button id="performanceMonitor">性能监测</button><canvas></canvas>'+Object.keys(scripts).map(s=>`<script src="${s}"></script>`).join(''));}
   if(u.pathname==='/style'){res.setHeader('content-type','text/css');return res.end(fs.readFileSync(path.join(root,'plugin/performance.css')));}
   if(u.pathname==='/info')return res.end(JSON.stringify({...info,audio:null}));
   if(u.pathname==='/frame')return res.end(await client.cache.readAsset(info,u.searchParams.get('file')));
   if(u.pathname==='/target'){client.cache.target(info,Number(u.searchParams.get('time')));return res.end('ok');}
   if(u.pathname==='/resource')return res.end(JSON.stringify(client.cache.backgroundStatus(info)));
   res.statusCode=404;res.end();
 }catch(e){res.statusCode=500;res.end(String(e.code||'FAILED'));}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=path.join(scratch,'browser');let child,ws,session,serial=0;const pending=new Map();
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},210000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));});
 const aborted=()=>{child?.kill();};signal?.addEventListener('abort',aborted,{once:true});
 try{
   child=spawn(chrome,['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--no-default-browser-check','--remote-debugging-port=0','--proxy-server=127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--user-data-dir='+profile,'--disk-cache-size=1048576','--window-size=1280,800','about:blank'],{windowsHide:true,stdio:'ignore'});
   child.on('error',()=>{});let port;
   for(let n=0;n<150&&!port;n++){if(signal?.aborted)throw Error('cancelled');try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await wait(50);}}
   if(!port)throw Error('Chrome未启动');ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
   ws.onmessage=e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
   const target=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
   await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
   const evaluate=async expression=>{const v=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;};
   for(let n=0;n<100;n++){if(await evaluate('!!window.PerfRunner'))break;await wait(30);}
   await evaluate(`(async()=>{window.info=await(await fetch('/info')).json();window.collector=null;window.background=null;
    window.player=new EVAPlayer.Player({canvas:document.querySelector('canvas'),frameIndex:FrameIndex,ramBytes:${ramBytes},experimentMode:'compressed-ram',forwardPredecode:true,
     createFrameDecoder:s=>EVAProxyDecoder.createProxyDecoder(s),
     readAsset:async(_,file)=>{const r=await fetch('/frame?file='+encodeURIComponent(file));if(!r.ok)throw Error(await r.text());return new Uint8Array(await r.arrayBuffer());},
     setMediaTarget:t=>fetch('/target?time='+t),emit:e=>collector?.observe(e)});await player.load(info);
    window.source={sha256:info.source.sha256,codec:info.source.codec,width:info.source.width,height:info.source.height,duration:info.duration,frames:info.frames.length,bitDepth:'unknown'};
   })()`);
   const result=await evaluate(`(async()=>{
    window.cacheStart=null;if(${fixed}){const warm=PerfCore.createCollector();warm.pause();await PerfRunner.run({seek:(t,o)=>player.seek(t,o),pause:()=>player.pause(),context:()=>({source}),collector:warm,options:{repeats:1}});cacheStart=await settlePerformanceCache({capture:()=>({decoded:[...player.cache.keys()],compressed:[...player.compressed.keys()],pending:player.tasks.size+player.loads.size+(player.target?.resolve?1:0)})});}
    collector=PerfCore.createCollector();player.observeCanvas=player.observePerformance=true;
    background=await(await fetch('/resource')).json();collector.sample({backend:info.videoEncoding?'proxy':'jpeg',managedBytes:player.snapshot().cacheBytes,cachedFrames:player.cache.size,generating:background?.stage==='preparing',prepared:background?.ready});
    const sample=setInterval(async()=>{const s=player.snapshot();try{background=await(await fetch('/resource')).json();}catch(_){}collector.sample({backend:info.videoEncoding?'proxy':'jpeg',managedBytes:s.cacheBytes,cachedFrames:player.cache.size,generating:background?.stage==='preparing',prepared:background?.ready});},333);
    let status='completed',error=null,protocol=null;
    try{protocol=await PerfRunner.run({seek:(t,o)=>player.seek(t,o),pause:()=>player.pause(),context:()=>({source}),collector});}catch(e){status=e.code==='TIMEOUT'?'timeout':'failed';error=e.message;}
    clearInterval(sample);collector.end(status);const data=collector.snapshot();collector=null;player.observeCanvas=player.observePerformance=false;
    const overhead=[];await player.seek(.2,{final:true});
    for(const enabled of [false,true,false,true]){const c=enabled?PerfCore.createCollector():null;collector=c;player.observeCanvas=player.observePerformance=enabled;const times=[];for(let i=0;i<60;i++){const start=performance.now();await player.seek(.2,{final:true});times.push(performance.now()-start);}overhead.push({enabled,times,collector:c?.snapshot().overhead});}
    collector=null;player.observeCanvas=false;
    return {status,error,data,protocol,source,cacheStart,browser:navigator.userAgent,decoder:player.snapshot().frameDecoder,overhead};
   })()`);
   // The same shipped view renders actual captured metrics. Controls tested separately.
   await evaluate(`window.sampleData=${JSON.stringify(result.data)};window.viewHandle=EVAPerformanceView.create({createMonitor:draw=>{const v={state:'review',data:sampleData,metrics:PerfCore.metrics(sampleData),explanation:PerfExplain.explain(sampleData,{},performance.now()),source:Math.round(source.duration)+'秒视频',last:{runId:'本轮独立浏览器实测'},outputRoot:'本地报告'};return{view:()=>v,enable:()=>draw(v),disable:async()=>{},destroy:async()=>{}}},openReport:()=>{}});document.getElementById('performanceMonitor').click();`);
   const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(scratch,'monitor.png'),Buffer.from(shot.data,'base64'));
   result.geometry=await evaluate(`(()=>{const p=document.querySelector('.performance-panel'),r=p.getBoundingClientRect();return{width:r.width,height:r.height,visible:r.top>=0&&r.bottom<=innerHeight,buttons:p.querySelectorAll('button').length};})()`);
   await evaluate('player.dispose()');await call('Browser.close',{},null);await wait(300);return result;
 }finally{signal?.removeEventListener('abort',aborted);for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('browser ended'));}pending.clear();ws?.close();if(child&&child.exitCode===null)child.kill();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
}
module.exports={check};
