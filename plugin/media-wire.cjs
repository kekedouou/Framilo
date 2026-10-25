'use strict';

// Compact control-message representation only. No file/host access, no source
// FPS inference, and no replacement of the caller's lease/source objects.
const crypto = require('crypto');
const frameIndex = require('./frame-index.cjs');
const VERSION = 'eva-stream-frames-v1';
const LIMITS = Object.freeze({ frames: 120000, bytes: 6 * 1024 ** 2, ptsChars: 24, assetBytes: 8 * 1024 ** 2 });
const dangerous = new Set(['__proto__', 'prototype', 'constructor']);
const frameFields = new Set(['id', 'file', 'bytes', 'ptsTicks', 'timeBase', 'time', 'end']);
const wireFields = new Set(['version', 'count', 'pts', 'timeBase', 'lastFrameEndTicks', 'endTimeBase', 'suffix', 'bytes']);
const fail = (message, code = 'MEDIA_WIRE_INVALID') => { throw Object.assign(new Error(message), { code }); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail((label || '控制数据') + '必须是普通对象。');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const d = descriptors[key];
    if (typeof key !== 'string' || dangerous.has(key) || !own(d, 'value') || !d.enumerable)
      fail('控制数据包含原型、访问器或非JSON字段。');
  }
  return descriptors;
}
function tree(value, depth = 0, active = new Set(), visited = new Set(), counter = { nodes: 0 }) {
  if (++counter.nodes > 600000 || depth > 24) fail('控制数据结构超过资源限制。', 'MEDIA_WIRE_LIMIT');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('控制数据含非有限数字。'); return; }
  if (typeof value === 'undefined') return; // Existing JSON messages omit optional undefined properties.
  if (!value || typeof value !== 'object') fail('控制数据包含不可传输的值。');
  if (active.has(value)) fail('控制数据存在循环引用。');
  if (visited.has(value)) return;
  active.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > LIMITS.frames) fail('控制数组超过限制或原型无效。', 'MEDIA_WIRE_LIMIT');
    const keys = Reflect.ownKeys(value);
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length || !own(d, 'value'))
        fail('控制数组含额外字段或访问器。');
      tree(d.value, depth + 1, active, visited, counter);
    }
  } else {
    const descriptors = object(value);
    for (const key of Object.keys(descriptors)) tree(descriptors[key].value, depth + 1, active, visited, counter);
  }
  active.delete(value); visited.add(value);
}
function encode(value) {
  tree(value);
  let text;
  try { text = JSON.stringify(value); } catch (_) { fail('控制数据不能编码为JSON。'); }
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.bytes) fail('长视频控制消息超过6MiB限制。', 'MEDIA_WIRE_LIMIT');
  return text;
}
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
function integer(value, label) {
  if (typeof value !== 'string' || value.length > LIMITS.ptsChars || !/^-?(?:0|[1-9]\d*)$/.test(value) || value === '-0')
    fail((label || 'PTS') + '必须是最多24字符的规范十进制整数。');
  return BigInt(value);
}
function base(value) {
  if (!Array.isArray(value) || value.length !== 2) fail('源时间基准无效。');
  tree(value);
  if (value.some(n => !Number.isSafeInteger(n) || n <= 0)) fail('源时间基准无效。');
  return value;
}
function sameBase(a, b) { base(a); base(b); return a[0] === b[0] && a[1] === b[1]; }
function header(info) {
  object(info);
  if (own(info, 'frameWire') || own(info, 'wireDigest')) fail('不能重复压缩或混合长视频控制格式。');
  if (!Array.isArray(info.frames) || !info.frames.length || info.frames.length > LIMITS.frames)
    fail('源帧数量不在本版120000帧范围内。', 'MEDIA_WIRE_LIMIT');
  if (Object.getPrototypeOf(info.frames) !== Array.prototype || Reflect.ownKeys(info.frames).some(key => key !== 'length' &&
      (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= info.frames.length ||
        !own(Object.getOwnPropertyDescriptor(info.frames, key), 'value')))) fail('源帧数组含额外字段、原型或访问器。');
  integer(info.lastFrameEndTicks, '显式末帧结束时间');
  object(info.source, '素材身份');
  if (!info.source || typeof info.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(info.source.sha256) ||
      typeof info.leaseId !== 'string' || !info.leaseId) fail('长视频控制数据缺少原素材或租约身份。');
}
function packInfo(info) {
  if (info === null || typeof info !== 'object') return info;
  const descriptors = object(info);
  if (!descriptors.streaming || !descriptors.streaming.value) return info;
  header(info);
  const first = info.frames[0]; object(first, '源帧');
  const timeBase = base(first.timeBase).slice(), endTimeBase = base(info.endTimeBase === undefined ? timeBase : info.endTimeBase).slice();
  const name = /^frame-0\.(jpg|avc)$/.exec(first.file || '');
  if (!name || !Number.isSafeInteger(first.bytes) || first.bytes < 1 || first.bytes > LIMITS.assetBytes)
    fail('长视频必须使用有界的统一虚拟帧资源。');
  const suffix = name[1], pts = []; let previous = null;
  for (let i = 0; i < info.frames.length; i++) {
    const frame = info.frames[i], fields = object(frame, '源帧');
    if (Object.keys(fields).some(key => !frameFields.has(key))) fail('源帧含不能无损压缩的额外字段。');
    if (frame.id !== i || frame.file !== `frame-${i}.${suffix}` || frame.bytes !== first.bytes || !sameBase(frame.timeBase, timeBase))
      fail('源帧编号、资源或共同时间基准不一致，未丢弃数据。');
    const ticks = integer(frame.ptsTicks);
    if (previous !== null && ticks <= previous) fail('长视频源PTS重复或倒退，不能猜测呈现顺序。');
    previous = ticks; pts.push(frame.ptsTicks);
  }
  try { frameIndex.validateIndex(info); } catch (error) { fail('源帧索引无效：' + error.message); }
  // Explicit integer boundaries are supplied by the source probe. Never infer
  // the ending timestamp by multiplying a floating-point frame.end by FPS.
  const rebuilt = frameIndex.buildIndex(pts.map((ptsTicks, id) => ({ id, ptsTicks, file: `frame-${id}.${suffix}`, bytes: first.bytes })),
    { timeBase, lastFrameEndTicks: info.lastFrameEndTicks, endTimeBase });
  if (rebuilt.frames[rebuilt.frames.length - 1].end !== info.frames[info.frames.length - 1].end)
    fail('显式整数结束时间与已有源帧索引不符。');
  const packed = {};
  for (const key of Object.keys(descriptors)) if (key !== 'frames') packed[key] = descriptors[key].value;
  packed.frameWire = { version: VERSION, count: pts.length, pts, timeBase, lastFrameEndTicks: info.lastFrameEndTicks,
    endTimeBase, suffix, bytes: first.bytes };
  const text = encode(packed); packed.wireDigest = digest(text); encode(packed); return packed;
}
function unpackInfo(value) {
  if (value === null || typeof value !== 'object') return value;
  const descriptors = object(value);
  if (!descriptors.streaming || !descriptors.streaming.value) {
    if (own(value, 'frameWire') || own(value, 'wireDigest')) fail('非长视频消息不能携带分段帧控制格式。');
    return value;
  }
  if (own(value, 'frames') || !own(value, 'frameWire') || !own(value, 'wireDigest')) fail('长视频压缩控制格式缺失或混合。');
  const wire = value.frameWire, fields = object(wire, '帧控制格式');
  if (Object.keys(fields).length !== wireFields.size || Object.keys(fields).some(key => !wireFields.has(key)) || wire.version !== VERSION)
    fail('长视频控制版本或字段不受支持。');
  if (!Number.isSafeInteger(wire.count) || wire.count < 1 || wire.count > LIMITS.frames || !Array.isArray(wire.pts) || wire.pts.length !== wire.count)
    fail('压缩源帧数量不符或超过120000帧。', 'MEDIA_WIRE_LIMIT');
  base(wire.timeBase); base(wire.endTimeBase); integer(wire.lastFrameEndTicks, '显式末帧结束时间');
  if (!['jpg', 'avc'].includes(wire.suffix) || !Number.isSafeInteger(wire.bytes) || wire.bytes < 1 || wire.bytes > LIMITS.assetBytes)
    fail('压缩帧资源类型或容量无效。');
  if (value.lastFrameEndTicks !== wire.lastFrameEndTicks || value.endTimeBase !== undefined && !sameBase(value.endTimeBase, wire.endTimeBase))
    fail('消息中的显式源结束时间不一致。');
  object(value.source, '素材身份');
  if (!value.source || typeof value.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.source.sha256) ||
      typeof value.leaseId !== 'string' || !value.leaseId) fail('长视频控制数据缺少原素材或租约身份。');
  encode(value);
  const metadata = {};
  for (const key of Object.keys(descriptors)) if (key !== 'wireDigest') metadata[key] = descriptors[key].value;
  if (typeof value.wireDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.wireDigest) || digest(encode(metadata)) !== value.wireDigest)
    fail('长视频控制数据完整性摘要不符。');
  let previous = null;
  const rows = wire.pts.map((ptsTicks, id) => {
    const ticks = integer(ptsTicks);
    if (previous !== null && ticks <= previous) fail('长视频源PTS重复或倒退，不能猜测呈现顺序。');
    previous = ticks; return { id, ptsTicks, file: `frame-${id}.${wire.suffix}`, bytes: wire.bytes };
  });
  let indexed;
  try { indexed = frameIndex.buildIndex(rows, { timeBase: wire.timeBase, lastFrameEndTicks: wire.lastFrameEndTicks, endTimeBase: wire.endTimeBase }); }
  catch (error) { fail('压缩源帧索引无法重建：' + error.message); }
  const info = {};
  for (const key of Object.keys(descriptors)) if (key !== 'frameWire' && key !== 'wireDigest') info[key] = descriptors[key].value;
  info.frames = indexed.frames;
  try { frameIndex.validateIndex(info); } catch (error) { fail('重建的源帧索引无效：' + error.message); }
  return info;
}
module.exports = { packInfo, unpackInfo, VERSION, LIMITS };
