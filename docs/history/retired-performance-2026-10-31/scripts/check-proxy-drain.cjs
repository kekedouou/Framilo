'use strict';
// Explicit read-only cache-packet replay. Does not generate media or mutate the live cache.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert'),http=require('http'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'verification-runs/e41-decoder-fix');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
 const manifestFile=path.resolve(process.argv[2]||'');assert(manifestFile.startsWith(path.join(root,'plugin/cache')+path.sep));
 const raw=fs.readFileSync(manifestFile),m=JSON.parse(raw);assert(m.videoEncoding?.recipe==='nvenc-p1-qp20-v1');assert.equal(m.framePack.file,'frames.pack');assert(m.framePack.bytes<32*1024**2);
 const packFile=path.join(path.dirname(manifestFile),m.framePack.file);assert(!fs.lstatSync(packFile).isSymbolicLink());const pack=fs.readFileSync(packFile);assert.equal(pack.length,m.framePack.bytes);assert.equal(sha(pack),m.framePack.sha256);
 for(const f of m.frames){assert(Number.isSafeInteger(f.offset)&&f.offset>=0&&f.offset+f.bytes<=pack.length);assert.equal(sha(pack.subarray(f.offset,f.offset+f.bytes)),f.sha256);}
 assert.equal(sha(fs.readFileSync(manifestFile)),sha(raw));fs.mkdirSync(out,{recursive:true});
 const info={width:m.width,height:m.height,frames:m.frames.map(f=>({id:f.id,offset:f.offset,bytes:f.bytes}))},code=fs.readFileSync(path.join(root,'plugin/proxy-decoder.js'),'utf8');
 const packetPath=path.join(out,'replay-packets.pack');if(fs.existsSync(packetPath))assert.equal(sha(fs.readFileSync(packetPath)),sha(pack),'Use another evidence directory for different packets');else fs.writeFileSync(packetPath,pack,{flag:'wx'});
 fs.writeFileSync(path.join(out,'replay-info-'+runId+'.json'),JSON.stringify({info,packHash:sha(pack),manifestHash:sha(raw),decoderHash:sha(code)},null,2),{flag:'wx'});
 const temp=require('../tests/support/annotation-scratch.cjs').scratch('e41-drain'),profile=path.join(temp.root,'profile'),sockets=new Set();let child,ws,session,id=0;const calls=new Map();
 const server=http.createServer((req,res)=>{res.setHeader('cache-control','no-store');if(req.url==='/pack')return res.end(pack);if(req.url==='/info'){res.setHeader('content-type','application/json; charset=utf-8');return res.end(JSON.stringify(info));}if(req.url==='/decoder.js'||req.url==='/before.js'){res.setHeader('content-type','text/javascript; charset=utf-8');return res.end(req.url==='/decoder.js'?code:fs.readFileSync(path.join(out,'proxy-decoder-before.js')));}res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><script src="/before.js"></script><script>window.BeforeProxy=EVAProxyDecoder;</script><script src="/decoder.js"></script>');});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{calls.delete(n);reject(Error(method+' timeout'));},45000);calls.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,...(target?{sessionId:target}:{})}));});
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=localhost;127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let n=0;n<150&&!port;n++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await wait(40);}}assert(port);
  ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const v=JSON.parse(e.data),p=calls.get(v.id);if(!p)return;clearTimeout(p.timer);calls.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
  const target=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});await wait(150);
  const result=await evaluate(`(async()=>{const info=await(await fetch('/info')).json(),pack=new Uint8Array(await(await fetch('/pack')).arrayBuffer()),rows=[];
   for(const preference of ['prefer-hardware','prefer-software','no-preference'])for(let reopen=0;reopen<2;reopen++){
    const d=EVAProxyDecoder.createProxyDecoder({width:info.width,height:info.height,hardwareAcceleration:preference}),latency=[],cancelled=[];
    const decode=async(index,signal)=>{const f=info.frames[index%info.frames.length],start=performance.now();try{const image=await d.decode(pack.subarray(f.offset,f.offset+f.bytes),{id:f.id},{signal});if(image.width!==info.width||image.height!==info.height)throw Error('wrong size');image.close();latency.push(performance.now()-start);return 'shown';}catch(e){if(e.code==='MEDIA_CANCELLED'){cancelled.push(1);return 'cancelled';}throw e;}};
    await decode(0);
    for(let n=0;n<40;n++)await Promise.all([decode(n%info.frames.length),decode(info.frames.length-1-n%info.frames.length)]);
    for(let n=0;n<8;n++){const controller=new AbortController(),job=decode(n,controller.signal);await new Promise(r=>setTimeout(r,0));controller.abort();await job;await new Promise(r=>setTimeout(r,12));}
    const state=d.snapshot();await d.close();if(d.snapshot().pending!==0)throw Error('pending after close');latency.sort((a,b)=>a-b);rows.push({preference,reopen,shown:latency.length,cancelled:cancelled.length,p95Ms:latency[Math.ceil(latency.length*.95)-1],maxMs:Math.max(...latency),state,closed:d.snapshot()});
   }return{browser:navigator.userAgent,rows};})()`);
  fs.writeFileSync(path.join(out,'native-replay-'+runId+'.json'),JSON.stringify({at:new Date().toISOString(),status:'passed',scope:'actual cached 1080p NVENC packets in independent Chrome; not Eagle, not end-to-end seek latency',width:m.width,height:m.height,frames:m.frames.length,packHash:sha(pack),decoderHash:sha(code),...result},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result.rows.map(r=>({preference:r.preference,reopen:r.reopen,shown:r.shown,cancelled:r.cancelled,p95Ms:r.p95Ms,flushes:r.state.flushes}))));
  const barrier=await evaluate(`(async()=>{const info=await(await fetch('/info')).json(),pack=new Uint8Array(await(await fetch('/pack')).arrayBuffer()),rows=[];
   class SlowDrain extends VideoDecoder{flush(){return super.flush().then(()=>new Promise(r=>setTimeout(r,40)));}}
   for(const [name,api] of [['before',BeforeProxy],['after',EVAProxyDecoder]]){
    const d=api.createProxyDecoder({width:info.width,height:info.height,VideoDecoder:SlowDrain,timeoutMs:500});let error=null,shown=0;
    try{for(let n=0;n<4;n++)await Promise.all([0,1].map(async i=>{const f=info.frames[(n+i)%info.frames.length],image=await d.decode(pack.subarray(f.offset,f.offset+f.bytes),{id:f.id});shown++;image.close();}));}catch(e){error=e.code||e.message;}finally{await d.close();}rows.push({name,error,shown,state:d.snapshot()});
   }return rows;})()`);
  fs.writeFileSync(path.join(out,'native-barrier-'+runId+'.json'),JSON.stringify({scope:'real cached packets/native decoding; injected 40ms flush completion delay; regression reproduction, not natural performance',rows:barrier},null,2)+'\n',{flag:'wx'});
  assert.equal(barrier[0].error,'PROXY_DECODE_TIMEOUT','old decoder should reproduce delayed-drain starvation');assert.equal(barrier[1].error,null);assert.equal(barrier[1].shown,8);
  await Promise.race([call('Browser.close',{},null).catch(()=>{}),wait(500)]);
 }finally{for(const p of calls.values()){clearTimeout(p.timer);p.reject(Error('closed'));}calls.clear();ws?.close();if(child&&child.exitCode===null)child.kill();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await wait(500);temp.clean();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
