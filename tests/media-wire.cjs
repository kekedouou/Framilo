'use strict';
const assert = require('assert'), crypto = require('crypto');
const { packInfo, unpackInfo, VERSION, LIMITS } = require('../plugin/media-wire.cjs');
const { buildIndex } = require('../plugin/frame-index.cjs');
function media({ pts = ['0', '1', '3'], timeBase = [1, 24], end = '5', endTimeBase = timeBase, suffix = 'jpg' } = {}) {
  const indexed = buildIndex(pts.map((ptsTicks, id) => ({ id, ptsTicks, file: `frame-${id}.${suffix}`, bytes: 8 * 1024 ** 2 })),
    { timeBase, lastFrameEndTicks: end, endTimeBase });
  return { streaming: 'segments-v1', source: { sha256: 'a'.repeat(64), filePath: 'synthetic-only.mp4' }, leaseId: 'b'.repeat(24),
    width: 1280, height: 720, duration: indexed.videoDuration, frames: indexed.frames, lastFrameEndTicks: end, endTimeBase,
    segments: [{ first: 0, last: pts.length - 1, start: 0, end: indexed.videoDuration }], audio: null };
}
const clone = value => JSON.parse(JSON.stringify(value));
function resigned(value) { delete value.wireDigest; value.wireDigest = crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); return value; }
function reject(action) { assert.throws(action, error => /^MEDIA_WIRE_/.test(error.code || '')); }
function main() {
  const legacy = { frames: [], width: 1 }; assert.strictEqual(packInfo(legacy), legacy); assert.strictEqual(unpackInfo(legacy), legacy);
  for (const value of [null, undefined, 0]) { assert.strictEqual(packInfo(value), value); assert.strictEqual(unpackInfo(value), value); }
  for (const config of [
    {}, { pts: ['-10', '-7', '0'], end: '9' }, { pts: ['90000', '90007', '90029'], timeBase: [1, 90000], end: '90061', suffix: 'avc' },
    { pts: ['1000', '1100', '1300'], timeBase: [1, 1000], end: '144000', endTimeBase: [1, 48000] }
  ]) {
    const info = media(config), packed = packInfo(info), decoded = unpackInfo(clone(packed));
    assert(!Object.hasOwn(packed, 'frames')); assert.equal(packed.frameWire.version, VERSION);
    assert.strictEqual(packed.source, info.source); assert.strictEqual(packed.segments, info.segments);
    const sameRealm = unpackInfo(packed); assert.strictEqual(sameRealm.source, packed.source); assert.strictEqual(sameRealm.segments, packed.segments);
    assert.deepStrictEqual(decoded, info); assert.equal(decoded.source.sha256, info.source.sha256); assert.equal(decoded.leaseId, info.leaseId);
  }
  {
    const count = 108000, origin = 45000n;
    const info = media({ pts: Array.from({ length: count }, (_, i) => String(origin + BigInt(i) * 1500n)), timeBase: [1, 90000],
      end: String(origin + BigInt(count) * 1500n), suffix: 'avc' });
    const packed = packInfo(info), bytes = Buffer.byteLength(JSON.stringify(packed)); assert(bytes < LIMITS.bytes);
    const decoded = unpackInfo(clone(packed)); assert.equal(decoded.frames.length, count); assert.equal(decoded.duration, 1800);
    assert.deepStrictEqual(decoded.frames, info.frames);
    for (const i of [0, 1, 23999, 24000, 60000, count - 1]) assert.deepStrictEqual(decoded.frames[i], info.frames[i]);
    console.log('media wire: 108000 frames / 30min60fps lossless integer index in ' + bytes + ' control bytes');
  }
  const valid = packInfo(media());
  for (const change of [
    v => { v.frameWire.version = 'unknown'; }, v => { v.frames = []; }, v => { delete v.frameWire.pts; },
    v => { v.frameWire.suffix = '../avc'; }, v => { v.frameWire.bytes = 0; }, v => { v.frameWire.count--; },
    v => { v.source.sha256 = 'c'.repeat(64); }, v => { v.leaseId = 'changed'; }, v => { v.width = 8; },
    v => { v.frameWire.timeBase[1] = 60; }, v => { v.frameWire.pts[1] = '2'; },
    v => { v.frameWire.extra = 1; }, v => { v.lastFrameEndTicks = '10'; }
  ]) { const v = clone(valid); change(v); reject(() => unpackInfo(v)); }
  for (const change of [
    v => { v.frameWire.pts[1] = v.frameWire.pts[0]; }, v => { v.frameWire.pts[1] = '-1'; },
    v => { v.frameWire.pts[0] = '1'.repeat(25); }, v => { v.frameWire.pts[0] = '01'; },
    v => { v.frameWire.timeBase = [1, 0]; }, v => { v.frameWire.endTimeBase = [0, 1]; },
    v => { v.duration = .001; }, v => { v.audio = { file: 'audio.wav', bytes: 1, start: 0, duration: 100, sampleRate: 48000, channels: 2 }; }
  ]) { const v = clone(valid); change(v); reject(() => unpackInfo(resigned(v))); }
  for (const change of [
    v => { v.frames[1].id = 3; }, v => { v.frames[1].file = 'frame-0.jpg'; }, v => { v.frames[1].bytes = 16; },
    v => { v.frames[1].timeBase = [1, 48]; }, v => { v.frames[1].extra = 'lost data'; },
    v => { delete v.lastFrameEndTicks; }, v => { v.lastFrameEndTicks = '6'; }, v => { v.endTimeBase = null; }, v => { v.frames = Array(LIMITS.frames + 1); },
    v => { v.source.padding = 'x'.repeat(LIMITS.bytes); }
  ]) { const v = media(); change(v); reject(() => packInfo(v)); }
  for (const malicious of [
    JSON.parse('{"streaming":"segments-v1","__proto__":{"polluted":true}}'),
    Object.assign(Object.create({ polluted: true }), clone(valid)),
    { ...clone(valid), source: JSON.parse('{"sha256":"' + 'a'.repeat(64) + '","constructor":{"prototype":{"polluted":true}}}') }
  ]) reject(() => unpackInfo(malicious));
  {
    const value = clone(valid); Object.defineProperty(value.frameWire, 'pts', { enumerable: true, get() { throw Error('getter must not execute'); } });
    reject(() => unpackInfo(value)); assert.equal({}.polluted, undefined);
  }
  {
    const value = media(); Object.defineProperty(value.source, 'sha256', { enumerable: true, get() { throw Error('getter must not execute'); } });
    reject(() => packInfo(value));
  }
  {
    const value = clone(valid); value.source.padding = 'x'.repeat(LIMITS.bytes); reject(() => unpackInfo(resigned(value)));
  }
  {
    const value = clone(valid); value.frameWire.pts = Array(LIMITS.frames + 1).fill('0'); value.frameWire.count = value.frameWire.pts.length;
    reject(() => unpackInfo(value));
  }
  console.log('Media wire: exact VFR/nonzero/negative PTS, identity retention, version/digest/shape guards, limits and prototype rejection passed.');
}
main();
