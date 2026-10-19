'use strict';
// Source-only export work. Runs inside the existing guarded task worker.
// No Eagle API, preview JPEG reads, or changes to the cache storage format.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { spawn } = require('child_process');
const { previewRgbFilter } = require('./media.cjs');
const MAX_BYTES = 1024 ** 3;
const issue = (code, message) => Object.assign(new Error(message), { code });
const cancelled = () => issue('EXPORT_CANCELLED', '导出已取消。');
const check = signal => { if (signal && signal.aborted) throw cancelled(); };
function plain(file, directory = false) {
  const absolute = path.resolve(file), stat = fs.lstatSync(absolute, { bigint: true });
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n) ||
      fs.realpathSync(absolute).toLowerCase() !== absolute.toLowerCase()) throw issue('EXPORT_PATH', '导出路径经过链接或不是普通文件夹/文件。');
  return stat;
}
function same(a, b) { return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]); }
async function fingerprint(file, signal) {
  const before = plain(file), hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) { check(signal); hash.update(bytes); }
  if (!same(before, plain(file))) throw issue('EXPORT_SOURCE_CHANGED', '视频在导出期间发生变化，未交付结果。');
  return { stat: before, sha256: hash.digest('hex') };
}
async function run(tool, args, settings = {}) {
  check(settings.signal);
  const child = spawn(tool, args, { windowsHide: true, shell: false, env: settings.env || process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', failure = null, total = 0;
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8192); });
  const kill = () => { try { child.kill(); } catch (_) {} };
  const exit = new Promise((resolve, reject) => {
    child.once('error', error => { failure = error; reject(error); });
    child.once('close', code => code === 0 ? resolve() : reject(failure || issue('EXPORT_TOOL', '导出工具未完成：' + stderr.slice(-2048))));
  });
  exit.catch(() => {});
  const timer = setTimeout(() => { failure = issue('EXPORT_TIMEOUT', '导出处理超时，已停止本次任务。'); kill(); }, settings.timeoutMs || 180000);
  const diskTimer = settings.outputFile ? setInterval(() => {
    try { if (fs.existsSync(settings.outputFile) && Number(plain(settings.outputFile).size) > (settings.maxBytes || MAX_BYTES)) {
      failure = issue('EXPORT_SIZE', '导出超过临时容量上限，已停止。'); kill();
    } } catch (error) { failure = error; kill(); }
  }, 200) : null;
  if (settings.signal) settings.signal.addEventListener('abort', kill, { once: true });
  const chunks = [];
  try {
    for await (const bytes of child.stdout) {
      check(settings.signal); total += bytes.length;
      if (total > (settings.maxBytes || MAX_BYTES)) throw issue('EXPORT_SIZE', '本次导出超过安全大小限制，请选择更短片段。');
      if (settings.output) {
        let offset = 0;
        while (offset < bytes.length) offset += (await settings.output.write(bytes, offset, bytes.length - offset)).bytesWritten;
      } else chunks.push(bytes);
    }
    await exit; check(settings.signal);
    return { bytes: total, data: settings.output ? null : Buffer.concat(chunks) };
  } catch (error) { kill(); await exit.catch(() => {}); check(settings.signal); throw failure || error; }
  finally { clearTimeout(timer); if (diskTimer) clearInterval(diskTimer); if (settings.signal) settings.signal.removeEventListener('abort', kill); }
}
function originalDimensions(video) {
  let width = video.width, height = video.height;
  const side = (video.side_data_list || []).find(value => value.rotation !== undefined);
  const rotation = Number(side ? side.rotation : video.tags && video.tags.rotate || 0);
  const sar = String(video.sample_aspect_ratio || '1:1').split(':').map(Number);
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || !Number.isFinite(rotation) || rotation % 90)
    throw issue('EXPORT_DIMENSIONS', '不能可靠确认原始尺寸和方向。');
  if (sar.length === 2 && sar.every(value => Number.isFinite(value) && value > 0)) width = Math.max(1, Math.round(width * sar[0] / sar[1]));
  if (Math.abs(rotation % 180) === 90) [width, height] = [height, width];
  return { width, height };
}
function plan(info, request, probe) {
  const frames = info.frames, first = request.kind === 'frame' ? request.frameOrdinal : request.firstOrdinal;
  const last = request.kind === 'frame' ? first : request.lastOrdinal;
  if (!['frame', 'clip'].includes(request.kind) || !Array.isArray(frames) || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
      first < 0 || last < first || last >= frames.length) throw issue('EXPORT_RANGE', '缺少已确认的真实画面或片段范围。');
  const video = probe.streams.find(value => value.codec_type === 'video'), audio = probe.streams.find(value => value.codec_type === 'audio');
  if (!video || !info.metrics || !Number.isFinite(info.metrics.sourceVideoOrigin)) throw issue('EXPORT_TIMING', '缺少源视频的可靠时间原点。');
  const start = info.metrics.sourceVideoOrigin + frames[first].time;
  const end = info.metrics.sourceVideoOrigin + frames[last].end;
  if (request.kind === 'clip' && !(end > start)) throw issue('EXPORT_TIMING', '所选片段没有可靠的结束时间。');
  const common = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '2', '-copyts'];
  const dims = originalDimensions(video);
  const wide = ['bt2020', 'smpte431', 'smpte432'].includes(video.color_primaries);
  if (request.kind === 'frame' && (wide || ['smpte2084', 'arib-std-b67'].includes(video.color_transfer) || /(?:10|12|16)(?:le|be)$/.test(video.pix_fmt || '')))
    throw issue('EXPORT_COLOR_SCOPE', '这段视频的HDR或高位深需要专门的图片导出处理，当前不会静默降为普通8位PNG。');
  if (request.kind === 'frame') return { kind: 'frame', first, last, start, end, ...dims,
    args: [...common, '-i', info.source.filePath || info.source.file, '-map', '0:v:0', '-an', '-sn', '-dn',
      '-vf', `select=eq(n\\,${first}),${previewRgbFilter(video, dims.width, dims.height)}`, '-filter_threads', '1',
      '-fps_mode', 'passthrough', '-frames:v', '1', '-c:v', 'png', '-threads', '1', '-f', 'image2pipe', 'pipe:1'] };
  // Do not silently turn wide-gamut/HDR or high-bit-depth input into 8-bit SDR.
  if (wide || ['smpte2084', 'arib-std-b67'].includes(video.color_transfer) || !['yuv420p', 'yuvj420p', 'nv12'].includes(video.pix_fmt) ||
      video.width % 2 || video.height % 2)
    throw issue('EXPORT_COLOR_SCOPE', '这段视频的色深、色彩或尺寸需要专门的导出处理，当前不会自动降低为普通8位视频。');
  const span = end - start;
  const finalPts = frames[last].time - frames[first].time, finalDuration = frames[last].end - frames[last].time;
  const args = [...common, '-noautorotate', '-i', info.source.filePath || info.source.file,
    '-map', '0:v:0', '-vf', `trim=start_frame=${first}:end_frame=${last + 1},setpts=PTS-STARTPTS`,
    '-filter_threads', '1', '-fps_mode', 'passthrough', '-enc_time_base:v', '1:1000000',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-bf:v', '0', '-threads:v', '2', '-pix_fmt', video.pix_fmt === 'yuvj420p' ? 'yuvj420p' : 'yuv420p',
    // The encoder cannot infer the next frame beyond the selected interval.
    // Use presentation-order packets so the MP4 decode end is also the selected
    // display end. Set the last duration explicitly without changing timestamps.
    '-bsf:v', `setts=pts=PTS:dts=DTS:duration=if(eq(PTS\\,round(${finalPts.toFixed(9)}/TB))\\,round(${finalDuration.toFixed(9)}/TB)\\,DURATION)`];
  if (audio) args.push('-map', '0:a:0', '-af', `asetpts=PTS-${start.toFixed(9)}/TB,aresample=48000:first_pts=0,apad,atrim=duration=${span.toFixed(9)}`,
    '-c:a', 'aac', '-b:a', '320k');
  else args.push('-an');
  args.push('-sn', '-dn', '-map_metadata', '0', '-t', span.toFixed(9), '-video_track_timescale', '1000000',
    '-movflags', '+faststart', '-n', '-f', 'mp4', 'pipe:1');
  return { kind: 'clip', first, last, start, end, width: video.width, height: video.height, hasAudio: !!audio, args };
}
function createExportStore(options) {
  const root = path.resolve(options.pluginRoot), staging = path.join(root, 'export-work'), records = new Map();
  function init() {
    plain(root, true);
    if (!fs.existsSync(staging)) fs.mkdirSync(staging);
    plain(staging, true);
    const ownerFile = path.join(staging, 'owner.json');
    if (!fs.existsSync(ownerFile)) fs.writeFileSync(ownerFile, JSON.stringify({ owner: 'eva-source-exports-v1' }), { flag: 'wx' });
    if (plain(ownerFile).size > 1024 || JSON.parse(fs.readFileSync(ownerFile, 'utf8')).owner !== 'eva-source-exports-v1')
      throw issue('EXPORT_OWNER', '导出临时目录归属不明，未覆盖任何文件。');
    let used = 0;
    for (const name of fs.readdirSync(staging)) {
      const file = path.join(staging, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw issue('EXPORT_OWNER', '导出临时目录存在未知链接。');
      if (stat.isDirectory()) for (const child of fs.readdirSync(file)) {
        const value = plain(path.join(file, child)); used += Number(value.size);
      } else used += Number(plain(file).size);
    }
    if (used > MAX_BYTES) throw issue('EXPORT_STORAGE', '待核对的导出临时文件已到容量限制，请先处理旧导出。');
    return MAX_BYTES - used;
  }
  async function create(info, request, settings) {
    const available = init(), token = crypto.randomBytes(16).toString('hex'), directory = path.join(staging, 'job-' + token);
    const file = path.join(directory, request.kind === 'frame' ? 'frame.png' : 'clip.mp4');
    let handle, record, fileIdentity;
    const sourceFile = info.source.filePath || info.source.file;
    const before = await fingerprint(sourceFile, settings.signal);
    if (before.sha256 !== info.source.sha256) throw issue('EXPORT_SOURCE_CHANGED', '原视频已变化，请重新载入后导出。');
    const probeResult = await run(settings.tools.ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', sourceFile], { ...settings, maxBytes: 1024 ** 2 });
    const specification = plan(info, request, JSON.parse(probeResult.data));
    check(settings.signal); fs.mkdirSync(directory);
    const directoryIdentity = plain(directory, true);
    fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ owner: 'eva-source-export-job-v1', token, sourceSha256: before.sha256 }), { flag: 'wx' });
    try {
      if (settings.onProgress) settings.onProgress({ message: '正在从原视频生成' + (request.kind === 'frame' ? '图片' : '片段') });
      if (request.kind === 'frame') {
        handle = await fs.promises.open(file, 'wx');
        fileIdentity = await handle.stat({ bigint: true });
        await run(settings.tools.ffmpeg, specification.args, { ...settings, output: handle, maxBytes: Math.max(1, available - 1024) });
      } else {
        const args = specification.args.slice(); args[args.length - 1] = file;
        await run(settings.tools.ffmpeg, args, { ...settings, outputFile: file, maxBytes: Math.max(1, available - 1024) });
        plain(file); handle = await fs.promises.open(file, 'r+');
      }
      await handle.sync(); await handle.close(); handle = null;
      const after = await fingerprint(sourceFile, settings.signal);
      if (after.sha256 !== before.sha256 || !same(before.stat, after.stat)) throw issue('EXPORT_SOURCE_CHANGED', '原视频在导出期间变化，结果未交付。');
      if (Number(plain(file).size) > available - 1024) throw issue('EXPORT_SIZE', '导出超过临时容量上限，未交付。');
      const output = await fingerprint(file, settings.signal);
      const resultProbe = await run(settings.tools.ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_frames',
        '-show_entries', 'stream=codec_type,width,height,nb_read_frames,duration:frame=media_type,best_effort_timestamp_time', '-of', 'json', file], { ...settings, maxBytes: 1024 ** 2 });
      const verifiedOutput = JSON.parse(resultProbe.data), video = verifiedOutput.streams.find(value => value.codec_type === 'video');
      if (!video || video.width !== specification.width || video.height !== specification.height ||
          Number(video.nb_read_frames) !== specification.last - specification.first + 1)
        throw issue('EXPORT_VERIFY', '导出结果的尺寸或帧数核对未通过，未交付文件。');
      if (request.kind === 'clip') {
        const timeline = verifiedOutput.frames.filter(value => value.media_type === 'video');
        const startTime = info.frames[specification.first].time;
        if (timeline.length !== specification.last - specification.first + 1 || timeline.some((value, ordinal) =>
          !Number.isFinite(Number(value.best_effort_timestamp_time)) || Math.abs(Number(value.best_effort_timestamp_time) -
            (info.frames[specification.first + ordinal].time - startTime)) > .001) ||
          !Number.isFinite(Number(video.duration)) || Math.abs(Number(video.duration) - (specification.end - specification.start)) > .002 ||
          verifiedOutput.streams.some(value => value.codec_type === 'audio') !== specification.hasAudio)
          throw issue('EXPORT_VERIFY', '导出片段的帧时间、结束边界或音轨核对未通过，未交付文件。');
      }
      record = { token, directory, file, stat: output.stat, sha256: output.sha256, bytes: Number(output.stat.size), kind: request.kind, specification };
      records.set(token, record);
      return { token, filePath: file, bytes: record.bytes, sha256: record.sha256, kind: request.kind,
        firstOrdinal: specification.first, lastOrdinal: specification.last, width: specification.width, height: specification.height };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (!record) {
        const currentDirectory = plain(directory, true), ownerFile = path.join(directory, 'owner.json');
        if (currentDirectory.dev !== directoryIdentity.dev || currentDirectory.ino !== directoryIdentity.ino ||
            plain(ownerFile).size > 1024 || JSON.parse(fs.readFileSync(ownerFile, 'utf8')).token !== token ||
            fs.readdirSync(directory).some(name => ![path.basename(file), 'owner.json'].includes(name)))
          throw issue('EXPORT_CLEANUP', '导出失败，临时目录身份或内容变化，已保留而未猜测清理。');
        // Only this newly-created job and its exact two known names are owned.
        for (const name of [path.basename(file), 'owner.json']) {
          const target = path.join(directory, name);
          if (fs.existsSync(target)) {
            const current = plain(target);
            if (name !== 'owner.json' && fileIdentity && (current.dev !== fileIdentity.dev || current.ino !== fileIdentity.ino))
              throw issue('EXPORT_CLEANUP', '导出失败，临时文件身份变化，已保留。');
            fs.unlinkSync(target);
          }
        }
        if (!fs.readdirSync(directory).length) fs.rmdirSync(directory);
      }
      throw error;
    }
  }
  function get(token) {
    const record = records.get(token);
    if (!record || !same(record.stat, plain(record.file))) throw issue('EXPORT_IDENTITY', '临时导出身份已变化，未处理文件。');
    return record;
  }
  function discard(token) {
    const record = get(token);
    const ownerFile = path.join(record.directory, 'owner.json'); plain(ownerFile);
    const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
    if (owner.owner !== 'eva-source-export-job-v1' || owner.token !== token) throw issue('EXPORT_IDENTITY', '临时导出归属变化。');
    if (fs.readdirSync(record.directory).sort().join('|') !== [path.basename(record.file), 'owner.json'].sort().join('|'))
      throw issue('EXPORT_IDENTITY', '临时导出目录内容变化，已保留。');
    fs.unlinkSync(record.file);
    fs.unlinkSync(ownerFile); fs.rmdirSync(record.directory); records.delete(token); return true;
  }
  async function publish(token, destination, settings = {}) {
    const record = get(token), output = path.resolve(destination.filePath), parent = path.dirname(output);
    plain(parent, true);
    const within = (file, directory) => { const relative = path.relative(directory, file); return relative === '' || relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
    if (!path.isAbsolute(destination.filePath) || within(output, root) || output.split(/[\\/]/).some(name => /\.library$/i.test(name)) ||
        destination.libraryPath && within(output, path.resolve(destination.libraryPath)) ||
        path.extname(output).toLowerCase() !== (record.kind === 'frame' ? '.png' : '.mp4'))
      throw issue('EXPORT_DESTINATION', '请选择插件和Eagle资料库以外、扩展名正确的本地保存位置。');
    if (fs.existsSync(output)) throw issue('EXPORT_EXISTS', '同名文件已存在，请换一个名称，未覆盖原文件。');
    const partial = path.join(parent, '.eva-export-' + token + '.part');
    const handle = await fs.promises.open(partial, 'wx'); let published = false, partialStat;
    partialStat = await handle.stat({ bigint: true });
    try {
      for await (const bytes of fs.createReadStream(record.file)) {
        check(settings.signal);
        let offset = 0; while (offset < bytes.length) offset += (await handle.write(bytes, offset, bytes.length - offset)).bytesWritten;
      }
      await handle.sync(); partialStat = await handle.stat({ bigint: true }); await handle.close();
      const verified = await fingerprint(partial, settings.signal);
      if (verified.sha256 !== record.sha256 || partialStat.dev !== verified.stat.dev || partialStat.ino !== verified.stat.ino)
        throw issue('EXPORT_VERIFY', '保存副本校验失败，原文件未覆盖。');
      partialStat = verified.stat;
      plain(parent, true); check(settings.signal);
      // Hard-link publication is atomic and never replaces an existing path.
      try { await fs.promises.link(partial, output); }
      catch (error) {
        if (error.code === 'EEXIST') throw issue('EXPORT_EXISTS', '保存时发现同名文件，请换一个名称；原文件未覆盖。');
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(error.code)) throw error;
        // .NET File.Move is an atomic no-replace rename, including exFAT. Never
        // fall back to Node rename, whose overwrite semantics differ.
        try {
          await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            '$ErrorActionPreference="Stop"; [System.IO.File]::Move($env:EVA_EXPORT_PARTIAL,$env:EVA_EXPORT_OUTPUT)'],
          { signal: settings.signal, timeoutMs: 10000, maxBytes: 65536,
            env: { ...process.env, EVA_EXPORT_PARTIAL: partial, EVA_EXPORT_OUTPUT: output } });
        } catch (moveError) {
          const moved = fs.existsSync(output) && plain(output);
          if (!moved || fs.existsSync(partial) || moved.dev !== partialStat.dev || moved.ino !== partialStat.ino) throw moveError;
        }
      }
      published = true;
      let warning = '';
      try { if (fs.existsSync(partial)) await fs.promises.unlink(partial); discard(token); }
      catch (error) { warning = '文件已保存，但临时文件清理未完成：' + error.message; }
      return { status: 'saved', filePath: output, bytes: record.bytes, sha256: record.sha256, ...(warning ? { message: warning } : {}) };
    } finally {
      await handle.close().catch(() => {});
      if (!published && fs.existsSync(partial)) {
        const current = plain(partial);
        if (partialStat && (partialStat.dev !== current.dev || partialStat.ino !== current.ino)) throw issue('EXPORT_IDENTITY', '保存临时文件身份变化，已保留。');
        fs.unlinkSync(partial);
      }
    }
  }
  return { create, publish, discard };
}
module.exports = { createExportStore, _test: { plan, originalDimensions, run, fingerprint }, MAX_BYTES };
