'use strict';
// Isolated Chrome gate: read-only source, no proxy generation or Eagle writes.
const fs = require('fs'), fsp = fs.promises, path = require('path'), http = require('http'), crypto = require('crypto'), { spawn } = require('child_process');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'verification-runs/e44'), proto = path.join(root, 'prototypes/e44-direct-player');
const wait = ms => new Promise(r => setTimeout(r, ms));
async function hash(file) { const h = crypto.createHash('sha256'); for await (const b of fs.createReadStream(file)) h.update(b); return h.digest('hex'); }
async function main() {
  const label = process.argv[2]; if (!/^[a-z0-9-]{1,40}$/.test(label || '')) throw Error('New label required');
  const resultFile = path.join(out, 'chrome-' + label + '.json'), scratch = path.join(out, 'browser-' + label);
  if (fs.existsSync(resultFile) || fs.existsSync(scratch)) throw Error('Evidence already exists');
  const profile = JSON.parse(fs.readFileSync(path.join(out, 'profile.json'))), raw = fs.readFileSync(path.join(out, 'source-index.json')), index = JSON.parse(raw);
  if (crypto.createHash('sha256').update(raw).digest('hex') !== profile.indexHash || await hash(profile.source) !== profile.sourceHash) throw Error('Identity mismatch');
  const codeHashes = Object.fromEntries(await Promise.all(['direct.js', 'worker.js', 'worker-client.js', 'gate.js', 'index.html'].map(async f => [f, await hash(path.join(proto, f))])));
  const file = await fsp.open(profile.source, 'r'), sockets = new Set(), reads = { bytes: 0, count: 0, ms: 0 };
  let child, ws, id = 0, session; const pending = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://localhost'); res.setHeader('Cache-Control', 'no-store');
      if (u.pathname === '/index') return res.end(raw);
      if (u.pathname === '/packets') {
        const a = Number(u.searchParams.get('a')), b = Number(u.searchParams.get('b'));
        if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b > index.packets.length || b <= a || b - a > 32) throw Error('Read bounds');
        const parts = index.packets.slice(a, b), first = parts[0].pos, last = parts[parts.length - 1], length = last.pos + last.size - first;
        if (length < 1 || length > 32 * 1024 ** 2) throw Error('Unsupported layout');
        const buffer = Buffer.alloc(length), at = performance.now(), r = await file.read(buffer, 0, length, first);
        if (r.bytesRead !== length) throw Error('Short source'); reads.bytes += length; reads.count++; reads.ms += performance.now() - at;
        return res.end(Buffer.concat(parts.map(p => buffer.subarray(p.pos - first, p.pos - first + p.size))));
      }
      if (u.pathname === '/source') {
        const size = profile.sourceSize, m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        const start = m ? Number(m[1]) : 0, end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start > end || start >= size) { res.statusCode = 416; return res.end(); }
        res.writeHead(m ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(m ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
        const stream = fs.createReadStream(profile.source, { start, end }); res.on('close', () => stream.destroy()); stream.on('error', () => res.destroy()); return stream.pipe(res);
      }
      const name = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      if (!['index.html', 'direct.js', 'worker.js', 'worker-client.js', 'gate.js', 'host.js'].includes(name)) { res.statusCode = 404; return res.end(); }
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(fs.readFileSync(path.join(proto, name)));
    } catch (e) { res.statusCode = 500; res.end(e.message); }
  });
  server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  const call = (method, params = {}, target = session, ms = 45000) => new Promise((resolve, reject) => {
    const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout ' + method)); }, ms);
    pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params, ...(target ? { sessionId: target } : {}) }));
  });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-default-browser-check', '--remote-debugging-port=0', '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--disk-cache-size=1048576', '--window-size=1280,900', '--user-data-dir=' + scratch, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    child.on('error', () => {}); let port;
    for (let n = 0; n < 150 && !port; n++) { try { port = fs.readFileSync(path.join(scratch, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch (_) { await wait(50); } }
    if (!port) throw Error('Chrome startup failed');
    ws = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.onmessage = e => { const v = JSON.parse(e.data), p = pending.get(v.id); if (!p) return; clearTimeout(p.timer); pending.delete(v.id); v.error ? p.reject(Error(JSON.stringify(v.error))) : p.resolve(v.result); };
    const target = await call('Target.createTarget', { url: 'about:blank' }, null); session = (await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    for (let n = 0; n < 100; n++) { if (await evaluate('!!window.E44Gate')) break; await wait(50); }
    const system = await call('SystemInfo.getInfo', {}, null), rounds = process.argv.includes('--smoke') ? 1 : 3;
    await evaluate(`window.e44Done=false;window.e44Error=null;window.e44Snapshot=null;(async()=>{const index=await(await fetch('/index')).json();try{window.e44Result=await E44Gate.run({index,url:'/source',read:async(a,b)=>{const r=await fetch('/packets?a='+a+'&b='+b);if(!r.ok)throw Error(await r.text());return new Uint8Array(await r.arrayBuffer());},label:${JSON.stringify(label)},host:{kind:'independent-Chrome-not-Eagle'},rounds:${rounds},save:async r=>{window.e44Snapshot=JSON.parse(JSON.stringify(r));},onStatus:s=>{document.querySelector('#status').textContent=s;}});}catch(e){window.e44Error=e.stack;}finally{window.e44Done=true;}})();true`);
    const deadline = Date.now() + 540000; let last = '';
    while (Date.now() < deadline) {
      await wait(1000); const status = await evaluate('({done:e44Done,error:e44Error,status:document.querySelector("#status").textContent})');
      if (status.status !== last) { console.log(status.status); last = status.status; }
      if (status.done) break;
    }
    const r = await evaluate('({done:window.e44Done,error:window.e44Error,report:window.e44Result||window.e44Snapshot})');
    r.codeHashes = codeHashes; r.system = system; r.reads = reads; r.generatedMediaBytes = 0;
    fs.writeFileSync(resultFile, JSON.stringify(r, null, 2), { flag: 'wx' });
    console.log(JSON.stringify(r.report?.runs.map(v => ({ round: v.round, backend: v.hardware, summary: v.summary, error: v.error })), null, 2));
    if (!r.done || r.error) throw Error(r.error || 'Gate deadline exceeded');
  } finally {
    if (ws) await Promise.race([call('Browser.close', {}, null).catch(() => {}), wait(1000)]);
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Experiment ended')); } pending.clear(); ws?.close();
    if (child && child.exitCode === null) child.kill(); for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); await file.close();
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
