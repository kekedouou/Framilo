'use strict';
// UI-02 static HTML/CSS rendering only. Does not run UI-01 or the real player.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { spawn, spawnSync } = require('child_process');
const { createServer } = require('../server.cjs');

const project = path.resolve(__dirname, '../../..');
const evidence = path.join(project, 'verification-runs/ui02-static');
const shots = path.join(__dirname, 'shots');
const limits = Object.freeze({ rounds: 4, seconds: 75, scratchBytes: 128 * 1024 ** 2, evidenceFiles: 36, evidenceBytes: 30 * 1024 ** 2, shotFiles: 15, shotBytes: 20 * 1024 ** 2 });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const inside = (root, target) => { const rel = path.relative(root, target); return Boolean(rel) && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); };

function inventory(folder, hash = false) {
  const files = [], dirs = [];
  function visit(dir) {
    const stat = fs.lstatSync(dir);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe temporary directory: ' + dir);
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), value = fs.lstatSync(file);
      assert(inside(folder, file) && !value.isSymbolicLink(), 'Unsafe temporary path: ' + file);
      if (value.isDirectory()) visit(file);
      else { assert(value.isFile()); files.push({ file, bytes: value.size, dev: String(value.dev), ino: String(value.ino), ...(hash ? { sha256: sha(fs.readFileSync(file)) } : {}) }); }
    }
    dirs.push(dir);
  }
  visit(folder);
  return { files, dirs, bytes: files.reduce((n, file) => n + file.bytes, 0) };
}

function flatFiles(folder) {
  return fs.readdirSync(folder).map(name => {
    const file = path.join(folder, name), stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), 'Linked output is not allowed');
    return { name, file, stat };
  }).filter(item => item.stat.isFile());
}

function writeEvidence(name, data) {
  assert(/^(?:summary-[\dTZ-]+\.json|failure-[\dTZ-]+\.png)$/.test(name));
  const current = flatFiles(evidence), bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  assert(current.length < limits.evidenceFiles, 'UI-02 evidence file budget reached');
  assert(current.reduce((n, f) => n + f.stat.size, 0) + bytes.length <= limits.evidenceBytes, 'UI-02 evidence byte budget reached');
  fs.writeFileSync(path.join(evidence, name), bytes, { flag: 'wx' });
}

function writeShot(name, bytes) {
  assert(/^[abc]-(?:watch|records|annotation|settings|board)\.png$/.test(name));
  assert(inside(shots, path.join(shots, name)));
  const current = flatFiles(shots), previous = current.find(file => file.name === name);
  assert(current.every(file => /^[abc]-(?:watch|records|annotation|settings|board)\.png$/.test(file.name)), 'Unexpected file in delivery screenshots');
  assert(current.length + (previous ? 0 : 1) <= limits.shotFiles, 'UI-02 delivery file budget reached');
  assert(current.reduce((n, file) => n + file.stat.size, 0) - (previous?.stat.size || 0) + bytes.length <= limits.shotBytes, 'UI-02 delivery byte budget reached');
  const oldHash = previous ? sha(fs.readFileSync(previous.file)) : null;
  fs.writeFileSync(path.join(shots, name), bytes);
  return { file: path.relative(project, path.join(shots, name)).split(path.sep).join('/'), bytes: bytes.length, sha256: sha(bytes), previousSha256: oldHash };
}

