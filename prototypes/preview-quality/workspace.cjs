'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const REPO = path.resolve(__dirname, '../..'), MIB = 1024 ** 2;
const LIMITS = Object.freeze({ disk: 2 * 1024 ** 3, evidence: 16 * MIB, slot: 256 * 1024, slots: 63, line: 8192 });
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function identity(file, directory = false) {
  const s = fs.lstatSync(file, { bigint: true });
  if (s.isSymbolicLink() || !(directory ? s.isDirectory() : s.isFile() && s.nlink === 1n) ||
      fs.realpathSync(file).toLowerCase() !== path.resolve(file).toLowerCase()) throw Error('Experimental path identity invalid');
  return { dev: String(s.dev), ino: String(s.ino), bytes: Number(s.size), mtime: String(s.mtimeNs) };
}
function mkdir(file) { if (!fs.existsSync(file)) fs.mkdirSync(file); return identity(file, true); }
function hashFile(file) {
  const before = identity(file), fd = fs.openSync(file, 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  if (JSON.stringify(before) !== JSON.stringify(identity(file))) throw Error('Source changed while hashing');
  return hash.digest('hex');
}
function store() {
  identity(REPO, true); mkdir(path.join(REPO, 'verification-runs'));
  const root = path.join(REPO, 'verification-runs/evolution-01'); mkdir(root);
  const ownerFile = path.join(root, 'owner.json'), owner = { owner: 'eva-evolution-01', schema: 1, limits: LIMITS };
  if (!fs.existsSync(ownerFile)) { try { fs.writeFileSync(ownerFile, JSON.stringify(owner), { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  if (identity(ownerFile).bytes > 4096 || JSON.stringify(JSON.parse(fs.readFileSync(ownerFile))) !== JSON.stringify(owner)) throw Error('Evidence owner mismatch');
  const names = fs.readdirSync(root);
  if (names.length > LIMITS.slots + 1 || names.some(n => n !== 'owner.json' && (!/^slot-\d{3}\.jsonl$/.test(n) || Number(n.slice(5,8))<1 || Number(n.slice(5,8))>LIMITS.slots))) throw Error('Unknown evidence files retained');
  for (const n of names) { const st = identity(path.join(root, n)); if (st.bytes > (n === 'owner.json' ? 4096 : LIMITS.slot)) throw Error('Evidence slot too large'); }
  function writer(kind) {
    if (!/^[a-z0-9-]{1,50}$/.test(kind)) throw Error('Invalid record kind');
    let file, fd;
    for (let i = 1; i <= LIMITS.slots; i++) {
      file = path.join(root, 'slot-' + String(i).padStart(3, '0') + '.jsonl');
      try { fd = fs.openSync(file, 'wx'); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
    if (fd === undefined) throw Error('New evidence budget exhausted; old records retained');
    const id = identity(file); let bytes = 0, closed = false;
    function append(value) {
      if (closed) throw Error('Evidence writer closed');
      const buffer = Buffer.from(JSON.stringify(value) + '\n');
      if (buffer.length > LIMITS.slot || bytes + buffer.length > LIMITS.slot) throw Error('Evidence slot full');
      const actual = identity(file);
      if (actual.dev !== id.dev || actual.ino !== id.ino || actual.bytes !== bytes) throw Error('Evidence file changed');
      let offset = 0; while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
      bytes += buffer.length;
    }
    append({ schema: 'eva-evolution-record-v1', kind, at: new Date().toISOString(), run: crypto.randomBytes(8).toString('hex') });
    return { append, flush() { if (!closed) fs.fsyncSync(fd); }, close() { if (!closed) { fs.fsyncSync(fd); fs.closeSync(fd); closed = true; } return { file: path.relative(REPO, file), bytes, sha256: hashFile(file) }; }, file };
  }
  return { root, writer, save(kind, value) { const w = writer(kind); try { w.append(value); } catch (e) { w.close(); throw e; } return w.close(); } };
}
function scratch() {
  identity(__dirname, true); const parent = path.join(__dirname, 'scratch'); mkdir(parent);
  let prior = 0;
  function inventory(dir) { for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name), s = fs.lstatSync(file);
    if (s.isSymbolicLink()) throw Error('Scratch link retained');
    if (s.isDirectory()) { identity(file, true); inventory(file); } else prior += identity(file).bytes;
  } }
  inventory(parent); if (prior > LIMITS.disk) throw Error('Existing scratch exceeds budget');
  const root = path.join(parent, 'run-' + crypto.randomBytes(8).toString('hex')); fs.mkdirSync(root); const dirId = identity(root, true);
  const files = new Map(); let used = prior, cleanupRecord = null;
  function create(name) {
    if (!/^[a-z0-9-]+\.(?:rgb|pack|json|png|jpg)$/.test(name) || files.has(name)) throw Error('Invalid experimental filename');
    const file = path.join(root, name), fd = fs.openSync(file, 'wx'); files.set(name, { fd, file, id: identity(file), bytes: 0 }); return name;
  }
  function write(name, buffer) {
    const item = files.get(name); if (!item || item.fd === null || !Buffer.isBuffer(buffer) || used + buffer.length > LIMITS.disk) throw Error('Experimental disk budget exceeded');
    let offset = 0; while (offset < buffer.length) offset += fs.writeSync(item.fd, buffer, offset, buffer.length - offset);
    item.bytes += buffer.length; used += buffer.length;
  }
  function seal(name) { const x = files.get(name); if (x.fd !== null) { fs.fsyncSync(x.fd); fs.closeSync(x.fd); x.fd = null; } return x.file; }
  function remove(names, records) {
    const currentDir = identity(root, true); if (currentDir.dev !== dirId.dev || currentDir.ino !== dirId.ino) throw Error('Scratch directory changed');
    const list = names.map(name => { const x = files.get(name); if (!x || x.fd !== null) throw Error('Close outputs before cleanup');
      const id = identity(x.file); if (id.ino !== x.id.ino || id.dev !== x.id.dev || id.bytes !== x.bytes) throw Error('Scratch file changed');
      return { name, identity: id, sha256: hashFile(x.file) }; });
    if (!cleanupRecord) cleanupRecord = records.writer('scratch-cleanup');
    cleanupRecord.append({ phase: 'plan', root: path.relative(REPO, root), files: list }); cleanupRecord.flush();
    for (const x of list) { const file = path.join(root, x.name); if (JSON.stringify(identity(file)) !== JSON.stringify(x.identity) || hashFile(file) !== x.sha256) throw Error('Cleanup identity changed');
      fs.unlinkSync(file); files.delete(x.name); used -= x.identity.bytes; }
    if (!files.size) { if (fs.readdirSync(root).length) throw Error('Unknown scratch files retained'); fs.rmdirSync(root); }
    cleanupRecord.append({ phase: 'result', root: path.relative(REPO, root), deletedFiles: list.length, bytes: list.reduce((n, x) => n + x.identity.bytes, 0) }); cleanupRecord.flush();
    if (!files.size) { cleanupRecord.close(); cleanupRecord = null; }
  }
  return { root, create, write, seal, remove, finish() { if (cleanupRecord) { cleanupRecord.close(); cleanupRecord = null; } }, names: () => [...files.keys()], path: name => files.get(name).file, bytes: () => used };
}
module.exports = { REPO, LIMITS, sha, hashFile, identity, store, scratch };
