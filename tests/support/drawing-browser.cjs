'use strict';
// Optional native DOM check. Never launched by the default model-only checks.
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const { spawn, spawnSync } = require('child_process');
const { scratch } = require('./annotation-scratch.cjs');
const root = path.resolve(__dirname, '../..');
async function main() {
  const e30Mode=process.argv.includes('--e30'),e29Mode=process.argv.includes('--e29')||e30Mode,e28Mode=process.argv.includes('--e28')||e29Mode, e27Mode=process.argv.includes('--e27'), e26Mode=process.argv.includes('--e26'), e25Mode=process.argv.includes('--e25'), e24Mode=process.argv.includes('--e24'), e23Mode=process.argv.includes('--e23'), e22Mode=process.argv.includes('--e22'), e21Mode=process.argv.includes('--e21'), e20Mode = process.argv.includes('--e20')||e21Mode||e22Mode||e23Mode||e24Mode||e25Mode||e26Mode||e27Mode||e28Mode, e19Mode = process.argv.includes('--e19')||e20Mode;
  const e18Mode = process.argv.includes('--e18'), perfMode = process.argv.includes('--e18-perf'), e16Mode = process.argv.includes('--e16'), e14Mode = process.argv.includes('--e14'), gestureMode = process.argv.includes('--gestures'), fixture = e30Mode ? 'e30-dom.js' : e29Mode ? 'e29-dom.js' : e28Mode ? 'e28-dom.js' : e27Mode ? 'e27-dom.js' : e26Mode ? 'e26-dom.js' : e25Mode ? 'e25-dom.js' : e24Mode ? 'e24-dom.js' : e23Mode ? 'e23-dom.js' : e22Mode ? 'e22-dom.js' : e21Mode ? 'e21-dom.js' : e20Mode ? 'e20-dom.js' : e19Mode ? 'e19-dom.js' : perfMode ? 'e18-perf.js' : e18Mode ? 'e18-dom.js' : e16Mode ? 'e16-dom.js' : e14Mode ? 'e14-dom.js' : gestureMode ? 'gestures-dom.js' : 'drawing-dom.js';
  const syntax = spawnSync(process.execPath, ['--check', path.join(root, 'tests/browser', fixture)], {encoding:'utf8', windowsHide:true}); if (syntax.status !== 0) throw Error(syntax.stderr);
  const temp = scratch(gestureMode ? 'gesture-ui' : 'drawing-ui'), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const baseline = process.argv.includes('--baseline-e18'); assert(!baseline || e18Mode || perfMode);
  const revision = baseline ? JSON.parse(fs.readFileSync(path.join(root, 'verification-runs/e18-final/owner.json'))).baseline : null;
  if (baseline) assert(/^[a-f0-9]{40}$/.test(revision));
  const source = name => baseline ? require('child_process').execFileSync('git', ['show', revision + ':plugin/' + name], {cwd:root,windowsHide:true}) : fs.readFileSync(path.join(root, 'plugin', name));
  const files = new Map(['styles.css', 'player.js', 'loop-selection.js', 'timeline-view.js', 'drawing-erase.js', 'drawing-model.js', 'drawing-ui.js', 'screen-gestures.js', 'screen-gesture-ui.js', 'context-wheel.js', 'ui.js'].map(name => [name, source(name)]));
  if(e19Mode)for(const name of ['graphite.css','interface-icons.js','timeline-strip.js','settings-view.js','graphite-shell.js'])files.set(name,source(name));
  if(e29Mode&&process.argv.includes('--e29-baseline'))files.set('graphite-shell.js',fs.readFileSync(path.join(root,'verification-runs/e29-opt/shell-before.js'),'utf8'));
  files.set('index.html', Buffer.from(source('index.html').toString().replace('<script src="app.js"></script>', (perfMode ? '<script src="frame-index.js"></script>' : '') + '<script src="fixture.js"></script>')));
  if (perfMode) files.set('frame-index.js', Buffer.from('(function(){const module={exports:{}};\n' + source('frame-index.cjs') + '\nwindow.EVAFrameIndex=module.exports;})();'));
  files.set('fixture.js', Buffer.concat([Buffer.from(process.argv.includes('--e19-records') ? 'window.E19_RECORDS=true;\n' : process.argv.includes('--note-screenshot') ? 'window.E16_SCREENSHOT="note";\n' : process.argv.includes('--types-screenshot') ? 'window.E16_SCREENSHOT="types";\n' : process.argv.includes('--watch-wheel') ? 'window.E14_WATCH_SCREENSHOT=true;\n' : process.argv.includes('--e15') ? 'window.E15_ERASER_CHECKS=true;\n' : ''), fs.readFileSync(path.join(root, 'tests/browser', fixture))]));
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
    if (process.argv.includes('--e18-compact')) await call('Emulation.setDeviceMetricsOverride', {width:e19Mode?720:760,height:e19Mode?480:500,deviceScaleFactor:1,mobile:false}, sessionId);
    if (process.argv.includes('--e18-reduced')) await call('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]}, sessionId);
    await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port }, sessionId);
    let result;
    while (!result) {
      if (pageErrors.length) throw Error('Native page error: ' + JSON.stringify(pageErrors));
      if (Date.now() - start > (e18Mode || perfMode || e26Mode || e27Mode || e28Mode ? 45000 : 25000)) throw Error('Native drawing check timed out: ' + JSON.stringify(pageErrors));
      const text = await evaluate('document.getElementById("drawing-results")?.textContent');
      if (text) result = JSON.parse(text); else await pause(50);
    }
    console.log('drawing-browser-checks ' + JSON.stringify({ browser: version, result, pageErrors, scope: 'Native Chromium DOM/SVG with Session model; no real Eagle/media/library writes.' }));
    const screenshot = process.argv.slice(2).find(s => /^[a-z0-9-]+\.png$/.test(s));
    if (screenshot) {
      const e18Evidence = e18Mode || perfMode || process.argv.includes('--e18-evidence');
      const folder = path.join(root, 'verification-runs', e30Mode ? 'e30-panels' : e29Mode ? 'e29-opt' : e28Mode ? 'e28-feedback' : e27Mode ? 'e27-tools' : e26Mode ? 'e26-panels' : e25Mode ? 'e25-alignment' : e24Mode ? 'e24-motion' : e23Mode ? 'e23-refine' : e22Mode ? 'e22-timeline' : e21Mode ? 'e21-dots' : e20Mode ? 'e20-feedback' : e19Mode ? 'e19-graphite' : e18Evidence ? 'e18-final' : e16Mode || process.argv.includes('--e16-evidence') ? 'e16-context' : process.argv.includes('--e15-evidence') ? 'e15-eraser' : e14Mode || process.argv.includes('--e14-evidence') ? 'e14-interactions' : process.argv.includes('--e13') ? 'e13-experience' : gestureMode ? 'e12-gestures' : 'e11-annotations'), owner = JSON.parse(fs.readFileSync(path.join(folder, 'owner.json')));
      assert.equal(owner.owner, e30Mode ? 'eva-e30-panels-v1' : e29Mode ? 'eva-e29-opt-v1' : e28Mode ? 'eva-e28-feedback-v1' : e27Mode ? 'eva-e27-tools-v1' : e26Mode ? 'eva-e26-panels-v1' : e25Mode ? 'eva-e25-alignment-v1' : e24Mode ? 'eva-e24-motion-v1' : e23Mode ? 'eva-e23-refine-v1' : e22Mode ? 'eva-e22-timeline-v1' : e21Mode ? 'eva-e21-dots-v1' : e20Mode ? 'eva-e20-feedback-v1' : e19Mode ? 'eva-e19-graphite-v1' : e18Evidence ? 'eva-e18-final-v1' : e16Mode || process.argv.includes('--e16-evidence') ? 'eva-e16-context-v1' : process.argv.includes('--e15-evidence') ? 'eva-e15-eraser-v1' : e14Mode || process.argv.includes('--e14-evidence') ? 'eva-e14-interactions-v1' : process.argv.includes('--e13') ? 'eva-e13-experience' : gestureMode ? 'eva-e12-gestures' : 'eva-e11-annotations');
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
