'use strict';

// Long sessions retain an exact, lightweight source index. Only bounded media
// segments enter the existing transactional cache; originals remain read-only.
const crypto = require('crypto');
const frameIndex = require('./frame-index.cjs');
const profile = require('./preview-profile.cjs');
const { OWNER, RECIPE } = require('./cache.cjs');
const LIMITS = Object.freeze({ frames: 120000, indexBytes: 64 * 1024 ** 2,
  segmentFrames: 120, segmentSeconds: 2, segmentBytes: 64 * 1024 ** 2, timeoutMs: 30000 });
const fail = (message, code = 'LONG_MEDIA_INVALID') => { throw Object.assign(new Error(message), { code }); };
function packetIndex(text, video, helpers) {
  const end = helpers.videoEnd({ streams: [video] });
  const pts = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = Object.fromEntries(line.split('|').map(part => { const at = part.indexOf('='); return [part.slice(0, at), part.slice(at + 1)]; }));
    if (String(fields.flags).includes('D')) continue;
    if (!/^-?\d+$/.test(fields.pts || '')) fail('视频缺少可靠的逐帧时间戳，不能猜测定位。');
    pts.push(fields.pts);
    if (pts.length > LIMITS.frames) fail('帧索引达到本版资源上限，请使用较短素材。', 'LONG_INDEX_LIMIT');
  }
  pts.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  if (!pts.length || pts.some((p, i) => i && p === pts[i - 1])) fail('当前长视频含重复或缺失时间戳，无法可靠按段定位。');
  return frameIndex.buildIndex(pts.map((ptsTicks, id) => ({ id, ptsTicks, file: `frame-${id}.jpg`, bytes: 8 * 1024 ** 2 })),
    { timeBase: end.timeBase, lastFrameEndTicks: end.lastFrameEndTicks });
}
function groupFrames(frames, duration) {
  const groups = [];
  for (let first = 0; first < frames.length;) {
    let last = first;
    while (last + 1 < frames.length && last - first + 1 < LIMITS.segmentFrames && frames[last + 1].time - frames[first].time < LIMITS.segmentSeconds) last++;
    const end = frames[last].end;
    groups.push({ first, last, start: frames[first].time, end }); first = last + 1;
  }
  // An audio tail can extend beyond the last video frame. It remains bounded
  // and uses that last frame without inventing new source-frame identifiers.
  for (let start = groups[groups.length - 1].end; start < duration;) {
    const end = Math.min(duration, start + LIMITS.segmentSeconds);
    groups.push({ first: frames.length - 1, last: frames.length - 1, start, end, audioOnly: true }); start = end;
    if (groups.length > LIMITS.frames) fail('媒体分段索引超过资源上限。', 'LONG_INDEX_LIMIT');
  }
  return groups;
}
function createLongMedia({ cache, tools, helpers: h }) {
  const sessions = new WeakMap();
  async function jobRun(settings, action) {
    const job = { signal: settings.signal, tx: settings.tx, children: new Set(), operations: new Set(), failure: null };
    const abort = () => h.stopChildren(job);
    const timer = setTimeout(() => { job.failure = Object.assign(new Error('分段准备超时，请重试当前位置。'), { code: 'MEDIA_TOOL_TIMEOUT' }); abort(); }, LIMITS.timeoutMs);
    if (job.signal) job.signal.addEventListener('abort', abort, { once: true });
    try { h.check(job); return await action(job); }
    finally { clearTimeout(timer); await h.settleJob(job); if (job.signal) job.signal.removeEventListener('abort', abort); }
  }
  async function capture(job, args) {
    const { child, finish } = h.childProcess(job, tools.ffprobe, args, ['ignore', 'pipe', 'pipe'], false);
    const collect = async stream => { const chunks = []; let bytes = 0;
      for await (const chunk of stream) { h.check(job); bytes = h.boundedAdd(bytes, chunk.length, LIMITS.indexBytes); chunks.push(chunk); }
      return Buffer.concat(chunks, bytes).toString('utf8'); };
    const streams = await Promise.allSettled([h.guarded(job, collect(child.stdout)), h.guarded(job, collect(child.stderr))]);
    const exit = await finish; h.check(job);
    for (const result of streams) if (result.status === 'rejected') throw result.reason;
    if (exit.error || exit.code !== 0) throw exit.error || new Error('源帧索引读取失败：' + streams[1].value.slice(-1024));
    return streams[0].value;
  }
  function unchanged(session) {
    if (!h.sameStamp(session.fingerprint.stamp, h.sourceStamp(h.regular(session.snapshot.filePath))))
      fail('原视频已改变，请重新打开；未交付旧身份的画面。', 'MEDIA_SOURCE_CHANGED');
  }
  async function audioEnd(job, file, stream) {
    const start = h.ratioSeconds(h.streamRatio(stream, 'start_pts', 'start_time'));
    const declared = start + h.ratioSeconds(h.streamRatio(stream, 'duration_ts', 'duration'));
    const { child, finish } = h.childProcess(job, tools.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'info', '-copyts',
      '-noaccurate_seek', '-seek_timestamp', '1', '-ss', Math.max(start, declared - 2).toFixed(9), '-i', file,
      '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', 'aresample=48000,ashowinfo@bounds', '-f', 'null', '-'], ['ignore', 'ignore', 'pipe'], false);
    let pending = '', bytes = 0, last = null;
    const read = h.guarded(job, (async () => {
      const row = text => { if (!text.includes('ashowinfo@bounds')) return;
        const pts = /\bpts:\s*(-?\d+)/.exec(text), count = /\bnb_samples:\s*(\d+)/.exec(text);
        if (pts && count) last = BigInt(pts[1]) + BigInt(count[1]); };
      for await (const chunk of child.stderr) { bytes = h.boundedAdd(bytes, chunk.length, 1024 ** 2); pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop(); lines.forEach(row); }
      if (pending) row(pending);
    })());
    const results = await Promise.allSettled([read]), exit = await finish; h.check(job);
    if (results[0].status === 'rejected') throw results[0].reason;
    if (exit.error || exit.code !== 0 || last === null) throw exit.error || new Error('无法确认实际音频尾部，未猜测结束位置。');
    return Number(last) / 48000;
  }
  async function prepare(snapshot, fingerprint, probe, settings) {
    return jobRun(settings, async job => {
      const video = probe.streams.find(s => s.codec_type === 'video');
      const packets = await capture(job, ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_entries', 'packet=pts,flags', '-of', 'compact=p=0:nk=0', snapshot.filePath]);
      const indexed = packetIndex(packets, video, h), proxy = settings.playbackBackend === 'proxy', preview = profile.dimensions(video, settings.previewQuality || '720p');
      const origin = h.ratio(indexed.originPtsTicks, indexed.timeBase);
      let audioStream = probe.streams.find(s => s.codec_type === 'audio');
      if (audioStream && !h.streamRatio(audioStream, 'duration_ts', 'duration')) audioStream = { ...audioStream, duration: probe.format.duration };
      let audio = null;
      if (audioStream) {
        const start = h.ratioSeconds(h.ratioSubtract(h.streamRatio(audioStream, 'start_pts', 'start_time'), origin));
        const duration = await audioEnd(job, snapshot.filePath, audioStream) - h.ratioSeconds(origin) - start;
        if (!Number.isSafeInteger(audioStream.channels) || audioStream.channels < 1 || audioStream.channels > 8 || !(duration > 0)) fail('音频格式不支持有界准备。');
        audio = { start, duration, channels: audioStream.channels, sampleRate: 48000, file: 'streamed-audio.wav', bytes: 1, segmented: true };
      }
      const duration = Math.max(indexed.videoDuration, audio ? audio.start + audio.duration : 0);
      if (proxy) for (const frame of indexed.frames) frame.file = frame.file.replace(/\.jpg$/, '.avc');
      const groups = groupFrames(indexed.frames, duration);
      const end = h.videoEnd(probe);
      const info = { schema: 1, owner: OWNER, recipe: RECIPE, streaming: 'segments-v1', leaseId: crypto.randomBytes(12).toString('hex'),
        source: { ...snapshot, sha256: fingerprint.sha256, codec: video.codec_name, width: video.width, height: video.height, hasAudioStream: !!audio },
        ...(proxy ? { videoEncoding: { format: 'annexb-idr-v1', codec: 'avc1.42c033' } } : {}),
        lastFrameEndTicks: end.lastFrameEndTicks, endTimeBase: end.timeBase,
        preview, width: preview.width, height: preview.height, duration, frames: indexed.frames, audio,
        segments: groups.map(group => ({ ...group })), metrics: { indexedPackets: indexed.frames.length, fullVideoRendered: false } };
      if (Buffer.byteLength(JSON.stringify(info)) > LIMITS.indexBytes) fail('源帧索引超过通信资源上限。', 'LONG_INDEX_LIMIT');
      frameIndex.validateIndex(info);
      const session = { snapshot, fingerprint, probe, video, origin: h.ratioSeconds(origin), groups, info };
      unchanged(session); sessions.set(info, session); return info;
    });
  }
  async function segment(info, ordinal, settings = {}) {
    const session = sessions.get(info);
    if (!session || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= session.groups.length) fail('长视频分段会话已失效。');
    return jobRun(settings, async job => {
      unchanged(session);
      const group = session.groups[ordinal], frames = info.frames.slice(group.first, group.last + 1);
      const key = crypto.createHash('sha256').update(JSON.stringify([info.videoEncoding ? 'avc-idr-v1' : 'segments-v1', ...(info.videoEncoding ? [info.videoEncoding] : []), info.source.sha256, info.preview, group, h.COLOR_VERSION])).digest('hex');
      const tx = await cache.begin({ sourceSha256: key, previewQuality: info.preview.quality, signal: job.signal }); job.tx = tx;
      let returned = null;
      try {
        let manifest = await tx.readComplete({ colorVersion: h.COLOR_VERSION });
        if (!manifest) manifest = await decode(job, tx, session, group, frames, key);
        h.check(job); unchanged(session);
        returned = await tx.finish(manifest, { ...manifest.source, filePath: session.snapshot.filePath });
        h.check(job); return returned;
      } catch (error) { await h.settleJob(job); if (returned) await cache.release(returned); await tx.abort(); throw error; }
      finally { try { await tx.close(); } catch (error) { if (returned) await cache.release(returned); throw error; } }
    });
  }
  async function decode(job, tx, session, group, expected, key) {
    const { info, origin, snapshot, video } = session;
    const videoStart = origin + expected[0].time;
    const audioStart = info.audio ? Math.max(group.start, info.audio.start) : 0;
    const audioEnd = info.audio ? Math.min(group.end, info.audio.start + info.audio.duration) : 0;
    const hasAudio = audioEnd > audioStart;
    const args = h.ffmpegArgs(snapshot.filePath, false, video.codec_name, video, info.preview);
    args.splice(args.indexOf('-i'), 0, '-noaccurate_seek', '-seek_timestamp', '1', '-ss', videoStart.toFixed(9));
    if (info.videoEncoding) {
      args[args.indexOf('-c:v')+1] = 'libx264';
      args.splice(args.indexOf('-q:v'), 2, '-preset', 'ultrafast', '-crf', '20', '-profile:v', 'baseline', '-level:v', '5.1', '-g', '1', '-bf', '0',
        '-x264-params', 'aud=1:repeat-headers=1:keyint=1:scenecut=0', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');
      args[args.indexOf('-f')+1] = 'h264';
      const filter = args.indexOf('-vf') + 1;
      args[filter] = args[filter].replace('out_range=pc:out_color_matrix=bt601', 'out_range=tv:out_color_matrix=bt709').replace('format=yuvj420p','format=yuv420p');
    }
    const vf = args.indexOf('-vf') + 1;
    args[vf] = `trim=start=${videoStart.toFixed(9)},trim=end_frame=${expected.length},` + args[vf];
    if (hasAudio) {
      // Separate input seeks avoid forcing audio-only tail requests to decode
      // video between the final picture and the requested audio position.
      const at = args.indexOf('-map');
      // Warm codec overlap/resampler state before trimming the exact interval.
      const audioSeek = Math.max(origin + info.audio.start, origin + audioStart - 2);
      args.splice(at, 0, '-noaccurate_seek', '-seek_timestamp', '1', '-ss', audioSeek.toFixed(9), '-i', snapshot.filePath);
      args.push('-map', '1:a:0', '-vn', '-sn', '-dn', '-af',
        `aresample=48000,atrim=start=${(origin + audioStart).toFixed(9)}:end=${(origin + audioEnd).toFixed(9)},ashowinfo@a`,
        '-c:a', 'pcm_f32le', '-f', 'wav', 'pipe:3');
    }
    const { child, finish } = h.childProcess(job, tools.ffmpeg, args, ['ignore', 'pipe', 'pipe', hasAudio ? 'pipe' : 'ignore'], false);
    const parser = info.videoEncoding ? new (require('./avc-access-units.cjs').AccessUnitParser)() : new h.JpegParser(), assets = [], pts = []; let base = null, audioFirst = null, total = 0, tail = '';
    const storeFrame = async value => {
      const bytes = info.videoEncoding ? value.bytes : value;
      if (info.videoEncoding && value.codec.toLowerCase() !== info.videoEncoding.codec) fail('代理编码参数与声明不一致。');
      if (assets.length >= expected.length) fail('分段图片数量超出源帧索引。');
      assets.push(await (tx.writeFrame || tx.writeAsset)(String(assets.length) + (info.videoEncoding ? '.avc' : '.jpg'), bytes));
    };
    const videoTask = h.guarded(job, (async () => {
      let packed = null;
      try { for await (const chunk of child.stdout) { h.check(job); total = h.boundedAdd(total, chunk.length, LIMITS.segmentBytes);
        for (const bytes of parser.push(chunk)) {
          await storeFrame(bytes);
        }
      }
      h.check(job);
      if (info.videoEncoding) for (const value of parser.end()) await storeFrame(value);
      } finally { if (tx.finishFrames) packed = await tx.finishFrames(); }
      return packed;
    })());
    const stderrTask = h.guarded(job, (async () => {
      let pending = '', bytes = 0;
      function line(row) {
        if (row.includes('showinfo@v')) {
          const tb = /config in time_base:\s*(\d+)\/(\d+)/.exec(row); if (tb) base = [Number(tb[1]), Number(tb[2])];
          const p = /n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:/.exec(row);
          if (p) { if (Number(p[1]) !== pts.length || pts.length >= expected.length) fail('分段时间索引溢出。'); pts.push(p[2]); }
        }
        if (row.includes('ashowinfo@a') && audioFirst === null) { const p = /n:\s*0\s+pts:\s*(-?\d+)/.exec(row); if (p) audioFirst = p[1]; }
      }
      for await (const chunk of child.stderr) { bytes = h.boundedAdd(bytes, chunk.length, 1024 ** 2); pending += chunk.toString(); tail = (tail + chunk.toString()).slice(-2048);
        const rows = pending.split(/\r?\n/); pending = rows.pop(); rows.forEach(line); }
      if (pending) line(pending);
    })());
    const audioTask = h.guarded(job, (async () => {
      if (!hasAudio) return null;
      const writer = await tx.openAsset('audio.wav'); let count = 0, fmt, asset;
      try {
        for await (const chunk of child.stdio[3]) { h.check(job); count = h.boundedAdd(count, chunk.length, 4 * 1024 ** 2); total = h.boundedAdd(total, chunk.length, LIMITS.segmentBytes); await writer.append(chunk); }
        h.check(job);
        const prefix = await writer.readPrefix(Math.min(count, 4096)); fmt = h.patchWav(prefix, count); await writer.patch(0, prefix.subarray(0, fmt.dataOffset));
      } finally { asset = await writer.close(); }
      return { ...asset, sampleRate: fmt.sampleRate, channels: fmt.channels, duration: fmt.duration };
    })());
    const results = await Promise.allSettled([videoTask, audioTask, stderrTask]), exit = await finish; h.check(job);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    if (exit.error || exit.code !== 0) throw exit.error || new Error('分段读取失败：' + tail);
    if (!base || pts.length !== expected.length || assets.length !== expected.length || (info.videoEncoding ? 0 : parser.buffer.length)) fail('分段图片与时间戳不完整。');
    for (let i = 0; i < pts.length; i++) {
      const a = h.ratio(pts[i], base), b = h.ratio(expected[i].ptsTicks, expected[i].timeBase);
      if (a.n * b.d !== b.n * a.d) fail('分段解码与源帧索引不一致，已停止，未显示错误画面。', 'MEDIA_PTS');
    }
    const following = info.frames[group.last + 1], declaredEnd = h.videoEnd(session.probe);
    const localFrames = frameIndex.buildIndex(expected.map((f, i) => ({ ...f, ...assets[i] })), {
      lastFrameEndTicks: following ? following.ptsTicks : declaredEnd.lastFrameEndTicks,
      endTimeBase: following ? following.timeBase : declaredEnd.timeBase }).frames;
    const audio = results[1].value;
    if (audio) {
      if (audioFirst === null) fail('分段音频缺少时间原点。');
      audio.start = Number(audioFirst) / 48000 - (origin + group.start);
    }
    // Audio-only segments still carry a verified copy of the final picture.
    if (group.audioOnly) localFrames[0].end = group.end - group.start;
    const duration = Math.max(localFrames[localFrames.length - 1].end, audio ? audio.start + audio.duration : 0);
    const manifest = { schema: 1, owner: OWNER, recipe: RECIPE, colorVersion: h.COLOR_VERSION, color: h.previewColor(video),
      ...(info.videoEncoding ? { videoEncoding: info.videoEncoding } : {}),
      source: { sha256: key, codec: video.codec_name, width: video.width, height: video.height, hasAudioStream: hasAudio },
      preview: info.preview, width: info.width, height: info.height, duration, frames: localFrames, audio,
      ...(results[0].value ? { framePack: results[0].value } : {}), metrics: { segmentStart: group.start, sourceSha256: info.source.sha256 } };
    frameIndex.validateIndex(manifest); return manifest;
  }
  function release(info) { return sessions.delete(info); }
  return { prepare, segment, release };
}
module.exports = { createLongMedia, LIMITS, packetIndex, groupFrames };
