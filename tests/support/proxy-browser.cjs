'use strict';

// Explicitly invoked synthetic-only Chrome decoder check. No Eagle APIs.
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto'), assert = require('assert');
const { spawn } = require('child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function checkProxyBrowser({ root, scratch, proxy, packets, references, width, height, frames, flushAfterMs = 8 }) {
  const decoderSource = fs.readFileSync(path.join(root, 'plugin/proxy-decoder.js'));
  const original = fs.statSync(proxy), serverErrors = [], hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('cache-control', 'no-store');
      if (url.pathname === '/') {
        res.setHeader('content-type', 'text/html; charset=utf-8');
        return res.end('<!doctype html><canvas id="screen"></canvas><script src="/decoder.js"></script>');
      }
      if (url.pathname === '/decoder.js') { res.setHeader('content-type', 'text/javascript'); return res.end(decoderSource); }
      if (url.pathname === '/info') {
        res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ width, height, frames, references, flushAfterMs }));
      }
      const match = /^\/packet\/(\d+)$/.exec(url.pathname), index = match && Number(match[1]);
      if (!match || !Number.isSafeInteger(index) || !packets[index]) { res.statusCode = 404; return res.end(); }
      const packet = packets[index], bytes = Buffer.alloc(packet.bytes); let handle;
      try {
        handle = await fs.promises.open(proxy, 'r'); const stat = await handle.stat();
        assert(stat.ino === original.ino && stat.dev === original.dev && stat.size === original.size, 'Proxy identity changed');
        let at = 0;
        while (at < bytes.length) { const result = await handle.read(bytes, at, bytes.length - at, packet.offset + at); assert(result.bytesRead, 'Proxy read incomplete'); at += result.bytesRead; }
        assert.equal(hash(bytes), packet.sha256, 'Proxy packet hash mismatch');
      } finally { if (handle) await handle.close(); }
      res.setHeader('content-type', 'application/octet-stream'); res.end(bytes);
    } catch (error) { if (serverErrors.length < 16) serverErrors.push(String(error.message)); res.statusCode = 500; res.end(String(error.message)); }
  });
  const sockets = new Set(); server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(scratch, 'chrome-profile'), chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const child = spawn(chrome, ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--user-data-dir=' + profile, '--disk-cache-size=1048576', 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TEMP: scratch, TMP: scratch } });
  let log = '', socket, next = 0, session, ended = false, diagnostic = null; const pending = new Map();
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-4096); });
  const exited = new Promise(resolve => { child.once('close', () => { ended = true; resolve(); }); child.once('error', () => { ended = true; resolve(); }); });
  const deadline = setTimeout(() => child.kill(), 120000);
  try {
    const began = Date.now(); let port;
    while (!port && Date.now() - began < 10000 && !ended) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch (_) { await pause(50); } }
    assert(port, 'Chrome startup failed: ' + log);
    socket = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result);
    });
    function call(method, params = {}, target = session) {
      return new Promise((resolve, reject) => {
        const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('Proxy browser check timed out: ' + method)); }, 45000);
        pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
      });
    }
    async function evaluate(expression) {
      const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
    }
    diagnostic = () => evaluate('window.proxyFirstGate ? ({samples:proxyFirstGate.samples,errors:proxyFirstGate.errors,pixelChecks:proxyFirstGate.pixelChecks,decoder:proxyFirstGate.snapshot()}) : null');
    const target = await call('Target.createTarget', { url: 'http://127.0.0.1:' + server.address().port });
    session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    for (let n = 0; n < 100 && !await evaluate('!!window.EVAProxyDecoder'); n++) await pause(50);
    assert(await evaluate('!!window.EVAProxyDecoder'), 'HTML fixture did not load formal proxy decoder');
    const result = await evaluate(`(async()=>{
      const info=await(await fetch('/info')).json(),canvas=document.getElementById('screen');canvas.width=info.width;canvas.height=info.height;
      const ctx=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'}),samples=[],errors=[],pixelChecks=[];let bitmapCreated=0,bitmapClosed=0,holdBitmap=null;
      const decoder=EVAProxyDecoder.createProxyDecoder({width:info.width,height:info.height,flushAfterMs:info.flushAfterMs,
        createImageBitmap:async frame=>{const bitmap=await createImageBitmap(frame);bitmapCreated++;if(holdBitmap)await holdBitmap.promise;return bitmap;}});
      window.proxyFirstGate={samples,errors,pixelChecks,snapshot:()=>decoder.snapshot()};
      const get=async id=>{const r=await fetch('/packet/'+id);if(!r.ok)throw Error(await r.text());return new Uint8Array(await r.arrayBuffer());};
      function percentile(values,p){const v=[...values].sort((a,b)=>a-b);return v[Math.min(v.length-1,Math.ceil(v.length*p)-1)]||0;}
      function checkPixels(id){
        const rgba=ctx.getImageData(0,0,info.width,info.height).data;let actual=0;
        for(let bit=0;bit<10;bit++){const at=(16*info.width+12+bit*20+8)*4,level=(rgba[at]+rgba[at+1]+rgba[at+2])/3;
          if(level>80&&level<175)throw Error('Ambiguous marker for '+id);if(level>=175)actual|=1<<bit;}
        if(actual!==id)throw Error('Wrong pixels: requested '+id+', marker '+actual);
        const reference=info.references[id];if(!reference)return;
        let n=0,total=0,max=0;const delta=[];
        for(let gy=0;gy<24;gy++)for(let gx=0;gx<40;gx++){const x=Math.floor((gx+.5)*info.width/40),y=Math.floor((gy+.5)*info.height/24),at=(y*info.width+x)*4;
          for(let c=0;c<3;c++){const d=Math.abs(rgba[at+c]-reference[n++]);delta.push(d);total+=d;max=Math.max(max,d);}}
        const value={id,marker:actual,meanAbs:total/n,p95Abs:percentile(delta,.95),maxAbs:max,sampledRgbComponents:n};pixelChecks.push(value);
        if(value.meanAbs>8||value.p95Abs>24)throw Error('Proxy color difference exceeded declared tolerance: '+JSON.stringify(value));
      }
      async function request(id,phase,prepared){
        const start=performance.now();let bitmap;
        try{const bytes=prepared||await get(id),readEnd=performance.now();bitmap=await decoder.decode(bytes,{id});const decoded=performance.now();
          ctx.drawImage(bitmap,0,0);const drawn=performance.now();samples.push({id,phase,readMs:readEnd-start,decodeMs:decoded-readEnd,requestToDrawMs:drawn-start});
          checkPixels(id);return samples[samples.length-1];
        }catch(error){errors.push({id,phase,message:error.message,code:error.code||null});throw error;}
        finally{if(bitmap){bitmap.close();bitmapClosed++;}}
      }
      await request(0,'initial');
      const order=[];for(let n=0;n<60;n++)order.push(n);for(let n=480;n<508;n++)order.push(n);for(let n=506;n>=480;n--)order.push(n);
      order.push(959,57,898,127,741,479,600,0,959,0,57,127,479,600,741,898);
      const unique=[...new Set(order)],ready=new Map();for(const id of unique)ready.set(id,await get(id));
      for(let n=0;n<order.length;n+=2)await Promise.all(order.slice(n,n+2).map(id=>request(id,'preloaded',ready.get(id))));
      const firstSnapshot=decoder.snapshot();if(firstSnapshot.peakPending!==2)throw Error('Did not exercise two in-flight decoder slots');
      for(const id of [959,0,741,127,898,57,600,479])await request(id,'loopback-read');
      let release;holdBitmap={promise:new Promise(resolve=>{release=resolve;})};
      const pending=decoder.decode(ready.get(959),{id:959}).then(bitmap=>{bitmap.close();bitmapClosed++;return {unexpectedSuccess:true};},error=>({code:error.code}));
      const waiting=performance.now();while(!decoder.snapshot().bitmapConversions&&performance.now()-waiting<2000)await new Promise(resolve=>setTimeout(resolve,1));
      if(decoder.snapshot().bitmapConversions!==1)throw Error('Could not enter pending bitmap close test');
      const closing=decoder.close();release();const outcome=await pending;await closing;
      if(outcome.code!=='PROXY_DECODER_CLOSED')throw Error('Pending close did not cancel the outstanding request: '+JSON.stringify(outcome));
      const final=decoder.snapshot();if(final.pending||final.nativePending||final.bitmapConversions)throw Error('Decoder resources remain after close');
      if(final.closedFrames!==final.decoded)throw Error('Native VideoFrame close count mismatch');
      if(bitmapCreated!==bitmapClosed+final.discardedBitmaps)throw Error('Bitmap ownership mismatch');
      const summary=phase=>{const rows=samples.filter(s=>s.phase===phase),values=rows.map(s=>s.requestToDrawMs);return {count:rows.length,p95Ms:percentile(values,.95),maxMs:Math.max(...values),meanMs:values.reduce((a,b)=>a+b,0)/values.length};};
      return {origin:'independent-Chrome-native-VideoDecoder-ImageBitmap-Canvas',eagle:false,userAgent:navigator.userAgent,
        capabilities:{VideoDecoder:typeof VideoDecoder,secureContext:isSecureContext},initial:samples[0],preloaded:summary('preloaded'),loopbackRead:summary('loopback-read'),
        requests:samples.length,errors,pixelChecks,samples,firstSnapshot,final,bitmapCreated,bitmapClosed,
        timingBoundary:'request begins before packet read/decode, ends immediately after Canvas drawImage call; marker/color readback excluded; no physical presentation measurement',
        hardwareVerified:false,identity:'ten visible binary cells per decoded image, not timestamp equality',pixelTolerance:{meanAbsMax:8,p95AbsMax:24,channelRange:255}};
    })()`);
    assert.equal(serverErrors.length, 0, 'Loopback packet service errors'); assert.equal(result.errors.length, 0);
    assert(result.pixelChecks.length >= 8); assert.equal(result.final.state, 'closed');
    await call('Browser.close', {}, null).catch(() => {}); await exited;
    return result;
  } catch (error) {
    if (diagnostic && !ended) { try { error.proxyEvidence = await diagnostic(); } catch (_) { /* Preserve the original failure. */ } }
    throw error;
  } finally {
    clearTimeout(deadline); if (socket) socket.close();
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Proxy browser check closed')); }
    if (!ended) child.kill(); await exited;
    for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { checkProxyBrowser };
