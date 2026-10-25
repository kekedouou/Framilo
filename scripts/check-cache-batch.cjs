'use strict';

// Explicit E35 metadata-only interruption gate. It is deliberately absent from
// the default test runner: invoking it consumes one registered real-file round.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert'), zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const MIB = 1024 ** 2, MAX_SCRATCH = 64 * MIB, MAX_EVIDENCE = 8 * MIB, MAX_JSON = MIB;
const WALL_MS = 120000, WORK_MS = 108000, MAX_ROUNDS = 4;
const POINTS = Object.freeze([
  ['metadata', 'next-open'], ['metadata', 'next-half-written'], ['metadata', 'next-fsync'],
  ['metadata', 'current-before-rename'], ['metadata', 'current-after-rename'],
  ['outputs', 'partial-first-byte'], ['outputs', 'manifest-after-write'],
  ['outputs', 'owner-next-fsync'], ['outputs', 'owner-after-rename'], ['outputs', 'current-corrupt-with-partial'],
  ['publish', 'published-before-lease'], ['publish', 'lease-written-before-return'], ['publish', 'after-lease-return'],
  ['close', 'before-current-delete'], ['close', 'after-current-delete'], ['close', 'after-writer-delete'],
  ['recovery', 'recovery-after-current-delete'], ['recovery', 'recovery-after-writer-delete']
]);
const COPIES = ['cache.cjs', 'frame-index.cjs', 'process-identity.cjs', 'frame-pack.cjs', 'preview-profile.cjs',
  'native/task-host.cs', 'native/task-host.local.exe', 'native/task-host.local.json'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const errorInfo = error => ({ name: error.name, message: String(error.message), stack: String(error.stack || '').slice(0, 10000) });
const norm = file => path.resolve(file).toLowerCase();
const within = (file, directory) => norm(file) === norm(directory) || norm(file).startsWith(norm(directory) + path.sep);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function identity(stat) { return { dev: String(stat.dev), ino: String(stat.ino), bytes: Number(stat.size), nlink: String(stat.nlink) }; }
function sameIdentity(a, b) { return a.dev === b.dev && a.ino === b.ino && a.bytes === b.bytes && a.nlink === b.nlink; }
function inventory(directory, includeBytes = false) {
  const output = []; if (!fs.existsSync(directory)) return output;
  const real = fs.realpathSync(directory); assert.equal(norm(real), norm(directory), 'Fixture directory must have its exact resolved path');
  function walk(current) {
    const stat = fs.lstatSync(current, { bigint: true }); assert(!stat.isSymbolicLink(), 'Do not traverse fixture links');
    assert(within(fs.realpathSync(current), real), 'Fixture resolved outside its scratch');
    const item = { file: path.relative(directory, current), kind: stat.isDirectory() ? 'directory' : 'file', ...identity(stat) };
    if (stat.isDirectory()) { output.push(item); for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name)); }
    else {
      assert(stat.isFile() && stat.nlink === 1n, 'Fixture leaves must be ordinary single-link files');
      assert(stat.size <= BigInt(MAX_SCRATCH), 'Fixture file exceeds the entire scratch budget');
      const bytes = fs.readFileSync(current); item.sha256 = hash(bytes);
      if (includeBytes) { assert(bytes.length <= 64 * 1024, 'Metadata fixture unexpectedly exceeds 64KiB'); item.base64 = bytes.toString('base64'); }
      output.push(item);
    }
  }
  walk(real); return output;
}
// Activity-only byte accounting is not a frozen inventory or a cleanup
// capability. Another lane may atomically rename a staged file while this
// walk observes it. A real ENOENT contributes no bytes at that observation;
// every other filesystem error still fails. Never read/hash live file bytes.
function liveBudgetScan(directory) {
  const root = path.resolve(directory); let bytes = 0, disappeared = 0;
  function walk(current) {
    let stat;
    try { stat = fs.lstatSync(current, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT' && current !== root) { disappeared++; return; } throw error; }
    assert(within(current, root) && !stat.isSymbolicLink(), 'Live budget scan must stay in ordinary own scratch');
    if (stat.isDirectory()) {
      let names;
      try { names = fs.readdirSync(current); }
      catch (error) { if (error.code === 'ENOENT' && current !== root) { disappeared++; return; } throw error; }
      for (const name of names) walk(path.join(current, name));
    } else {
      assert(stat.isFile() && stat.nlink === 1n, 'Live budget leaves must be ordinary single-link files');
      assert(stat.size <= BigInt(MAX_SCRATCH), 'Live fixture file exceeds the entire scratch budget');
      bytes += Number(stat.size); assert(bytes <= MAX_SCRATCH, 'Scratch budget exceeded');
    }
  }
  walk(root); return { bytes, disappeared };
}
function comparePreserved(before, after) {
  const map = new Map(after.map(item => [item.file, item]));
  for (const old of before) {
    const actual = map.get(old.file); assert(actual, 'Ambiguous prior file disappeared: ' + old.file);
    assert.equal(actual.kind, old.kind); if (old.kind === 'file') assert.equal(actual.sha256, old.sha256, 'Ambiguous bytes changed: ' + old.file);
  }
}
function fixtureManifest(profile, asset, sha, originalSha) {
  const source = { sha256: sha, codec: 'h264', width: 1920, height: 1080, hasAudioStream: false };
  const preview = profile.dimensions(source, '720p');
  return { source, preview, width: preview.width, height: preview.height, duration: 1,
    frames: [{ ...asset, id: 0, ptsTicks: '0', timeBase: [1, 30], time: 0, end: 1 }], audio: null,
    metrics: { sourceSha256: originalSha, segmentStart: 0 } };
}

// The copied native guard is the only launcher of this fixture entry. Its OS
// Job/mutex contract, not a fabricated taskOwner shape, authorizes recovery.
async function workerMain() {
  const root = fs.realpathSync(process.env.EVA_TASK_ROOT || ''), configFile = path.join(root, 'fixture-config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8')), key = hash(root.toLowerCase());
  assert.equal(process.env.EVA_TASK_KEY, key); assert(/^[0-9a-f]{32}$/.test(process.env.EVA_TASK_EPOCH || ''));
  const guardPid = Number(process.env.EVA_TASK_GUARD_PID); assert(Number.isSafeInteger(guardPid) && guardPid > 0);
  assert.equal(process.ppid, guardPid, 'Fixture must be the real guard child');
  for (const item of config.sources) assert.equal(hash(fs.readFileSync(path.join(root, item.copy))), item.sha256, 'Runtime copy changed');
  const nativeBuild = JSON.parse(fs.readFileSync(path.join(root, 'native/task-host.local.json'), 'utf8'));
  assert.equal(nativeBuild.schema, 'eva-task-guard-build-v1');
  assert.equal(hash(fs.readFileSync(path.join(root, 'native/task-host.local.exe'))), nativeBuild.executableSha256);
  assert.equal(hash(fs.readFileSync(path.join(root, 'native/task-host.cs'))), nativeBuild.sourceSha256);
  const taskOwner = Object.freeze({ schema: 'eva-task-owner-v1', key, epoch: process.env.EVA_TASK_EPOCH, guardPid });
  const processModule = require(path.join(root, 'process-identity.cjs')), base = processModule.createIdentity();
  const self = base.self(); assert(self, 'Actual worker process birth/image unavailable; no writer created');
  const identityProvider = { self: () => self, child: () => null, claimEmptyWriter: base.claimEmptyWriter,
    inspect(record) {
      if (record && record.taskOwner && record.taskOwner.schema === taskOwner.schema && record.taskOwner.key === key &&
          /^[0-9a-f]{32}$/.test(record.taskOwner.epoch || '') && record.taskOwner.epoch !== taskOwner.epoch)
        return { safe: true, reason: 'exclusive-guard-confirmed-previous-owned-job-empty' };
      return base.inspect(record);
    } };
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  send({ type: 'fixture-ready', action: config.action, processIdentity: self, taskOwner });
  const raw = Object.fromEntries(['openSync', 'closeSync', 'writeSync', 'writeFileSync', 'fsyncSync', 'renameSync', 'unlinkSync'].map(name => [name, fs[name].bind(fs)]));
  const descriptors = new Map(), cacheRoot = path.join(root, 'cache'), interruptionPoint = config.interruptionPoint || config.point;
  let armed = config.action === 'recover-interrupt', triggered = false;
  function park(point, details = {}) {
    if (!armed || triggered || interruptionPoint !== point) return;
    triggered = true;
    const stage = { point, at: new Date().toISOString(), processIdentity: self, taskOwner, details };
    const stageName = config.stageFile || 'stage-reached.json'; assert(/^stage-[a-z-]+\.json$/.test(stageName));
    const bytes = Buffer.from(JSON.stringify(stage)), file = path.join(root, stageName), next = file + '.next', fd = raw.openSync(next, 'wx');
    try { raw.writeSync(fd, bytes, 0, bytes.length, 0); raw.fsyncSync(fd); } finally { raw.closeSync(fd); }
    raw.renameSync(next, file);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    throw new Error('Interrupted fixture unexpectedly resumed');
  }
  const isNext = file => within(file, cacheRoot) && /^writer-current-[0-9a-f]{24}\.next\.json$/.test(path.basename(file));
  const isCurrent = file => within(file, cacheRoot) && /^writer-current-[0-9a-f]{24}\.json$/.test(path.basename(file));
  if (['fault', 'recover-interrupt'].includes(config.action)) {
    fs.openSync = function(file, ...args) {
      const fd = raw.openSync(file, ...args); descriptors.set(fd, path.resolve(file));
      if (isNext(file)) park('next-open', { file: path.relative(cacheRoot, file), bytesWritten: 0 }); return fd;
    };
    fs.closeSync = function(fd) { const result = raw.closeSync(fd); descriptors.delete(fd); return result; };
    fs.writeSync = function(fd, buffer, offset, length, position) {
      const file = descriptors.get(fd);
      if (armed && file && isNext(file) && interruptionPoint === 'next-half-written') {
        const count = raw.writeSync(fd, buffer, offset, Math.max(1, Math.min(length - 1, Math.floor(length / 2))), position);
        park('next-half-written', { file: path.relative(cacheRoot, file), bytesWritten: count, plannedBytes: length }); return count;
      }
      if (armed && file && /^partial-[0-9a-f]{24}$/.test(path.basename(path.dirname(file))) && path.basename(file) === '000000.jpg' && interruptionPoint === 'partial-first-byte') {
        const count = raw.writeSync(fd, buffer, offset, 1, position); park('partial-first-byte', { bytesWritten: count }); return count;
      }
      const result = raw.writeSync(fd, buffer, offset, length, position);
      if (file && path.basename(file) === 'manifest.json') park('manifest-after-write', { file: path.relative(cacheRoot, file), bytesWritten: result, powerLossDurabilityProven: false });
      return result;
    };
    fs.fsyncSync = function(fd) {
      const result = raw.fsyncSync(fd), file = descriptors.get(fd);
      if (file && isNext(file)) park('next-fsync', { file: path.relative(cacheRoot, file) });
      if (file && /^owner\.next-[0-9a-f]{24}\.json$/.test(path.basename(file))) park('owner-next-fsync', { file: path.relative(cacheRoot, file) });
      if (file && within(file, cacheRoot) && /^lease-[0-9a-f]{24}\.json$/.test(path.basename(file)))
        park('lease-written-before-return', { file: path.basename(file), fsyncCompleted: true, powerLossDurabilityProven: false });
      return result;
    };
    fs.renameSync = function(from, to) {
      if (isNext(from) && isCurrent(to)) park('current-before-rename', { from: path.basename(from), to: path.basename(to) });
      const result = raw.renameSync(from, to);
      if (isNext(from) && isCurrent(to)) park('current-after-rename', { to: path.basename(to) });
      if (/^owner\.next-[0-9a-f]{24}\.json$/.test(path.basename(from)) && path.basename(to) === 'owner.json') park('owner-after-rename', { to: path.relative(cacheRoot, to) });
      if (within(from, cacheRoot) && /^partial-[0-9a-f]{24}$/.test(path.basename(from))) park('published-before-lease', { from: path.basename(from), to: path.basename(to) });
      return result;
    };
    fs.writeFileSync = function(file, bytes, ...args) {
      const result = raw.writeFileSync(file, bytes, ...args);
      if (within(file, cacheRoot) && /^lease-[0-9a-f]{24}\.json$/.test(path.basename(file)))
        park('lease-written-before-return', { file: path.basename(file), powerLossDurabilityProven: false });
      return result;
    };
    fs.unlinkSync = function(file) {
      if (isCurrent(file)) park('before-current-delete', { file: path.basename(file) });
      const result = raw.unlinkSync(file);
      if (isCurrent(file)) park('after-current-delete', { file: path.basename(file) });
      if (isCurrent(file)) park('recovery-after-current-delete', { file: path.basename(file) });
      if (norm(file) === norm(path.join(cacheRoot, 'writer.lock'))) {
        park('after-writer-delete'); park('recovery-after-writer-delete');
      }
      return result;
    };
  }
  const cache = require(path.join(root, 'cache.cjs')).createCache({ pluginRoot: root, diskBytes: 2 * MIB, processIdentity: identityProvider, taskOwner });
  const originalSha = hash('E35 synthetic original identity; no real source file'), seed = hash('E35 seed segment'), target = hash('E35 interrupted target');
  const profile = require(path.join(root, 'preview-profile.cjs'));
  const makeSource = sha => ({ sha256: sha, codec: 'h264', width: 1920, height: 1080, hasAudioStream: false });
  if (['recover', 'recover-interrupt'].includes(config.action)) {
    if (config.point === 'current-corrupt-with-partial') {
      let error; try { await cache.openBatch({ sourceSha256: originalSha, previewQuality: '720p' }); } catch (caught) { error = caught; }
      assert(error, 'Corrupt current with an existing partial must reject recovery');
      send({ type: 'fixture-result', status: 'preserved-expected', error: errorInfo(error), taskOwner, processIdentity: self }); return;
    }
    const batch = await cache.openBatch({ sourceSha256: originalSha, previewQuality: '720p' });
    assert.notEqual(config.action, 'recover-interrupt', 'Requested recovery interruption point was not reached');
    const tx = batch.beginSegment({ sourceSha256: seed, previewQuality: '720p' }), existing = await tx.readComplete();
    assert(existing, 'Earlier committed segment must survive every interruption boundary');
    const info = await tx.finish(existing, makeSource(seed)); await tx.close();
    assert.equal((await cache.readAsset(info, info.frames[0].file)).toString(), 'E35 seed bytes');
    await cache.release(info); await batch.close(); const contents = inventory(cacheRoot);
    assert(!contents.some(item => /^(?:writer\.lock|writer-current-|lease-|partial-)/.test(item.file)), 'Recovered writer, output and lease ownership must close');
    assert(!contents.some(item => /^owner\.next/.test(path.basename(item.file))), 'Recovery must finish exact recency output');
    const snapshot = cache.inventory();
    send({ type: 'fixture-result', status: 'recovered', taskOwner, processIdentity: self, inventory: snapshot }); return;
  }
  assert.equal(config.action, 'fault');
  const batch = await cache.openBatch({ sourceSha256: originalSha, previewQuality: '720p' });
  const first = batch.beginSegment({ sourceSha256: seed, previewQuality: '720p' });
  const seedAsset = await first.writeAsset('000000.jpg', Buffer.from('E35 seed bytes'));
  const seedInfo = await first.finish(fixtureManifest(profile, seedAsset, seed, originalSha), makeSource(seed));
  await first.close(); await cache.release(seedInfo); armed = true;
  const reuse = ['owner-next-fsync', 'owner-after-rename'].includes(config.point), sha = reuse ? seed : target;
  const tx = batch.beginSegment({ sourceSha256: sha, previewQuality: '720p' });
  let manifest;
  if (reuse) { manifest = await tx.readComplete(); assert(manifest); }
  else {
    const asset = await tx.writeAsset('000000.jpg', Buffer.from('E35 new target bytes'));
    manifest = fixtureManifest(profile, asset, target, originalSha);
    if (config.point === 'current-corrupt-with-partial') {
      const file = fs.readdirSync(cacheRoot).find(name => /^writer-current-[0-9a-f]{24}\.json$/.test(name)); assert(file);
      raw.writeFileSync(path.join(cacheRoot, file), Buffer.from('{deliberately-corrupt-fixture-current'));
      park('current-corrupt-with-partial', { deliberatelyDamagedOwnFixture: true });
    }
  }
  const info = await tx.finish(manifest, makeSource(sha)); park('after-lease-return', { leaseId: info.leaseId });
  await tx.close(); await cache.release(info); await batch.close(); throw new Error('Requested interruption point was not reached: ' + config.point);
}

async function main() {
  const started = Date.now(), root = path.resolve(__dirname, '..'), args = process.argv.slice(2);
  assert(args.every(value => value === '--node16-recheck' || /^--group=(?:metadata|outputs|publish|close|recovery)$/.test(value)), 'Only --node16-recheck or optional --group=metadata|outputs|publish|close|recovery is supported');
  assert(new Set(args).size === args.length && args.filter(value => value.startsWith('--group=')).length <= 1 && args.length <= 2);
  assert.equal(process.platform, 'win32', 'This explicit gate requires the existing Windows native Job guard');
  const node16Recheck = args.includes('--node16-recheck'), groupArg = args.find(value => value.startsWith('--group=')), group = groupArg && groupArg.slice('--group='.length);
  assert(!node16Recheck || !group, 'The single Node16 supplement must run the complete matrix');
  const selected = POINTS.filter(value => !group || value[0] === group), maxRounds = node16Recheck ? 1 : MAX_ROUNDS;
  const expectedCacheSha256 = 'aa8ad2ea3658063d9e82ed9e050148d1ce66a125ed8840a86f34191e92d91f5d';
  const plan = fs.readFileSync(path.join(root, 'docs/experiments/E35/plan.md'), 'utf8');
  assert(plan.includes('verification-runs/e35-cache') && plan.includes('64MiB') && plan.includes('两分钟'), 'E35 real-file budget must be registered before this explicit invocation');
  let supplement = null;
  if (node16Recheck) {
    assert.equal(Number(process.versions.node.split('.')[0]), 16, '--node16-recheck requires the actual Node16 runtime');
    assert(plan.includes('verification-runs/e35-cache-node16'), 'Register the separate single Node16 supplement before starting it');
    const priorRoot = path.join(root, 'verification-runs/e35-cache'), names = fs.readdirSync(priorRoot).filter(name => /^batch-[0-9a-f]{16}\.json$/.test(name)).sort();
    assert.equal(names.length, MAX_ROUNDS, 'Keep all four original invocations sealed; do not reset their budget');
    const prior = names.map(name => {
      const file = path.join(priorRoot, name), stat = fs.lstatSync(file); assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_JSON);
      const bytes = fs.readFileSync(file), value = JSON.parse(bytes);
      assert(['passed', 'failed', 'incomplete'].includes(value.status) && value.finished, 'All prior invocations must have a final preserved record');
      return { name, sha256: hash(bytes), value };
    });
    assert(prior.some(item => item.value.status === 'failed' && item.value.sources?.some(source => source.copy === 'cache.cjs' && source.sha256 === expectedCacheSha256) &&
      item.value.cases?.some(value => value.status === 'failed' && /ENOENT/.test(value.error?.message || '') &&
        /stage-reached\.json\.next/.test(value.error?.message || '') && /checkBudget/.test(value.error?.stack || ''))),
    'The Node16 supplement must reference the preserved live-budget ENOENT failure on the same cache runtime');
    supplement = { kind: 'node16-live-budget-harness-recheck', priorDirectory: priorRoot,
      priorRecords: prior.map(item => ({ file: item.name, sha256: item.sha256, status: item.value.status })), expectedCacheSha256 };
  }
  const evidence = path.join(root, 'verification-runs', node16Recheck ? 'e35-cache-node16' : 'e35-cache'); fs.mkdirSync(evidence, { recursive: true });
  const evidenceBytes = () => fs.readdirSync(evidence).reduce((sum, name) => { const stat = fs.lstatSync(path.join(evidence, name)); return sum + (stat.isFile() ? stat.size : 0); }, 0);
  assert(fs.readdirSync(evidence).filter(name => /^batch-[0-9a-f]{16}\.json$/.test(name)).length < maxRounds, 'Registered E35 interruption invocation budget is already reserved');
  assert(evidenceBytes() <= MAX_EVIDENCE - 2 * MIB, 'Reserve two MiB of evidence before starting any fixture');
  const frozen = COPIES.map(copy => { const source = path.join(root, 'plugin', copy), bytes = fs.readFileSync(source); return { copy, source, bytes, sha256: hash(bytes) }; });
  if (node16Recheck) assert.equal(frozen.find(item => item.copy === 'cache.cjs').sha256, expectedCacheSha256, 'The Node16 supplement cannot silently change the cache runtime');
  const build = JSON.parse(frozen.find(item => item.copy === 'native/task-host.local.json').bytes);
  assert.equal(build.schema, 'eva-task-guard-build-v1'); assert.equal(build.bytes, frozen.find(item => item.copy.endsWith('.exe')).bytes.length);
  assert(build.bytes <= 256 * 1024); assert.equal(build.executableSha256, frozen.find(item => item.copy.endsWith('.exe')).sha256);
  assert.equal(build.sourceSha256, frozen.find(item => item.copy.endsWith('.cs')).sha256);
  const entryBytes = Buffer.from("'use strict';require('./fixture-runner.cjs').workerMain().then(()=>process.stdout.write('',()=>process.exit(0))).catch(error=>{process.stderr.write(String(error.stack));process.exitCode=2;});\n");
  const scriptBytes = fs.readFileSync(__filename), sources = [...frozen.map(({ copy, source, sha256, bytes }) => ({ copy, source, sha256, bytes: bytes.length })),
    { copy: 'fixture-runner.cjs', source: __filename, sha256: hash(scriptBytes), bytes: scriptBytes.length }];
  const id = crypto.randomBytes(8).toString('hex'), output = path.join(evidence, 'batch-' + id + '.json'), scratch = path.join(evidence, 'scratch-' + id);
  const record = { schema: 'eva-e35-cache-interruption-v1', id, status: 'running', started: new Date(started).toISOString(),
    scope: 'Real native Windows guard/OS Job and ordinary Node, synthetic metadata only; process termination is not a power-loss or Eagle GUI test.',
    limits: { invocations: maxRounds, scratchBytes: MAX_SCRATCH, evidenceBytes: MAX_EVIDENCE, wallMs: WALL_MS, concurrentMetadataJobs: 2, mediaProcesses: 0 },
    runtime: { executable: process.execPath, node: process.versions.node }, supplement,
    diagnosticGroup: group || null, expectedPoints: POINTS.map(value => value[1]), selectedPoints: selected.map(value => value[1]),
    sources, sourceSetSha256: hash(JSON.stringify(sources)), fixtureEntrySha256: hash(entryBytes), nativeBuild: build, cases: [], artifacts: [], cleanup: { completed: false } };
  let outputStamp, artifactSerial = 0; const active = new Set(), processModule = require('../plugin/process-identity.cjs');
  function checkpoint(initial = false) {
    const bytes = Buffer.from(JSON.stringify(record, null, 2)); assert(bytes.length <= MAX_JSON, 'Bounded result record overflow; prior checkpoint retained');
    assert(evidenceBytes() - (fs.existsSync(output) ? fs.statSync(output).size : 0) + bytes.length <= MAX_EVIDENCE, 'Evidence limit reached; do not discard prior records');
    if (initial) { const fd = fs.openSync(output, 'wx'); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    else {
      assert(sameIdentity(outputStamp, identity(fs.lstatSync(output, { bigint: true }))), 'Result identity changed externally');
      const next = output + '.next'; const fd = fs.openSync(next, 'wx'); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(next, output);
    }
    outputStamp = identity(fs.lstatSync(output, { bigint: true }));
  }
  function archive(label, value) {
    const bytes = Buffer.from(JSON.stringify(value)), packed = zlib.gzipSync(bytes), name = 'raw-' + id + '-' + String(++artifactSerial).padStart(3, '0') + '.json.gz';
    assert(packed.length <= MAX_JSON && evidenceBytes() + packed.length + MAX_JSON <= MAX_EVIDENCE, 'Archive budget reached; prior failure checkpoint retained');
    const file = path.join(evidence, name), fd = fs.openSync(file, 'wx'); try { fs.writeFileSync(fd, packed); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const receipt = { label, file: name, encoding: 'gzip-utf8-json', bytes: bytes.length, sha256: hash(bytes), gzipBytes: packed.length, gzipSha256: hash(packed) };
    record.artifacts.push(receipt); return receipt;
  }
  // Atomic, durable invocation reservation precedes all scratch/process writes.
  checkpoint(true); fs.mkdirSync(scratch);
  record.frozenSourcesArchive = archive('frozen-source-bytes', [
    ...frozen.map(item=>({copy:item.copy,sha256:item.sha256,bytes:item.bytes.length,base64:item.bytes.toString('base64')})),
    {copy:'fixture-runner.cjs',sha256:hash(scriptBytes),bytes:scriptBytes.length,base64:scriptBytes.toString('base64')},
    {copy:'task-worker.cjs',sha256:hash(entryBytes),bytes:entryBytes.length,base64:entryBytes.toString('base64')}
  ]); checkpoint();
  let stopRequested = false, unsafeCleanup = false;
  const watchdog = setTimeout(() => { stopRequested = true; for (const host of active) if (!host.closed) host.child.kill(); }, WALL_MS - 8000);
  function remaining() { return WORK_MS - (Date.now() - started); }
  function checkBudget() {
    assert(!stopRequested && remaining() > 0, 'Work deadline reached; unfinished matrix is incomplete');
    const observed = liveBudgetScan(scratch); assert(observed.bytes <= MAX_SCRATCH, 'Scratch budget exceeded');
    record.liveBudgetScans ||= { passes: 0, disappearedEntries: 0, scope: 'Read-only non-atomic readdir/lstat byte observations; not identity/hash verification or deletion authority.' };
    record.liveBudgetScans.passes++; record.liveBudgetScans.disappearedEntries += observed.disappeared;
    record.peakScratchBytes = Math.max(record.peakScratchBytes || 0, observed.bytes);
  }
  function launch(caseRoot, details, action) {
    const child = spawn(path.join(caseRoot, 'native/task-host.local.exe'), [caseRoot, process.execPath, hash(caseRoot.toLowerCase())],
      { detached: true, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const host = { child, closed: false, events: [], stderr: '', error: null, action, pid: child.pid };
    active.add(host); details.launches.push({ action, pid: child.pid, at: new Date().toISOString() });
    let pending = '', bytes = 0;
    child.stdout.setEncoding('utf8'); child.stdout.on('data', text => {
      bytes += Buffer.byteLength(text); if (bytes > 128 * 1024) { host.error = new Error('Fixture stdout exceeded 128KiB'); child.kill(); return; }
      pending += text; let at;
      while ((at = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, at).trim(); pending = pending.slice(at + 1);
        if (line) { try { host.events.push({ elapsedMs: Date.now() - started, value: JSON.parse(line) }); } catch (_) { host.error = new Error('Non-JSON native fixture output: ' + line); child.kill(); } }
      }
    });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', text => { host.stderr += text; if (Buffer.byteLength(host.stderr) > 32768) { host.error = new Error('Fixture stderr exceeded 32KiB'); child.kill(); } });
    child.on('error', error => { host.error = error; });
    host.exit = new Promise(resolve => child.on('close', (code, signal) => { host.closed = true; host.code = code; host.signal = signal; active.delete(host); resolve(); }));
    return host;
  }
  async function waitFor(host, condition, maxMs = 25000) {
    const until = Math.min(Date.now() + maxMs, started + WORK_MS);
    while (!condition()) {
      if (host.error) throw host.error;
      assert(!host.closed, 'Native fixture exited before expected phase: ' + host.code + ' ' + host.stderr);
      assert(!stopRequested && Date.now() < until, 'Fixture phase timed out; incomplete matrix'); await pause(15);
    }
  }
  async function stopHost(host, verify = true) {
    if (!host.closed) { host.child.kill(); await Promise.race([host.exit, pause(3000)]); }
    assert(host.closed, 'Owned native guard did not exit; preserve scratch');
    if (!verify || host.stopConfirmed) return;
    if (host.events.some(item => item.value.type === 'guard' && item.value.event === 'finished')) {
      // This native event follows worker exit and Active(Job)<=1, before the
      // guard releases its handle. The owned ChildProcess has now exited too.
      host.stopConfirmed = true; host.stopProof = { safe: true, reason: 'native-guard-drained-owned-job-and-exited' }; return;
    }
    const ready = host.events.find(item => item.value.type === 'fixture-ready')?.value;
    assert(ready && processModule._test.valid(ready.processIdentity), 'Missing worker birth evidence after abnormal guard exit; preserve scratch');
    host.stopProof = processModule._test.proveGone({ processIdentity: ready.processIdentity, children: [] }, processModule._test.snapshot());
    assert(host.stopProof.safe, 'A recorded fixture worker may still survive; preserve scratch'); host.stopConfirmed = true;
  }
  async function interruptAt(host, caseRoot, stageFile, expectedPoint, trace) {
    await waitFor(host, () => fs.existsSync(stageFile)); const stage = JSON.parse(fs.readFileSync(stageFile, 'utf8'));
    assert.equal(stage.point, expectedPoint); assert.equal(stage.taskOwner.guardPid, host.pid);
    assert.equal(stage.taskOwner.key, hash(caseRoot.toLowerCase())); assert(/^[0-9a-f]{32}$/.test(stage.taskOwner.epoch));
    trace.stage = stage;
    const beforeRows = processModule._test.snapshot(), workerRow = beforeRows.find(value => value.pid === stage.processIdentity.pid), guardRow = beforeRows.find(value => value.pid === host.pid);
    assert(processModule._test.same(stage.processIdentity, workerRow), 'Actual parked worker birth/image must match the stage');
    assert(guardRow && processModule._test.valid(guardRow) && norm(guardRow.image) === norm(path.join(caseRoot, 'native/task-host.local.exe')), 'Exact native guard identity must be observed');
    assert.equal(workerRow.parentPid, guardRow.pid); trace.observedGuard = guardRow;
    const cacheRoot = path.join(caseRoot, 'cache'); trace.before = inventory(cacheRoot, true); checkBudget();
    trace.killRequested = new Date().toISOString(); await stopHost(host, false); trace.guardExit = { code: host.code, signal: host.signal, at: new Date().toISOString() };
    // Actual read-only Windows snapshots complement the fresh guard's OS Job
    // exclusion. Never substitute a fixture PID shape or an unconditional safe.
    const proofStarted = Date.now(), proofUntil = Math.min(proofStarted + 3000, started + WORK_MS);
    trace.stopProofAttempts = []; let proofAccepted = false;
    // The shared snapshot has a fixed five-second timeout. Use the exact same
    // real CIM fields and completeness checks here, with a timeout bounded by
    // this three-second stop-proof window. Machine-wide rows remain ephemeral.
    const query = '$ErrorActionPreference="Stop"; [Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $rows=@(Get-CimInstance Win32_Process | ForEach-Object { '
      + '[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;'
      + 'startTicks=$(if($_.CreationDate){[string]$_.CreationDate.ToUniversalTime().Ticks}else{$null});image=$_.ExecutablePath} }); '
      + 'ConvertTo-Json -InputObject $rows -Compress';
    while (Date.now() < proofUntil && !stopRequested) {
      const attemptStarted = Date.now();
      let workerGone, guardGone;
      try {
        const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query],
          { windowsHide: true, shell: false, encoding: 'utf8', maxBuffer: 2 * MIB, timeout: Math.max(1, proofUntil - Date.now()) });
        assert(!result.error && result.status === 0, 'Complete bounded process query unavailable');
        const rows = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
        assert(Array.isArray(rows) && rows.length <= 16384 && new Set(rows.map(row => row.pid)).size === rows.length &&
          rows.every(row => Number.isSafeInteger(row.pid) && row.pid >= 0 && Number.isSafeInteger(row.parentPid) && row.parentPid >= 0), 'Incomplete process snapshot');
        workerGone = processModule._test.proveGone({ processIdentity: stage.processIdentity, children: [] }, rows);
        guardGone = processModule._test.proveGone({ processIdentity: guardRow, children: [] }, rows);
      } catch (_) {
        workerGone = { safe: false, reason: 'process-query-failed' }; guardGone = { safe: false, reason: 'process-query-failed' };
      }
      trace.stopProofAttempts.push({ at: new Date().toISOString(), elapsedMs: Date.now() - proofStarted,
        queryMs: Date.now() - attemptStarted, workerGone, guardGone });
      trace.workerGone = workerGone; trace.guardGone = guardGone;
      if (workerGone.safe && guardGone.safe && Date.now() <= proofUntil) { proofAccepted = true; break; }
      if (proofUntil - Date.now() < 100) break;
      await pause(100);
    }
    if (!proofAccepted) unsafeCleanup = true;
    assert(proofAccepted,
      'Do not recover until both exact process instances and observed descendants are proved gone within the bounded window');
    host.stopConfirmed = true; trace.postStop = inventory(cacheRoot, true); checkBudget();
    return stage;
  }
  async function runCase(groupName, point, ordinal) {
    const details = { group: groupName, point, ordinal, started: new Date().toISOString(), launches: [], status: 'running' };
    const entry = { group: groupName, point, ordinal, status: 'running' }; record.cases.push(entry); checkpoint();
    const caseRoot = path.join(scratch, String(ordinal).padStart(2, '0') + '-' + point); let faultHost, interruptedRecoveryHost, recoverHost;
    try {
      checkBudget(); fs.mkdirSync(caseRoot);
      for (const file of frozen) { const to = path.join(caseRoot, file.copy); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, file.bytes, { flag: 'wx' }); }
      fs.writeFileSync(path.join(caseRoot, 'fixture-runner.cjs'), scriptBytes, { flag: 'wx' });
      fs.writeFileSync(path.join(caseRoot, 'task-worker.cjs'), entryBytes, { flag: 'wx' });
      const repeatRecovery = point.startsWith('recovery-');
      const configFile = path.join(caseRoot, 'fixture-config.json'), config = { action: 'fault', point,
        ...(repeatRecovery ? { interruptionPoint: 'partial-first-byte' } : {}),
        sources: [...sources.map(({ copy, sha256 }) => ({ copy, sha256 })), { copy: 'task-worker.cjs', sha256: hash(entryBytes) }] };
      fs.writeFileSync(configFile, JSON.stringify(config), { flag: 'wx' }); checkBudget();
      const stageFile = path.join(caseRoot, 'stage-reached.json'); faultHost = launch(caseRoot, details, 'fault');
      const stage = await interruptAt(faultHost, caseRoot, stageFile, config.interruptionPoint || point, details);
      const cacheRoot = path.join(caseRoot, 'cache');
      if (repeatRecovery) {
        const recoveryConfig = { ...config, action: 'recover-interrupt', interruptionPoint: point, stageFile: 'stage-recovery.json' };
        fs.writeFileSync(configFile, JSON.stringify(recoveryConfig)); interruptedRecoveryHost = launch(caseRoot, details, 'recover-interrupt');
        details.recoveryInterruption = {};
        const recoveryStage = await interruptAt(interruptedRecoveryHost, caseRoot, path.join(caseRoot, recoveryConfig.stageFile), point, details.recoveryInterruption);
        assert.notEqual(recoveryStage.taskOwner.epoch, stage.taskOwner.epoch);
        const files = details.recoveryInterruption.postStop;
        assert(files.some(item => item.kind === 'directory' && /^partial-[0-9a-f]{24}$/.test(item.file)), 'Recovery must actually be interrupted before partial cleanup');
        assert(!files.some(item => /^writer-current-[0-9a-f]{24}\.json$/.test(item.file)), 'This case requires current to have already been removed');
        assert.equal(files.some(item => item.file === 'writer.lock'), point === 'recovery-after-current-delete', 'Writer presence must distinguish the two recovery boundaries');
        const originals = new Map(details.postStop.filter(item => item.kind === 'file').map(item => [item.file, item]));
        const pending = files.filter(item => /^reap-[0-9a-f]{24}\.json$/.test(item.file) && !files.some(value => value.file === item.file.replace(/\.json$/, '.result.json')));
        assert(pending.length > 0, 'Recovery must retain an unfinished, durable reap plan');
        details.pendingReapProof = pending.map(item => {
          const bytes = Buffer.from(item.base64, 'base64'), plan = JSON.parse(bytes), current = plan.records.find(value => /^writer-current-[0-9a-f]{24}\.json$/.test(value.file.file));
          assert(current && typeof current.ownerRecord.currentBytes === 'string', 'Pending reap must retain the exact validated current bytes');
          const original = originals.get(current.file.file), retained = Buffer.from(current.ownerRecord.currentBytes, 'base64');
          assert(original && retained.equals(Buffer.from(original.base64, 'base64')) && hash(retained) === current.file.sha256, 'Do not infer a missing current target from an unrelated key');
          return { file: item.file, sha256: hash(bytes), currentFile: current.file.file, currentSha256: hash(retained) };
        });
        checkpoint();
      }
      fs.writeFileSync(configFile, JSON.stringify({ ...config, action: 'recover', interruptionPoint: null }));
      recoverHost = launch(caseRoot, details, 'recover');
      await waitFor(recoverHost, () => recoverHost.closed); await recoverHost.exit;
      if (recoverHost.error) throw recoverHost.error;
      assert.equal(recoverHost.code, 0, 'Recovery fixture failed: ' + recoverHost.stderr);
      const ready = recoverHost.events.find(item => item.value.type === 'fixture-ready')?.value;
      const result = recoverHost.events.find(item => item.value.type === 'fixture-result')?.value;
      assert(ready && result && recoverHost.events.some(item => item.value.type === 'guard' && item.value.event === 'finished' && item.value.exitCode === 0), 'Real guard must drain and finish recovery');
      assert.equal(ready.taskOwner.guardPid, recoverHost.pid); assert.equal(ready.taskOwner.key, stage.taskOwner.key); assert.notEqual(ready.taskOwner.epoch, stage.taskOwner.epoch);
      if (details.recoveryInterruption) assert.notEqual(ready.taskOwner.epoch, details.recoveryInterruption.stage.taskOwner.epoch, 'Final restart must be a third native guard epoch');
      details.recovery = result; details.after = inventory(cacheRoot, true);
      if (point === 'current-corrupt-with-partial') { assert.equal(result.status, 'preserved-expected'); comparePreserved(details.postStop, details.after); }
      else assert.equal(result.status, 'recovered');
      for (const proof of details.pendingReapProof || []) {
        const receipt = details.after.find(item => item.file === proof.file.replace(/\.json$/, '.result.json'));
        assert(receipt, 'Resumed recovery must leave its completed reap receipt');
        const value = JSON.parse(Buffer.from(receipt.base64, 'base64'));
        assert.equal(value.status, 'completed'); assert.equal(value.planSha256, proof.sha256, 'Completed recovery must bind the preserved pending plan');
      }
      checkBudget(); details.status = 'passed';
    } catch (error) { details.status = /deadline|timed out/i.test(error.message) ? 'incomplete' : 'failed'; details.error = errorInfo(error); }
    finally {
      for (const host of [faultHost, interruptedRecoveryHost, recoverHost].filter(Boolean)) {
        try { await stopHost(host); } catch (error) { unsafeCleanup = true; details.status = 'failed'; details.stopError = errorInfo(error); }
        details[host.action + 'Process'] = { pid: host.pid, closed: host.closed, code: host.code, signal: host.signal, stopConfirmed: !!host.stopConfirmed,
          stopProof: host.stopProof, events: host.events, stderr: host.stderr, ...(host.error ? { error: errorInfo(host.error) } : {}) };
      }
      details.elapsedMs = Date.now() - Date.parse(details.started); entry.status = details.status; entry.elapsedMs = details.elapsedMs;
      if (details.error) entry.error = details.error;
      // Persist complete input/outcome bytes before compression, so an archive
      // failure cannot erase this case's original failure or process evidence.
      entry.details = details; checkpoint(); entry.evidence = archive(point, details); delete entry.details; checkpoint();
    }
  }
  try {
    let cursor = 0;
    async function lane() {
      while (cursor < selected.length && remaining() > 10000 && !stopRequested) {
        const ordinal = cursor++, [groupName, point] = selected[ordinal]; await runCase(groupName, point, ordinal);
      }
    }
    const lanes = await Promise.allSettled([lane(), lane()]);
    const broken = lanes.find(item => item.status === 'rejected'); if (broken) throw broken.reason;
    for (let n = 0; n < selected.length; n++) if (!record.cases.some(item => item.ordinal === n)) record.cases.push({ group: selected[n][0], point: selected[n][1], ordinal: n, status: 'incomplete', reason: 'No remaining registered wall budget' });
    record.finalSourceHashes = sources.map(item => ({ source: item.source, sha256: hash(fs.readFileSync(item.source)) }));
    assert(record.finalSourceHashes.every((item, n) => item.sha256 === sources[n].sha256), 'Sources changed during the matrix; do not claim a single final-runtime gate');
    record.status = record.cases.some(item => item.status === 'failed') ? 'failed' : group || record.cases.some(item => item.status !== 'passed') ? 'incomplete' : 'passed';
  } catch (error) { record.status = 'failed'; record.error = errorInfo(error); }
  finally {
    clearTimeout(watchdog);
    for (const host of [...active]) { try { await stopHost(host); } catch (error) { unsafeCleanup = true; record.status = 'failed'; record.stopError = errorInfo(error); } }
    // Keep the final checkpoint writable even when stop proof failed before
    // the normal cleanup receipt was constructed.
    record.cleanup ||= { completed: false, status: 'not-started' };
    try {
      assert(!unsafeCleanup && active.size === 0, 'Do not clean scratch without confirmed owned-job/process stop evidence');
      const leaves = inventory(scratch), bytes = leaves.reduce((sum, item) => sum + (item.kind === 'file' ? item.bytes : 0), 0);
      assert(bytes <= MAX_SCRATCH, 'Final scratch exceeds its registered budget');
      record.peakScratchBytes = Math.max(record.peakScratchBytes || 0, bytes);
      record.cleanup = { completed: false, status: 'identity-and-hash-verified-before-delete', files: leaves.filter(item => item.kind === 'file').length, bytes, receipt: archive('cleanup-before-delete', leaves) }; checkpoint();
      for (const item of leaves.filter(value => value.kind === 'file')) {
        const file = path.join(scratch, item.file), actual = fs.lstatSync(file, { bigint: true });
        assert(within(fs.realpathSync(file), scratch) && sameIdentity(item, identity(actual)) && hash(fs.readFileSync(file)) === item.sha256, 'Cleanup leaf identity/content changed'); fs.unlinkSync(file);
      }
      for (const item of leaves.filter(value => value.kind === 'directory').sort((a, b) => b.file.length - a.file.length)) {
        const directory = path.join(scratch, item.file), actual = identity(fs.lstatSync(directory, { bigint: true }));
        assert(actual.dev === item.dev && actual.ino === item.ino && fs.readdirSync(directory).length === 0, 'Cleanup directory identity/contents changed'); fs.rmdirSync(directory);
      }
      record.cleanup.completed = true; record.cleanup.status = 'deleted-only-verified-own-scratch';
    } catch (error) { record.cleanup ||= { completed: false }; record.cleanup.error = errorInfo(error); record.status = 'failed'; }
    record.finished = new Date().toISOString(); record.elapsedMs = Date.now() - started;
    if (record.elapsedMs > WALL_MS) { record.status = 'incomplete'; record.wallBudgetExceeded = true; }
    checkpoint();
  }
  console.log(JSON.stringify({ status: record.status, passed: record.cases.filter(item => item.status === 'passed').length,
    total: POINTS.length, elapsedMs: record.elapsedMs, evidence: output, cleanup: record.cleanup.completed }));
  if (record.status !== 'passed') process.exitCode = 2;
}
module.exports = { workerMain };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 2; });
