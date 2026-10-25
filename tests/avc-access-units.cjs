'use strict';
const assert = require('assert');
const { AccessUnitParser, MAX_ACCESS_UNIT_BYTES } = require('../plugin/avc-access-units.cjs');
const nal = (bytes, four = true) => Buffer.from([0, 0, ...(four ? [0] : []), 1, ...bytes]);
const aud = nal([9, 16]), sps = nal([103, 66, 192, 31, 128], false);
const pps = nal([104, 206, 60, 128]), idr = nal([101, 136, 132], false);
const packet = Buffer.concat([aud, sps, pps, idr]);
const parse = chunks => {
  const parser = new AccessUnitParser(), output = [];
  for (const chunk of chunks) { output.push(...parser.push(chunk)); assert(parser.pendingBytes <= MAX_ACCESS_UNIT_BYTES + 5); }
  output.push(...parser.end()); assert.equal(parser.pendingBytes, 0); return output;
};
const stream = Buffer.concat([Buffer.alloc(2), packet, packet, Buffer.alloc(3)]);
for (let size = 1; size <= stream.length; size++) {
  const chunks = []; for (let at = 0; at < stream.length; at += size) chunks.push(stream.subarray(at, at + size));
  const output = parse(chunks); assert.equal(output.length, 2);
  assert(output[0].bytes.equals(Buffer.concat([Buffer.alloc(2), packet])));
  assert(output[1].bytes.equals(Buffer.concat([packet, Buffer.alloc(3)])));
  assert(output.every(unit => unit.codec === 'avc1.42c01f'));
}
// Check every possible split, including three/four-byte start codes and headers.
for (let at = 0; at <= stream.length; at++) assert.equal(parse([stream.subarray(0, at), stream.subarray(at)]).length, 2);
assert.equal(parse([Buffer.concat([aud, sps, pps, idr, idr])])[0].bytes.length, packet.length + idr.length, 'one picture may have multiple IDR slices');
assert.equal(parse([Buffer.concat([aud, sps, pps, nal([6, 128]), idr])]).length, 1, 'SEI is permitted before the picture');
assert.equal(parse([]).length, 0);
function rejects(bytes, code = 'AVC_ACCESS_UNIT_INVALID') {
  assert.throws(() => parse([bytes]), error => error.code === code);
}
rejects(Buffer.concat([Buffer.from([7]), packet]));
rejects(Buffer.concat([sps, pps, idr]));
rejects(Buffer.concat([aud, pps, idr]));
rejects(Buffer.concat([aud, sps, idr]));
rejects(Buffer.concat([aud, sps, pps]));
rejects(Buffer.concat([aud, sps, pps, nal([65, 136, 132])])); // non-IDR VCL
rejects(Buffer.concat([aud, sps, pps, nal([229, 136, 132])])); // forbidden_zero_bit
rejects(Buffer.concat([aud, sps, pps, nal([5, 136, 132])])); // IDR requires nal_ref_idc
rejects(Buffer.concat([aud, nal([103, 66, 192, 31]), pps, idr]));
rejects(Buffer.concat([aud, sps, nal([104, 128]), idr]));
rejects(Buffer.concat([aud, sps, pps, nal([101])]));
rejects(Buffer.concat([packet, Buffer.from([0, 0, 1])]));
rejects(Buffer.concat([packet, Buffer.from([0, 0, 0, 1])]));
rejects(Buffer.concat([packet, aud]));
rejects(Buffer.alloc(4));
// Exact-size packets must still accept a following AUD across the cap boundary.
const largePrefix = Buffer.concat([aud, sps, pps, nal([101, 136])]);
const large = Buffer.concat([largePrefix, Buffer.alloc(MAX_ACCESS_UNIT_BYTES - largePrefix.length, 85)]);
assert.equal(large.length, MAX_ACCESS_UNIT_BYTES);
assert.deepEqual(parse([Buffer.concat([large, packet])]).map(unit => unit.bytes.length), [MAX_ACCESS_UNIT_BYTES, packet.length]);
rejects(Buffer.concat([large, Buffer.from([85])]), 'AVC_ACCESS_UNIT_LIMIT');
rejects(Buffer.concat([large, Buffer.from([85]), packet]), 'AVC_ACCESS_UNIT_LIMIT');
{
  const parser = new AccessUnitParser(), bad = Buffer.concat([aud, sps, pps, nal([65, 136, 132]), aud]);
  assert.throws(() => parser.push(bad), /非IDR/); assert.throws(() => parser.push(packet), /非IDR/);
}
{
  const parser = new AccessUnitParser(), input = Buffer.concat([packet, packet]);
  const ready = parser.push(input); const first = Buffer.from(ready[0].bytes); input.fill(0);
  assert(ready[0].bytes.equals(first)); assert.equal(parser.end().length, 1);
  assert.throws(() => parser.push(packet), /已经结束/);
}
console.log('AVC access units: split start codes, independent IDR headers, malformed/truncated data, size bound and stable output storage passed (framing models; no H.264 pixel decoding).');
