'use strict';
// Explicit E36 harness helper only: owned synthetic media, no Eagle/library API.
const assert = require('assert'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFile } = require('child_process'), { promisify } = require('util');
const execute = promisify(execFile), sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const media = require('../../plugin/media.cjs')._test;
async function perform({ scratch, source, tools, root, label = 'cfr', context }) {
  const workspace = fs.realpathSync(scratch), sourcePath = fs.realpathSync(source);
  assert(sourcePath.toLowerCase().startsWith((workspace + path.sep).toLowerCase()), 'Only this run synthetic media is allowed');
  assert(['cfr', 'vfr', 'vfr-offset'].includes(label));
  const commands = [], runtimeInputs = [], reads = [], references = [];
  Object.assign(context, { label, commands, runtimeInputs, reads, references });
  const command = async (file, args) => {
    const at = Date.now(); let result;
    try { result = await execute(file, args, { windowsHide: true, encoding: 'buffer', maxBuffer: 8 * 1024 ** 2, timeout: 30000 }); }
    catch (error) { commands.push({ file, args, elapsedMs: Date.now() - at, error: error.message,
      stdoutBase64: Buffer.from(error.stdout || '').toString('base64'), stderrBase64: Buffer.from(error.stderr || '').toString('base64') }); throw error; }
    commands.push({ file, args, elapsedMs: Date.now() - at, stdoutBytes: result.stdout.length, stdoutSha256: sha(result.stdout), stderr: result.stderr.toString().slice(-8192) });
    return result.stdout;
  };
  // All reference generation ends before the guarded producer is started.
  const probe = JSON.parse((await command(tools.ffprobe, ['-v','error','-show_streams','-show_format','-of','json',sourcePath])).toString());
  const video = probe.streams.find(s => s.codec_type === 'video'); assert(video);
  const packets = (await command(tools.ffprobe, ['-v','error','-select_streams','v:0','-show_packets','-show_entries','packet=pts,flags','-of','compact=p=0:nk=0',sourcePath])).toString();
  const indexed = require('../../plugin/long-media.cjs').packetIndex(packets, video, media);
  const targets = [...new Set([0, Math.floor(indexed.frames.length / 2), indexed.frames.length - 1])];
  for (const ordinal of targets) {
    const frame = indexed.frames[ordinal], absolute = Number(BigInt(frame.ptsTicks)) * frame.timeBase[0] / frame.timeBase[1];
    const args = media.ffmpegArgs(sourcePath, false, video.codec_name, video, require('../../plugin/preview-profile.cjs').dimensions(video, '720p'));
    args[args.indexOf('-vf') + 1] = `trim=start=${absolute.toFixed(9)},trim=end_frame=1,` + args[args.indexOf('-vf') + 1];
    args.splice(args.indexOf('-f'), 0, '-frames:v', '1');
    const bytes = await command(tools.ffmpeg, args); assert(bytes.length > 0 && bytes.length <= 256 * 1024);
    references.push({ ordinal, ptsTicks: frame.ptsTicks, bytes: bytes.length, sha256: sha(bytes), base64: bytes.toString('base64') });
  }
  const workerRoot = path.join(workspace, 'backend-worker-' + label); fs.mkdirSync(workerRoot); fs.mkdirSync(path.join(workerRoot, 'native'));
  for (const file of require('../../scripts/package-release.cjs').RUNTIME) {
    if (file === 'manifest.json') { /* Manifest is copied as evidence, not installed. */ }
    const from = path.join(root, 'plugin', file), to = path.join(workerRoot, file); fs.mkdirSync(path.dirname(to), { recursive: true });
    const bytes = fs.readFileSync(from); fs.writeFileSync(to, bytes, { flag: 'wx' }); runtimeInputs.push({ file, bytes: bytes.length, sha256: sha(bytes) });
  }
  const { createTaskClient } = require('../../plugin/task-client.cjs');
  const make = () => createTaskClient({ pluginRoot: workerRoot, runtime: process.execPath, discoverTools: async () => tools });
  const selected = { id: 'e36-synthetic-' + label, itemId: 'e36-synthetic-' + label, name: 'E36 ' + label, ext: 'mp4', filePath: sourcePath };
  let client = make(), safe = false, chromeSafe = true, first; context.guardStarted = true;
  try {
    first = await client.media.prepare(selected, { playbackBackend: 'proxy', previewQuality: '720p' });
    assert.equal(first.frames.length, indexed.frames.length); assert.equal(first.source.sha256, sha(fs.readFileSync(sourcePath)));
    client.cache.prioritizeRecords(first, { all: targets, visible: targets.slice(0, 1) });
    for (const ordinal of targets) {
      const start = performance.now(), picture = await client.cache.readRecordFrame(first, ordinal, {}), reference = references.find(r => r.ordinal === ordinal);
      const bytes = Buffer.from(picture.bytes), actual = sha(bytes), expected = reference.sha256;
      reads.push({ ordinal, elapsedMs: performance.now() - start, width: picture.width, height: picture.height,
        bytes: bytes.length, sha256: actual, referenceSha256: expected, matches: actual === expected });
      assert.equal(picture.ordinal, ordinal); assert.equal(picture.width, first.width); assert.equal(picture.height, first.height); assert.equal(actual, expected, 'Exact annotation still differs from full-source single-frame reference');
    }
    if (label === 'cfr') {
      const browserRoot = path.join(workspace, 'formal-player-browser'); fs.mkdirSync(browserRoot);
      chromeSafe = false;
      const formalPlayer = await require('./responsive-player-browser.cjs').checkProxyPlayerBrowser({ root, scratch: browserRoot, client, info: first,
        requireBackgroundOverlap: false, backgroundTimeoutMs: 30000 });
      context.formalPlayer = formalPlayer; chromeSafe = formalPlayer.safeToClean === true;
      assert(chromeSafe, 'Formal Player Chrome process tree lacks safe exit proof');
      assert.equal(formalPlayer.status, 'passed', 'Formal Player proxy regression failed');
    }
    await client.cache.release(first); await client.close(); safe = true;
    client = make(); safe = false;
    const reopened = await client.media.prepare(selected, { playbackBackend: 'proxy', previewQuality: '720p' });
    const reopenedAt = performance.now(), again = await client.cache.readRecordFrame(reopened, targets[1], {});
    const reopen = { ordinal: targets[1], elapsedMs: performance.now() - reopenedAt, sha256: sha(Buffer.from(again.bytes)) };
    assert.equal(reopen.sha256, references.find(r => r.ordinal === targets[1]).sha256);
    await client.cache.release(reopened); await client.close(); safe = true;
    const inventory = require('../../plugin/cache.cjs').createCache({ pluginRoot: workerRoot }).inventory();
    assert(Array.isArray(inventory.leases)); assert.strictEqual(inventory.leases.length, 0);
    return { status: 'passed', label, safeToClean: true, safeToCleanup: true, origin: 'formal-media-worker-read-thread-real-Windows-guard',
      runtime: process.versions.node, sourceSha256: first.source.sha256, frames: first.frames.length,
      runtimeInputs, commands, references, reads, reopen, formalPlayer: context.formalPlayer || null, finalCache: inventory,
      limits: 'Exact JPEG/PTS/ownership and reopen; no physical display/audio/Eagle-window measurement' };
  } catch (error) {
    try { await client.close(); safe = chromeSafe; } catch (closeError) { error.closeError = closeError.message; }
    error.safeToClean = safe; error.safeToCleanup = safe; error.backendEvidence = { label, runtimeInputs, commands, reads, references,
      formalPlayer: context.formalPlayer || null, error: error.stack, safeToCleanup: safe }; throw error;
  }
}
async function run(options) {
  const context = { guardStarted: false };
  try { return await perform({ ...options, context }); }
  catch (error) {
    if (!error.backendEvidence) error.backendEvidence = { ...context, error: error.stack };
    if (!context.guardStarted) { error.safeToClean = true; error.safeToCleanup = true; }
    throw error;
  }
}
module.exports = { run };
