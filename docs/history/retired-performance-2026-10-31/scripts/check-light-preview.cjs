'use strict';
const fs=require('fs'),fsp=fs.promises,path=require('path'),http=require('http'),crypto=require('crypto'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e43');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const conditions=require('../tests/support/gpu-conditions.cjs').monitor();
 const label=process.argv[2];if(!/^[a-z0-9-]{1,40}$/.test(label||''))throw Error('New label required');const output=path.join(base,'light-browser-'+label+'.json');if(fs.existsSync(output))throw Error('Evidence exists');
 const meta=JSON.parse(fs.readFileSync(path.join(base,'light-sparse.json'))),pack=path.join(base,'light-sparse.pack');
 if(crypto.createHash('sha256').update(fs.readFileSync(pack)).digest('hex')!==meta.packHash)throw Error('Preview identity mismatch');
 const formal=process.argv.includes('--formal');
 const adapter=`window.createLightExperiment=({frames,read,decode,draw})=>{let pending=null,id=0;const output=[],budget=new EVAPlayer.Budget(1024**3),owned=frames.map((f,n)=>({...f,id:n,width:480,height:270}));
 const done=(r,status,extra={})=>r.resolve({status,ms:performance.now()-r.at,requested:r.time,...extra});
 const consumer=EVAScrubPreview.create({canvas:document.querySelector('canvas'),budget,find:t=>{let l=0,h=owned.length;while(l<h){const m=(l+h)>>>1;if(owned[m].time<t)l=m+1;else h=m;}return [owned[l-1],owned[l]].filter(Boolean).sort((a,b)=>Math.abs(a.time-t)-Math.abs(b.time-t))[0];},read:f=>read(f.id).then(b=>b.arrayBuffer()),isCurrent:()=>true,onDraw:(f,settings,time)=>{output.push(f);draw(null,{...f,requested:time});if(pending&&settings.identity===pending.id){const r=pending;pending=null;done(r,'preview',{time:f.time,errorMs:(f.time-r.time)*1000});}}});
 return{request(time,settings={}){if(pending){done(pending,'superseded');pending=null;}if(settings.final){consumer.cancel();return Promise.resolve({status:'needs-exact'});}return new Promise(resolve=>{pending={resolve,time,id:++id,at:performance.now()};if(!consumer.request(time,{final:false,identity:id})){done(pending,'uncovered');pending=null;}});},snapshot:()=>({...consumer.snapshot(),draws:output.length,budget:budget.snapshot()}),async close(){if(pending)done(pending,'closed');pending=null;await consumer.close();if(budget.snapshot().used)throw Error('RAM not released');}};};`;
 const file=await fsp.open(pack,'r'),sockets=new Set(),runtime=formal?Buffer.from(['player.js','scrub-preview.js'].map(f=>fs.readFileSync(path.join(root,'plugin',f),'utf8')).join('\n')+'\n'+adapter):fs.readFileSync(path.join(root,'prototypes/e43-source-preview/light.js'));
 const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');res.setHeader('cache-control','no-store');
   if(u.pathname==='/')return res.end('<!doctype html><canvas width="480" height="270"></canvas><script src="/light.js"></script>');
   if(u.pathname==='/light.js'){res.setHeader('content-type','text/javascript');return res.end(runtime);}
   if(u.pathname==='/index')return res.end(JSON.stringify(meta.frames));
   if(u.pathname==='/frame'){const n=Number(u.searchParams.get('n')),f=Number.isSafeInteger(n)&&meta.frames[n];if(!f||f.bytes>1024**2)throw Error('Invalid frame');const b=Buffer.alloc(f.bytes);const r=await file.read(b,0,b.length,f.offset);if(r.bytesRead!==b.length)throw Error('Truncated preview');return res.end(b);}
   res.statusCode=404;res.end();
 }catch(e){res.statusCode=500;res.end(e.message);}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const scratch=path.join(base,'browser-light-'+label);if(fs.existsSync(scratch))throw Error('Existing browser data');let child,ws,session,serial=0;const pending=new Map();
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 try{
   child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--no-default-browser-check','--remote-debugging-port=0','--proxy-server=127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--disk-cache-size=1048576','--user-data-dir='+scratch,'about:blank'],{windowsHide:true,stdio:'ignore'});
   child.on('error',()=>{});let port;for(let n=0;n<150&&!port;n++){try{port=fs.readFileSync(path.join(scratch,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await wait(50);}}
   if(!port)throw Error('Chrome startup failed');ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
   ws.onmessage=e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
   const t=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:t.targetId,flatten:true},null)).sessionId;await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
   for(let n=0;n<100;n++){if(await evaluate('!!window.createLightExperiment'))break;await wait(30);}
   const rounds=[];
   for(let round=0;round<2;round++)rounds.push(await evaluate(`(async()=>{const frames=await(await fetch('/index')).json(),draws=[],longTasks=[],begin=performance.now(),context=document.querySelector('canvas').getContext('2d',${process.argv.includes('--cpu-canvas')?'{willReadFrequently:true,alpha:false}':'{alpha:false}'});
     const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({at:e.startTime-begin,duration:e.duration}))));observer.observe({type:'longtask'});
     const reader=createLightExperiment({frames,read:async n=>{const r=await fetch('/frame?n='+n);if(!r.ok)throw Error(await r.text());return r.blob();},decode:b=>createImageBitmap(b),draw:(p,m)=>{if(p)context.drawImage(p,0,0);draws.push({...m,at:performance.now()-begin});}});
     try{const cold=[];for(const t of [58.4,22.7,44.2])cold.push(await reader.request(t));const drag=[],input=[],jobs=[],dragAt=performance.now()-begin;
       for(let n=0;n<24;n++){const t=32+n*.16;input.push({at:performance.now()-begin,time:t});jobs.push(reader.request(t));await new Promise(r=>setTimeout(r,32));}drag.push(...await Promise.all(jobs));
       const refused=await reader.request(35.676,{final:true});const exact=await reader.request(frames[10].time,{final:true});
       return {cold,drag,input,dragAt,draws,refused,exact,stats:reader.snapshot(),longTasks,visible:document.visibilityState};}finally{observer.disconnect();await reader.close();}})()`));
   const result={schema:1,at:new Date().toISOString(),scope:'prepared sparse previews; no original-source cold preparation; independent Chrome, no Eagle acceptance',formalRuntime:formal,cpuCanvas:process.argv.includes('--cpu-canvas'),sourceHash:meta.sourceHash,packHash:meta.packHash,codeHash:crypto.createHash('sha256').update(runtime).digest('hex'),browser:await evaluate('navigator.userAgent'),rounds,conditions:await conditions.stop()};
   fs.writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(rounds.map(r=>({first:r.cold.map(x=>x.ms),dragDelivered:r.drag.filter(x=>x.status==='preview').length,maxDelay:Math.max(...r.drag.map(x=>x.ms)),maxTemporalError:Math.max(...r.drag.map(x=>Math.abs(x.errorMs||0))),stats:r.stats}))));
   await Promise.race([call('Browser.close',{},null).catch(()=>{}),wait(1000)]);
 }finally{await conditions.stop();for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Experiment ended'));}pending.clear();ws?.close();if(child&&child.exitCode===null)child.kill();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await file.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
