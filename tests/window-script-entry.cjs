'use strict';
// Real HTML script order + real UI/helper/app; SDK, session/media and DOM are
// in-memory stand-ins. This is a loader regression, never real Eagle playback.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '../plugin');
const scripts = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
assert(scripts.indexOf('loop-selection.js') < scripts.indexOf('ui.js'));
function element(id) {
  const handlers = new Map();
  return { id, style: {}, attributes: {}, hidden: false, disabled: false, offsetWidth: 80,
    addEventListener(type, fn) { handlers.set(type, fn); }, removeEventListener(type) { handlers.delete(type); },
    setAttribute(name, value) { this.attributes[name] = value; }, replaceChildren() {}, focus() {},
    getBoundingClientRect() { return { left: 0, width: 800 }; }, closest() { return null; } };
}
async function check(mode) {
  const nodes = new Map(), hooks = {}, requests = [], captures = [];
  const doc = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element(id)); return nodes.get(id); }, createElement: () => element('new') };
  const view = element('window'); view.document = doc;
  let selected = 'selected-A', snapshot = { epoch: 1, state: 'empty', duration: 0, playback: null };
  const modules = {
    'eagle.cjs': { createEagleAdapter: () => ({ async captureSelected() { captures.push(selected); return { id: selected, name: selected, filePath: path.join(root, selected + '.mp4') }; } }) },
    'preferences.cjs': { createMemoryPreferences: () => ({ snapshot: () => ({ ramBytes: 1024 ** 3 }) }) },
    'diagnostics.cjs': { createDiagnostics: () => ({ public: {}, publish() {} }) },
    'frame-index.cjs': {}, 'task-client.cjs': { createTaskClient() { throw Error('No media/worker may run in a loader-only test.'); } },
    'session.cjs': { createSession(options) { return {
      snapshot: () => snapshot,
      async loadSelected() {
        const source = await options.eagleAdapter.captureSelected();
        snapshot = { epoch: snapshot.epoch + 1, state: 'paused', source, duration: 1,
          playback: { time: 0, frameId: 0, frameOrdinal: 0, frameCount: 10 }, comments: { status: 'ready', items: [], draft: null } };
        options.onChange(snapshot); return { status: 'ready' };
      },
      async close() { return { status: 'closed' }; }
    }; } }
  };
  const context = { document: doc, window: view, performance: { now: () => 0 }, setTimeout, clearTimeout, Promise,
    eagle: Object.fromEntries(['onPluginCreate', 'onPluginRun', 'onLibraryChanged', 'onPluginBeforeExit'].map(name => [name, fn => { hooks[name] = fn; }])),
    require(name) {
      requests.push(name);
      if (name === 'path') return path;
      if (name === 'fs') return { realpathSync: file => file };
      // Host require intentionally cannot find plugin-relative files. This was
      // absent in the CJS-only tests which passed with Node's local require.
      if (!path.isAbsolute(name)) throw Error('Host-relative require forbidden: ' + name);
      assert.equal(path.dirname(name), root); assert(modules[path.basename(name)], name); return modules[path.basename(name)];
    } };
  if (mode !== 'window-without-module') context.module = { exports: {} };
  if (mode !== 'separate-window-commonjs') {
    Object.assign(context, view); context.window = context;
  }
  vm.createContext(context);
  for (const name of scripts) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
  const page = context.window;
  assert.equal(typeof page.EVALoopSelection.createSelection, 'function'); assert.equal(typeof page.EVAUI.createUI, 'function');
  assert.equal(typeof hooks.onPluginCreate, 'function'); assert.equal(typeof hooks.onPluginRun, 'function');
  assert(!requests.some(name => name.startsWith('.')));
  await hooks.onPluginCreate({ path: root });
  assert.equal(doc.getElementById('sourceName').textContent, 'selected-A'); assert(doc.getElementById('notice').hidden);
  assert.equal(doc.getElementById('play').disabled, false);
  selected = 'selected-B'; await hooks.onPluginRun();
  assert.deepEqual(captures, ['selected-A', 'selected-B']); assert.equal(doc.getElementById('sourceName').textContent, 'selected-B');
  assert.equal(doc.getElementById('error').textContent, '');
  console.log('ok HTML window entry: ' + mode + ', host-relative require blocked, create/run reach current selection');
}
async function main() {
  for (const mode of ['window-commonjs', 'separate-window-commonjs', 'window-without-module']) await check(mode);
  assert.equal(typeof require('../plugin/ui.js').createUI, 'function');
  assert.equal(typeof require('../plugin/loop-selection.js').createSelection, 'function');
  console.log('Window script entry: 3 HTML/host models and standalone CommonJS passed; no real Eagle/media/GUI execution.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
