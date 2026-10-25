'use strict';
// Real long-media/frame-index/JPEG parser, memory-only transaction/child models.
const assert = require('assert'), crypto = require('crypto'), { Readable } = require('stream');
const { createLongMedia, _test } = require('../plugin/long-media.cjs');
const media = require('../plugin/media.cjs')._test;
const image = Buffer.from([255,216,255,224,0,6,12,255,217,13,255,218,0,2,10,255,0,11,255,208,12,255,217]);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function model() {
  const stored = new Map(), calls = [], state = { rendered: 0, aborts: 0, closes: 0, released: 0, unchanged: true, gate: null };
  const check = job => { if (job.signal?.aborted) throw Object.assign(Error('cancelled'), { code: 'MEDIA_CANCELLED' }); };
  const transaction = settings => {
    calls.push(settings);
    return {
      async readComplete() { if (state.gate) await state.gate; return stored.has(settings.sourceSha256) ? JSON.parse(JSON.stringify(stored.get(settings.sourceSha256))) : null; },
      async writeFrame(file, bytes) { assert.equal(file, '0.jpg'); assert(bytes.equals(image)); return { file, bytes: bytes.length, sha256: sha(bytes) }; },
      async finish(value, source) { assert.equal(source.filePath, 'model-source.mp4'); stored.set(settings.sourceSha256, value); return { ...value, cacheDir: 'model-cache', leaseId: 'b'.repeat(24) }; },
      async abort() { state.aborts++; }, async close() { state.closes++; }
    };
  };
  const cache = { begin: transaction, release: async () => { state.released++; },
    openBatch: async () => ({ beginSegment: transaction, close: async () => {}, snapshot: () => ({ usedBytes: 0 }) }) };
  const h = { ...media, check, regular: () => ({}), sourceStamp: () => ({}), sameStamp: () => state.unchanged,
    videoEnd: () => ({ timeBase: [1, 1], lastFrameEndTicks: '10' }), streamRatio: (stream, field) => ({ n: BigInt(stream[field] || '0'), d: 1n }),
    guarded: (_, promise) => promise, stopChildren() {}, settleJob: async () => {},
    childProcess(job, _tool, args) {
      check(job);
      if (args.includes('-show_packets')) return { child: { stdout: Readable.from([Buffer.from('pts=0|flags=K_\npts=2|flags=K_\npts=4|flags=K_\npts=6|flags=K_\npts=8|flags=K_\n')]), stderr: Readable.from([]) }, finish: Promise.resolve({ code: 0 }) };
      if (args.includes('aresample=48000,ashowinfo@bounds')) return { child: { stderr: Readable.from(['[ashowinfo@bounds] pts:479900 nb_samples:100\n']) }, finish: Promise.resolve({ code: 0 }) };
      state.rendered++; state.lastArgs = args;
      assert.equal(args[args.indexOf('-frames:v') + 1], '1'); assert.equal(args[args.indexOf('-c:v') + 1], 'mjpeg'); assert(!args.includes('pipe:3'));
      const start = args[args.indexOf('-vf') + 1].match(/trim=start=([\d.-]+)/)[1];
      return { child: { stdout: Readable.from([image]), stderr: Readable.from([`[showinfo@v] config in time_base: 1/1, frame_rate: 1/1\n[showinfo@v] n:0 pts:${Number(start)} pts_time:${start}\n`]) }, finish: Promise.resolve({ code: 0 }) };
    }
  };
  const long = createLongMedia({ cache, tools: { ffprobe: 'model', ffmpeg: 'model' }, helpers: h });
  const prepare = () => long.prepare({ filePath: 'model-source.mp4' }, { sha256: 'a'.repeat(64), stamp: {} },
    { streams: [{ codec_type: 'video', codec_name: 'h264', width: 16, height: 16 }, { codec_type: 'audio', channels: 1, start_pts: '0', duration_ts: '10' }] },
    { playbackBackend: 'proxy', previewQuality: '720p' });
  return { long, prepare, state, stored, calls };
}
async function main() {
  let count = 0;
  const test = async (name, fn) => { await fn(); count++; console.log('ok record still: ' + name); };
  await test('one accurate JPEG without PCM retains original source/PTS and normal preview identity', async () => {
    const h = model(), info = await h.prepare(), value = await h.long.still(info, 2);
    assert.equal(value.frames.length, 1); assert.equal(value.frames[0].ptsTicks, '4'); assert.equal(value.frames[0].time, 0);
    assert.equal(value.audio, null); assert(!value.videoEncoding); assert.equal(value.metrics.sourceSha256, info.source.sha256);
    assert.equal(info.videoEncoding.format, 'annexb-idr-v1'); assert(info.audio); assert.equal(value.preview.width, info.preview.width);
    assert.notEqual(value.source.sha256, info.source.sha256); assert.equal(h.state.rendered, 1); assert.equal(h.state.closes, 1); await h.long.release(info);
  });
  await test('completed still reopens through the existing atomic cache without re-encoding', async () => {
    const h = model(), info = await h.prepare(); const first = await h.long.still(info, 3); const second = await h.long.still(info, 3);
    assert.equal(h.state.rendered, 1); assert.equal(first.source.sha256, second.source.sha256); assert.equal(h.state.closes, 2); await h.long.release(info);
  });
  await test('derived keys isolate ordinal, profile and full proxy segments', async () => {
    const h = model(), info = await h.prepare(), first = _test.stillKey(info, 1, media.COLOR_VERSION);
    assert.notEqual(first, _test.stillKey(info, 2, media.COLOR_VERSION)); assert.notEqual(first, _test.segmentKey(info, info.segments[1], media.COLOR_VERSION));
    assert.notEqual(first, _test.stillKey({ ...info, source: { ...info.source, sha256: 'f'.repeat(64) } }, 1, media.COLOR_VERSION)); await h.long.release(info);
  });
  await test('existing-only miss does not launch a child and settles its transaction', async () => {
    const h = model(), info = await h.prepare(); assert.equal(await h.long.still(info, 2, { existingOnly: true }), null);
    assert.equal(h.state.rendered, 0); assert.equal(h.state.aborts, 1); assert.equal(h.state.closes, 1); await h.long.release(info);
  });
  await test('reused cache with mismatched original binding is refused and closed', async () => {
    const h = model(), info = await h.prepare(); await h.long.still(info, 2); const stored = h.stored.values().next().value;
    stored.metrics.sourceSha256 = 'c'.repeat(64); await assert.rejects(h.long.still(info, 2), e => e.code === 'MEDIA_PTS');
    assert.equal(h.state.aborts, 1); assert.equal(h.state.closes, 2); await h.long.release(info);
  });
  await test('source replacement, invalid ordinal and released source cannot produce an old annotation picture', async () => {
    const h = model(), info = await h.prepare(); await assert.rejects(h.long.still(info, -1)); h.state.unchanged = false;
    await assert.rejects(h.long.still(info, 2), e => e.code === 'MEDIA_SOURCE_CHANGED'); h.state.unchanged = true; await h.long.release(info);
    await assert.rejects(h.long.still(info, 2), e => e.code === 'MEDIA_CANCELLED'); assert.equal(h.state.rendered, 0);
  });
  console.log(`Record still media: ${count} memory-only models; no FFmpeg, filesystem writes or Eagle.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
