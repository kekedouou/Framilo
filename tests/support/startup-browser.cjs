'use strict';
// Explicit synthetic-only lifecycle check. Independent Chrome, not Eagle UI.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert'),{spawn}=require('child_process');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function check({root,scratch,client,info}){
 const result={status:'running',eagle:false,cases:[],safeToClean:false};
 const scripts={'/player.js':fs.readFileSync(path.join(root,'plugin/player.js')),'/decoder.js':fs.readFileSync(path.join(root,'plugin/proxy-decoder.js'))};
 for(const [url,file,name] of [['/index.js','frame-index.cjs','FrameIndex'],['/audio.js','segment-audio.cjs','SegmentAudio']])scripts[url]=Buffer.from(`{const module={exports:{}};${fs.readFileSync(path.join(root,'plugin',file),'utf8')};window.${name}=module.exports;}`);
 const sockets=new Set(),server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');res.setHeader('cache-control','no-store');
  if(scripts[url.pathname]){res.setHeader('content-type','text/javascript');return res.end(scripts[url.pathname]);}
  if(url.pathname==='/'){res.setHeader('content-type','text/html');return res.end('<canvas id="screen"></canvas><script src="/index.js"></script><script src="/audio.js"></script><script src="/decoder.js"></script><script src="/player.js"></script>');}
  if(url.pathname==='/info')return res.end(JSON.stringify(info));
  if(url.pathname==='/frame')return res.end(await client.cache.readAsset(info,url.searchParams.get('file')));
  if(url.pathname==='/audio'){const value=await client.cache.readAudioSegment(info,Number(url.searchParams.get('n')));if(!value){res.statusCode=204;return res.end();}res.setHeader('x-start',String(value.start));return res.end(value.bytes);}
  if(url.pathname==='/target'){client.cache.target(info,Number(url.searchParams.get('t')));return res.end('ok');}
  if(url.pathname==='/prefetch'){client.cache.prefetch(info,Number(url.searchParams.get('t')),JSON.parse(url.searchParams.get('loop')||'null'));return res.end('ok');}
  if(url.pathname==='/cancel'){client.cache.cancelReads(info);return res.end('ok');}
  res.statusCode=404;res.end();
 }catch(e){res.statusCode=500;res.setHeader('x-error-code',e.code||'FAILED');res.end(e.message);}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const profile=path.join(scratch,'chrome'),chrome='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
 const child=spawn(chrome,['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--no-default-browser-check','--autoplay-policy=no-user-gesture-required','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--proxy-server=127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--user-data-dir='+profile,'--disk-cache-size=1048576','about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,TEMP:scratch,TMP:scratch}});
 let stderr='',ended=false,ws,session,serial=0;const requests=new Map();child.stderr.on('data',b=>stderr=(stderr+b.toString()).slice(-2048));
 const exited=new Promise(r=>{child.once('close',()=>{ended=true;r();});child.once('error',()=>{ended=true;r();});});
 const deadline=setTimeout(()=>child.kill(),60000);
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{requests.delete(id);reject(Error('CDP timeout '+method));},20000);requests.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));});
 try{
  let port;for(let n=0;n<200&&!port&&!ended;n++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await pause(50);}}
  assert(port,'Chrome failed '+stderr);ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  ws.addEventListener('message',event=>{const value=JSON.parse(event.data),entry=requests.get(value.id);if(!entry)return;requests.delete(value.id);clearTimeout(entry.timer);if(value.error)entry.reject(Error(JSON.stringify(value.error)));else entry.resolve(value.result);});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId,flatten:true},null)).sessionId;
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
  const evaluate=async expression=>{const v=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;};
  for(let n=0;n<100;n++){if(await evaluate('!!window.EVAPlayer'))break;await pause(30);}
  result.cases.push(await evaluate(`(async()=>{
   window.info=await (await fetch('/info')).json();window.errors=[];
   const get=async url=>{const r=await fetch(url);if(!r.ok)throw Object.assign(Error(await r.text()),{code:r.headers.get('x-error-code')});return r;};
   window.player=new EVAPlayer.Player({canvas:document.querySelector('canvas'),frameIndex:FrameIndex,ramBytes:512*1024**2,forwardPredecode:false,
    readAsset:async(_,file)=>new Uint8Array(await (await get('/frame?file='+file)).arrayBuffer()),
    setMediaTarget:t=>{get('/target?t='+t).catch(e=>errors.push(e.message));},
    prefetchMedia:(t,loop)=>{get('/prefetch?t='+t+'&loop='+encodeURIComponent(JSON.stringify(loop))).catch(e=>errors.push(e.message));},
    cancelMediaReads:()=>{get('/cancel').catch(e=>errors.push(e.message));},
    createFrameDecoder:settings=>EVAProxyDecoder.createProxyDecoder(settings),
    createSegmentAudio:settings=>SegmentAudio.createSegmentAudio({...settings,read:async n=>{const r=await get('/audio?n='+n);return r.status===204?null:{bytes:new Uint8Array(await r.arrayBuffer()),start:Number(r.headers.get('x-start'))};}}),
    emit:e=>{if(e.type==='error'&&e.phase!=='background-image')errors.push(e.error);}});
   const began=performance.now();await player.load(info);const s=player.snapshot();if(s.state!=='paused'||s.frameOrdinal!==0)throw Error('first frame failed');return {name:'cold first frame',ms:performance.now()-began,frame:s.frameOrdinal};})()`));
  result.cases.push(await evaluate(`(async()=>{for(const t of [22,44.5,0,12,0]){const r=await player.seek(t,{final:true});if(!['drawn','reused'].includes(r.status)||player.snapshot().state!=='paused')throw Error('seek failed '+JSON.stringify(r));}
   await player.play();const start=player.snapshot().time;await new Promise(r=>setTimeout(r,1300));const s=player.snapshot();if(s.state!=='playing'||s.time-start<1)throw Error('play failed '+JSON.stringify(s));await player.pause();return {name:'five seeks then real audio/video playback',advance:s.time-start};})()`));
  result.cases.push(await evaluate(`(async()=>{for(let n=0;n<5;n++){const play=player.play();const seek=player.seek(n%2?0:30,{final:true});await Promise.all([play,seek]);if(player.snapshot().state==='error')throw Error(player.snapshot().lastIssue);}
   await player.play();await new Promise(r=>setTimeout(r,300));await player.pause();if(errors.length)throw Error(JSON.stringify(errors));await player.dispose();await fetch('/cancel');return {name:'play interrupted by seek and resume; dispose',state:player.snapshot().state,budget:player.budget.used};})()`));
  assert.equal(result.cases.at(-1).budget,0);result.status='passed';await call('Browser.close',{},null);await exited;result.safeToClean=true;
 }catch(e){result.status='failed';result.error=e.stack;try{if(ws&&ws.readyState===1)await call('Browser.close',{},null);}catch(_){}if(!ended)child.kill();await exited;}
 finally{clearTimeout(deadline);for(const entry of requests.values()){clearTimeout(entry.timer);entry.reject(Error('browser closed'));}requests.clear();ws?.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
 return result;
}
module.exports={check};
