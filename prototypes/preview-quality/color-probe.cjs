'use strict';
// Isolated numeric comparison. Callers own all media, canvases and persistence.
const FORMATS = Object.freeze(['png', 'jpeg', 'jpeg-fine']);
const MAX_WIDTH = 1920, MAX_HEIGHT = 1080, MIB = 1024 ** 2;
const cancelled = () => ({ cancelled: true, results: [] });

function validate(options) {
  if (!options || typeof options !== 'object') throw Error('颜色核对参数不完整');
  const { width, height } = options;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > MAX_WIDTH || height > MAX_HEIGHT)
    throw Error('颜色核对尺寸须在1920×1080以内');
  for (const name of ['captureReference', 'readFrame', 'decode', 'readBitmap', 'valid'])
    if (typeof options[name] !== 'function') throw Error('颜色核对缺少回调：' + name);
  if (!options.reference || typeof options.reference.seek !== 'function') throw Error('颜色核对缺少同帧参考');
  if (!Array.isArray(options.formats) || !options.formats.length || options.formats[0] !== 'png' ||
      Array.from(options.formats).some(format => !FORMATS.includes(format)) || new Set(options.formats).size !== options.formats.length)
    throw Error('颜色候选必须以PNG开始，且仅含不重复的png/jpeg/jpeg-fine');
  if (!Array.isArray(options.times) || !options.times.length || Array.from(options.times).some((entry, i, entries) =>
    !entry || !Number.isFinite(entry.time) || (i > 0 && entry.time <= entries[i - 1].time)))
    throw Error('颜色核对源时间必须有限且严格递增');
  if (!Number.isFinite(options.lastEnd) || options.lastEnd <= options.times[options.times.length - 1].time)
    throw Error('颜色核对末帧结束时间无效');
  if (!Array.isArray(options.ordinals) || !options.ordinals.length || Array.from(options.ordinals).some(ordinal =>
    !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= options.times.length))
    throw Error('颜色核对帧编号无效');
  const ordinals = [...new Set(options.ordinals)];
  if (ordinals.length > 3) throw Error('颜色核对最多选择三个不同源帧');
  return { width, height, ordinals, formats: options.formats.slice(), times: options.times.map(entry => entry.time), lastEnd: options.lastEnd };
}

function rgba(value, length) {
  // ImageData can originate in a different renderer realm.
  if (!ArrayBuffer.isView(value) || Object.prototype.toString.call(value) !== '[object Uint8ClampedArray]' || value.length !== length)
    throw Error('颜色核对RGBA类型或长度与尺寸不符');
  return value;
}

function statistics(reference, candidate, width, height) {
  const histogram = new Uint32Array(256), delta = [0, 0, 0];
  const blocks = Array.from({ length: 9 }, (_, i) => ({ column: i % 3, row: Math.floor(i / 3), pixels: 0, meanDelta: [0, 0, 0] }));
  let sum = 0, max = 0;
  for (let y = 0, at = 0; y < height; y++) for (let x = 0; x < width; x++, at += 4) {
    const block = blocks[Math.floor(y * 3 / height) * 3 + Math.floor(x * 3 / width)]; block.pixels++;
    for (let channel = 0; channel < 3; channel++) {
      const difference = candidate[at + channel] - reference[at + channel], absolute = Math.abs(difference);
      sum += absolute; histogram[absolute]++; delta[channel] += difference; block.meanDelta[channel] += difference;
      if (absolute > max) max = absolute;
    }
  }
  const pixels = width * height, threshold = pixels * 3 * .95;
  let cumulative = 0, p95 = 0;
  for (; p95 < 255; p95++) { cumulative += histogram[p95]; if (cumulative >= threshold) break; }
  for (const block of blocks) block.meanDelta = block.pixels ? block.meanDelta.map(value => value / block.pixels) : null;
  return { mae: sum / (pixels * 3), p95, meanDelta: delta.map(value => value / pixels), max, blocks };
}

async function probe(options) {
  const config = validate(options), results = [], length = config.width * config.height * 4;
  const valid = options.valid;
  try {
    for (const ordinal of config.ordinals) {
      if (!valid()) return cancelled();
      const sourceTime = config.times[ordinal], end = ordinal + 1 < config.times.length ? config.times[ordinal + 1] : config.lastEnd;
      const aligned = await options.reference.seek(sourceTime, end);
      if (!valid() || aligned && aligned.cancelled === true) return cancelled();
      if (!aligned || aligned.sameFrame !== true || !Number.isFinite(aligned.actual) || Math.abs(aligned.actual - sourceTime) > .00001)
        throw Error('原视频未准确对齐所选源帧');
      let nativePixels = rgba(options.captureReference(), length), pngPixels = null;
      try {
        if (!valid()) return cancelled();
        const candidates = [];
        for (const format of config.formats) {
          if (!valid()) return cancelled();
          let bytes = await options.readFrame(format, ordinal), bitmap = null, pixels = null, candidate;
          if (!valid()) return cancelled();
          if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > (format === 'png' ? 32 : 8) * MIB)
            throw Error('颜色核对图片超出类型或大小边界');
          try {
            if (!valid()) return cancelled();
            bitmap = await options.decode(bytes, format);
            if (!valid()) return cancelled();
            if (!bitmap || typeof bitmap.close !== 'function') throw Error('颜色核对解码结果无法释放');
            pixels = rgba(options.readBitmap(bitmap), length);
            if (!valid()) return cancelled();
            if (format === 'png') pngPixels = pixels;
            candidate = { format, vsNative: statistics(nativePixels, pixels, config.width, config.height),
              vsPng: statistics(pngPixels, pixels, config.width, config.height) };
          } finally {
            const closing = bitmap; bitmap = null; pixels = null; bytes = null;
            if (closing && typeof closing.close === 'function') closing.close();
          }
          if (!valid()) return cancelled();
          candidates.push(candidate);
        }
        if (!valid()) return cancelled();
        results.push({ ordinal, sourceTime, actualSourceTime: aligned.actual, candidates });
      } finally { nativePixels = null; pngPixels = null; }
    }
    return valid() ? results : cancelled();
  } catch (error) {
    if (!valid()) return cancelled();
    throw error;
  }
}

module.exports = { probe };
