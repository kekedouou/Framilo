'use strict';
const fs=require('fs'),path=require('path'),{spawn}=require('child_process'),assert=require('assert');
const {scratch}=require('../tests/support/annotation-scratch.cjs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'verification-runs/e40');
async function main(){
 const target=path.resolve(process.argv[2]||'artifacts/performance/report.html'),isFile=fs.statSync(target).isFile(),dir=isFile?path.dirname(target):target,reportFile=isFile?target:path.join(dir,'report.html');if(!isFile)await require('../plugin/performance-report.cjs').validate(dir);
 const temp=scratch('performance-view'),profile=path.join(temp.root,'profile');let child,ws,session,id=0;const calls=new Map();
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{calls.delete(n);reject(Error(method+' timeout'));},10000);calls.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,...(target?{sessionId:target}:{})}));});
 try{
  child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-popup-blocking','--disable-background-networking','--disable-component-update','--disable-extensions','--disable-sync','--remote-debugging-port=0','--window-size=1280,900','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let n=0;n<150&&!port;n++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await wait(40);}}
  assert(port);ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const v=JSON.parse(e.data),p=calls.get(v.id);if(!p)return;clearTimeout(p.timer);calls.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
  const t=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:t.targetId,flatten:true},null)).sessionId;
  const evalJS=async expression=>{const v=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;};
  await call('Page.navigate',{url:require('url').pathToFileURL(reportFile).href});await wait(300);
  const report=await evalJS(`({charts:['latency','stages','comparison'].every(id=>document.getElementById(id)),overflow:document.documentElement.scrollWidth>innerWidth,svgs:document.querySelectorAll('svg').length})`);assert(report.charts&&!report.overflow&&report.svgs);
  const exportDir=path.join(temp.root,'exports');fs.mkdirSync(exportDir);await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:exportDir},null);
  await evalJS("document.querySelector('[data-export=svg]').click()");await wait(300);await evalJS("document.querySelector('[data-export=png]').click()");
  for(let n=0;n<50&&!fs.readdirSync(exportDir).some(n=>n.endsWith('.png'));n++)await wait(100);
  const exported=fs.readdirSync(exportDir);assert(exported.some(n=>n.endsWith('.svg'))&&exported.some(n=>n.endsWith('.png')),'SVG/PNG export did not complete');
  fs.mkdirSync(out,{recursive:true});fs.copyFileSync(path.join(exportDir,exported.find(n=>n.endsWith('.png'))),path.join(out,'report-export.png'));
  await evalJS("document.querySelector('[data-tab=stability]').click()");assert(await evalJS("!document.querySelector('[data-page=stability]').hidden"));await evalJS("document.querySelector('[data-tab=compare]').click()");
  fs.mkdirSync(out,{recursive:true});const reportShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'report-view.png'),Buffer.from(reportShot.data,'base64'));
  await evalJS("document.querySelector('[data-tab=experience]').click()");
  assert(await evalJS("['寻帧定位','文件读取与解封装','视频解码','图像转换','数据传输','渲染提交'].every(x=>document.querySelector('[data-experience=\"0\"]').textContent.includes(x))"));
  const detailShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'report-stages.png'),Buffer.from(detailShot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:640,height:900,deviceScaleFactor:1,mobile:false});
  assert(await evalJS('document.documentElement.scrollWidth<=innerWidth'),'report outer page must not overflow at 640px');
  await call('Emulation.clearDeviceMetricsOverride');
  await evalJS(`document.body.innerHTML='<button id="performanceMonitor">性能监测</button>';window.parentGeometry={w:innerWidth,h:innerHeight};`);
  await evalJS(fs.readFileSync(path.join(root,'plugin/performance-view.js'),'utf8'));
  await evalJS(`window.ops=[];window.mock={state:'off',busy:false,needsConfirmation:false,standardBlocked:null,data:{requests:[{cache:'decoded'},{cache:'disk'}],capacity:{}},metrics:{latency:{p95:42}},explanation:{title:'低清预览',delay:126},stages:[{name:'prepare',ms:70,note:'代理准备'},{name:'readIO',ms:20,note:'读取'},{name:'decodeNative',ms:15,note:'解码'},{name:'convert',ms:5,note:'转换'},{name:'transfer',ms:2,note:'复制'},{name:'renderWait',ms:10,note:'等待绘制'},{name:'submit',ms:4,note:'提交'}],last:null};window.controller=EVAPerformanceView.create({windowURL:${JSON.stringify(require('url').pathToFileURL(path.join(root,'plugin/performance-window.html')).href)},createMonitor:callback=>{window.update=()=>callback(mock);const state=s=>{mock.state=s;callback(mock);};return{view:()=>mock,enable:()=>state('observing'),start:()=>{ops.push('start');state('recording');},finish:async(s,r,o)=>{ops.push('finish');if(mock.last&&!o?.replace&&!o?.archive){mock.needsConfirmation=true;state('unsaved');return{needsConfirmation:true};}mock.needsConfirmation=false;mock.last={report:'fixture'};state('review');},standard:()=>{ops.push('standard');state('testing');},newGroup:()=>ops.push('group'),stop:()=>{ops.push('stop');state('cancelled');},archive:()=>{ops.push('keep');mock.needsConfirmation=false;state('review');},disable:()=>{ops.push('off');state('off');return true;},destroy:()=>{}}},openReport:()=>ops.push('open')});document.getElementById('performanceMonitor').click();`);
  const parent=session,parentTarget=t.targetId;let popup;
  for(let n=0;n<40&&!popup;n++){await wait(50);popup=(await call('Target.getTargets',{},null)).targetInfos.find(x=>x.url.endsWith('/performance-window.html'));}
  assert(popup,'native popup did not open');
  session=(await call('Target.attachToTarget',{targetId:popup.targetId,flatten:true},null)).sessionId;
  await wait(200);assert.equal(await evalJS("document.getElementById('reason').textContent"),'低清预览');
  const click=async name=>{assert(await evalJS(`(()=>{const b=document.getElementById('${name}');if(!b||b.disabled)return false;b.click();return true;})()`),'disabled '+name);await wait(80);};
  await click('record');await click('record');await click('record');await click('record');
  assert.equal(await evalJS("document.getElementById('confirm').hidden"),false);
  await click('replace');await click('more');await click('report');await click('group');await click('standard');await click('standard');
  const before=(await call('Browser.getWindowForTarget',{targetId:parentTarget},null)),win=(await call('Browser.getWindowForTarget',{targetId:popup.targetId},null));assert.notEqual(before.windowId,win.windowId,'must be separate native windows');
  await call('Browser.setWindowBounds',{windowId:win.windowId,bounds:{left:120,top:90,width:440,height:480}},null);await wait(150);
  const after=await call('Browser.getWindowForTarget',{targetId:parentTarget},null);assert.deepEqual(after.bounds,before.bounds,'moving monitor must not move player');
  const checks=await evalJS("({state:document.getElementById('state').textContent,width:innerWidth,height:innerHeight,actions:document.querySelectorAll('.actions button').length,inside:document.querySelector('main').getBoundingClientRect().right<=innerWidth,overflow:document.body.scrollWidth>innerWidth})");
  assert(checks.actions===3&&checks.inside&&!checks.overflow);await click('more');
  const monitorShot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'monitor-view.png'),Buffer.from(monitorShot.data,'base64'));
  await call('Emulation.setDeviceMetricsOverride',{width:360,height:480,deviceScaleFactor:1,mobile:false});
  assert(await evalJS('document.body.scrollWidth<=innerWidth'),'monitor must fit 360px');
  await call('Emulation.clearDeviceMetricsOverride');
  await call('Target.closeTarget',{targetId:popup.targetId},null);session=parent;await wait(950);
  const ops=await evalJS("ops");assert(ops.includes('off')&&ops.includes('start')&&ops.includes('stop')&&ops.includes('open'));
  await evalJS("document.getElementById('performanceMonitor').click()");await wait(200);await evalJS("controller.destroy()");
  fs.writeFileSync(path.join(out,'presentation-check.json'),JSON.stringify({report,checks,ops,exported,separateNativeWindow:true,parentBoundsUnchanged:true,scope:'真实Chrome独立窗口/DOM；控制器为夹具，不是Eagle宿主'},null,2));
  await call('Browser.close',{},null);await wait(300);console.log('E40 presentation: separate native Chrome window, independent movement, 360px monitor / 640px report, six stages, save/overwrite/close/reopen, PNG/SVG passed; controller model, not Eagle.');
 }finally{for(const p of calls.values()){clearTimeout(p.timer);p.reject(Error('closed'));}calls.clear();ws?.close();if(child&&child.exitCode===null)child.kill();await wait(300);temp.clean();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
