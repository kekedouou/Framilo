'use strict';
// The real Session in a Window-like realm. Browser timer receiver checks matter:
// Node timers and an injected fake clock alone cannot reveal Illegal invocation.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '../plugin');
const sourceCode = fs.readFileSync(path.join(root, 'session.cjs'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(settings = {}) {
  const h = { gets: 0, prepares: 0, disposed: 0, rows: [{ id: 'n', time: 1, text: '原有标注' }], calls: [] };
  let view, serial = 0, now = 0; const timers = new Map();
  function browserSetTimeout(fn, delay) {
    if (this !== undefined && this !== view) throw new TypeError('Illegal invocation');
    h.calls.push('set'); const id = ++serial; timers.set(id, { fn, at: now + delay }); return id;
  }
  function browserClearTimeout(id) {
    if (this !== undefined && this !== view) throw new TypeError('Illegal invocation');
    h.calls.push('clear'); timers.delete(id);
  }
  const context = vm.createContext({ module: { exports: {} }, setTimeout: browserSetTimeout, clearTimeout: browserClearTimeout,
    AbortController, performance: { now: () => now }, console,
    require: name => name === 'path' ? path : require(path.join(root, name)) });
  view = vm.runInContext('globalThis', context); view.window = view;
  // Validate the strict receiver model independently of the implementation.
  assert.throws(() => ({ setTimeout: browserSetTimeout }).setTimeout(() => {}, 0), /Illegal invocation/);
  assert.throws(() => ({ clearTimeout: browserClearTimeout }).clearTimeout(1), /Illegal invocation/);
  vm.runInContext(sourceCode, context, { filename: 'plugin/session.cjs' });
  const selected = { id: 'A', ext: 'mp4', name: 'A', filePath: path.resolve('window-test.mp4') };
  h.session = context.module.exports.createSession({
    eagleAdapter: { captureSelected: async () => selected,
      async readComments() { h.gets++; if (settings.read) await settings.read(h);
        return { libraryPath: path.resolve('window-test.library'), items: h.rows.map(value => ({ ...value })) }; } },
    media: { async prepare() { h.prepares++; return { source: { ...selected, sha256: 'a'.repeat(64) }, duration: 2,
      frames: [{ id: 0, time: 0, file: '0.jpg' }, { id: 1, time: 1, file: '1.jpg' }] }; } },
    cache: { readAsset() {}, async release() {} },
    createPlayer: () => ({ snapshot: () => ({ state: 'paused', frameId: 0, frameOrdinal: 0, time: 0 }),
      async load() {}, async dispose() { h.disposed++; }, async play() {}, async pause() {}, async seek() {}, async step() {} })
  });
  h.load = async () => { const result = await h.session.loadSelected(); await flush(); return result; };
  h.advance = async ms => { const end = now + ms;
    while (true) { const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush(); }
    now = end; await flush(); };
  h.timerCount = () => timers.size; return h;
}
(async () => {
  const h = harness(); h.session.setCommentsVisible(true);
  const ready = await h.load();
  assert.equal(ready.status, 'ready', 'Real Session startup failed under Window timers: ' + JSON.stringify(ready));
  assert.equal(h.prepares, 1); assert.equal(h.session.snapshot().comments.status, 'ready');
  console.log('ok Real Session initial read watchdog and video load use Window timers without Illegal invocation');
  h.rows.push({ id: 'new', time: 1.5, text: '原生新增' }); await h.advance(1000);
  assert.equal(h.gets, 2); assert.equal(h.session.snapshot().comments.items.length, 2);
  h.session.setCommentsVisible(false); assert.equal(h.timerCount(), 0); await h.advance(2000); assert.equal(h.gets, 2);
  h.session.setCommentsVisible(true); await h.advance(0); assert.equal(h.gets, 3);
  console.log('ok Default Window timers also support polling, hidden cancellation, and immediate return');
  await h.session.close(); assert.equal(h.timerCount(), 0); assert.equal(h.disposed, 1);
  console.log('ok Close clears the real Session timer handles without changing the timer receiver');
  let finish; const gate = new Promise(resolve => { finish = resolve; });
  const slow = harness({ read: () => gate }); slow.session.setCommentsVisible(true); await slow.load();
  await slow.session.close(); assert.equal(slow.timerCount(), 0); finish(); await flush();
  assert.equal(slow.session.snapshot().state, 'closed'); assert.equal(slow.timerCount(), 0);
  console.log('ok Closing with an outstanding initial SDK read clears the browser watchdog and ignores the late result');
  console.log('Window Session timer checks: 4; strict receiver/Session models, no actual Eagle, media or library writes.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
