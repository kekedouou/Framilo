'use strict';

// Formal cache ownership, bounded I/O and guarded cache maintenance.
// Unknown locks/partials remain protected, never inferred dead from a PID.
const fs = require('fs');
const path = require('path');
// Node16's Windows native realpath may reject existing long ordinary paths.
// Extended input retains OS canonicalization; resolved paths still face the same guards.
const nativeRealpath = fs.realpathSync.native;
const realpath = typeof nativeRealpath === 'function'
  ? file => nativeRealpath(process.platform === 'win32' ? path.toNamespacedPath(file) : file)
  : fs.realpathSync;
const crypto = require('crypto');
const { validateIndex } = require('./frame-index.cjs');
const { createIdentity } = require('./process-identity.cjs');
const framePack = require('./frame-pack.cjs');
const previewProfile = require('./preview-profile.cjs');
const OWNER = 'eagle-video-analysis-plugin-v1';
// Retained ownership namespace for legacy roots and recovery receipts.
// New preview dimensions/version belong to manifest.preview and variantIds.
const RECIPE = 'jpeg-q3-720p-pcm-f32-48000-v1';
const MIB = 1024 ** 2;
const LIMITS = Object.freeze({ cacheBytes: 5 * 1024 * MIB, metadataBytes: 8 * MIB,
  assetBytes: 256 * MIB, duration: Infinity, prefixBytes: 4096 });
const MANIFEST_MEMO_LIMITS = Object.freeze({ entries: 4096, bytes: 32 * MIB });
const manifestMemoDiagnostics = new WeakMap();
const recipeId = crypto.createHash('sha256').update(RECIPE).digest('hex').slice(0, 12);
// Preserve legacy identifiers/receipts; new variants share this same root and budget.
const variantIds = new Map(previewProfile.QUALITIES.map(q => [q, crypto.createHash('sha256').update(RECIPE + ':' + previewProfile.VERSION + ':' + q).digest('hex').slice(0, 12)]));
const knownIds = new Set([recipeId, ...variantIds.values()]);
const cachePattern = new RegExp('^media-([0-9a-f]{64})-(' + [...knownIds].join('|') + ')$');
function variantId(selected) { return selected === undefined ? recipeId : variantIds.get(previewProfile.quality(selected)); }
function cacheLeaf(sourceSha256, selected) { return 'media-' + sourceSha256 + '-' + variantId(selected); }
function matchesSource(dir, sourceSha256) { const m = cachePattern.exec(path.basename(dir)); return !!m && m[1] === sourceSha256; }
const activeRoots = new Set();
const nonce = () => crypto.randomBytes(12).toString('hex');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function fail(message) { throw new Error(message); }
function cancelled(signal) {
  if (signal && signal.aborted) { const error = new Error('缓存处理已取消。'); error.name = 'AbortError'; throw error; }
}
function safeName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) || /\.$/.test(name) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) fail('缓存文件名不安全。');
  return name;
}
function samePath(left, right) {
  const a = path.resolve(left), b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function directory(dir) {
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(realpath(dir), dir)) fail('缓存目录不能使用链接或重解析路径。');
  return stat;
}
function regular(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || !samePath(realpath(file), file)) fail('缓存文件必须是唯一链接的普通文件。');
  return stat;
}
function sameFile(stat, other) { return stat.isFile() && other.isFile() && stat.ino === other.ino && stat.dev === other.dev && other.nlink === 1; }
function ledgerId(value) {
  if (typeof value === 'bigint' && value >= 0n && value <= 18446744073709551615n) return value.toString();
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n) return value;
  fail('残留临时账本文件编号精度不足或无效；保留原件。');
}
function jsonBytes(value) {
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > LIMITS.metadataBytes) fail('缓存元数据超过容量限制。');
  return data;
}
function readJSON(file, before = regular(file)) {
  if (before.size > LIMITS.metadataBytes) fail('缓存元数据超过容量限制。');
  const fd = fs.openSync(file, 'r');
  try {
    if (!sameFile(before, fs.fstatSync(fd))) fail('缓存元数据身份已改变。');
    const data = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (data.length !== before.size || !sameFile(before, after) || before.mtimeMs !== after.mtimeMs || !sameFile(before, regular(file))) fail('读取期间缓存元数据已改变。');
    return JSON.parse(data.toString('utf8'));
  } finally { fs.closeSync(fd); }
}
function sameVerifiedStamp(before, after) {
  return before.isFile() && after.isFile() && before.ino === after.ino && before.dev === after.dev &&
    before.nlink === 1n && after.nlink === 1n && before.size === after.size &&
    before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}
// Only immutable complete manifests use this reader/memo. Mutable owner,
// writer, lease, partial and cleanup records keep their full original checks.
function readVerifiedBytes(file) {
  regular(file);
  const before = fs.lstatSync(file, { bigint: true });
  if (before.size < 0n || before.size > BigInt(LIMITS.metadataBytes)) fail('缓存元数据超过容量限制。');
  const fd = fs.openSync(file, 'r');
  try {
    if (!sameVerifiedStamp(before, fs.fstatSync(fd, { bigint: true }))) fail('缓存元数据身份已改变。');
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!Number.isSafeInteger(count) || count < 1 || count > bytes.length - offset) fail('读取期间缓存元数据已改变。');
      offset += count;
    }
    if (!sameVerifiedStamp(before, fs.fstatSync(fd, { bigint: true })) ||
      !sameVerifiedStamp(before, fs.lstatSync(file, { bigint: true }))) fail('读取期间缓存元数据已改变。');
    regular(file);
    // Hash all raw bytes every time, even when size and timestamps match.
    return { bytes, digest: sha(bytes), identity: before };
  } finally { fs.closeSync(fd); }
}
function freezeTree(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeTree); Object.freeze(value); }
  return value;
}
function frozenCopy(value) {
  const result = JSON.parse(jsonBytes(value).toString('utf8'));
  return freezeTree(result);
}
function assets(info) { return [...(info.framePack ? [info.framePack] : info.frames), ...(info.audio ? [info.audio] : [])]; }
function contentSource(source, expectedSha) {
  if (!source || source.sha256 !== expectedSha || typeof source.codec !== 'string' ||
    !Number.isSafeInteger(source.width) || source.width <= 0 || !Number.isSafeInteger(source.height) || source.height <= 0 ||
    typeof source.hasAudioStream !== 'boolean') fail('缓存源内容信息不完整或身份不符。');
  return { sha256: source.sha256, codec: source.codec, width: source.width, height: source.height, hasAudioStream: source.hasAudioStream };
}
function manifestAssets(info, expectedSha) {
  if (!info || info.schema !== 1 || info.owner !== OWNER || info.recipe !== RECIPE ||
    !(Number.isFinite(info.duration) && info.duration > 0 && info.duration <= LIMITS.duration) || !Array.isArray(info.frames))
    fail('缓存清单格式或处理版本不符。');
  contentSource(info.source, expectedSha);
  if (info.preview) {
    previewProfile.validate(info.preview, info.source);
    if (info.width !== info.preview.width || info.height !== info.preview.height) fail('画质清单与预览尺寸不符。');
  } else if (info.width !== 1280 || info.height !== 720) fail('旧缓存预览尺寸不符。');
  validateIndex(info);
  const packed = framePack.validate(info, LIMITS.cacheBytes);
  if (packed) for (const item of info.frames) { safeName(item.file); if (item.bytes > LIMITS.assetBytes) fail('图片包单帧超过安全读取上限。'); }
  const start = Math.min(0, info.audio ? info.audio.start : 0);
  if (info.duration - start > LIMITS.duration) fail('解码后媒体跨度超过处理限制。');
  const map = new Map();
  for (const item of assets(info)) {
    safeName(item.file);
    if (['owner.json', 'manifest.json', 'writer.lock'].includes(item.file) || map.has(item.file) ||
      !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || item.bytes > (packed && item === packed ? LIMITS.cacheBytes : LIMITS.assetBytes) || !/^[0-9a-f]{64}$/.test(item.sha256))
      fail('缓存资产重复、越界或缺少内容指纹。');
    map.set(item.file, Object.freeze({ file: item.file, bytes: item.bytes, sha256: item.sha256 }));
  }
  return map;
}
function readAssetsMap(info, physical) {
  if (!info.framePack) return physical;
  const logical = new Map();
  for (const item of info.frames) {
    safeName(item.file);
    if (item.bytes > LIMITS.assetBytes) fail('图片包单帧超过安全读取上限。');
    logical.set(item.file, Object.freeze({ file: item.file, bytes: item.bytes, sha256: item.sha256,
      packedFile: info.framePack.file, packedBytes: info.framePack.bytes, offset: item.offset }));
  }
  if (info.audio) logical.set(info.audio.file, physical.get(info.audio.file));
  return logical;
}

