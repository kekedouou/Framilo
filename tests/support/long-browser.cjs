'use strict';
// Explicit synthetic-only Chrome check called by check-long-media. Never Eagle.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { spawn } = require('child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function checkBrowser({ root, scratch, client, info, throughput = false }) {
  const seekOrdinal = info.frames.findIndex(f=>f.time>=31.5), loopFirst=info.frames.findIndex(f=>f.time>=31),loopLast=seekOrdinal-1;
  const scripts = {
    '/player.js': fs.readFileSync(path.join(root, 'plugin/player.js')),
    '/index.js': Buffer.from('(function(){const module={exports:{}};' + fs.readFileSync(path.join(root, 'plugin/frame-index.cjs'), 'utf8') + ';window.FrameIndex=module.exports;})();'),
    '/audio.js': Buffer.from('(function(){const module={exports:{}};' + fs.readFileSync(path.join(root, 'plugin/segment-audio.cjs'), 'utf8') + ';window.SegmentAudio=module.exports;})();')
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (scripts[url.pathname]) { res.setHeader('content-type', 'text/javascript'); return res.end(scripts[url.pathname]); }
      if (url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<!doctype html><canvas id="screen"></canvas><script src="/index.js"></script><script src="/audio.js"></script><script src="/player.js"></script>'); }
      if (url.pathname === '/target') {client.cache.target(info,Number(url.searchParams.get('time')));return res.end('ok');}
      if (url.pathname === '/cancel') {client.cache.cancelReads(info);return res.end('ok');}
      if (url.pathname === '/prefetch') {if(client.cache.prefetch)client.cache.prefetch(info,Number(url.searchParams.get('time')),JSON.parse(url.searchParams.get('loop')||'null'));return res.end('ok');}
      if (url.pathname === '/info') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(info)); }
      if (url.pathname === '/frame') return res.end(await client.cache.readAsset(info, url.searchParams.get('file')));
      if (/^\/audio\/\d+$/.test(url.pathname)) {
        const audio = await client.cache.readAudioSegment(info, Number(url.pathname.slice(7)));
        if (!audio) { res.statusCode = 204; return res.end(); }
        res.setHeader('x-start', String(audio.start)); res.setHeader('x-duration', String(audio.duration)); return res.end(audio.bytes);
      }
      res.statusCode = 404; res.end();
    } catch (error) { res.statusCode = 500; res.setHeader('x-error-code',error.code||'FAILED'); res.end(String(error.message)); }
  });
  const sockets = new Set(); server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(scratch, 'chrome-profile'), chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--user-data-dir=' + profile, '--disk-cache-size=1048576', 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEMP: scratch, TMP: scratch } });
  let log = '', socket, next = 0, session, ended = false; const pending = new Map();
  child.stderr.on('data', b => { log = (log + b).slice(-2048); });
  const exited = new Promise(resolve => { child.once('close', () => { ended = true; resolve(); }); child.once('error', () => { ended = true; resolve(); }); });
  const deadline = setTimeout(() => child.kill(), 90000);
  try {
    const began = Date.now(); let port;
    while (!port && Date.now() - began < 10000 && !ended) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch (_) { await pause(50); } }
    assert(port, 'Chrome startup failed: ' + log);
    socket = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => { const message = JSON.parse(event.data), item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result); });
    function call(method, params = {}, target = session) { return new Promise((resolve, reject) => {
      const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('Browser check timed out: ' + method)); }, 30000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) })); }); }
    async function evaluate(expression) { const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; }
    const target = await call('Target.createTarget', { url: 'http://127.0.0.1:' + server.address().port });
    session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    for (let i = 0; i < 100 && !await evaluate('!!window.EVAPlayer'); i++) await pause(50);
    assert(await evaluate('!!window.EVAPlayer'), 'HTML fixture did not load formal Player');
    const loaded = await evaluate(`(async()=>{
      window.info=await (await fetch('/info')).json(); window.errors=[];window.events=[];
      window.player=new EVAPlayer.Player({canvas:document.getElementById('screen'),frameIndex:FrameIndex,forwardPredecode:true,experimentMode:"compressed-ram",
        setMediaTarget:time=>{fetch("/target?time="+time);},cancelMediaReads:()=>{fetch("/cancel");},prefetchMedia:(time,loop)=>{const key=Math.floor(time*2)+JSON.stringify(loop);if(window.prefetchKey===key)return;window.prefetchKey=key;fetch('/prefetch?time='+time+'&loop='+encodeURIComponent(JSON.stringify(loop)));},
        readAsset:async(_,file)=>{const r=await fetch('/frame?file='+encodeURIComponent(file));if(!r.ok)throw Object.assign(Error(await r.text()),{code:r.headers.get('x-error-code')});return new Uint8Array(await r.arrayBuffer());},
        createSegmentAudio:settings=>SegmentAudio.createSegmentAudio({...settings,read:async ordinal=>{
          const r=await fetch('/audio/'+ordinal);if(r.status===204)return null;if(!r.ok)throw Object.assign(Error(await r.text()),{code:r.headers.get('x-error-code')});
          return {bytes:new Uint8Array(await r.arrayBuffer()),start:Number(r.headers.get('x-start')),duration:Number(r.headers.get('x-duration'))};}}),
        emit:event=>{if(event.type==='error')errors.push(event);if(events.length<20000)events.push(event);}});
      await player.load(info);return player.snapshot();})()`);
    assert.equal(loaded.state, 'paused'); assert.equal(loaded.frameOrdinal, 0);
    const seek = await evaluate('(async()=>{await player.seek(31.5,{final:true});return player.snapshot();})()'); assert.equal(seek.frameOrdinal, seekOrdinal);
    await evaluate('player.play()'); await pause(1600);
    const playing = await evaluate('player.snapshot()'); console.log(JSON.stringify({name:'first-crossing',playing,details:await evaluate('({errors,clocks:events.filter(e=>e.type==="clock").slice(-12)})')})); assert.equal(playing.state, 'playing'); assert(playing.time >= 32, 'playback did not cross a segment boundary');
    await evaluate('player.applyLoopRange({startOrdinal:'+loopFirst+',endOrdinal:'+loopLast+'})'); await pause(1300);
    const looping = await evaluate('player.snapshot()'); assert.equal(looping.state, 'playing'); assert(looping.frameOrdinal >= loopFirst && looping.frameOrdinal <= loopLast);
    let continuous=null;
    if(throughput){
      await evaluate('player.clearLoop()');
      await evaluate('player.seek(10,{final:true})');
      await evaluate('player.play().then(()=>{window.coldStart=events.length;})');const began=Date.now();await pause(10000);
      continuous=await evaluate('({state:player.snapshot(),errors,buffers:events.slice(coldStart).filter(e=>e.phase==="supply-buffer-start")})');continuous.wallMs=Date.now()-began;
      console.log(JSON.stringify({name:'cold-continuous-playback',...continuous}));
      assert.equal(continuous.buffers.length,0,'cold continuous playback buffered');
      assert(continuous.state.time>=19, 'Cold playback lost more than one second in ten seconds: '+continuous.state.time);
    }
    if(throughput){const jump=await evaluate('(async()=>{await player.pause();const start=performance.now();const a=player.seek(28,{final:true});const b=player.seek(5,{final:true});const c=player.seek(36,{final:true});await Promise.all([a,b,c]);return {ms:performance.now()-start,state:player.snapshot()};})()');console.log(JSON.stringify({name:'rapid-latest-seek',...jump}));assert.equal(jump.state.frameOrdinal,info.frames.findIndex(f=>f.time>=36));assert(jump.ms<2000,'latest seek waited over two seconds');}
    const closed = await evaluate('(async()=>{await player.dispose();return {state:player.snapshot(),errors};})()'); assert.equal(closed.state.budget.used, 0); assert.equal(closed.errors.length, 0);
    await call('Browser.close', {}, null).catch(() => {}); await exited;
    return { origin: 'independent-Chrome-real-JPEG-and-WebAudio', loadFrame: loaded.frameOrdinal, seekFrame: seek.frameOrdinal,
      playingFrame: playing.frameOrdinal, loopFrame: looping.frameOrdinal, releasedBytes: closed.state.budget.used, eagle: false, continuous };
  } finally {
    clearTimeout(deadline); if (socket) socket.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Browser check closed')); }
    if (!ended) child.kill(); await exited;
    for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { checkBrowser };
