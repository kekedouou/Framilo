'use strict';
// Local user data. Immutable, exclusive revisions: no persistent writer lock.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const model = require('./drawing-model.js');
const OWNER = 'eva-drawing-store-v1', MAX_BYTES = 1024 ** 2;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function validateScope(scope) {
  if (!scope || typeof scope.libraryPath !== 'string' || !path.isAbsolute(scope.libraryPath) || typeof scope.itemId !== 'string' || !scope.itemId || scope.itemId.length > 256)
    throw Error('圈画缺少可靠的素材库和素材身份。');
  return { libraryPath: path.resolve(scope.libraryPath).toLowerCase(), itemId: scope.itemId };
}
function validateRecords(records) {
  if (!Array.isArray(records) || records.length > 256) throw Error('当前视频圈画条目达到上限。');
  const ids = new Set();
  return records.map(n => {
    if (!n || Object.keys(n).sort().join(',') !== 'frameId,frameOrdinal,id,nativeId,nativeTime,objects,sourceSha256,time') throw Error('圈画条目包含未知字段，原件已保留。');
    if (!n || typeof n.id !== 'string' || !/^[\w-]{1,80}$/.test(n.id) || ids.has(n.id) || !/^[a-f0-9]{64}$/.test(n.sourceSha256) ||
        !Number.isSafeInteger(n.frameOrdinal) || n.frameOrdinal < 0 || !Number.isSafeInteger(n.frameId) || n.frameId < 0 || !Number.isFinite(n.time) || n.time < 0 ||
        n.nativeId !== null && (typeof n.nativeId !== 'string' || !n.nativeId || n.nativeId.length > 256) ||
        (n.nativeId === null ? n.nativeTime !== null : !Number.isFinite(n.nativeTime) || n.nativeTime < 0)) throw Error('圈画条目格式无效，原件已保留。');
    ids.add(n.id); return { id: n.id, sourceSha256: n.sourceSha256, frameOrdinal: n.frameOrdinal, frameId: n.frameId, time: n.time,
      nativeId: n.nativeId, nativeTime: n.nativeTime, objects: model.validate(n.objects) };
  });
}
function createAnnotationStore({ pluginRoot, io = fs } = {}) {
  const plugin = path.resolve(pluginRoot), root = path.join(plugin, 'annotation-data');
  const identity = s => [s.dev, s.ino, s.size, s.mtimeMs].join(':');
  function directory(file) {
    const s = io.lstatSync(file);
    if (!s.isDirectory() || s.isSymbolicLink() || !same(io.realpathSync(file), file)) throw Error('圈画目录身份异常，未修改数据。');
  }
  function exists(file) { try { io.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
  function readFile(file, max = MAX_BYTES) {
    const s = io.lstatSync(file);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > max || !same(io.realpathSync(file), file)) throw Error('圈画文件不安全或超过容量上限。');
    const data = io.readFileSync(file), after = io.lstatSync(file);
    if (identity(s) !== identity(after) || data.length !== s.size) throw Error('圈画文件在读取时改变，请重试。');
    return { data, stat: s };
  }
  function checkRoot(create = false) {
    directory(plugin);
    if (!exists(root)) {
      if (!create) return false;
      io.mkdirSync(root); io.writeFileSync(path.join(root, 'owner.json'), JSON.stringify({ owner: OWNER }), { flag: 'wx' });
    }
    directory(root);
    if (JSON.parse(readFile(path.join(root, 'owner.json'), 1024).data).owner !== OWNER) throw Error('圈画数据目录归属不明，未修改。');
    return true;
  }
  function target(scope) { return scope === 'visibility' ? { key: 'visibility', scope: null } : { key: hash(JSON.stringify(validateScope(scope))), scope: validateScope(scope) }; }
  function validateBody(value, info) {
    if (!value || Object.keys(value).sort().join(',') !== (info.key === 'visibility' ? 'key,owner,revision,scope,visible' : 'key,owner,records,revision,scope')) throw Error('圈画文档包含未知字段，原件已保留。');
    if (value.owner !== OWNER || value.key !== info.key || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        JSON.stringify(value.scope) !== JSON.stringify(info.scope)) throw Error('圈画文档身份或版本不符。');
    if (info.key === 'visibility') { if (typeof value.visible !== 'boolean') throw Error('屏幕标注显示设置无效。'); }
    else value.records = validateRecords(value.records);
    return value;
  }
  function read(scope) {
    const info = target(scope), empty = { revision: 0, token: null, records: [], visible: true, scope: info.scope };
    if (!checkRoot()) return empty;
    const dir = path.join(root, info.key); if (!exists(dir)) return empty; directory(dir);
    const names = io.readdirSync(dir), revisions = names.filter(n => /^r-\d{12}\.json$/.test(n)).sort();
    if (names.some(n => !/^r-\d{12}\.json$/.test(n) && !/^next-[a-f0-9-]{36}\.json$/.test(n))) throw Error('圈画目录包含未知文件，已停止写入并保留。');
    if (!revisions.length) return empty;
    const name = revisions[revisions.length - 1], file = path.join(dir, name);
    // A power loss after the exclusive hard-link commit can leave our staging
    // link. Remove only the matching known staging link, never an outside link.
    const s = io.lstatSync(file);
    if (s.nlink === 2 && !s.isSymbolicLink()) {
      const pending = names.filter(n => /^next-[a-f0-9-]{36}\.json$/.test(n)).filter(n => {
        const p = path.join(dir, n), t = io.lstatSync(p); return !t.isSymbolicLink() && same(io.realpathSync(p), p) && t.dev === s.dev && t.ino === s.ino;
      });
      if (pending.length === 1) io.unlinkSync(path.join(dir, pending[0]));
    }
    const { data } = readFile(file), value = validateBody(JSON.parse(data), info);
    if (name !== 'r-' + String(value.revision).padStart(12, '0') + '.json') throw Error('圈画版本文件名不符。');
    return { ...value, token: hash(data) };
  }
  function commit(scope, body, expected) {
    const info = target(scope), current = read(scope);
    if (current.token !== expected) throw Error('圈画已在别处改变，请重新载入后编辑；未覆盖原件。');
    const revision = current.revision + 1;
    const value = validateBody({ owner: OWNER, key: info.key, scope: info.scope, revision, ...body }, info);
    const data = Buffer.from(JSON.stringify(value)); if (data.length > MAX_BYTES) throw Error('视频圈画数据超过1MiB，请减少内容；原件保留。');
    checkRoot(true); const dir = path.join(root, info.key); if (!exists(dir)) io.mkdirSync(dir); directory(dir);
    const temp = path.join(dir, 'next-' + crypto.randomUUID() + '.json'), file = path.join(dir, 'r-' + String(revision).padStart(12, '0') + '.json');
    let fd = null, own = null, committed = false;
    try {
      fd = io.openSync(temp, 'wx'); own = io.fstatSync(fd); io.writeFileSync(fd, data); io.fsyncSync(fd); io.closeSync(fd); fd = null;
      directory(dir); if (read(scope).token !== expected) throw Error('圈画保存时版本改变，未覆盖其他修改。');
      const staged = readFile(temp); if (staged.stat.ino !== own.ino || staged.stat.dev !== own.dev || !staged.data.equals(data)) throw Error('圈画临时文件身份改变。');
      // link is exclusive even when two writers passed the optimistic check.
      io.linkSync(temp, file); committed = true;
      try { io.unlinkSync(temp); }
      catch (error) {
        const s = io.lstatSync(file);
        if (error.code !== 'ENOENT' || s.ino !== own.ino || s.dev !== own.dev) throw error;
      }
      own = null;
      const saved = read(scope); if (saved.token !== hash(data)) throw Error('圈画提交后未能核对，请重新读取，勿重复保存。');
      // Keep the latest two complete revisions; user data never enters cache.
      for (const name of io.readdirSync(dir).filter(n => /^r-\d{12}\.json$/.test(n) && Number(n.slice(2, 14)) < revision - 1)) {
        try { const old = readFile(path.join(dir, name)); directory(dir); if (identity(io.lstatSync(path.join(dir, name))) === identity(old.stat)) io.unlinkSync(path.join(dir, name)); } catch (_) { /* Cleanup cannot undo a verified save. */ }
      }
      return saved;
    } catch (error) {
      if (error.code === 'EEXIST') throw Error('圈画版本已由另一个窗口保存，请重新载入，原件未覆盖。');
      if (committed) error.message = '圈画可能已保存，需重新读取核对：' + error.message;
      throw error;
    } finally {
      if (fd !== null) io.closeSync(fd);
      if (own && exists(temp)) { const s = io.lstatSync(temp); if (!s.isSymbolicLink() && s.ino === own.ino && s.dev === own.dev) io.unlinkSync(temp); }
    }
  }
  return Object.freeze({ read, save: (scope, records, token) => commit(scope, { records: validateRecords(records) }, token),
    readVisibility: () => read('visibility'), saveVisibility: (visible, token) => commit('visibility', { visible }, token), root });
}
module.exports = { createAnnotationStore, validateRecords, MAX_BYTES, OWNER };
