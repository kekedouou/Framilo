'use strict';
// Real inventory code, existing in-memory Windows filesystem; no media or disk writes.
const assert = require('assert'), path = require('path').win32;
const { harness, prepared, SOURCE_SHA } = require('./t1-cache.cjs');
async function fixture(count) {
  let filesystem; const h = harness({}, memory => { filesystem = memory.api; });
  const original = await prepared(h); h.cache.release(original);
  const base = JSON.parse(h.nodes.get(path.join(original.cacheDir, 'manifest.json')).data);
  const owner = JSON.parse(h.nodes.get(path.join(original.cacheDir, 'owner.json')).data), entries = [], markers = [];
  for (let n = 1; n <= count; n++) {
    const sourceSha256 = n.toString(16).padStart(64, '0'), token = n.toString(16).padStart(24, '0');
    const directory = original.cacheDir.replace(SOURCE_SHA, sourceSha256);
    h.make(directory, 'dir'); h.make(path.join(directory, 'owner.json'), 'file', JSON.stringify(owner));
    h.make(path.join(directory, 'manifest.json'), 'file', JSON.stringify({ ...base, source: { ...base.source, sha256: sourceSha256 } }));
    h.make(path.join(directory, '000000.jpg'), 'file', 'frame-data');
    const file = path.join(h.root, 'lease-' + token + '.json');
    h.make(file, 'file', JSON.stringify({ ...owner, kind: 'lease', token, pid: 4242,
      cacheDir: n === 2 ? directory.toUpperCase() : directory, sourceSha256,
      processIdentity: { pid: 4242, startTicks: '638958000000000000', image: 'D:\\fixtures\\Eagle.exe' }, children: [] }));
    entries.push({ directory, sourceSha256 }); markers.push(file);
  }
  return { h, filesystem, original, entries, markers };
}
function indexedFilesystem(h, filesystem) {
  const children = new Map();
  function add(file) { const key = h.normal(file), dir = path.dirname(key); if (key === dir) return;
    if (!children.has(dir)) children.set(dir, new Set()); children.get(dir).add(path.basename(key)); }
  function remove(file) { const key = h.normal(file), dir = path.dirname(key); children.get(dir)?.delete(path.basename(key)); children.delete(key); }
  for (const file of h.nodes.keys()) add(file);
  filesystem.readdirSync = dir => { const key = h.normal(dir); assert.equal(h.nodes.get(key).kind, 'dir'); return [...children.get(key) || []]; };
  for (const method of ['openSync', 'mkdirSync', 'unlinkSync', 'rmdirSync', 'renameSync']) {
    const original = filesystem[method];
    filesystem[method] = (...args) => {
      const result = original(...args);
      if (method === 'openSync' || method === 'mkdirSync') add(args[0]);
      else if (method === 'renameSync') { remove(args[0]); add(args[1]); }
      else remove(args[0]);
      return result;
    };
  }
}
async function main() {
  let count = 0;
  async function test(name, action) { await action(); count++; console.log('ok inventory index: ' + name); }
  await test('mixed cache directories and multiple leases preserve exact ownership, case equivalence and actual bytes', async () => {
    const { h, original, entries, markers } = await fixture(3);
    const extra = JSON.parse(h.nodes.get(markers[0]).data); extra.token = 'f'.repeat(24);
    h.make(path.join(h.root, 'lease-' + extra.token + '.json'), 'file', JSON.stringify(extra));
    const result = h.cache.inventory(), bySha = new Map(result.caches.map(value => [value.sourceSha256, value]));
    assert.equal(result.caches.length, 4); assert.equal(result.leases.length, 4);
    assert.equal(bySha.get(SOURCE_SHA).directory, original.cacheDir); assert.equal(bySha.get(SOURCE_SHA).protected, false);
    assert.equal(bySha.get(entries[0].sourceSha256).leaseCount, 2);
    for (const item of entries) assert.equal(bySha.get(item.sourceSha256).protected, true);
    const bytes = [...h.nodes].filter(([file, node]) => node.kind === 'file' && file.startsWith(h.root + '\\')).reduce((sum, [, node]) => sum + node.data.length, 0);
    assert.equal(result.usedBytes, bytes); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.caches[0]));
    assert.equal(h.descriptors.size, 0);
  });
  await test('a lease cannot borrow the neighbor directory or a nonexistent directory by sharing a path prefix', async () => {
    for (const kind of ['wrong-source', 'neighbor', 'missing']) {
      const { h, entries, markers } = await fixture(2), marker = h.nodes.get(markers[0]), value = JSON.parse(marker.data);
      if (kind === 'wrong-source') value.sourceSha256 = 'b'.repeat(64);
      else value.cacheDir = kind === 'neighbor' ? entries[1].directory : entries[0].directory.replace(entries[0].sourceSha256, 'f'.repeat(64));
      marker.data = Buffer.from(JSON.stringify(value)); const deleted = h.deleted.length;
      assert.throws(() => h.cache.inventory(), /占用记录与完整缓存不匹配/); assert.equal(h.deleted.length, deleted);
    }
  });
  await test('unknown leaf files are refused rather than lost by a per-directory index', async () => {
    const { h, entries } = await fixture(2); h.cache.inventory();
    const file = path.join(entries[1].directory, 'unknown.tmp'); h.make(file, 'file', 'preserve');
    const deleted = h.deleted.length; assert.throws(() => h.cache.inventory(), /未登记文件/);
    assert(h.nodes.has(file)); assert.equal(h.deleted.length, deleted);
  });
  await test('a leaf added during final directory enumeration still invalidates the snapshot', async () => {
    const { h, filesystem, entries } = await fixture(2), directory = entries[0].directory, read = filesystem.readdirSync;
    let calls = 0, fired = false;
    filesystem.readdirSync = dir => {
      if (h.normal(dir) === directory && ++calls === 2) { fired = true; h.make(path.join(directory, 'late.tmp'), 'file', 'preserve'); }
      return read(dir);
    };
    const deleted = h.deleted.length; assert.throws(() => h.cache.inventory(), /盘点期间缓存目录内容已变化/);
    assert(fired); assert.equal(h.deleted.length, deleted); assert.equal(h.descriptors.size, 0);
  });
  await test('final leaf identity/length checks remain active after associations are indexed', async () => {
    for (const mutate of ['identity', 'length']) {
      const { h, filesystem, entries } = await fixture(1), file = path.join(entries[0].directory, '000000.jpg'), stat = filesystem.lstatSync;
      let calls = 0, fired = false;
      filesystem.lstatSync = (current, options) => {
        if (h.normal(current) === file && ++calls === 3) {
          fired = true; const node = h.nodes.get(file);
          if (mutate === 'identity') node.ino++; else node.data = Buffer.concat([node.data, Buffer.from('changed')]);
        }
        return stat(current, options);
      };
      const deleted = h.deleted.length; assert.throws(() => h.cache.inventory(), /盘点期间缓存文件已变化/);
      assert(fired); assert.equal(h.deleted.length, deleted); assert.equal(h.descriptors.size, 0);
    }
  });
  await test('a root entry added during final enumeration is still refused', async () => {
    const { h, filesystem } = await fixture(1), read = filesystem.readdirSync; let calls = 0, fired = false;
    filesystem.readdirSync = dir => {
      if (h.normal(dir) === h.root && ++calls === 2) { fired = true; h.make(path.join(h.root, 'late-root.tmp'), 'file', 'preserve'); }
      return read(dir);
    };
    assert.throws(() => h.cache.inventory(), /盘点期间缓存根已变化/); assert(fired); assert.equal(h.descriptors.size, 0);
  });
  await test('path association work grows linearly rather than rescanning all stamps and caches', async () => {
    async function work(size) {
      const { h, filesystem } = await fixture(size), children = new Map();
      for (const file of h.nodes.keys()) {
        const dir = path.dirname(file); if (dir === file) continue;
        if (!children.has(dir)) children.set(dir, []); children.get(dir).push(path.basename(file));
      }
      // Keep filesystem-model directory lookup itself O(1), as an OS directory
      // enumeration would not scan every unrelated model node in JavaScript.
      filesystem.readdirSync = dir => [...children.get(h.normal(dir)) || []]; h.cache.inventory();
      const resolve = path.resolve; let calls = 0;
      path.resolve = function(...args) { calls++; return resolve.apply(path, args); };
      try { const result = h.cache.inventory(); assert.equal(result.caches.length, size + 1); assert.equal(result.leases.length, size); }
      finally { path.resolve = resolve; }
      return calls;
    }
    const small = await work(20), large = await work(80);
    assert(large > small * 3); assert(large < small * 5, '4x fixture size should remain about 4x path work: ' + small + ' -> ' + large);
    console.log('inventory path operations: 20 leases=' + small + ', 80 leases=' + large);
  });
  await test('100/300/900-segment model exposes remaining per-transaction scan costs without media', async () => {
    const evidence = [];
    for (const size of [100, 300, 900]) {
      const { h, filesystem, entries, markers } = await fixture(size);
      // The shared model's existsSync uses a case-sensitive Map; use canonical
      // spelling for write transactions, while the earlier inventory test keeps
      // the uppercase lease to exercise Windows-equivalent association keys.
      const canonical = new Map(entries.map(item => [item.sourceSha256, item.directory]));
      for (const file of markers) {
        const node = h.nodes.get(file), value = JSON.parse(node.data); value.cacheDir = canonical.get(value.sourceSha256); node.data = Buffer.from(JSON.stringify(value));
      }
      indexedFilesystem(h, filesystem); h.cache.inventory();
      let current = null;
      for (const method of ['lstatSync', 'fstatSync', 'realpathSync', 'readdirSync', 'openSync', 'readSync', 'readFileSync']) {
        const original = filesystem[method]; filesystem[method] = (...args) => {
          if (current) current[method] = (current[method] || 0) + 1;
          return original(...args);
        };
      }
      async function phase(stage, action) {
        const row = current = { stage, pathResolves: 0 }, resolve = path.resolve;
        const start = process.hrtime.bigint(), reads = h.state.readOpens.length, memo = h.api._test.manifestMemoSnapshot(h.cache);
        path.resolve = function(...args) { row.pathResolves++; return resolve.apply(path, args); };
        let result;
        try { result = await action(); }
        finally { path.resolve = resolve; current = null; }
        row.modelMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 10) / 10;
        const opened = h.state.readOpens.slice(reads);
        row.ownerReads = opened.filter(file => file.endsWith('owner.json')).length;
        row.leaseReads = opened.filter(file => /\\lease-[0-9a-f]{24}\.json$/.test(file)).length;
        row.manifestReads = h.api._test.manifestMemoSnapshot(h.cache).reads - memo.reads;
        row.manifestValidations = h.api._test.manifestMemoSnapshot(h.cache).validations - memo.validations;
        return { row, result };
      }
      const inventory = await phase('inventory', () => h.cache.inventory());
      inventory.row.frozenResultBytes = Buffer.byteLength(JSON.stringify(inventory.result));
      const start = await phase('begin', () => h.cache.begin({ sourceSha256: entries[0].sourceSha256 }));
      const tx = start.result;
      const read = await phase('readComplete', () => tx.readComplete());
      const finish = await phase('finish-touch', () => tx.finish(read.result, { ...read.result.source }));
      tx.close(); h.cache.release(finish.result); assert.equal(h.descriptors.size, 0);
      evidence.push({ segments: size, stages: [inventory.row, start.row, read.row, finish.row] });
    }
    for (const stage of ['inventory', 'begin', 'finish-touch']) {
      const small = evidence[0].stages.find(row => row.stage === stage), large = evidence[2].stages.find(row => row.stage === stage);
      assert(large.pathResolves < small.pathResolves * 10, stage + ' must not have quadratic path association work');
    }
    console.log('cache scan model evidence (OS/media latency excluded): ' + JSON.stringify(evidence));
  });
  console.log('Inventory index: ' + count + ' in-memory ownership/race/scale cases; no real media or Eagle.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