function referencedProcesses(ownedRoot) {
  if (process.platform !== 'win32') return [];
  const quoted = "'" + ownedRoot.replace(/'/g, "''") + "'";
  const query = '$ErrorActionPreference="Stop"; @(Get-CimInstance Win32_Process -Filter "Name = \'chrome.exe\'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(' + quoted + ') } | Select-Object ProcessId,Name) | ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  assert.equal(result.status, 0, 'Could not verify temporary Chrome process references: ' + result.stderr);
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseArgs(args) {
  const options = { schemes: ['a', 'b', 'c'], states: ['watch', 'records', 'annotation', 'settings'], boards: false, pages: true };
  for (let n = 0; n < args.length; n++) {
    const flag = args[n];
    if (flag === '--scheme') { const value = args[++n]; assert(/^[abc](?:,[abc])*$/.test(value || ''), '--scheme accepts a, b, c or a comma-separated subset'); options.schemes = [...new Set(value.split(','))]; }
    else if (flag === '--state') { const value = args[++n]; assert(/^(?:watch|records|annotation|settings)(?:,(?:watch|records|annotation|settings))*$/.test(value || ''), '--state accepts a comma-separated state subset'); options.states = [...new Set(value.split(','))]; }
    else if (flag === '--boards') { options.boards = true; options.pages = false; }
    else if (flag === '--all') { options.boards = true; options.pages = true; }
    else throw Error('Usage: node prototypes/video-first/design-round-02/capture.cjs [--scheme a,b,c] [--state watch,records,annotation,settings] [--boards | --all]');
  }
  return options;
}

function assertPageGeometry(job, geometry) {
  if (job.state === 'board') return;
  const box = name => { const value = geometry.semantic[name]; assert(value?.visible, job.page + ': missing or invisible ' + name); return value.rect; };
  const contains = (parent, child) => child.x >= parent.x - 1 && child.y >= parent.y - 1 && child.x + child.width <= parent.x + parent.width + 1 && child.y + child.height <= parent.y + parent.height + 1;
  const titlebar = box('titlebar'), viewer = box('viewer');
  const viewport = { x: 0, y: 0, ...geometry.viewport };
  assert(contains(viewport, titlebar), job.page + ': titlebar exceeds viewport');
  const controls = ['minimize', 'maximize', 'close'].map(name => box(name));
  for (const control of controls) assert(contains(titlebar, control), job.page + ': window control exceeds titlebar');
  for (let n = 1; n < controls.length; n++) assert(controls[n].x >= controls[n - 1].x + controls[n - 1].width - 1, job.page + ': window controls overlap');
  assert(contains(viewport, viewer), job.page + ': source frame exceeds viewport');
  assert(Math.abs(viewer.width / viewer.height - 16 / 9) < .003, job.page + ': source frame must keep 16:9 ratio');
  assert.equal(geometry.largeCorners.length, 0, job.page + ': large surface corner conflicts with the flat direction');
  if (job.state === 'records') {
    const panel = box('records'), cards = geometry.semantic.recordCards;
    assert(contains(viewport, panel), job.page + ': records panel exceeds viewport');
    assert(viewer.x + viewer.width <= panel.x + 1, job.page + ': records panel overlaps source frame');
    assert.equal(cards.length, 4, job.page + ': must show four single-column records');
    cards.forEach((card, n) => {
      assert(card.visible && contains(panel, card.rect), job.page + ': record card is clipped');
      assert(Math.abs(card.rect.x - cards[0].rect.x) <= 1, job.page + ': records must share the same column');
      if (n) assert(card.rect.y >= cards[n - 1].rect.y + cards[n - 1].rect.height - 1, job.page + ': records overlap');
    });
  }
}

function compareViewerGeometry(pages) {
  const comparisons = [];
  for (const scheme of ['a', 'b', 'c']) {
    const relevant = pages.filter(page => page.scheme === scheme && ['watch', 'annotation', 'settings'].includes(page.state));
    if (relevant.length < 2) continue;
    const reference = relevant.find(page => page.state === 'watch') || relevant[0];
    for (const page of relevant.filter(value => value !== reference)) {
      const before = reference.geometry.semantic.viewer.rect, after = page.geometry.semantic.viewer.rect;
      const deltas = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.abs(before[key] - after[key])]));
      assert(Object.values(deltas).every(value => value <= 1), scheme + ': entering ' + page.state + ' shifts the source frame');
      comparisons.push({ scheme, reference: reference.state, state: page.state, before, after, deltas, unchanged: true });
    }
  }
  return comparisons;
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  assert.equal(typeof WebSocket, 'function', 'Use the existing Node 24 runtime');
  for (const scheme of options.schemes) assert(fs.existsSync(path.join(__dirname, scheme + '.html')), 'Missing design page: ' + scheme);
  if (options.boards) assert(fs.existsSync(path.join(__dirname, 'board.html')), 'Missing board.html');
  for (const folder of [evidence, shots]) { fs.mkdirSync(folder, { recursive: true }); assert(!fs.lstatSync(folder).isSymbolicLink()); }
  assert(flatFiles(evidence).filter(file => /^summary-.*\.json$/.test(file.name)).length < limits.rounds, 'UI-02 has used all four capture rounds');
  const stamp = new Date().toISOString().replace(/[.:]/g, '-'), nonce = crypto.randomBytes(8).toString('hex');
  const ownedRoot = path.join(evidence, 'browser-' + nonce);
  assert(inside(evidence, ownedRoot)); fs.mkdirSync(ownedRoot);
  const owner = { owner: 'eva-ui02-static-v1', nonce, startedAt: new Date().toISOString(), limits };
  fs.writeFileSync(path.join(ownedRoot, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
  const result = { owner: owner.owner, startedAt: owner.startedAt, scope: 'Static HTML/CSS screenshots in isolated Chrome. No Eagle, real media, saved annotations, playback or performance acceptance.', options, limits, pages: [], pageErrors: [], externalRequests: [], cleanup: null, passed: false };
  const server = createServer();
  let browser, closed, socket, sessionId, serial = 0, budgetTimer, timedOut = false, failure;
  const pending = new Map();
  const launchedAt = Date.now();
  const send = (method, params = {}, target) => new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) { reject(Error('CDP socket closed: ' + method)); return; }
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 10000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
  });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const ready = async url => {
    const deadline = Date.now() + 10000;
    for (;;) {
      try { if (await evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete' && Boolean(window.DESIGN_READY)`)) break; }
      catch (error) { if (!/context.*destroy|Cannot find.*context|Execution context was destroyed/i.test(error.message)) throw error; }
      assert(Date.now() < deadline && Date.now() - launchedAt < limits.seconds * 1000, 'Static design not ready: ' + url); await pause(40);
    }
    await evaluate(`(async function(){
      await Promise.resolve(window.DESIGN_READY);
      await document.fonts.ready;
      await Promise.all([...document.images].map(image=>image.decode()));
      await Promise.all([...document.querySelectorAll('iframe')].map(async frame=>{
        const win=frame.contentWindow,doc=frame.contentDocument;
        if(!doc || !win.DESIGN_READY)throw Error('Board frame is not ready');
        await Promise.resolve(win.DESIGN_READY);await doc.fonts.ready;
        await Promise.all([...doc.images].map(image=>image.decode()));
      }));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    })()`);
  };
  try {
    await server.ready;
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps', '--no-pings', '--metrics-recording-only', '--safebrowsing-disable-auto-update', '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + path.join(ownedRoot, 'profile'), '--disk-cache-dir=' + path.join(ownedRoot, 'disk-cache'), '--disk-cache-size=1048576', '--crash-dumps-dir=' + path.join(ownedRoot, 'crashes'), '--window-size=1600,1000', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TMP: ownedRoot, TEMP: ownedRoot } });
    owner.pid = browser.pid; fs.writeFileSync(path.join(ownedRoot, 'owner.json'), JSON.stringify(owner));
    closed = new Promise((resolve, reject) => { browser.once('close', resolve); browser.once('error', reject); });
    let launchLog = '';
    browser.stderr.on('data', data => { launchLog += data.toString().slice(0, Math.max(0, 4096 - launchLog.length)); });
    budgetTimer = setInterval(() => {
      try { if (Date.now() - launchedAt > limits.seconds * 1000 || inventory(ownedRoot).bytes > limits.scratchBytes) { timedOut = true; browser.kill(); } }
      catch (error) { if (error.code !== 'ENOENT') { timedOut = true; browser.kill(); } }
    }, 750);
    let port;
    while (!port) {
      assert(Date.now() - launchedAt < 10000 && browser.exitCode === null, 'Chrome launch failed: ' + launchLog);
      try { port = fs.readFileSync(path.join(ownedRoot, 'profile/DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); }
      catch (error) { if (!['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) throw error; }
      if (!port) await pause(40);
    }
    socket = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data);
      if (value.id) { const item = pending.get(value.id); if (item) { clearTimeout(item.timer); pending.delete(value.id); value.error ? item.reject(Error(JSON.stringify(value.error))) : item.resolve(value.result); } }
      else if (value.method === 'Runtime.exceptionThrown') result.pageErrors.push(value.params.exceptionDetails);
      else if (value.method === 'Network.requestWillBeSent') { const url = value.params.request.url; if (/^https?:/.test(url) && !url.startsWith(origin + '/')) result.externalRequests.push(url); }
    });
    result.browser = await send('Browser.getVersion');
    const target = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
    await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId); await send('Network.enable', {}, sessionId);
    await send('Page.bringToFront', {}, sessionId);
    const jobs = [];
    for (const scheme of options.schemes) {
      if (options.pages) for (const state of options.states) jobs.push({ scheme, state, width: 1600, height: 1000, file: scheme + '-' + state + '.png', page: scheme + '.html?state=' + state });
      if (options.boards) jobs.push({ scheme, state: 'board', width: 1600, height: 1490, file: scheme + '-board.png', page: 'board.html?scheme=' + scheme });
    }
    for (const job of jobs) {
      assert(!timedOut && Date.now() - launchedAt < limits.seconds * 1000, 'UI-02 capture time budget reached');
      await send('Emulation.setDeviceMetricsOverride', { width: job.width, height: job.height, deviceScaleFactor: 1, mobile: false }, sessionId);
      const url = origin + '/design-round-02/' + job.page;
      await send('Page.navigate', { url }, sessionId); await ready(url);
      const geometry = await evaluate(`(function(){
        const rect=node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};
        const semanticBox=node=>{if(!node)return null;const r=rect(node),style=getComputedStyle(node);return{rect:r,visible:r.width>0&&r.height>0&&style.visibility!=='hidden'&&parseFloat(style.opacity)!==0}};
        const semantic=Object.fromEntries(['titlebar','minimize','maximize','close','viewer','records','annotation','settings'].map(name=>[name,semanticBox(document.querySelector('[data-qa="'+name+'"]'))]));
        semantic.recordCards=[...document.querySelectorAll('[data-qa="record-card"]')].map(semanticBox);
        const elements=[...document.querySelectorAll('[data-qa],.titlebar,.window-controls,.records-panel,.record-card,.viewer,.annotation-editor,.settings-panel')].map(node=>({tag:node.tagName,qa:node.dataset.qa||null,class:node.className,rect:rect(node)}));
        const blurred=[...document.querySelectorAll('*')].filter(node=>{const s=getComputedStyle(node);return s.backdropFilter&&s.backdropFilter!=='none'}).map(node=>node.tagName+'.'+String(node.className));
        const largeCorners=[...document.querySelectorAll('*')].filter(node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return r.width>80&&r.height>80&&parseFloat(s.borderTopLeftRadius)>12}).map(node=>({tag:node.tagName,class:node.className,radius:getComputedStyle(node).borderTopLeftRadius}));
        return{viewport:{width:innerWidth,height:innerHeight},overflowX:document.documentElement.scrollWidth>innerWidth+1,overflowY:document.documentElement.scrollHeight>innerHeight+1,images:[...document.images].map(image=>({src:image.getAttribute('src'),complete:image.complete,naturalWidth:image.naturalWidth})),semantic,elements,backdropFilters:blurred,largeCorners};
      })()`);
      assert(!geometry.overflowX && !geometry.overflowY, 'Page exceeds screenshot viewport: ' + job.page);
      assert(geometry.images.every(image => image.complete && image.naturalWidth > 0), 'Broken image: ' + job.page);
      assert.equal(geometry.backdropFilters.length, 0, 'Static flat direction must not contain backdrop blur');
      assertPageGeometry(job, geometry);
      const bytes = Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)).data, 'base64');
      result.pages.push({ scheme: job.scheme, state: job.state, geometry, ...writeShot(job.file, bytes) });
    }
    result.viewerComparisons = compareViewerGeometry(result.pages);
    assert.equal(result.pageErrors.length, 0, 'Page runtime errors recorded');
    assert.equal(result.externalRequests.length, 0, 'External request detected');
    assert(!timedOut, 'UI-02 capture duration or scratch budget reached');
    result.passed = true;
  } catch (error) {
    failure = error; result.error = error.stack;
    if (socket?.readyState === WebSocket.OPEN && sessionId) {
      try { const data = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId); writeEvidence('failure-' + stamp + '.png', Buffer.from(data.data, 'base64')); }
      catch (captureError) { result.failureCaptureError = captureError.message; }
    }
  } finally {
    clearInterval(budgetTimer);
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch (_) { /* Browser may close its socket first. */ } socket.close(); }
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Capture finished')); } pending.clear();
    if (browser?.exitCode === null) { if (!await Promise.race([closed.then(() => true), pause(2500).then(() => false)])) { browser.kill(); await closed; } } else if (closed) await closed;
    await new Promise(resolve => server.close(resolve));
    try {
      assert(!browser || browser.exitCode !== null || browser.signalCode !== null, 'Owned Chrome still running');
      assert(inside(evidence, ownedRoot) && path.basename(ownedRoot) === 'browser-' + nonce);
      assert.equal(fs.realpathSync(ownedRoot).toLowerCase(), ownedRoot.toLowerCase());
      const savedOwner = JSON.parse(fs.readFileSync(path.join(ownedRoot, 'owner.json'), 'utf8'));
      assert.equal(savedOwner.owner, owner.owner); assert.equal(savedOwner.nonce, nonce); assert.equal(savedOwner.pid, owner.pid);
      assert.equal(referencedProcesses(ownedRoot).length, 0, 'Profile still referenced by Chrome');
      const snapshot = inventory(ownedRoot, true); assert(snapshot.bytes <= limits.scratchBytes, 'Scratch exceeded budget; retain for bounded diagnosis');
      for (const file of snapshot.files) {
        const stat = fs.lstatSync(file.file);
        assert(!stat.isSymbolicLink() && stat.isFile() && String(stat.dev) === file.dev && String(stat.ino) === file.ino && stat.size === file.bytes && sha(fs.readFileSync(file.file)) === file.sha256, 'Profile changed before cleanup');
        fs.unlinkSync(file.file);
      }
      for (const dir of snapshot.dirs) { assert(inside(evidence, dir) && !fs.lstatSync(dir).isSymbolicLink()); fs.rmdirSync(dir); }
      result.cleanup = { removed: true, files: snapshot.files.length, bytes: snapshot.bytes, nonce, processReferences: 0 };
    } catch (error) { result.cleanup = { removed: false, nonce, error: error.message }; result.passed = false; failure ||= error; }
    result.durationMs = Date.now() - launchedAt;
    writeEvidence('summary-' + stamp + '.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: result.passed, pages: result.pages.map(page => page.file), durationMs: result.durationMs, cleanup: result.cleanup, evidence: path.join(evidence, 'summary-' + stamp + '.json'), ...(result.error ? { error: result.error } : {}) }, null, 2));
  }
  if (failure) throw failure;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, parseArgs, assertPageGeometry, compareViewerGeometry };
