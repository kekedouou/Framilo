'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto'),{spawn}=require('child_process');
const label=process.argv[2]||'final';assert(/^[a-z0-9-]{1,30}$/.test(label));
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e43'),work=path.join(base,'report-browser-'+label),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 fs.mkdirSync(work);const profile=path.join(work,'profile'),downloads=path.join(work,'downloads');fs.mkdirSync(downloads);
 let child,ws,session,serial=0;const pending=new Map();
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method));},10000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;};
 try{
  child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-extensions','--disable-background-networking','--disable-component-update','--disable-sync','--proxy-server=127.0.0.1:9','--remote-debugging-port=0','--window-size=1280,1100','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let n=0;n<150&&!port;n++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await wait(40);}}assert(port);
  ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const v=JSON.parse(e.data),p=pending.get(v.id);if(!p)return;clearTimeout(p.timer);pending.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
  const t=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:t.targetId,flatten:true},null)).sessionId;
  await call('Page.navigate',{url:require('url').pathToFileURL(path.join(root,'artifacts/performance/e43-preview.html')).href});await wait(200);
  assert(await evaluate("['latency','quality'].every(id=>document.getElementById(id))&&document.documentElement.scrollWidth<=innerWidth"));
  await evaluate("(async()=>{document.getElementById('high').click();await document.getElementById('picture').decode();if(document.getElementById('picture').naturalWidth!==1280)throw Error('High image failed');document.getElementById('low').click();await document.getElementById('picture').decode();if(document.getElementById('picture').naturalWidth!==480)throw Error('Preview image failed');})()");
  const screenshot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(base,'report-'+label+'.png'),Buffer.from(screenshot.data,'base64'));
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads},null);
  for(const ext of ['svg'])await evaluate("document.querySelector('[data-export="+ext+"]').click()");
  for(let n=0;n<60&&fs.readdirSync(downloads).filter(n=>/\.(png|svg)$/.test(n)).length<1;n++)await wait(50);
  assert.equal(fs.readdirSync(downloads).filter(n=>/\.(png|svg)$/.test(n)).length,1);
  await call('Emulation.setDeviceMetricsOverride',{width:640,height:900,deviceScaleFactor:1,mobile:false});
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  await call('Page.navigate',{url:require('url').pathToFileURL(path.join(root,'artifacts/performance/report.html')).href});await wait(150);
  assert(await evaluate("!!document.querySelector('a[href=\"e43-preview.html\"]')"));
  fs.writeFileSync(path.join(base,'report-check-'+label+'.json'),JSON.stringify({status:'passed',desktop:1280,narrow:640,exports:['svg'],entryLinked:true,scope:'independent Chrome report UI only'},null,2));
  await Promise.race([call('Browser.close',{},null),wait(800)]);await wait(300);
 }finally{
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('browser ended'));}pending.clear();ws?.close();if(child?.exitCode===null){child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('close',r);});}await wait(200);
  const files=[],dirs=[];function walk(dir){assert(dir===work||dir.startsWith(work+path.sep));assert(!fs.lstatSync(dir).isSymbolicLink());for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);assert(!fs.lstatSync(f).isSymbolicLink());if(e.isDirectory())walk(f);else files.push({file:f,bytes:fs.statSync(f).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')});}dirs.push(dir);}walk(work);
  fs.writeFileSync(path.join(base,'report-cleanup-'+label+'.json'),JSON.stringify({bytes:files.reduce((n,f)=>n+f.bytes,0),files:files.map(f=>({...f,file:path.relative(base,f.file)}))},null,2));
  for(const f of files){assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.file)).digest('hex'),f.sha256);fs.unlinkSync(f.file);}for(const d of dirs)fs.rmdirSync(d);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
