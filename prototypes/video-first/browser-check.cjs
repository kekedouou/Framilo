'use strict';
// Optional, bounded DOM verification of the isolated UI-01 sample, never Eagle.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { spawn, spawnSync } = require('child_process');
const { createServer } = require('./server.cjs');

const project = path.resolve(__dirname, '../..');
const evidence = path.join(project, 'verification-runs/ui01');
const limits = { seconds: 60, scratchBytes: 128 * 1024 ** 2, evidenceBytes: 16 * 1024 ** 2, evidenceFiles: 24, screenshots: 3, runs: 3 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const inside = (parent, target) => { const relative = path.relative(parent, target); return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };

function inventory(folder, hash = false) {
  const files = [], dirs = [];
  function visit(dir) {
    const ds = fs.lstatSync(dir); assert(ds.isDirectory() && !ds.isSymbolicLink(), 'Non-owned directory or link: ' + dir);
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      assert(inside(folder, file) && !stat.isSymbolicLink(), 'Link or outside path in temporary profile');
      if (stat.isDirectory()) visit(file);
      else { assert(stat.isFile()); files.push({ file, bytes: stat.size, dev: String(stat.dev), ino: String(stat.ino), ...(hash ? { sha256: sha(fs.readFileSync(file)) } : {}) }); }
    }
    dirs.push(dir);
  }
  visit(folder); return { files, dirs, bytes: files.reduce((sum, f) => sum + f.bytes, 0) };
}

function writeEvidence(name, data) {
  assert(/^(?:summary-[\dTZ-]+\.json|layout-[\dTZ-]+-[a-z]+\.png)$/.test(name));
  const current = fs.readdirSync(evidence).map(name => path.join(evidence, name)).filter(file => fs.lstatSync(file).isFile());
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  assert(current.length < limits.evidenceFiles, 'UI-01 evidence file budget reached');
  assert(current.reduce((n, file) => n + fs.statSync(file).size, 0) + bytes.length <= limits.evidenceBytes, 'UI-01 evidence byte budget reached');
  fs.writeFileSync(path.join(evidence, name), bytes, { flag: 'wx' });
}

