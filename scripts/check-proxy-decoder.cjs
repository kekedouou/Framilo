'use strict';

// Explicit E34 first gate. Newly synthesized media only; never Eagle/library data.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { spawnSync } = require('child_process');
const { AccessUnitParser } = require('../plugin/avc-access-units.cjs');
const root = path.resolve(__dirname, '..'), evidence = path.join(root, 'verification-runs/e34-proxy');
const MAX_DISK = 512 * 1024 ** 2, MAX_EVIDENCE = 8 * 1024 ** 2;
const WIDTH = 1280, HEIGHT = 720, FPS = 60, SECONDS = 16, FRAMES = FPS * SECONDS;
fs.mkdirSync(evidence, { recursive: true });
const evidenceFiles = fs.readdirSync(evidence).filter(name => fs.statSync(path.join(evidence, name)).isFile());
assert(evidenceFiles.filter(name => /^(?:proxy|run|media)-[0-9a-f]+\.json$/.test(name)).length < 4, 'E34 first-gate run budget reached');
assert(evidenceFiles.reduce((sum, name) => sum + fs.statSync(path.join(evidence, name)).size, 0) <= MAX_EVIDENCE - 1024 ** 2, 'E34 evidence budget reached');
const id = crypto.randomBytes(8).toString('hex'), scratch = path.join(evidence, 'scratch-' + id);
fs.mkdirSync(scratch);
const record = { id, stage: 'E34', started: new Date().toISOString(), status: 'running',
  limits: { scratchBytes: MAX_DISK, evidenceBytes: MAX_EVIDENCE, rounds: 4, wallSeconds: 600, mediaProcesses: 1 },
  fixture: { width: WIDTH, height: HEIGHT, fps: FPS, seconds: SECONDS, frames: FRAMES, realSource: false }, checks: [], cleanup: [] };
