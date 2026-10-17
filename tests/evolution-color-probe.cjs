'use strict';
const assert = require('assert');
const { probe } = require('../prototypes/preview-quality/color-probe.cjs');

function pixels(width, height, color) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < out.length; at += 4) out.set(color, at);
  return out;
}
function fixture(width = 3, height = 3) {
  const calls = [], closed = [], state = { valid: true, captures: 0, ordinal: 0 };
  const options = { width, height, ordinals: [0, 1, 2, 1], formats: ['png', 'jpeg', 'jpeg-fine'],
    times: [{ time: 0 }, { time: .04 }, { time: .08 }], lastEnd: .12,
    valid: () => state.valid,
    reference: { async seek(time, end) { calls.push(['seek', time, end]); state.ordinal = Math.round(time / .04); return { sameFrame: true, actual: time, method: 'reused' }; } },
    captureReference() { state.captures++; calls.push(['capture', state.ordinal]); return pixels(width, height, [10, 20, 30, 11]); },
    async readFrame(format, ordinal) { calls.push(['read', format, ordinal]); return Buffer.from(format); },
    async decode(bytes, format) { assert.strictEqual(bytes.toString(), format); calls.push(['decode', format]); return { format, close() { closed.push(format); } }; },
    readBitmap(bitmap) { calls.push(['pixels', bitmap.format]); return pixels(width, height,
      bitmap.format === 'png' ? [11, 18, 33, 255] : bitmap.format === 'jpeg' ? [13, 17, 30, 0] : [11, 18, 32, 1]); }
  };
  return { options, calls, closed, state };
}
async function main() {
  let tests = 0;
  const test = async (name, run) => { await run(); tests++; };
  await test('one native capture per unique ordinal and JPEG against matching PNG', async () => {
    const h = fixture(), result = await probe(h.options);
    assert.deepStrictEqual(result.map(row => row.ordinal), [0, 1, 2]);
    assert.strictEqual(h.state.captures, 3); assert.strictEqual(h.closed.length, 9);
    assert.deepStrictEqual(h.calls.filter(call => call[0] === 'seek'), [['seek', 0, .04], ['seek', .04, .08], ['seek', .08, .12]]);
    for (const row of result) {
      const [png, jpeg, fine] = row.candidates;
      assert.strictEqual(row.sourceTime, row.actualSourceTime);
      assert.deepStrictEqual(row.candidates.map(candidate => candidate.format), h.options.formats);
      assert.strictEqual(png.vsNative.mae, 2); assert.strictEqual(png.vsNative.p95, 3); assert.strictEqual(png.vsNative.max, 3);
      assert.deepStrictEqual(png.vsNative.meanDelta, [1, -2, 3]);
      assert.strictEqual(png.vsPng.mae, 0); assert.strictEqual(png.vsPng.max, 0);
      assert.deepStrictEqual(jpeg.vsPng.meanDelta, [2, -1, -3]); assert.strictEqual(jpeg.vsPng.mae, 2);
      assert.strictEqual(fine.vsPng.mae, 1 / 3); assert.deepStrictEqual(fine.vsPng.meanDelta, [0, 0, -1]);
      assert(png.vsNative.blocks.every(block => block.pixels === 1 && JSON.stringify(block.meanDelta) === '[1,-2,3]'));
    }
    const serialized = JSON.stringify(result); assert(!serialized.includes('Uint8ClampedArray')); assert(!serialized.includes('"data"'));
  });
  await test('alpha skipped and nearest-rank p95 is not max', async () => {
    const h = fixture(20, 1); h.options.ordinals = [0]; h.options.formats = ['png', 'jpeg'];
    h.options.captureReference = () => pixels(20, 1, [0, 0, 0, 0]);
    h.options.readBitmap = bitmap => { const out = pixels(20, 1, [0, 0, 0, 255]); if (bitmap.format === 'jpeg') for (let i = 0; i < 3; i++) out[i * 4] = 9; return out; };
    const [row] = await probe(h.options), stats = row.candidates[1].vsPng;
    assert.strictEqual(stats.mae, 27 / 60); assert.strictEqual(stats.max, 9); assert.strictEqual(stats.p95, 0);
    assert.deepStrictEqual(stats.meanDelta, [27 / 20, 0, 0]);
    assert(stats.blocks.some(block => block.pixels === 0 && block.meanDelta === null));
  });
  await test('expired before start reads nothing', async () => {
    const h = fixture(); h.state.valid = false;
    assert.deepStrictEqual(await probe(h.options), { cancelled: true, results: [] }); assert.strictEqual(h.calls.length, 0);
  });
  await test('cancelled reference reads nothing', async () => {
    const h = fixture(); h.options.reference.seek = async () => ({ cancelled: true });
    assert.deepStrictEqual(await probe(h.options), { cancelled: true, results: [] }); assert.strictEqual(h.state.captures, 0);
  });
  await test('expired frame read prevents decode', async () => {
    const h = fixture(); h.options.readFrame = async () => { h.state.valid = false; return Buffer.from('png'); };
    assert.deepStrictEqual(await probe(h.options), { cancelled: true, results: [] });
    assert(!h.calls.some(call => call[0] === 'decode'));
  });
  await test('late decoded bitmap closes and discards prior complete ordinal', async () => {
    const h = fixture(), original = h.options.decode;
    h.options.decode = async (bytes, format) => { const bitmap = await original(bytes, format); if (h.state.ordinal === 1) h.state.valid = false; return bitmap; };
    assert.deepStrictEqual(await probe(h.options), { cancelled: true, results: [] });
    assert.deepStrictEqual(h.closed, ['png', 'jpeg', 'jpeg-fine', 'png']);
    assert.strictEqual(h.calls.filter(call => call[0] === 'pixels').length, 3);
    assert.strictEqual(h.calls.filter(call => call[0] === 'read').length, 4);
  });
  await test('readBitmap failure closes the decoded bitmap', async () => {
    const h = fixture(), original = h.options.readBitmap;
    h.options.readBitmap = bitmap => { if (bitmap.format === 'jpeg') throw Error('fixture pixel read failed'); return original(bitmap); };
    await assert.rejects(() => probe(h.options), /fixture pixel read failed/); assert.deepStrictEqual(h.closed, ['png', 'jpeg']);
  });
  await test('invalid RGBA closes the decoded bitmap', async () => {
    const h = fixture(); h.options.readBitmap = () => new Uint8ClampedArray(4);
    await assert.rejects(() => probe(h.options), /RGBA/); assert.deepStrictEqual(h.closed, ['png']);
  });
  await test('expired synchronous read and rejection are cancellation', async () => {
    const h = fixture(), original = h.options.readBitmap;
    h.options.readBitmap = bitmap => { h.state.valid = false; return original(bitmap); };
    assert.deepStrictEqual(await probe(h.options), { cancelled: true, results: [] }); assert.deepStrictEqual(h.closed, ['png']);
    const other = fixture(); other.options.reference.seek = async () => { other.state.valid = false; throw Error('fixture disposed'); };
    assert.deepStrictEqual(await probe(other.options), { cancelled: true, results: [] });
  });
  await test('invalidation during final bitmap close discards all results', async () => {
    const h = fixture(), original = h.options.decode;
    h.options.decode = async (bytes, format) => {
      const bitmap = await original(bytes, format), close = bitmap.close;
      bitmap.close = () => { close(); if (h.state.ordinal === 2 && format === 'jpeg-fine') h.state.valid = false; };
      return bitmap;
    };
    assert.deepStrictEqual(await probe(h.options), { cancelled: true, results: [] }); assert.strictEqual(h.closed.length, 9);
  });
  await test('misaligned native result cannot produce metrics', async () => {
    for (const result of [{ sameFrame: false, actual: 0 }, { sameFrame: true, actual: .04 }, { sameFrame: true, actual: NaN }]) {
      const h = fixture(); h.options.reference.seek = async () => result;
      await assert.rejects(() => probe(h.options), /准确对齐/); assert.strictEqual(h.state.captures, 0);
    }
  });
  await test('strict dimensions formats ordinals time and RGBA types', async () => {
    for (const change of [
      { width: 0 }, { width: 1.5 }, { width: 1921 }, { height: 1081 }, { height: NaN },
      { formats: ['jpeg', 'png'] }, { formats: ['png', 'webp'] }, { formats: ['png', 'png'] }, { formats: [] }, { formats: ['png', , 'jpeg'] },
      { ordinals: [] }, { ordinals: [-1] }, { ordinals: [3] }, { ordinals: [0.5] }, { ordinals: new Array(1) },
      { times: [{ time: 0 }, { time: 0 }] }, { times: [{ time: Infinity }] }, { times: [{ time: 0 }, , { time: .08 }] }, { lastEnd: .08 }, { readBitmap: null }
    ]) { const h = fixture(); Object.assign(h.options, change); await assert.rejects(() => probe(h.options)); assert.strictEqual(h.calls.length, 0); }
    const h = fixture(); h.options.times.push({ time: .1 }); h.options.ordinals = [0, 1, 2, 3];
    await assert.rejects(() => probe(h.options), /最多/);
    const type = fixture(); type.options.captureReference = () => new Uint8Array(3 * 3 * 4);
    await assert.rejects(() => probe(type.options), /RGBA/);
    const buffer = fixture(); buffer.options.readFrame = async () => new Uint8Array(1);
    await assert.rejects(() => probe(buffer.options), /图片/); assert.strictEqual(buffer.closed.length, 0);
  });
  console.log('color probe: ' + tests + ' pure RGBA models passed; same-frame reuse, PNG/JPEG deltas, bounds, cancellation and bitmap release; no media or evidence writes');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
