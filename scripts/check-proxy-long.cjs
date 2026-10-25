'use strict';

// Explicit E34 duration/control-index check. The repeated low-complexity source
// is not a representative benchmark for arbitrary VFX decoding throughput.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib'), assert = require('assert');
const { spawnSync } = require('child_process');
const argument = name => { const value = process.argv.find(arg => arg.startsWith(name + '=')); return value && value.slice(name.length + 1); };
const root = path.resolve(__dirname, '..'), scaleFix = process.argv.includes('--inventory-scale-fix'), batchWriter = process.argv.includes('--batch-writer');
assert(!(scaleFix && batchWriter), 'Repair scopes cannot share or reset a run budget');
const evidence = path.join(root, 'verification-runs', batchWriter ? 'e35-proxy' : scaleFix ? 'e34-scale-fix' : 'e34-long');
const maxRounds = batchWriter ? 4 : scaleFix ? 1 : 3;
const seconds = Number(argument('--seconds') || 30), MAX_DISK = (batchWriter ? 3 : 2) * 1024 ** 3, MAX_EVIDENCE = 8 * 1024 ** 2, MAX_JSON = 1024 ** 2;
const approvedRuntime = new Map(); let cacheGateBinding = null;
assert([30, 300, 1800].includes(seconds), '--seconds must be 30, 300 or 1800');
assert(fs.readFileSync(path.join(root, 'docs/experiments/E34/plan.md'), 'utf8').includes('verification-runs/e34-long'), 'Root must register the independent e34-long budget before running this script');
if (batchWriter) {
  assert(fs.readFileSync(path.join(root, 'docs/experiments/E35/plan.md'), 'utf8').includes('verification-runs/e35-proxy'), 'Register E35 media only after the complete interruption gate passes');
  const declared = argument('--cache-gate'); assert(declared, 'Batch media requires --cache-gate=<complete real-file gate>');
  const file = fs.realpathSync(path.resolve(root, declared)), gateRoot = fs.realpathSync(path.join(root, 'verification-runs/e35-cache')) + path.sep;
  assert(file.toLowerCase().startsWith(gateRoot.toLowerCase()) && path.basename(file).match(/^batch-[0-9a-f]{16}\.json$/) && fs.statSync(file).size <= MAX_JSON);
  const gate = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert(gate.status === 'passed' && gate.cleanup?.completed && !gate.diagnosticGroup && gate.cases.length === gate.expectedPoints.length &&
    gate.expectedPoints.includes('recovery-after-current-delete') && gate.expectedPoints.includes('recovery-after-writer-delete') &&
    gate.cases.every(item => item.status === 'passed') && gate.expectedPoints.every(point => gate.cases.some(item => item.point === point)), 'Batch recovery matrix is incomplete or failed');
  const allowed = new Set(['cache.cjs','frame-index.cjs','process-identity.cjs','frame-pack.cjs','preview-profile.cjs','native/task-host.cs','native/task-host.local.exe','native/task-host.local.json','fixture-runner.cjs']);
  assert(Array.isArray(gate.sources) && gate.sources.length === allowed.size);
  for (const source of gate.sources) {
    const expected=source.copy==='fixture-runner.cjs'?path.join(root,'scripts/check-cache-batch.cjs'):path.join(root,'plugin',source.copy);
    assert(allowed.delete(source.copy) && path.resolve(source.source) === expected && fs.statSync(source.source).size < 2 * MAX_JSON);
    assert(crypto.createHash('sha256').update(fs.readFileSync(source.source)).digest('hex') === source.sha256, 'Batch runtime changed after its real recovery gate');
    if(source.copy!=='fixture-runner.cjs')approvedRuntime.set(source.copy,source.sha256);
  }
  cacheGateBinding={file:path.relative(root,file),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
  if (seconds !== 30) {
    const declaredBaseline = argument('--baseline'); assert(declaredBaseline, 'Long batch media requires its short same-action baseline');
    const baselineFile = fs.realpathSync(path.resolve(root, declaredBaseline));
    assert(baselineFile.toLowerCase().startsWith((fs.realpathSync(evidence) + path.sep).toLowerCase()) && fs.statSync(baselineFile).size <= MAX_JSON);
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    assert(baseline.status === 'passed' && baseline.stage === 'E35-proxy' && baseline.fixture.seconds === 30 && baseline.fixture.audio &&
      baseline.runtimeInputs.every(item => item.sha256 === crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'plugin',item.file))).digest('hex')), 'Short baseline does not cover this batch runtime');
    for(const item of baseline.runtimeInputs)approvedRuntime.set(item.file,item.sha256);
    assert(baseline.harnessInputs.every(item=>item.sha256===crypto.createHash('sha256').update(fs.readFileSync(path.join(root,item.file))).digest('hex')),'Harness changed after the short comparison');
  }
}
if (scaleFix) {
  assert(seconds === 1800, 'Inventory repair scope is one thirty-minute comparison only');
  assert(fs.readFileSync(path.join(root, 'docs/experiments/E34/plan.md'), 'utf8').includes('verification-runs/e34-scale-fix'), 'Inventory repair budget must be recorded before media starts');
  const priorRoot = path.join(root, 'verification-runs/e34-long');
  const prior = fs.readdirSync(priorRoot).filter(name => /^long-[0-9a-f]{16}\.json$/.test(name)).map(name => JSON.parse(fs.readFileSync(path.join(priorRoot, name), 'utf8')));
  assert(prior.length === 3 && prior.some(value => value.fixture.seconds === 1800 && value.status === 'failed' && value.cleanup?.completed), 'Keep the original three rounds closed, failed scale evidence and completed cleanup before repair comparison');
}
if (seconds === 1800) {
  const name = argument('--baseline'); assert(name, 'Thirty-minute run needs --baseline=<verified local JSON> after the short performance gate passes');
  const file = fs.realpathSync(path.resolve(root, name)), acceptedRoot = fs.realpathSync(path.join(root, 'verification-runs')) + path.sep;
  assert(file.toLowerCase().startsWith(acceptedRoot.toLowerCase()) && file.endsWith('.json') && fs.statSync(file).size <= MAX_JSON, 'Baseline must be a bounded local verification JSON');
  const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
  const browsers = (baseline.checks || []).filter(value => Array.isArray(value.cases));
  assert(baseline.status === 'passed' && browsers.some(browser => {
    const ssd = browser.cases.find(value => value.name === 'ready-SSD-random-seek'), ram = browser.cases.find(value => value.name === 'RAM-60Hz-back-and-forth-drag');
    return browser.status === 'passed' && ssd && ssd.status === 'passed' && ssd.disk && ssd.disk.p95Ms <= 50 && ram && ram.status === 'passed';
  }), 'The declared baseline has not passed both SSD P95<=50ms and RAM drag gates');
}
fs.mkdirSync(evidence, { recursive: true });
const names = fs.readdirSync(evidence), existingFiles = names.filter(name => fs.statSync(path.join(evidence, name)).isFile());
assert(names.filter(name => /^long-[0-9a-f]{16}\.json$/.test(name)).length < maxRounds, 'Registered E34 duration/repair round budget reached');
const existingBytes = existingFiles.reduce((sum, name) => sum + fs.statSync(path.join(evidence, name)).size, 0);
assert(existingBytes <= MAX_EVIDENCE - 2 * MAX_JSON, 'E34 long evidence lacks a reserved two-MiB result space; no media started');
const id = crypto.randomBytes(8).toString('hex'), scratch = path.join(evidence, 'scratch-' + id), output = path.join(evidence, 'long-' + id + '.json');
fs.mkdirSync(scratch);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function hashFile(file) {
  const fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(64 * 1024), digest = crypto.createHash('sha256');
  try { let bytes; while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, bytes)); }
  finally { fs.closeSync(fd); }
  return digest.digest('hex');
}
const started = Date.now(), record = { id, stage: batchWriter ? 'E35-proxy' : scaleFix ? 'E34-scale-fix' : 'E34-long', started: new Date().toISOString(), status: 'running',
  limits: { rounds: maxRounds, scratchBytes: MAX_DISK, evidenceBytes: MAX_EVIDENCE, singleFileBytes: MAX_JSON, wallSeconds: 1200, generationProcesses: 1 },
  fixture: { seconds, width: 1280, height: 720, fps: 60, expectedFrames: seconds * 60, clipSeconds: 2, audio: batchWriter,
    ...(batchWriter ? { playbackObservationMs: seconds === 1800 ? 600000 : 5200, audioDescription: 'Independent continuous 431Hz AAC track; video alone repeats the two-second grid.' } : {}),
    scope: 'Repeated static grid with a tiny blinking region; verifies duration/index/control and same-action interaction. It does not represent complex-source throughput or prove a unique global frame ordinal from pixels.' },
  checks: [], artifacts: [] };
