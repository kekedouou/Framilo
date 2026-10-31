'use strict';
// Read-only source probe + bounded independent Chrome experiment. No Eagle writes.
const fs=require('fs'),fsp=fs.promises,path=require('path'),http=require('http'),crypto=require('crypto'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'verification-runs/e43'),profile=JSON.parse(fs.readFileSync(path.join(root,'verification-runs/e42/profile.json')));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const hash=async file=>{const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');};
async function main(){
 const label=process.argv[2];if(!/^[a-z0-9-]{1,40}$/.test(label||''))throw Error('A new evidence label is required');
 const out=path.join(evidence,'source-'+label+'.json');if(fs.existsSync(out))throw Error('Evidence already exists');
 if(await hash(profile.source)!==profile.sourceHash)throw Error('Source hash changed');
 const raw=JSON.parse(fs.readFileSync(path.join(evidence,'source-packets.json'))),s=raw.streams[0];
 if(s.codec_name!=='h264'||s.codec_tag_string!=='avc1')throw Error('Prototype only accepts AVC1');
 const hex=s.extradata.split('\n').filter(l=>l.includes(':')).map(l=>l.split(':')[1].split('  ')[0].replace(/\s/g,'')).join('');
 const description=Buffer.from(hex,'hex');if(description[0]!==1)throw Error('Invalid AVC configuration');
 const [num,den]=s.time_base.split('/').map(Number);let key=-1;
 const sourceSize=fs.statSync(profile.source).size;
 const packets=raw.packets.map(p=>{const n={pts:Math.round(p.pts*num/den*1e6),pos:Number(p.pos),size:Number(p.size),isKey:p.flags.startsWith('K')};
   if(n.isKey)key=raw.packets.indexOf(p);n.key=key;
   if(key<0||!Number.isSafeInteger(n.pos)||!Number.isSafeInteger(n.size)||n.size<1||n.size>16*1024**2||n.pos<0||n.pos+n.size>sourceSize)throw Error('Invalid source packet');return n;});
 const index={codec:'avc1.'+description.subarray(1,4).toString('hex'),description:[...description],width:s.width,height:s.height,packets};
 const runtime=fs.readFileSync(path.join(root,'prototypes/e43-source-preview/direct.js'));
 const file=await fsp.open(profile.source,'r'),sockets=new Set();let maxRead=0,totalRead=0;
 const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');res.setHeader('cache-control','no-store');
   if(u.pathname==='/')return res.end('<!doctype html><canvas width="480" height="270"></canvas><script src="/direct.js"></script>');
   if(u.pathname==='/direct.js'){res.setHeader('content-type','text/javascript');return res.end(runtime);}
   if(u.pathname==='/index')return res.end(JSON.stringify(index));
   if(u.pathname==='/packets'){const a=Number(u.searchParams.get('a')),b=Number(u.searchParams.get('b'));if(!Number.isSafeInteger(a)||!Number.isSafeInteger(b)||a<0||b<=a||b-a>32||b>packets.length)throw Error('Invalid read');
     const list=packets.slice(a,b),size=list.reduce((n,p)=>n+p.size,0);if(size>32*1024**2)throw Error('Read bound');
     const data=Buffer.alloc(size);let offset=0;for(const p of list){const r=await file.read(data,offset,p.size,p.pos);if(r.bytesRead!==p.size)throw Error('Source truncated');offset+=p.size;}
     maxRead=Math.max(maxRead,size);totalRead+=size;return res.end(data);}
   res.statusCode=404;res.end();
 }catch(e){res.statusCode=500;res.end(e.message);}});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const scratch=path.join(evidence,'browser-'+label);if(fs.existsSync(scratch))throw Error('Browser directory exists');
 let child,ws,session,id=0;const pending=new Map();
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout '+method));},45000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,...(target?{sessionId:target}:{})}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 try{
   child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--no-default-browser-check','--remote-debugging-port=0','--proxy-server=127.0.0.1:9','--proxy-bypass-list=127.0.0.1;localhost','--disk-cache-size=1048576','--user-data-dir='+scratch,'about:blank'],{windowsHide:true,stdio:'ignore'});
   child.on('error',()=>{});let port;for(let n=0;n<150&&!port;n++){try{port=fs.readFileSync(path.join(scratch,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await wait(50);}}
   if(!port)throw Error('Chrome startup failed');ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
   ws.onmessage=e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
   const t=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:t.targetId,flatten:true},null)).sessionId;
   await call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});for(let n=0;n<100;n++){if(await evaluate('!!window.createSourceExperiment'))break;await wait(30);}
   const results=[];
   for(const hardware of ['prefer-hardware','no-preference','prefer-software']){
     const r=await evaluate(`(async()=>{const index=await(await fetch('/index')).json(),draws=[],start=performance.now();
       const reader=await createSourceExperiment({index,hardware:${JSON.stringify(hardware)},read:async(a,b)=>{const r=await fetch('/packets?a='+a+'&b='+b);if(!r.ok)throw Error(await r.text());return new Uint8Array(await r.arrayBuffer());},draw:(p,pts)=>{document.querySelector('canvas').getContext('2d').drawImage(p,0,0,480,270);draws.push({at:performance.now()-start,pts});}});
       try{const cold=[];for(const t of ${JSON.stringify(profile.targets)})cold.push(await reader.seek(t));const jobs=[],input=[];const dragAt=performance.now()-start;
       for(let n=0;n<24;n++){input.push({at:performance.now()-start,target:32+n*.16});jobs.push(reader.seek(32+n*.16));await new Promise(r=>setTimeout(r,32));}
       const releaseAt=performance.now()-start,final=await reader.seek(35.68);const drag=await Promise.all(jobs);
       const reverse=[];for(const t of [35.65,35.6,35.5,22.7])reverse.push(await reader.seek(t));
       return {hardware:${JSON.stringify(hardware)},cold,drag,dragAt,input,releaseAt,final,reverse,draws,stats:reader.snapshot()};}finally{reader.close();}})()`);
     results.push(r);console.log(hardware+': '+r.cold.map(x=>x.status+' '+Math.round(x.ms)+'ms').join(', '));
   }
   const output={schema:1,at:new Date().toISOString(),sourceHash:profile.sourceHash,codeHash:crypto.createHash('sha256').update(runtime).digest('hex'),scope:'independent Chrome; source compressed packets; no proxy generation; 240x135 preview only; no Eagle acceptance',browser:await evaluate('navigator.userAgent'),maxRead,totalRead,results};
   fs.writeFileSync(out,JSON.stringify(output,null,2),{flag:'wx'});console.log(out);
   await Promise.race([call('Browser.close',{},null).catch(()=>{}),wait(1000)]);
 }finally{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Experiment ended'));}pending.clear();ws?.close();if(child&&child.exitCode===null)child.kill();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await file.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
