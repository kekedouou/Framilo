'use strict';
// Explicit, bounded synthetic-only feasibility probe. No Eagle or product cache.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { spawn } = require('child_process');
const { JpegParser } = require('../../plugin/media.cjs')._test;
const root = path.resolve(__dirname, '../..'), MIB = 1024 ** 2;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const token = crypto.randomBytes(8).toString('hex');
const scratch = path.join(__dirname, 'scratch', 'run-' + token);
const evidence = path.join(root, 'verification-runs/e33-long-video');
const record = { schema: 1, token, startedAt: new Date().toISOString(), status: 'running', commands: [], cases: [], limitations: ['Synthetic 320x180/24fps only', 'Direct path is FFmpeg raw-frame IPC, not embedded libavcodec or mrv2', 'No Eagle or audio playback measurement'] };
let active = null, deadline, recordFile, expired = false;
function regular(file, dir = false) {
  const s = fs.lstatSync(file); assert(!s.isSymbolicLink() && (dir ? s.isDirectory() : s.isFile() && s.nlink === 1));
  assert.equal(fs.realpathSync(file).toLowerCase(), path.resolve(file).toLowerCase()); return s;
}
function save() { const b = Buffer.from(JSON.stringify(record, null, 2)); assert(b.length <= 256 * 1024); fs.writeFileSync(recordFile, b); }
async function run(exe, args, { mode = 'none', frames = 0, cancelAfterFirst = false } = {}) {
  assert(!expired, 'Run deadline exceeded'); assert(!active, 'Only one child allowed'); regular(exe);
  const started = performance.now(), parser = mode === 'jpeg' ? new JpegParser() : null;
  let count = 0, bytes = 0, rawPending = 0, firstMs = null, cancelledAt = null, tail = '', pending = '', stderrBytes = 0, error;
  const rows = [], outputHash = crypto.createHash('sha256');
  const child = spawn(exe, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); active = child;
  const stop = reason => { error ||= reason; child.kill(); };
  const timer = setTimeout(() => stop(Error('Child timeout')), 30000);
  const first = () => { if (firstMs !== null) return; firstMs = performance.now() - started;
    if (cancelAfterFirst) { cancelledAt = performance.now(); child.kill(); } };
  child.stdout.on('data', chunk => { try {
    bytes += chunk.length; outputHash.update(chunk); assert(bytes <= 256 * MIB, 'Bounded output exceeded');
    if (parser) { const images = parser.push(chunk); count += images.length; if (images.length) first(); }
    else if (mode === 'raw') { rawPending += chunk.length; const n = Math.floor(rawPending / (320 * 180 * 3)); rawPending %= 320 * 180 * 3; count += n; if (n) first(); }
    else if (mode === 'audio') { assert(bytes <= 16 * MIB); first(); }
    else assert(bytes <= 4 * MIB);
  } catch (e) { stop(e); } });
  child.stderr.on('data', chunk => { try {
    stderrBytes += chunk.length; assert(stderrBytes <= 4 * MIB); tail = (tail + chunk).slice(-2000); pending += chunk;
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) { const m = /\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:([^\s]+).*?\bchecksum:([0-9A-F]+)/.exec(line);
      if (m) rows.push({ pts: m[2], time: Number(m[3]), checksum: m[4] }); }
    assert(rows.length <= 1200);
  } catch (e) { stop(e); } });
  const result = await new Promise(resolve => { child.on('error', e => { error ||= e; }); child.on('close', (code, signal) => resolve({ code, signal })); });
  clearTimeout(timer); active = null;
  const summary = { tool: path.basename(exe), args: args.map(a => a.startsWith(scratch) ? path.relative(scratch, a) : a), mode,
    ...result, frames: count, bytes, firstMs, totalMs: performance.now() - started, cancelMs: cancelledAt === null ? null : performance.now() - cancelledAt,
    outputSha256: outputHash.digest('hex'), timestampsSha256: sha(JSON.stringify(rows)), rowCount: rows.length, error: error?.message, stderr: result.code && !cancelAfterFirst ? tail : undefined };
  record.commands.push(summary); save();
  if (error) throw error;
  if (cancelAfterFirst) { assert(cancelledAt !== null && summary.cancelMs < 5000); }
  else { assert.equal(result.code, 0, tail); if (frames) assert.equal(count, frames); if (mode !== 'none') { assert.equal(rows.length, count); assert.equal(rawPending, 0); if (parser) assert.equal(parser.buffer.length, 0); } }
  return { summary, rows };
}
function decodeArgs(file, mode, start, frames) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'info', '-threads', '1', ...(start === null ? [] : ['-ss', String(start)]), '-copyts', '-i', file,
    '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', (frames ? 'trim=end_frame=' + frames + ',' : '') + 'format=rgb24,showinfo', '-fps_mode', 'passthrough', '-threads', '1',
    ...(frames ? ['-frames:v', String(frames)] : []), ...(mode === 'jpeg' ? ['-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2pipe'] : ['-c:v', 'rawvideo', '-pix_fmt', 'rgb24', '-f', 'rawvideo']), 'pipe:1'];
}
async function main() {
  const arg = process.argv.find(a => a.startsWith('--tools=')); assert(arg, '--tools=<existing JSON> is required');
  const { ffmpeg, ffprobe } = JSON.parse(fs.readFileSync(path.resolve(arg.slice(8)), 'utf8')); regular(ffmpeg); regular(ffprobe);
  regular(root, true); regular(__dirname, true);
  for (const dir of [path.dirname(scratch), evidence]) { if (!fs.existsSync(dir)) fs.mkdirSync(dir); regular(dir, true); }
  const existing = fs.readdirSync(evidence); assert(existing.length < 3, 'Maximum three runs; do not delete evidence or silently increase budget');
  assert(existing.reduce((s, n) => s + regular(path.join(evidence, n)).size, 0) + 256 * 1024 <= 4 * MIB);
  recordFile = path.join(evidence, 'run-' + token + '.json'); fs.writeFileSync(recordFile, '', { flag: 'wx' });
  fs.mkdirSync(scratch); regular(scratch, true); save();
  deadline = setTimeout(() => { expired = true; active?.kill(); }, 180000);
  try {
    for (const variable of [false, true]) {
      const file = path.join(scratch, variable ? 'vfr.mp4' : 'cfr.mp4');
      await run(ffmpeg, ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=45',
        '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=45',
        ...(variable ? ['-vf', "select='not(eq(mod(n,7),2))'"] : []), '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-bf', '2', '-g', '96', '-c:a', 'aac', '-fs', String(32 * MIB), '-n', file]);
      assert(regular(file).size < 32 * MIB);
      const baseline = await run(ffmpeg, decodeArgs(file, 'jpeg', null, 0), { mode: 'jpeg' });
      assert(baseline.rows.at(-1).time > 44, 'Source must really exceed 30 seconds');
      for (const target of [0, 31.25, 8.125, 43]) {
        const expected = baseline.rows.filter(r => r.time >= target - 0.00001).slice(0, 24);
        for (const mode of ['jpeg', 'raw']) {
          const sample = await run(ffmpeg, decodeArgs(file, mode, target, expected.length), { mode, frames: expected.length });
          assert.deepEqual(sample.rows, expected, 'Seek must match source PTS and pre-encode frame checksum');
          record.cases.push({ source: path.basename(file), target, mode, firstMs: sample.summary.firstMs, totalMs: sample.summary.totalMs, bytes: sample.summary.bytes, frames: expected.length, exact: true }); save();
        }
      }
      await run(ffmpeg, decodeArgs(file, 'raw', null, 0), { mode: 'raw', cancelAfterFirst: true });
      // Compare an input-side seek with sequential decoding + exact sample trim.
      // This measures chunk boundary correctness, not browser audio scheduling.
      for (const target of [0, 31.25]) {
        const start = Math.round(target * 48000), common = ['-map', '0:a:0', '-vn', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'];
        const expected = await run(ffmpeg, ['-v', 'error', '-nostdin', '-i', file, '-af', 'atrim=start_sample=' + start + ':end_sample=' + (start + 48000), ...common], { mode: 'audio' });
        const actual = await run(ffmpeg, ['-v', 'error', '-nostdin', '-ss', String(target), '-i', file, '-af', 'atrim=end_sample=48000', ...common], { mode: 'audio' });
        assert.equal(actual.summary.bytes, 48000 * 4); assert.equal(actual.summary.bytes, expected.summary.bytes);
        record.cases.push({ source: path.basename(file), target, mode: 'audio', samples: 48000,
          exact: actual.summary.outputSha256 === expected.summary.outputSha256, firstMs: actual.summary.firstMs }); save();
        assert.equal(actual.summary.outputSha256, expected.summary.outputSha256, 'Fast audio chunk differs from sequential sample reference');
      }
    }
    record.status = 'passed';
  } catch (e) { record.status = 'failed'; record.failure = e.stack; throw e; }
  finally {
    clearTimeout(deadline); assert(!active); record.finishedAt = new Date().toISOString();
    const files = fs.readdirSync(scratch).map(name => { const file = path.join(scratch, name); const s = regular(file); return { name, bytes: s.size, dev: s.dev, ino: s.ino, sha256: sha(fs.readFileSync(file)) }; });
    assert(files.reduce((n, f) => n + f.bytes, 0) <= 128 * MIB); record.cleanup = { files, deleted: [] }; save();
    // Checked absolute boundary, file identities and hashes before individual deletion.
    assert.equal(path.dirname(fs.realpathSync(scratch)).toLowerCase(), path.resolve(__dirname, 'scratch').toLowerCase());
    for (const f of files) { const file = path.join(scratch, f.name), s = regular(file); assert(s.dev === f.dev && s.ino === f.ino && s.size === f.bytes && sha(fs.readFileSync(file)) === f.sha256); fs.unlinkSync(file); record.cleanup.deleted.push(f.name); }
    fs.rmdirSync(scratch); save();
    console.log(JSON.stringify({ status: record.status, record: path.relative(root, recordFile), cases: record.cases.length, failure: record.failure }));
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
