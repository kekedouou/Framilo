'use strict';
// Argument/cache-identity and real long-media lifecycle models only. No media
// executable, physical filesystem writes, Eagle APIs or changed thresholds.
const assert = require('assert'), crypto = require('crypto'), { Readable } = require('stream');
const { createLongMedia, _test: { AUDIO_PREROLL_VERSION, audioInputArgs, segmentKey } } = require('../plugin/long-media.cjs');
const media = require('../plugin/media.cjs')._test;
const file = 'synthetic-only.mp4', sha = 'a'.repeat(64), colorVersion = media.COLOR_VERSION;
const legacyKey = (info, group) => crypto.createHash('sha256').update(JSON.stringify([info.videoEncoding ? 'avc-idr-v1' : 'segments-v1',
  ...(info.videoEncoding ? [info.videoEncoding] : []), info.source.sha256, info.preview, group, colorVersion])).digest('hex');
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function model(hasAudio = true, backend = 'proxy') {
  const calls = [], stored = new Map(), state = { closeCount: 0, aborts: 0, txClosed: 0, gate: null };
  const check = job => { if (job.signal?.aborted) throw Object.assign(Error('cancelled'), { code: 'MEDIA_CANCELLED', name: 'AbortError' }); };
  const tx = settings => ({
    async readComplete() { calls.push(settings); if (state.gate) await state.gate.promise; return stored.get(settings.sourceSha256); },
    async finish(value) { return value; }, abort() { state.aborts++; }, close() { state.txClosed++; }
  });
  const cache = { begin: tx, release: async () => {}, openBatch() { return { beginSegment: tx, snapshot: () => ({ usedBytes: 0 }), close: async () => { state.closeCount++; } }; } };
  const ratio = value => ({ n: BigInt(value), d: 1n });
  const h = { ...media, check, regular: () => ({}), sourceStamp: () => ({}), sameStamp: () => true,
    videoEnd: () => ({ timeBase: [1, 1], lastFrameEndTicks: '10' }),
    streamRatio: (stream, field) => ratio(stream[field]),
    guarded: (_, operation) => operation, settleJob: async () => {}, stopChildren: () => {},
    childProcess(job, tool, args) {
      if (args.includes('-show_packets')) return { child: { stdout: Readable.from([Buffer.from('pts=0|flags=K_\npts=2|flags=K_\npts=4|flags=K_\npts=6|flags=K_\npts=8|flags=K_\n')]), stderr: Readable.from([]) }, finish: Promise.resolve({ code: 0 }) };
      assert(args.includes('aresample=48000,ashowinfo@bounds'));
      return { child: { stderr: Readable.from([Buffer.from('[ashowinfo@bounds] pts:479900 nb_samples:100\n')]) }, finish: Promise.resolve({ code: 0 }) };
    }
  };
  const long = createLongMedia({ cache, tools: { ffprobe: 'model-probe', ffmpeg: 'model-audio-bounds' }, helpers: h });
  const probe = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 16, height: 16 },
    ...(hasAudio ? [{ codec_type: 'audio', channels: 1, start_pts: '0', duration_ts: '10' }] : [])] };
  return { long, calls, stored, state, prepare: () => long.prepare({ filePath: file }, { sha256: sha, stamp: {} }, probe, { playbackBackend: backend, previewQuality: '720p' }) };
}
async function main() {
  let count = 0;
  const test = async (name, action) => { await action(); count++; console.log('ok audio preroll: ' + name); };
  await test('zero/nonzero/negative actual audio starts decode initial padding without input seeking', () => {
    for (const [origin, start] of [[0, 0], [0, 5], [0, -1], [10, -1], [-10, 3]]) {
      // start is relative to the video origin, including shifted audio tracks.
      const args = audioInputArgs(file, origin, { start }, Math.max(0, start));
      assert.deepEqual(args, ['-i', file]); assert(!args.includes('-ss')); assert(!args.includes('-seek_timestamp')); assert(!args.includes('-noaccurate_seek'));
    }
  });
  await test('later requests retain the original two-second overlap and exact absolute seek value', () => {
    for (const [origin, trackStart, target, expected] of [[0, 0, 4, '2.000000000'], [10, -3, 4, '12.000000000'],
      [0, 5, 8, '6.000000000'], [0, -1, 2, '0.000000000'], [-10, 3, 6, '-6.000000000']]) {
      assert.deepEqual(audioInputArgs(file, origin, { start: trackStart }, target), ['-noaccurate_seek', '-seek_timestamp', '1', '-ss', expected, '-i', file]);
    }
  });
  await test('initial two-second overlap is not converted into a seek at the track start', () => {
    assert.deepEqual(audioInputArgs(file, 0, { start: 0 }, 2), ['-i', file]);
    assert.deepEqual(audioInputArgs(file, 10, { start: -1 }, 1), ['-i', file]);
  });
  await test('invalid timestamp types do not silently form NaN seek arguments', () => {
    for (const value of [NaN, Infinity, '0', undefined, null]) {
      assert.throws(() => audioInputArgs(file, value, { start: 0 }, 0), e => e.code === 'MEDIA_AUDIO_TIME');
      assert.throws(() => audioInputArgs(file, 0, { start: value }, 0), e => e.code === 'MEDIA_AUDIO_TIME');
      assert.throws(() => audioInputArgs(file, 0, { start: 0 }, value), e => e.code === 'MEDIA_AUDIO_TIME');
    }
  });
  await test('audio identity is versioned in both JPEG and proxy while original source and recipe stay untouched', async () => {
    assert.equal(AUDIO_PREROLL_VERSION, 'audio-preroll-v2');
    for (const backend of ['jpeg', 'proxy']) {
      const h = model(true, backend), info = await h.prepare(), group = info.segments[0];
      const old = legacyKey(info, group), current = segmentKey(info, group, colorVersion);
      assert.notEqual(current, old); assert.equal(info.source.sha256, sha); assert.equal(info.recipe, require('../plugin/cache.cjs').RECIPE);
      const expected = { leaseId: backend + '-new-audio-key', audio: { start: 0 } };
      h.stored.set(old, { leaseId: 'old-wrong-PCM' }); h.stored.set(current, expected);
      assert.strictEqual(await h.long.segment(info, 0), expected); assert.equal(h.calls[0].sourceSha256, current);
      assert.equal(h.state.txClosed, 1); await h.long.release(info); assert.equal(h.state.closeCount, backend === 'proxy' ? 1 : 0);
    }
  });
  await test('silent source keys remain byte-for-byte compatible with the previous cache identity', async () => {
    for (const backend of ['jpeg', 'proxy']) {
      const h = model(false, backend), info = await h.prepare(), group = info.segments[0];
      const old = legacyKey(info, group); assert.equal(segmentKey(info, group, colorVersion), old);
      const expected = { leaseId: backend + '-existing-silent-key' }; h.stored.set(old, expected);
      assert.strictEqual(await h.long.segment(info, 0), expected); assert.equal(h.calls[0].sourceSha256, old); await h.long.release(info);
    }
  });
  await test('cancelling an audio segment still aborts/closes its transaction before batch/source release', async () => {
    const h = model(), info = await h.prepare(), gate = h.state.gate = deferred(), controller = new AbortController();
    h.stored.set(segmentKey(info, info.segments[0], colorVersion), { leaseId: 'cancelled-audio-candidate' });
    const work = h.long.segment(info, 0, { signal: controller.signal }), rejected = assert.rejects(work, e => e.code === 'MEDIA_CANCELLED');
    while (!h.calls.length) await Promise.resolve(); controller.abort();
    let closed = false; const closing = h.long.release(info).then(() => { closed = true; }); await Promise.resolve(); assert(!closed);
    gate.resolve(); await rejected; await closing;
    assert.equal(h.state.aborts, 1); assert.equal(h.state.txClosed, 1); assert.equal(h.state.closeCount, 1);
    await assert.rejects(h.long.segment(info, 0), e => e.code === 'MEDIA_CANCELLED');
  });
  console.log(`Long audio preroll: ${count} pure/wiring models; no media generation or host operation.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
