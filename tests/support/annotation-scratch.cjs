'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
function scratch(label) {
  const parent = path.resolve(__dirname, '../annotation-scratch');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, label + '-'));
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  function clean() {
    assert(path.resolve(root).toLowerCase().startsWith(parent.toLowerCase() + path.sep));
    assert.equal(fs.realpathSync(root).toLowerCase(), root.toLowerCase());
    const files = [], dirs = [];
    function walk(dir) { const s = fs.lstatSync(dir); assert(s.isDirectory() && !s.isSymbolicLink());
      for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name), stat = fs.lstatSync(file);
        assert(!stat.isSymbolicLink(), 'Remove deliberate test symlinks before cleanup');
        if (stat.isDirectory()) walk(file); else { assert(stat.isFile()); files.push({ file, dev: String(stat.dev), ino: String(stat.ino), bytes: stat.size, sha256: sha(fs.readFileSync(file)) }); }
      } dirs.push(dir);
    }
    walk(root); assert(files.reduce((n, f) => n + f.bytes, 0) <= 64 * 1024 ** 2);
    // Retained by the calling check's bounded original stdout before deletion.
    console.log('annotation cleanup-plan ' + JSON.stringify(files.map(f => ({ ...f, file: path.relative(parent, f.file) }))));
    for (const f of files) { const s = fs.lstatSync(f.file); assert(!s.isSymbolicLink() && String(s.dev) === f.dev && String(s.ino) === f.ino && s.size === f.bytes && sha(fs.readFileSync(f.file)) === f.sha256); fs.unlinkSync(f.file); }
    for (const dir of dirs) { const s = fs.lstatSync(dir); assert(s.isDirectory() && !s.isSymbolicLink()); fs.rmdirSync(dir); }
    console.log('annotation cleanup-done ' + JSON.stringify({ label, files: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0) }));
  }
  return { root, clean };
}
module.exports = { scratch };
