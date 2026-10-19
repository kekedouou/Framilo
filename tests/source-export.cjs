'use strict';
// Export recipes and SDK dialogs/folder reads only. No media/library writes.
const assert = require('assert'), path = require('path');
const { _test: { plan, originalDimensions } } = require('../plugin/export.cjs');
const { createEagleAdapter } = require('../plugin/eagle.cjs');
const source = path.resolve('source original.mp4');
const info = { source: { filePath: source }, metrics: { sourceVideoOrigin: 10 }, preview: { width: 1280, height: 720 },
  frames: [{ id: 0, time: 0, end: .04 }, { id: 1, time: .04, end: .12 }, { id: 2, time: .12, end: .2 }] };
const video = { codec_type: 'video', width: 1920, height: 1080, pix_fmt: 'yuv420p', color_space: 'bt709', color_range: 'tv' };
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('ok ' + name); }
(async () => {
  await test('PNG always selects the real source ordinal at source resolution with the existing color mapping', () => {
    const p = plan(info, { kind: 'frame', frameOrdinal: 2 }, { streams: [video] });
    assert.equal(p.width, 1920); assert.equal(p.height, 1080); assert(p.args.includes(source));
    const filter = p.args[p.args.indexOf('-vf') + 1];
    assert(filter.includes('select=eq(n\\,2)')); assert(filter.includes('scale=1920:1080'));
    assert(filter.includes('in_color_matrix=bt709')); assert(!p.args.join(' ').includes('.jpg'));
  });
  await test('Clip contains both exact ordinals, keeps VFR times and source dimensions without preview filters', () => {
    const p = plan(info, { kind: 'clip', firstOrdinal: 1, lastOrdinal: 2 }, { streams: [video] });
    assert.equal(p.start, 10.04); assert.equal(p.end, 10.2);
    assert.equal(p.width, 1920); assert.equal(p.args[p.args.indexOf('-fps_mode') + 1], 'passthrough');
    assert.equal(p.args[p.args.indexOf('-vf') + 1], 'trim=start_frame=1:end_frame=3,setpts=PTS-STARTPTS');
    assert(p.args.includes('16')); assert(!p.args.join(' ').includes('scale=')); assert(p.args.includes('-an'));
    const packetTiming = p.args[p.args.indexOf('-bsf:v') + 1];
    assert.equal(p.args[p.args.indexOf('-bf:v') + 1], '0');
    assert(packetTiming.startsWith('setts=pts=PTS:dts=DTS:duration='));
    assert(packetTiming.includes('0.080000000/TB'));
  });
  await test('Audio uses the same absolute source start and selected span, independent of preview slow motion', () => {
    const p = plan({ ...info, rate: .25 }, { kind: 'clip', firstOrdinal: 1, lastOrdinal: 2 },
      { streams: [video, { codec_type: 'audio' }] });
    const filter = p.args[p.args.indexOf('-af') + 1];
    assert(filter.includes('PTS-10.040000000/TB')); assert(filter.includes('duration=0.160000000'));
    assert(!filter.includes('atempo')); assert(p.hasAudio);
  });
  await test('Portrait rotation and non-square pixels are mapped without a preview size cap', () => {
    assert.deepEqual(originalDimensions({ width: 3840, height: 2160, side_data_list: [{ rotation: 90 }] }), { width: 2160, height: 3840 });
    assert.deepEqual(originalDimensions({ width: 720, height: 576, sample_aspect_ratio: '16:15' }), { width: 768, height: 576 });
  });
  await test('Invalid ranges and unsupported HDR are errors rather than silent approximation', () => {
    assert.throws(() => plan(info, { kind: 'clip', firstOrdinal: 2, lastOrdinal: 1 }, { streams: [video] }), /范围/);
    assert.throws(() => plan(info, { kind: 'clip', firstOrdinal: 0, lastOrdinal: 1 },
      { streams: [{ ...video, color_transfer: 'smpte2084' }] }), /色深/);
  });
  await test('A zero-duration presented frame can still be exported as a still image', () => {
    const copied = { ...info, frames: [{ id: 0, time: 0, end: 0 }, ...info.frames] };
    assert.equal(plan(copied, { kind: 'frame', frameOrdinal: 0 }, { streams: [video] }).first, 0);
  });
  await test('Wide-gamut input is not silently saved as an ordinary sRGB image', () => {
    assert.throws(() => plan(info, { kind: 'frame', frameOrdinal: 0 }, { streams: [{ ...video, color_primaries: 'bt2020' }] }), /专门/);
  });
  await test('Folder read is immutable, bounded and tied to the original library', async () => {
    const libraryPath = path.resolve('test.library'), raw = [{ id: 'parent', name: '中文', children: [{ id: 'child', name: '<b>空格</b>' }] }];
    const adapter = createEagleAdapter({ library: { path: libraryPath }, folder: { getAll: async () => raw } });
    const result = await adapter.exportFolders();
    assert.deepEqual(result.items.map(item => item.label), ['中文', '中文 / <b>空格</b>']);
    raw[0].name = 'later'; assert.equal(result.items[0].label, '中文');
  });
  await test('Save dialog cancel returns without creating files or importing anything', async () => {
    let call;
    const adapter = createEagleAdapter({ library: { path: path.resolve('test.library') }, dialog: { async showSaveDialog(options) { call = options; return { canceled: true }; } } });
    assert.deepEqual(await adapter.exportDestination({ destination: 'local', kind: 'frame', name: '当前帧' }), { kind: 'cancelled' });
    assert.equal(call.defaultPath, '当前帧.png'); assert.deepEqual(call.filters[0].extensions, ['png']);
  });
  await test('Library changes while choosing a destination reject the stale result', async () => {
    const api = { library: { path: path.resolve('old.library') }, dialog: { async showSaveDialog() { api.library.path = path.resolve('new.library'); return { canceled: false, filePath: path.resolve('output.png') }; } } };
    await assert.rejects(createEagleAdapter(api).exportDestination({ destination: 'local', kind: 'frame', name: 'frame' }), /素材库已变化/);
  });
  console.log('Source export checks: ' + checks + '; recipes and SDK models only.');
})().catch(error => { console.error(error); process.exitCode = 1; });
