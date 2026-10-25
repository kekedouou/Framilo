'use strict';

// Explicit independent Chrome gate. The controlled 1500ms Session completion
// tests formal UI intent ownership; it is not the formal media/backend path.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { spawn } = require('child_process');
const processEvidence = require('../../plugin/process-identity.cjs')._test;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function checkResponsiveBrowser({ pluginRoot, scratch, fixtures, group = 'all', timeoutMs = 90000 }) {
  const result = { origin: 'independent-Chrome-formal-UI-and-native-HTMLVideo-quick-preview', eagle: false, status: 'running', group,
    limitations: ['PointerEvents are generated in the browser; cursor timing ends at a following requestAnimationFrame, not physical display.',
      'The accurate Session path intentionally waits 1500ms and submits an independently decoded PNG. It does not measure formal Player/backend seek throughput.',
      'HTMLVideo previews remain approximate; synthetic visible frame cells check image identity independently of video timestamps.',
      'Formal readRecordFrame/read-thread/native-guard integration is a separate gate; no source annotations or real Eagle are used.'], cases: [], serverErrors: [],liveEvents:[] };
  const inputFiles = new Map();
  for (const name of require('../../scripts/package-release.cjs').RUNTIME) if (/\.(?:js|css|html)$/.test(name)) inputFiles.set('/' + name, fs.readFileSync(path.join(pluginRoot, name)));
  const html = inputFiles.get('/index.html').toString().replace(/\s*<script src="app\.js"><\/script>/, '');
  assert(!html.includes('<script src="app.js">'), 'The test page must not boot Eagle/app APIs');
  const sourceByRoute = new Map(fixtures.map(item => ['/fixture/' + item.name + '.mp4', item]));
  const pngByRoute = new Map(fixtures.map(item => ['/fixture/' + item.name + '.png', fs.readFileSync(item.reference)]));
  const originalStats = new Map(fixtures.map(item => [item.file, fs.lstatSync(item.file)]));
  const sockets = new Set(), streams = new Set();
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('cache-control', 'no-store');
      if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(html); }
      if (inputFiles.has(url.pathname)) { res.setHeader('content-type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(inputFiles.get(url.pathname)); }
      if (pngByRoute.has(url.pathname)) { res.setHeader('content-type', 'image/png'); return res.end(pngByRoute.get(url.pathname)); }
      const fixture = sourceByRoute.get(url.pathname); if (!fixture) { res.statusCode = 404; return res.end(); }
      const stat = fs.lstatSync(fixture.file), original = originalStats.get(fixture.file);
      assert(stat.isFile() && stat.nlink === 1 && !stat.isSymbolicLink() && stat.ino === original.ino && stat.dev === original.dev && stat.size === original.size, 'Synthetic source identity changed');
      let start = 0, end = stat.size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range); assert(match, 'Unexpected fixture byte range');
        start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
        if (start > end || start >= stat.size) { res.statusCode = 416; return res.end(); }
        res.statusCode = 206; res.setHeader('content-range', 'bytes ' + start + '-' + end + '/' + stat.size);
      }
      res.setHeader('accept-ranges', 'bytes'); res.setHeader('content-type', 'video/mp4'); res.setHeader('content-length', end - start + 1);
      const stream = fs.createReadStream(fixture.file, { start, end }); streams.add(stream); stream.on('close', () => streams.delete(stream));
      stream.on('error', error => { result.serverErrors.push(error.message); res.destroy(error); }); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch (error) { result.serverErrors.push(error.message); if (!res.headersSent) res.statusCode = 500; res.end(error.message); }
  });
  server.on('connection', connection => { sockets.add(connection); connection.on('close', () => sockets.delete(connection)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(scratch, 'responsive-chrome-profile'), chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--user-data-dir=' + profile, '--disk-cache-size=1048576', '--window-size=1440,900', 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEMP: scratch, TMP: scratch } });
  let ended = false, log = '', socket, session, serial = 0, evaluate, processRecord; const pending = new Map();
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-4096); });
  const exited = new Promise(resolve => { child.once('close', () => { ended = true; resolve(); }); child.once('error', error => { ended = true; log += error.message; resolve(); }); });
  const deadlineAt=Date.now()+timeoutMs,deadline = setTimeout(() => child.kill(), timeoutMs);
  function call(method, params = {}, target = session) {
    return new Promise((resolve, reject) => {
      if(Date.now()>=deadlineAt)return reject(Error('Responsive Chrome deadline reached: '+method));
      const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('Responsive Chrome timeout: ' + method)); }, Math.max(1,Math.min(deadlineAt-Date.now(),30000)));
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
    });
  }
  try {
    assert.equal(typeof WebSocket, 'function', 'This explicit developer harness needs the existing Node24 WebSocket; do not install a dependency');
    let port; const began = Date.now();
    while (!port && !ended && Date.now() - began < 10000) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch (_) { await pause(40); } }
    assert(port, 'Chrome did not start: ' + log);
    const rows = processEvidence.snapshot(), own = rows.find(row => row.pid === child.pid); assert(processEvidence.valid(own), 'Actual Chrome birth/image unavailable');
    const descendants = [], ids = new Set([own.pid]); let more = true;
    while (more) { more = false; for (const row of rows) if (!ids.has(row.pid) && ids.has(row.parentPid)) { assert(processEvidence.valid(row), 'Chrome child birth/image unavailable'); ids.add(row.pid); descendants.push(row); more = true; } }
    processRecord = { processIdentity: own, children: descendants.map(identity => ({ state: 'running', identity })) }; result.chromeProcesses = processRecord;
    socket = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => { const message = JSON.parse(event.data);
      if(message.method==='Runtime.bindingCalled'&&message.params?.name==='e36Record'){
        try{result.liveEvents.push(JSON.parse(message.params.payload));if(result.liveEvents.length>20000){result.liveEventOverflow=true;child.kill();}}catch(error){result.liveEventError=error.message;child.kill();}return;
      }
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result); });
    const target = await call('Target.createTarget', { url: 'http://127.0.0.1:' + server.address().port });
    session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    evaluate = async expression => { const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; };
    for (let n = 0; n < 100 && !await evaluate('!!window.EVAUI&&!!window.EVAQuickPreview'); n++) await pause(30);
    assert(await evaluate('!!window.EVAUI&&!!window.EVAQuickPreview'), 'Formal UI and quick-preview sources did not load');
    await call('Runtime.addBinding',{name:'e36Record'});
    const browserFixtures = fixtures.map(({ name, duration, width, height, offset, expectedMarker, finalTime, frames, indexFrames, finalOrdinal }) => ({ name, duration, width, height, offset, expectedMarker, finalTime, frames, indexFrames, finalOrdinal }));
    await evaluate('window.E36_CONFIG=' + JSON.stringify({ fixtures: browserFixtures, group }));
    result.browser = await evaluate(`(async()=>{
      const config=E36_CONFIG,rawInputs=[],rawCursors=[],rawPreviews=[],rawActual=[],errors=[],cases=[],resources=[];let requestId=0,latest=null,quick=null,ui=null,actual=null,closed=false;
      for(const [channel,array]of Object.entries({rawInputs,rawCursors,rawPreviews,rawActual,errors})){const push=array.push.bind(array);array.push=(...items)=>{for(const value of items)e36Record(JSON.stringify({channel,value}));return push(...items);};}
      const picture=document.getElementById('picture'),timeline=document.getElementById('timeline'),thumb=document.getElementById('thumb'),wait=ms=>new Promise(r=>setTimeout(r,ms));
      const percentile=(v,p)=>{const a=[...v].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(a.length*p)-1)]??null;};
      const marker=canvas=>{const c=canvas.getContext('2d'),scale=canvas.width/1280;let value=0;for(let bit=0;bit<10;bit++){const p=c.getImageData(Math.floor((20+bit*20)*scale),Math.max(0,Math.floor(16*canvas.height/720)),1,1).data,level=(p[0]+p[1]+p[2])/3;if(level>80&&level<175)return {uncertain:true,bit,level};if(level>=175)value|=1<<bit;}return{value,time:value/60};};
      const observe=()=>{if(!latest)return;rawCursors.push({id:latest.id,at:performance.now(),inputAt:latest.at,target:latest.time,left:parseFloat(thumb.style.left),kind:'style-mutation'});};
      const observer=new MutationObserver(observe);observer.observe(thumb,{attributes:true,attributeFilter:['style']});
      const state={epoch:1,state:'paused',duration:16,source:{id:'synthetic',name:'E36 synthetic'},playback:{time:0,frameId:0,frameOrdinal:0,frameCount:960,pendingTargets:0,transport:{rate:1,loop:{enabled:false,valid:false}}},comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',records:[],visible:true},interactionSettings:{showCacheStrip:false,drawingToolbar:false},preview:{width:1280,height:720,sourceWidth:1280,sourceHeight:720,quality:'720p',active:false}};
      const update=()=>ui?.update({...state,playback:{...state.playback},preview:{...state.preview}});
      async function run(name,body){const row={name,status:'running'};cases.push(row);try{Object.assign(row,await body());row.status='passed';}catch(error){row.status='failed';row.error=error.message;errors.push({name,message:error.message});}return row;}
      window.e36Diagnostic=()=>({rawInputs,rawCursors,rawPreviews,rawActual,errors,cases,resources,quick:quick?.snapshot(),state});
      for(let fixtureIndex=0;fixtureIndex<config.fixtures.length;fixtureIndex++){
        const f=config.fixtures[fixtureIndex],budget=new EVAPlayer.Budget(512*1024**2);let bitmap=await createImageBitmap(await(await fetch('/fixture/'+f.name+'.png')).blob()),generation=0;
        state.epoch++;state.duration=f.duration;state.source={id:f.name,name:f.name};state.playback={...state.playback,time:0,frameId:0,frameOrdinal:0,frameCount:f.frames,pendingTargets:0};state.preview={...state.preview,active:false};
        const precise=()=>{picture.getContext('2d').drawImage(bitmap,0,0,picture.width,picture.height);const identity=marker(picture);rawActual.push({at:performance.now(),time:f.finalTime,identity});if(identity.uncertain||identity.value!==f.expectedMarker)throw Error('Exact synthetic PNG marker mismatch');};
        const makeQuick=()=>EVAQuickPreview.createQuickPreview({canvas:picture,info:{width:f.width,height:f.height,duration:f.duration,frames:f.indexFrames},sourceUrl:'/fixture/'+f.name+'.mp4',budget,evict:()=>{},isCurrent:()=>!closed,onChange:value=>{state.preview={...state.preview,...value};const overlay=document.querySelector('.quick-preview-picture'),identity=value.active?marker(overlay):null;rawPreviews.push({at:performance.now(),fixture:f.name,target:latest?.time,inputAt:latest?.at,requestId:latest?.id,...value,identity});update();}});
        if(config.group!=='ui')quick=makeQuick();
        const session={timelineFrames:()=>f.indexFrames,setCommentsVisible(){},annotationFrame:t=>Math.floor(t*60),prioritizeRecords(){},
          seek(time,settings={}){const id=++generation;state.state='seeking';state.playback.pendingTargets=1;update();quick?.request(time,settings);return new Promise(resolve=>setTimeout(()=>{if(id!==generation)return resolve({status:'superseded'});try{precise();quick?.clear();state.state='paused';state.playback={...state.playback,time:f.finalTime,frameId:f.expectedMarker,frameOrdinal:f.expectedMarker,pendingTargets:0};update();resolve({status:'drawn'});}catch(error){resolve({status:'error'});errors.push({name:'accurate-submit',message:error.message});}},1500));},pause(){},toggle(){},step(){}};
        if(!ui){ui=EVAUI.createUI({document,window});ui.bindSession(session);}else ui.bindSession(session);update();
        if(quick){
          await run(f.name+'-cold-native-first-picture',async()=>{quick.clear();const begin=performance.now();latest={id:++requestId,at:begin,time:f.finalTime};rawInputs.push({...latest,phase:'cold-native',fixture:f.name});quick.request(f.finalTime);
            while(!quick.snapshot().active&&performance.now()-begin<2200&&!quick.snapshot().disabled)await wait(5);
            const s=quick.snapshot(),event=rawPreviews.find(e=>e.fixture===f.name&&e.requestId===latest.id&&e.active);if(!event)throw Error('No native preview picture within 2200ms: '+JSON.stringify(s));
            const firstMs=event.at-begin,errorSeconds=Math.abs(event.identity.time-f.finalTime);if(event.identity.uncertain)throw Error('Preview image marker ambiguous');
            if(firstMs>250||errorSeconds>.25)throw Error('Cold preview gap: '+JSON.stringify({firstMs,errorSeconds,marker:event.identity,nativeTime:s.time}));return{firstMs,errorSeconds,identity:event.identity,nativeTime:s.time};});
          quick.clear();
        }
        if(fixtureIndex===0&&config.group!=='media'){
          await run('real-UI-240-inputs-1500ms-image-delay',async()=>{const bounds=timeline.getBoundingClientRect(),start=performance.now(),inputStart=rawInputs.length,previewStart=rawPreviews.length,painted=[];let failed=null;
            function dispatch(type,time,id){const x=bounds.left+time/f.duration*bounds.width;latest={id,at:performance.now(),time};rawInputs.push({...latest,fixture:f.name,phase:'UI',type});const event=new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:bounds.top+bounds.height/2});(type==='pointerdown'?timeline:window).dispatchEvent(event);return latest;}
            dispatch('pointerdown',1,++requestId);
            for(let n=0;n<240;n++){const due=start+n*1000/60;await wait(Math.max(0,due-performance.now()));const time=1+(n%180)/180*(f.duration-2),input=dispatch('pointermove',time,++requestId);
              requestAnimationFrame(()=>{const left=parseFloat(thumb.style.left),row={id:input.id,inputAt:input.at,at:performance.now(),target:input.time,left,latestId:latest.id,latestTime:latest.time,
                outcome:Math.abs(left-input.time/f.duration*100)<.001?'displayed':'superseded-before-rAF',kind:'following-rAF'};rawCursors.push(row);painted.push(row);});}
            latest=dispatch('pointerup',f.finalTime,++requestId);const release=latest,releaseExpected=f.finalTime/f.duration*100;
            for(let n=0;n<12;n++){await wait(100);const left=parseFloat(thumb.style.left);rawCursors.push({id:release.id,inputAt:release.at,at:performance.now(),target:f.finalTime,left,kind:'release-pending'});if(Math.abs(left-releaseExpected)>.001)failed='Cursor rebounded before accurate submission';}
            await wait(500);await new Promise(requestAnimationFrame);if(state.playback.frameId!==f.expectedMarker||quick?.snapshot().active)throw Error('Final exact frame or quick clear failed');
            const displayed=painted.filter(row=>row.outcome==='displayed'),latencies=displayed.map(row=>row.at-row.inputAt),gaps=displayed.slice(1).map((row,n)=>row.at-displayed[n].at),p95Ms=percentile(latencies,.95),maxGapMs=Math.max(0,...gaps),style=rawCursors.filter(row=>row.kind==='style-mutation'&&row.id>=rawInputs[inputStart].id&&row.id<=release.id);
            if(failed||painted.length!==240||!displayed.length||p95Ms>33||maxGapMs>100||painted.some(row=>Math.abs(row.left-row.latestTime/f.duration*100)>.001)||style.some(row=>Math.abs(row.left-row.target/f.duration*100)>.001))throw Error(failed||'Cursor timing/ownership gap '+JSON.stringify({observations:painted.length,displayed:displayed.length,p95Ms,maxGapMs}));
            const previews=rawPreviews.slice(previewStart).filter(row=>row.active),maxPreviewGapMs=previews.length>1?Math.max(...previews.slice(1).map((row,n)=>row.at-previews[n].at)):null;
            return{inputs:240,displayed:displayed.length,supersededBeforeRAF:painted.length-displayed.length,p95Ms,maxGapMs,maxMs:Math.max(...latencies),nativePreviewUpdates:previews.length,maxPreviewGapMs,rawInputCount:rawInputs.length-inputStart,finalActual:rawActual.at(-1)};});
        }else if(quick){
          await run(f.name+'-continuous-native-preview',async()=>{const begin=rawPreviews.length;for(let n=0;n<120;n++){latest={id:++requestId,at:performance.now(),time:1+n/120*(f.duration-2)};rawInputs.push({...latest,fixture:f.name,phase:'native-continuous'});quick.request(latest.time);await wait(1000/60);}await wait(200);const rows=rawPreviews.slice(begin).filter(row=>row.active),errors=rows.filter(row=>row.identity.uncertain),lags=rows.map(row=>Math.abs(row.identity.time-row.target));
            const maxGapMs=rows.length>1?Math.max(...rows.slice(1).map((row,n)=>row.at-rows[n].at)):null;if(rows.length<8||errors.length)throw Error('Native continuous-preview gap '+JSON.stringify({updates:rows.length,ambiguous:errors.length,maxLagSeconds:Math.max(0,...lags),maxGapMs}));
            const epoch=rawPreviews.length;quick.clear();precise();await wait(150);if(quick.snapshot().active||rawPreviews.slice(epoch).some(row=>row.active))throw Error('Late preview replaced a precise generation');return{updates:rows.length,maxGapMs,p95ImageLagSeconds:percentile(lags,.95),maxImageLagSeconds:Math.max(...lags)};});
        }
        generation++;if(quick){latest={id:++requestId,at:performance.now(),time:2};rawInputs.push({...latest,fixture:f.name,phase:'close-pending'});quick.request(2);const closeAt=rawPreviews.length,closeStarted=performance.now();await quick.close();await wait(100);if(rawPreviews.slice(closeAt).some(row=>row.active))errors.push({name:'close-pending',message:'Late native preview survived close'});resources.push({fixture:f.name,closeStarted,closeReturnedAt:performance.now(),postClosePreviewEvents:rawPreviews.slice(closeAt)});}quick=null;bitmap.close();resources.push({fixture:f.name,budget:budget.snapshot(),videoNodes:document.querySelectorAll('video').length,previewCanvases:document.querySelectorAll('.quick-preview-picture').length});
        if(budget.snapshot().used||document.querySelectorAll('video,.quick-preview-picture').length)errors.push({name:'close',message:'Native preview resource ownership remains'});
      }
      closed=true;observer.disconnect();ui?.destroy();return{status:errors.length||cases.some(row=>row.status!=='passed')?'failed':'passed',userAgent:navigator.userAgent,cases,errors,resources,rawInputs,rawCursors,rawPreviews,rawActual};
    })()`);
    result.status = result.browser.status;if(result.liveEventOverflow||result.liveEventError)result.status='failed'; assert.equal(result.serverErrors.length, 0, 'Loopback fixture service failed');
    await call('Browser.close', {}, null).catch(() => {}); await exited;
  } catch (error) {
    result.status = 'failed'; result.error = error.message;
    if (evaluate && !ended && Date.now()<deadlineAt-1000) try { result.browserFailure = await evaluate('window.e36Diagnostic?.()||null'); } catch (diagnosticError) { result.diagnosticError = diagnosticError.message; }
  } finally {
    clearTimeout(deadline); if (socket) socket.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Responsive browser closed')); }
    if (!ended) child.kill(); await Promise.race([exited,pause(5000)]);
    try {
      assert(ended,'Owned Chrome child has not exited');
      if (processRecord) {
        const began = Date.now(); result.stopAttempts = [];
        do { const proof = processEvidence.proveGone(processRecord, processEvidence.snapshot()); result.stopAttempts.push({ at: new Date().toISOString(), proof }); if (proof.safe) break; await pause(100); } while (Date.now() - began < 3000);
        result.processStop = result.stopAttempts.at(-1).proof;
      } else result.processStop = { safe: false, reason: 'missing-recorded-Chrome-birth' };
    } catch (error) { result.processStop = {safe:false,reason:'Chrome-stop-proof-unavailable',message:error.message}; }
    if (!result.processStop.safe) result.status = 'failed';
    for (const stream of streams) stream.destroy(); for (const connection of sockets) connection.destroy(); await new Promise(resolve => server.close(resolve));
  }
  return result;
}
module.exports = { checkResponsiveBrowser };