record.harnessInputs = ['scripts/check-proxy-long.cjs','tests/support/proxy-player-browser.cjs',...(batchWriter?['tests/support/proxy-batch-cancel.cjs']:[])].map(file => {
  const bytes=fs.readFileSync(path.join(root,file)); return { file, bytes:bytes.length, sha256:hash(bytes) };
});
if(cacheGateBinding)record.cacheGateBinding=cacheGateBinding;
let recordIdentity = null, artifactSerial = 0, evidenceFailure = null;
function currentEvidenceBytes() { return fs.readdirSync(evidence).reduce((sum, name) => { const stat = fs.statSync(path.join(evidence, name)); return sum + (stat.isFile() ? stat.size : 0); }, 0); }
function archive(label, value, cleanupReceipt = false) {
  const bytes = Buffer.from(JSON.stringify(value)), packed = zlib.gzipSync(bytes, { level: 9 });
  const digest = hash(bytes), prior = record.artifacts.find(item => item.sha256 === digest);
  if (prior) return { ...prior, label };
  // Preserve every byte. Large gzip streams are split, never truncated.
  const parts = [], stem = `raw-${id}-${String(++artifactSerial).padStart(3, '0')}`;
  assert(currentEvidenceBytes() + packed.length + (batchWriter && !cleanupReceipt ? 2 : 1) * MAX_JSON <= MAX_EVIDENCE, 'Registered evidence budget would be exceeded; retain a failure summary and stop');
  for (let at = 0, part = 0; at < packed.length; at += 900 * 1024, part++) {
    const data = packed.subarray(at, at + 900 * 1024), name = `${stem}-${String(part).padStart(3, '0')}.gzpart`;
    fs.writeFileSync(path.join(evidence, name), data, { flag: 'wx' }); parts.push({ file: name, bytes: data.length, sha256: hash(data) });
  }
  const item = { label, encoding: 'concatenate-parts-then-gunzip-utf8-json', bytes: bytes.length, gzipBytes: packed.length, sha256: digest, gzipSha256: hash(packed),
    ...(Array.isArray(value) ? { entries: value.length } : {}), parts };
  record.artifacts.push(item); return item;
}
function boundEvidence(value, label = 'record') {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    if (key === 'artifacts') continue;
    if (/^raw(?:Inputs|Outcomes|Events|Samples|AudioReads)$/.test(key) && Array.isArray(value[key])) {
      value[key + 'Archive'] = archive(label + '.' + key, value[key]); delete value[key];
    } else boundEvidence(value[key], label + '.' + key);
  }
}
function checkpoint() {
  let text, newFailure = null;
  try { if (evidenceFailure) throw evidenceFailure;
  boundEvidence(record); text = JSON.stringify(record, null, 2);
  if (Buffer.byteLength(text) > MAX_JSON) {
    // The raw arrays already have lossless archives. Preserve any unusually
    // verbose report as a further artifact instead of losing this run record.
    const checks = archive('overflow-checks', record.checks); record.checks = [{ name: 'checks-archived-for-single-file-limit', archive: checks }];
    text = JSON.stringify(record, null, 2);
  }
  } catch (error) {
    if (!evidenceFailure) { evidenceFailure = error; newFailure = error; }
    record.status = 'failed'; process.exitCode = 1;
    // An archive limit cannot recursively prevent its own durable failure.
    // No unarchived raw array is represented as saved or accepted.
    const checks = record.checks.map(value=>({name:value.name,origin:value.origin,status:value.status,
      cases:value.cases?.map(item=>({name:item.name,status:item.status,error:item.error})),error:value.error}));
    text = JSON.stringify({id:record.id,stage:record.stage,started:record.started,finished:record.finished,status:'failed',
      limits:record.limits,fixture:record.fixture,runtimeInputs:record.runtimeInputs,harnessInputs:record.harnessInputs,
      checks,artifacts:record.artifacts,error:record.error,cleanup:record.cleanup,cleanupError:record.cleanupError,
      evidenceFailure:{message:evidenceFailure.message,rawPreservation:'Incomplete: only listed archives remain; unarchived raw data were not preserved and no performance pass is claimed.'}},null,2);
  }
  assert(Buffer.byteLength(text) <= MAX_JSON, 'Bounded summary exceeded one MiB');
  if (recordIdentity) { const stat = fs.lstatSync(output, { bigint: true }); assert(String(stat.dev) === recordIdentity.dev && String(stat.ino) === recordIdentity.ino && hashFile(output) === recordIdentity.sha256, 'Result file identity changed'); }
  const temp = output + '.next'; fs.writeFileSync(temp, text, { flag: 'wx' }); fs.renameSync(temp, output);
  const stat = fs.lstatSync(output, { bigint: true }); recordIdentity = { dev: String(stat.dev), ino: String(stat.ino), sha256: hash(Buffer.from(text)) };
  if (newFailure) throw newFailure;
}
checkpoint(); // A crash or later budget/error path still leaves a bounded run record.
let tools;
let client = null, watchdog = null, monitoring = false, guardFailure = null, monitorRunning = false, monitorWork = Promise.resolve(), lastBackground = '', preparedAt = null, unsafeScratch = false;
const backgroundSamples = [];
function elapsed() { return Date.now() - started; }
function run(args, timeout = 60000) {
  assert(elapsed() < 60000, 'Preparation exceeded its reserved one-minute window; browser not started');
  const began = performance.now(), value = spawnSync(tools.ffmpeg, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, timeout, maxBuffer: 1024 ** 2 });
  if (value.error || value.status !== 0) throw value.error || Error(value.stderr.toString().slice(-4096));
  return performance.now() - began;
}
function inventoryFiles(directory, live = false) {
  const entries = [];
  function walk(folder) {
    let names;
    try { names = fs.readdirSync(folder, { withFileTypes: true }); }
    catch (error) { if (live && error.code === 'ENOENT') return; throw error; }
    for (const item of names) {
      const file = path.join(folder, item.name); let stat;
      try { stat = fs.lstatSync(file, { bigint: true }); }
      catch (error) { if (live && error.code === 'ENOENT') continue; throw error; }
      assert(!stat.isSymbolicLink(), 'Unexpected scratch link');
      if (stat.isDirectory()) walk(file);
      else { assert(stat.isFile() && stat.nlink === 1n, 'Unexpected scratch object'); entries.push({ file, ino: String(stat.ino), dev: String(stat.dev), bytes: Number(stat.size) }); }
    }
  }
  walk(directory); return entries;
}
async function liveScratchBytes(directory) {
  let total=0;
  async function walk(folder) {
    let names;try{names=await fs.promises.readdir(folder,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const name of names){const file=path.join(folder,name.name);let stat;try{stat=await fs.promises.lstat(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      assert(!stat.isSymbolicLink(),'Unexpected live scratch link');
      if(stat.isDirectory())await walk(file);else{assert(stat.isFile()&&stat.nlink===1);total+=stat.size;assert(Number.isSafeInteger(total));}
    }
  }
  await walk(directory);return total;
}
function observe(info) {
  if (!monitoring || monitorRunning) return;
  monitorRunning = true;
  monitorWork=(async()=>{
  try {
    const status = client.cache.backgroundStatus(info), text = JSON.stringify(status);
    if (text !== lastBackground) { backgroundSamples.push({ msSincePrepare: Date.now() - preparedAt, status }); lastBackground = text; }
    if (status && (status.stage === 'complete' || status.complete === true) && record.backgroundCompleteMs === undefined)
      record.backgroundCompleteMs = Date.now() - preparedAt;
    if (elapsed() >= 1180000) throw Error('Long-run wall deadline is approaching; stop before twenty minutes');
    if (!record.lastDiskSampleAt || Date.now() - record.lastDiskSampleAt >= 5000) {
      // Keep the safety monitor off the same event loop serving frame HTTP.
      // It must not manufacture periodic playback stalls as the fixture grows.
      const bytes = await liveScratchBytes(scratch);
      record.peakObservedScratchBytes = Math.max(record.peakObservedScratchBytes || 0, bytes); record.lastDiskSampleAt = Date.now();
      if (bytes > MAX_DISK - 128 * 1024 ** 2) throw Error('Long-run scratch reached its registered safety margin; generation stopped');
    }
  } catch (error) {
    guardFailure = error; monitoring = false;
    if (client) client.close().catch(failure => { record.workerGuardCloseError = failure.message; });
  } finally { monitorRunning = false; }
  })();
  return monitorWork;
}
function cacheSummary(workerRoot) {
  const value = require('../plugin/cache.cjs').createCache({ pluginRoot: workerRoot }).inventory();
  return { exists: value.exists, usedBytes: value.usedBytes, limitBytes: value.diskLimitBytes, caches: value.caches.length, leases: value.leases.length };
}
async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tests/host/t0/config.local.json'), 'utf8'));
  tools = { ffmpeg: config.ffmpeg, ffprobe: config.ffprobe }; // Never read config.sources.
  for (const tool of Object.values(tools)) assert(typeof tool === 'string' && path.isAbsolute(tool) && fs.statSync(tool).isFile(), 'Existing media tool unavailable');
  const clip = path.join(scratch, 'clip-2s.mp4'), source = path.join(scratch, `synthetic-${seconds}s.mp4`);
  const generationMs = run(['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x17242e:size=1280x720:rate=60:duration=2',
    '-vf', "drawgrid=w=64:h=64:thickness=1:color=0x506070@0.5,drawbox=x=40:y=40:w=40:h=40:color=white:t=fill:enable='mod(n,2)'",
    '-an', '-c:v', 'libx264', '-threads', '4', '-preset', 'ultrafast', '-crf', '20', '-g', '120', '-bf', '0', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', clip]);
  const copiedMs = run(['-v', 'error', '-stream_loop', '-1', '-i', clip,
    ...(batchWriter ? ['-f','lavfi','-i',`sine=frequency=431:sample_rate=48000:duration=${seconds}`] : []),
    '-t', String(seconds), '-map', '0:v:0',
    ...(batchWriter ? ['-map','1:a:0','-c:v','copy','-c:a','aac','-aac_pns','0'] : ['-an','-c','copy']),
    '-movflags', '+faststart', source]);
  const sourceHash = hashFile(source), clipHash = hashFile(clip);
  record.checks.push({ name: 'repeated-source-created', generationMs, streamCopyMs: copiedMs, sourceBytes: fs.statSync(source).size,
    sha256: sourceHash, clipSha256: clipHash, doesNotRepresentComplexSource: true }); checkpoint();
  const audioReferenceFile = path.join(scratch,'audio-reference.f32le');
  if (batchWriter) {
    const decodeMs = run(['-v','error','-copyts','-i',source,'-vn','-af','aresample=48000','-c:a','pcm_f32le','-f','f32le',audioReferenceFile]);
    record.audioReference = { bytes:fs.statSync(audioReferenceFile).size,sha256:hashFile(audioReferenceFile),decodeMs,sampleRate:48000,channels:1,
      scope:'Independent full-source audio decode before the worker starts; compared with seeked segment PCM. Not a physical sound-output test.' };
    checkpoint();
  }
  if(batchWriter&&seconds===30){
    const cancellation=await require('../tests/support/proxy-batch-cancel.cjs').checkProxyBatchCancel({root,scratch,source,tools});
    record.checks.push(cancellation);unsafeScratch=!cancellation.close?.safeToCleanup;checkpoint();
    assert(!unsafeScratch&&cancellation.status==='passed'&&cancellation.sameBatchReused,'First-AU real cancellation or owned close did not pass');
  }
  const workerRoot = path.join(scratch, 'worker'); fs.mkdirSync(workerRoot); fs.mkdirSync(path.join(workerRoot, 'native'));
  const runtime = require('./package-release.cjs').RUNTIME, inputs = [];
  for (const name of runtime) {
    const original = path.resolve(root, 'plugin', name), stat = fs.lstatSync(original, { bigint: true });
    assert(original.startsWith(path.join(root, 'plugin') + path.sep) && !stat.isSymbolicLink() && stat.isFile() && stat.size <= BigInt(2 * MAX_JSON), 'Unexpected runtime input');
    const bytes = fs.readFileSync(original), after = fs.lstatSync(original, { bigint: true });
    assert(['dev', 'ino', 'size', 'mtimeNs'].every(key => stat[key] === after[key]), 'Runtime input changed during copy');
    if(approvedRuntime.has(name))assert.equal(hash(bytes),approvedRuntime.get(name),'Copied runtime differs from its recovery/short gate: '+name);
    fs.writeFileSync(path.join(workerRoot, name), bytes, { flag: 'wx' }); inputs.push({ file: name, bytes: bytes.length, sha256: hash(bytes) });
  }
  record.runtimeInputs = inputs;
  const { createTaskClient } = require('../plugin/task-client.cjs');
  const make = () => createTaskClient({ pluginRoot: workerRoot, runtime: process.execPath, discoverTools: async () => tools });
  client = make(); const ping = await client.ping(); record.runtime = { node: ping.node, eagle: false };
  const settings = { previewQuality: '720p', playbackBackend: 'proxy' }, selected = { id: 'synthetic-long-only', filePath: source, ext: 'mp4' };
  const controller = new AbortController(), prepTimeout = setTimeout(() => controller.abort(), Math.max(1000, 60000 - elapsed()));
  let info; const before = performance.now();
  try { info = await client.media.prepare(selected, { ...settings, signal: controller.signal }); } finally { clearTimeout(prepTimeout); }
  preparedAt = Date.now();
  assert.equal(info.frames.length, seconds * 60); assert(info.streaming && info.videoEncoding && info.videoEncoding.format === 'annexb-idr-v1');
  assert.equal(info.source.sha256, sourceHash);
  let previous = null;
  for (let n = 0; n < info.frames.length; n++) { const frame = info.frames[n], ticks = BigInt(frame.ptsTicks); assert(frame.id === n && (previous === null || ticks > previous)); previous = ticks; }
  const wire = require('../plugin/media-wire.cjs').packInfo(info);
  record.checks.push({ name: 'formal-prepare-control-index', firstPrepareMs: performance.now() - before, frames: info.frames.length, segments: info.segments.length,
    duration: info.duration, wireBytes: Buffer.byteLength(JSON.stringify(wire)), expandedIndexBytes: Buffer.byteLength(JSON.stringify(info.frames)), uniqueIncreasingPts: true,
    sourceSha256: info.source.sha256, sourceUnchanged: hashFile(source) === sourceHash }); checkpoint();
  assert(elapsed() < 60000, 'Source/index setup consumed reserved browser time; long browser not started');
  if (batchWriter) {
    const cacheRoot=path.join(workerRoot,'cache'),deadline=Date.now()+3000;let observed=null;
    while(!observed&&Date.now()<deadline){
      for(const name of fs.readdirSync(cacheRoot).filter(name=>/^partial-[0-9a-f]{24}$/.test(name))){
        const file=path.join(cacheRoot,name,'frames.pack');
        try{const stat=fs.lstatSync(file);if(stat.isFile()&&stat.nlink===1&&stat.size>0)observed={file:path.relative(scratch,file),bytes:stat.size};}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(!observed)await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert(observed,'No real packed output was observed; cancellation-after-output was not exercised');
    record.checks.push({name:'background-output-observed-before-foreground-operation',observed,
      limitation:'Observation alone does not bind this output to the cancelled request; the short instrumented first-AU case provides that proof.'});checkpoint();
  }
  const old = client.cache.readAsset(info, info.frames[info.frames.length - 1].file).then(() => ({ status: 'completed-before-cancel' }), error => ({ status: 'cancelled', code: error.code, message: error.message }));
  client.cache.target(info, 0); const cancellation = await old;
  assert.equal(cancellation.code, 'MEDIA_CANCELLED', 'Old unprepared target was not actually cancelled');
  assert((await client.cache.readAsset(info, info.frames[0].file)).byteLength > 0);
  const cancelled = new AbortController(), prepareAgain = client.media.prepare({ id: 'synthetic-cancel-only', filePath: clip, ext: 'mp4' }, { ...settings, signal: cancelled.signal });
  const cancelTimer = setTimeout(() => cancelled.abort(), 20);
  try { await assert.rejects(prepareAgain, error => error.code === 'MEDIA_CANCELLED' || error.name === 'AbortError'); } finally { clearTimeout(cancelTimer); }
  record.checks.push({ name: 'cancel-old-target-and-new-source-prepare', cancellation, newSourceCancellationAfterMs: 20 }); checkpoint();
  if (batchWriter) {
    assert(info.audio && info.audio.channels === 1 && info.audio.sampleRate === 48000);
    const audioRows=[],referenceFd=fs.openSync(audioReferenceFile,'r');
    record.checks.push({name:'source-aligned-PCM-sample-comparison',rows:audioRows});checkpoint();
    try { for (const ordinal of [...new Set([0,1,Math.floor(info.segments.length/2),info.segments.length-1])]) {
      const began=performance.now(),audio=await client.cache.readAudioSegment(info,ordinal);
      if (!audio) continue;
      const bytes=Buffer.from(audio.bytes),format=require('../plugin/media.cjs')._test.patchWav(Buffer.from(bytes.subarray(0,Math.min(bytes.length,4096))),bytes.length);
      const actual=bytes.subarray(format.dataOffset),offset=Math.round(audio.start*48000)*4;
      assert(offset>=0 && offset+actual.length<=record.audioReference.bytes && format.channels===1 && format.sampleRate===48000);
      const expected=Buffer.alloc(actual.length);let at=0;
      while(at<expected.length){const count=fs.readSync(referenceFd,expected,at,expected.length-at,offset+at);assert(count>0);at+=count;}
      let firstDifference=0,maxDelta=0,changed=0;while(firstDifference<actual.length&&actual[firstDifference]===expected[firstDifference])firstDifference++;
      for(let n=0;n+4<=actual.length;n+=4){const delta=Math.abs(actual.readFloatLE(n)-expected.readFloatLE(n));maxDelta=Math.max(maxDelta,delta);if(delta)changed++;}
      const row={ordinal,sourceStart:audio.start,bytes:actual.length,format,actualSha256:hash(actual),referenceSha256:hash(expected),firstDifference,maxDelta,changed,
        actualHead:actual.subarray(0,1024).toString('base64'),referenceHead:expected.subarray(0,1024).toString('base64'),ms:performance.now()-began};
      audioRows.push(row);checkpoint();assert.equal(row.actualSha256,row.referenceSha256,'Source-aligned PCM differs at segment '+ordinal);
    }} finally { fs.closeSync(referenceFd); }
    assert(audioRows.length>=3);checkpoint();
  }
  monitoring = true; watchdog = setInterval(() => observe(info), 250); observe(info);
  const facade = { ...client, cache: { ...client.cache, backgroundStatus: value => guardFailure ? { stage: 'error', error: guardFailure.message } : client.cache.backgroundStatus(value) } };
  const browser = await require('../tests/support/proxy-player-browser.cjs').checkProxyPlayerBrowser({ root, scratch, client: facade, info, backgroundTimeoutMs: 900000,
    ...(batchWriter ? {requireAudio:true,requireBackgroundOverlap:seconds===1800,playDurationMs:seconds===1800?600000:5200} : {}) });
  record.checks.push(browser);
  monitoring = false; clearInterval(watchdog); watchdog = null; await monitorWork;
  record.backgroundProgressArchive = archive('all-background-status-changes', backgroundSamples); checkpoint();
  if (guardFailure) throw guardFailure;
  if (browser.status !== 'passed') throw Error('Formal long interaction acceptance did not pass: ' + browser.status + '; see preserved browser cases before any final cache inventory');
  record.readyCache = cacheSummary(workerRoot);
  const background = client.cache.backgroundStatus(info);
  record.checks.push({ name: 'all-background-segments-state', background, backgroundCompleteMs: record.backgroundCompleteMs,
    allSegmentsReady: !!background && (background.stage === 'complete' || background.complete === true) }); checkpoint();
  await client.cache.release(info); assert.equal(cacheSummary(workerRoot).leases, 0);
  const switched = await client.media.prepare({ id: 'synthetic-switch-short', filePath: clip, ext: 'mp4' }, settings);
  assert.equal(switched.source.sha256, clipHash); assert((await client.cache.readAsset(switched, switched.frames[0].file)).byteLength > 0);
  await client.cache.release(switched); await client.close(); client = make();
  const reopenedAt = performance.now(), reopened = await client.media.prepare(selected, settings);
  assert.equal(reopened.frames.length, seconds * 60); assert.equal(reopened.source.sha256, sourceHash);
  assert((await client.cache.readAsset(reopened, reopened.frames[reopened.frames.length - 1].file)).byteLength > 0);
  record.checks.push({ name: 'switch-release-close-reopen', reopenPrepareAndLastFrameMs: performance.now() - reopenedAt, sourceSha256: reopened.source.sha256 });
  await client.cache.release(reopened); await client.close(); client = null;
  const final = cacheSummary(workerRoot); assert.equal(final.leases, 0);
  for(const item of record.runtimeInputs)assert.equal(hashFile(path.join(root,'plugin',item.file)),item.sha256,'Runtime changed during the measured run');
  for(const item of record.harnessInputs)assert.equal(hashFile(path.join(root,item.file)),item.sha256,'Harness changed during the measured run');
  assert(!fs.readdirSync(path.join(workerRoot, 'cache')).some(name => /^(?:partial-|lease-|writer\.lock)/.test(name)), 'Owned cache leaked a writer, lease or partial');
  record.finalCache = final; assert.equal(hashFile(source), sourceHash); assert.equal(hashFile(clip), clipHash);
  record.status = browser.status === 'passed' ? 'passed' : browser.status === 'gap' ? 'gap' : 'failed';
  if (browser.status !== 'passed') { record.error = 'Formal long interaction acceptance did not pass: ' + browser.status; process.exitCode = 1; }
  checkpoint();
}
function cleanupScratch() {
  assert(!unsafeScratch,'Do not delete scratch while an instrumented worker lacks confirmed owned close');
  const actual = fs.realpathSync(scratch), parent = fs.realpathSync(evidence);
  assert(actual.toLowerCase().startsWith((parent + path.sep).toLowerCase()) && path.basename(actual) === 'scratch-' + id, 'Scratch path escaped its owned root');
  const files = inventoryFiles(actual), bytes = files.reduce((sum, item) => sum + item.bytes, 0); assert(bytes <= MAX_DISK, 'Cleanup inventory exceeds the scratch budget; retained');
  for (const item of files) item.sha256 = hashFile(item.file);
  record.cleanup = { files: files.length, bytes, inventory: archive('cleanup-original-identities-and-hashes', files.map(item => ({ ...item, file: path.relative(scratch, item.file) })), true) };
  checkpoint(); // Receipts exist before the first deletion, even if deletion fails.
  for (const item of files) {
    const stat = fs.lstatSync(item.file, { bigint: true });
    assert(String(stat.ino) === item.ino && String(stat.dev) === item.dev && Number(stat.size) === item.bytes && hashFile(item.file) === item.sha256, 'Scratch identity changed; retained');
    fs.unlinkSync(item.file);
  }
  function empty(directory) {
    for (const name of fs.readdirSync(directory)) { const child = path.join(directory, name); assert(fs.lstatSync(child).isDirectory()); empty(child); }
    fs.rmdirSync(directory);
  }
  empty(actual); record.cleanup.completed = true;
}
main().catch(error => {
  record.status = 'failed'; record.error = String(error.stack || error).slice(-8192); process.exitCode = 1;
  try { checkpoint(); } catch (saveError) { record.saveError = saveError.message; }
}).finally(async () => {
  monitoring = false; if (watchdog) clearInterval(watchdog);
  await monitorWork;
  if (client) { try { await client.close(); } catch (error) { record.status = 'failed'; record.workerCloseError = error.message; process.exitCode = 1; } }
  if (!record.backgroundProgressArchive && backgroundSamples.length) {
    try { record.backgroundProgressArchive = archive('all-background-status-changes', backgroundSamples); checkpoint(); }
    catch (error) { record.status = 'failed'; record.backgroundEvidenceError = error.message; process.exitCode = 1; }
  }
  try { cleanupScratch(); } catch (error) { record.status = 'failed'; record.cleanupError = error.message; process.exitCode = 1; }
  record.finished = new Date().toISOString(); record.wallMs = elapsed();
  if (record.wallMs > 1200000) { record.status = 'failed'; record.wallBudgetExceeded = true; process.exitCode = 1; }
  try { checkpoint(); } catch (error) { process.exitCode = 1; console.error('Final result retained at prior checkpoint; failed to update: ' + error.message); }
  console.log(JSON.stringify({ id, seconds, status: record.status, checks: record.checks.map(value => ({ name: value.name, origin: value.origin, status: value.status,
    frames: value.frames, firstPrepareMs: value.firstPrepareMs, wireBytes: value.wireBytes,
    ...(value.cases ? { cases: value.cases.map(item => ({ name: item.name, status: item.status, disk: item.disk, updateHz: item.updateHz, maxNoUpdateMs: item.maxNoUpdateMs })) } : {}) })),
    backgroundCompleteMs: record.backgroundCompleteMs, finalCache: record.finalCache, error: record.error, cleanupError: record.cleanupError,
    cleanup: record.cleanup ? { files: record.cleanup.files, bytes: record.cleanup.bytes, completed: record.cleanup.completed } : null, result: path.relative(root, output) }));
});