function referencedProcesses(ownedRoot) {
  if (process.platform !== 'win32') return [];
  const quoted = "'" + ownedRoot.replace(/'/g, "''") + "'";
  const query = '$ErrorActionPreference="Stop"; @(Get-CimInstance Win32_Process -Filter "Name = \'chrome.exe\'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(' + quoted + ') } | Select-Object ProcessId,Name) | ConvertTo-Json -Compress';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  assert.equal(result.status, 0, 'Could not verify profile process references: ' + result.stderr);
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function main() {
  for (const name of ['index.html', 'lab.html', 'browser-tests.js']) assert(fs.existsSync(path.join(__dirname, name)), 'UI sample not ready: ' + name);
  assert.equal(typeof WebSocket, 'function', 'Use the existing Node 24 runtime.');
  fs.mkdirSync(evidence, { recursive: true });
  assert(!fs.lstatSync(evidence).isSymbolicLink());
  assert(fs.readdirSync(evidence).filter(name => /^summary-.*\.json$/.test(name)).length < limits.runs, 'UI-01 has already used the approved three browser rounds.');
  const stamp = new Date().toISOString().replace(/[.:]/g, '-'), nonce = crypto.randomBytes(8).toString('hex');
  const ownedRoot = path.join(evidence, 'browser-' + nonce), owner = { owner: 'eva-ui01-browser-v1', nonce, startedAt: new Date().toISOString(), limits };
  fs.mkdirSync(ownedRoot); fs.writeFileSync(path.join(ownedRoot, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
  const server = createServer();
  let browser, closed, socket, sessionId, serial = 0, screenshots = 0, budgetTimer, timedOut = false;
  const pending = new Map(), errors = [];
  const result = { owner: owner.owner, startedAt: owner.startedAt, scope: 'Isolated synthetic HTML/CSS/canvas sample in headless Chrome; no Eagle, media library, original media, or formal player writes.', limits, checks: [], screenshots: [], cleanup: null, passed: false };
  const send = (method, params = {}, target) => new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) { reject(Error('CDP socket closed: ' + method)); return; }
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 8000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }));
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (response.exceptionDetails) throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const ready = async (expression, deadlineMs, message) => {
    for (;;) {
      try { if (await evaluate(expression)) return; }
      catch (error) { if (!/context.*destroy|Cannot find.*context|Execution context was destroyed/i.test(error.message)) throw error; }
      assert(Date.now() - launchedAt < deadlineMs, message); await pause(50);
    }
  };
  const capture = async name => {
    assert(screenshots < limits.screenshots);
    const file = 'layout-' + stamp + '-' + name + '.png';
    const bytes = Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)).data, 'base64');
    writeEvidence(file, bytes); screenshots++; result.screenshots.push({ file, bytes: bytes.length });
  };
  let failure;
  const launchedAt = Date.now();
  try {
    await server.ready;
    // Chromium background requests are blocked; only this loopback server is allowed.
    browser = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps', '--no-pings', '--metrics-recording-only', '--safebrowsing-disable-auto-update', '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + path.join(ownedRoot, 'profile'), '--disk-cache-dir=' + path.join(ownedRoot, 'disk-cache'), '--disk-cache-size=1048576', '--crash-dumps-dir=' + path.join(ownedRoot, 'crashes'), '--window-size=1260,840', 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TMP: ownedRoot, TEMP: ownedRoot } });
    owner.pid = browser.pid; fs.writeFileSync(path.join(ownedRoot, 'owner.json'), JSON.stringify(owner));
    closed = new Promise((resolve, reject) => { browser.once('close', resolve); browser.once('error', reject); });
    let launchLog = '';
    browser.stderr.on('data', data => { launchLog += data.toString().slice(0, Math.max(0, 4096 - launchLog.length)); });
    budgetTimer = setInterval(() => {
      try {
        const bytes = inventory(ownedRoot).bytes;
        if (Date.now() - launchedAt > limits.seconds * 1000 || bytes > limits.scratchBytes) { timedOut = true; browser.kill(); }
      } catch (error) { if (error.code !== 'ENOENT') { timedOut = true; browser.kill(); } }
    }, 750);
    let port;
    while (!port) {
      assert(Date.now() - launchedAt < 10000 && browser.exitCode === null, 'Chrome launch failed: ' + launchLog);
      try { port = fs.readFileSync(path.join(ownedRoot, 'profile/DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch (error) { if (!['ENOENT', 'EBUSY', 'EPERM'].includes(error.code)) throw error; }
      if (!port) await pause(50);
    }
    socket = new WebSocket('ws://127.0.0.1:' + port[0] + port[1]);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const value = JSON.parse(event.data);
      if (value.id) { const p = pending.get(value.id); if (p) { clearTimeout(p.timer); pending.delete(value.id); value.error ? p.reject(Error(JSON.stringify(value.error))) : p.resolve(value.result); } }
      else if (value.method === 'Runtime.exceptionThrown') errors.push(value.params.exceptionDetails);
    });
    result.browser = await send('Browser.getVersion');
    const target = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
    await send('Runtime.enable', {}, sessionId); await send('Page.enable', {}, sessionId);
    await send('Page.bringToFront', {}, sessionId);
    const origin = 'http://127.0.0.1:' + server.address().port;
    await send('Page.navigate', { url: origin + '/index.html' }, sessionId);
    await ready('Boolean(window.VFPreview)', 12000, 'Sample interface not ready');
    result.checks = await evaluate(fs.readFileSync(path.join(__dirname, 'browser-tests.js'), 'utf8'));
    result.focusDiagnostics = await evaluate('window.__VFFocusDiagnostics || null');
    await evaluate(`(async function(){
      VFPreview.reset();document.getElementById('dismissGuide')?.click();
      await new Promise(resolve=>setTimeout(resolve,VFPreview.getParams().hideDelay+80));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      await Promise.all(document.getElementById('dock').getAnimations().map(animation=>animation.finished.catch(()=>{})));
    })()`); await capture('watch');
    await evaluate('VFPreview.model.toggleRecords(); VFPreview.model.selectRecord(VFPreview.model.state.records[1].id); VFPreview.render();'); await pause(260); await capture('records');
    await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 500, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await evaluate('VFPreview.reset(); VFPreview.setAspect("portrait");'); await pause(150);
    result.compact = await evaluate('(function(){const s=document.getElementById("scene").getBoundingClientRect(),style=getComputedStyle(document.getElementById("dock")); return { width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,scene:{x:s.x,y:s.y,width:s.width,height:s.height},reduced:matchMedia("(prefers-reduced-motion: reduce)").matches,noTransition:style.transitionDuration.split(",").every(value=>parseFloat(value)===0),noAnimation:style.animationName==="none"};})()');
    assert(!result.compact.overflow && result.compact.reduced, 'Compact / reduced-motion media checks failed');
    assert(result.compact.scene.x >= -1 && result.compact.scene.y >= -1 && result.compact.scene.x + result.compact.scene.width <= 761 && result.compact.scene.y + result.compact.scene.height <= 501, 'Portrait scene outside viewport');
    assert(result.compact.noTransition && result.compact.noAnimation, 'Reduced-motion preference must disable actual dock motion');
    result.compactPanels = await evaluate(`(async function(){
      const api=VFPreview,m=api.model,rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
      const settle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      m.toggleRecords();api.render();await settle();const records=rect('recordsPanel'), scene=rect('scene');
      m.beginAnnotation();api.render();await settle();const editor=rect('annotationEditor'), fixed=rect('scene');m.cancelDraft(true);m.toggleRecords();m.openSettings();api.render();await settle();const settings=rect('settingsPopover');m.closeSettings();api.render();
      return {records,scene,editor,fixed,settings,viewport:{width:innerWidth,height:innerHeight}};
    })()`);
    for (const key of ['records', 'scene', 'editor', 'settings']) {
      const box = result.compactPanels[key];
      assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= 761 && box.y + box.height <= 501, 'Compact ' + key + ' exceeds viewport');
    }
    assert(Object.keys(result.compactPanels.scene).every(key => Math.abs(result.compactPanels.scene[key] - result.compactPanels.fixed[key]) <= 1.5), 'Compact record annotation must preserve video geometry');
    await capture('compact');
    await send('Page.navigate', { url: origin + '/lab.html' }, sessionId);
    await ready('Boolean(document.querySelector("iframe")?.contentWindow.VFPreview)', 45000, 'Lab iframe not ready');
    result.lab = await evaluate('(function(){const frame=document.querySelector("iframe"), preview=frame.contentWindow.VFPreview; return {isolated:Boolean(preview),controls:document.querySelectorAll("input,select,button").length,previewExperiments:frame.contentDocument.querySelectorAll("[data-lab-control]").length};})()');
    assert(result.lab.isolated && result.lab.controls > 3 && result.lab.previewExperiments === 0, 'Lab controls must remain outside preview');
    result.lab.versions = await evaluate(`(function(){
      const lab=VFLab,frame=document.querySelector('iframe'),api=frame.contentWindow.VFPreview,m=api.model;
      const expect=(value,message)=>{if(!value)throw Error(message)};
      api.dismissGuide();m.seek(23);m.beginAnnotation();m.updateText('只保留在内存中的测试草稿');api.render();
      const original=lab.getParams(),a=lab.saveVersion('浏览器比较 A');expect(a,'Could not save version A');
      const next={...original,panelWidth:Math.min(360,original.panelWidth+24),radius:Math.min(30,original.radius+2)};
      expect(lab.setParams(next),'Could not adjust parameters');const b=lab.saveVersion('浏览器比较 B');expect(b,'Could not save version B');
      expect(lab.applyVersion(a),'Could not apply version A');expect(api.getParams().panelWidth===original.panelWidth,'Version A did not reach the iframe');
      expect(lab.applyVersion(b),'Could not apply version B');expect(api.getParams().panelWidth===next.panelWidth,'Version B did not reach the iframe');
      expect(api.model===m&&m.state.frame===23&&m.state.draft.text==='只保留在内存中的测试草稿','A/B switching reset the observation / draft');
      const exported=lab.exportVersion();expect(Object.keys(exported).sort().join(',')==='aspect,name,params,schema','Export must contain design configuration only');
      expect(Object.values(exported.params).every(value=>typeof value==='number'),'Design parameters must be numbers');
      const before=lab.getVersions().length;
      expect(lab.importVersion('{')===false,'Broken JSON should be rejected');
      expect(lab.importVersion(JSON.stringify({...exported,records:[]}))===false,'Media / annotation payload should be rejected');
      expect(lab.importVersion(JSON.stringify({...exported,params:{...exported.params,radius:999}}))===false,'Out-of-range parameter should be rejected');
      expect(lab.importVersion('{"__proto__":{"polluted":true}}')===false,'Prototype pollution payload should be rejected');
      expect(lab.getVersions().length===before,'Failed imports must not append versions');
      const imported=lab.importVersion(JSON.stringify(exported));expect(imported&&lab.getVersions().length===before+1,'Valid JSON import should append a named design version');
      const stored=JSON.parse(localStorage.getItem('vf-ui01-versions-v1'));
      expect(stored.versions.length===3,'Named versions must be persisted in the sample-only key');
      expect(stored.versions.every(value=>Object.keys(value).sort().join(',')==='aspect,createdAt,id,name,params'),'Persistent design records must exclude media / annotations');
      return {count:stored.versions.length,lastId:imported,params:exported.params,framePreserved:true,draftPreserved:true,invalidImportsRejected:4,configurationOnly:true};
    })()`);
    await evaluate('window.__ui01BeforeReload = true');
    await send('Page.reload', { ignoreCache: true }, sessionId);
    await ready('!window.__ui01BeforeReload && Boolean(window.VFLab && document.querySelector("iframe")?.contentWindow.VFPreview)', 50000, 'Reloaded lab not ready');
    await pause(100);
    result.lab.reopened = await evaluate('(function(){const lab=VFLab,preview=document.querySelector("iframe").contentWindow.VFPreview;return {count:lab.getVersions().length,params:lab.getParams(),previewParams:preview.getParams()};})()');
    assert.equal(result.lab.reopened.count, result.lab.versions.count, 'Versions missing after page reopen');
    assert.deepEqual(result.lab.reopened.params, result.lab.versions.params, 'Last parameter version missing after page reopen');
    assert.deepEqual(result.lab.reopened.previewParams, result.lab.versions.params, 'Reopened design did not reach preview iframe');
    await evaluate('document.getElementById("baselineView").click()');
    await ready('Boolean(document.querySelector("iframe")?.contentDocument?.getElementById("baselineScene"))', 52000, 'Static baseline not ready');
    result.baseline = await evaluate('(function(){const d=document.querySelector("iframe").contentDocument,sidebar=d.querySelector(".sidebar").getBoundingClientRect(),transport=d.querySelector(".transport").getBoundingClientRect();return {sidebarWidth:sidebar.width,transportHeight:transport.height,controlsDisabled:[...d.querySelectorAll("button,select,input")].every(node=>node.disabled),thumbnails:d.querySelectorAll("#baselineComments button").length};})()');
    assert(result.baseline.controlsDisabled && result.baseline.thumbnails > 0, 'Static baseline must remain non-interactive');
    assert.equal(result.baseline.sidebarWidth, 220); assert.equal(result.baseline.transportHeight, 180);
    assert.equal(errors.length, 0, 'Native browser errors: ' + JSON.stringify(errors));
    assert(!timedOut, 'Browser duration or temporary storage stop line reached');
    result.passed = true;
  } catch (error) {
    failure = error; result.error = error.stack;
    if (socket?.readyState === WebSocket.OPEN && sessionId && screenshots < limits.screenshots) {
      try { result.checks = await evaluate('window.__VFChecks || []'); result.focusDiagnostics = await evaluate('window.__VFFocusDiagnostics || null'); } catch (_) { /* Retain the original failure if evaluation is unavailable. */ }
      try { await capture('failure'); } catch (captureError) { result.failureScreenshotError = captureError.message; }
    }
  }
  finally {
    clearInterval(budgetTimer);
    if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch (_) { /* Browser can close transport before acknowledging. */ } socket.close(); }
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('Browser check finished')); } pending.clear();
    if (browser?.exitCode === null) {
      if (!await Promise.race([closed.then(() => true), pause(2500).then(() => false)])) { browser.kill(); await closed; }
    } else if (closed) await closed;
    await new Promise(resolve => server.close(resolve));
    try {
      assert(!browser || browser.exitCode !== null || browser.signalCode !== null, 'Owned Chrome still running');
      assert(inside(evidence, ownedRoot) && path.basename(ownedRoot) === 'browser-' + nonce);
      assert.equal(fs.realpathSync(ownedRoot).toLowerCase(), ownedRoot.toLowerCase());
      const savedOwner = JSON.parse(fs.readFileSync(path.join(ownedRoot, 'owner.json'), 'utf8'));
      assert.equal(savedOwner.owner, owner.owner); assert.equal(savedOwner.nonce, nonce); assert.equal(savedOwner.pid, owner.pid);
      assert.equal(referencedProcesses(ownedRoot).length, 0, 'Chrome process still references the owned profile');
      const snapshot = inventory(ownedRoot, true); assert(snapshot.bytes <= limits.scratchBytes, 'Temporary profile exceeded budget; retain for bounded diagnosis');
      for (const file of snapshot.files) {
        const stat = fs.lstatSync(file.file);
        assert(!stat.isSymbolicLink() && stat.isFile() && String(stat.dev) === file.dev && String(stat.ino) === file.ino && stat.size === file.bytes && sha(fs.readFileSync(file.file)) === file.sha256, 'Temporary file changed before cleanup');
        fs.unlinkSync(file.file);
      }
      for (const dir of snapshot.dirs) { assert(inside(evidence, dir) && !fs.lstatSync(dir).isSymbolicLink()); fs.rmdirSync(dir); }
      result.cleanup = { removed: true, files: snapshot.files.length, bytes: snapshot.bytes, nonce, processReferences: 0 };
    } catch (error) { result.cleanup = { removed: false, nonce, error: error.message }; result.passed = false; failure ||= error; }
    result.durationMs = Date.now() - launchedAt; result.pageErrors = errors;
    writeEvidence('summary-' + stamp + '.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  }
  if (failure) throw failure;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