function createCache(options = {}) {
  if (options.packFrames !== undefined && typeof options.packFrames !== 'boolean') fail('图片包选项无效。');
  const { pluginRoot } = options, diskBytes = options.diskBytes === undefined ? LIMITS.cacheBytes : options.diskBytes;
  if (typeof pluginRoot !== 'string' || !path.isAbsolute(pluginRoot) || !Number.isSafeInteger(diskBytes) || diskBytes < 1 || diskBytes > LIMITS.cacheBytes)
    fail('需要插件绝对路径和不超过5GiB的缓存预算。');
  const plugin = path.resolve(pluginRoot), root = path.join(plugin, 'cache');
  if (/^c:/i.test(plugin)) fail('缓存不能位于C盘。');
  directory(plugin);
  const live = new WeakMap(); let activeBatch = null;
  const manifestMemo = new Map(); let manifestMemoBytes = 0;
  const manifestMemoStats = { reads: 0, hits: 0, validations: 0, evictions: 0 };
  function memoKey(dir, expectedSha) { return (process.platform === 'win32' ? dir.toLowerCase() : dir) + ':' + expectedSha; }
  function forgetManifest(key) {
    const prior = manifestMemo.get(key);
    if (prior) { manifestMemo.delete(key); manifestMemoBytes -= prior.bytes; }
  }
  function forgetDirectory(dir) {
    const prefix = (process.platform === 'win32' ? dir.toLowerCase() : dir) + ':';
    for (const key of manifestMemo.keys()) if (key.startsWith(prefix)) forgetManifest(key);
  }
  function completeManifest(dir, expectedSha) {
    const key = memoKey(dir, expectedSha);
    try {
      const before = fs.lstatSync(dir, { bigint: true }), raw = readVerifiedBytes(path.join(dir, 'manifest.json'));
      const after = fs.lstatSync(dir, { bigint: true });
      if (!before.isDirectory() || !after.isDirectory() || before.isSymbolicLink() || after.isSymbolicLink() ||
        before.ino !== after.ino || before.dev !== after.dev) fail('读取期间缓存目录身份已改变。');
      manifestMemoStats.reads++;
      let entry = manifestMemo.get(key);
      if (entry && (entry.digest !== raw.digest || entry.bytes !== raw.bytes.length ||
        entry.directory.ino !== before.ino || entry.directory.dev !== before.dev ||
        !sameVerifiedStamp(entry.identity, raw.identity))) {
        forgetManifest(key); entry = null;
      }
      if (entry) {
        manifestMemoStats.hits++;
        manifestMemo.delete(key); manifestMemo.set(key, entry);
      } else {
        const info = JSON.parse(raw.bytes.toString('utf8'));
        if (path.basename(dir) !== cacheLeaf(expectedSha, info.preview && info.preview.quality)) fail('缓存目录与画质身份不一致。');
        manifestMemoStats.validations++;
        const map = manifestAssets(info, expectedSha);
        // The map remains private. Prevent accidental mutation by future internal callers.
        const readonly = () => fail('已验证缓存资产表不能改写。');
        Object.defineProperties(map, { set: { value: readonly }, delete: { value: readonly }, clear: { value: readonly } });
        Object.freeze(map);
        entry = { info: freezeTree(info), map, digest: raw.digest, bytes: raw.bytes.length,
          identity: raw.identity, directory: { ino: before.ino, dev: before.dev } };
        manifestMemo.set(key, entry); manifestMemoBytes += entry.bytes;
        while (manifestMemo.size > MANIFEST_MEMO_LIMITS.entries || manifestMemoBytes > MANIFEST_MEMO_LIMITS.bytes) {
          forgetManifest(manifestMemo.keys().next().value); manifestMemoStats.evictions++;
        }
      }
      // Preparation may add top-level metrics, but can never mutate canonical data.
      const info = { ...entry.info };
      if (info.metrics && typeof info.metrics === 'object') info.metrics = Array.isArray(info.metrics) ? info.metrics.slice() : { ...info.metrics };
      return { info, map: entry.map };
    } catch (error) { forgetManifest(key); throw error; }
  }
  const processIdentity = options.processIdentity || createIdentity();
  const ownerValue = (kind, extra) => ({ schema: 1, owner: OWNER, recipe: RECIPE, root, kind,
    ...(['writer', 'lease'].includes(kind) && options.taskOwner ? { taskOwner: options.taskOwner } : {}), ...extra });
  function verifyRoot() {
    const pluginStat = directory(plugin), rootStat = directory(root);
    // directory(root) already established that its real path equals root.
    if (rootStat.dev !== pluginStat.dev || path.parse(root).root.toLowerCase() !== path.parse(plugin).root.toLowerCase() || /^c:/i.test(root))
      fail('缓存实际位置必须与插件同盘且不在C盘。');
    return verifyOwner(root, 'root', rootStat);
  }
  function verifyOwner(dir, kind, checkedDirectory) {
    // Only callers in the same synchronous segment pass a checked directory.
    if (!checkedDirectory) directory(dir);
    const value = readJSON(path.join(dir, 'owner.json'));
    if (value.schema !== 1 || value.owner !== OWNER || value.recipe !== RECIPE || value.root !== root || value.kind !== kind)
      fail('缓存所有权不明；不读取或清理。');
    if (kind === 'cache' && (value.useSequence !== undefined || value.lastUsedAt !== undefined) &&
      (!Number.isSafeInteger(value.useSequence) || value.useSequence < 1 || !Number.isSafeInteger(value.lastUsedAt) || value.lastUsedAt < 1))
      fail('最近使用记录损坏；不猜测使用顺序。');
    return value;
  }
  function ensureRoot() {
    directory(plugin);
    if (!fs.existsSync(root)) {
      const data = jsonBytes(ownerValue('root'));
      if (data.length > diskBytes) fail('缓存容量不足。');
      fs.mkdirSync(root); fs.writeFileSync(path.join(root, 'owner.json'), data, { flag: 'wx' });
    }
    verifyRoot();
  }
  function assertWriter(job, ignoreCancel = false) {
    if (!ignoreCancel) cancelled(job.signal);
    if (job.parent) {
      if (!ignoreCancel) cancelled(job.parent.signal);
      if (job.parent.batch.active !== job) fail('批量子事务已经归还。');
    }
    if (job.closed || !activeRoots.has(root)) fail('缓存写事务已经关闭。');
    verifyRoot();
    const file = path.join(root, 'writer.lock'), stat = regular(file);
    if (!sameFile(job.lockIdentity, stat)) fail('缓存写锁身份已改变。');
    const value = readJSON(file, stat);
    if (value.owner !== OWNER || value.recipe !== RECIPE || value.root !== root || value.kind !== 'writer' || value.token !== job.token || value.pid !== process.pid)
      fail('缓存写锁所有权已改变。');
    if (job.lockSha && sha(jsonBytes(value)) !== job.lockSha) fail('缓存写锁所有权或任务登记已改变。');
    if (job.parent) assertBatchCurrent(job.parent, job.segmentToken);
  }
  function charge(job, bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(job.disk + bytes)) fail('缓存容量不足；未执行超额写入。');
    // Retain space for a write-ahead deletion plan and its result. Tiny
    // injected budgets use proportional headroom; the product keeps 16MiB
    // inside, rather than in addition to, the approved 5GiB budget.
    const reserve = job.initializing ? 0 : Math.min(16 * MIB, Math.floor(diskBytes / 8));
    if (job.disk + bytes + reserve > diskBytes) {
      if (job.initializing) fail('缓存容量不足；未执行超额写入。');
      makeRoom(job, bytes, reserve);
    }
    job.disk += bytes;
  }
  function inspectDirectory(dir, kind, expectedSha, allowDamaged = false, ownedRecencyFile = null) {
    const owner = verifyOwner(dir, kind);
    const checked = kind === 'cache' ? completeManifest(dir, expectedSha) : null;
    const info = checked ? checked.info : readJSON(path.join(dir, 'manifest.json'));
    const map = checked ? checked.map : manifestAssets(info, expectedSha), expected = new Set(['owner.json', 'manifest.json', ...map.keys()]);
    const actual = fs.readdirSync(dir);
    if (ownedRecencyFile) expected.add(ownedRecencyFile);
    if (kind === 'partial' && actual.includes('transaction.log')) expected.add('transaction.log');
    if (actual.length !== expected.size || actual.some(name => !expected.has(name))) fail('缓存包含未登记文件；拒绝使用。');
    let totalBytes = 0, lengthsMatch = true;
    for (const file of actual) {
      const stat = regular(path.join(dir, file)), item = map.get(file);
      if (item && stat.size !== item.bytes) { lengthsMatch = false; if (!allowDamaged) fail('缓存资产长度已改变。'); }
      if (item && stat.size > (info.framePack && file === info.framePack.file ? LIMITS.cacheBytes : LIMITS.assetBytes)) fail('已有缓存资产超过安全读取上限。');
      if (!Number.isSafeInteger(stat.size) || stat.size < 0 || !Number.isSafeInteger(totalBytes + stat.size) || totalBytes + stat.size > diskBytes)
        fail('缓存现有容量超过预算。');
      totalBytes += stat.size;
    }
    return { info, map, owner, names: actual, totalBytes, lengthsMatch };
  }
  function usage(job) {
    verifyRoot(); let bytes = 0;
    const pending = new Map();
    if (job && job.initializing) for (const name of fs.readdirSync(root)) {
      if (/^cleanup-[0-9a-f]{24}\.json$/.test(name) && !fs.existsSync(path.join(root, name.replace(/\.json$/, '.result.json')))) {
        const plan = verifyCleanupRecord(name); if (pending.has(plan.directory)) fail('同一目标存在重复清理计划。');
        pending.set(plan.directory, plan);
      }
    }
    const add = size => { if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(bytes + size) || bytes + size > diskBytes) fail('缓存现有容量超过预算。'); bytes += size; };
    for (const name of fs.readdirSync(root)) {
      const file = path.join(root, name), stat = fs.lstatSync(file);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        if (pending.has(file)) {
          const plan = pending.get(file); directory(file);
          if (!sameDirectoryIdentity(file, stat, plan.directoryIdentity)) fail('待恢复清理目录身份已变化。');
          const expected = new Map(plan.files.map(item => [item.file, item]));
          for (const leaf of fs.readdirSync(file)) {
            if (!expected.has(leaf)) fail('待恢复清理目录含未知文件。');
            if (JSON.stringify(leafSnapshot(path.join(file, leaf))) !== JSON.stringify(expected.get(leaf))) fail('待恢复清理文件指纹不符。');
            add(expected.get(leaf).bytes);
          }
          continue;
        }
        if (job && job.partial && samePath(file, job.partial)) {
          const marker = verifyOwner(file, 'partial');
          if (marker.token !== job.token) fail('当前临时缓存所有权不符。');
          const expected = new Set(['owner.json', ...job.files.keys(), ...(job.ledger && !job.ledger.removed ? ['transaction.log'] : [])]), names = fs.readdirSync(file);
          if (names.length !== expected.size || names.some(leaf => !expected.has(leaf))) fail('当前临时缓存含未知文件。');
          for (const leaf of names) {
            const current = regular(path.join(file, leaf)), record = job.files.get(leaf);
            if (record && (!record.identity || !sameFile(record.identity, current) || current.size !== record.bytes)) fail('当前临时文件身份或长度不符。');
            add(current.size);
          }
          continue;
        }
        const match = /^media-([0-9a-f]{64})-([0-9a-f]{12})$/.exec(name);
        if (!match || !knownIds.has(match[2])) fail('检测到未知或未完成缓存，已停止写入并保留文件。');
        const inspected = inspectDirectory(file, 'cache', match[1], true);
        if (job) job.maxSequence = Math.max(job.maxSequence || 0, inspected.owner.useSequence || 0);
        // No await separates inspection from accounting: reuse its verified
        // leaf sizes, including owner and manifest, rather than scan twice.
        add(inspected.totalBytes);
      } else {
        regular(file);
        if (name === 'owner.json') verifyOwner(root, 'root');
        else if (name === 'writer.lock') {
          if (!job || !sameFile(job.lockIdentity, stat)) fail('未知写锁阻止新的写入。');
        } else if (/^lease-[0-9a-f]{24}\.json$/.test(name)) {
          const value = readJSON(file);
          if (value.owner !== OWNER || value.recipe !== RECIPE || value.root !== root || value.kind !== 'lease' ||
            !Number.isSafeInteger(value.pid) || value.pid <= 0 || value.token !== name.slice(6, -5) ||
            typeof value.cacheDir !== 'string' || !path.isAbsolute(value.cacheDir) || !samePath(path.dirname(value.cacheDir), root) ||
            !cachePattern.test(path.basename(value.cacheDir)) || !fs.existsSync(value.cacheDir)) fail('未知占用记录阻止写入。');
          verifyOwner(value.cacheDir, 'cache');
        } else if (/^cleanup-[0-9a-f]{24}(?:\.result)?\.json$/.test(name)) {
          const value = verifyCleanupRecord(name);
          if (value.kind === 'cleanup-plan') {
            const resultName = name.replace(/\.json$/, '.result.json');
            if (!fs.existsSync(path.join(root, resultName))) {
              if (!job || !job.initializing) fail('清理事务未完成，保留清单并停止准备。');
            } else if (verifyCleanupRecord(resultName).planSha256 !== leafSnapshot(file).sha256) fail('清理回执与清单指纹不符。');
          }
        }
        else if (/^writer-current-[0-9a-f]{24}(?:\.next)?\.json$/.test(name)) {
          if (!job || !job.batch || !batchCurrentNames(job.token).includes(name)) fail('未知批量目标记录阻止写入。');
          readBatchCurrent(job.writer, job.lockSha, name.endsWith('.next.json'));
        }
        else if (/^reap-[0-9a-f]{24}(?:\.result)?\.json$/.test(name)) requireReapCompleted(name);
        else fail('缓存根包含未知文件；未修改它。');
        add(stat.size);
      }
    }
    return bytes;
  }
  function verifyCleanupRecord(name) {
    const match = /^cleanup-([0-9a-f]{24})(\.result)?\.json$/.exec(name);
    if (!match) fail('未知清理记录。');
    const value = readJSON(path.join(root, name));
    if (value.schema !== 1 || value.owner !== OWNER || value.recipe !== RECIPE || value.root !== root ||
      value.token !== match[1] || value.kind !== (match[2] ? 'cleanup-result' : 'cleanup-plan')) fail('清理记录所有权不明。');
    if (match[2]) {
      if (!['completed', 'blocked'].includes(value.status) || !Number.isSafeInteger(value.freedBytes) || value.freedBytes < 0 ||
        !/^[0-9a-f]{64}$/.test(value.planSha256)) fail('清理回执不完整；保留原件。');
      if (value.status === 'blocked' && value.freedBytes !== 0) fail('零删除回执不符。');
      if (value.status === 'completed') {
        const planName = name.replace('.result.json', '.json');
        if (!fs.existsSync(path.join(root, planName)) || verifyCleanupRecord(planName).kind !== 'cleanup-plan' ||
          leafSnapshot(path.join(root, planName)).sha256 !== value.planSha256) fail('清理回执缺少对应原始清单。');
      }
    } else {
      const ownedPartial = value.reason === 'owned-job-stopped-interrupted-output' && value.writerToken === value.cacheToken &&
        value.directory === path.join(root, 'partial-' + value.cacheToken) && /^[0-9a-f]{64}$/.test(value.taskKey || '');
      if (typeof value.directory !== 'string' || !path.isAbsolute(value.directory) || !samePath(path.dirname(value.directory), root) ||
        !(cachePattern.test(path.basename(value.directory)) ||
          /^partial-[0-9a-f]{24}$/.test(path.basename(value.directory)) && (value.reason === 'orphaned-incomplete-cache' || ownedPartial)) ||
        !Array.isArray(value.directoryIdentity) || value.directoryIdentity.length !== 2 ||
        (!value.directoryIdentity.every(preciseDirectoryId) && !completedLegacyPlan(name, value)) || !/^[0-9a-f]{24}$/.test(value.cacheToken) ||
        !Array.isArray(value.files) || !ownedPartial && (!value.files.length || !value.files.some(item => item.file === 'owner.json')) ||
        new Set(value.files.map(item => item.file)).size !== value.files.length || value.files.some(item => {
          safeName(item.file); return !Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[0-9a-f]{64}$/.test(item.sha256) ||
            !Array.isArray(item.identity) || item.identity.length !== 4 || item.identity.some(n => !Number.isFinite(n));
        })) fail('清理计划路径或文件清单不明。');
    }
    return value;
  }
  function preciseDirectoryId(value) {
    return Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^(?:0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18446744073709551615n;
  }
  function completedLegacyPlan(name, plan) {
    // A matching completed receipt makes rounded legacy IDs readable history,
    // NEVER identity evidence for a new deletion.
    if (!plan.directoryIdentity.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0)) return false;
    const resultPath = path.join(root, name.replace('.json', '.result.json'));
    if (!fs.existsSync(resultPath)) return false;
    const done = readJSON(resultPath);
    return done.schema === 1 && done.owner === OWNER && done.recipe === RECIPE && done.root === root &&
      done.kind === 'cleanup-result' && done.token === plan.token && done.status === 'completed' &&
      Number.isSafeInteger(done.freedBytes) && done.freedBytes >= 0 && done.planSha256 === leafSnapshot(path.join(root, name)).sha256;
  }
  function captureDirectoryIdentity(dir) {
    directory(dir); const exact = fs.lstatSync(dir, { bigint: true });
    if (!exact.isDirectory() || exact.isSymbolicLink()) fail('清理目录身份已变化。');
    return [ledgerId(exact.dev), ledgerId(exact.ino)];
  }
  function stamp(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeMs]; }
  function sameDirectoryIdentity(dir, stat, identity) {
    if (!identity.every(preciseDirectoryId)) return false; // Legacy history cannot authorize deletion.
    if (identity.some(n => typeof n === 'string')) { const exact = fs.lstatSync(dir, { bigint: true });
      return exact.dev.toString() === String(identity[0]) && exact.ino.toString() === String(identity[1]); }
    return stat.dev === identity[0] && stat.ino === identity[1];
  }
  function leafSnapshot(file) {
    const before = regular(file), fd = fs.openSync(file, 'r'), hash = crypto.createHash('sha256');
    try {
      if (!sameFile(before, fs.fstatSync(fd))) fail('清理前文件身份已改变。');
      const buffer = Buffer.alloc(Math.min(MIB, before.size || 1)); let at = 0;
      while (at < before.size) {
        const n = fs.readSync(fd, buffer, 0, Math.min(buffer.length, before.size - at), at);
        if (!n) fail('清理前文件读取不完整。'); hash.update(buffer.subarray(0, n)); at += n;
      }
      if (JSON.stringify(stamp(before)) !== JSON.stringify(stamp(regular(file))) || !sameFile(before, fs.fstatSync(fd)))
        fail('清理前文件已变化。');
      return { file: path.basename(file), bytes: before.size, identity: stamp(before), sha256: hash.digest('hex') };
    } finally { fs.closeSync(fd); }
  }
  function writeRecord(file, data) {
    const fd = fs.openSync(file, 'wx');
    try { writeAll(fd, data, 0); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    // Verify actual bytes, not just the expected buffer, before deleting.
    if (leafSnapshot(file).sha256 !== sha(data)) fail('清理记录落盘校验失败；未授权后续删除。');
    if (/^cleanup-[0-9a-f]{24}(?:\.result)?\.json$/.test(path.basename(file))) verifyCleanupRecord(path.basename(file));
    else if (/^reap-[0-9a-f]{24}(?:\.result)?\.json$/.test(path.basename(file))) verifyReapRecord(path.basename(file));
  }
  function occupancy() {
    const protectedDirs = new Set();
    for (const name of fs.readdirSync(root)) if (/^lease-[0-9a-f]{24}\.json$/.test(name)) {
      const value = readJSON(path.join(root, name));
      if (value.schema !== 1 || value.owner !== OWNER || value.recipe !== RECIPE || value.root !== root || value.kind !== 'lease' ||
        value.token !== name.slice(6, -5) || !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
        typeof value.cacheDir !== 'string' || !samePath(path.dirname(value.cacheDir), root) ||
        !matchesSource(value.cacheDir, value.sourceSha256)) fail('占用身份不明，不能淘汰。');
      verifyOwner(value.cacheDir, 'cache'); protectedDirs.add(value.cacheDir.toLowerCase());
    }
    return protectedDirs;
  }
  function assertPlan(job, plan, allowMissing = false) {
    assertWriter(job);
    if ((!allowMissing && samePath(plan.directory, job.target) && !['damaged-cache', 'obsolete-color-cache'].includes(plan.reason)) || occupancy().has(plan.directory.toLowerCase())) fail('当前或已占用缓存不能删除。');
    if (!fs.existsSync(plan.directory)) { if (allowMissing) return []; fail('清理目录已变化。'); }
    const dir = directory(plan.directory);
    if (!sameDirectoryIdentity(plan.directory, dir, plan.directoryIdentity)) fail('清理目录身份已变化。');
    const names = fs.readdirSync(plan.directory), expected = new Map(plan.files.map(item => [item.file, item]));
    if (names.some(name => !expected.has(name)) || (!allowMissing && names.length !== expected.size)) fail('清理目标出现未知或缺失文件。');
    const ownedInterrupted = options.taskOwner && plan.reason === 'owned-job-stopped-interrupted-output' &&
      plan.directory === path.join(root, 'partial-' + plan.cacheToken);
    if (ownedInterrupted) { /* Exact current-file snapshots replace an interrupted owner/ledger. */ }
    else if (names.includes('owner.json')) {
      const owner = verifyOwner(plan.directory, plan.targetKind || 'cache'); if (owner.token !== plan.cacheToken) fail('清理缓存所有权已改变。');
    } else if (names.length) fail('清理目录缺少所有权标记。');
    for (const name of names) {
      const actual = leafSnapshot(path.join(plan.directory, name)), before = expected.get(name);
      if (JSON.stringify(actual) !== JSON.stringify(before)) fail('清理候选指纹或身份已变化；停止删除。');
    }
    assertWriter(job); if (occupancy().has(plan.directory.toLowerCase())) fail('清理期间出现占用，停止删除。');
    return names;
  }
  function deletePlanned(job, plan, planData, recovering = false) {
    const names = assertPlan(job, plan, recovering);
    const resultFile = path.join(root, 'cleanup-' + plan.token + '.result.json');
    if (fs.existsSync(resultFile)) fail('清理回执目标已存在；未重复执行。');
    let freedBytes = 0;
    // The writer excludes new leases. Existing leases may only disappear;
    // their disappearance can never make a selected target less safe.
    for (const name of names.filter(name => name !== 'owner.json').concat(names.includes('owner.json') ? ['owner.json'] : [])) {
      const file = path.join(plan.directory, name), before = plan.files.find(item => item.file === name);
      if (JSON.stringify(leafSnapshot(file)) !== JSON.stringify(before)) fail('删除前文件身份已变化。');
      fs.unlinkSync(file); freedBytes += before.bytes;
    }
    if (fs.existsSync(plan.directory)) { directory(plan.directory); fs.rmdirSync(plan.directory); }
    forgetDirectory(plan.directory);
    const data = jsonBytes(ownerValue('cleanup-result', { token: plan.token, status: 'completed', planSha256: sha(planData),
      freedBytes, plannedBytes: plan.files.reduce((sum, item) => sum + item.bytes, 0), recovered: recovering, completedAt: Date.now() }));
    if (data.length > 4096) fail('清理回执超出预留。');
    writeRecord(resultFile, data); job.disk += data.length - freedBytes;
  }
  function resumeCleanup(job) {
    assertWriter(job);
    const pending = fs.readdirSync(root).filter(name => /^cleanup-[0-9a-f]{24}\.json$/.test(name) &&
      !fs.existsSync(path.join(root, name.replace(/\.json$/, '.result.json'))));
    // Owning the new writer proves the prior *synchronous* deletion released
    // exclusion. It does not prove orphan FFmpeg jobs dead; those retain locks.
    if (job.disk + pending.length * 4096 > diskBytes) fail('没有足够预留记录清理恢复；未删除。');
    for (const name of pending) {
      const file = path.join(root, name), plan = verifyCleanupRecord(name), data = fs.readFileSync(file);
      if (leafSnapshot(file).sha256 !== sha(data)) fail('清理恢复清单已改变。');
      assertPlan(job, plan, true); deletePlanned(job, plan, data, true);
    }
  }
  function discardDamaged(job, dir, inspected, reason = 'damaged-cache') {
    assertWriter(job);
    if (occupancy().has(dir.toLowerCase())) fail('完整缓存内容指纹不符且仍被占用；未删除或重建。');
    const owner = verifyOwner(dir, 'cache');
    const plan = ownerValue('cleanup-plan', { token: nonce(), writerToken: job.token, directory: dir,
      directoryIdentity: captureDirectoryIdentity(dir), cacheToken: owner.token, reason, createdAt: Date.now(),
      files: inspected.names.sort().map(name => leafSnapshot(path.join(dir, name))) });
    const data = jsonBytes(plan);
    if (job.disk + data.length + 4096 > diskBytes) fail('无法预留损坏缓存清理记录；保留原件。');
    assertPlan(job, plan); writeRecord(path.join(root, 'cleanup-' + plan.token + '.json'), data); job.disk += data.length;
    deletePlanned(job, plan, data);
  }
  function makeRoom(job, bytes, reserve) {
    assertWriter(job);
    const protectedDirs = occupancy(), candidates = [];
    // Preflight the entire root before selecting any deletion. usage() knows
    // this transaction's partial, but refuses foreign/incomplete contents.
    job.disk = usage(job);
    for (const name of fs.readdirSync(root)) {
      const match = /^media-([0-9a-f]{64})-([0-9a-f]{12})$/.exec(name); if (!match) continue;
      const dir = path.join(root, name); if (samePath(dir, job.target) || protectedDirs.has(dir.toLowerCase())) continue;
      const owner = verifyOwner(dir, 'cache'), checked = inspectDirectory(dir, 'cache', match[1]);
      candidates.push({ dir, owner, checked, order: Number.isSafeInteger(owner.useSequence) ? owner.useSequence : 0 });
    }
    candidates.sort((a, b) => a.order - b.order || a.dir.localeCompare(b.dir));
    const selected = []; let future = job.disk, recordBytes = 0;
    for (const item of candidates) {
      const plan = ownerValue('cleanup-plan', { token: nonce(), writerToken: job.token,
        directory: item.dir, directoryIdentity: captureDirectoryIdentity(item.dir), cacheToken: item.owner.token,
        reason: 'least-recently-used', createdAt: Date.now(), files: item.checked.names.sort().map(name => leafSnapshot(path.join(item.dir, name))) });
      const data = jsonBytes(plan); recordBytes += data.length + 4096;
      // Reserve every plan and result before the first unlink. No deletion
      // is performed merely to make room for its own evidence.
      if (job.disk + recordBytes > diskBytes) fail('容量不足以保存清理清单及回执；未执行删除。');
      future += data.length + 4096 - item.checked.totalBytes; selected.push({ plan, data });
      if (future + bytes + reserve <= diskBytes) break;
    }
    if (!selected.length || future + bytes + reserve > diskBytes) {
      const token = nonce(), data = jsonBytes(ownerValue('cleanup-result', { token, status: 'blocked', freedBytes: 0,
        planSha256: sha(Buffer.alloc(0)), requestedBytes: bytes, protectedCount: protectedDirs.size,
        reason: 'insufficient-unoccupied-cache', completedAt: Date.now() }));
      if (job.disk + data.length > diskBytes) fail('容量不足且无法保存零删除回执；未执行删除。');
      writeRecord(path.join(root, 'cleanup-' + token + '.result.json'), data); job.disk += data.length;
      fail('缓存容量不足；没有可安全淘汰的空间，已记录零删除。');
    }
    for (const { plan } of selected) assertPlan(job, plan);
    for (const { plan, data } of selected) {
      assertWriter(job); writeRecord(path.join(root, 'cleanup-' + plan.token + '.json'), data); job.disk += data.length;
      deletePlanned(job, plan, data);
    }
    if (job.disk + bytes + reserve > diskBytes) fail('清理后空间不足；未执行超额写入。');
  }
  function cleanOther(job, all) {
    // begin/resumeCleanup already validated and accounted the entire root.
    assertWriter(job);
    const occupied = occupancy(), selected = [], at = (options.now || Date.now)();
    if (!Number.isSafeInteger(at) || at < 1) fail('缓存清理时间无效。');
    let reserved = 0;
    for (const name of fs.readdirSync(root)) {
      const match = /^media-([0-9a-f]{64})-([0-9a-f]{12})$/.exec(name); if (!match) continue;
      const dir = path.join(root, name), owner = verifyOwner(dir, 'cache');
      if (samePath(dir, job.target) || (all && match[1] === path.basename(job.target).slice(6, 70)) || occupied.has(dir.toLowerCase())) continue;
      // Missing/future recency never proves one day of non-use.
      if (!all && (!Number.isSafeInteger(owner.lastUsedAt) || at - owner.lastUsedAt < 86400000)) continue;
      const checked = inspectDirectory(dir, 'cache', match[1]);
      // Segment keys are derived from the original SHA. Clearing "other"
      // materials must retain this material's unleased JPEG/AVC segments too.
      if (all && checked.info.metrics?.sourceSha256 === path.basename(job.target).slice(6, 70)) continue;
      const plan = ownerValue('cleanup-plan', { token: nonce(), writerToken: job.token, directory: dir,
        directoryIdentity: captureDirectoryIdentity(dir), cacheToken: owner.token,
        reason: all ? 'user-clear-other-cache' : 'idle-one-day', createdAt: at,
        files: checked.names.sort().map(leaf => leafSnapshot(path.join(dir, leaf))) });
      const data = jsonBytes(plan); reserved += data.length + 4096;
      if (job.disk + reserved > diskBytes) fail('无法预留全部清理清单和回执；未执行删除。');
      selected.push({ plan, data });
    }
    for (const { plan } of selected) assertPlan(job, plan);
    let freedBytes = 0;
    for (const { plan, data } of selected) {
      assertWriter(job); writeRecord(path.join(root, 'cleanup-' + plan.token + '.json'), data); job.disk += data.length;
      deletePlanned(job, plan, data); freedBytes += plan.files.reduce((n, f) => n + f.bytes, 0);
    }
    return Object.freeze({ cleared: selected.length, freedBytes, occupiedProtected: occupied.size });
  }
  function touch(job, dir) {
    assertWriter(job); const old = verifyOwner(dir, 'cache'), markerPath = path.join(dir, 'owner.json');
    const before = leafSnapshot(markerPath); let sequence = job.parent ? job.parent.maxSequence : 0;
    if (!job.parent) for (const name of fs.readdirSync(root)) if (cachePattern.test(name)) {
      const value = verifyOwner(path.join(root, name), 'cache');
      if (value.useSequence !== undefined && (!Number.isSafeInteger(value.useSequence) || value.useSequence < 1)) fail('最近使用记录损坏。');
      sequence = Math.max(sequence, value.useSequence || 0);
    }
    if (!Number.isSafeInteger(sequence + 1)) fail('最近使用序号超过安全范围。');
    const data = jsonBytes({ ...old, lastUsedAt: Date.now(), useSequence: sequence + 1 });
    // Atomic metadata replacement preserves the complete cache if the process
    // Bind the temporary marker to this writer before any bytes are written.
    const next = path.join(dir, 'owner.next-' + job.token + '.json');
    let fd, identity, written = 0, fdClosed = false, charged = false;
    try {
      charge(job, data.length); charged = true;
      fd = fs.openSync(next, 'wx'); identity = fs.fstatSync(fd);
      writeAll(fd, data, 0, n => { written += n; }); fs.fsyncSync(fd); fs.closeSync(fd); fdClosed = true;
      if (leafSnapshot(next).sha256 !== sha(data) || JSON.stringify(leafSnapshot(markerPath)) !== JSON.stringify(before))
        fail('最近使用更新前标记已变化。');
      assertWriter(job); fs.renameSync(next, markerPath); job.disk -= before.bytes;
      if (job.parent) job.parent.maxSequence = sequence + 1;
    } catch (error) {
      // Reservation is not disk occupancy: open can fail before creating a
      // file, and a failed write can leave only a prefix. Account that prefix
      // until its original identity has been verified and removed.
      if (charged) job.disk -= data.length - written;
      try {
        if (fd !== undefined && !fdClosed) { fs.closeSync(fd); fdClosed = true; }
        if (fd !== undefined) {
          if (!identity) fail('最近使用临时标记缺少打开文件身份；保留原件。');
          assertWriter(job, true); const current = regular(next);
          if (!sameFile(identity, current) || current.size !== written || !fs.readFileSync(next).equals(data.subarray(0, written)))
            fail('最近使用临时标记身份不明；保留原件。');
          fs.unlinkSync(next); job.disk -= written;
        }
      } catch (cleanupError) { error.cleanupError = cleanupError.message; }
      throw error;
    }
  }
  function verifyReapRecord(name) {
    const match = /^reap-([0-9a-f]{24})(\.result)?\.json$/.exec(name);
    if (!match) fail('未知残留恢复记录。');
    const value = readJSON(path.join(root, name));
    if (value.schema !== 1 || value.owner !== OWNER || value.recipe !== RECIPE || value.root !== root || value.token !== match[1] ||
      value.kind !== (match[2] ? 'reap-result' : 'reap-plan')) fail('残留恢复记录所有权不符。');
    if (match[2]) {
      if (value.status !== 'completed' || !Number.isSafeInteger(value.freedBytes) || value.freedBytes < 0 || !/^[0-9a-f]{64}$/.test(value.planSha256)) fail('恢复回执不完整。');
    } else if (!Array.isArray(value.records) || !value.records.length || value.records.some(record =>
      !record.file || !/^(?:writer\.lock|lease-[0-9a-f]{24}\.json|writer-current-[0-9a-f]{24}(?:\.next)?\.json)$/.test(record.file.file) ||
      !/^[0-9a-f]{64}$/.test(record.file.sha256) || !Array.isArray(record.file.identity) || record.file.identity.length !== 4 ||
      !Number.isSafeInteger(record.file.bytes) || record.file.bytes < 0 || !record.ownerRecord || record.ownerRecord.root !== root))
      fail('恢复计划含未授权的路径或身份。');
    if (!match[2]) for (const item of value.records.filter(record => /^writer-current-/.test(record.file.file))) {
      const parent = value.records.find(record => record.file.file === 'writer.lock' && record.ownerRecord.token === item.ownerRecord.token);
      if (!parent || parent.ownerRecord.mode !== 'batch-v1' || item.ownerRecord.kind !== 'batch-slot' ||
        item.ownerRecord.writerSha256 !== parent.file.sha256 || !batchCurrentNames(parent.ownerRecord.token).includes(item.file.file) ||
        item.file.bytes > 4096 || ['schema', 'key', 'epoch', 'guardPid'].some(key => item.ownerRecord.taskOwner?.[key] !== parent.ownerRecord.taskOwner?.[key]))
        fail('批量目标恢复记录缺少原写锁绑定。');
    }
    if (!match[2] && value.recency !== undefined) {
      if (!Array.isArray(value.recency) || value.recency.length > 1 || value.recency.some(item => {
        const parent = value.records.find(record => record.ownerRecord.kind === 'writer' && record.ownerRecord.token === item.writerToken);
        return !parent || parent.file.file !== 'writer.lock' || parent.ownerRecord.schema !== 1 || parent.ownerRecord.owner !== OWNER ||
          parent.ownerRecord.recipe !== RECIPE || !/^[0-9a-f]{24}$/.test(item.writerToken || '') || !/^[0-9a-f]{64}$/.test(parent.ownerRecord.sourceSha256 || '') ||
          item.directory !== (parent.ownerRecord.mode === 'batch-v1' ? batchReapTarget(value, parent).target :
            path.join(root, cacheLeaf(parent.ownerRecord.sourceSha256, parent.ownerRecord.previewQuality))) ||
          !Array.isArray(item.directoryIdentity) || item.directoryIdentity.length !== 2 || !item.directoryIdentity.every(preciseDirectoryId) ||
          !/^[0-9a-f]{24}$/.test(item.cacheToken) || !/^[0-9a-f]{64}$/.test(item.ownerSha256) || !/^[0-9a-f]{64}$/.test(item.manifestSha256) ||
          !item.file || !['owner.next.json', 'owner.next-' + item.writerToken + '.json'].includes(item.file.file) ||
          !Number.isSafeInteger(item.file.bytes) || item.file.bytes < 0 || item.file.bytes > LIMITS.metadataBytes ||
          !/^[0-9a-f]{64}$/.test(item.file.sha256) || !Array.isArray(item.file.identity) || item.file.identity.length !== 4 || !item.file.identity.every(Number.isFinite);
      })) fail('最近使用恢复计划身份不明。');
    }
    return value;
  }
  function assertRecencyRepair(item, allowMissing = false) {
    const file = path.join(item.directory, item.file.file);
    if (!fs.existsSync(file) && allowMissing) return false;
    if (!sameDirectoryIdentity(item.directory, directory(item.directory), item.directoryIdentity) ||
        verifyOwner(item.directory, 'cache').token !== item.cacheToken ||
        leafSnapshot(path.join(item.directory, 'owner.json')).sha256 !== item.ownerSha256 ||
        leafSnapshot(path.join(item.directory, 'manifest.json')).sha256 !== item.manifestSha256 ||
        JSON.stringify(leafSnapshot(file)) !== JSON.stringify(item.file)) fail('最近使用恢复目标已变化；保留原件。');
    inspectDirectory(item.directory, 'cache', path.basename(item.directory).slice(6, 70), false, item.file.file);
    return true;
  }
  function recencyRepair(writer, batchTarget) {
    if (writer.mode === 'batch-v1' && !batchTarget) return null;
    const dir = batchTarget ? batchTarget.target : path.join(root, cacheLeaf(writer.sourceSha256, writer.previewQuality));
    if (!fs.existsSync(dir)) return null;
    directory(dir);
    const candidates = fs.readdirSync(dir).filter(name => /^owner\.next(?:-.*)?\.json$/.test(name));
    if (!candidates.length) return null;
    const bound = 'owner.next-' + writer.token + '.json';
    if (candidates.length !== 1 || ![bound, 'owner.next.json'].includes(candidates[0])) fail('最近使用临时标记缺少任务绑定；保留原件。');
    const leaf = candidates[0], owner = verifyOwner(dir, 'cache');
    if (leaf === 'owner.next.json') {
      // Only a complete legacy marker matching immutable owner fields is
      // recoverable. A truncated unbound legacy marker remains protected.
      const next = readJSON(path.join(dir, leaf));
      const stable = value => JSON.stringify(Object.keys(value).sort().filter(key => !['lastUsedAt', 'useSequence'].includes(key)).map(key => [key, value[key]]));
      if (stable(next) !== stable(owner) || !Number.isSafeInteger(next.useSequence) || next.useSequence <= (owner.useSequence || 0) ||
          !Number.isSafeInteger(next.lastUsedAt) || next.lastUsedAt < (owner.lastUsedAt || 0)) fail('旧最近使用临时标记不能确认；保留原件。');
    }
    const item = { writerToken: writer.token, directory: dir, directoryIdentity: captureDirectoryIdentity(dir), cacheToken: owner.token,
      ownerSha256: leafSnapshot(path.join(dir, 'owner.json')).sha256, manifestSha256: leafSnapshot(path.join(dir, 'manifest.json')).sha256,
      file: leafSnapshot(path.join(dir, leaf)) };
    assertRecencyRepair(item); return item;
  }
  function requireReapCompleted(name) {
    const value = verifyReapRecord(name), planName = name.replace('.result.json', '.json'), resultName = planName.replace('.json', '.result.json');
    if (!fs.existsSync(path.join(root, planName)) || !fs.existsSync(path.join(root, resultName))) fail('残留恢复尚未完成；保留原件。');
    verifyReapRecord(planName);
    if (verifyReapRecord(resultName).planSha256 !== leafSnapshot(path.join(root, planName)).sha256) fail('恢复回执与原始清单指纹不符。');
    return value;
  }
  function orphanPartialPlan(dir, writer, batchTarget) {
    if (writer.mode === 'batch-v1' && !batchTarget) fail('批量残片缺少完整当前目标；保留。');
    if (options.taskOwner && writer.taskOwner && writer.taskOwner.schema === 'eva-task-owner-v1' &&
        writer.taskOwner.key === options.taskOwner.key && writer.taskOwner.epoch !== options.taskOwner.epoch &&
        dir === path.join(root, 'partial-' + writer.token)) {
      // The OS guard has already stopped the entire previous task group. This
      // directory name was reserved by its immutable ownership record BEFORE
      // creation, so interruption within file/ledger/owner writes is recoverable.
      directory(dir); const names = fs.readdirSync(dir).sort();
      const captured = names.map(name => {
        if (!/^(?:owner\.json|transaction\.log|manifest\.json|audio\.wav|frames\.pack|\d{6}\.jpg|\d{1,12}\.avc)$/.test(name)) fail('中断任务含未知文件，保留原件。');
        const stat = regular(path.join(dir, name));
        if (stat.size > (name.endsWith('.json') || name === 'transaction.log' ? LIMITS.metadataBytes : name === framePack.FILE ? LIMITS.cacheBytes : LIMITS.assetBytes)) fail('中断任务文件越界，保留原件。');
        return leafSnapshot(path.join(dir, name));
      });
      return ownerValue('cleanup-plan', { token: nonce(), writerToken: writer.token, directory: dir,
        directoryIdentity: captureDirectoryIdentity(dir), cacheToken: writer.token, targetKind: 'partial', taskKey: options.taskOwner.key,
        reason: 'owned-job-stopped-interrupted-output', createdAt: Date.now(), files: captured });
    }
    const marker = readJSON(path.join(dir, 'owner.json'));
    if (marker.schema !== 1 || marker.owner !== OWNER || marker.recipe !== RECIPE || marker.root !== root ||
      !['partial', 'cache'].includes(marker.kind) || marker.token !== writer.token) fail('残留临时目录所有权不符。');
    const names = fs.readdirSync(dir), ledgerPath = path.join(dir, 'transaction.log');
    if (names.includes('transaction.log')) {
      const ledger = regular(ledgerPath); if (ledger.size > LIMITS.metadataBytes) fail('残留临时账本越界。');
      const text = fs.readFileSync(ledgerPath, 'utf8');
      if (text && !text.endsWith('\n')) fail('残留临时账本未完整提交；保留。');
      const entries = text ? text.trimEnd().split('\n').map(line => JSON.parse(line)) : [];
      const expected = new Map();
      for (const item of entries) {
        safeName(item.file);
        if (['owner.json', 'transaction.log', 'owner.next.json', 'writer.lock'].includes(item.file) || expected.has(item.file) ||
          !Object.prototype.hasOwnProperty.call(item, 'dev') || !Object.prototype.hasOwnProperty.call(item, 'ino')) fail('残留临时账本含未知输出。');
        ledgerId(item.dev); ledgerId(item.ino);
        expected.set(item.file, item);
      }
      if (names.length !== expected.size + 2 || names.some(name => !['owner.json', 'transaction.log'].includes(name) && !expected.has(name)))
        fail('残留临时目录含未登记文件；未删除。');
      for (const [name, item] of expected) {
        const stat = regular(path.join(dir, name));
        const exact = fs.lstatSync(path.join(dir, name), { bigint: true });
        if (ledgerId(exact.dev) !== ledgerId(item.dev) || ledgerId(exact.ino) !== ledgerId(item.ino) || stat.size > (name === 'manifest.json' ? LIMITS.metadataBytes : name === framePack.FILE ? LIMITS.cacheBytes : LIMITS.assetBytes))
          fail('残留输出身份或容量不符。');
      }
    } else {
      // Crash after the ledger was removed but before atomic directory publish:
      // the finished manifest is the only acceptable replacement file list.
      const inspected = inspectDirectory(dir, marker.kind, batchTarget ? batchTarget.sourceSha256 : writer.sourceSha256);
      for (const item of inspected.map.values()) if (leafSnapshot(path.join(dir, item.file)).sha256 !== item.sha256) fail('残留完整清单资产指纹不符。');
    }
    return ownerValue('cleanup-plan', { token: nonce(), writerToken: writer.token, directory: dir,
      directoryIdentity: captureDirectoryIdentity(dir), cacheToken: marker.token, targetKind: marker.kind,
      reason: 'orphaned-incomplete-cache', createdAt: Date.now(), files: names.sort().map(name => leafSnapshot(path.join(dir, name))) });
  }
  function recoverOrphans() {
    if (!fs.existsSync(root)) return;
    verifyRoot();
    const guardPath = path.join(root, 'recovery.lock');
    if (fs.existsSync(guardPath)) {
      const error = new Error('缓存恢复仍被占用或留有未确认的恢复锁；保留原件。'); error.code = 'CACHE_BUSY'; throw error;
    }
    const names = fs.readdirSync(root), pending = names.filter(name => /^reap-[0-9a-f]{24}\.json$/.test(name) &&
      !fs.existsSync(path.join(root, name.replace(/\.json$/, '.result.json'))));
    // A prior recovery may already have removed current or writer while its
    // concrete partial-cleanup plan still remains. Seal and validate that
    // original plan BEFORE considering any new orphan/target inference.
    const reaps = pending.map(name => {
      const file = path.join(root, name), raw = readVerifiedBytes(file), plan = verifyReapRecord(name);
      if (JSON.stringify(plan) !== JSON.stringify(JSON.parse(raw.bytes.toString('utf8')))) fail('读取期间恢复原计划已改变。');
      return { name, plan, data: raw.bytes, identity: raw.identity, digest: raw.digest };
    });
    const priorRecords = new Map();
    for (const reap of reaps) {
      for (const item of reap.plan.records) {
        const value = item.ownerRecord;
        if (value.mode === 'batch-v1') {
          if (!validTaskOwner(options.taskOwner) || !validTaskOwner(value.taskOwner) ||
            options.taskOwner.key !== value.taskOwner.key || options.taskOwner.epoch === value.taskOwner.epoch)
            fail('原批量恢复计划不属于已确认停止的守护。');
          if (item.file.file === 'writer.lock' && reap.plan.records.some(slot => slot.file.file === batchCurrentNames(value.token)[0] && slot.ownerRecord.currentBytes))
            batchReapTarget(reap.plan, item);
        }
        if (!processIdentity.inspect(value).safe) fail('原恢复计划的任务仍未确认停止。');
        const prior = priorRecords.get(item.file.file);
        if (prior && JSON.stringify(prior) !== JSON.stringify(item)) fail('同一文件存在冲突的恢复原计划。');
        priorRecords.set(item.file.file, item);
        const file = path.join(root, item.file.file);
        if (fs.existsSync(file) && JSON.stringify(leafSnapshot(file)) !== JSON.stringify(item.file)) fail('恢复原计划中的剩余文件已改变。');
      }
    }
    const records = [], partialPlans = [], recency = [];
    for (const name of names.filter(name => name === 'writer.lock' || /^lease-[0-9a-f]{24}\.json$/.test(name))) {
      if (priorRecords.has(name)) continue; // Resume its original sealed plan, never invent a replacement current.
      const file = path.join(root, name); let value;
      try { value = readJSON(file); } catch (_) { continue; } // Unknown locks are never reaped.
      if (value.schema !== 1 || value.owner !== OWNER || value.recipe !== RECIPE || value.root !== root || value.pid !== value.processIdentity?.pid ||
        value.kind !== (name === 'writer.lock' ? 'writer' : 'lease') || !/^[0-9a-f]{24}$/.test(value.token)) continue;
      if (name === 'writer.lock' && !/^[0-9a-f]{64}$/.test(value.sourceSha256 || '')) continue;
      if (name !== 'writer.lock' && (value.token !== name.slice(6, -5) ||
        !matchesSource(value.cacheDir, value.sourceSha256))) continue;
      if (name === 'writer.lock' && value.mode !== undefined && value.mode !== 'batch-v1') continue;
      if (value.mode === 'batch-v1' && (!validTaskOwner(options.taskOwner) || !validTaskOwner(value.taskOwner) ||
        options.taskOwner.key !== value.taskOwner.key || options.taskOwner.epoch === value.taskOwner.epoch)) continue;
      if (!processIdentity.inspect(value).safe) continue;
      const captured = { file: leafSnapshot(file), ownerRecord: value }; records.push(captured);
      const batch = value.mode === 'batch-v1' ? stoppedBatch(value, captured.file.sha256) : null;
      if (batch) records.push(...batch.slots);
      if (name === 'writer.lock') { const item = recencyRepair(value, batch?.current?.value); if (item) recency.push(item); }
      if (name === 'writer.lock') for (const child of names.filter(name => /^partial-[0-9a-f]{24}$/.test(name))) {
        const dir = path.join(root, child);
        const prior = names.filter(name => /^cleanup-[0-9a-f]{24}\.json$/.test(name)).map(verifyCleanupRecord)
          .find(old => old.directory === dir && !fs.existsSync(path.join(root, 'cleanup-' + old.token + '.result.json')));
        if (prior) {
          // A later cleanup worker may have died while deleting an older
          // task's partial. Its writer token is not that partial's token.
          if (!sameDirectoryIdentity(dir, directory(dir), prior.directoryIdentity) ||
              prior.reason === 'owned-job-stopped-interrupted-output' && prior.taskKey !== options.taskOwner?.key ||
              fs.readdirSync(dir).some(leaf => !prior.files.some(old => JSON.stringify(old) === JSON.stringify(leafSnapshot(path.join(dir, leaf))))))
            fail('已有残留清理计划与当前文件不符。');
        } else partialPlans.push(orphanPartialPlan(dir, value, batch?.current?.value));
      }
    }
    if (names.includes('writer.lock') && !records.some(item => item.file.file === 'writer.lock') && !priorRecords.has('writer.lock')) return;
    if (!records.length && !pending.length) return;
    const token = nonce(), guardData = jsonBytes(ownerValue('recovery', { token, pid: process.pid, processIdentity: processIdentity.self(), children: [] }));
    const guarded = !!options.taskOwner;
    const guardFd = guarded ? null : fs.openSync(guardPath, 'wx'), guardIdentity = guarded ? null : fs.fstatSync(guardFd); let guardWritten = 0;
    function ownGuard() {
      verifyRoot();
      for (const reap of reaps) if (!reap.fresh) {
        const actual = readVerifiedBytes(path.join(root, reap.name));
        if (actual.digest !== reap.digest || !sameVerifiedStamp(actual.identity, reap.identity)) fail('恢复原计划身份或摘要已改变。');
      }
      if (!guarded) { const stat = regular(guardPath);
        if (!sameFile(guardIdentity, stat) || !fs.readFileSync(guardPath).equals(guardData)) fail('恢复锁身份已改变。'); }
      const writer = path.join(root, 'writer.lock');
      if (fs.existsSync(writer)) {
        const captured = records.find(item => item.file.file === 'writer.lock') || priorRecords.get('writer.lock');
        if (!captured || JSON.stringify(leafSnapshot(writer)) !== JSON.stringify(captured.file)) fail('恢复期间出现另一准备事务；停止恢复。');
      }
    }
    try {
      if (!guarded) { writeAll(guardFd, guardData, 0, n => { guardWritten += n; }); fs.fsyncSync(guardFd); fs.closeSync(guardFd); }
      ownGuard();
      if (records.length) {
        const plan = ownerValue('reap-plan', { token: nonce(), records, ...(recency.length ? { recency } : {}), createdAt: Date.now() });
        reaps.push({ name: 'reap-' + plan.token + '.json', plan, data: jsonBytes(plan), fresh: true });
      }
      const recencyByDirectory = new Map();
      for (const reap of reaps) for (const item of reap.plan.recency || []) {
        assertRecencyRepair(item, true); if (fs.existsSync(path.join(item.directory, item.file.file))) recencyByDirectory.set(item.directory, item.file.file);
      }
      // Validate and account every current leaf before any delete. No recursive
      // remove, links, unknown root entries or anonymous partial are accepted.
      let used = 0;
      const interruptedCleanup = new Map();
      for (const name of names.filter(name => /^cleanup-[0-9a-f]{24}\.json$/.test(name) &&
        !fs.existsSync(path.join(root, name.replace(/\.json$/, '.result.json'))))) {
        const plan = verifyCleanupRecord(name);
        if (interruptedCleanup.has(plan.directory)) fail('同一目标存在重复的未完成清理计划。');
        interruptedCleanup.set(plan.directory, plan);
      }
      const claimedRecords = new Set(reaps.flatMap(reap => reap.plan.records.map(item => item.file.file)));
      for (const name of fs.readdirSync(root)) {
        const file = path.join(root, name), stat = fs.lstatSync(file);
        if (stat.isDirectory()) {
          const planned = interruptedCleanup.get(file) || partialPlans.find(plan => plan.directory === file);
          if (!cachePattern.test(name) && !planned) fail('恢复根含未知目录。');
          directory(file);
          if (planned) {
            if (!sameDirectoryIdentity(file, stat, planned.directoryIdentity) ||
              planned.reason === 'owned-job-stopped-interrupted-output' && planned.taskKey !== options.taskOwner?.key)
              fail('原清理计划目录身份或任务绑定已改变。');
            const expected = new Map(planned.files.map(item => [item.file, item]));
            for (const leaf of fs.readdirSync(file)) if (!expected.has(leaf) ||
              JSON.stringify(leafSnapshot(path.join(file, leaf))) !== JSON.stringify(expected.get(leaf))) fail('原清理计划剩余文件已改变。');
          }
          if (name.startsWith('media-') && !interruptedCleanup.has(file)) inspectDirectory(file, 'cache', name.slice(6, 70), false, recencyByDirectory.get(file));
          for (const leaf of fs.readdirSync(file)) used += regular(path.join(file, leaf)).size;
        } else {
          if (!['owner.json', 'writer.lock', 'recovery.lock'].includes(name) && !/^lease-[0-9a-f]{24}\.json$/.test(name) &&
            !(claimedRecords.has(name) && /^writer-current-[0-9a-f]{24}(?:\.next)?\.json$/.test(name)) &&
            !/^(?:cleanup|reap)-[0-9a-f]{24}(?:\.result)?\.json$/.test(name)) fail('恢复根含未知文件。');
          if (name.startsWith('cleanup-')) verifyCleanupRecord(name);
          if (name.startsWith('reap-')) verifyReapRecord(name);
          used += regular(file).size;
        }
      }
      const plans = partialPlans.map(plan => ({ plan, data: jsonBytes(plan) }));
      const needed = plans.reduce((n, p) => n + p.data.length, 0) + reaps.reduce((n, p) => n + (p.fresh ? p.data.length : 0) + 4096, 0);
      if (!Number.isSafeInteger(used) || used + needed > diskBytes) fail('没有空间预留恢复清单及回执；未删除。');
      for (const item of records) if (!processIdentity.inspect(item.ownerRecord).safe) fail('恢复前任务终止证据不足；保留。');
      for (const item of records) if (JSON.stringify(leafSnapshot(path.join(root, item.file.file))) !== JSON.stringify(item.file)) fail('恢复前任务记录已变化。');
      for (const { plan, data } of plans) { ownGuard(); writeRecord(path.join(root, 'cleanup-' + plan.token + '.json'), data); }
      for (const reap of reaps) {
        ownGuard();
        if (reap.fresh) writeRecord(path.join(root, reap.name), reap.data);
        for (const item of reap.plan.recency || []) assertRecencyRepair(item, true);
        for (const item of [...reap.plan.records].sort((a, b) => Number(a.file.file === 'writer.lock') - Number(b.file.file === 'writer.lock'))) {
          if (!processIdentity.inspect(item.ownerRecord).safe) fail('恢复任务身份仍不确定；未删除该项。');
          const file = path.join(root, item.file.file);
          if (fs.existsSync(file) && JSON.stringify(leafSnapshot(file)) !== JSON.stringify(item.file)) fail('恢复目标已经替换；未删除。');
        }
        let freedBytes = 0;
        for (const item of reap.plan.recency || []) {
          ownGuard(); if (!assertRecencyRepair(item, true)) continue;
          fs.unlinkSync(path.join(item.directory, item.file.file)); freedBytes += item.file.bytes;
        }
        for (const item of [...reap.plan.records].sort((a, b) => Number(a.file.file === 'writer.lock') - Number(b.file.file === 'writer.lock'))) {
          ownGuard(); const file = path.join(root, item.file.file);
          if (!fs.existsSync(file)) continue;
          if (JSON.stringify(leafSnapshot(file)) !== JSON.stringify(item.file)) fail('恢复删除前目标已变化。');
          fs.unlinkSync(file); freedBytes += item.file.bytes;
        }
        writeRecord(path.join(root, reap.name.replace(/\.json$/, '.result.json')),
          jsonBytes(ownerValue('reap-result', { token: reap.plan.token, status: 'completed', freedBytes, planSha256: sha(reap.data), completedAt: Date.now() })));
      }
    } finally {
      if (!guarded) { try { fs.closeSync(guardFd); } catch (_) { /* Already closed. */ }
        const current = regular(guardPath);
        if (!sameFile(guardIdentity, current) || current.size !== guardWritten || !fs.readFileSync(guardPath).equals(guardData.subarray(0, guardWritten)))
          fail('恢复锁身份未知；保留。');
        fs.unlinkSync(guardPath); }
    }
  }
  async function hashFile(file, signal) {
    cancelled(signal); const before = regular(file), handle = await fs.promises.open(file, 'r');
    try {
      if (!sameFile(before, await handle.stat())) fail('读取前缓存资产身份已改变。');
      const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(Math.min(MIB, before.size || 1)); let at = 0;
      while (at < before.size) {
        cancelled(signal); const result = await handle.read(buffer, 0, Math.min(buffer.length, before.size - at), at);
        if (!result.bytesRead) fail('缓存资产读取不完整。'); hash.update(buffer.subarray(0, result.bytesRead)); at += result.bytesRead;
      }
      const after = await handle.stat(), current = regular(file);
      if (!sameFile(before, after) || !sameFile(before, current) || after.size !== before.size || current.size !== before.size || before.mtimeMs !== after.mtimeMs || before.mtimeMs !== current.mtimeMs)
        fail('读取期间缓存资产已改变。');
      cancelled(signal); return hash.digest('hex');
    } finally { await handle.close(); }
  }
  function writeAll(fd, data, position, onWrite) {
    let at = 0;
    while (at < data.length) {
      const count = fs.writeSync(fd, data, at, data.length - at, position + at);
      if (!Number.isSafeInteger(count) || count <= 0 || count > data.length - at) fail('缓存写入未完整完成。');
      at += count; if (onWrite) onWrite(count);
    }
  }
  function releaseWriter(job) {
    if (job.closed) return false;
    assertWriter(job, true); fs.unlinkSync(path.join(root, 'writer.lock')); job.closed = true; activeRoots.delete(root); return true;
  }
  function batchCurrentNames(token) { return ['writer-current-' + token + '.json', 'writer-current-' + token + '.next.json']; }
  function validTaskOwner(value) {
    return value && value.schema === 'eva-task-owner-v1' && /^[0-9a-f]{64}$/.test(value.key || '') &&
      /^[0-9a-f]{32}$/.test(value.epoch || '') && Number.isSafeInteger(value.guardPid) && value.guardPid > 0;
  }
  function validateBatchCurrent(writer, writerSha256, value) {
    if (writer.mode !== 'batch-v1' || !validTaskOwner(writer.taskOwner)) fail('批量写锁格式或守护身份不符。');
    const keys = new Set(['schema', 'owner', 'recipe', 'root', 'kind', 'token', 'taskOwner', 'writerSha256', 'sequence',
      'segmentToken', 'sourceSha256', 'previewQuality', 'target', 'previousSha256']);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.has(key)) ||
      value.schema !== 1 || value.owner !== OWNER || value.recipe !== RECIPE || value.root !== root || value.kind !== 'batch-current' ||
      value.token !== writer.token || value.writerSha256 !== writerSha256 || !/^[0-9a-f]{64}$/.test(value.sourceSha256 || '') ||
      !/^[0-9a-f]{24}$/.test(value.segmentToken || '') || !Number.isSafeInteger(value.sequence) || value.sequence < 1 ||
      value.previewQuality !== writer.previewQuality || value.target !== path.join(root, cacheLeaf(value.sourceSha256, value.previewQuality)) ||
      !(value.previousSha256 === null || /^[0-9a-f]{64}$/.test(value.previousSha256 || '')) || !validTaskOwner(value.taskOwner) ||
      (value.sequence === 1 ? value.previousSha256 !== null : !/^[0-9a-f]{64}$/.test(value.previousSha256 || '')) ||
      ['schema', 'key', 'epoch', 'guardPid'].some(key => value.taskOwner[key] !== writer.taskOwner[key])) fail('批量目标记录身份或目标不符。');
    return value;
  }
  function readBatchCurrent(writer, writerSha256, next = false) {
    const name = batchCurrentNames(writer.token)[next ? 1 : 0], file = path.join(root, name);
    if (regular(file).size > 4096) fail('批量目标记录超过4KiB。');
    const raw = readVerifiedBytes(file), value = validateBatchCurrent(writer, writerSha256, JSON.parse(raw.bytes.toString('utf8')));
    return { ...raw, value, file };
  }
  function batchReapTarget(plan, parent) {
    const slot = plan.records.find(record => record.file.file === batchCurrentNames(parent.ownerRecord.token)[0]);
    if (!slot || typeof slot.ownerRecord.currentBytes !== 'string') fail('批量恢复缺少已验证当前目标字节。');
    const bytes = Buffer.from(slot.ownerRecord.currentBytes, 'base64');
    if (bytes.length > 4096 || bytes.toString('base64') !== slot.ownerRecord.currentBytes || sha(bytes) !== slot.file.sha256)
      fail('批量恢复当前目标摘要不符。');
    return validateBatchCurrent(parent.ownerRecord, parent.file.sha256, JSON.parse(bytes.toString('utf8')));
  }
  function stoppedBatch(writer, writerSha256) {
    const names = batchCurrentNames(writer.token), partial = path.join(root, 'partial-' + writer.token), recency = [];
    for (const name of fs.readdirSync(root)) if (cachePattern.test(name)) {
      const dir = path.join(root, name); directory(dir);
      if (fs.existsSync(path.join(dir, 'owner.next-' + writer.token + '.json'))) recency.push(dir);
    }
    let current = null, currentError = null;
    try { if (fs.existsSync(path.join(root, names[0]))) current = readBatchCurrent(writer, writerSha256); }
    catch (error) { currentError = error; }
    if ((!current || currentError) && (fs.existsSync(partial) || recency.length)) fail('批量当前目标缺失或损坏且有未完成产物；保留全部文件。');
    if (current && recency.some(dir => dir !== current.value.target)) fail('批量最近使用残片不属于当前目标；保留。');
    const slots = [];
    for (const name of names) if (fs.existsSync(path.join(root, name))) {
      const file = leafSnapshot(path.join(root, name));
      if (file.bytes > 4096) fail('批量目标残片超过4KiB；保留。');
      // A stopped guard proves ownership of these two exact names reserved by
      // its immutable batch writer, including an interrupted/empty next write.
      const ownerRecord = { ...writer, kind: 'batch-slot', writerSha256,
        ...(name === names[0] && current ? { currentBytes: current.bytes.toString('base64') } : {}) };
      slots.push({ file, ownerRecord });
    }
    return { current, slots };
  }
  function assertBatchCurrent(parent, segmentToken) {
    const current = readBatchCurrent(parent.writer, parent.lockSha), expected = parent.batch.current;
    if (!expected || current.digest !== expected.digest || !sameVerifiedStamp(expected.identity, current.identity) ||
      (segmentToken && current.value.segmentToken !== segmentToken)) fail('批量当前目标已改变。');
    return current;
  }
  function publishBatchCurrent(parent, settings) {
    const state = parent.batch; assertWriter(parent);
    const old = state.current ? assertBatchCurrent(parent) : null;
    const names = batchCurrentNames(parent.token), currentFile = path.join(root, names[0]), nextFile = path.join(root, names[1]);
    if ((!old && fs.existsSync(currentFile)) || fs.existsSync(nextFile)) fail('批量目标槽含未知记录；保留。');
    if (!Number.isSafeInteger(state.sequence + 1)) fail('批量目标序号超过安全范围。');
    const value = ownerValue('batch-current', { token: parent.token, taskOwner: parent.writer.taskOwner, writerSha256: parent.lockSha,
      sequence: state.sequence + 1, segmentToken: nonce(), sourceSha256: settings.sourceSha256,
      ...(settings.previewQuality === undefined ? {} : { previewQuality: settings.previewQuality }),
      target: path.join(root, cacheLeaf(settings.sourceSha256, settings.previewQuality)), previousSha256: old ? old.digest : null });
    const data = jsonBytes(value); if (data.length > 4096) fail('批量目标记录超过4KiB。');
    let fd, written = 0, identity, renamed = false;
    parent.target = value.target; charge(parent, data.length);
    try {
      fd = fs.openSync(nextFile, 'wx'); identity = fs.fstatSync(fd, { bigint: true });
      state.staged = { file: nextFile, identity, data, written: 0 };
      writeAll(fd, data, 0, count => { written += count; state.staged.written = written; }); fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      const checked = readBatchCurrent(parent.writer, parent.lockSha, true);
      if (checked.digest !== sha(data) || !sameVerifiedStamp(identity, checked.identity) &&
        (identity.ino !== checked.identity.ino || identity.dev !== checked.identity.dev)) fail('批量下一目标落盘校验失败。');
      if (old) assertBatchCurrent(parent);
      assertWriter(parent); fs.renameSync(nextFile, currentFile); renamed = true;
      parent.disk -= old ? old.bytes.length : 0; state.staged = null;
      const published = readBatchCurrent(parent.writer, parent.lockSha);
      if (published.digest !== checked.digest || published.identity.ino !== checked.identity.ino || published.identity.dev !== checked.identity.dev)
        fail('批量当前目标原子发布后身份已改变。');
      state.current = published; state.sequence = published.value.sequence; return published.value;
    } catch (error) { if (!renamed) parent.disk -= data.length - written; throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function openBatch({ sourceSha256, previewQuality, sessionSignal } = {}) {
    if (!validTaskOwner(options.taskOwner)) fail('批量写入需要已核验的Windows任务守护身份。');
    const context = acquireWriter({ sourceSha256, previewQuality, signal: sessionSignal }, true), parent = context.job, state = parent.batch;
    activeBatch = parent;
    const api = Object.freeze({
      beginSegment(settings = {}) {
        assertWriter(parent);
        if (state.closing || state.active) fail('上一批量子事务尚未归还或会话正在关闭。');
        const selected = { sourceSha256: settings.sourceSha256, previewQuality: settings.previewQuality, signal: settings.signal };
        if (!/^[0-9a-f]{64}$/.test(selected.sourceSha256 || '') || selected.previewQuality !== previewQuality) fail('批量段内容指纹或画质不符。');
        cancelled(selected.signal);
        const current = publishBatchCurrent(parent, selected);
        const child = { ...parent, parent, segmentToken: current.segmentToken, signal: selected.signal, closed: false, partial: null,
          published: false, target: current.target, files: new Map(), streams: new Set(), closingStreams: new Set(), ledger: null };
        Object.defineProperty(child, 'disk', { get: () => parent.disk, set: value => { parent.disk = value; } });
        const writer = { ...context.writer, children: [] }; state.active = child;
        return createTransaction({ ...context, job: child, writer }, selected);
      },
      snapshot() {
        if (!parent.closed) { assertWriter(parent, true); if (state.current) assertBatchCurrent(parent); }
        return Object.freeze({ usedBytes: parent.disk, diskLimitBytes: diskBytes, minimumFreeBytes: 128 * MIB,
          active: !!state.active, sequence: state.sequence, closed: parent.closed });
      },
      async close() {
        if (parent.closed) return false;
        assertWriter(parent, true);
        if (state.active) fail('批量子事务仍在处理，不能释放根写锁。');
        state.closing = true;
        if (state.staged) {
          const staged = state.staged, actual = readVerifiedBytes(staged.file);
          if (actual.identity.ino !== staged.identity.ino || actual.identity.dev !== staged.identity.dev ||
            !actual.bytes.equals(staged.data.subarray(0, staged.written))) fail('批量下一目标残片身份已改变。');
          fs.unlinkSync(staged.file); parent.disk -= actual.bytes.length; state.staged = null;
        }
        if (state.current) assertBatchCurrent(parent);
        if (fs.existsSync(path.join(root, 'partial-' + parent.token))) fail('批量临时目录尚未收尾。');
        const actualBytes = usage(parent);
        if (actualBytes !== parent.disk) fail('批量账本与实际文件字节不符；保留写锁。');
        if (state.current) { const current = assertBatchCurrent(parent); fs.unlinkSync(current.file); parent.disk -= current.bytes.length; state.current = null; }
        const lockBytes = regular(path.join(root, 'writer.lock')).size;
        releaseWriter(parent); parent.disk -= lockBytes; activeBatch = null; return true;
      }
    });
    return api;
  }
  function writeBatchMetadata(job, file, data, precharged = false) {
    let fd, identity, written = 0; if (!precharged) charge(job, data.length);
    try {
      fd = fs.openSync(file, 'wx'); identity = fs.fstatSync(fd, { bigint: true });
      writeAll(fd, data, 0, count => { written += count; }); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      const actual = readVerifiedBytes(file);
      if (actual.identity.ino !== identity.ino || actual.identity.dev !== identity.dev || !actual.bytes.equals(data)) fail('批量占用记录落盘校验失败。');
      return regular(file);
    } catch (error) {
      job.disk -= data.length - written;
      try {
        if (fd !== undefined) { fs.closeSync(fd); fd = undefined; }
        if (identity) {
          const actual = readVerifiedBytes(file);
          if (actual.identity.ino !== identity.ino || actual.identity.dev !== identity.dev || !actual.bytes.equals(data.subarray(0, written)))
            fail('批量占用残片身份已改变。');
          fs.unlinkSync(file); job.disk -= written;
        }
      } catch (cleanupError) { throw Object.assign(new Error('批量占用写入失败且清理失败：' + cleanupError.message), { code: 'MEDIA_CLEANUP_FAILED', cause: error }); }
      throw error;
    }
  }
  function acquireWriter({ sourceSha256, signal, clearOthers = false, previewQuality } = {}, batchMode = false) {
    cancelled(signal);
    if (previewQuality !== undefined) previewProfile.quality(previewQuality);
    if (typeof sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sourceSha256)) fail('源内容指纹不正确。');
    if (activeRoots.has(root)) fail('同一缓存已有准备事务，写锁仍被占用。');
    ensureRoot();
    recoverOrphans();
    // Process discovery can block or fail. Do it before creating a lock so
    // interruption there cannot strand an empty file without ownership data.
    const token = nonce();
    const writer = ownerValue('writer', { token, pid: process.pid, sourceSha256, ...(batchMode ? { mode: 'batch-v1' } : {}), ...(previewQuality === undefined ? {} : { previewQuality }), processIdentity: processIdentity.self(), children: [] });
    const lockData = jsonBytes(writer);
    cancelled(signal);
    const job = { token, signal, closed: false, partial: null, published: false, disk: 0, initializing: true,
      target: path.join(root, cacheLeaf(sourceSha256, previewQuality)),
      files: new Map(), streams: new Set(), closingStreams: new Set(), lockIdentity: null, lockSha: sha(lockData), maxSequence: 0,
      writer, ...(batchMode ? { batch: { active: null, current: null, sequence: 0, closing: false } } : {}) };
    const lockPath = path.join(root, 'writer.lock'); let fd, recoveredEmpty = null;
    try { fd = fs.openSync(lockPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const prior = regular(lockPath);
      if (prior.size === 0 && writer.processIdentity && typeof processIdentity.claimEmptyWriter === 'function' && processIdentity.claimEmptyWriter(lockPath, lockData)) {
        recoveredEmpty = prior; fd = fs.openSync(lockPath, 'r+');
      } else {
        error.message = '另一个缓存任务仍在运行，或残留记录暂时无法安全恢复。请关闭其他视频分析窗口后重试。';
        error.code = 'CACHE_BUSY'; throw error;
      }
    }
    let lockWritten = recoveredEmpty ? lockData.length : 0, cleanup;
    try {
      job.lockIdentity = fs.fstatSync(fd);
      if (recoveredEmpty && (!sameFile(recoveredEmpty, job.lockIdentity) || !fs.readFileSync(fd).equals(lockData))) fail('空锁接管后文件身份改变。');
      activeRoots.add(root);
      // Publish ownership immediately, before expensive synchronous inventory.
      // A renderer exit during inventory must not strand an anonymous empty lock.
      if (!recoveredEmpty) writeAll(fd, lockData, 0, count => { lockWritten += count; });
      fs.fsyncSync(fd); fs.closeSync(fd);
      job.disk = usage(job); charge(job, 0);
      assertWriter(job);
      job.initializing = false;
      resumeCleanup(job);
      cleanup = cleanOther(job, clearOthers);
    } catch (error) {
      try { fs.closeSync(fd); } catch (_) { /* Already closed. */ }
      try {
        verifyRoot(); const current = regular(lockPath);
        if (!job.lockIdentity || !sameFile(job.lockIdentity, current) || current.size !== lockWritten || !fs.readFileSync(lockPath).equals(lockData.subarray(0, lockWritten)))
          fail('未完整建立的写锁身份未知，保留原件。');
        fs.unlinkSync(lockPath); activeRoots.delete(root); job.closed = true;
      } catch (cleanupError) { error.cleanupError = cleanupError.message; }
      if (batchMode && error.cleanupError) {
        const failure = Object.assign(new Error('批量写锁初始化失败且归属清理失败：' + error.cleanupError),
          { code: 'MEDIA_CLEANUP_FAILED', cause: error }); throw failure;
      }
      throw error;
    }
    return { job, writer, lockPath, cleanup };
  }
  function begin(settings = {}) { return createTransaction(acquireWriter(settings), settings); }
  function createTransaction(context, { sourceSha256, signal, previewQuality } = {}) {
    const { job, writer, lockPath, cleanup } = context;
    const target = path.join(root, cacheLeaf(sourceSha256, previewQuality));
    let candidate = null, candidatePinned = null, finished = null;
    function updateWriter() {
      if (options.taskOwner) return; // Child ownership is atomic in the OS group; keep this record immutable.
      assertWriter(job, true); const data = jsonBytes(writer), current = regular(lockPath), oldBytes = current.size;
      if (data.length > oldBytes) charge(job, data.length - oldBytes);
      const out = fs.openSync(lockPath, 'r+');
      try {
        if (!sameFile(job.lockIdentity, fs.fstatSync(out))) fail('更新任务登记前写锁身份已改变。');
        writeAll(out, data, 0); fs.ftruncateSync(out, data.length); fs.fsyncSync(out);
      } finally { fs.closeSync(out); }
      job.lockSha = sha(data); if (data.length < oldBytes) job.disk -= oldBytes - data.length;
      assertWriter(job, true);
    }
    function beforeSpawn() {
      assertWriter(job); if (writer.children.length >= 32) fail('本次辅助进程登记超过上限。');
      const token = nonce(); writer.children.push({ token, state: 'starting', identity: null });
      try { updateWriter(); } catch (error) { writer.children.pop(); throw error; } return token;
    }
    function childStarted(token, pid) {
      const item = writer.children.find(child => child.token === token);
      if (!item || item.state !== 'starting') fail('辅助进程启动登记不符。');
      item.state = 'running'; item.identity = Number.isSafeInteger(pid) && pid > 0 ? processIdentity.child(pid) : null; updateWriter();
    }
    function childClosed(token) {
      const item = writer.children.find(child => child.token === token);
      if (!item || item.state === 'closed') return;
      item.state = 'closed'; updateWriter();
    }
    function ledgerEntry(name, identity) {
      const ledger = job.ledger;
      if (!ledger || ledger.closed) fail('临时文件归属账本已关闭。');
      const current = regular(path.join(job.partial, 'transaction.log'));
      if (!sameFile(ledger.identity, current) || !sameFile(ledger.identity, fs.fstatSync(ledger.fd)) || current.size !== ledger.bytes) fail('临时账本身份已改变。');
      const data = Buffer.from(JSON.stringify({ file: name, dev: ledgerId(identity.dev), ino: ledgerId(identity.ino) }) + '\n');
      if (ledger.bytes + data.length > LIMITS.metadataBytes) fail('临时归属账本超过上限。');
      let at = 0;
      charge(job, data.length);
      try { writeAll(ledger.fd, data, ledger.bytes, n => { ledger.hash.update(data.subarray(at, at + n)); at += n; ledger.bytes += n; }); }
      catch (error) { if (job.parent) job.disk -= data.length - at; throw error; }
    }
    function closeLedger(remove = false) {
      const ledger = job.ledger; if (!ledger) return;
      if (!ledger.closed) { try { fs.fsyncSync(ledger.fd); } finally { fs.closeSync(ledger.fd); ledger.closed = true; } }
      if (remove && !ledger.removed) {
        const file = path.join(job.partial, 'transaction.log'), stat = regular(file);
        if (!sameFile(ledger.identity, stat) || stat.size !== ledger.bytes || leafSnapshot(file).sha256 !== ledger.hash.copy().digest('hex')) fail('临时账本身份已变化。');
        fs.unlinkSync(file); job.disk -= stat.size; ledger.removed = true;
      }
    }
    function ensurePartial() {
      assertWriter(job);
      if (candidate || job.published) fail('完整缓存不能作为临时写入目标。');
      if (!job.partial) {
        const dir = path.join(root, 'partial-' + (options.taskOwner ? job.token : nonce())), data = jsonBytes(ownerValue('partial', { token: job.token }));
        const markerPath = path.join(dir, 'owner.json'); let made = false, ownerStarted = false, ownerWritten = false, dirIdentity;
        charge(job, data.length);
        try {
          fs.mkdirSync(dir); made = true; job.partial = dir; dirIdentity = fs.lstatSync(dir, { bigint: true });
          ownerStarted = true;
          if (job.parent) writeBatchMetadata(job, markerPath, data, true);
          else fs.writeFileSync(markerPath, data, { flag: 'wx' });
          ownerWritten = true;
          const ledgerFd = fs.openSync(path.join(dir, 'transaction.log'), 'wx+');
          try { job.ledger = { fd: ledgerFd, identity: fs.fstatSync(ledgerFd), bytes: 0, closed: false, removed: false, hash: crypto.createHash('sha256') }; }
          catch (error) { fs.closeSync(ledgerFd); throw error; }
        } catch (error) {
          if (!made || !ownerStarted) job.disk -= data.length;
          else if (!job.parent && !ownerWritten && !fs.existsSync(markerPath)) job.disk -= data.length;
          if (made && !fs.existsSync(markerPath)) try {
            const current = directory(dir), exact = fs.lstatSync(dir, { bigint: true });
            if (!dirIdentity || exact.ino !== dirIdentity.ino || exact.dev !== dirIdentity.dev || !current.isDirectory() || fs.readdirSync(dir).length)
              fail('未完成的临时目录身份不明；保留。');
            fs.rmdirSync(dir); job.partial = null;
          } catch (cleanupError) { error.cleanupError = cleanupError.message; }
          throw error;
        }
      }
      const marker = verifyOwner(job.partial, 'partial'); if (marker.token !== job.token) fail('临时缓存事务身份已改变。');
    }
    function openAsset(name, internal = false, maximumBytes = LIMITS.assetBytes) {
      safeName(name);
      if ((!internal && (['owner.json', 'manifest.json', 'writer.lock', 'transaction.log'].includes(name) || /^owner\.next(?:-[0-9a-f]{24})?\.json$/.test(name))) || job.files.has(name)) fail('缓存文件已登记或属于保留名称。');
      ensurePartial();
      const file = path.join(job.partial, name), fileFd = fs.openSync(file, 'wx+');
      const record = { file: name, bytes: 0, identity: fs.fstatSync(fileFd), closed: false, sha256: null };
      job.files.set(name, record); job.streams.add(record); let closing = null;
      try { ledgerEntry(name, fs.fstatSync(fileFd, { bigint: true })); }
      catch (error) { fs.closeSync(fileFd); record.closed = true; job.streams.delete(record); throw error; }
      function checkStream() {
        assertWriter(job); if (record.closed || closing) fail('缓存输出流已经关闭。');
        const current = regular(file);
        if (!sameFile(record.identity, current) || !sameFile(record.identity, fs.fstatSync(fileFd)) || current.size !== record.bytes) fail('缓存输出文件身份或长度已改变。');
      }
      return Object.freeze({
        append(data) {
          checkStream(); if (!Buffer.isBuffer(data)) fail('缓存输出只接受Buffer。');
          if (record.bytes + data.length > (internal ? LIMITS.metadataBytes : maximumBytes)) fail('单个缓存资产超过上限。');
          const before = record.bytes; charge(job, data.length);
          try { writeAll(fileFd, data, record.bytes, count => { record.bytes += count; }); }
          catch (error) { if (job.parent) job.disk -= data.length - (record.bytes - before); throw error; }
        },
        readPrefix(maximum = LIMITS.prefixBytes) {
          checkStream();
          if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > LIMITS.prefixBytes) fail('缓存头读取超过4096字节。');
          const data = Buffer.alloc(Math.min(maximum, record.bytes)); let at = 0;
          while (at < data.length) { const count = fs.readSync(fileFd, data, at, data.length - at, at); if (!count) fail('缓存头读取不完整。'); at += count; }
          return data;
        },
        patch(offset, data) {
          checkStream();
          if (!Buffer.isBuffer(data) || !Number.isSafeInteger(offset) || offset < 0 || offset + data.length > record.bytes) fail('缓存补写不能扩展文件。');
          writeAll(fileFd, data, offset);
        },
        close() {
          if (closing) return closing;
          closing = (async () => {
            fs.closeSync(fileFd); record.closed = true; job.streams.delete(record);
            const current = regular(file);
            if (!sameFile(record.identity, current) || current.size !== record.bytes) fail('关闭时缓存输出身份已改变。');
            record.sha256 = await hashFile(file, null);
            return Object.freeze({ file: name, bytes: record.bytes, sha256: record.sha256 });
          })();
          job.closingStreams.add(closing); closing.then(() => job.closingStreams.delete(closing), () => job.closingStreams.delete(closing));
          return closing;
        }
      });
    }
    let packedWriter = null, packedBytes = 0, packedResult = null, packedClosing = null;
    const packedHash = crypto.createHash('sha256'), packedRecords = new Map();
    async function writeFrame(name, data) {
      if (!options.packFrames) return writeAsset(name, data);
      safeName(name);
      if (!(name.endsWith('.jpg') || /^\d{1,12}\.avc$/.test(name)) || packedClosing || packedRecords.has(name) || job.files.has(name) || !Buffer.isBuffer(data) || !data.length || data.length > LIMITS.assetBytes)
        fail('图片包帧写入无效、重复或已经关闭。');
      if (!packedWriter) packedWriter = openAsset(framePack.FILE, false, diskBytes);
      packedWriter.append(data); packedHash.update(data);
      const asset = Object.freeze({ file: name, bytes: data.length, sha256: sha(data), offset: packedBytes });
      packedBytes += data.length; packedRecords.set(name, asset); return asset;
    }
    function finishFrames() {
      if (!packedWriter) return Promise.resolve(null);
      if (!packedClosing) packedClosing = packedWriter.close().then(asset => {
        if (asset.bytes !== packedBytes || asset.sha256 !== packedHash.digest('hex')) fail('图片包实际内容与生成结果不符。');
        packedResult = Object.freeze({ schema: 1, ...asset }); return packedResult;
      });
      return packedClosing;
    }
    async function writeAsset(name, data, internal = false) {
      safeName(name);
      if ((!internal && (['owner.json', 'manifest.json', 'writer.lock', 'transaction.log'].includes(name) || /^owner\.next(?:-[0-9a-f]{24})?\.json$/.test(name))) || job.files.has(name)) fail('缓存文件已登记或属于保留名称。');
      if (!Buffer.isBuffer(data)) fail('缓存输出只接受Buffer。');
      if (data.length > (internal ? LIMITS.metadataBytes : LIMITS.assetBytes)) fail('单个缓存资产超过上限。');
      // Whole JPEG/metadata buffers need no streaming boundary. Verify the
      // root, writer and partial once, then create/write/check/close without
      // an await. Audio's streaming API retains its per-operation guards.
      ensurePartial();
      const file = path.join(job.partial, name), fileFd = fs.openSync(file, 'wx+');
      const record = { file: name, bytes: 0, identity: null, closed: false, sha256: null };
      job.files.set(name, record); job.streams.add(record); let primaryError = null, charged = false;
      try {
        record.identity = fs.fstatSync(fileFd);
        ledgerEntry(name, fs.fstatSync(fileFd, { bigint: true }));
        const openedPath = regular(file);
        if (!sameFile(record.identity, openedPath) || openedPath.size !== 0 || record.identity.size !== 0) fail('缓存输出文件身份或长度已改变。');
        charge(job, data.length); charged = true;
        writeAll(fileFd, data, 0, count => { record.bytes += count; });
        const written = fs.fstatSync(fileFd), current = regular(file);
        if (!sameFile(record.identity, written) || !sameFile(record.identity, current) || written.size !== record.bytes || current.size !== record.bytes)
          fail('关闭时缓存输出身份已改变。');
        cancelled(job.signal);
        // This is the expected content hash. finish() still reads every actual
        // asset from disk and checks the hash before it can publish the cache.
        record.sha256 = sha(data);
        return Object.freeze({ file: name, bytes: record.bytes, sha256: record.sha256 });
      } catch (error) { if (job.parent && charged) job.disk -= data.length - record.bytes; primaryError = error; throw error; }
      finally {
        try { fs.closeSync(fileFd); record.closed = true; job.streams.delete(record); }
        catch (error) { if (primaryError) primaryError.closeError = error.message; else throw error; }
      }
    }
    async function readComplete(requirements = {}) {
      if (requirements.colorVersion !== undefined && (typeof requirements.colorVersion !== 'string' || !/^[a-z0-9-]{1,80}$/.test(requirements.colorVersion))) fail('缓存颜色版本要求无效。');
      assertWriter(job);
      if (job.partial || job.published) fail('已经开始写入，不能再读取复用候选。');
      if (candidate && (requirements.colorVersion === undefined || candidate.colorVersion === requirements.colorVersion)) return candidate;
      candidate = null; candidatePinned = null;
      if (!fs.existsSync(target)) return null;
      const inspected = inspectDirectory(target, 'cache', sourceSha256, true); let damaged = !inspected.lengthsMatch;
      if (job.parent && inspected.info.metrics?.sourceSha256 !== job.parent.writer.sourceSha256) fail('批量复用段的源内容指纹不属于当前原视频。');
      for (const item of inspected.map.values()) {
        if (await hashFile(path.join(target, item.file), signal) !== item.sha256) damaged = true;
        assertWriter(job);
      }
      if (damaged) { discardDamaged(job, target, inspected); return null; }
      if (requirements.colorVersion !== undefined && inspected.info.colorVersion !== requirements.colorVersion) {
        discardDamaged(job, target, inspected, 'obsolete-color-cache'); return null;
      }
      candidate = inspected.info; candidatePinned = frozenCopy(candidate); return candidate;
    }
    function registerLease(persisted, currentSource, metrics) {
      assertWriter(job);
      const current = JSON.parse(jsonBytes(currentSource).toString('utf8'));
      if (current.sha256 !== sourceSha256) fail('当前素材绑定与源内容不符。');
      const id = nonce(), file = path.join(root, 'lease-' + id + '.json');
      const data = jsonBytes(ownerValue('lease', { token: id, pid: process.pid, cacheDir: target, sourceSha256,
        processIdentity: processIdentity.self(), children: [] }));
      const info = { ...JSON.parse(jsonBytes(persisted).toString('utf8')), source: current,
        ...(metrics ? { metrics: JSON.parse(jsonBytes(metrics).toString('utf8')) } : {}), cacheDir: target, leaseId: id };
      const map = readAssetsMap(persisted, manifestAssets(persisted, sourceSha256)), capturedSource = frozenCopy(current);
      touch(job, target);
      const markerIdentity = job.parent ? writeBatchMetadata(job, file, data) : (charge(job, data.length), fs.writeFileSync(file, data, { flag: 'wx' }), regular(file));
      live.set(info, { active: true, id, file, cacheDir: target, source: capturedSource,
        markerSha: sha(data), markerIdentity, map, reads: 0 });
      return info;
    }
    async function finish(manifest, currentSource) {
      assertWriter(job);
      if (finished) fail('缓存事务已提交。');
      if (!currentSource || currentSource.sha256 !== sourceSha256) fail('当前素材绑定与源内容不符。');
      if (job.parent && manifest.metrics?.sourceSha256 !== job.parent.writer.sourceSha256) fail('批量段必须绑定原视频内容指纹。');
      if (job.streams.size || job.closingStreams.size) fail('必须先等待缓存输出流真正关闭。');
      if (writer.children.some(child => child.state !== 'closed')) fail('辅助进程仍未退出，不能发布完整缓存。');
      if (candidate) {
        if (manifest !== candidate || JSON.stringify({ ...manifest, metrics: null }) !== JSON.stringify({ ...candidatePinned, metrics: null }))
          fail('复用必须使用本事务已验证且未改写的原始清单。');
        finished = registerLease(candidatePinned, currentSource, manifest.metrics); return finished;
      }
      if (!job.partial) fail('没有可提交的临时缓存。');
      if (manifest.owner !== undefined && manifest.owner !== OWNER || manifest.recipe !== undefined && manifest.recipe !== RECIPE || manifest.schema !== undefined && manifest.schema !== 1)
        fail('缓存清单不能改变所有权或处理版本。');
      const persistent = JSON.parse(jsonBytes({ ...manifest, schema: 1, owner: OWNER, recipe: RECIPE,
        source: contentSource(manifest.source, sourceSha256) }).toString('utf8'));
      if ((persistent.preview && persistent.preview.quality) !== previewQuality)
        fail('输出画质与缓存事务身份不一致，未提交。');
      delete persistent.cacheDir; delete persistent.leaseId;
      const map = manifestAssets(persistent, sourceSha256);
      if (persistent.framePack) {
        if (!packedResult || ['schema', 'file', 'bytes', 'sha256'].some(k => persistent.framePack[k] !== packedResult[k]) || persistent.frames.length !== packedRecords.size ||
            persistent.frames.some(f => { const a = packedRecords.get(f.file); return !a || ['bytes', 'sha256', 'offset'].some(k => a[k] !== f[k]); }))
          fail('图片包清单必须来自本事务原始帧写入记录。');
      } else if (packedRecords.size) fail('图片包写入缺少清单声明。');
      if (map.size !== job.files.size || [...map].some(([name, item]) => {
        const record = job.files.get(name); return !record || !record.closed || record.bytes !== item.bytes || record.sha256 !== item.sha256;
      })) fail('缓存清单与本事务已登记输出不符。');
      await writeAsset('manifest.json', jsonBytes(persistent), true);
      const inspected = inspectDirectory(job.partial, 'partial', sourceSha256);
      for (const item of inspected.map.values()) if (await hashFile(path.join(job.partial, item.file), signal) !== item.sha256) fail('提交前缓存资产发生变化。');
      assertWriter(job);
      closeLedger(true);
      const markerPath = path.join(job.partial, 'owner.json'), oldMarker = regular(markerPath);
      const marker = jsonBytes(ownerValue('cache', { token: job.token }));
      if (marker.length > oldMarker.size) charge(job, marker.length - oldMarker.size);
      if (fs.existsSync(target)) fail('完整缓存目标已存在；拒绝覆盖。');
      // Final synchronous owner change and same-volume publish have no await.
      const markerFd = fs.openSync(markerPath, 'r+');
      try {
        if (!sameFile(oldMarker, fs.fstatSync(markerFd))) fail('临时所有权标记身份已改变。');
        writeAll(markerFd, marker, 0); fs.ftruncateSync(markerFd, marker.length);
      } finally { fs.closeSync(markerFd); }
      if (marker.length < oldMarker.size) job.disk -= oldMarker.size - marker.length;
      fs.renameSync(job.partial, target); forgetDirectory(target); job.partial = null; job.published = true;
      finished = registerLease(persistent, currentSource); return finished;
    }
    function abort() {
      assertWriter(job, true);
      if (job.streams.size || job.closingStreams.size) fail('输出流仍未退出，不能清理临时缓存。');
      if (writer.children.some(child => child.state !== 'closed')) fail('辅助进程仍未退出，不能清理临时缓存。');
      if (!job.partial) return false;
      closeLedger();
      const marker = readJSON(path.join(job.partial, 'owner.json'));
      if (marker.owner !== OWNER || marker.recipe !== RECIPE || marker.root !== root || marker.token !== job.token || !['partial', 'cache'].includes(marker.kind))
        fail('临时缓存所有权未知，未执行删除。');
      directory(job.partial);
      const names = fs.readdirSync(job.partial), expected = new Set(['owner.json', ...job.files.keys(), ...(job.ledger && !job.ledger.removed ? ['transaction.log'] : [])]);
      if (names.length !== expected.size || names.some(name => !expected.has(name))) fail('临时缓存包含未知文件，未执行删除。');
      const sizes = new Map();
      for (const name of names) {
        const stat = regular(path.join(job.partial, name)), record = job.files.get(name);
        if (record && (!record.identity || !sameFile(record.identity, stat) || stat.size !== record.bytes)) fail('临时文件身份或长度已改变，未执行删除。');
        if (name === 'transaction.log' && (!sameFile(job.ledger.identity, stat) || stat.size !== job.ledger.bytes ||
          leafSnapshot(path.join(job.partial, name)).sha256 !== job.ledger.hash.copy().digest('hex'))) fail('临时账本身份或内容已改变；未删除。');
        sizes.set(name, stat.size);
      }
      // Validate every registered path before the first deletion; owner last.
      for (const name of names) if (name !== 'owner.json') fs.unlinkSync(path.join(job.partial, name));
      fs.unlinkSync(path.join(job.partial, 'owner.json')); fs.rmdirSync(job.partial);
      for (const size of sizes.values()) job.disk -= size;
      job.partial = null; job.files.clear(); return true;
    }
    return Object.freeze({ readComplete, writeAsset, writeFrame, finishFrames, openAsset, finish, abort, beforeSpawn, childStarted, childClosed, cleanup,
      close() {
        if (job.parent && job.closed) return false;
        if (job.streams.size || job.closingStreams.size || writer.children.some(child => child.state !== 'closed')) fail('输出流或辅助进程仍未关闭，不能释放写锁。');
        closeLedger();
        if (job.parent) {
          assertWriter(job, true);
          if (job.partial || fs.existsSync(path.join(target, 'owner.next-' + job.token + '.json'))) fail('批量子事务临时产物尚未收尾。');
          job.parent.batch.active = null; job.closed = true; return true;
        }
        return releaseWriter(job);
      } });
  }
  function leaseFor(info) {
    const lease = info && live.get(info);
    if (!lease || !lease.active || info.cacheDir !== lease.cacheDir || info.leaseId !== lease.id) fail('需要本缓存实例登记的原始有效句柄。');
    verifyRoot(); verifyOwner(lease.cacheDir, 'cache');
    if (lease.remote && (!sameFile(lease.markerIdentity, regular(lease.file)) || sha(fs.readFileSync(lease.file)) !== lease.markerSha)) fail('远端占用记录已改变。');
    return lease;
  }
  // A worker pins and owns the lease; the window reads validated local assets.
  // Frame bytes never cross the control pipe. Detaching cannot delete a lease.
  function adoptReadLease(info, expectedTaskOwner) {
    if (!info || live.has(info) || !/^[0-9a-f]{24}$/.test(info.leaseId || '') || !/^[0-9a-f]{64}$/.test(info.source && info.source.sha256 || '')) fail('远端缓存句柄无效。');
    const target = path.join(root, cacheLeaf(info.source.sha256, info.preview && info.preview.quality));
    if (info.cacheDir !== target) fail('远端缓存目录不符。');
    verifyRoot(); const inspected = inspectDirectory(target, 'cache', info.source.sha256);
    function content(value) { const copy = { ...value }; for (const key of ['source', 'metrics', 'cacheDir', 'leaseId']) delete copy[key]; return JSON.stringify(copy); }
    if (content(info) !== content(inspected.info)) fail('远端缓存清单与磁盘不符。');
    const file = path.join(root, 'lease-' + info.leaseId + '.json'), before = regular(file), data = fs.readFileSync(file), marker = JSON.parse(data);
    if (!sameFile(before, regular(file)) || data.length !== before.size) fail('接入期间远端占用已改变。');
    if (marker.owner !== OWNER || marker.recipe !== RECIPE || marker.root !== root || marker.kind !== 'lease' ||
        marker.token !== info.leaseId || marker.cacheDir !== target || marker.sourceSha256 !== info.source.sha256 || !marker.taskOwner) fail('远端缓存占用身份不符。');
    if (expectedTaskOwner && ['key', 'epoch', 'guardPid'].some(key => marker.taskOwner[key] !== expectedTaskOwner[key])) fail('远端占用不属于当前任务负责人。');
    live.set(info, { active: true, remote: true, id: info.leaseId, file, cacheDir: target, source: frozenCopy(info.source),
      markerSha: sha(data), markerIdentity: regular(file), map: readAssetsMap(inspected.info, inspected.map), reads: 0 });
    return info;
  }
  function detachReadLease(info) {
    const lease = info && live.get(info); if (!lease || !lease.active) return false;
    if (!lease.remote || lease.reads) fail('本地读取未结束，不能交还远端占用。');
    lease.active = false; return true;
  }
  async function readAsset(info, file) {
    const lease = leaseFor(info); safeName(file);
    const asset = lease.map.get(file); if (!asset || asset.bytes > LIMITS.assetBytes) fail('文件不在原始缓存句柄的资产表中。');
    if (asset.packedFile) return (await readPacked(info, lease, [asset]))[0];
    const absolute = path.join(lease.cacheDir, file), before = regular(absolute); let handle;
    lease.reads++;
    try {
      handle = await fs.promises.open(absolute, 'r');
      if (before.size !== asset.bytes || !sameFile(before, await handle.stat())) fail('读取前缓存资产身份或长度不符。');
      const data = Buffer.alloc(asset.bytes); let at = 0;
      while (at < data.length) { const result = await handle.read(data, at, data.length - at, at); if (!result.bytesRead) fail('缓存资产读取不完整。'); at += result.bytesRead; }
      const after = await handle.stat(), current = regular(absolute);
      if (!sameFile(before, after) || !sameFile(before, current) || after.size !== asset.bytes || current.size !== asset.bytes || before.mtimeMs !== after.mtimeMs || before.mtimeMs !== current.mtimeMs || sha(data) !== asset.sha256)
        fail('缓存资产读取期间已改变。');
      leaseFor(info); return data;
    } finally { try { if (handle) await handle.close(); } finally { lease.reads--; } }
  }
  async function readPacked(info, lease, items) {
    const first = items[0], absolute = path.join(lease.cacheDir, first.packedFile);
    function exact() {
      const value = fs.lstatSync(absolute, { bigint: true });
      if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1n || !samePath(realpath(absolute), absolute)) fail('图片包文件身份无效。');
      return value;
    }
    const before = exact(), unchanged = value => value.isFile() && value.nlink === 1n && value.ino === before.ino && value.dev === before.dev &&
      value.size === before.size && value.mtimeNs === before.mtimeNs;
    const bytes = items.reduce((n, item) => n + item.bytes, 0); let handle; lease.reads++;
    try {
      handle = await fs.promises.open(absolute, 'r');
      if (before.size !== BigInt(first.packedBytes) || !unchanged(await handle.stat({ bigint: true }))) fail('读取前图片包身份或长度不符。');
      const data = Buffer.alloc(bytes); let at = 0;
      while (at < bytes) { const r = await handle.read(data, at, bytes - at, first.offset + at); if (!r.bytesRead) fail('图片包读取不完整。'); at += r.bytesRead; }
      if (!unchanged(await handle.stat({ bigint: true })) || !unchanged(exact())) fail('读取期间图片包已改变。');
      const result = []; let offset = 0;
      for (const item of items) {
        const part = data.subarray(offset, offset + item.bytes); offset += item.bytes;
        if (sha(part) !== item.sha256) fail('图片包帧内容指纹不符。');
        // Independent buffers allow per-frame RAM eviction to release real
        // storage. The caller reserves both batch input and returned copies.
        if (items.length === 1) result.push(part);
        else { const independent = Buffer.alloc(part.length); part.copy(independent); result.push(independent); }
      }
      leaseFor(info); return result;
    } finally { try { if (handle) await handle.close(); } finally { lease.reads--; } }
  }
  async function readFrameBatch(info, files) {
    const lease = leaseFor(info);
    if (!Array.isArray(files) || !files.length || files.length > 2048 || new Set(files).size !== files.length) fail('图片包预载批次无效。');
    const items = files.map(file => { safeName(file); const item = lease.map.get(file); if (!item || !item.packedFile) fail('批次必须来自已登记的图片包帧。'); return item; });
    let end = items[0].offset, bytes = 0;
    for (const item of items) {
      if (item.packedFile !== items[0].packedFile || item.offset !== end) fail('批次帧必须连续且属于同一图片包。');
      end += item.bytes; bytes += item.bytes; if (bytes > framePack.BATCH_BYTES) fail('图片包预载批次超过1MiB。');
    }
    return readPacked(info, lease, items);
  }
  function release(info) {
    const lease = info && live.get(info); if (!lease || !lease.active) return false;
    if (lease.remote) fail('远端占用只能由任务负责人释放。');
    if (lease.reads) fail('缓存读取尚未结束，不能释放占用记录。');
    leaseFor(info); const stat = regular(lease.file);
    if (!sameFile(lease.markerIdentity, stat) || sha(fs.readFileSync(lease.file)) !== lease.markerSha) fail('占用记录身份已改变；未执行删除。');
    fs.unlinkSync(lease.file); lease.active = false;
    if (activeBatch && !activeBatch.closed) activeBatch.disk -= stat.size;
    return true;
  }
  // Read-only preflight, never a deletion capability or a liveness verdict.
  // A future maintenance transaction must reacquire exclusion and revalidate.
  function inventory() {
    directory(plugin);
    const base = { root, diskLimitBytes: diskBytes, deletionAuthorized: false, assetHashesVerified: false };
    if (!fs.existsSync(root)) return frozenCopy({ ...base, exists: false, usedBytes: 0, caches: [], leases: [] });
    const rootBefore = directory(root); verifyRoot();
    const names = fs.readdirSync(root).sort(), stamps = new Map(), capturedLeaves = new Map(), cacheByDirectory = new Map();
    const stamp = stat => JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs]);
    const directoryKey = dir => { const resolved = path.resolve(dir); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; };
    function capture(file) {
      stamps.set(file, stamp(regular(file)));
      const key = directoryKey(path.dirname(file));
      if (!capturedLeaves.has(key)) capturedLeaves.set(key, []);
      capturedLeaves.get(key).push(path.basename(file));
    }
    if (names.includes('writer.lock')) { const error = new Error('缓存正在写入或留有未确认写锁，暂不盘点；未修改文件。'); error.code = 'CACHE_BUSY'; throw error; }
    const caches = [], leases = [];
    for (const name of names) {
      const file = path.join(root, name), stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        const match = /^media-([0-9a-f]{64})-([0-9a-f]{12})$/.exec(name);
        if (!match || !knownIds.has(match[2])) fail('未知或未完成目录阻止盘点，原件保留。');
        directory(file); capture(path.join(file, 'owner.json')); capture(path.join(file, 'manifest.json'));
        const checked = inspectDirectory(file, 'cache', match[1]);
        for (const leaf of checked.names) if (!stamps.has(path.join(file, leaf))) capture(path.join(file, leaf));
        const owner = verifyOwner(file, 'cache');
        const item = { directory: file, sourceSha256: match[1], recipe: RECIPE, bytes: checked.totalBytes,
          assetCount: checked.map.size, leaseCount: 0, protected: false, lastUsedAt: owner.lastUsedAt || null, useSequence: owner.useSequence || null };
        caches.push(item); cacheByDirectory.set(directoryKey(file), item);
      } else {
        capture(file);
        if (name === 'owner.json') continue;
        if (/^reap-[0-9a-f]{24}(?:\.result)?\.json$/.test(name)) { requireReapCompleted(name); continue; }
        if (/^cleanup-[0-9a-f]{24}(?:\.result)?\.json$/.test(name)) {
          const record = verifyCleanupRecord(name);
          if (record.kind === 'cleanup-plan') {
            const resultName = name.replace(/\.json$/, '.result.json');
            if (!names.includes(resultName) || verifyCleanupRecord(resultName).planSha256 !== leafSnapshot(file).sha256)
              fail('清理事务未完成或回执不符；不提供盘点结果。');
          }
          continue;
        }
        if (!/^lease-[0-9a-f]{24}\.json$/.test(name)) fail('缓存根存在未知文件，停止盘点并保留原件。');
        const value = readJSON(file);
        if (value.owner !== OWNER || value.schema !== 1 || value.recipe !== RECIPE || value.root !== root || value.kind !== 'lease' ||
          value.token !== name.slice(6, -5) || !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
          typeof value.cacheDir !== 'string' || !path.isAbsolute(value.cacheDir) || !samePath(path.dirname(value.cacheDir), root))
          fail('占用记录身份不明，停止盘点并保留原件。');
        leases.push({ file, cacheDir: value.cacheDir, sourceSha256: value.sourceSha256, pid: value.pid, liveness: 'not-checked' });
      }
    }
    for (const lease of leases) {
      const item = cacheByDirectory.get(directoryKey(lease.cacheDir));
      if (!item || item.sourceSha256 !== lease.sourceSha256) fail('占用记录与完整缓存不匹配，停止盘点。');
      item.leaseCount++; item.protected = true;
    }
    let usedBytes = 0;
    for (const [file, before] of stamps) {
      const stat = regular(file); if (stamp(stat) !== before) fail('盘点期间缓存文件已变化，丢弃本次结果。');
      usedBytes += stat.size;
      if (!Number.isSafeInteger(usedBytes) || usedBytes > diskBytes) fail('缓存现有容量超过预算。');
    }
    for (const item of caches) {
      const leaves = fs.readdirSync(item.directory).sort(), captured = capturedLeaves.get(directoryKey(item.directory)).sort();
      if (JSON.stringify(leaves) !== JSON.stringify(captured)) fail('盘点期间缓存目录内容已变化。');
    }
    const rootAfter = directory(root); verifyRoot();
    if (rootBefore.dev !== rootAfter.dev || rootBefore.ino !== rootAfter.ino ||
      JSON.stringify(names) !== JSON.stringify(fs.readdirSync(root).sort())) fail('盘点期间缓存根已变化，丢弃本次结果。');
    return frozenCopy({ ...base, exists: true, usedBytes, caches, leases });
  }
  function clearOther(settings) {
    const tx = begin({ ...settings, clearOthers: true });
    try { return tx.cleanup; } finally { tx.close(); }
  }
  const api = Object.freeze({ root, begin, openBatch, readAsset, readFrameBatch, release, inventory, clearOther, adoptReadLease, detachReadLease });
  manifestMemoDiagnostics.set(api, () => Object.freeze({ ...manifestMemoStats, entries: manifestMemo.size,
    bytes: manifestMemoBytes, maxEntries: MANIFEST_MEMO_LIMITS.entries, maxBytes: MANIFEST_MEMO_LIMITS.bytes }));
  return api;
}

module.exports = { createCache, OWNER, RECIPE, LIMITS,
  _test: Object.freeze({ manifestMemoSnapshot: cache => { const read = manifestMemoDiagnostics.get(cache); return read ? read() : null; } }) };
