'use strict';
// Explicit small synthetic-media/filesystem/guard regression. Never opens Eagle
// UI, accesses real assets, imports into Eagle, or touches the product cache.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { spawnSync } = require('child_process');
const { createExportStore, _test } = require('../plugin/export.cjs');
const { createEagleAdapter } = require('../plugin/eagle.cjs');
const root = path.resolve(__dirname, '..'), sha = data => crypto.createHash('sha256').update(data).digest('hex');
const argument = process.argv.find(value => value.startsWith('--tools='));
if (!argument) throw Error('Explicit --tools=<local JSON with ffmpeg/ffprobe> is required.');
const tools = JSON.parse(fs.readFileSync(path.resolve(argument.slice(8)), 'utf8'));
const parent = path.join(root, 'tests/export-scratch'), evidence = path.join(root, 'verification-runs/e07-local');
const token = crypto.randomBytes(8).toString('hex'), owner = 'eva-e07-local-v1';
const scratch = path.join(parent, 'run-' + token + ' 中文 空格'), outputRecord = path.join(evidence, 'run-' + token + '.json');
let record, reserved, guard;
function regular(file, directory = false) {
  const stat = fs.lstatSync(file, { bigint: true });
  assert(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1n));
  assert.equal(fs.realpathSync(file).toLowerCase(), path.resolve(file).toLowerCase()); return stat;
}
function save() {
  const bytes = Buffer.from(JSON.stringify(record, null, 2)); assert(bytes.length <= 65536, 'Record exceeded its existing slot.');
  fs.ftruncateSync(reserved, 0); fs.writeSync(reserved, bytes, 0, bytes.length, 0); fs.fsyncSync(reserved);
}
function tool(file, args) {
  regular(file);
  const result = spawnSync(file, args, { windowsHide: true, shell: false, encoding: null, timeout: 30000, maxBuffer: 8 * 1024 ** 2 });
  record.commands.push({ tool: path.basename(file), args, status: result.status, error: result.error && result.error.message,
    stderr: result.stderr && result.stderr.toString().slice(-2000) });
  if (result.error || result.status !== 0) throw Error(String(result.error || result.stderr).slice(-2048));
  return result.stdout;
}
function probe(file) { return JSON.parse(tool(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])); }
function sourceInfo(file) {
  const data = JSON.parse(tool(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams', '-of', 'json', file]));
  const stream = data.streams[0], origin = Number(data.frames[0].best_effort_timestamp_time);
  return { source: { filePath: file, sha256: sha(fs.readFileSync(file)), id: 'synthetic', name: 'synthetic' },
    metrics: { sourceVideoOrigin: origin }, duration: Number(stream.duration),
    frames: data.frames.map((frame, id, rows) => ({ id, time: Number(frame.best_effort_timestamp_time) - origin,
      end: (rows[id + 1] ? Number(rows[id + 1].best_effort_timestamp_time) : Number(stream.start_time || 0) + Number(stream.duration)) - origin })) };
}
function inventory() {
  const leaves = [], directories = []; let bytes = 0;
  function walk(directory) {
    regular(directory, true); directories.push(directory);
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(file);
      else { const value = regular(file); bytes += Number(value.size);
        leaves.push({ relative: path.relative(scratch, file), bytes: Number(value.size), dev: String(value.dev), ino: String(value.ino), sha256: sha(fs.readFileSync(file)) }); }
    }
  }
  walk(scratch); assert(bytes <= 16 * 1024 ** 2, 'Scratch exceeded its declared 16MiB budget.'); return { leaves, directories, bytes };
}
async function main() {
  regular(root, true); regular(path.dirname(evidence), true);
  if (!fs.existsSync(evidence)) { fs.mkdirSync(evidence); fs.writeFileSync(path.join(evidence, 'owner.json'), JSON.stringify({ owner }), { flag: 'wx' }); }
  regular(evidence, true); assert.equal(JSON.parse(fs.readFileSync(path.join(evidence, 'owner.json'))).owner, owner);
  const entries = fs.readdirSync(evidence); assert(entries.length < 16 && entries.every(name => name === 'owner.json' || /^run-[0-9a-f]{16}\.json$/.test(name)));
  assert(entries.reduce((sum, name) => sum + Number(regular(path.join(evidence, name)).size), 0) + 65536 <= 1024 ** 2);
  reserved = fs.openSync(outputRecord, 'wx');
  record = { owner, token, started: new Date().toISOString(), node: process.versions.node,
    scope: 'Synthetic media, Windows files and owned guard only; no Eagle GUI or library writes', commands: [], checks: [], status: 'started',
    sources: Object.fromEntries(['export.cjs', 'eagle.cjs', 'session.cjs', 'ui.js', 'media.cjs', 'task-client.cjs', 'task-worker.cjs'].map(name => [name, sha(fs.readFileSync(path.join(root, 'plugin', name)))])) };
  save();
  if (!fs.existsSync(parent)) fs.mkdirSync(parent); regular(parent, true); fs.mkdirSync(scratch);
  fs.writeFileSync(path.join(scratch, 'owner.json'), JSON.stringify({ owner, token }), { flag: 'wx' });
  const runtime = path.join(scratch, 'runtime'); fs.mkdirSync(runtime); fs.mkdirSync(path.join(runtime, 'native'));
  for (const name of ['cache.cjs', 'process-identity.cjs', 'media.cjs', 'frame-index.cjs', 'frame-pack.cjs', 'preview-profile.cjs', 'task-worker.cjs', 'export.cjs',
    'native/task-host.cs', 'native/task-host.local.exe', 'native/task-host.local.json']) fs.copyFileSync(path.join(root, 'plugin', name), path.join(runtime, name), fs.constants.COPYFILE_EXCL);
  const cfr = path.join(scratch, '有声 原始.mp4'), vfr = path.join(scratch, '变帧率.mp4'), offset = path.join(scratch, '音频延后.mp4');
  tool(tools.ffmpeg, ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=12:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=1',
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-crf', '18', '-threads', '1', '-bf', '0', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_trc', 'bt709', '-color_primaries', 'bt709', '-c:a', 'aac', '-n', cfr]);
  tool(tools.ffmpeg, ['-v', 'error', '-nostdin', '-i', cfr, '-an', '-vf', 'select=not(eq(n\\,2))', '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '1', '-bf', '0', '-n', vfr]);
  tool(tools.ffmpeg, ['-v', 'error', '-nostdin', '-i', cfr, '-itsoffset', '0.25', '-i', cfr, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-t', '1', '-n', offset]);
  const borrowed = ['hevc-vfr.mp4', 'vp9-silent.mp4'].map(name => {
    const original = path.join(root, 'prototypes/playback-clock/runtime/fixtures', name); regular(original);
    const destination = path.join(scratch, name); fs.copyFileSync(original, destination, fs.constants.COPYFILE_EXCL);
    return { original, destination, sha256: sha(fs.readFileSync(original)) };
  });
  const originals = [cfr, vfr, offset, ...borrowed.map(value => value.destination)].map(file => ({ file, sha256: sha(fs.readFileSync(file)) }));
  const store = createExportStore({ pluginRoot: runtime }), settings = { tools, timeoutMs: 30000 };
  const info = sourceInfo(cfr), png = await store.create(info, { kind: 'frame', frameOrdinal: 5 }, settings);
  const actualRgb = tool(tools.ffmpeg, ['-v', 'error', '-i', png.filePath, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
  const expectedRgb = tool(tools.ffmpeg, ['-v', 'error', '-i', cfr, '-vf', 'select=eq(n\\,5),scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=bilinear+accurate_rnd+full_chroma_int,format=rgb24', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1']);
  assert(actualRgb.equals(expectedRgb), 'PNG is not the selected source frame/color conversion.');
  const savedPng = path.join(scratch, '本地 当前帧.png');
  await store.publish(png.token, { filePath: savedPng }); assert.equal(sha(fs.readFileSync(savedPng)), png.sha256);
  record.checks.push('PNG source frame/color bytes and atomic Unicode/space local publication');
  for (const file of [cfr, vfr, offset, ...borrowed.map(value => value.destination)]) {
    const indexed = sourceInfo(file), result = await store.create(indexed, { kind: 'clip', firstOrdinal: 1, lastOrdinal: 4 }, settings);
    const expected = tool(tools.ffmpeg, ['-v', 'error', '-i', file, '-vf', 'trim=start_frame=1:end_frame=5', '-fps_mode', 'passthrough', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', 'pipe:1']);
    const actual = tool(tools.ffmpeg, ['-v', 'error', '-i', result.filePath, '-fps_mode', 'passthrough', '-pix_fmt', 'yuv420p', '-f', 'rawvideo', 'pipe:1']);
    assert.equal(actual.length, expected.length); let squared = 0;
    for (let i = 0; i < actual.length; i++) squared += (actual[i] - expected[i]) ** 2;
    const psnr = squared ? 10 * Math.log10(255 ** 2 / (squared / actual.length)) : 100;
    assert(psnr > 35, 'Unexpected source frames or severe quality regression.');
    const timing = JSON.parse(tool(tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_streams', '-of', 'json', result.filePath]));
    assert.equal(timing.frames.length, 4);
    for (let i = 0; i < 4; i++) assert(Math.abs(Number(timing.frames[i].best_effort_timestamp_time) - (indexed.frames[i + 1].time - indexed.frames[1].time)) < .001,
      'Output timestamps do not preserve the selected source cadence.');
    const duration = indexed.frames[4].end - indexed.frames[1].time;
    assert(Math.abs(Number(timing.streams[0].duration) - duration) < .002, 'Last selected frame duration is incorrect.');
    const clipProbe = probe(result.filePath);
    assert.equal(clipProbe.streams.filter(stream => stream.codec_type === 'audio').length,
      probe(file).streams.some(stream => stream.codec_type === 'audio') ? 1 : 0);
    record.checks.push({ case: path.basename(file), psnr, frames: 4, duration });
    if (file === offset) {
      const pcm = tool(tools.ffmpeg, ['-v', 'error', '-i', result.filePath, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1']);
      let onset = -1;
      for (let sample = 0; sample * 4 < pcm.length; sample++) if (Math.abs(pcm.readFloatLE(sample * 4)) > .01) { onset = sample / 48000; break; }
      const expectedOnset = .25 - indexed.frames[1].time;
      assert(onset >= 0 && Math.abs(onset - expectedOnset) < .035, 'Audio start is shifted relative to the selected source video.');
      record.checks.push({ audioOnset: onset, expectedOnset, limitSeconds: .035 });
    }
    await store.discard(result.token);
  }
  const rotated = path.join(scratch, '旋转.mp4');
  tool(tools.ffmpeg, ['-v', 'error', '-display_rotation:v:0', '90', '-i', cfr, '-c', 'copy', '-n', rotated]);
  const declaredRotation = probe(rotated).streams.find(stream => stream.codec_type === 'video');
  assert((declaredRotation.side_data_list || []).some(side => Math.abs(side.rotation) === 90), 'Synthetic rotation fixture did not carry the requested display matrix.');
  const rotatedInfo = sourceInfo(rotated), rotatedPng = await store.create(rotatedInfo, { kind: 'frame', frameOrdinal: 1 }, settings);
  assert.equal(rotatedPng.width, 64); assert.equal(rotatedPng.height, 96); await store.discard(rotatedPng.token);
  const rotatedClip = await store.create(rotatedInfo, { kind: 'clip', firstOrdinal: 0, lastOrdinal: 2 }, settings);
  const sourceRotation = probe(rotated).streams.find(stream => stream.codec_type === 'video').side_data_list.find(side => side.rotation !== undefined).rotation;
  const outputRotation = probe(rotatedClip.filePath).streams.find(stream => stream.codec_type === 'video').side_data_list.find(side => side.rotation !== undefined).rotation;
  assert.equal(outputRotation, sourceRotation); await store.discard(rotatedClip.token);
  record.checks.push('PNG applies source portrait orientation; MP4 keeps encoded source size and original display rotation');
  const early = await store.create(sourceInfo(offset), { kind: 'clip', firstOrdinal: 0, lastOrdinal: 1 }, settings);
  const silentPcm = tool(tools.ffmpeg, ['-v', 'error', '-i', early.filePath, '-map', '0:a:0', '-ac', '1', '-f', 'f32le', 'pipe:1']);
  for (let sample = 0; sample * 4 < silentPcm.length; sample++) assert(Math.abs(silentPcm.readFloatLE(sample * 4)) < .005, 'Audio outside the selected interval leaked into the clip.');
  await store.discard(early.token); record.checks.push('A segment ending before the source audio starts contains silence, not shifted later audio');
  const keep = await store.create(info, { kind: 'frame', frameOrdinal: 0 }, settings);
  await assert.rejects(store.publish(keep.token, { filePath: savedPng }), error => error.code === 'EXPORT_EXISTS');
  assert.equal(sha(fs.readFileSync(savedPng)), png.sha256);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(store.create(info, { kind: 'frame', frameOrdinal: 0 }, { ...settings, signal: abort.signal }), /取消/);
  record.checks.push('Existing destination never overwritten; cancellation does not create a new media job');
  const importedFile = path.join(scratch, '模拟导入.png'); let imported = false, calls = 0;
  const mockItem = { id: 'imported', name: '导出画面', folders: ['folder'], filePath: importedFile };
  const api = { library: { path: path.join(scratch, 'mock-library') }, folder: { getById: async id => ({ id }) }, item: {
    get: async () => imported ? [mockItem] : [], getById: async () => mockItem,
    async addFromPath(file) { calls++; fs.copyFileSync(file, importedFile, fs.constants.COPYFILE_EXCL); imported = true; throw Error('simulated lost response'); }
  } };
  const importedResult = await createEagleAdapter(api).importExport({ ...keep, name: '导出画面', folderId: 'folder', libraryPath: api.library.path });
  assert.equal(importedResult.status, 'saved'); assert.equal(calls, 1); await store.discard(keep.token);
  record.checks.push('Eagle adapter import model verifies a lost committed response using a new item and original file hash, without resending');
  guard = require('../plugin/task-client.cjs').createTaskClient({ pluginRoot: runtime, discoverTools: async () => tools });
  const prepared = await guard.media.prepare({ id: 'synthetic', itemId: 'synthetic', name: 'synthetic', ext: 'mp4', filePath: cfr }, { previewQuality: '720p' });
  const guarded = await guard.exports.create(prepared, { kind: 'clip', firstOrdinal: 1, lastOrdinal: 3 });
  await guard.exports.discard(guarded.token);
  const controller = new AbortController(), pending = guard.exports.create(prepared, { kind: 'frame', frameOrdinal: 4 }, { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, /取消|cancel/i);
  await guard.cache.release(prepared);
  const largeFile = path.join(scratch, '取消与关闭专用.mp4');
  tool(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=1', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-crf', '22', '-threads', '1', '-pix_fmt', 'yuv420p', '-n', largeFile]);
  const largeSource = { id: 'synthetic-large', itemId: 'synthetic-large', name: 'synthetic-large', ext: 'mp4', filePath: largeFile };
  const largePrepared = await guard.media.prepare(largeSource, { previewQuality: '720p' });
  const during = new AbortController(); let cancelTimer;
  const inProgress = guard.exports.create(largePrepared, { kind: 'clip', firstOrdinal: 0, lastOrdinal: 23 },
    { signal: during.signal, onProgress() { cancelTimer = setTimeout(() => during.abort(), 30); } });
  await assert.rejects(inProgress, /取消|cancel/i); clearTimeout(cancelTimer);
  let closing;
  const closeDuring = guard.exports.create(largePrepared, { kind: 'clip', firstOrdinal: 0, lastOrdinal: 23 },
    { onProgress() { closing = guard.close(); } });
  await assert.rejects(closeDuring, /取消|cancel/i); assert(closing); await closing; assert(guard.stopped);
  guard = require('../plugin/task-client.cjs').createTaskClient({ pluginRoot: runtime, discoverTools: async () => tools });
  const reopened = await guard.media.prepare(largeSource, { previewQuality: '720p' });
  const reopenedPng = await guard.exports.create(reopened, { kind: 'frame', frameOrdinal: 0 });
  await guard.exports.discard(reopenedPng.token); await guard.cache.release(reopened); await guard.close(); assert(guard.stopped);
  record.checks.push('Real guarded export cancellation during work, close during work, complete exit, and next-owner reuse/export all pass without a stuck cache owner');
  for (const original of originals) assert.equal(sha(fs.readFileSync(original.file)), original.sha256);
  for (const input of borrowed) assert.equal(sha(fs.readFileSync(input.original)), input.sha256);
  const files = inventory(); record.status = 'passed'; record.cleanup = { state: 'planned', bytes: files.bytes, files: files.leaves }; save();
  for (const leaf of files.leaves) {
    const file = path.join(scratch, leaf.relative), current = regular(file);
    assert.equal(String(current.dev), leaf.dev); assert.equal(String(current.ino), leaf.ino); assert.equal(Number(current.size), leaf.bytes);
    assert.equal(sha(fs.readFileSync(file)), leaf.sha256); fs.unlinkSync(file);
  }
  for (const directory of files.directories.reverse()) { regular(directory, true); fs.rmdirSync(directory); }
  record.cleanup.state = 'completed'; record.completed = new Date().toISOString(); save();
  console.log(JSON.stringify({ record: path.relative(root, outputRecord), node: record.node, checks: record.checks, cleanedBytes: files.bytes }));
}
main().catch(async error => {
  if (guard) await guard.close().catch(() => {});
  if (record) { record.status = 'failed'; record.error = error.stack; if (fs.existsSync(scratch)) { try { record.retained = inventory().leaves; } catch (failure) { record.inventoryError = failure.message; } } try { save(); } catch (_) {} }
  console.error(error.stack); process.exitCode = 1;
}).finally(() => { if (reserved !== undefined) fs.closeSync(reserved); });
