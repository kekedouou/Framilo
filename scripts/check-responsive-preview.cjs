'use strict';

// Explicit E36 synthetic/UI/native-video gate. It never reads config.sources,
// opens Eagle, writes annotations, or invokes historical E34/E35 test entries.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib'), assert = require('assert');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..'), recordFix = process.argv.includes('--record-fix'),
  evidence = path.join(root, 'verification-runs', recordFix ? 'e36-records-fix' : 'e36-media');
const MIB = 1024 ** 2, MAX_DISK = 1024 * MIB, MAX_EVIDENCE = 8 * MIB, MAX_JSON = MIB, MAX_MS = recordFix ? 180000 : 300000, MAX_ROUNDS = recordFix ? 2 : 4;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function hashFile(file) { const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(64 * 1024), digest = crypto.createHash('sha256');
  try { let count; while ((count = fs.readSync(fd, bytes, 0, bytes.length, null))) digest.update(bytes.subarray(0, count)); } finally { fs.closeSync(fd); } return digest.digest('hex'); }
function files(directory) {
  const output = []; if (!fs.existsSync(directory)) return output;
  function walk(at) { for (const name of fs.readdirSync(at)) { const file = path.join(at, name), stat = fs.lstatSync(file, { bigint: true });
    assert(!stat.isSymbolicLink(), 'Do not traverse scratch links');
    if (stat.isDirectory()) walk(file); else { assert(stat.isFile() && stat.nlink === 1n); output.push({ file, ino: String(stat.ino), dev: String(stat.dev), bytes: Number(stat.size) }); } } }
  walk(directory); return output;
}
async function main() {
  const began = Date.now(), groupArg = process.argv.slice(2), group = recordFix ? 'record-fix' : groupArg.length ? groupArg[0].slice('--group='.length) : 'all';
  assert(groupArg.length <= 1 && (!groupArg.length || /^--group=(?:ui|media)$/.test(groupArg[0]) || groupArg[0] === '--record-fix'), 'Only one registered scope flag is supported; every invocation consumes its own bounded round');
  const plan = fs.readFileSync(path.join(root, 'docs/experiments/E36/plan.md'), 'utf8');
  assert(plan.includes('verification-runs/e36-media') && plan.includes('1GiB') && plan.includes('五分钟'), 'Register the independent E36 media budget first');
  if (recordFix) {
    assert(plan.includes('verification-runs/e36-records-fix') && plan.includes('三分钟'), 'Register the focused repair before running it');
    const priorRoot = path.join(root, 'verification-runs/e36-media');
    const prior = fs.readdirSync(priorRoot).filter(name => /^media-[0-9a-f]{16}\.json$/.test(name)).map(name => JSON.parse(fs.readFileSync(path.join(priorRoot, name), 'utf8')));
    assert(prior.length === 4 && prior.every(row => ['passed', 'failed', 'incomplete'].includes(row.status) && row.cleanup?.completed), 'Seal all four original rounds and cleanup before focused repair');
  }
  assert.equal(typeof WebSocket, 'function', 'Use the existing Node24 developer runtime; no new dependency is required');
  const runtime = require('./package-release.cjs').RUNTIME;
  const frozen = runtime.map(file => { const bytes = fs.readFileSync(path.join(root, 'plugin', file)); return { file, bytes, sha256: hash(bytes) }; });
  const harness = ['scripts/check-responsive-preview.cjs', 'tests/support/responsive-preview-browser.cjs', ...(group === 'ui' ? [] : ['tests/support/responsive-backend.cjs', 'tests/support/responsive-player-browser.cjs'])].map(file => { const bytes = fs.readFileSync(path.join(root, file)); return { file, bytes, sha256: hash(bytes) }; });
  fs.mkdirSync(evidence, { recursive: true });
  const currentEvidence = () => fs.readdirSync(evidence).reduce((sum, name) => { const stat = fs.lstatSync(path.join(evidence, name)); return sum + (stat.isFile() ? stat.size : 0); }, 0);
  assert(fs.readdirSync(evidence).filter(name => /^(?:media|responsive|preview|run)-[0-9a-f]{16}\.json$/.test(name)).length < MAX_ROUNDS, 'This explicitly registered E36 media budget is exhausted');
  assert(currentEvidence() <= MAX_EVIDENCE - 3 * MIB, 'Reserve three MiB before media/browser work; do not erase older failures');
  const id = crypto.randomBytes(8).toString('hex'), scratch = path.join(evidence, 'scratch-' + id), output = path.join(evidence, 'media-' + id + '.json');
  const record = { schema: 'eva-e36-responsive-preview-v1', id, started: new Date(began).toISOString(), status: 'running', group,
    limits: { invocations: MAX_ROUNDS, scratchBytes: MAX_DISK, evidenceBytes: MAX_EVIDENCE, wallMs: MAX_MS, generationProcesses: 1 },
    scope: recordFix ? 'Focused ready-record borrow/return and actual playing-thumbnail repair; same CFR source, formal Player/guard/read-thread and original performance gates. Prior four rounds remain sealed; no UI/VFR rerun or Eagle acceptance claim.' : 'Formal UI/quick-preview in independent Chrome with controlled 1500ms precise Session completion; the separate native backend hook reports its own exact record-read/close evidence. No real Eagle acceptance claim.',
    runtime: { node: process.versions.node, executable: process.execPath }, runtimeInputs: frozen.map(({ file, bytes, sha256 }) => ({ file, bytes: bytes.length, sha256 })),
    harnessInputs: harness.map(({ file, bytes, sha256 }) => ({ file, bytes: bytes.length, sha256 })), commands: [], fixtures: [], checks: [], artifacts: [], cleanup: { completed: false } };
  let outputStamp = null, archiveSerial = 0, safeToClean = true;
  const stamp = file => { const stat = fs.lstatSync(file, { bigint: true }); return [String(stat.dev), String(stat.ino), String(stat.size)].join(':'); };
  function checkpoint(initial = false) {
    const bytes = Buffer.from(JSON.stringify(record, null, 2)); assert(bytes.length <= MAX_JSON, 'Result exceeds one MiB; retain the prior checkpoint');
    assert(currentEvidence() - (fs.existsSync(output) ? fs.statSync(output).size : 0) + bytes.length <= MAX_EVIDENCE, 'Evidence budget exceeded; no old record deletion');
    const file = initial ? output : output + '.next'; if (!initial) assert.equal(stamp(output), outputStamp, 'Result identity changed');
    const fd = fs.openSync(file, 'wx'); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!initial) fs.renameSync(file, output); outputStamp = stamp(output);
  }
  function archive(label, value) {
    const bytes = Buffer.from(JSON.stringify(value)), packed = zlib.gzipSync(bytes), parts = [];
    assert(currentEvidence() + packed.length + MAX_JSON <= MAX_EVIDENCE, 'Insufficient bounded original-evidence space; never drop/truncate raw arrays');
    const stem = 'raw-' + id + '-' + String(++archiveSerial).padStart(3, '0');
    for (let at = 0, part = 0; at < packed.length; at += 900 * 1024, part++) {
      const block = packed.subarray(at, at + 900 * 1024), name = stem + '-' + String(part).padStart(3, '0') + '.gzpart', fd = fs.openSync(path.join(evidence, name), 'wx');
      try { fs.writeFileSync(fd, block); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } parts.push({ file: name, bytes: block.length, sha256: hash(block) });
    }
    const receipt = { label, encoding: 'concatenate-parts-then-gunzip-utf8-json', bytes: bytes.length, sha256: hash(bytes), gzipBytes: packed.length, gzipSha256: hash(packed), parts };
    record.artifacts.push(receipt); return receipt;
  }
  const elapsed = () => Date.now() - began;
  function budget() { assert(elapsed() < MAX_MS - 20000, 'E36 work deadline reached'); const bytes = files(scratch).reduce((sum, item) => sum + item.bytes, 0); assert(bytes <= MAX_DISK, 'E36 scratch budget exceeded'); record.observedScratchBytes = Math.max(record.observedScratchBytes || 0, bytes); }
  checkpoint(true); fs.mkdirSync(scratch);
  try {
    record.frozenSources = archive('runtime-and-harness-original-bytes', [...frozen.map(item => ({ kind: 'plugin', file: item.file, sha256: item.sha256, base64: item.bytes.toString('base64') })),
      ...harness.map(item => ({ kind: 'harness', file: item.file, sha256: item.sha256, base64: item.bytes.toString('base64') }))]); checkpoint();
    const pluginRoot = path.join(scratch, 'plugin'); fs.mkdirSync(pluginRoot);
    for (const item of frozen) { const target = path.join(pluginRoot, item.file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, item.bytes, { flag: 'wx' }); }
    const config = JSON.parse(fs.readFileSync(path.join(root, 'tests/host/t0/config.local.json'), 'utf8')), tools = { ffmpeg: config.ffmpeg, ffprobe: config.ffprobe };
    for (const tool of Object.values(tools)) assert(typeof tool === 'string' && path.isAbsolute(tool) && fs.statSync(tool).isFile(), 'Use existing configured tools only');
    function run(tool, args) {
      budget(); const row = { executable: tool, args, at: new Date().toISOString(), status: 'running' }; record.commands.push(row); checkpoint();
      const start = Date.now(), result = spawnSync(tool, ['-hide_banner', ...(tool === tools.ffmpeg ? ['-nostdin'] : []), ...args], { windowsHide: true, timeout: Math.max(1,Math.min(90000, MAX_MS - elapsed() - 20000)), maxBuffer: 8 * MIB });
      row.ms = Date.now() - start; row.exitCode = result.status; row.stdout = result.stdout?.toString('utf8') || ''; row.stderr = result.stderr?.toString('utf8') || '';
      row.status = !result.error && result.status === 0 ? 'passed' : 'failed'; if (result.error) row.error = String(result.error.stack || result.error);
      if (Buffer.byteLength(row.stdout)+Buffer.byteLength(row.stderr)>32*1024) { row.originalOutput=archive('command-'+record.commands.length+'-complete-stdout-and-stderr',{stdout:row.stdout,stderr:row.stderr});delete row.stdout;delete row.stderr; }
      checkpoint();
      if (result.error || result.status !== 0) throw result.error || Error('Synthetic generation/probe failed: ' + (row.stderr||result.stderr?.toString('utf8').slice(-4096)));
      budget(); return result.stdout;
    }
    const cfr = path.join(scratch, 'synthetic-cfr.mp4'), vfr = path.join(scratch, 'synthetic-vfr-offset.mp4');
    const filters = ['drawbox=x=0:y=0:w=iw:h=32:color=black:t=fill'];
    for (let bit = 0; bit < 10; bit++) filters.push('drawbox=x=' + (12 + bit * 20) + ':y=8:w=16:h=16:color=white:t=fill:enable=\'mod(floor(n/' + 2 ** bit + '),2)\'');
    run(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=60:duration=16', '-vf', filters.join(','), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-threads', '4',
      '-g', '60', '-bf', '2', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', cfr]);
    if (group !== 'ui' && !recordFix) run(tools.ffmpeg, ['-v', 'error', '-i', cfr, '-vf', "select='not(eq(mod(n,5),1))*not(eq(mod(n,7),2))'", '-fps_mode', 'vfr', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-threads', '4',
      '-g', '60', '-bf', '2', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-output_ts_offset', '3', '-movflags', '+faststart', vfr]);
    const fixtures = [];
    for (const [name, file, offset] of [['cfr', cfr, 0], ...(group === 'ui' || recordFix ? [] : [['vfr-offset', vfr, 3]])]) {
      const probe = JSON.parse(run(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,time_base,duration,start_time:frame=best_effort_timestamp,best_effort_timestamp_time', '-show_frames', '-of', 'json', file]).toString('utf8'));
      const stream = probe.streams[0], times = probe.frames.map(frame => Number(frame.best_effort_timestamp_time)), first = times[0], finalTime = 13.5;
      assert(stream.width === 1280 && stream.height === 720 && times.length > 500 && times.length <= 960 && Math.abs(first - offset) < .001);
      let ordinal = 0; for (let n = 0; n < times.length && times[n] - first <= finalTime + 1e-6; n++) ordinal = n;
      const expectedMarker = Math.round((times[ordinal] - first) * 60), reference = path.join(scratch, name + '-exact.png');
      run(tools.ffmpeg, ['-v', 'error', '-i', file, '-vf', 'select=eq(n\\,' + ordinal + ')', '-frames:v', '1', '-fps_mode', 'passthrough', reference]);
      const timeBase = stream.time_base.split('/').map(Number), indexFrames = probe.frames.map((frame, n) => ({ id: n, time: times[n] - first, ptsTicks: String(frame.best_effort_timestamp), timeBase }));
      const fixture = { name, file, reference, duration: 16, width: 1280, height: 720, fps: 60, frames: times.length, offset: first, finalTime, expectedMarker, finalOrdinal: ordinal, indexFrames,
        sourceSha256: hashFile(file), bytes: fs.statSync(file).size, referenceSha256: hashFile(reference), probeArchive: archive(name + '-all-original-PTS-and-probe', probe) };
      fixtures.push(fixture); const {indexFrames: archivedIndex, ...description}=fixture;record.fixtures.push({ ...description, file: path.relative(scratch, file), reference: path.relative(scratch, reference), mediaIsSynthetic: true,
        identity: 'Ten visible black/white cells encode original CFR ordinal before VFR selection; native mediaTime alone is not image evidence.' }); checkpoint();
    }
    if (group !== 'ui') for (const fixture of fixtures) {
      budget(); safeToClean = false;
      let backend;
      try { backend = await require('../tests/support/responsive-backend.cjs').run({ scratch, source: fixture.file, tools, root, label: fixture.name, onArtifact: archive }); }
      catch (error) { safeToClean = error.safeToClean === true;
        if(error.backendEvidence){const saved=archive(fixture.name+'-failed-formal-backend-original-evidence',error.backendEvidence);record.checks.push({name:fixture.name+'-formal-native-backend-record-frames',status:'failed',safeToClean,evidence:saved});checkpoint();}throw error; }
      safeToClean = backend?.safeToClean === true;
      const backendEvidence = archive(fixture.name + '-formal-native-guard-record-read-thread-results', backend);
      record.checks.push({ name: fixture.name + '-formal-native-backend-record-frames', status: backend?.status, safeToClean, evidence: backendEvidence }); checkpoint();
      assert(backend?.status === 'passed' && safeToClean, 'Formal backend record gate did not pass or lacks safe owned close');
      assert(Array.isArray(backend.runtimeInputs)&&backend.runtimeInputs.length===frozen.length&&backend.runtimeInputs.every(item=>frozen.some(value=>value.file===item.file&&value.sha256===item.sha256)),'Formal backend did not execute the same frozen runtime');
    }
    let browser = null;
    if (!recordFix) {
      budget(); assert(MAX_MS-elapsed()>=30000,'Insufficient registered wall time for the complete Chrome gate and owned close');safeToClean=false;
      browser = await require('../tests/support/responsive-preview-browser.cjs').checkResponsiveBrowser({ pluginRoot, scratch, fixtures, group, timeoutMs: Math.min(90000, MAX_MS - elapsed() - 15000) });
      safeToClean = browser.processStop?.safe === true;
      const original = archive('all-browser-inputs-cursor-and-preview-submissions-results-and-errors', browser);
      record.checks.push({ origin: browser.origin, status: browser.status, browserEvidence: original, cases: browser.browser?.cases, error: browser.error, processStop: browser.processStop, limitations: browser.limitations }); checkpoint();
    }
    for (const item of fixtures) assert.equal(hashFile(item.file), item.sourceSha256, 'Synthetic source changed');
    for (const item of [...frozen.map(value => ({ ...value, source: path.join(root, 'plugin', value.file) })), ...harness.map(value => ({ ...value, source: path.join(root, value.file) }))])
      assert.equal(hashFile(item.source), item.sha256, 'Runtime or measurement harness changed during this invocation');
    record.status = recordFix ? 'passed' : browser.status === 'passed' ? group === 'all' ? 'passed' : 'incomplete' : 'failed';
  } catch (error) { record.status = 'failed'; record.error = String(error.stack || error); }
  finally {
    try {
      assert(safeToClean, 'Preserve scratch while actual Chrome instances lack stop proof');
      const actual = fs.realpathSync(scratch); assert(actual.toLowerCase().startsWith((fs.realpathSync(evidence) + path.sep).toLowerCase()) && path.basename(actual) === 'scratch-' + id);
      const inventory = files(scratch); assert(inventory.reduce((sum, item) => sum + item.bytes, 0) <= MAX_DISK);
      for (const item of inventory) item.sha256 = hashFile(item.file);
      record.cleanup = { completed: false, files: inventory.length, bytes: inventory.reduce((sum, item) => sum + item.bytes, 0),
        identityShaReceipt: archive('all-owned-scratch-identities-and-SHA-before-delete', inventory.map(item => ({ ...item, file: path.relative(scratch, item.file) }))) }; checkpoint();
      for (const item of inventory) { const stat = fs.lstatSync(item.file, { bigint: true }); assert(String(stat.ino) === item.ino && String(stat.dev) === item.dev && Number(stat.size) === item.bytes && hashFile(item.file) === item.sha256); fs.unlinkSync(item.file); }
      function empty(directory) { for (const name of fs.readdirSync(directory)) { const child = path.join(directory, name); assert(fs.lstatSync(child).isDirectory()); empty(child); } fs.rmdirSync(directory); } empty(actual); record.cleanup.completed = true;
    } catch (error) { record.status = 'failed'; record.cleanup.error = String(error.stack || error); }
    record.finished = new Date().toISOString(); record.elapsedMs = elapsed(); if (record.elapsedMs > MAX_MS) { record.status = 'failed'; record.wallBudgetExceeded = true; }
    checkpoint();
  }
  console.log(JSON.stringify({ status: record.status, result: output, group, elapsedMs: record.elapsedMs, cleanup: record.cleanup.completed, checks: record.checks }));
  if (record.status !== 'passed') process.exitCode = 2;
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 2; });
