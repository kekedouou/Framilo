'use strict';
const assert = require('assert');
const { steppedRate, validRate } = require('../plugin/player.js');
const { harness, flush } = require('./timeline-ui.cjs');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function speedHarness() {
  const h = harness(true);
  h.session.setPlaybackRate = async rate => { h.calls.push(['rate', rate]); h.state.playback.transport.rate = rate; h.update(); return { status: 'applied' }; };
  return h;
}
async function main() {
  let count = 0;
  async function test(name, fn) { await fn(); count++; console.log('ok playback shortcuts: ' + name); }
  await test('Step arithmetic is exact, accepts all four increments, and clamps without zero/reverse speeds', () => {
    for (const step of [.1, .2, .25, .5]) { assert.equal(steppedRate(1, 1, step), 1 + step); assert.equal(steppedRate(.1, -1, step), .1); assert.equal(steppedRate(4, 1, step), 4); }
    let rate = .1; for (let n = 0; n < 10; n++) rate = steppedRate(rate, 1, .1); assert.equal(rate, 1.1);
    assert.equal(steppedRate(.1, 1, .25), .35); assert.equal(steppedRate(.35, -1, .25), .1);
    for (const rate of [0, .09, 4.01, NaN, Infinity, '1']) assert(!validRate(rate));
    assert.throws(() => steppedRate(1, 1, .3));
  });
  await test('Z/X/C operate, intermediate values stay visible, and a boundary/no-op does not restart playback', async () => {
    const h = speedHarness(), loop = { ...h.state.playback.transport.loop };
    h.key('V'); await flush(); assert.equal(h.calls.length, 0, 'V is no longer a speed shortcut');
    h.state.state = 'playing'; h.update(); h.key('C'); await flush(); assert.equal(h.state.playback.transport.rate, 1.1);
    assert.equal(h.el('playbackRate').value, '1.1'); assert.equal(h.el('customPlaybackRate').textContent, '1.1×'); assert(!h.el('customPlaybackRate').hidden);
    h.key('X'); await flush(); assert.equal(h.state.playback.transport.rate, 1); assert(h.el('customPlaybackRate').hidden);
    h.state.playback.transport.rate = 4; h.update(); const before = h.calls.length; h.key('C'); await flush(); assert.equal(h.calls.length, before);
    h.key('Z'); await flush(); assert.equal(h.state.playback.transport.rate, 1); h.key('Z'); await flush();
    assert.deepStrictEqual(h.calls.filter(c => c[0] === 'rate'), [['rate', 1.1], ['rate', 1], ['rate', 1]]);
    assert.deepStrictEqual(h.state.playback.transport.loop, loop); assert.equal(h.state.state, 'playing'); h.ui.destroy();
  });
  await test('Rapid distinct keys accumulate to the latest target without parallel rate operations', async () => {
    const h = speedHarness(), gate = deferred(); let first = true, active = 0, max = 0;
    h.session.setPlaybackRate = async rate => { active++; max = Math.max(max, active); h.calls.push(['rate', rate]); if (first) { first = false; await gate.promise; }
      h.state.playback.transport.rate = rate; h.update(); active--; return { status: 'applied' }; };
    h.key('C'); h.key('C'); h.key('C'); assert.deepStrictEqual(h.calls, [['rate', 1.1]]);
    gate.resolve(); await flush(); assert.equal(h.state.playback.transport.rate, 1.3); assert.equal(max, 1);
    assert.deepStrictEqual(h.calls, [['rate', 1.1], ['rate', 1.3]]); h.ui.destroy();
  });
  await test('A pending rate is invalidated by seek supersession, source replacement or destroy', async () => {
    for (const mode of ['superseded', 'source', 'destroy']) {
      const h = speedHarness(), gate = deferred(); h.session.setPlaybackRate = rate => { h.calls.push(['rate', rate]); return gate.promise; };
      h.key('C'); h.key('C'); if (mode === 'source') { h.state = { ...h.state, epoch: 2, playback: { ...h.state.playback, transport: { rate: 1 } } }; h.update(); }
      if (mode === 'destroy') h.ui.destroy(); gate.resolve({ status: 'superseded' }); await flush();
      assert.deepStrictEqual(h.calls, [['rate', 1.1]]); if (mode !== 'destroy') h.ui.destroy();
    }
  });
  await test('Rate step stays pending until Apply; saved step changes keys without inventing a new video', async () => {
    const h = speedHarness(); h.state.memorySettings = { ramMiB: 1024, ramBytes: 1024 ** 3 };
    h.state.interactionSettings = { wheelFrames: 1, showCacheStrip: true, rateStep: .1 }; h.update();
    h.el('rateStep').value = '.5'; h.update(); assert.equal(h.el('rateStep').value, '.5');
    h.key('C'); await flush(); assert.equal(h.state.playback.transport.rate, 1.1);
    h.session.setPlaybackSettings = async value => { h.calls.push(['settings', value]); h.state.interactionSettings = { wheelFrames: value.wheelFrames, showCacheStrip: value.showCacheStrip, rateStep: value.rateStep }; h.state.state = 'paused'; h.update(); return { status: 'applied' }; };
    h.el('memoryApply').fire('click'); await flush(); assert.equal(h.calls.find(c => c[0] === 'settings')[1].rateStep, .5);
    h.key('C'); await flush(); assert.equal(h.state.playback.transport.rate, 1.6); h.ui.destroy();
  });
  await test('N uses the normal proposal once; pending N blocks export and never saves text by itself', async () => {
    const h = speedHarness(), gate = deferred(); h.session.beginComment = () => { h.calls.push(['note']); return gate.promise; };
    h.session.beginExport = () => h.calls.push(['unexpected-export']);
    h.key('N'); h.key('N'); h.key('S'); assert.deepStrictEqual(h.calls, [['note']]);
    gate.resolve(); await flush(); assert.deepStrictEqual(h.calls, [['note']]); h.ui.destroy();
  });
  await test('S/E share destination/valid-range gates with buttons and suppress duplicate or unknown exports', async () => {
    const h = speedHarness(), gate = deferred(); h.el('exportDestination').value = 'local'; h.el('exportFolder').value = '';
    h.session.beginExport = (kind, destination) => { h.calls.push(['export', kind, destination]); return gate.promise; };
    h.key('S'); h.key('E'); h.el('exportFrame').fire('click'); assert.deepStrictEqual(h.calls, [['export', 'frame', { destination: 'local', folderId: '' }]]);
    h.state.exportState = { status: 'unknown' }; h.update(); gate.resolve(); await flush(); h.key('S'); assert.equal(h.calls.length, 1);
    h.state.exportState = {}; h.state.exportFolders = { status: 'ready', items: [{ id: 'chosen', label: '测试文件夹' }] }; h.update();
    h.el('exportDestination').value = 'eagle'; h.el('exportFolder').value = 'chosen'; h.el('exportFolder').fire('change');
    h.session.beginExport = (kind, destination) => { h.calls.push(['export', kind, destination]); };
    h.key('E'); await flush(); assert.deepStrictEqual(h.calls[1], ['export', 'clip', { destination: 'eagle', folderId: 'chosen' }]);
    h.state.playback.transport.loop.valid = false; h.update(); h.key('E'); assert.equal(h.calls.length, 2); h.ui.destroy();
  });
  await test('All new keys ignore text/IME/modifiers/autorepeat and blocked lifecycle states', async () => {
    const h = speedHarness(); h.session.beginComment = () => h.calls.push(['note']); h.session.beginExport = () => h.calls.push(['export']);
    for (const key of ['Z', 'X', 'C', 'N', 'S', 'E']) for (const values of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { metaKey: true },
      { target: { isContentEditable: true } }, { target: { closest: () => ({ type: 'text' }) } }]) h.key(key, values);
    assert.equal(h.calls.length, 0);
    for (const state of ['preparing', 'seeking', 'closed']) { h.state = { ...h.state, state }; h.update(); for (const key of ['Z', 'X', 'C', 'N', 'S', 'E']) h.key(key); }
    assert.equal(h.calls.length, 0); h.ui.destroy();
  });
  console.log('Playback shortcuts: ' + count + ' pure/actual UI model groups; no real Eagle or file/library writes.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
