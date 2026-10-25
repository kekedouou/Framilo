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
const AUDIO_PREROLL_VERSION = 'audio-preroll-v2';
function segmentKey(info, group, colorVersion) {
  return crypto.createHash('sha256').update(JSON.stringify([info.videoEncoding ? 'avc-idr-v1' : 'segments-v1',
    ...(info.videoEncoding ? [info.videoEncoding] : []), info.source.sha256, info.preview, group, colorVersion,
    ...(info.audio ? [AUDIO_PREROLL_VERSION] : [])])).digest('hex');
}
function stillKey(info, ordinal, colorVersion) {
  const frame = info.frames[ordinal];
  return crypto.createHash('sha256').update(JSON.stringify(['record-still-jpeg-v1', info.source.sha256,
    info.preview, frame.id, frame.ptsTicks, frame.timeBase, frame.end, colorVersion])).digest('hex');
}
function audioInputArgs(file, origin, audio, start) {
  if (![origin, audio && audio.start, start].every(Number.isFinite)) fail('音频预热起点无效。', 'MEDIA_AUDIO_TIME');
  const trackStart = origin + audio.start, seek = Math.max(trackStart, origin + start - 2);
  // Even input -ss at the exact track start can discard AAC decoder priming.
  // Sequentially decode that initial padding; the existing atrim keeps the
  // requested source-clock interval. Later positions retain the 2s overlap.
  return [...(seek > trackStart ? ['-noaccurate_seek', '-seek_timestamp', '1', '-ss', seek.toFixed(9)] : []), '-i', file];
}
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
  const sessions = new WeakMap(), batchSessions = new Set();
  function cancelled() { return Object.assign(new Error('长视频会话已关闭。'), { code: 'MEDIA_CANCELLED' }); }
  function sessionFor(info) {
    const session = sessions.get(info);
    if (!session || session.released) throw cancelled();
    if (session.cleanupFailure) throw session.cleanupFailure;
    return session;
  }
  async function proxyBatch(session, signal) {
    if (session.batchClosing) await session.batchClosing;
    if (session.released) throw cancelled();
    if (session.cleanupFailure) throw session.cleanupFailure;
    h.check({ signal });
    if (!session.batch && !session.batchOpening) {
      if (typeof cache.openBatch !== 'function') fail('缓存缺少代理长会话能力。', 'MEDIA_DEPENDENCY');
      batchSessions.add(session);
      const opening = Promise.resolve().then(() => cache.openBatch({ sourceSha256: session.info.source.sha256,
        previewQuality: session.info.preview.quality, sessionSignal: session.controller.signal }));
      session.batchOpening = opening;
      opening.then(value => { session.batch = value; }, error => {
        if (error.code === 'MEDIA_CLEANUP_FAILED') session.cleanupFailure = session.cleanupFailure || error;
      }).finally(() => {
        if (session.batchOpening === opening) session.batchOpening = null;
        if (!session.batch && !session.cleanupFailure) batchSessions.delete(session);
      });
    }
    const batch = session.batch || await session.batchOpening;
    h.check({ signal });
    if (session.released) throw cancelled();
    return batch;
  }
  // Call directly from the worker's existing queue. Enqueueing another close
  // here would wait on the operation that is currently waiting for this close.
  function closeProxyBatch(info) {
    if (info === undefined) return (async () => { for (const session of [...batchSessions]) await closeProxyBatch(session.info); })();
    const session = sessions.get(info);
    if (!session) return Promise.resolve(false);
    if (session.batchClosing) return session.batchClosing;
    const operations = [...session.operations];
    const closing = (async () => {
      await Promise.allSettled(operations);
      if (session.batchOpening) {
        try { await session.batchOpening; }
        catch (error) { if (!session.controller.signal.aborted || error.name !== 'AbortError') throw error; }
      }
      let closed = false;
      if (session.batch) { await session.batch.close(); session.batch = null; closed = true; }
      // A failed segment cleanup may own an unreturned lease/output. Closing
      // the known writer must not erase that uncertainty or its source handle.
      if (session.cleanupFailure) throw session.cleanupFailure;
      batchSessions.delete(session);
      return closed;
    })();
    session.batchClosing = closing;
    closing.then(() => { if (session.batchClosing === closing) session.batchClosing = null; },
      () => { if (session.batchClosing === closing) session.batchClosing = null; });
    return closing;
  }
  async function proxyBudget(info, settings = {}) {
    const session = sessionFor(info);
    if (!info.videoEncoding) fail('JPEG分段不使用代理长会话。', 'MEDIA_DEPENDENCY');
    return (await proxyBatch(session, settings.signal)).snapshot();
  }
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
      const session = { snapshot, fingerprint, probe, video, origin: h.ratioSeconds(origin), groups, info,
        controller: new AbortController(), operations: new Set(), released: false, batch: null, batchOpening: null, batchClosing: null, cleanupFailure: null };
      unchanged(session); sessions.set(info, session); return info;
    });
  }
  function segment(info, ordinal, settings = {}) {
    let session;
    try { session = sessionFor(info); } catch (error) { return Promise.reject(error); }
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= session.groups.length)
      return Promise.reject(Object.assign(new Error('长视频分段会话已失效。'), { code: 'LONG_MEDIA_INVALID' }));
    const controller = new AbortController(), signals = [settings.signal, session.controller.signal].filter(Boolean);
    const abort = () => controller.abort();
    for (const signal of signals) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }
    const work = jobRun({ ...settings, signal: controller.signal }, async job => {
      unchanged(session);
      const still = settings.stillOrdinal;
      if (still !== undefined && (!Number.isSafeInteger(still) || !info.frames[still])) fail('标注静帧编号无效。');
      const group = still === undefined ? session.groups[ordinal] : { first: still, last: still, start: info.frames[still].time, end: info.frames[still].end, still: true };
      const frames = info.frames.slice(group.first, group.last + 1);
      const key = still === undefined ? segmentKey(info, group, h.COLOR_VERSION) : stillKey(info, still, h.COLOR_VERSION);
      const parent = info.videoEncoding ? await proxyBatch(session, job.signal) : cache;
      const request = { sourceSha256: key, previewQuality: info.preview.quality, signal: job.signal };
      const tx = await (info.videoEncoding ? parent.beginSegment(request) : parent.begin(request)); job.tx = tx;
      let returned = null, primaryError = null;
      try {
        let manifest = await tx.readComplete({ colorVersion: h.COLOR_VERSION });
        if (!manifest && settings.existingOnly) { await tx.abort(); return null; }
        if (!manifest) manifest = await decode(job, tx, still === undefined ? session : { ...session, info: { ...info, videoEncoding: undefined, audio: null } }, group, frames, key);
        if (still !== undefined && (manifest.frames.length !== 1 || manifest.frames[0].ptsTicks !== frames[0].ptsTicks ||
            manifest.frames[0].timeBase.join(':') !== frames[0].timeBase.join(':') || manifest.audio || manifest.videoEncoding ||
            manifest.metrics?.sourceSha256 !== info.source.sha256)) fail('标注静帧身份与原视频不一致。', 'MEDIA_PTS');
        h.check(job); unchanged(session);
        returned = await tx.finish(manifest, { ...manifest.source, filePath: session.snapshot.filePath });
        h.check(job); return returned;
      } catch (error) {
        primaryError = error; await h.settleJob(job);
        if (returned) { try { await cache.release(returned); returned = null; } catch (releaseError) { error.releaseError = releaseError.message; } }
        try { await tx.abort(); } catch (cleanupError) { error.cleanupError = cleanupError.message; }
        throw error;
      } finally {
        try { await tx.close(); } catch (closeError) {
          if (!primaryError) primaryError = closeError;
          primaryError.lockReleaseError = closeError.message;
          if (returned) { try { await cache.release(returned); returned = null; } catch (releaseError) { primaryError.releaseError = releaseError.message; } }
        }
        if (primaryError && (primaryError.cleanupError || primaryError.lockReleaseError || primaryError.releaseError))
          throw Object.assign(new Error('分段任务已停止，但资源清理失败：' +
            [primaryError.cleanupError, primaryError.lockReleaseError, primaryError.releaseError].filter(Boolean).join('；')),
          { code: 'MEDIA_CLEANUP_FAILED', causeCode: primaryError.code || primaryError.name });
      }
    });
    session.operations.add(work);
    const done = () => { session.operations.delete(work); for (const signal of signals) signal.removeEventListener('abort', abort); };
    work.then(done, error => { if (error.code === 'MEDIA_CLEANUP_FAILED') session.cleanupFailure = session.cleanupFailure || error; done(); }); return work;
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
    if (group.still) args.splice(args.indexOf('-f'), 0, '-frames:v', '1');
    if (hasAudio) {
      // Separate input seeks avoid forcing audio-only tail requests to decode
      // video between the final picture and the requested audio position.
      const at = args.indexOf('-map');
      // Warm codec overlap/resampler state before trimming the exact interval.
      args.splice(at, 0, ...audioInputArgs(snapshot.filePath, origin, info.audio, audioStart));
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
  async function release(info) {
    const session = sessions.get(info); if (!session) return false;
    session.released = true; session.controller.abort();
    await closeProxyBatch(info); return sessions.delete(info);
  }
  function still(info, ordinal, settings = {}) {
    if (!Number.isSafeInteger(ordinal) || !info?.frames?.[ordinal]) return Promise.reject(new Error('标注静帧编号无效。'));
    const at = info.segments.findIndex(group => ordinal >= group.first && ordinal <= group.last);
    if (at < 0) return Promise.reject(new Error('标注静帧不属于当前源索引。'));
    return segment(info, at, { ...settings, stillOrdinal: ordinal });
  }
  return { prepare, segment, still, release, proxyBudget, closeProxyBatch };
}
module.exports = { createLongMedia, LIMITS, packetIndex, groupFrames,
  _test: Object.freeze({ AUDIO_PREROLL_VERSION, segmentKey, stillKey, audioInputArgs }) };
