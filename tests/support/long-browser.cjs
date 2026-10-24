'use strict';
// Explicit synthetic-only Chrome check called by check-long-media. Never Eagle.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { spawn } = require('child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function checkBrowser({ root, scratch, client, info }) {
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
      if (url.pathname === '/info') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(info)); }
      if (url.pathname === '/frame') return res.end(await client.cache.readAsset(info, url.searchParams.get('file')));
      if (/^\/audio\/\d+$/.test(url.pathname)) {
        const audio = await client.cache.readAudioSegment(info, Number(url.pathname.slice(7)));
        if (!audio) { res.statusCode = 204; return res.end(); }
        res.setHeader('x-start', String(audio.start)); res.setHeader('x-duration', String(audio.duration)); return res.end(audio.bytes);
      }
      res.statusCode = 404; res.end();
    } catch (error) { res.statusCode = 500; res.end(String(error.message)); }
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
      window.info=await (await fetch('/info')).json(); window.errors=[];
      window.player=new EVAPlayer.Player({canvas:document.getElementById('screen'),frameIndex:FrameIndex,forwardPredecode:true,
        readAsset:async(_,file)=>{const r=await fetch('/frame?file='+encodeURIComponent(file));if(!r.ok)throw Error(await r.text());return new Uint8Array(await r.arrayBuffer());},
        createSegmentAudio:settings=>SegmentAudio.createSegmentAudio({...settings,read:async ordinal=>{
          const r=await fetch('/audio/'+ordinal);if(r.status===204)return null;if(!r.ok)throw Error(await r.text());
          return {bytes:new Uint8Array(await r.arrayBuffer()),start:Number(r.headers.get('x-start')),duration:Number(r.headers.get('x-duration'))};}}),
        emit:event=>{if(event.type==='error')errors.push(event);}});
      await player.load(info);return player.snapshot();})()`);
    assert.equal(loaded.state, 'paused'); assert.equal(loaded.frameOrdinal, 0);
    const seek = await evaluate('(async()=>{await player.seek(31.5,{final:true});return player.snapshot();})()'); assert.equal(seek.frameOrdinal, 756);
    await evaluate('player.play()'); await pause(1600);
    const playing = await evaluate('player.snapshot()'); assert.equal(playing.state, 'playing'); assert(playing.time >= 32, 'playback did not cross a segment boundary');
    await evaluate('player.applyLoopRange({startOrdinal:744,endOrdinal:755})'); await pause(1300);
    const looping = await evaluate('player.snapshot()'); assert.equal(looping.state, 'playing'); assert(looping.frameOrdinal >= 744 && looping.frameOrdinal <= 755);
    const closed = await evaluate('(async()=>{await player.dispose();return {state:player.snapshot(),errors};})()'); assert.equal(closed.state.budget.used, 0); assert.equal(closed.errors.length, 0);
    await call('Browser.close', {}, null).catch(() => {}); await exited;
    return { origin: 'independent-Chrome-real-JPEG-and-WebAudio', loadFrame: loaded.frameOrdinal, seekFrame: seek.frameOrdinal,
      playingFrame: playing.frameOrdinal, loopFrame: looping.frameOrdinal, releasedBytes: closed.state.budget.used, eagle: false };
  } finally {
    clearTimeout(deadline); if (socket) socket.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Browser check closed')); }
    if (!ended) child.kill(); await exited;
    for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { checkBrowser };