const toolConfig = JSON.parse(fs.readFileSync(path.join(root, 'tests/host/t0/config.local.json'), 'utf8'));
const tools = { ffmpeg: toolConfig.ffmpeg, ffprobe: toolConfig.ffprobe }; // Deliberately never inspect config.sources.
for (const file of Object.values(tools)) assert(typeof file === 'string' && path.isAbsolute(file) && fs.statSync(file).isFile(), 'Existing media tool unavailable');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const started = Date.now();
function checkDeadline() { assert(Date.now() - started <= 600000, 'E34 ten-minute wall budget reached'); }
function run(tool, args, maxBuffer = 64 * 1024 ** 2) {
  checkDeadline(); const began = performance.now();
  const result = spawnSync(tool, ['-hide_banner', '-nostdin', ...args], { windowsHide: true, timeout: 90000, maxBuffer });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr.toString('utf8').slice(-4096));
  checkDeadline(); return { bytes: result.stdout, ms: performance.now() - began };
}
function diskUsage(directory) {
  let bytes = 0;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name), stat = fs.lstatSync(file); assert(!stat.isSymbolicLink(), 'Unexpected scratch link');
    if (stat.isDirectory()) bytes += diskUsage(file);
    else { assert(stat.isFile(), 'Unexpected scratch object'); bytes += stat.size; }
  }
  assert(bytes <= MAX_DISK, 'E34 scratch budget exceeded'); return bytes;
}
function marker(bytes) {
  let value = 0;
  for (let bit = 0; bit < 10; bit++) {
    const x = 12 + bit * 20 + 8, y = 16, at = (y * WIDTH + x) * 4;
    const level = (bytes[at] + bytes[at + 1] + bytes[at + 2]) / 3;
    assert(level <= 80 || level >= 175, 'Reference marker is ambiguous');
    if (level >= 175) value |= 1 << bit;
  }
  return value;
}
async function main() {
  const source = path.join(scratch, 'synthetic-720p60.mp4'), proxy = path.join(scratch, 'proxy.h264');
  const filters = ['drawbox=x=0:y=0:w=iw:h=32:color=black:t=fill'];
  for (let bit = 0; bit < 10; bit++) filters.push(`drawbox=x=${12 + bit * 20}:y=8:w=16:h=16:color=white:t=fill:enable='mod(floor(n/${2 ** bit}),2)'`);
  const generated = run(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=${SECONDS}`,
    '-vf', filters.join(','), '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-threads', '4', '-g', '120', '-bf', '3',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', source]);
  const sourceHash = hash(fs.readFileSync(source));
  record.checks.push({ name: 'synthetic-source-generated', ms: generated.ms, bytes: fs.statSync(source).size, sha256: sourceHash, marker: 'ten binary black/white cells encode original frame ordinal' });
  diskUsage(scratch);
  const encoded = run(tools.ffmpeg, ['-v', 'error', '-i', source, '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', 'scale=in_range=tv:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709:flags=bilinear+accurate_rnd+full_chroma_int,format=yuv420p',
    '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '20', '-threads', '4',
    '-profile:v', 'baseline', '-level:v', '5.1', '-g', '1', '-keyint_min', '1', '-bf', '0',
    '-x264-params', 'aud=1:repeat-headers=1:keyint=1:scenecut=0', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-f', 'h264', proxy]);
  diskUsage(scratch);
  const packets = [], parser = new AccessUnitParser(); let offset = 0;
  function accept(unit) { packets.push({ offset, bytes: unit.bytes.length, codec: unit.codec, sha256: hash(unit.bytes) }); offset += unit.bytes.length; }
  for await (const chunk of fs.createReadStream(proxy, { highWaterMark: 64 * 1024 })) parser.push(chunk).forEach(accept);
  parser.end().forEach(accept);
  assert.equal(packets.length, FRAMES); assert.equal(offset, fs.statSync(proxy).size);
  assert(packets.every(packet => packet.codec === packets[0].codec), 'Proxy changed encoding configuration');
  record.checks.push({ name: 'all-IDR-proxy-generated-and-framed', ms: encoded.ms, bytes: offset, codec: packets[0].codec, frames: packets.length,
    approximateRealtimeMultiple: SECONDS / (encoded.ms / 1000), sourceSha256: sourceHash });

  const selected = [0, 57, 127, 479, 600, 741, 898, 959], selection = selected.map(n => `eq(n\\,${n})`).join('+');
  // The oracle decodes the same complete proxy in order, not by assigning a
  // requested timestamp. Marker and sample pixels then independently identify it.
  const reference = run(tools.ffmpeg, ['-v', 'error', '-i', proxy, '-an', '-vf',
    `select=${selection},scale=in_range=tv:in_color_matrix=bt709:out_range=pc:flags=bilinear+accurate_rnd+full_chroma_int,format=rgba`,
    '-fps_mode', 'passthrough', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']);
  const frameBytes = WIDTH * HEIGHT * 4; assert.equal(reference.bytes.length, selected.length * frameBytes);
  const references = {};
  selected.forEach((frame, position) => {
    const rgba = reference.bytes.subarray(position * frameBytes, (position + 1) * frameBytes); assert.equal(marker(rgba), frame);
    const samples = [];
    for (let gy = 0; gy < 24; gy++) for (let gx = 0; gx < 40; gx++) {
      const x = Math.floor((gx + .5) * WIDTH / 40), y = Math.floor((gy + .5) * HEIGHT / 24), at = (y * WIDTH + x) * 4;
      samples.push(rgba[at], rgba[at + 1], rgba[at + 2]);
    }
    references[frame] = samples;
  });
  record.checks.push({ name: 'sequential-proxy-reference', frames: selected, markerMatch: true, grid: [40, 24], conversion: 'limited-range bt709 YUV to full-range RGBA' });
  const flushArg = process.argv.find(value => value.startsWith('--flush-after='));
  const flushAfterMs = !flushArg ? 8 : flushArg.endsWith('none') ? null : Number(flushArg.slice('--flush-after='.length));
  const browser = await require('../tests/support/proxy-browser.cjs').checkProxyBrowser({ root, scratch, proxy, packets, references,
    width: WIDTH, height: HEIGHT, frames: FRAMES, flushAfterMs });
  record.checks.push(browser);
  assert(browser.preloaded.p95Ms <= 50, 'Preloaded proxy decoder P95 exceeded 50ms; record is a failed gate, not a pass');
  assert.equal(hash(fs.readFileSync(source)), sourceHash, 'Synthetic original changed');
  record.peakObservedScratchBytes = diskUsage(scratch); record.status = 'passed';
}
function cleanup() {
  const absolute = fs.realpathSync(scratch), parent = fs.realpathSync(evidence);
  assert(absolute.toLowerCase().startsWith((parent + path.sep).toLowerCase()) && path.basename(absolute) === 'scratch-' + id, 'Scratch resolved outside its owned directory');
  const files = [];
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name), stat = fs.lstatSync(file, { bigint: true });
      assert(!stat.isSymbolicLink(), 'Unexpected scratch link');
      if (stat.isDirectory()) walk(file);
      else {
        assert(stat.isFile() && stat.nlink === 1n && stat.size <= BigInt(MAX_DISK), 'Unexpected scratch object');
        files.push({ file, ino: String(stat.ino), dev: String(stat.dev), size: Number(stat.size), sha256: hash(fs.readFileSync(file)) });
      }
    }
  }
  walk(absolute); assert(files.reduce((sum, item) => sum + item.size, 0) <= MAX_DISK, 'Cleanup scratch inventory exceeds budget; files retained');
  record.cleanup = files.map(item => ({ ...item, file: path.relative(scratch, item.file) }));
  for (const item of files) {
    const stat = fs.lstatSync(item.file, { bigint: true });
    assert(String(stat.ino) === item.ino && String(stat.dev) === item.dev && Number(stat.size) === item.size && hash(fs.readFileSync(item.file)) === item.sha256, 'Scratch file identity changed; retained');
    fs.unlinkSync(item.file);
  }
  function removeEmpty(directory) {
    for (const name of fs.readdirSync(directory)) { const child = path.join(directory, name); assert(fs.lstatSync(child).isDirectory()); removeEmpty(child); }
    fs.rmdirSync(directory);
  }
  removeEmpty(absolute);
}
main().catch(error => {
  record.status = 'failed'; record.error = String(error.stack || error).slice(-8192);
  if (error.proxyEvidence) record.browserFailure = error.proxyEvidence;
  process.exitCode = 1;
}).finally(() => {
  try { cleanup(); } catch (error) { record.cleanupError = String(error.message); process.exitCode = 1; }
  record.finished = new Date().toISOString();
  const data = JSON.stringify(record, null, 2); assert(Buffer.byteLength(data) < 1024 ** 2);
  fs.writeFileSync(path.join(evidence, 'proxy-' + id + '.json'), data, { flag: 'wx' });
  console.log(JSON.stringify({ id, status: record.status, checks: record.checks, error: record.error, cleanupError: record.cleanupError, cleanedFiles: record.cleanup.length }));
});
