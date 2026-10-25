'use strict';

// Explicit E36 integration harness, copied from the frozen E35 performance
// protocol. Caller owns synthetic source, cache, budget and scratch cleanup.
// No source generation or deletion here; independent Chrome is not Eagle.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { spawn } = require('child_process');
const processEvidence = require('../../plugin/process-identity.cjs')._test;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkProxyPlayerBrowser({ root, scratch, client, info, ramBytes = 512 * 1024 ** 2,
  backgroundTimeoutMs = 30000, playDurationMs = 5200, requireAudio = false, requireBackgroundOverlap = false,
  chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }) {
  if (!info || !info.streaming || !info.videoEncoding || !info.frames || info.frames.length < 4)
    throw new Error('Formal proxy Player check requires an indexed proxy session.');
  if (![512 * 1024 ** 2, 1024 ** 3].includes(ramBytes)) throw new Error('Browser fixture RAM must be 512MiB or 1GiB.');
  assert(info.width===1280&&info.height===720&&info.frames.length===960&&info.frames.every((frame,n)=>Math.abs(frame.time-n/60)<1e-8),
    'E36 record pixel gate is limited to its registered 1280x720/960-frame/60fps/zero-origin 10-bit-cell CFR synthetic source');
  assert.equal(typeof client.cache.isFrameReady,'function','Formal Session ready-only RAM prefetch capability is required');
  if (playDurationMs !== 5200 || typeof requireAudio !== 'boolean' || typeof requireBackgroundOverlap !== 'boolean' ||
      !Number.isFinite(backgroundTimeoutMs) || backgroundTimeoutMs < 1 || backgroundTimeoutMs > 30000) throw new Error('E36 playback/background scope is not registered.');
  if (requireAudio && !info.audio) throw new Error('Continuous audio check needs an actual source audio stream.');
  if (playDurationMs === 600000 && info.duration < 610) throw new Error('Ten-minute playback needs a source longer than its observation window.');
  const maxRawEvents = playDurationMs === 600000 ? 250000 : 30000;
  const result = { origin: 'E36-independent-Chrome-formal-Player-WebCodecs-loopback-read-thread-owned-cache', eagle: false,
    status: 'running', ramBytes, cases: [], serverErrors: [],
    timingBoundary: 'browser input before local control/read HTTP; ends at formal Player Canvas drawImage submission; no physical presentation measurement',
    transportLimit: 'loopback HTTP facade invokes the formal client/cache read thread; HTTP and independent Chrome remain outside real Eagle latency',
    pixelVerification: info.expected && info.expected.barcode && info.expected.barcodes ? 'formal-Player-visible-marker' : 'not-provided; timestamps are not pixel verification',
    recordPixelVerification:'only the registered E36 1280x720/960-frame CFR fixture: white 16x16 cells at x=12+20*bit,y=8 encode the source ordinal; no arbitrary-source pixel claim',
    readinessTransport:'Harness parity repair: formal app/Session synchronously queries client isFrameReady; independent Chrome samples that metadata over /ready every 50ms with one request, then queries a local Set. The original fourth run omitted this signal; that omission is not proof of its buffering root cause.',
    hardwareVerified: false };
  const scripts = {
    '/player.js': fs.readFileSync(path.join(root, 'plugin/player.js')),
    '/decoder.js': fs.readFileSync(path.join(root, 'plugin/proxy-decoder.js')),
    '/records.js': fs.readFileSync(path.join(root,'plugin/record-previews.js')),
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
          '<script src="/index.js"></script><script src="/audio.js"></script><script src="/decoder.js"></script><script src="/player.js"></script><script src="/records.js"></script>');
      }
      if (url.pathname === '/info') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(info)); }
      if(url.pathname==='/ready'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(info.segments.flatMap((group,ordinal)=>client.cache.isFrameReady(info,group.first)?[ordinal]:[])));}
      if (url.pathname === '/frame') {
        res.setHeader('content-type', 'application/octet-stream');
        return res.end(await client.cache.readAsset(info, url.searchParams.get('file')));
      }
      if(/^\/record\/\d+$/.test(url.pathname)){
        const ordinal=Number(url.pathname.slice(8));if(!Number.isSafeInteger(ordinal)||!info.frames[ordinal])throw Error('Invalid registered record ordinal');
        const controller=new AbortController(),abort=()=>controller.abort(),closed=()=>{if(!res.writableEnded)abort();};req.once('aborted',abort);res.once('close',closed);
        try{const picture=await client.cache.readRecordFrame(info,ordinal,{signal:controller.signal,priority:'idle'});
          res.setHeader('content-type','image/jpeg');res.setHeader('x-width',String(picture.width));res.setHeader('x-height',String(picture.height));res.setHeader('x-ordinal',String(picture.ordinal));return res.end(picture.bytes);
        }finally{req.removeListener('aborted',abort);res.removeListener('close',closed);}
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
  assert.equal(typeof WebSocket,'function','Use the existing Node24 developer runtime; no dependency may be installed');
  const sockets = new Set(); server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(scratch, 'responsive-player-chrome-profile');
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--user-data-dir=' + profile, '--disk-cache-size=1048576', 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEMP: scratch, TMP: scratch } });
  let log = '', ended = false, socket = null, next = 0, session = null, evaluate = null, disposed = false,processRecord=null;
  const pending = new Map();
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-4096); });
  const exited = new Promise(resolve => { child.once('close', () => { ended = true; resolve(); }); child.once('error', () => { ended = true; resolve(); }); });
  const deadline = setTimeout(() => child.kill(), backgroundTimeoutMs + 120000);
  function captureProcesses(){
    const rows=processEvidence.snapshot(),own=rows.find(row=>row.pid===child.pid);
    if(!processRecord){assert(processEvidence.valid(own),'Actual Chrome birth/image unavailable');processRecord={processIdentity:own,children:[]};}
    else if(own)assert(processEvidence.same(processRecord.processIdentity,own),'Chrome root birth/image changed');
    const identities=new Map(processRecord.children.map(entry=>[entry.identity.pid,entry.identity])),ids=new Set([processRecord.processIdentity.pid]);
    if(own){let more=true;while(more){more=false;for(const row of rows)if(!ids.has(row.pid)&&ids.has(row.parentPid)){assert(processEvidence.valid(row),'Chrome child birth/image unavailable');ids.add(row.pid);const prior=identities.get(row.pid);if(prior)assert(processEvidence.same(prior,row),'Chrome child PID was reused');identities.set(row.pid,row);more=true;}}}
    processRecord.children=[...identities.values()].map(identity=>({state:'closed',identity}));result.chromeProcesses=processRecord;
  }
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
    captureProcesses();
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
    for (let n = 0; n < 100 && !await evaluate('!!(window.EVAPlayer&&window.EVAProxyDecoder&&window.EVARecordPreviews)'); n++) await pause(50);
    const initialized = await runCase('formal-load', `(async()=>{
      window.info=await(await fetch('/info')).json();window.raw=[];window.errors=[];window.droppedEvents=0;window.decoders=[];window.audioReads=[];window.audioReadOverflow=0;window.records=null;window.recordTrace=[];
      window.phase='load';let barrier=Promise.resolve(),prefetchKey=null;
      const response=async r=>{if(!r.ok)throw Object.assign(Error(await r.text()),{code:r.headers.get('x-error-code')||'HTTP_FAILED'});return r;};
      window.keepRaw=row=>{if(raw.length<${maxRawEvents})raw.push(row);else droppedEvents++;};
      window.readySegments=new Set();window.readyPoll={closed:false,timer:null,active:null,requests:0};
      window.fetchReady=()=>{if(readyPoll.closed)return Promise.resolve();if(readyPoll.active)return readyPoll.active.promise;
        const work={controller:new AbortController(),promise:null},started=performance.now();readyPoll.requests++;
        work.promise=(async()=>{try{const r=await response(await fetch('/ready',{signal:work.controller.signal})),values=await r.json();
          if(!Array.isArray(values)||values.length>info.segments.length||values.some(n=>!Number.isSafeInteger(n)||n<0||n>=info.segments.length))throw Error('Invalid ready-segment metadata');
          if(!readyPoll.closed){readySegments=new Set(values);keepRaw({type:'ready',phase,eventPhase:'ready-adapter-poll',at:performance.now(),started,ended:performance.now(),segments:values,metadataOnly:true});}
        }catch(error){if(!readyPoll.closed){errors.push({phase:'ready-adapter',error:error.message});throw error;}}finally{if(readyPoll.active===work)readyPoll.active=null;}})();
        readyPoll.active=work;return work.promise;};
      window.stopReadyPolling=async()=>{readyPoll.closed=true;if(readyPoll.timer!==null){clearInterval(readyPoll.timer);readyPoll.timer=null;}const active=readyPoll.active;if(active){active.controller.abort();await Promise.allSettled([active.promise]);}
        return {closed:readyPoll.closed,timerActive:readyPoll.timer!==null,pending:!!readyPoll.active,requests:readyPoll.requests,segments:[...readySegments]};};
      await fetchReady();readyPoll.timer=setInterval(()=>{if(!readyPoll.closed&&!readyPoll.active)fetchReady().catch(()=>{});},50);
      window.percentile=(values,p=.95)=>{const v=[...values].sort((a,b)=>a-b);return v.length?v[Math.min(v.length-1,Math.ceil(v.length*p)-1)]:null;};
      window.summary=rows=>{const v=rows.filter(r=>Number.isFinite(r.ms)).map(r=>r.ms);return {count:rows.length,timed:v.length,p95Ms:percentile(v),maxMs:v.length?Math.max(...v):null,meanMs:v.length?v.reduce((a,b)=>a+b,0)/v.length:null};};
      window.player=new EVAPlayer.Player({canvas:document.getElementById('screen'),frameIndex:FrameIndex,experimentMode:'compressed-ram',forwardPredecode:true,
        ramBytes:${ramBytes},compressedRamBytes:${Math.floor(ramBytes / 8)},
        canPrefetchFrame:ordinal=>{if(!Number.isSafeInteger(ordinal)||!info.frames[ordinal])return false;const time=info.frames[ordinal].time;let low=0,high=info.segments.length;
          while(low<high){const mid=(low+high)>>>1;if(info.segments[mid].start<=time)low=mid+1;else high=mid;}return readySegments.has(Math.max(0,low-1));},
        createFrameDecoder:settings=>{const d=EVAProxyDecoder.createProxyDecoder(settings);decoders.push(d);return d;},
        setMediaTarget:time=>{prefetchKey=null;barrier=barrier.then(()=>fetch('/target?time='+time)).then(response);barrier.catch(()=>{});},
        cancelMediaReads:()=>{fetch('/cancel').then(response).catch(error=>errors.push({phase:'cancel',code:error.code,message:error.message}));},
        prefetchMedia:(time,loop)=>{const key=Math.floor(time*2)+JSON.stringify(loop);if(key===prefetchKey)return;prefetchKey=key;
          fetch('/prefetch?time='+time+'&loop='+encodeURIComponent(JSON.stringify(loop))).then(response).catch(error=>errors.push({phase:'prefetch',code:error.code,message:error.message}));},
        readAsset:async(_,file)=>{await barrier;const r=await response(await fetch('/frame?file='+encodeURIComponent(file)));return new Uint8Array(await r.arrayBuffer());},
        createSegmentAudio:settings=>SegmentAudio.createSegmentAudio({...settings,read:async ordinal=>{
          const row={ordinal,phase,started:performance.now(),status:'pending'};if(audioReads.length<5000)audioReads.push(row);else audioReadOverflow++;
          try{await barrier;const r=await fetch('/audio/'+ordinal);if(r.status===204){row.status='empty';return null;}await response(r);
          const value={bytes:new Uint8Array(await r.arrayBuffer()),start:Number(r.headers.get('x-start')),duration:Number(r.headers.get('x-duration'))};
          Object.assign(row,{status:'ready',start:value.start,duration:value.duration,bytes:value.bytes.byteLength});return value;
          }catch(error){Object.assign(row,{status:'failed',error:error.message,code:error.code});throw error;}finally{row.ended=performance.now();}}}),
        emit:e=>{if(!['request','draw','superseded','reused','error','clock','ready','cache'].includes(e.type))return;
          const row={phase, ...Object.fromEntries(['type','at','requestId','kind','frameId','frameOrdinal','inputAt','drawAt','responseMs','time','targetTime','mediaTime','method','audioContextStart','sincePreviousDrawMs','cacheStateAtInput','commitSource','status','error','code'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]]))};
          if(e.type==='ready'||e.type==='cache')Object.assign(row,e,{phase,eventPhase:e.phase});
          if(e.type==='clock')row.clockPhase=e.phase;if(e.barcode)row.barcode={actual:e.barcode.actual,expected:e.barcode.expected,ok:e.barcode.ok,uncertain:e.barcode.uncertain};
          keepRaw(row);
          if(e.type==='error')errors.push(row);
        }});
      const started=performance.now();await player.load(info);return {ms:performance.now()-started,snapshot:player.snapshot(),capabilities:{VideoDecoder:typeof VideoDecoder,secureContext:isSecureContext,userAgent:navigator.userAgent},failed:player.snapshot().state!=='paused'||player.snapshot().frameOrdinal!==0};
    })()`);
    if (initialized.status !== 'passed') throw Error('Formal Player initialization did not pass.');
    const statusBefore = client.cache.backgroundStatus ? client.cache.backgroundStatus(info) : null;
    const backgroundObservedAt = Date.now();
    const playback = await runCase('play-with-background', `(async()=>{
      phase='background-play';const eventStart=raw.length;await player.play();const start=performance.now(),from=player.snapshot().time;
      const aux=player.auxiliaryBudget(),recordTargets=[0,Math.floor(info.frames.length/2),info.frames.length-1],recordStarted=performance.now(),recordDeadline=recordStarted+${playDurationMs};
      const recordMarker=canvas=>{const ctx=canvas.getContext('2d'),sx=canvas.width/1280,sy=canvas.height/720,levels=[];let value=0,uncertain=false;
        for(let bit=0;bit<10;bit++){const p=ctx.getImageData(Math.floor((20+bit*20)*sx),Math.floor(16*sy),1,1).data,level=(p[0]+p[1]+p[2])/3;levels.push(level);if(level>80&&level<175)uncertain=true;if(level>=175)value|=1<<bit;}return {value,uncertain,levels};};
      window.records=EVARecordPreviews.createRecordPreviews({info,budget:aux.budget,evict:aux.evict,isCurrent:()=>phase==='background-play',busy:()=>player.snapshot().state==='seeking',
        read:async(ordinal,settings)=>{const row={kind:'read',ordinal,priority:settings.priority,started:performance.now(),stateAtStart:player.snapshot().state};recordTrace.push(row);
          try{const response=await fetch('/record/'+ordinal,{signal:settings.signal});if(!response.ok)throw Error(await response.text());const value={bytes:new Uint8Array(await response.arrayBuffer()),width:Number(response.headers.get('x-width')),height:Number(response.headers.get('x-height')),ordinal:Number(response.headers.get('x-ordinal'))};
            Object.assign(row,{status:'ready',ended:performance.now(),stateAtEnd:player.snapshot().state,bytes:value.bytes.byteLength,width:value.width,height:value.height,returnedOrdinal:value.ordinal});return value;
          }catch(error){Object.assign(row,{status:'failed',ended:performance.now(),stateAtEnd:player.snapshot().state,error:error.message});throw error;}}});
      records.prioritize({all:recordTargets,visible:recordTargets});
      const recordWork=(async()=>{
        try{let snapshot=records.snapshot();
          while(snapshot.frames<recordTargets.length&&performance.now()<recordDeadline&&player.snapshot().state==='playing'){
            if(recordTrace.length<2000)recordTrace.push({kind:'poll',at:performance.now(),playerState:player.snapshot().state,...snapshot});await new Promise(r=>setTimeout(r,10));snapshot=records.snapshot();}
          const readyAt=performance.now(),readyState=player.snapshot(),readyMs=readyAt-recordStarted,paints=[];
          if(snapshot.frames!==3||snapshot.pending||readyState.state!=='playing'||readyAt>=recordDeadline)throw Error('Record prewarm did not finish all three frames while playing: '+JSON.stringify({snapshot,readyState:readyState.state,readyMs}));
          if(snapshot.frames>96||snapshot.bytes>snapshot.limit||snapshot.limit!==Math.min(16*1024**2,Math.floor(aux.budget.snapshot().limit/32)))throw Error('Record pool exceeded its shared RAM limit');
          for(const ordinal of recordTargets){const canvas=document.createElement('canvas'),before=player.snapshot(),budgetBefore=aux.budget.snapshot(),lease=await records.paint(ordinal,canvas);if(!lease)throw Error('Prepared record could not paint '+ordinal);
            const after=player.snapshot(),marker=recordMarker(canvas),row={ordinal,at:performance.now(),width:canvas.width,height:canvas.height,marker,before:{state:before.state,time:before.time,frameOrdinal:before.frameOrdinal},after:{state:after.state,time:after.time,frameOrdinal:after.frameOrdinal},budgetBefore,budgetPainted:aux.budget.snapshot()};
            try{if(canvas.width!==240||canvas.height!==135||marker.uncertain||marker.value!==ordinal)throw Error('Actual resized record pixels do not match exact source ordinal '+ordinal+': '+JSON.stringify(marker));
              if(before.state!=='playing'||after.state!==before.state||after.time!==before.time||after.frameOrdinal!==before.frameOrdinal)throw Error('Record paint changed the main Player frame/time/state');
            }finally{lease.release();row.released={width:canvas.width,height:canvas.height,budget:aux.budget.snapshot()};paints.push(row);recordTrace.push({kind:'paint',...row});}
            if(canvas.width!==1||canvas.height!==1)throw Error('Record canvas lease was not reset');
          }
          const reads=recordTrace.filter(row=>row.kind==='read');if(reads.length!==3||reads.some(row=>row.status!=='ready'||row.priority!=='idle'||row.stateAtStart!=='playing'||row.stateAtEnd!=='playing'))throw Error('Record first batch was not three successful idle reads during playback');
          return {failed:false,targets:recordTargets,started:recordStarted,readyAt,readyMs,readyState:readyState.state,snapshot,paints,reads,scope:'actual default createImageBitmap JPEG resize and independent record paint during the 5.2s formal Player playback; fixed E36 CFR cell fixture'};
        }catch(error){return {failed:true,error:error.message,snapshot:records.snapshot(),readyState:player.snapshot().state,rawTrace:recordTrace.slice()};}
      })();
      await new Promise(r=>setTimeout(r,${playDurationMs}));const played=player.snapshot(),end=performance.now();await player.pause();
      const recordPreviews=await recordWork;
      const events=raw.slice(eventStart),buffers=events.filter(e=>e.type==='clock'&&e.clockPhase==='supply-buffer-start');
      const draws=events.filter(e=>e.type==='draw'),lags=draws.filter(e=>Number.isFinite(e.mediaTime)&&Number.isFinite(e.time)).map(e=>Math.abs(e.mediaTime-e.time)*1000);
      const bounds=[start,...draws.map(e=>e.drawAt),end],gaps=bounds.slice(1).map((at,n)=>at-bounds[n]),maxDrawGapMs=gaps.length?Math.max(...gaps):null;
      const videoClock={scope:'decoded frame PTS at Canvas submission versus formal Player output-clock estimate; physical sound/screen timing unmeasured',samples:lags.length,p95LagMs:percentile(lags),maxLagMs:lags.length?Math.max(...lags):null,drawHz:draws.length/((end-start)/1000),maxDrawGapMs};
      const advance=played.time-from,extended=${playDurationMs === 600000},audioRequired=${requireAudio},epsilon=1/48000+.000001;
      const relevant=audioReads.filter(r=>{const g=info.segments[r.ordinal];return g&&g.start<played.time&&g.end>from;});
      const ranges=relevant.filter(r=>r.status==='ready'&&Number.isFinite(r.start)&&r.duration>0&&r.bytes>44).map(r=>({start:r.start,end:r.start+r.duration})).sort((a,b)=>a.start-b.start);
      let covered=from;const holes=[];for(const r of ranges){if(r.end<=covered)continue;if(r.start>covered+epsilon)holes.push({start:covered,end:Math.min(r.start,played.time)});covered=Math.max(covered,r.end);if(covered>=played.time-epsilon)break;}
      if(covered<played.time-epsilon)holes.push({start:covered,end:played.time});
      const audioCoverage={scope:'nonempty validated segment data requested by the formal audio scheduler; physical sound output unmeasured',from,to:played.time,requests:relevant.length,coveredTo:covered,holes,emptyOrFailed:relevant.filter(r=>r.status==='empty'||r.status==='failed'),complete:holes.length===0&&relevant.every(r=>r.status==='ready'&&Number.isFinite(r.start)&&r.duration>0&&r.bytes>44)&&!audioReadOverflow};
      return {requestedWallMs:${playDurationMs},wallMs:end-start,mediaAdvance:advance,advanceMinusWallMs:advance*1000-(end-start),buffers,snapshot:played,videoClock,audioCoverage,recordPreviews,rawAudioReads:audioReads.map(r=>({...r})),failed:played.state==='error'||advance<${playDurationMs === 600000 ? '(end-start)/1000-.25' : 4.5}||buffers.length>0||(audioRequired&&(!played.audioAvailable||!audioCoverage.complete))||(extended&&(!lags.length||videoClock.p95LagMs>50||videoClock.maxLagMs>100||maxDrawGapMs>100||videoClock.drawHz<30))};
    })()`, playDurationMs + 60000);
    result.cases.push({name:'record-previews-while-playing',status:playback.recordPreviews&&!playback.recordPreviews.failed?'passed':'failed',...playback.recordPreviews});
    await runCase('record-previews-close',`(async()=>{if(records)await records.close();const snapshot=records?.snapshot(),budget=player.auxiliaryBudget().budget.snapshot(),kinds=budget.kinds||{};
      return {snapshot,budget,rawTrace:recordTrace,failed:!snapshot||snapshot.frames!==0||snapshot.bytes!==0||snapshot.pending!==0||['record-preview-loading','record-preview-cache','record-thumbnail'].some(kind=>kinds[kind])};})()`);
    playback.backgroundAtStart = statusBefore;
    playback.backgroundAtEnd = client.cache.backgroundStatus ? client.cache.backgroundStatus(info) : null;
    playback.backgroundNotCompleteExercised = !!statusBefore && statusBefore.stage !== 'complete' && statusBefore.complete !== true;
    if (!playback.backgroundNotCompleteExercised) {
      playback.scopeNote = 'Background was already complete or unobservable; simultaneous generation not verified.';
      if (requireBackgroundOverlap && playback.status === 'passed') playback.status = 'not-exercised';
    }

    const waitStarted = Date.now(), waitBudgetMs = playDurationMs === 600000 ? Math.max(0, backgroundTimeoutMs - (waitStarted - backgroundObservedAt)) : backgroundTimeoutMs;
    let status = client.cache.backgroundStatus ? client.cache.backgroundStatus(info) : null;
    while (!ended && Date.now() - waitStarted < waitBudgetMs) {
      status = client.cache.backgroundStatus ? client.cache.backgroundStatus(info) : null;
      if (status && (status.complete === true || status.stage === 'complete' || ['budget', 'error', 'closed'].includes(status.stage))) break;
      await pause(250);
    }
    const complete = !!status && (status.complete === true || status.stage === 'complete');
    result.cases.push({ name: 'background-complete', status: complete ? 'passed' : 'failed', waitMs: Date.now() - waitStarted,
      ...(playDurationMs === 600000 ? { observedMs: Date.now() - backgroundObservedAt, includesPlaybackObservation: true } : {}), background: status });
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
        value.failed=rows.length!==120||rows.some(r=>r.status!=='drawn'||r.ordinal!==r.displayed)||disk.length!==120||value.disk.p95Ms===null||value.disk.p95Ms>50||errors.length>initialErrors;
        value.goal50msMet=value.disk.p95Ms!==null&&value.disk.p95Ms<=50;
        value.residencyDefinition='disk means absent from Player decoded and compressed RAM maps at issue; normal caches are not cleared; OS filesystem caching is not excluded';
        value.acceptance='All 120 samples must be absent from both Player RAM maps at issue, actually drawn at the requested ordinal, and SSD P95 must be <=50ms';return value;
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
          failed:inputs.length!==240||updateHz<30||maxNoUpdateMs>100||finalWaitMs>100||!['drawn','reused'].includes(final.status)||state.frameOrdinal!==last.ordinal||inputs.some(i=>!i.cached)||settled.length<120||summary(settled).p95Ms>50||errors.length>initialErrors,
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
      phase='close';if(window.records)await records.close();const readiness=await stopReadyPolling();await player.dispose();const snapshot=player.snapshot(),decoderStates=decoders.map(d=>d.snapshot());
      return {snapshot,decoderStates,readiness,failed:readiness.pending||readiness.timerActive||!readiness.closed||snapshot.budget.used!==0||decoderStates.some(d=>d.pending||d.nativePending||d.bitmapConversions||d.state!=='closed')};
    })()`);
    disposed = closed.status === 'passed';
    result.diagnostic = await evaluate('({snapshot:player.snapshot(),errors,rawEvents:raw,droppedEvents,audioReadOverflow,decoders:decoders.map(d=>d.snapshot())})');
    result.serverErrorCount = serverErrorCount;
    const genuineServerErrors = result.serverErrors.filter(e => !['MEDIA_CANCELLED', 'PROXY_DECODER_CLOSED'].includes(e.code));
    const pixelEvents = result.diagnostic.rawEvents.filter(e => e.barcode);
    result.pixelChecks = { provided: result.pixelVerification !== 'not-provided; timestamps are not pixel verification',
      attempted: pixelEvents.length, failed: pixelEvents.filter(e => e.barcode.ok === false).length,
      uncertain: pixelEvents.filter(e => e.barcode.uncertain || e.barcode.ok === null).length };
    const pixelFailure = result.pixelChecks.provided && (!result.pixelChecks.attempted || result.pixelChecks.failed || result.pixelChecks.uncertain);
    result.status = result.cases.some(c => c.status === 'failed') || result.diagnostic.errors.length || result.diagnostic.droppedEvents || result.diagnostic.audioReadOverflow || genuineServerErrors.length || pixelFailure
      ? 'failed' : result.cases.some(c => c.status === 'gap') ? 'gap' : result.cases.some(c => c.status === 'not-exercised') ? 'incomplete' : 'passed';
    captureProcesses();await call('Browser.close', {}, null).catch(() => {}); await exited;
  } catch (error) {
    result.status = 'failed'; result.error = error.message;
    if (evaluate && !ended) {
      try { result.diagnostic = await evaluate('window.player?({snapshot:player.snapshot(),errors:window.errors||[],rawEvents:window.raw||[],droppedEvents:window.droppedEvents||0,decoders:window.decoders?decoders.map(d=>d.snapshot()):[]}):null'); }
      catch (diagnosticError) { result.diagnosticError = diagnosticError.message; }
    }
  } finally {
    if (!disposed && evaluate && !ended) {
      try { result.cleanupSnapshot = await evaluate('(async()=>{if(window.records)await records.close();if(window.stopReadyPolling)await stopReadyPolling();if(window.player)await player.dispose();return window.player?player.snapshot():null;})()'); }
      catch (error) { result.cleanupError = error.message; result.status = 'failed'; }
    }
    if(!ended)try{captureProcesses();}catch(error){result.processCaptureError=error.message;result.status='failed';}
    clearTimeout(deadline); if (socket) socket.close();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Proxy Player browser check closed')); }
    if (!ended) child.kill(); await Promise.race([exited,pause(5000)]);
    try{
      assert(ended,'Owned Chrome child has not exited');
      if(processRecord){const began=Date.now();result.stopAttempts=[];do{const proof=processEvidence.proveGone(processRecord,processEvidence.snapshot());result.stopAttempts.push({at:new Date().toISOString(),proof});if(proof.safe)break;await pause(100);}while(Date.now()-began<3000);result.processStop=result.stopAttempts[result.stopAttempts.length-1].proof;}
      else result.processStop={safe:false,reason:'missing-recorded-Chrome-birth'};
    }catch(error){result.processStop={safe:false,reason:'Chrome-stop-proof-unavailable',message:error.message};}
    if(result.processCaptureError)result.processStop={safe:false,reason:'Chrome-process-capture-incomplete',proof:result.processStop,error:result.processCaptureError};
    if(!result.processStop.safe)result.status='failed';
    result.safeToClean=result.safeToCleanup=!!result.processStop.safe;
    for (const connection of sockets) connection.destroy(); await new Promise(resolve => server.close(resolve));
  }
  return result;
}

module.exports = { checkProxyPlayerBrowser };
