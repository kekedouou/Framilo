'use strict';

// Framing and basic header checks for our all-IDR, repeat-headers, AUD stream.
// This is not an H.264 bitstream decoder: slice/RBSP completeness is still
// checked by VideoDecoder before a picture is accepted by the player.
const MAX_ACCESS_UNIT_BYTES = 8 * 1024 ** 2;
const BOUNDARY_BYTES = 5; // Four-byte start code plus the next AUD header.
const EMPTY = Buffer.alloc(0);
const START_CODE = Buffer.from([0, 0, 1]);
function invalid(message, code = 'AVC_ACCESS_UNIT_INVALID') {
  throw Object.assign(new Error(message), { code });
}
function startCode(bytes, from) {
  // Native buffer search avoids a JS iteration over every encoded byte.
  // A four-byte prefix is the same match preceded by one zero within range.
  const at = bytes.indexOf(START_CODE, from);
  return at < 0 ? null : { start: at > from && bytes[at - 1] === 0 ? at - 1 : at, header: at + 3 };
}
function state() { return { aud: false, sps: false, pps: false, idr: false, codec: null }; }

class AccessUnitParser {
  constructor() {
    this.buffer = EMPTY;
    this.searchFrom = 0;
    this.nal = null;
    this.unit = state();
    this.ended = false;
    this.awaitingHeader = false;
    this.failure = null;
  }
  get pendingBytes() { return this.buffer.length; }
  _finishNal(end) {
    if (!this.nal) return;
    const { header, type } = this.nal;
    // Annex-B trailing_zero_8bits are outside RBSP. Do not mistake these for
    // truncated start codes when the stream ends with permitted zero padding.
    while (end > header + 1 && this.buffer[end - 1] === 0) end--;
    const length = end - header;
    if (length < 2) invalid('代理帧的NAL头或数据不完整。');
    if (type === 9) {
      if (this.unit.aud) invalid('代理帧包含重复分隔头。');
      this.unit.aud = true;
    } else if (type === 7) {
      if (length < 5) invalid('代理帧的SPS参数头不完整。');
      if (this.unit.idr) invalid('代理帧的SPS不在画面数据之前。');
      const codec = 'avc1.' + this.buffer.subarray(header + 1, header + 4).toString('hex');
      if (this.unit.codec && this.unit.codec !== codec) invalid('同一代理帧的SPS编码配置不一致。');
      this.unit.sps = true; this.unit.codec = codec;
    } else if (type === 8) {
      if (length < 3 || !this.unit.sps || this.unit.idr) invalid('代理帧的PPS参数头不完整或顺序无效。');
      this.unit.pps = true;
    } else if (type === 5) {
      if (!this.unit.sps || !this.unit.pps) invalid('代理帧缺少独立解码所需的SPS/PPS。');
      this.unit.idr = true;
    }
  }
  _emit(end, output) {
    if (!(end > 0 && end <= MAX_ACCESS_UNIT_BYTES)) invalid('代理单帧超过8MiB读取上限。', 'AVC_ACCESS_UNIT_LIMIT');
    if (!this.unit.aud || !this.unit.sps || !this.unit.pps || !this.unit.idr)
      invalid('代理帧缺少AUD、SPS、PPS或IDR画面数据。');
    // Independent storage prevents a tiny pending tail from pinning a previous
    // large packet or a caller-owned, subsequently mutated input chunk.
    output.push({ bytes: Buffer.from(this.buffer.subarray(0, end)), codec: this.unit.codec });
  }
  _scan(output) {
    for (;;) {
      const next = startCode(this.buffer, this.searchFrom);
      if (!next) { this.searchFrom = Math.max(this.searchFrom, this.buffer.length - 3); return; }
      if (next.header >= this.buffer.length) {
        this.searchFrom = next.start; this.awaitingHeader = true; return;
      }
      this.awaitingHeader = false;
      const byte = this.buffer[next.header], type = byte & 31;
      if (byte & 128 || ![5, 6, 7, 8, 9, 10, 11, 12].includes(type))
        invalid('代理流包含非IDR画面或不支持的NAL类型。');
      if (type === 9 && byte & 96 || [5, 7, 8].includes(type) && !(byte & 96))
        invalid('代理NAL引用头无效。');
      if (!this.nal) {
        if (type !== 9 || this.buffer.subarray(0, next.start).some(value => value !== 0))
          invalid('代理流必须从AUD开始，分隔头前仅允许零填充。');
      } else {
        this._finishNal(next.start);
        if (type === 9) {
          this._emit(next.start, output);
          this.buffer = Buffer.from(this.buffer.subarray(next.start));
          next.header -= next.start; next.start = 0;
          this.unit = state();
        }
      }
      this.nal = { header: next.header, type };
      this.searchFrom = next.header + 1;
    }
  }
  push(chunk) {
    if (this.failure) throw this.failure;
    if (this.ended) invalid('代理解析器已经结束。');
    if (!Buffer.isBuffer(chunk)) invalid('代理解析器只接受Buffer。');
    const output = [];
    try {
      for (let at = 0; at < chunk.length;) {
        const free = MAX_ACCESS_UNIT_BYTES + BOUNDARY_BYTES - this.buffer.length;
        if (free <= 0) invalid('代理单帧超过8MiB读取上限。', 'AVC_ACCESS_UNIT_LIMIT');
        const count = Math.min(free, chunk.length - at);
        this.buffer = Buffer.concat([this.buffer, chunk.subarray(at, at + count)]);
        at += count; this._scan(output);
      }
      return output;
    } catch (error) { this.failure = error; throw error; }
  }
  end() {
    if (this.failure) throw this.failure;
    if (this.ended) invalid('代理解析器已经结束。');
    this.ended = true;
    const output = [];
    try {
      if (!this.buffer.length) return output;
      this._scan(output);
      if (!this.nal || this.awaitingHeader) invalid('代理流在分隔头或NAL头处截断。');
      this._finishNal(this.buffer.length); this._emit(this.buffer.length, output);
      this.buffer = EMPTY; this.nal = null; this.unit = state();
      return output;
    } catch (error) { this.failure = error; throw error; }
  }
}

module.exports = { AccessUnitParser, MAX_ACCESS_UNIT_BYTES };
