'use strict';
// Explicit integration check: newly synthesized media only, isolated cache.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { spawnSync } = require('child_process');
const { createMedia, _test } = require('../plugin/media.cjs');
const { createCache } = require('../plugin/cache.cjs');
const root = path.resolve(__dirname, '..'), continuity = process.argv.includes('--continuity'), throughput = process.argv.includes('--throughput') || continuity, final = process.argv.includes('--final'), evidence = path.join(root, continuity ? 'verification-runs/e33-continuity' : throughput ? 'verification-runs/e33-throughput' : final ? 'verification-runs/e33-final' : 'verification-runs/e33-integration');
fs.mkdirSync(evidence, { recursive: true });
assert(fs.readdirSync(evidence).filter(n => /^media-.*\.json$/.test(n)).length < (continuity ? 3 : final || throughput ? 4 : 8), 'Integration run budget reached');
const id = crypto.randomBytes(8).toString('hex'), scratch = path.join(evidence, 'scratch-' + id);
fs.mkdirSync(scratch); const record = { id, started: new Date().toISOString(), checks: [], status: 'running', cleanup: [] };
const fps = process.argv.includes('--high-fps') ? 60 : 24;
const config = JSON.parse(fs.readFileSync(path.join(root, 'tests/host/t0/config.local.json')));
const tools = { ffmpeg: config.ffmpeg, ffprobe: config.ffprobe };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function run(args) {
  const result = spawnSync(tools.ffmpeg, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 ** 2 });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr.toString().slice(-3000)); return result.stdout;
}
async function main() {
  for (const variant of process.argv.includes('--diagnostic') || throughput && !process.argv.includes('--all-variants') ? ['cfr'] : ['cfr', 'vfr-offset', 'audio-tail']) await checkCase(variant);
  record.status = process.argv.includes('--diagnostic') ? 'diagnostic' : 'passed';
}
async function checkCase(variant) {
  const directory = path.join(scratch, variant); fs.mkdirSync(directory);
  const file = path.join(directory, 'synthetic.mp4');
  const offset = variant === 'vfr-offset' ? 5 : 0;
  run(['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${throughput ? '1280x720' : '320x180'}:rate=${fps}:duration=45`, '-f', 'lavfi', '-i', `sine=frequency=431:sample_rate=48000:duration=${variant === 'audio-tail' ? 47 : 45}`,
    ...(variant === 'vfr-offset' ? ['-vf', 'select=not(eq(mod(n\\,7)\\,3))', '-fps_mode', 'passthrough'] : []),
    '-c:v', 'libx264', '-threads', '4', '-preset', 'ultrafast', '-bf', '3', '-g', String(fps*2), '-c:a', 'aac', ...(process.argv.includes('--diagnostic') ? [] : ['-aac_pns', '0']),
    '-output_ts_offset', String(offset), '-movflags', '+faststart', file]);
  if (process.argv.includes('--diagnostic')) {
    for (const copy of [false, true]) for (const seek of [null, 0, 42, 44]) {
      const bytes = run(['-v', 'error', ...(copy ? ['-copyts'] : []), ...(seek === null ? [] : ['-seek_timestamp', '1', '-ss', String(seek)]), '-i', file, '-vn',
        '-af', `aresample=48000,atrim=start=${copy || seek === null ? 44 : 44 - seek}:end=${copy || seek === null ? 45 : 45 - seek}`,
        '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1']);
      record.checks.push({ name: 'audio-tail-diagnostic', copy, seek, bytes: bytes.length, hash: hash(bytes), tailHash: hash(bytes.subarray(-768)) });
    }
    record.status = 'diagnostic'; return;
  }
  const cache = createCache({ pluginRoot: directory, packFrames: true, diskBytes: 64 * 1024 ** 2 });
  const media = createMedia({ tools, cache }), before = performance.now();
  const info = await media.prepare({ id: 'synthetic-only', filePath: file, ext: 'mp4' }, { previewQuality: '720p' });
  assert.equal(info.streaming, 'segments-v1'); assert.equal(info.frames.length, variant === 'vfr-offset' ? 926 : fps*45); assert.equal(info.source.sha256, hash(fs.readFileSync(file)));
  record.checks.push({ name: 'formal-long-prepare', variant, frames: info.frames.length, duration: info.duration, ms: performance.now() - before });
  const atTime = time => info.segments.findIndex(g=>g.start<=time && g.end>time);
  for (const ordinal of [...new Set([0, 1, atTime(31.5), info.segments.length - 1])]) {
    const began = performance.now(); const segment = await media.prepareSegment(info, ordinal), group = info.segments[ordinal];
    assert.equal(segment.frames.length, group.last - group.first + 1);
    for (let i = 0; i < segment.frames.length; i++) {
      assert.equal(segment.frames[i].ptsTicks, info.frames[group.first + i].ptsTicks);
      const bytes = await cache.readAsset(segment, segment.frames[i].file); assert(bytes.length > 0);
    }
    assert(segment.audio); const wav = await cache.readAsset(segment, segment.audio.file);
    const fmt = _test.patchWav(Buffer.from(wav.subarray(0, Math.min(wav.length, 4096))), wav.length);
    const reference = run(['-v', 'error', '-copyts', '-i', file, '-vn', '-af', `aresample=48000,atrim=start=${offset + group.start}:end=${offset + group.end}`, '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1']);
    const actual = wav.subarray(fmt.dataOffset); let difference = 0;
    while (difference < Math.min(actual.length, reference.length) && actual[difference] === reference[difference]) difference++;
    let maxDelta = 0, changed = 0;
    for (let at = 0; at + 4 <= Math.min(actual.length, reference.length); at += 4) {
      const delta = Math.abs(actual.readFloatLE(at) - reference.readFloatLE(at)); maxDelta = Math.max(maxDelta, delta); if (delta) changed++;
    }
    record.checks.push({ name: 'audio-byte-comparison', ordinal, actual: actual.length, reference: reference.length, firstDifference: difference, maxDelta, changed, start: segment.audio.start, group });
    assert.equal(hash(actual), hash(reference), 'audio samples differ at segment ' + ordinal);
    record.checks.push({ name: 'segment-exact-PTS-and-audio', ms: performance.now()-began, ordinal, frames: segment.frames.length, bytes: wav.length });
    await cache.release(segment);
  }
  const cancel = new AbortController(); cancel.abort();
  await assert.rejects(media.prepareSegment(info, 20, { signal: cancel.signal }), e => e.code === 'MEDIA_CANCELLED');
  const reused = await media.prepareSegment(info, atTime(31.5)); await cache.release(reused);
  media.releaseLong(info);
  await assert.rejects(media.prepareSegment(info, 0), /失效/);
  assert.equal(cache.inventory().leases.length, 0);
  record.checks.push({ name: 'cancel-reuse-release' }); record.status = 'passed';
  if (variant === 'cfr' && process.argv.includes('--with-worker')) {
    const workerRoot = path.join(scratch, 'worker'); fs.mkdirSync(workerRoot); fs.mkdirSync(path.join(workerRoot, 'native'));
    for (const name of require('./package-release.cjs').RUNTIME) {
      const bytes = fs.readFileSync(path.join(root, 'plugin', name)); assert(bytes.length < 1024 ** 2);
      fs.writeFileSync(path.join(workerRoot, name), bytes, { flag: 'wx' });
    }
    const { createTaskClient } = require('../plugin/task-client.cjs');
    // Ordinary Node only. This check does not launch Eagle or load its plugin.
    const make = () => createTaskClient({ pluginRoot: workerRoot, runtime: process.execPath, discoverTools: async () => tools });
    let client = make();
    try {
      const runtime = await client.ping(), selected = { id: 'worker-synthetic', filePath: file, ext: 'mp4' };
      const loaded = await client.media.prepare(selected, { previewQuality: '720p' });
      if (throughput) { for (const ordinal of [0,1,2,3,4,5,20]) { const began=performance.now(); await client.cache.readAsset(loaded,loaded.frames[loaded.segments[ordinal].first].file); record.checks.push({name:'worker-cold-segment',ordinal,ms:performance.now()-began,seconds:loaded.segments[ordinal].end-loaded.segments[ordinal].start}); } }
      assert((await client.cache.readAsset(loaded, loaded.frames[0].file)).length > 0);
      assert((await client.cache.readAudioSegment(loaded, atTime(31.5))).bytes.length > 0);
      const old = client.cache.readAsset(loaded, loaded.frames[800].file).catch(error => error);
      client.cache.target(loaded, 10); await old;
      assert((await client.cache.readAsset(loaded, loaded.frames[240].file)).length > 0);
      if (process.argv.includes('--browser')) record.checks.push(await require('../tests/support/long-browser.cjs').checkBrowser({ root, scratch, client, info: loaded, throughput }));
      await client.cache.release(loaded); await client.close(); client = make();
      const reopened = await client.media.prepare(selected, { previewQuality: '720p' });
      assert((await client.cache.readAsset(reopened, reopened.frames[0].file)).length > 0);
      await client.cache.release(reopened);
      record.checks.push({ name: 'actual-worker-adoption-seek-cancel-release-reopen', node: runtime.node, eagleUI: false });
    } finally { await client.close(); }
    assert.equal(createCache({ pluginRoot: workerRoot }).inventory().leases.length, 0);
    assert(!fs.readdirSync(path.join(workerRoot, 'cache')).some(name => /^(partial-|lease-|writer\.lock)/.test(name)));
  }
}
function cleanup(dir) {
  const absolute = fs.realpathSync(dir); assert(absolute.toLowerCase().startsWith((fs.realpathSync(evidence) + path.sep).toLowerCase()));
  const all = [];
  function walk(folder) { for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, item.name), stat = fs.lstatSync(file); assert(!stat.isSymbolicLink());
    if (stat.isDirectory()) walk(file); else { assert(stat.isFile() && stat.nlink === 1); all.push({ file, ino: stat.ino, dev: stat.dev, size: stat.size, sha256: hash(fs.readFileSync(file)) }); }
  } }
  walk(dir); assert(all.reduce((n, s) => n + s.size, 0) <= 256 * 1024 ** 2);
  record.cleanup = all.map(s => ({ ...s, file: path.relative(scratch, s.file) }));
  for (const item of all) { const stat = fs.lstatSync(item.file); assert(stat.ino === item.ino && stat.dev === item.dev && stat.size === item.size && hash(fs.readFileSync(item.file)) === item.sha256); fs.unlinkSync(item.file); }
  function empty(folder) { for (const name of fs.readdirSync(folder)) empty(path.join(folder, name)); fs.rmdirSync(folder); } empty(dir);
}
main().catch(error => { record.status = 'failed'; record.error = error.stack; process.exitCode = 1; }).finally(() => {
  try { cleanup(scratch); } catch (error) { record.cleanupError = error.message; process.exitCode = 1; }
  const output = JSON.stringify(record, null, 2); assert(Buffer.byteLength(output) < 1024 ** 2);
  fs.writeFileSync(path.join(evidence, 'media-' + id + '.json'), output, { flag: 'wx' }); console.log(JSON.stringify({ id, status: record.status, checks: record.checks, error: record.error, cleanupError: record.cleanupError, cleanedFiles: record.cleanup.length }));
});
