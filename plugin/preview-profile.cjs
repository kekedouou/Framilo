'use strict';

// Shared pure rules; no files, Eagle API or renderer access.
const VERSION = 'fit-no-upscale-v1';
const QUALITIES = Object.freeze(['720p', '1080p', '1440p']);
function quality(value = '720p') {
  if (!QUALITIES.includes(value)) throw new Error('画质只支持720p、1080p或2K（1440p）。');
  return value;
}
function dimensions(video, selected = '720p') {
  quality(selected);
  const { width, height } = video || {};
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('缺少可靠的视频尺寸。');
  const side = (video.side_data_list || []).find(item => item.rotation !== undefined);
  const rotation = Number(side ? side.rotation : video.tags && video.tags.rotate || 0);
  if (!Number.isFinite(rotation) || rotation % 90) throw new Error('暂不支持非直角旋转的视频预览。');
  const sar = String(video.sample_aspect_ratio || '1:1').split(':').map(Number);
  const ratio = sar.length === 2 && sar.every(n => n > 0 && Number.isFinite(n)) ? sar[0] / sar[1] : 1;
  let displayWidth = width * ratio, displayHeight = height;
  if (Math.abs(rotation % 180) === 90) [displayWidth, displayHeight] = [displayHeight, displayWidth];
  const [long, short] = selected === '1440p' ? [2560, 1440] : selected === '1080p' ? [1920, 1080] : [1280, 720];
  const maxWidth = displayWidth < displayHeight ? short : long, maxHeight = displayWidth < displayHeight ? long : short;
  const scale = Math.min(1, maxWidth / displayWidth, maxHeight / displayHeight);
  const w = Math.max(1, Math.floor(displayWidth * scale + 1e-8)), h = Math.max(1, Math.floor(displayHeight * scale + 1e-8));
  return Object.freeze({ version: VERSION, quality: selected, width: w, height: h,
    originalResolution: ratio === 1 && scale === 1, sourceWidth: width, sourceHeight: height, rotation,
    sampleAspectRatio: sar.length === 2 && sar.every(n => n > 0 && Number.isFinite(n)) ? sar.join(':') : '1:1' });
}
function validate(profile, source) {
  if (!profile || profile.version !== VERSION) throw new Error('预览尺寸版本无效。');
  quality(profile.quality);
  const [long, short] = profile.quality === '1440p' ? [2560, 1440] : profile.quality === '1080p' ? [1920, 1080] : [1280, 720];
  if (![profile.width, profile.height].every(n => Number.isSafeInteger(n) && n > 0) ||
      Math.max(profile.width, profile.height) > long || Math.min(profile.width, profile.height) > short ||
      profile.sourceWidth !== source.width || profile.sourceHeight !== source.height ||
      typeof profile.originalResolution !== 'boolean') throw new Error('预览尺寸或源尺寸不符。');
  if (!Number.isFinite(profile.rotation) || typeof profile.sampleAspectRatio !== 'string') throw new Error('预览方向或像素比例无效。');
  const expected = dimensions({ width: source.width, height: source.height,
    sample_aspect_ratio: profile.sampleAspectRatio, side_data_list: [{ rotation: profile.rotation }] }, profile.quality);
  if (Object.keys(expected).some(key => expected[key] !== profile[key])) throw new Error('预览计算结果不符。');
  return profile;
}
module.exports = { VERSION, QUALITIES, quality, dimensions, validate };
