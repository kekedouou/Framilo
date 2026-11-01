'use strict';
// E44: one complete, independently generated asset. Never a seek-time/segment producer.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const {createStorage}=require('./proxy-storage.cjs');
const { spawn: systemSpawn } = require('child_process');
const SCHEMA = 'e44-whole-proxy-v1', MAX_FRAMES = 120000, MAX_JSON = 6 * 1024 * 1024;
const DEFAULT_LIMIT = 5 * 1024 ** 3, RESERVE = 64 * 1024 ** 2;
const VALIDATION_ACCESS=Symbol('read-only production-validator access');
function error(code, message) { return Object.assign(new Error(message), { code }); }
function aborted() { return error('WHOLE_CANCELLED', '整片代理生成已取消。'); }
function canonical(file) { return path.resolve(file); }
function inside(root, file) { const r = path.relative(root, file); return r && !r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r); }
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function regular(file) { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink()) throw error('WHOLE_FILE', '整片代理只读取普通文件。'); return s; }
function stamp(s) { return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':'); }
function check(task) { if (task.cancelled) throw aborted(); }
function integer(value, label) { const s = String(value); if (!/^-?(?:0|[1-9]\d*)$/.test(s) || typeof value === 'number' && !Number.isSafeInteger(value)) throw error('WHOLE_INDEX', label + '时间戳无效。'); return s; }
function base(value) { const b = typeof value === 'string' ? value.split('/').map(Number) : value; if (!Array.isArray(b) || b.length !== 2 || !b.every(n => Number.isSafeInteger(n) && n > 0)) throw error('WHOLE_INDEX', '缺少可靠的帧时间基准。'); return b.slice(); }
function normalize(spec) {
  if (!spec || !spec.source || !path.isAbsolute(spec.source.filePath) || !/^[a-f0-9]{64}$/.test(spec.source.sha256 || '')) throw error('WHOLE_SOURCE', '整片代理缺少已确认的源文件身份。');
  const displayWidth = spec.width, displayHeight = spec.height;
  if (![displayWidth, displayHeight].every(n => Number.isSafeInteger(n) && n >= 1) || Math.max(displayWidth,displayHeight)>3840 || Math.min(displayWidth,displayHeight)>2160) throw error('WHOLE_SIZE', '整片代理尺寸必须在4K UHD预览边界内。');
  // H.264 4:2:0 needs even coded dimensions. Round UP by at most one sample,
  // then restore the original display aspect using SAR. No crop or black pad.
  const width=Math.ceil(displayWidth/2)*2,height=Math.ceil(displayHeight/2)*2;
  const gcd=(a,b)=>b?gcd(b,a%b):a,exactGcd=gcd(displayWidth*height,displayHeight*width);
  let num=displayWidth*height/exactGcd,den=displayHeight*width/exactGcd;
  if(num>65535||den>65535){const ratio=num/den;den=Math.floor(65535/Math.max(1,ratio));num=Math.round(ratio*den);const g=gcd(num,den);num/=g;den/=g;}
  const sampleAspectRatio=num+':'+den;
  const encoder = spec.encoder || 'cpu'; if (!['cpu', 'nvidia'].includes(encoder)) throw error('WHOLE_ENCODER', '代理编码方式无效。');
  let rows = spec.frames;
  if (!rows && spec.sourceIndex) { const i = spec.sourceIndex; rows = i.sorted.map((v, n) => ({ id: n, ptsTicks: i.packets[v.n].sourcePts, timeBase: i.timeBase, time: v.pts / 1e6, end: i.sorted[n + 1] ? i.sorted[n + 1].pts / 1e6 : spec.duration })); }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_FRAMES) throw error('WHOLE_INDEX', '源帧索引为空或超过120000帧。');
  const sourceTimeBase = base(rows[0].timeBase), sourcePts = [], ids = [], indexHash = crypto.createHash('sha256');
  let previous;
  for (let n = 0; n < rows.length; n++) {
    const r = rows[n], b = base(r.timeBase), pts = integer(r.ptsTicks, '源帧');
    if (b[0] !== sourceTimeBase[0] || b[1] !== sourceTimeBase[1] || previous !== undefined && BigInt(pts) <= previous) throw error('WHOLE_INDEX', '源帧必须具有统一且严格递增的PTS；不能猜测或丢弃重复帧。');
    if (!Number.isFinite(r.time) || !Number.isFinite(r.end) || r.end <= r.time) throw error('WHOLE_INDEX', '源帧显示区间无效。');
    previous = BigInt(pts); sourcePts.push(pts); ids.push(Number.isSafeInteger(r.id) ? r.id : n); indexHash.update(pts + ',' + ids[n] + ';');
  }
  const duration = rows[rows.length - 1].end - rows[0].time;
  if (!(Number.isFinite(duration) && duration > 0)) throw error('WHOLE_INDEX', '源视频时长无效。');
  if (spec.video && ['smpte2084', 'arib-std-b67'].includes(spec.video.color_transfer)) throw error('WHOLE_COLOR', 'HDR整片代理尚未验证，继续使用原片。');
  if(spec.validationHardware!==undefined&&typeof spec.validationHardware!=='boolean')throw error('WHOLE_OPTIONS','代理校验解码方式无效。');
  return { source: { filePath: canonical(spec.source.filePath), sha256: spec.source.sha256 }, width, height, displayWidth, displayHeight, sampleAspectRatio, encoder, validationHardware: spec.validationHardware!==false, duration, sourceTimeBase, sourcePts, ids, indexHash: indexHash.digest('hex'), recipe: encoder === 'nvidia' ? 'h264-mp4-nvenc-p1-qp20-all-i-v1' : 'h264-mp4-x264-ultrafast-crf20-all-i-v1' };
}
function encodeArgs(spec, output, byteLimit) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-n', '-copyts', '-threads', '4', '-i', spec.source.filePath,
    '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `setpts=PTS-STARTPTS,scale=${spec.width}:${spec.height}:flags=bilinear:out_range=tv:out_color_matrix=bt709,setsar=sar=${(spec.sampleAspectRatio||'1:1').replace(':','/')}:max=65535,format=yuv420p`,
    '-filter_threads', '2', '-fps_mode', 'passthrough', '-enc_time_base', '1:1000000', '-c:v', spec.encoder === 'nvidia' ? 'h264_nvenc' : 'libx264',
    ...(spec.encoder === 'nvidia' ? ['-preset', 'p1', '-tune', 'ull', '-rc', 'constqp', '-qp', '20', '-init_qpI', '20', '-zerolatency', '1'] : ['-preset', 'ultrafast', '-crf', '20', '-x264-params', 'keyint=1:scenecut=0']),
    '-threads', '2', '-g', '1', '-bf', '0', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', ...(Math.max(spec.width,spec.height)<=2560&&Math.min(spec.width,spec.height)<=1440?['-level:v','5.1']:[]),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-metadata:s:v:0', 'rotate=0',
    '-video_track_timescale', '1000000', '-fs', String(byteLimit), '-progress', 'pipe:1', '-stats_period', '0.2', '-f', 'mp4', output];
}
function probeArgs(file) { return ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_entries', 'stream=codec_name,width,height,time_base,start_pts,duration_ts,sample_aspect_ratio', '-of', 'compact=p=1:nk=0', file]; }
function validationArgs(file,hardware){return ['-hide_banner','-nostdin','-loglevel','info','-copyts','-xerror','-err_detect','explode','-threads','1',...(hardware?['-hwaccel','cuda','-hwaccel_output_format','cuda']:['-hwaccel','none']),'-i',file,'-map','0:v:0','-an','-sn','-dn','-vf','showinfo@verify=checksum=0','-fps_mode','passthrough','-c:v','wrapped_avframe','-f','null','-'];}
function validationLine(line,hardware){
  if(!line.includes('showinfo@verify'))return null;
  const timeBase=/config in time_base:\s*(\d+)\/(\d+)/.exec(line);
  if(timeBase)return{timeBase:[Number(timeBase[1]),Number(timeBase[2])]};
  if(!/\bn:\s*\d+\s+pts:/.test(line))return null;
  const n=/\bn:\s*(\d+)/.exec(line),pts=/\bpts:\s*(-?\d+)/.exec(line),key=/\biskey:\s*(\d+)/.exec(line),size=/\bs:(\d+)x(\d+)/.exec(line),fmt=/\bfmt:(\w+)/.exec(line),sar=/\bsar:(\d+)\/(\d+)/.exec(line);
  if(!n||!pts||!key||!size||!fmt||!sar)throw error('WHOLE_VALIDATE','完整解码校验缺少帧身份或尺寸。');
  if(hardware&&fmt[1]!=='cuda')throw error('WHOLE_GPU_UNCONFIRMED','未确认GPU校验输出，改用CPU完整校验。');
  return{ordinal:Number(n[1]),pts:pts[1],key_frame:key[1],width:Number(size[1]),height:Number(size[2]),pixelFormat:fmt[1],sar:[Number(sar[1]),Number(sar[2])]};
}
function fields(line) { const out = {}; for (const entry of line.split('|').slice(1)) { const at = entry.indexOf('='); if (at >= 0) out[entry.slice(0, at)] = entry.slice(at + 1); } return out; }
function sameAspect(value,spec){
  const actual=String(value).split(':').map(Number),expected=String(spec.sampleAspectRatio||'1:1').split(':').map(Number);
  if(actual.length!==2||expected.length!==2||[...actual,...expected].some(n=>!Number.isSafeInteger(n)||n<=0))return false;
  // FFmpeg/H.264 can reduce a bounded rational through a floating filter option.
  // Accept only numerically equivalent display geometry (under 0.05 source
  // output pixel), never a generic 1:1 substitute for an odd-aspect proxy.
  return Math.abs(actual[0]/actual[1]-expected[0]/expected[1])*spec.width<=.05;
}
function validateProxy(spec, frames, stream) {
  if (frames.length !== spec.sourcePts.length || !stream || stream.codec_name !== 'h264' || Number(stream.width) !== spec.width || Number(stream.height) !== spec.height || !sameAspect(stream.sample_aspect_ratio,spec)) throw error('WHOLE_VALIDATE', '整片代理帧数、尺寸或像素比例校验失败。');
  const proxyTimeBase = base(stream.time_base), proxyPts = [], first = BigInt(integer(frames[0].pts, '代理帧')), sourceFirst = BigInt(spec.sourcePts[0]);
  if (first !== 0n) throw error('WHOLE_VALIDATE', '整片代理起始时间不是零。');
  const sn = BigInt(spec.sourceTimeBase[0]), sd = BigInt(spec.sourceTimeBase[1]), pn = BigInt(proxyTimeBase[0]), pd = BigInt(proxyTimeBase[1]);
  let previous;
  for (let n = 0; n < frames.length; n++) {
    const r = frames[n], pts = BigInt(integer(r.pts, '代理帧'));
    if (r.key_frame !== '1' || previous !== undefined && pts <= previous) throw error('WHOLE_VALIDATE', '整片代理存在非独立帧或无效帧时间。');
    if(r.ordinal!==undefined&&(r.ordinal!==n||r.width!==spec.width||r.height!==spec.height||!Array.isArray(r.sar)||!r.sar.every(v=>Number.isSafeInteger(v)&&v>0)||!sameAspect(r.sar.join(':'),spec)))throw error('WHOLE_VALIDATE','完整解码的帧序号、尺寸或像素比例不一致。');
    // Compare rational relative PTS, allowing only one output tick of quantization.
    const difference = (pts - first) * pn * sd - (BigInt(spec.sourcePts[n]) - sourceFirst) * sn * pd;
    if ((difference < 0n ? -difference : difference) > pn * sd) throw error('WHOLE_VALIDATE', '整片代理源帧时间映射不一致。');
    previous = pts; proxyPts.push(pts.toString());
  }
  const end = BigInt(integer(stream.duration_ts, '代理末尾')) + BigInt(integer(stream.start_pts || '0', '代理起点'));
  if (end <= previous) throw error('WHOLE_VALIDATE', '整片代理末帧显示区间无效。');
  return { proxyTimeBase, proxyPts };
}
async function diskUsage(dir) {
  let sum = 0;
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name), stat = await fs.promises.lstat(file);
    if (stat.isSymbolicLink()) throw error('WHOLE_PATH', '缓存目录包含链接，无法安全计算占用。');
    if (stat.isDirectory()) sum += await diskUsage(file); else if (stat.isFile()) sum += stat.size;
  }
  return sum;
}
async function hashFile(file, task, progress) {
  const before = stamp(regular(file)), hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
  let read=0;const total=regular(file).size;progress?.(0,total);
  for await (const bytes of input) { check(task); hash.update(bytes);read+=bytes.length;progress?.(read,total); }
  if (stamp(regular(file)) !== before) throw error('WHOLE_SOURCE_CHANGED', '文件在处理过程中发生变化。');
  return hash.digest('hex');
}
function processState(pid) { try { process.kill(pid, 0); return 'alive'; } catch (e) { return e.code === 'ESRCH' ? 'dead' : 'unknown'; } }
async function lockRecord(file) {
  const s = regular(file); if (s.size > 2048) throw error('WHOLE_BUSY', '代理占用记录无法确认，可稍后重试。');
  const text = await fs.promises.readFile(file, 'utf8'), owner = JSON.parse(text);
  if (owner.schema !== SCHEMA || !/^[a-f0-9]{32}$/.test(owner.token || '') || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw error('WHOLE_BUSY', '代理占用记录无法确认，可稍后重试。');
  return { owner, text, stat: s };
}
function sameLock(a, b, moved = false) {
  return a.text === b.text && ['dev', 'ino', 'size', 'birthtimeMs', 'mtimeMs', ...(moved ? [] : ['ctimeMs'])].every(k => a.stat[k] === b.stat[k]);
}
async function removeDeadPending(directory, owner) {
  const pending = path.join(directory, '.pending-' + owner.token);
  if (!inside(directory, pending)) return 'not-owned';
  try {
    const stat = await fs.promises.lstat(pending); if (!stat.isDirectory() || stat.isSymbolicLink()) return 'not-owned';
    const file = path.join(pending, 'owner.json'), s = regular(file); if (s.size > 2048) return 'not-owned';
    const text = await fs.promises.readFile(file, 'utf8'), record = JSON.parse(text);
    if (record.schema !== SCHEMA || record.token !== owner.token || record.pid !== owner.pid || processState(owner.pid) !== 'dead') return 'not-owned';
    const names = await fs.promises.readdir(pending);
    if (names.some(n => !['owner.json', 'video.mp4', 'complete.json'].includes(n))) return 'foreign-entry';
    for (const name of names) regular(path.join(pending, name));
    if (stamp(regular(file)) !== stamp(s) || await fs.promises.readFile(file, 'utf8') !== text) return 'changed';
    await fs.promises.rm(pending, { recursive: true }); return 'removed';
  } catch (e) { return e.code === 'ENOENT' ? 'absent' : 'retained'; }
}
async function recoverDeadLock(directory, file, task) {
  const first = await lockRecord(file);
  if (processState(first.owner.pid) !== 'dead') throw error('WHOLE_BUSY', '另一代理任务仍占用此视频，继续使用原片，可稍后重试。');
  const second = await lockRecord(file);
  if (!sameLock(first, second) || processState(second.owner.pid) !== 'dead') throw error('WHOLE_BUSY', '代理占用状态发生变化，可稍后重试。');
  const quarantine = path.join(directory, '.recovered-lock-' + task.token);
  await fs.promises.rename(file, quarantine); // Atomic isolation, then confirm the exact moved record.
  const moved = await lockRecord(quarantine);
  if (!sameLock(second, moved, true) || processState(moved.owner.pid) !== 'dead') {
    // Never overwrite a fresh lock. link() creates the original name exclusively.
    try { await fs.promises.link(quarantine, file); await fs.promises.unlink(quarantine); } catch (_) { /* Retain the isolated record if another owner already won. */ }
    throw error('WHOLE_BUSY', '代理占用状态发生变化，已保留占用记录，可稍后重试。');
  }
  const pending = await removeDeadPending(directory, moved.owner);
  await fs.promises.unlink(quarantine);
  const summary = { schema: SCHEMA, recoveredAt: new Date().toISOString(), token: moved.owner.token, previousPid: moved.owner.pid, action: 'dead-lock-recovered', pending };
  // One bounded recovery receipt, separate from persisted complete assets and raw test evidence.
  const summaryFile = path.join(directory, 'last-recovery.json');
  try { if (fs.existsSync(summaryFile)) regular(summaryFile); await fs.promises.writeFile(summaryFile, JSON.stringify(summary)); } catch (_) { /* Recovery itself has already safely completed. */ }
  return summary;
}
function createWholeProxy(options = {}) {
  if (!path.isAbsolute(options.cacheRoot || '') || !options.tools || !['ffmpeg', 'ffprobe'].every(n => path.isAbsolute(options.tools[n] || ''))) throw error('WHOLE_OPTIONS', '整片代理缺少缓存目录或媒体工具路径。');
  const cacheRoot = canonical(options.cacheRoot), capacityRoot = canonical(options.capacityRoot || options.cacheRoot), directory = path.join(cacheRoot, 'whole-v1'), limitBytes = options.limitBytes === undefined ? DEFAULT_LIMIT : options.limitBytes;
  if (capacityRoot !== cacheRoot && !inside(capacityRoot, cacheRoot)) throw error('WHOLE_OPTIONS', '总缓存额度目录必须包含整片代理目录。');
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 1 || limitBytes > 100*1024**3) throw error('WHOLE_BUDGET', '整片代理磁盘额度无效。');
  const storage=createStorage(cacheRoot),tasks=new Set();
  const spawn = options.spawn || systemSpawn, owned = new Set(), inspections = new Set(); let current = null, closed = false;
  function notify(task, patch) {
    // Full mappings belong exclusively to ready's result, never UI snapshots/notifications.
    const { asset: completedAsset, ...visiblePatch } = patch;
    const status = patch.status || task.state.status, failure = patch.error === undefined ? task.state.error : patch.error;
    const stage = status === 'ready' ? 'complete' : status === 'failed' ? failure?.code === 'WHOLE_BUDGET' ? 'budget' : 'error' : status === 'cancelled' ? 'cancelled' : 'preparing';
    task.state = Object.freeze({ ...task.state, ...visiblePatch, stage,
      ...(completedAsset ? { assetInfo: Object.freeze({ filePath: completedAsset.filePath, bytes: completedAsset.bytes, width: completedAsset.width, height: completedAsset.height, frames: completedAsset.sourcePts.length, encoder: completedAsset.encoder }) } : {}),
      ready: status === 'ready' ? task.spec?.sourcePts.length || 0 : 0,
      total: task.spec?.sourcePts.length || 0,
      readyRanges: status === 'ready' ? Object.freeze([Object.freeze({ start: 0, end: task.spec.duration })]) : Object.freeze([]) });
    try { options.onChange?.(task.state); } catch (_) { /* Observers never own generation. */ }
    try { task.onChange?.(task.state); } catch (_) { /* Same boundary for per-request UI. */ }
  }
  function validationProgress(task,phase,done,total,message,extra={}){
    const now=Date.now();if(task.validationLastPhase===phase&&done<total&&now-task.validationLastAt<200)return;
    task.validationLastPhase=phase;task.validationLastAt=now;
    notify(task,{status:'validating',validationPhase:phase,validationDone:done,validationTotal:total,validationProgress:total>0?Math.min(1,Math.max(0,done/total)):null,message,...extra});
  }
  function runChild(task, executable, args, onLine, onErrorLine) {
    check(task);
    return new Promise((resolve, reject) => {
      let child, pending = '', pendingError = '', tail = '', failure;
      try { child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { reject(e); return; }
      task.child = child; owned.add(child);
      const fail = e => { failure = failure || e;pending='';pendingError='';try { child.kill(); } catch (_) {} };
      child.once('error', fail);
      child.stderr.on('data', bytes => {
        if(failure)return;
        if(bytes.length>1024*1024){fail(error('WHOLE_PROTOCOL','媒体工具错误输出块超过上限。'));return;}
        const text=bytes.toString();tail=(tail+text).slice(-8192);
        if(!onErrorLine)return;
        pendingError+=text;const lines=pendingError.split(/\r?\n/);pendingError=lines.pop();
        if(pendingError.length>65536){fail(error('WHOLE_PROTOCOL','媒体工具错误输出行超过上限。'));return;}
        for(const line of lines)try{if(line.length>65536)throw error('WHOLE_PROTOCOL','媒体工具错误输出行超过上限。');onErrorLine(line);}catch(e){fail(e);break;}
      });
      child.stdout.on('data', bytes => {
        if(failure)return;
        if (bytes.length > 1024 * 1024) { fail(error('WHOLE_PROTOCOL', '媒体工具输出块超过上限。')); return; }
        pending += bytes.toString();
        const lines = pending.split(/\r?\n/); pending = lines.pop();
        if (pending.length > 65536) { fail(error('WHOLE_PROTOCOL', '媒体工具输出行超过上限。')); return; }
        for (const line of lines) try { if (line.length > 65536) throw error('WHOLE_PROTOCOL', '媒体工具输出行超过上限。'); onLine?.(line); } catch (e) { fail(e); break; }
      });
      child.once('close', (code, signal) => {
        owned.delete(child); if (task.child === child) task.child = null;
        if (pending && !failure) try { onLine?.(pending); } catch (e) { failure = e; }
        if(pendingError&&!failure)try{onErrorLine?.(pendingError);}catch(e){failure=e;}
        if (task.cancelled) reject(aborted());
        else if (failure) reject(failure);
        else if (code !== 0) reject(error('WHOLE_PROCESS', '整片代理媒体任务失败：' + (tail.trim() || code || signal)));
        else resolve();
      });
    });
  }
  async function decodeValidation(task,spec,file,stream){
    const attempt=async hardware=>{
      const frames=[],expectedBase=base(stream.time_base);let decodedBase=null;
      task.validationLastPhase=null;validationProgress(task,'frames',0,spec.sourcePts.length,hardware?'逐帧校验代理（GPU）':'逐帧校验代理（CPU）',{validationDecoder:hardware?'cuda':'cpu'});
      await runChild(task,options.tools.ffmpeg,validationArgs(file,hardware),null,line=>{
        const row=validationLine(line,hardware);if(!row)return;
        if(row.timeBase){const b=base(row.timeBase);if(BigInt(b[0])*BigInt(expectedBase[1])!==BigInt(expectedBase[0])*BigInt(b[1]))throw error('WHOLE_VALIDATE','完整解码校验时间基不一致。');decodedBase=b;return;}
        if(!decodedBase)throw error('WHOLE_VALIDATE','完整解码未确认帧时间基。');
        if(frames.length>=MAX_FRAMES||row.ordinal!==frames.length)throw error('WHOLE_VALIDATE','完整解码帧序号或数量无效。');
        frames.push(row);validationProgress(task,'frames',frames.length,spec.sourcePts.length,hardware?'逐帧校验代理（GPU）':'逐帧校验代理（CPU）');
      });
      if(!decodedBase)throw error('WHOLE_VALIDATE','完整解码缺少校验结果。');
      return validateProxy(spec,frames,stream);
    };
    if(spec.validationHardware){
      try{return await attempt(true);}
      catch(failure){
        if(task.cancelled||failure.code==='WHOLE_CANCELLED')throw failure;
        // A GPU validation failure never publishes its partial/mismatched result. A single
        // complete CPU decode must independently satisfy every original identity check.
        notify(task,{validationFallback:String(failure.message||failure).slice(-512),message:'GPU校验不可用，改用CPU完整校验'});
      }
    }
    return attempt(false);
  }
  async function verifyAsset(task,spec,file){
    const before=stamp(regular(file)),sourceBefore=stamp(regular(spec.source.filePath)),timings={};let began=Date.now(),stream;
    validationProgress(task,'metadata',0,0,'正在核对代理尺寸与容器',{remainingSeconds:null});
    await runChild(task,options.tools.ffprobe,probeArgs(file),line=>{if(line.startsWith('stream|'))stream=fields(line);});
    if(!stream||stream.codec_name!=='h264'||Number(stream.width)!==spec.width||Number(stream.height)!==spec.height||!sameAspect(stream.sample_aspect_ratio,spec))throw error('WHOLE_VALIDATE','整片代理尺寸、容器或像素比例校验失败。');
    timings.metadataMs=Date.now()-began;began=Date.now();
    const mapping=await decodeValidation(task,spec,file,stream);timings.framesMs=Date.now()-began;began=Date.now();
    const sourceHash=await hashFile(spec.source.filePath,task,(done,total)=>validationProgress(task,'source-hash',done,total,'正在核对源视频完整性'));
    if(sourceHash!==spec.source.sha256)throw error('WHOLE_SOURCE_CHANGED','源视频在代理生成过程中发生变化。');
    timings.sourceHashMs=Date.now()-began;began=Date.now();
    const fileHash=await hashFile(file,task,(done,total)=>validationProgress(task,'proxy-hash',done,total,'正在核对代理文件完整性'));
    timings.proxyHashMs=Date.now()-began;
    if(stamp(regular(file))!==before)throw error('WHOLE_SOURCE_CHANGED','代理文件在完整校验过程中发生变化。');
    if(stamp(regular(spec.source.filePath))!==sourceBefore)throw error('WHOLE_SOURCE_CHANGED','源视频在完整校验过程中发生变化。');
    return{mapping,sha256:fileHash,fileStamp:before,sourceStamp:sourceBefore,validation:{method:'full-decode-showinfo-v1',decoder:task.state.validationDecoder,fallback:task.state.validationFallback||null,frames:spec.sourcePts.length,timings}};
  }
  async function cleanup(task) {
    // Only a current-run random directory bearing this exact ownership token may be removed.
    let temporaryReleased = !task.temp, lockReleased = !task.lock;
    if (task.temp && inside(directory, task.temp)) {
      try { const stat=await fs.promises.lstat(task.temp);
        if(!stat.isDirectory()||stat.isSymbolicLink()||path.resolve(await fs.promises.realpath(task.temp)).toLowerCase()!==path.resolve(task.temp).toLowerCase())throw Error('临时目录身份不符');
        const ownerFile=path.join(task.temp,'owner.json');if(regular(ownerFile).size>2048)throw Error('临时归属记录过大');
        const owner = JSON.parse(await fs.promises.readFile(ownerFile, 'utf8'));
        if (owner.schema !== SCHEMA || owner.token !== task.token || owner.pid !== process.pid)throw Error('临时文件归属已变化');
        const names=await fs.promises.readdir(task.temp);if(names.some(n=>!['owner.json','video.mp4','complete.json'].includes(n)))throw Error('临时目录含未知文件');
        for(const name of names)regular(path.join(task.temp,name));
        await fs.promises.rm(task.temp, { recursive: true }); temporaryReleased = true;
      } catch (e) {
        // A missing owner/file is not proof that the directory was removed.
        if(e.code==='ENOENT')try{await fs.promises.lstat(task.temp);}catch(missing){if(missing.code==='ENOENT')temporaryReleased=true;}
        if(!temporaryReleased)notify(task,{cleanupMessage:'临时代理清理未完成：'+e.message});
      }
    }
    // Keep the owning lock if recovery failed, so a later restart can identify
    // the orphan. Do not turn a known partial into an unowned directory.
    if (task.lock && temporaryReleased) {
      try { const owner = JSON.parse(await fs.promises.readFile(task.lock, 'utf8')); if (owner.token === task.token) { await fs.promises.unlink(task.lock); lockReleased = true; } } catch (e) { if (e.code === 'ENOENT') lockReleased = true; else notify(task, { cleanupMessage: '代理锁清理未完成。' }); }
    }
    notify(task, { cleanupComplete: temporaryReleased && lockReleased, temporaryReleased, lockReleased });
  }
  function asset(metadata, dir, reused) {
    return Object.freeze({ ...metadata, directory: dir, filePath: path.join(dir, 'video.mp4'), reused,
      frames: metadata.proxyPts.map((pts, n) => Object.freeze({ id: metadata.ids[n], sourcePtsTicks: metadata.sourcePts[n], sourceTimeBase: metadata.sourceTimeBase, proxyPtsTicks: pts, proxyTimeBase: metadata.proxyTimeBase })) });
  }
  async function execute(task, input, previous) {
    try {
      if (previous) await previous.ready;
      check(task); const spec = normalize(input); task.spec = spec;
      await fs.promises.mkdir(directory, { recursive: true });
      if ((await fs.promises.lstat(cacheRoot)).isSymbolicLink() || (await fs.promises.lstat(directory)).isSymbolicLink()) throw error('WHOLE_PATH', '整片缓存目录不能是链接。');
      const sourceInitialStamp=stamp(regular(spec.source.filePath));
      notify(task, { status: 'checking', message: '正在检查整片代理', duration: spec.duration, encoder: spec.encoder });
      if (await hashFile(spec.source.filePath, task) !== spec.source.sha256) throw error('WHOLE_SOURCE_CHANGED', '视频内容与源帧索引不一致。');
      const toolHashes = {};
      for (const tool of ['ffmpeg', 'ffprobe']) toolHashes[tool] = await hashFile(options.tools[tool], task);
      const identity = { schema: SCHEMA, sourceHash: spec.source.sha256, indexHash: spec.indexHash, width: spec.width, height: spec.height, recipe: spec.recipe, toolHashes, ...(spec.displayWidth!==spec.width||spec.displayHeight!==spec.height?{displayWidth:spec.displayWidth,displayHeight:spec.displayHeight,sampleAspectRatio:spec.sampleAspectRatio}: {}) };
      const key = sha(JSON.stringify(identity)), destination = path.join(directory, key); task.key = key;
      task.readLease=await storage.acquire(key);
      const metadataPath = path.join(destination, 'complete.json');
      try {
        const stat = regular(metadataPath); if (stat.size > MAX_JSON) throw error('WHOLE_CACHE_INVALID', '代理元数据超过上限。');
        const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
        if (metadata.schema !== SCHEMA || metadata.key !== key || metadata.sourceHash !== spec.source.sha256 || !metadata.allKeyFrames ||
            !/^[a-f0-9]{64}$/.test(metadata.sha256 || '') || !Number.isSafeInteger(metadata.bytes) || metadata.bytes < 1 ||
            JSON.stringify(metadata.identity) !== JSON.stringify(identity) || !Array.isArray(metadata.sourcePts) || !Array.isArray(metadata.proxyPts) ||
            metadata.sourcePts.length !== spec.sourcePts.length || metadata.proxyPts.length !== spec.sourcePts.length ||
            sha(JSON.stringify(metadata.sourcePts)) !== sha(JSON.stringify(spec.sourcePts)) || JSON.stringify(metadata.ids) !== JSON.stringify(spec.ids) ||
            JSON.stringify(metadata.sourceTimeBase) !== JSON.stringify(spec.sourceTimeBase) || metadata.width !== spec.width || metadata.height !== spec.height || (metadata.sampleAspectRatio||'1:1')!==spec.sampleAspectRatio || metadata.duration !== spec.duration)
          throw error('WHOLE_CACHE_INVALID', '已存代理身份或映射不匹配。');
        const reusedBase = base(metadata.proxyTimeBase);
        validateProxy(spec, metadata.proxyPts.map(pts => ({ pts, key_frame: '1' })), { codec_name: 'h264', width: spec.width, height: spec.height, sample_aspect_ratio: spec.sampleAspectRatio, time_base: reusedBase, start_pts: '0', duration_ts: String(Math.round(spec.duration * reusedBase[1] / reusedBase[0])) });
        if (regular(path.join(destination, 'video.mp4')).size !== metadata.bytes || await hashFile(path.join(destination, 'video.mp4'), task) !== metadata.sha256) throw error('WHOLE_CACHE_INVALID', '已存整片代理内容校验失败。');
        check(task);if(stamp(regular(spec.source.filePath))!==sourceInitialStamp)throw error('WHOLE_SOURCE_CHANGED','源视频在复用校验过程中发生变化。');await storage.touch(key);const result = asset(metadata, destination, true); notify(task, { status: 'ready', message: '已使用完整代理', progress: 1, bytes: metadata.bytes, asset: result }); return result;
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const space=require('./media-space.cjs');
      const estimateRange=require('./media-policy.cjs').largeProxy(spec,limitBytes);
      const confirmSpace=async actual=>{const used=await diskUsage(capacityRoot),free=await (options.freeBytes||space.freeBytes)(capacityRoot);check(task);
        if(!input.requestDecision)throw error('WHOLE_BUDGET','临时空间需要确认，继续播放原片。');
        notify(task,{status:'awaiting',message:'临时文件将超过1 GB，等待确认；原片可继续播放'});
        const choice=await input.requestDecision(space.decision({...estimateRange,used,free,actual}),task.decisionController.signal);check(task);
        if(choice!=='generate'){task.cancelled=true;check(task);}task.spaceConsented=true;
      };
      if(options.temporary){if(!task.spaceConsented&&await diskUsage(capacityRoot)+estimateRange.high>=space.CONSENT_BYTES)await confirmSpace(false);}
      else {
      const estimateRange=require('./media-policy.cjs').largeProxy(spec,limitBytes);
      if(estimateRange.confirm && input.requestDecision){
        notify(task,{status:'awaiting',message:'大代理待确认，原片可继续播放'});
        const gib=n=>(n/1024**3).toFixed(1);
        const choice=await input.requestDecision({kind:'large-proxy',title:'生成较大的代理？',body:'预计约 '+gib(estimateRange.low)+'–'+gib(estimateRange.high)+' GiB（内容复杂时可能超出），当前额度 '+gib(limitBytes)+' GiB。会先清理可淘汰旧缓存；仍不足则回收本次未完成代理，继续原片。',choices:[{value:'generate',label:'生成代理'},{value:'source',label:'继续原片'}]},task.decisionController.signal);
        check(task);if(choice!=='generate'){task.cancelled=true;check(task);}
      }
      }
      const lock = path.join(directory, key + '.lock'), lockBody = JSON.stringify({ schema: SCHEMA, token: task.token, pid: process.pid, createdAt: new Date().toISOString() });
      try { await fs.promises.writeFile(lock, lockBody, { flag: 'wx' }); }
      catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const recovery = await recoverDeadLock(directory, lock, task); notify(task, { recovery });
        check(task);
        try { await fs.promises.writeFile(lock, lockBody, { flag: 'wx' }); }
        catch (retry) { if (retry.code === 'EEXIST') throw error('WHOLE_BUSY', '另一代理任务已开始处理此视频，可稍后重试。'); throw retry; }
      }
      task.lock = lock;
      task.allocation=await storage.allocation();
      const estimate=Math.min(limitBytes,Math.max(RESERVE+1024**2,Math.ceil(spec.width*spec.height*spec.sourcePts.length*.25)+RESERVE));
      if(!options.temporary)await storage.makeRoom(limitBytes,estimate,spec.source.sha256);
      const used = await diskUsage(capacityRoot);if(options.reserveSpace)task.spaceLease=await options.reserveSpace({used,consented:task.spaceConsented});
      const available = task.spaceLease?task.spaceLease.bytes:options.temporary?space.allowance({used,free:await (options.freeBytes||space.freeBytes)(capacityRoot),consented:task.spaceConsented}):limitBytes-used;
      if (available <= RESERVE) throw error('WHOLE_BUDGET', '缓存剩余额度不足，继续使用原片。');
      task.temp = path.join(directory, '.pending-' + task.token); await fs.promises.mkdir(task.temp);
      await fs.promises.writeFile(path.join(task.temp, 'owner.json'), JSON.stringify({ schema: SCHEMA, token: task.token, pid: process.pid,sourceHash:spec.source.sha256 }));
      const output = path.join(task.temp, 'video.mp4'), started = Date.now();
      let outputLimit = available - RESERVE,bytes,verified;
      for(let attempt=0;attempt<2;attempt++){try{
      notify(task, { status: 'encoding', message: '后台生成整片代理', progress: 0, sourceDecoder: 'cpu', recipe: spec.recipe });
      await runChild(task, options.tools.ffmpeg, encodeArgs(spec, output, outputLimit), line => {
        const at = line.indexOf('='); if (at < 0) return; const name = line.slice(0, at), value = line.slice(at + 1);
        if (name === 'out_time_us') {
          const seconds = Number(value) / 1e6, elapsed = (Date.now() - started) / 1000;
          if (Number.isFinite(seconds) && seconds >= 0) notify(task, { processedSeconds: seconds, progress: Math.min(.99, seconds / spec.duration), elapsedSeconds: elapsed, speed: elapsed > 0 ? seconds / elapsed : 0, remainingSeconds: seconds > 0 ? Math.max(0, (spec.duration - seconds) * elapsed / seconds) : null });
        } else if (name === 'total_size') {
          const bytes = Number(value); if (Number.isFinite(bytes) && bytes >= 0) { notify(task, { bytes }); if (bytes > outputLimit) throw error('WHOLE_BUDGET', '当前视频临时文件达到可用空间边界，继续播放原片。'); }
        }
      });
      check(task); bytes = regular(output).size;
      if (bytes > outputLimit || await diskUsage(capacityRoot) > limitBytes - MAX_JSON) throw error('WHOLE_BUDGET', '当前视频临时文件达到可用空间边界，继续播放原片。');
      notify(task, { status: 'validating', message: '正在校验完整代理', progress: .99, bytes, remainingSeconds:null });
      try { verified = await verifyAsset(task,spec,output); }
      catch (failure) { if (bytes >= outputLimit - 8 * 1024 ** 2) throw error('WHOLE_BUDGET', '当前视频临时文件达到可用空间边界，继续播放原片。'); throw failure; }
      break;
      }catch(failure){
        check(task);
        if(failure.code!=='WHOLE_BUDGET'||attempt!==0)throw failure;
        // The initial estimate is not a promise about compressed size. Before
        // reporting quota exhaustion, release remaining eligible old proxies and
        // retry the owned temporary output once with the recovered room.
        const owner=JSON.parse(await fs.promises.readFile(path.join(task.temp,'owner.json'),'utf8'));
        if(owner.token!==task.token||owner.pid!==process.pid||!inside(directory,output))throw error('WHOLE_PATH','临时代理身份变化，停止重试。');
        regular(output);await fs.promises.unlink(output);
        if(options.temporary){
          if(task.spaceConsented)throw failure;
          await task.spaceLease?.release();task.spaceLease=null;
          await confirmSpace(true);
          const used=await diskUsage(capacityRoot);if(options.reserveSpace)task.spaceLease=await options.reserveSpace({used,consented:true});
          outputLimit=(task.spaceLease?task.spaceLease.bytes:space.allowance({used,free:await (options.freeBytes||space.freeBytes)(capacityRoot),consented:true}))-RESERVE;
        }else{
          const room=await storage.makeRoom(limitBytes,limitBytes,spec.source.sha256);if(!room.removed)throw failure;
          outputLimit=limitBytes-await diskUsage(capacityRoot)-RESERVE;
        }
        if(outputLimit<=0)throw failure;
        notify(task,{status:'encoding',message:options.temporary?'已确认临时占用，重新生成整片代理':'已释放旧代理空间，重新生成整片代理',progress:0,bytes:0});
      }}
      const metadata = { schema: SCHEMA, identity, key, sourceHash: spec.source.sha256, sourcePts: spec.sourcePts, sourceTimeBase: spec.sourceTimeBase, ids: spec.ids, ...verified.mapping, allKeyFrames: true, width: spec.width, height: spec.height, displayWidth:spec.displayWidth,displayHeight:spec.displayHeight,sampleAspectRatio:spec.sampleAspectRatio,duration: spec.duration, bytes, sha256: verified.sha256,validation:verified.validation, encoder: spec.encoder, recipe: spec.recipe, sourceDecoder: 'cpu', audio: 'original-source-clock', generatedAt: new Date().toISOString(), generationMs: Date.now() - started };
      const json = JSON.stringify(metadata); if (Buffer.byteLength(json) > MAX_JSON) throw error('WHOLE_METADATA', '整片代理映射超过控制文件上限。');
      validationProgress(task,'publish',0,0,'正在写入并提交完整代理');
      const sameSource=()=>stamp(regular(spec.source.filePath))===sourceInitialStamp&&stamp(regular(spec.source.filePath))===verified.sourceStamp;
      if(!sameSource()||stamp(regular(output))!==verified.fileStamp)throw error('WHOLE_SOURCE_CHANGED','源视频或代理文件在提交前发生变化。');
      const metaFile = await fs.promises.open(path.join(task.temp, 'complete.json'), 'wx'); try { await metaFile.writeFile(json); await metaFile.sync(); } finally { await metaFile.close(); }
      const video = await fs.promises.open(output, 'r+'); try { await video.sync(); } finally { await video.close(); }
      check(task);if(!sameSource()||stamp(regular(output))!==verified.fileStamp)throw error('WHOLE_SOURCE_CHANGED','源视频或代理文件在提交前发生变化。');await fs.promises.rename(task.temp, destination); task.temp = null;
      if(!sameSource())throw error('WHOLE_SOURCE_CHANGED','源视频在代理提交时发生变化。');await storage.touch(key);const result = asset(metadata, destination, false); notify(task, { status: 'ready', message: '整片代理已完成', progress: 1, asset: result, generationMs: metadata.generationMs }); return result;
    } catch (failure) {
      const cancelled = task.cancelled || failure.code === 'WHOLE_CANCELLED';
      const unavailable=failure.code==='WHOLE_PROCESS'&&/(?:unknown encoder ['"]?h264_nvenc|cannot load (?:nvcuda|nvencodeapi|libnvidia-encode)|no (?:nvenc capable|capable devices|cuda capable)|openencodesessionex failed|driver does not support|required nvidia driver|cuda_error_no_device|unsupported device)/i.test(failure.message);
      if(!cancelled&&task.spec?.encoder==='nvidia'&&unavailable){
        await cleanup(task);if(task.allocation){await task.allocation();task.allocation=null;}if(task.readLease){await task.readLease();task.readLease=null;}
        if(task.state.cleanupComplete){
        await task.spaceLease?.release();task.spaceLease=null;task.temp=null;task.lock=null;task.key=null;
        notify(task,{status:'checking',message:'GPU编码不可用，自动改用CPU生成代理',encoder:'cpu',encoderFallback:true});
        return await execute(task,{...input,encoder:'cpu'},null);
        }
      }
      notify(task,{status:'cleaning',message:'正在回收未完成的代理，原片仍可播放'});
      await cleanup(task);task.failureCleaned=true;
      const incomplete=!task.state.cleanupComplete;
      const message=incomplete?(task.state.cleanupMessage||'临时代理清理未完成，请关闭当前视频后重试；原片仍可播放。'):
        cancelled?'整片代理已取消，临时文件已回收':failure.code==='WHOLE_BUDGET'?'临时空间不足；未完成文件已回收，继续播放原片。':/ENOSPC|No space left on device/i.test(failure.code+' '+failure.message)?'硬盘可用空间不足；未完成文件已回收，继续播放原片。请释放硬盘空间后重试。':failure.message;
      notify(task, { status: cancelled&&!incomplete ? 'cancelled' : 'failed', bytes:task.state.temporaryReleased?0:task.state.bytes, message,
        error:cancelled&&!incomplete?null:{code:incomplete?'WHOLE_CLEANUP_FAILED':failure.code||'WHOLE_FAILED',message} });
      return null;
    } finally { await task.spaceLease?.release();task.spaceLease=null;if(!task.failureCleaned)await cleanup(task);if(task.allocation){await task.allocation();task.allocation=null;}if(task.state.status!=='ready'&&task.readLease){await task.readLease();task.readLease=null;} }
  }
  function start(spec) {
    if (closed) throw error('WHOLE_CLOSED', '整片代理服务已关闭。');
    if (current && current.input === spec) return current.handle;
    const previous = current; if (previous) previous.handle.cancel();
    const task = { token: crypto.randomBytes(16).toString('hex'), input: spec, cancelled: false, decisionController:new AbortController(), child: null, state: Object.freeze({ status: 'queued', stage: 'preparing', progress: 0, ready: 0, total: 0, readyRanges: Object.freeze([]), message: '整片代理等待启动' }), onChange: spec.onChange };
    task.handle = { ready: null, snapshot: () => task.state, cancel: () => { task.cancelled = true; task.decisionController.abort(); try { task.child?.kill(); } catch (_) {} return task.ready; } };
    tasks.add(task);task.handle.release=async()=>{await task.handle.cancel();if(task.readLease){await task.readLease();task.readLease=null;}tasks.delete(task);};
    current = task; task.ready = Promise.resolve().then(() => execute(task, spec, previous)); task.handle.ready = task.ready; return task.handle;
  }
  // Developer read-only hook: uses the exact publication validator, never regenerates media.
  async function validateExisting(spec,file,settings={}){
    if(closed)throw error('WHOLE_CLOSED','整片代理服务已关闭。');
    const task={cancelled:false,child:null,state:Object.freeze({status:'validating'}),onChange:settings.onChange},stop=()=>{task.cancelled=true;try{task.child?.kill();}catch(_){}};
    const work=Promise.resolve().then(()=>{if(!path.isAbsolute(file))throw error('WHOLE_FILE','校验文件路径必须为绝对路径。');check(task);return verifyAsset(task,normalize(spec),file);});
    const entry={stop,work};inspections.add(entry);settings.signal?.addEventListener('abort',stop,{once:true});if(settings.signal?.aborted)stop();
    try{return await work;}finally{settings.signal?.removeEventListener('abort',stop);inspections.delete(entry);}
  }
  if(typeof options[VALIDATION_ACCESS]==='function')options[VALIDATION_ACCESS](validateExisting);
  return { start, clearOther:hash=>storage.clearOther(hash),measure:(hash,options)=>storage.measure(hash,options),pids:()=>[...owned].map(c=>c.pid).filter(Number.isSafeInteger), snapshot: () => current ? current.state : Object.freeze({ status: 'idle', progress: 0 }), async close() { closed = true;for(const entry of inspections)entry.stop();await Promise.allSettled([...inspections].map(e=>e.work));await current?.handle.cancel();for(const task of tasks)await task.handle.release(); for (const child of owned) try { child.kill(); } catch (_) {} }, capabilities: Object.freeze({ pause: false, cancel: true, fullAssetOnly: true }) };
}
async function validateExisting(options,spec,file,settings){let invoke;const service=createWholeProxy({...options,[VALIDATION_ACCESS]:fn=>{invoke=fn;}});try{return await invoke(spec,file,settings);}finally{await service.close();}}
module.exports = { createWholeProxy, SCHEMA, _test: { normalize, encodeArgs, probeArgs, validationArgs, validationLine, validateProxy, validateExisting, fields, diskUsage } };
