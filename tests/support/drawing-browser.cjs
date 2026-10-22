'use strict';
// Optional native DOM check. Never launched by the default model-only checks.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const { scratch } = require('./annotation-scratch.cjs');
const root = path.resolve(__dirname, '../..');
async function main() {
  const gestureMode = process.argv.includes('--gestures'), fixture = gestureMode ? 'gestures-dom.js' : 'drawing-dom.js';
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, 'tests/browser', fixture)], {encoding:'utf8', windowsHide:true}); if (syntax.status !== 0) throw Error(syntax.stderr);
  const temp = scratch(gestureMode ? 'gesture-ui' : 'drawing-ui'), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const files = new Map(['styles.css', 'player.js', 'loop-selection.js', 'timeline-view.js', 'drawing-model.js', 'drawing-ui.js', 'screen-gestures.js', 'screen-gesture-ui.js', 'ui.js'].map(name => [name, fs.readFileSync(path.join(root, 'plugin', name))]));
  files.set('index.html', Buffer.from(fs.readFileSync(path.join(root, 'plugin/index.html'), 'utf8').replace('<script src="app.js"></script>', '<script src="fixture.js"></script>')));
  files.set('fixture.js', fs.readFileSync(path.join(root, 'tests/browser', fixture)));
  const server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1), body = files.get(name);
    if (!body) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store' }).end(body);
  });
  let browser, socket, closed, sessionId, serial = 0;
  const calls = new Map(), pageErrors = [];
  const call = (method, params = {}, target = null) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { calls.delete(id); reject(Error('CDP timeout: ' + method)); }, 8000);
    calls.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
  });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  let log = '';
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps', '--no-pings', '--metrics-recording-only', '--safebrowsing-disable-auto-update', '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + path.join(temp.root, 'profile'), '--disk-cache-dir=' + path.join(temp.root, 'disk-cache'), '--disk-cache-size=1048576', '--crash-dumps-dir=' + path.join(temp.root, 'crashes'), '--window-size=1260,840', 'about:blank'],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TMP: temp.root, TEMP: temp.root } });
    closed = new Promise((resolve, reject) => { browser.once('close', resolve); browser.once('error', reject); });
    browser.stderr.on('data', value => { log += value.toString().slice(0, Math.max(0, 8192 - log.length)); });
    const start = Date.now(); let port;
    while (!port) {
      if (Date.now() - start > 10000 || browser.exitCode !== null) throw Error('Chrome launch failed: ' + log);
      try { port = fs.readFileSync(path.join(temp.root, 'profile/DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch (e) { if (!['ENOENT', 'EBUSY', 'EPERM'].includes(e.code)) throw e; }
      if (!port) await pause(50);
    }
    socket = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data);
      if (value.id) { const pending = calls.get(value.id); if (pending) { calls.delete(value.id); clearTimeout(pending.timer); value.error ? pending.reject(Error(JSON.stringify(value.error))) : pending.resolve(value.result); } }
      else if (value.method === 'Runtime.exceptionThrown') pageErrors.push(value.params.exceptionDetails);
    });
    const version = await call('Browser.getVersion'), target = await call('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
    await call('Runtime.enable', {}, sessionId); await call('Page.enable', {}, sessionId);
    await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port }, sessionId);
    let result;
    while (!result) {
      if (pageErrors.length) throw Error('Native page error: ' + JSON.stringify(pageErrors));
      if (Date.now() - start > 25000) throw Error('Native drawing check timed out: ' + JSON.stringify(pageErrors));
      const text = await evaluate('document.getElementById("drawing-results")?.textContent');
      if (text) result = JSON.parse(text); else await pause(50);
    }
    console.log('drawing-browser-checks ' + JSON.stringify({ browser: version, result, pageErrors, scope: 'Native Chromium DOM/SVG with Session model; no real Eagle/media/library writes.' }));
    const screenshot = process.argv.slice(2).find(s => /^[a-z0-9-]+\.png$/.test(s));
    if (screenshot) {
      const folder = path.join(root, 'verification-runs', process.argv.includes('--e13') ? 'e13-experience' : gestureMode ? 'e12-gestures' : 'e11-annotations'), owner = JSON.parse(fs.readFileSync(path.join(folder, 'owner.json')));
      assert.equal(owner.owner, process.argv.includes('--e13') ? 'eva-e13-experience' : gestureMode ? 'eva-e12-gestures' : 'eva-e11-annotations');
      const data = Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)).data, 'base64');
      const names = fs.readdirSync(folder), size = names.reduce((n, name) => n + fs.statSync(path.join(folder, name)).size, 0);
      assert(data.length <= owner.maxFileBytes && names.length < owner.maxFiles && size + data.length <= owner.maxBytes);
      fs.writeFileSync(path.join(folder, screenshot), data, { flag: 'wx' });
      console.log('Drawing UI screenshot saved: ' + screenshot + ' ' + data.length + ' bytes');
    }
    assert(result.passed, result.error); assert.equal(pageErrors.length, 0);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) { try { await call('Browser.close'); } catch (_) { /* Process may close transport first. */ } socket.close(); }
    if (browser && browser.exitCode === null) {
      const done = await Promise.race([closed.then(() => true), pause(3000).then(() => false)]);
      if (!done) { browser.kill(); await closed; }
    } else if (closed) await closed;
    await new Promise(resolve => server.close(resolve));
    assert(!browser || browser.exitCode !== null || browser.signalCode !== null, 'Owned browser has not exited');
    temp.clean();
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { main };
