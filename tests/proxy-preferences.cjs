'use strict';
// Pure persistence and DOM models; no real preferences, media or Eagle writes.
const assert = require('assert'), path = require('path');
const { createMemoryPreferences, OWNER } = require('../plugin/preferences.cjs');
const { createUI } = require('../plugin/ui.js');
function model() {
  const root = path.resolve('model proxy preference'), file = path.join(root, 'memory-settings.json'), next = path.join(root, 'memory-settings.next.json');
  const files = new Map(), fds = new Map(); let serial = 1, descriptor = 2;
  const make = data => ({ ino: ++serial, time: serial, data: Buffer.from(data) });
  const missing = () => Object.assign(Error('missing'), { code: 'ENOENT' });
  const stat = (value, directory = false) => ({ dev: 1, ino: value?.ino || 1, size: value?.data.length || 0, mtimeMs: value?.time || 1, nlink: 1,
    isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false });
  const io = {
    realpathSync: value => value,
    lstatSync(value) { assert([root, file, next].includes(value)); if (value === root) return stat(null, true); if (!files.has(value)) throw missing(); return stat(files.get(value)); },
    readFileSync(value) { if (!files.has(value)) throw missing(); return Buffer.from(files.get(value).data); },
    openSync(value, flags) { assert.equal(value, next); assert.equal(flags, 'wx'); if (files.has(value)) throw Object.assign(Error('exists'), { code: 'EEXIST' }); const node = make(''); files.set(value, node); const fd = ++descriptor; fds.set(fd, node); return fd; },
    fstatSync: fd => stat(fds.get(fd)),
    writeFileSync(fd, bytes) { const node = fds.get(fd); node.data = Buffer.from(io.partialWrite ? bytes.subarray(0, 8) : bytes); node.time = ++serial; if (io.partialWrite) throw Error('partial write'); },
    fsyncSync() {}, closeSync(fd) { fds.delete(fd); },
    renameSync(a, b) { assert.equal(a, next); assert.equal(b, file); if (io.failRename) throw Error('rename failed'); files.set(b, files.get(a)); files.delete(a); if (io.afterRename) throw Error('interrupted after commit'); },
    unlinkSync(value) { assert.equal(value, next); files.delete(value); }
  };
  return { files, file, next, io, put: (name, value) => files.set(name, make(value)), create: () => createMemoryPreferences({ pluginRoot: root, io, totalRamBytes: 16 * 1024 ** 3 }) };
}
function node(tagName = 'DIV') {
  const handlers = new Map();
  return { tagName, style: {}, attributes: {}, hidden: false, disabled: false, value: '', textContent: '', offsetWidth: 80,
    getContext: () => ({ clearRect() {}, fillRect() {} }),
    addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(callback); },
    removeEventListener(type, callback) { handlers.get(type)?.delete(callback); },
    fire(type) { return Promise.all([...(handlers.get(type) || [])].map(callback => callback({ preventDefault() {} }))); },
    setAttribute(name, value) { this.attributes[name] = value; }, replaceChildren(...children) { this.children = children; },
    getBoundingClientRect: () => ({ left: 100, width: 200 }), focus() {}, closest: () => null,
    setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {}
  };
}
function uiModel(withControl) {
  const nodes = new Map(), win = Object.assign(node(), { setTimeout, clearTimeout });
  const doc = { getElementById(id) { if (id === 'playbackBackend' && !withControl) return null; if (!nodes.has(id)) nodes.set(id, node(id === 'playbackBackend' ? 'SELECT' : 'DIV')); return nodes.get(id); } };
  if (withControl) doc.getElementById('playbackBackend').options = [{ value: 'proxy' }, { value: 'jpeg' }];
  const ui = createUI({ document: doc, window: win, now: () => 123 });
  return { ui, el: id => doc.getElementById(id) };
}
async function main() {
  let count = 0;
  const test = async (name, action) => { await action(); count++; console.log('ok proxy preference: ' + name); };
  await test('missing and legacy fields default to proxy without rewriting persisted data', async () => {
    const fresh = model(), p = fresh.create(); assert.equal(p.backend(), 'proxy'); assert.equal(fresh.files.size, 0);
    for (const old of [{ owner: OWNER, percent: 2.5 }, { owner: OWNER, ramMiB: 1024 },
      { owner: OWNER, ramMiB: 1024, previewQuality: '1080p' }, { owner: OWNER, ramMiB: 1024, previewQuality: '1080p', forwardPredecode: false }]) {
      const h = model(); h.put(h.file, JSON.stringify(old)); const before = h.io.readFileSync(h.file); assert.equal(h.create().backend(), 'proxy'); assert(before.equals(h.io.readFileSync(h.file)));
    }
  });
  await test('save/reopen and old save call shapes retain chosen backend and interaction settings', async () => {
    const h = model(), p = h.create(); p.save(1024, '1080p', false, { wheelFrames: 2, showCacheStrip: false }, 'jpeg');
    assert.equal(p.backend(), 'jpeg'); assert.equal(h.create().backend(), 'jpeg'); assert.equal(JSON.parse(h.io.readFileSync(h.file)).playbackBackend, 'jpeg');
    p.save(2048); assert.equal(h.create().backend(), 'jpeg'); assert.equal(h.create().quality(), '1080p'); assert.equal(h.create().interaction().wheelFrames, 2);
    p.save(2048, '720p', true, p.interaction(), 'proxy'); assert.equal(h.create().backend(), 'proxy'); assert.equal(h.files.size, 1);
  });
  await test('invalid explicit or persisted backend preserves the original file', async () => {
    const h = model(), p = h.create(); p.save(1024); const before = h.io.readFileSync(h.file);
    for (const value of ['native', '', null, false, 1, {}]) { assert.throws(() => p.save(1024, '720p', true, p.interaction(), value), /播放方式/); assert(before.equals(h.io.readFileSync(h.file))); }
    for (const value of ['native', null, false]) { const bytes = JSON.stringify({ owner: OWNER, ramMiB: 1024, playbackBackend: value }); h.put(h.file, bytes); assert.throws(() => h.create(), /播放方式/); assert.equal(h.io.readFileSync(h.file).toString(), bytes); }
  });
  await test('partial write and pre-rename interruption keep committed backend and clean only owned temporary output', async () => {
    for (const fault of ['partialWrite', 'failRename']) {
      const h = model(), p = h.create(); p.save(1024, '720p', true, p.interaction(), 'jpeg'); const before = h.io.readFileSync(h.file);
      h.io[fault] = true; assert.throws(() => p.save(2048, '1080p', true, p.interaction(), 'proxy'));
      assert.equal(p.backend(), 'jpeg'); assert.equal(h.create().backend(), 'jpeg'); assert(before.equals(h.io.readFileSync(h.file))); assert(!h.files.has(h.next));
    }
  });
  await test('post-rename interruption reopens complete new backend; foreign staging is preserved', async () => {
    const h = model(), p = h.create(); p.save(1024, '720p', true, p.interaction(), 'jpeg'); h.io.afterRename = true;
    assert.throws(() => p.save(1024, '720p', true, p.interaction(), 'proxy'), /after commit/); assert.equal(h.create().backend(), 'proxy'); assert(!h.files.has(h.next));
    h.io.afterRename = false; h.put(h.next, 'foreign staging'); assert.throws(() => h.create().save(2048), /exists/);
    assert.equal(h.io.readFileSync(h.next).toString(), 'foreign staging'); assert.equal(h.create().backend(), 'proxy');
  });
  await test('backend UI uses applied state, preserves pending edits and writes only on unified apply', async () => {
    const h = uiModel(true), applied = [];
    h.ui.bindSession({ setPlaybackSettings(value) { applied.push(value); return Promise.resolve({ status: 'applied' }); } });
    const state = { epoch: 1, state: 'paused', duration: 10, memorySettings: { ramMiB: 1024, ramBytes: 1024 ** 3 }, previewQuality: '720p', playbackBackend: 'jpeg', forwardPredecode: true };
    h.ui.update(state); assert.equal(h.el('playbackBackend').value, 'jpeg'); assert.equal(h.el('playbackBackend').disabled, false);
    h.el('playbackBackend').value = 'proxy'; await h.el('playbackBackend').fire('change'); h.ui.update({ ...state, playback: { time: 3 } });
    assert.equal(h.el('playbackBackend').value, 'proxy'); assert.equal(applied.length, 0);
    await h.el('memoryApply').fire('click'); assert.equal(applied.length, 1); assert.equal(applied[0].playbackBackend, 'proxy');
    h.ui.update({ ...state, state: 'preparing' }); assert.equal(h.el('playbackBackend').disabled, false); h.ui.destroy();
  });
  await test('mode can change again during preparation and stale apply cannot overwrite latest UI',async()=>{
    const h=uiModel(true),gates=[];
    const state={epoch:1,state:'preparing',memorySettings:{ramMiB:1024,ramBytes:1024**3},previewQuality:'720p',playbackBackend:'jpeg'};
    h.ui.bindSession({setPlaybackSettings(){return new Promise(resolve=>gates.push(resolve));}});h.ui.update(state);
    h.el('playbackBackend').value='proxy';const first=h.el('memoryApply').fire('click');
    assert.equal(h.el('memoryApply').disabled,false);
    h.el('playbackBackend').value='jpeg';const second=h.el('memoryApply').fire('click');assert.equal(gates.length,2);
    gates[1]({status:'applied'});await second;const message=h.el('memoryStatus').textContent;
    h.el('playbackBackend').value='proxy';gates[0]({status:'error'});await first;
    assert.equal(h.el('memoryStatus').textContent,message);assert.equal(h.el('playbackBackend').value,'proxy');h.ui.destroy();
  });
  await test('older DOM without backend control still applies its existing settings', async () => {
    const h = uiModel(false); let applied;
    h.ui.bindSession({ setPlaybackSettings(value) { applied = value; return Promise.resolve({ status: 'applied' }); } });
    h.ui.update({ epoch: 1, state: 'paused', memorySettings: { ramMiB: 1024, ramBytes: 1024 ** 3 } });
    await h.el('memoryApply').fire('click'); assert(applied); assert(!Object.prototype.hasOwnProperty.call(applied, 'playbackBackend')); h.ui.destroy();
  });
  await test('proxy preparation stays in cache settings and unchanged snapshots do not rewrite its text', async () => {
    const h = uiModel(true); h.ui.bindSession({}); const status = h.el('cacheStatus');
    let value = status.textContent, writes = 0;
    Object.defineProperty(status, 'textContent', { get: () => value, set: next => { writes++; value = next; } });
    const state = { epoch: 1, state: 'paused', duration: 10, playbackBackend: 'proxy', proxyPreparation: { stage: 'preparing', ready: 2, total: 10, progress: .2 } };
    h.ui.update(state); assert.match(value, /整片代理生成 20%/); const before = writes;
    for (let i = 0; i < 20; i++) h.ui.update({ ...state, playback: { time: i / 30 } }); assert.equal(writes, before);
    h.ui.update({ ...state, proxyPreparation: { stage: 'complete', ready: 10, total: 10 } }); assert.match(value, /代理已就绪/);
    h.ui.update({ ...state, proxyPreparation: { stage: 'budget', ready: 5, total: 10 } }); assert.match(value, /代理磁盘额度不足，继续播放原片/);
    h.ui.update({ ...state, proxyPreparation: { stage: 'error', error: { message: 'source unavailable' } } }); assert.match(value, /后台准备失败：source unavailable/);
    h.ui.update({ ...state, playbackBackend: 'jpeg' }); assert(!value.includes('代理')); h.ui.destroy();
  });
  console.log('Proxy preferences: ' + count + ' persistence/interruption/DOM cases; no real files or Eagle.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
