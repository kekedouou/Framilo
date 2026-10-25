'use strict';

// Explicit loopback integration harness. Source generation and cache ownership
// belong to the caller. This is independent Chrome, never Eagle acceptance.
const fs = require('fs'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkProxyPlayerBrowser({ root, scratch, client, info, ramBytes = 1024 ** 3,
  backgroundTimeoutMs = 240000, chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }) {
  if (!info || !info.streaming || !info.videoEncoding || !info.frames || info.frames.length < 4)
    throw new Error('Formal proxy Player check requires an indexed proxy session.');
  if (![512 * 1024 ** 2, 1024 ** 3].includes(ramBytes)) throw new Error('Browser fixture RAM must be 512MiB or 1GiB.');
  const result = { origin: 'independent-Chrome-formal-Player-WebCodecs-loopback-owned-cache', eagle: false,
    status: 'running', ramBytes, cases: [], serverErrors: [],
    timingBoundary: 'browser input before local control/read HTTP; ends at formal Player Canvas drawImage submission; no physical presentation measurement',
    transportLimit: 'loopback HTTP facade moves cache filesystem work outside Chromium renderer; this is not real Eagle latency',
    pixelVerification: info.expected && info.expected.barcode && info.expected.barcodes ? 'formal-Player-visible-marker' : 'not-provided; timestamps are not pixel verification',
    hardwareVerified: false };
  const scripts = {
    '/player.js': fs.readFileSync(path.join(root, 'plugin/player.js')),
    '/decoder.js': fs.readFileSync(path.join(root, 'plugin/proxy-decoder.js')),
    '/index.js': Buffer.from('(function(){const module={exports:{}};' + fs.readFileSync(path.join(root, 'plugin/frame-index.cjs'), 'utf8') + ';window.FrameIndex=module.exports;})();'),
    '/audio.js': Buffer.from('(function(){const module={exports:{}};' + fs.readFileSync(path.join(root, 'plugin/segment-audio.cjs'), 'utf8') + ';window.SegmentAudio=module.exports;})();')
  };
  let serverErrorCount = 0;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('cache-control', 'no-store');
      if (scripts[url.pathname]) { res.setHeader('content-type', 'text/javascript'); return res.end(scripts[url.pathname]); }
      if (url.pathname === '/') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.end('<!doctype html><canvas id="screen"></canvas><canvas id="thumbnail"></canvas>' +
          '<script src="/index.js"></script><script src="/audio.js"></script><script src="/decoder.js"></script><script src="/player.js"></script>');
      }
      if (url.pathname === '/info') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(info)); }
      if (url.pathname === '/frame') {
        res.setHeader('content-type', 'application/octet-stream');
        return res.end(await client.cache.readAsset(info, url.searchParams.get('file')));
      }
      if (/^\/audio\/\d+$/.test(url.pathname)) {
        const audio = await client.cache.readAudioSegment(info, Number(url.pathname.slice(7)));
        if (!audio) { res.statusCode = 204; return res.end(); }
        res.setHeader('x-start', String(audio.start)); res.setHeader('x-duration', String(audio.duration));
        res.setHeader('content-type', 'application/octet-stream'); return res.end(audio.bytes);
      }
      if (url.pathname === '/target') { await client.cache.target(info, Number(url.searchParams.get('time'))); return res.end('ok'); }
      if (url.pathname === '/prefetch') {
        if (client.cache.prefetch) client.cache.prefetch(info, Number(url.searchParams.get('time')), JSON.parse(url.searchParams.get('loop') || 'null'));
        return res.end('ok');
      }
      if (url.pathname === '/cancel') { await client.cache.cancelReads(info); return res.end('ok'); }
      res.statusCode = 404; res.end();
    } catch (error) {
      serverErrorCount++;
      if (result.serverErrors.length < 64) result.serverErrors.push({ code: error.code || 'FAILED', message: String(error.message).slice(0, 512), route: req.url.slice(0, 120) });
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('x-error-code', error.code || 'FAILED'); }
      if (!res.destroyed) res.end(String(error.message));
    }
  });
  const sockets = new Set(); server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(scratch, 'proxy-player-chrome-profile');
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--user-data-dir=' + profile, '--disk-cache-size=1048576', 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEMP: scratch, TMP: scratch } });
  let log = '', ended = false, socket = null, next = 0, session = null, evaluate = null, disposed = false;
  const pending = new Map();
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-4096); });
  const exited = new Promise(resolve => { child.once('close', () => { ended = true; resolve(); }); child.once('error', () => { ended = true; resolve(); }); });
  const deadline = setTimeout(() => child.kill(), backgroundTimeoutMs + 180000);
  function call(method, params = {}, target = session, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('Proxy Player browser timeout: ' + method)); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
    });
  }
  async function runCase(name, expression, timeoutMs) {
    try {
      const value = await evaluate(expression, timeoutMs);
      const record = { name, status: value && value.failed ? 'failed' : value && value.gap ? 'gap' : 'passed', ...value }; result.cases.push(record); return record;
    } catch (error) {
      const record = { name, status: 'failed', error: error.message }; result.cases.push(record); return record;
    }
  }
  try {
    let port; const opened = Date.now();
    while (!port && !ended && Date.now() - opened < 10000) {
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch (_) { await pause(50); }
    }
    if (!port) throw Error('Chrome startup failed: ' + log);
    socket = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result);
    });
    evaluate = async (expression, timeoutMs = 45000) => {
      const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, session, timeoutMs);
      if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
    };
    const target = await call('Target.createTarget', { url: 'http://127.0.0.1:' + server.address().port }, null);
    session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await call('Target.activateTarget', { targetId: target.targetId }, null);
    for (let n = 0; n < 100 && !await evaluate('!!(window.EVAPlayer&&window.EVAProxyDecoder)'); n++) await pause(50);
    const initialized = await runCase('formal-load', `(async()=>{
      window.info=await(await fetch('/info')).json();window.raw=[];window.errors=[];window.droppedEvents=0;window.decoders=[];
      window.phase='load';let barrier=Promise.resolve(),prefetchKey=null;
      const response=async r=>{if(!r.ok)throw Object.assign(Error(await r.text()),{code:r.headers.get('x-error-code')||'HTTP_FAILED'});return r;};
      window.percentile=(values,p=.95)=>{const v=[...values].sort((a,b)=>a-b);return v.length?v[Math.min(v.length-1,Math.ceil(v.length*p)-1)]:null;};
      window.summary=rows=>{const v=rows.filter(r=>Number.isFinite(r.ms)).map(r=>r.ms);return {count:rows.length,timed:v.length,p95Ms:percentile(v),maxMs:v.length?Math.max(...v):null,meanMs:v.length?v.reduce((a,b)=>a+b,0)/v.length:null};};
      window.player=new EVAPlayer.Player({canvas:document.getElementById('screen'),frameIndex:FrameIndex,experimentMode:'compressed-ram',forwardPredecode:true,
        ramBytes:${ramBytes},compressedRamBytes:${Math.floor(ramBytes / 8)},
        createFrameDecoder:settings=>{const d=EVAProxyDecoder.createProxyDecoder(settings);decoders.push(d);return d;},
        setMediaTarget:time=>{prefetchKey=null;barrier=barrier.then(()=>fetch('/target?time='+time)).then(response);barrier.catch(()=>{});},
        cancelMediaReads:()=>{fetch('/cancel').then(response).catch(error=>errors.push({phase:'cancel',code:error.code,message:error.message}));},
        prefetchMedia:(time,loop)=>{const key=Math.floor(time*2)+JSON.stringify(loop);if(key===prefetchKey)return;prefetchKey=key;
          fetch('/prefetch?time='+time+'&loop='+encodeURIComponent(JSON.stringify(loop))).then(response).catch(error=>errors.push({phase:'prefetch',code:error.code,message:error.message}));},
        readAsset:async(_,file)=>{await barrier;const r=await response(await fetch('/frame?file='+encodeURIComponent(file)));return new Uint8Array(await r.arrayBuffer());},
        createSegmentAudio:settings=>SegmentAudio.createSegmentAudio({...settings,read:async ordinal=>{
          await barrier;const r=await fetch('/audio/'+ordinal);if(r.status===204)return null;await response(r);
          return {bytes:new Uint8Array(await r.arrayBuffer()),start:Number(r.headers.get('x-start')),duration:Number(r.headers.get('x-duration'))};}}),
        emit:e=>{if(!['request','draw','superseded','reused','error','clock'].includes(e.type))return;
          const row={phase, ...Object.fromEntries(['type','at','requestId','kind','frameId','frameOrdinal','inputAt','drawAt','responseMs','time','targetTime','cacheStateAtInput','commitSource','status','error','code'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))};
          if(e.type==='clock')row.clockPhase=e.phase;if(e.barcode)row.barcode={actual:e.barcode.actual,expected:e.barcode.expected,ok:e.barcode.ok,uncertain:e.barcode.uncertain};
          if(raw.length<30000)raw.push(row);else droppedEvents++;
          if(e.type==='error')errors.push(row);
        }});
      const started=performance.now();await player.load(info);return {ms:performance.now()-started,snapshot:player.snapshot(),capabilities:{VideoDecoder:typeof VideoDecoder,secureContext:isSecureContext,userAgent:navigator.userAgent},failed:player.snapshot().state!=='paused'||player.snapshot().frameOrdinal!==0};
    })()`);
    if (initialized.status !== 'passed') throw Error('Formal Player initialization did not pass.');
    const statusBefore = client.cache.backgroundStatus ? client.cache.backgroundStatus(info) : null;
    const playback = await runCase('play-with-background', `(async()=>{
      phase='background-play';const eventStart=raw.length;await player.play();const start=performance.now(),from=player.snapshot().time;
      await new Promise(r=>setTimeout(r,5200));const played=player.snapshot(),end=performance.now();await player.pause();
      const buffers=raw.slice(eventStart).filter(e=>e.type==='clock'&&e.clockPhase==='supply-buffer-start');
      const advance=played.time-from;return {wallMs:end-start,mediaAdvance:advance,buffers,snapshot:played,failed:played.state==='error'||advance<4.5||buffers.length>0};
    })()`);
    playback.backgroundAtStart = statusBefore;
    playback.backgroundAtEnd = client.cache.backgroundStatus ? client.cache.backgroundStatus(info) : null;
    playback.backgroundNotCompleteExercised = !!statusBefore && statusBefore.stage !== 'complete' && statusBefore.complete !== true;
    if (!playback.backgroundNotCompleteExercised) {
      playback.scopeNote = 'Background was already complete or unobservable; simultaneous generation not verified.';
      if (playback.status === 'passed') playback.status = 'not-exercised';
    }

    const waitStarted = Date.now(); let status = null;
    while (!ended && Date.now() - waitStarted < backgroundTimeoutMs) {
      status = client.cache.backgroundStatus ? client.cache.backgroundStatus(info) : null;
      if (status && (status.complete === true || status.stage === 'complete' || ['budget', 'error', 'closed'].includes(status.stage))) break;
      await pause(250);
    }
    const complete = !!status && (status.complete === true || status.stage === 'complete');
    result.cases.push({ name: 'background-complete', status: complete ? 'passed' : 'failed', waitMs: Date.now() - waitStarted, background: status });
    if (complete) {
      await runCase('ready-SSD-random-seek', `(async()=>{
        phase='ready-SSD';await player.pause();const rows=[],selected=new Set();let seed=9341;
        const groups=info.segments.filter(g=>!g.audioOnly);const initialErrors=errors.length;
        const diskResident=ordinal=>!player.cache.has(ordinal)&&!player.compressed.has(ordinal);
        for(let n=0;n<120;n++){
          seed=(Math.imul(seed,1664525)+1013904223)>>>0;const g=groups[seed%groups.length];
          seed=(Math.imul(seed,1664525)+1013904223)>>>0;let ordinal=g.first+seed%(g.last-g.first+1),selection='random-in-segment';
          if(selected.has(ordinal)||!diskResident(ordinal)){
            let found=false;
            for(let offset=0;offset<=g.last-g.first;offset++){const candidate=g.first+(seed+offset)%(g.last-g.first+1);
              if(!selected.has(candidate)&&diskResident(candidate)){ordinal=candidate;found=true;break;}}
            if(!found){const from=seed%info.frames.length;
              for(let offset=0;offset<info.frames.length;offset++){const candidate=(from+offset)%info.frames.length;
                if(!selected.has(candidate)&&diskResident(candidate)){ordinal=candidate;found=true;break;}}}
            if(!found){for(let offset=0;offset<info.frames.length;offset++){const candidate=(seed+offset)%info.frames.length;
              if(diskResident(candidate)){ordinal=candidate;break;}}}
            selection='search-unresident';
          }
          selected.add(ordinal);
          const cached=player.cache.has(ordinal)?'RAM':player.compressed.has(ordinal)?'compressed-RAM':'disk',start=performance.now();
          const outcome=await player.seek(info.frames[ordinal].time,{index:ordinal,final:true,kind:'seek',inputAt:start});
          const state=player.snapshot();rows.push({input:n,ordinal,time:info.frames[ordinal].time,selection,cached,ms:performance.now()-start,status:outcome.status,displayed:state.frameOrdinal});
          if(state.state==='error')throw Error('Random seek entered error at input '+n);
        }
        const disk=rows.filter(r=>r.cached==='disk'),value={all:summary(rows),disk:summary(disk),rawSamples:rows,snapshot:player.snapshot()};
        value.failed=rows.some(r=>!['drawn','reused'].includes(r.status)||r.ordinal!==r.displayed)||disk.length<60||value.disk.p95Ms>100||errors.length>initialErrors;
        value.goal50msMet=value.disk.p95Ms!==null&&value.disk.p95Ms<=50;value.gap=!value.failed&&!value.goal50msMet;
        value.residencyDefinition='disk means absent from Player decoded and compressed RAM maps at issue; normal caches are not cleared; OS filesystem caching is not excluded';
        value.acceptance='SSD P95 over 100ms is failed; 50-100ms remains a gap from short-video goal';return value;
      })()`, 180000);
      await runCase('RAM-60Hz-back-and-forth-drag', `(async()=>{
        phase='RAM-warm';await player.pause();const rgba=info.width*info.height*4;
        const count=Math.max(8,Math.min(60,Math.floor(${ramBytes}/(rgba*5)),info.frames.length-1));const center=Math.floor(info.frames.length/2),first=Math.min(info.frames.length-count,Math.max(0,center-Math.floor(count/2)));
        for(let n=0;n<count;n++)await player.seek(info.frames[first+n].time,{index:first+n,kind:'seek',final:true,inputAt:performance.now()});
        phase='RAM-drag';const mark=raw.length,inputs=[],outcomes=[],pending=[],initialErrors=errors.length;const start=performance.now(),period=1000/60;let deadline=start+period;
        for(let n=0;n<240;n++){
          const wait=deadline-performance.now();if(wait>0)await new Promise(r=>setTimeout(r,wait));
          await new Promise(requestAnimationFrame);const cycle=n%(2*(count-1)),ordinal=first+(cycle<count?cycle:2*(count-1)-cycle),at=performance.now();
          inputs.push({input:n,ordinal,at,scheduledAt:deadline,latenessMs:at-deadline,intervalMs:n?at-inputs[n-1].at:null,cached:player.cache.has(ordinal)});
          deadline+=period;if(deadline<at)deadline=at+period;
          pending.push(player.seek(info.frames[ordinal].time,{index:ordinal,final:false,kind:'drag',inputAt:at}).then(outcome=>outcomes.push({input:n,ordinal,status:outcome.status,ms:performance.now()-at,requestId:outcome.requestId}),error=>outcomes.push({input:n,ordinal,status:'rejected',ms:performance.now()-at,error:error.message,code:error.code})));
        }
        const end=performance.now(),last=inputs[inputs.length-1],final=await player.seek(info.frames[last.ordinal].time,{index:last.ordinal,final:true,kind:'seek',inputAt:last.at});
        const finalWaitMs=performance.now()-last.at;await Promise.all(pending);const events=raw.slice(mark),draws=events.filter(e=>e.type==='draw'&&e.drawAt>=start&&e.drawAt<=end);
        const points=[start,...draws.map(e=>e.drawAt).sort((a,b)=>a-b),end],gaps=points.slice(1).map((t,i)=>t-points[i]);
        const settled=outcomes.filter(o=>['drawn','reused'].includes(o.status)),superseded=outcomes.filter(o=>o.status==='superseded');
        const updateHz=draws.length/((end-start)/1000),maxNoUpdateMs=Math.max(...gaps),state=player.snapshot();
        return {inputs:inputs.length,wallMs:end-start,requestedInputHz:60,inputHz:inputs.length/((end-start)/1000),inputIntervals:summary(inputs.slice(1).map(i=>({ms:i.intervalMs}))),
          inputCadence:'independent 1000/60ms deadlines followed by rAF; missed deadlines are skipped, not replayed in bursts',cacheMissInputs:inputs.filter(i=>!i.cached).length,
          drawn:draws.length,updateHz,maxNoUpdateMs,completed:summary(settled),superseded:superseded.length,finalWaitMs,finalStatus:final.status,finalOrdinal:state.frameOrdinal,expectedFinalOrdinal:last.ordinal,
          rawInputs:inputs,rawOutcomes:outcomes,rawEvents:events,snapshot:state,
          failed:updateHz<30||maxNoUpdateMs>100||finalWaitMs>100||state.frameOrdinal!==last.ordinal||inputs.some(i=>!i.cached)||settled.length<120||summary(settled).p95Ms>50||errors.length>initialErrors,
          acceptance:'all 240 inputs retained; superseded inputs are counted rather than dropped from results; P95 is for drawn/reused requests and must be read with update Hz, no-update gaps and outcomes'};
      })()`, 180000);
    }

    await runCase('loop-step-thumbnail', `(async()=>{
      phase='features';await player.pause();await player.clearLoop();const first=Math.min(info.frames.length-3,Math.max(0,Math.floor(info.frames.length*.2))),last=Math.min(info.frames.length-1,first+Math.max(2,Math.floor(info.frames.length/info.duration*.5)));
      await player.applyLoopRange({startOrdinal:first,endOrdinal:last});await new Promise(r=>setTimeout(r,1500));const loop=player.snapshot();
      await player.pause();await player.clearLoop();const middle=Math.min(info.frames.length-2,first+1);await player.seek(info.frames[middle].time,{index:middle,final:true,kind:'seek',inputAt:performance.now()});
      await player.step(1);const forward=player.snapshot().frameOrdinal;await player.step(-1);const backward=player.snapshot().frameOrdinal;
      const canvas=document.getElementById('thumbnail'),lease=await player.paintThumbnail(info.frames[middle].time,canvas),thumbnail={available:!!lease,width:canvas.width,height:canvas.height};if(lease)lease.release();
      return {loop,forward,backward,middle,thumbnail,failed:loop.state!=='playing'||loop.frameOrdinal<first||loop.frameOrdinal>last||forward!==middle+1||backward!==middle||!thumbnail.available};
    })()`);
    const closed = await runCase('dispose-budget', `(async()=>{
      phase='close';await player.dispose();const snapshot=player.snapshot(),decoderStates=decoders.map(d=>d.snapshot());
      return {snapshot,decoderStates,failed:snapshot.budget.used!==0||decoderStates.some(d=>d.pending||d.nativePending||d.bitmapConversions||d.state!=='closed')};
    })()`);
    disposed = closed.status === 'passed';
    result.diagnostic = await evaluate('({snapshot:player.snapshot(),errors,rawEvents:raw,droppedEvents,decoders:decoders.map(d=>d.snapshot())})');
    result.serverErrorCount = serverErrorCount;
    const genuineServerErrors = result.serverErrors.filter(e => !['MEDIA_CANCELLED', 'PROXY_DECODER_CLOSED'].includes(e.code));
    const pixelEvents = result.diagnostic.rawEvents.filter(e => e.barcode);
    result.pixelChecks = { provided: result.pixelVerification !== 'not-provided; timestamps are not pixel verification',
      attempted: pixelEvents.length, failed: pixelEvents.filter(e => e.barcode.ok === false).length,
      uncertain: pixelEvents.filter(e => e.barcode.uncertain || e.barcode.ok === null).length };
    const pixelFailure = result.pixelChecks.provided && (!result.pixelChecks.attempted || result.pixelChecks.failed || result.pixelChecks.uncertain);
    result.status = result.cases.some(c => c.status === 'failed') || result.diagnostic.errors.length || result.diagnostic.droppedEvents || genuineServerErrors.length || pixelFailure
      ? 'failed' : result.cases.some(c => c.status === 'gap') ? 'gap' : result.cases.some(c => c.status === 'not-exercised') ? 'incomplete' : 'passed';
    await call('Browser.close', {}, null).catch(() => {}); await exited;
  } catch (error) {
    result.status = 'failed'; result.error = error.message;
    if (evaluate && !ended) {
      try { result.diagnostic = await evaluate('window.player?({snapshot:player.snapshot(),errors:window.errors||[],rawEvents:window.raw||[],droppedEvents:window.droppedEvents||0,decoders:window.decoders?decoders.map(d=>d.snapshot()):[]}):null'); }
      catch (diagnosticError) { result.diagnosticError = diagnosticError.message; }
    }
  } finally {
    if (!disposed && evaluate && !ended) {
      try { result.cleanupSnapshot = await evaluate('(async()=>{if(window.player)await player.dispose();return window.player?player.snapshot():null;})()'); }
      catch (error) { result.cleanupError = error.message; result.status = 'failed'; }
    }
    clearTimeout(deadline); if (socket) socket.close();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Proxy Player browser check closed')); }
    if (!ended) child.kill(); await exited;
    for (const connection of sockets) connection.destroy(); await new Promise(resolve => server.close(resolve));
  }
  return result;
}

module.exports = { checkProxyPlayerBrowser };
