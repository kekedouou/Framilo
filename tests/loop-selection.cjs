'use strict';
// Deterministic interaction/state checks. No real Eagle, input device or media.
const assert = require('assert');
const { createSelection } = require('../plugin/loop-selection.js');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness(existing = false) {
  const calls = [], timers = new Map(); let serial = 0, seekGate = null, applyGate = null;
  const state = { epoch: 1, state: 'paused', playback: { time: 0, frameOrdinal: 0, frameCount: 10,
    transport: { loop: existing ? { valid: true, enabled: true, startOrdinal: 2, endOrdinal: 7, startTime: .2, endTime: .7 } :
      { valid: false, enabled: false, startOrdinal: null, endOrdinal: null } } } };
  const session = {
    async pause() { calls.push(['pause']); state.state = 'paused'; },
    loopFrameAt(time, bounds = {}) {
      const ordinal = Math.max(bounds.minOrdinal ?? 0, Math.min(bounds.maxOrdinal ?? 9, bounds.ordinal ?? Math.floor(time * 10 + .00001)));
      return { ordinal, frameId: ordinal, time: ordinal / 10 };
    },
    async seek(time, options) {
      calls.push(['seek', time, options]); const gate = seekGate; seekGate = null;
      if (gate) return gate.promise;
      state.state = 'paused'; state.playback.time = time; state.playback.frameOrdinal = options.index;
      return { status: 'drawn' };
    },
    async applyLoopRange(range) {
      calls.push(['apply', range]); if (applyGate) return applyGate.promise;
      state.playback.transport.loop = { valid: true, enabled: true, ...range, startTime: range.startOrdinal / 10, endTime: range.endOrdinal / 10 };
      state.state = 'playing'; return { status: 'playing' };
    },
    async clearLoop() { calls.push(['clear']); state.playback.transport.loop = { valid: false, enabled: false, startOrdinal: null, endOrdinal: null }; },
    async setLoopEnabled(enabled) { calls.push(['enabled', enabled]); state.playback.transport.loop.enabled = enabled; return { status: 'applied' }; },
    async play() { calls.push(['play']); state.state = 'playing'; }
  };
  const editor = createSelection({ getSession: () => session, getState: () => state, changed() {},
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } });
  return { editor, state, calls, timers, session, hold() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    gateSeek() { return seekGate = deferred(); }, gateApply() { return applyGate = deferred(); } };
}
async function run() {
  let count = 0;
  async function check(name, fn) { await fn(); count++; console.log('ok ' + name); }
  await check('Tap enters empty draft; endpoints are created on press, can drag and commit together', async () => {
    const h = harness(); h.editor.keyDown(); h.editor.keyUp(); await flush();
    assert(h.editor.snapshot().editing); assert.equal(h.editor.snapshot().start, null); assert.equal(h.editor.snapshot().end, null);
    assert.equal(h.editor.nextPoint(), 'start'); h.editor.move('start', .15, false, 1); h.editor.move('start', .25, true, 2);
    assert.equal(h.editor.snapshot().start.ordinal, 2); assert.equal(h.editor.nextPoint(), 'end');
    h.editor.move('end', .55, false, 3); h.editor.move('end', .75, true, 4);
    assert(!h.state.playback.transport.loop.valid); h.editor.keyDown(); h.editor.keyUp(); await flush();
    assert.deepEqual(h.calls.filter(c => c[0] === 'apply'), [['apply', { startOrdinal: 2, endOrdinal: 7 }]]);
    assert(!h.editor.snapshot().editing); assert.equal(h.state.state, 'playing'); h.editor.destroy();
  });
  await check('Long press retains old endpoints; mouse release does not confirm, R release does', async () => {
    const h = harness(true); h.editor.keyDown(); h.hold(); await flush();
    assert.equal(h.editor.snapshot().start.ordinal, 2); assert.equal(h.editor.snapshot().end.ordinal, 7);
    assert(!h.calls.some(c => c[0] === 'clear')); h.editor.move('start', .35, true, 1); await flush();
    assert(!h.calls.some(c => c[0] === 'apply')); assert.equal(h.state.state, 'paused');
    h.editor.keyUp(); await flush(); assert.equal(h.state.playback.transport.loop.startOrdinal, 3); assert.equal(h.state.state, 'playing'); h.editor.destroy();
  });
  await check('Short clear waits until keyup, retains playback state, and key repeat does not add timers', async () => {
    const h = harness(true); h.state.state = 'playing'; h.editor.keyDown(); h.editor.keyDown(); assert.equal(h.timers.size, 1);
    assert(!h.calls.some(c => c[0] === 'clear')); h.editor.keyUp(); await flush();
    assert.deepEqual(h.calls, [['clear']]); assert.equal(h.state.state, 'playing'); assert(!h.state.playback.transport.loop.valid); h.editor.destroy();
    const pending=harness(true);pending.state.state='seeking';await pending.editor.clearOrChoose();assert.equal(pending.calls[0][0],'seek');assert.equal(pending.calls[1][0],'clear');assert.equal(pending.state.state,'paused');pending.editor.destroy();
  });
  await check('Half selection, Escape, focus loss and mode exit discard drafts without replacing saved ranges', async () => {
    for (const method of ['cancel', 'blur', 'finish']) {
      const h = harness(); await h.editor.begin('toggle'); h.editor.move('start', .2, true); await h.editor[method](); await flush();
      assert(!h.editor.snapshot().editing); assert(!h.calls.some(c => c[0] === 'apply')); assert(!h.state.playback.transport.loop.valid); h.editor.destroy();
    }
    const h = harness(true); const original = { ...h.state.playback.transport.loop }; await h.editor.begin('hold');
    h.editor.move('start', .4, true); h.editor.cancel(); await flush();
    assert.deepEqual(h.state.playback.transport.loop, original); assert.equal(h.state.state, 'paused'); h.editor.destroy();
  });
  await check('Fine step edits only active endpoint, clamps crossing and leaves room at the last frame', async () => {
    const h = harness(); await h.editor.begin('toggle'); h.editor.move('start', 1, true); assert.equal(h.editor.snapshot().start.ordinal, 8);
    h.editor.move('end', 0, true); assert.equal(h.editor.snapshot().end.ordinal, 9);
    h.editor.active('start'); h.editor.step(1); assert.equal(h.editor.snapshot().start.ordinal, 8);
    h.editor.step(-1); assert.equal(h.editor.snapshot().start.ordinal, 7); h.editor.active('end'); h.editor.step(-5);
    assert.equal(h.editor.snapshot().end.ordinal, 8); h.editor.destroy();
  });
  await check('Final pending draw is awaited; cancellation or epoch change cannot later commit or autoplay', async () => {
    for (const kind of ['cancel', 'epoch', 'error']) {
      const h = harness(); await h.editor.begin('hold'); h.editor.move('start', .1, true);
      const gate = h.gateSeek(); h.editor.move('end', .7, true); const finished = h.editor.finish(); await flush();
      assert(!h.calls.some(c => c[0] === 'apply'));
      if (kind === 'cancel') h.editor.cancel();
      if (kind === 'epoch') { h.state.epoch++; h.state.state = 'preparing'; h.editor.update(); }
      gate.resolve({ status: kind === 'error' ? 'error' : 'drawn' }); await finished; await flush();
      assert(!h.calls.some(c => c[0] === 'apply')); assert(!h.editor.snapshot().editing); h.editor.destroy();
    }
  });
  await check('Loop toggle retains endpoints, starts paused valid range, and never plays during editing', async () => {
    const h = harness(); await h.editor.toggleLoop(); assert(h.editor.snapshot().message.includes('先选择')); assert.equal(h.calls.length, 0);
    const x = harness(true); x.state.playback.transport.loop.enabled = false; await x.editor.toggleLoop(); assert.equal(x.state.state, 'playing');
    await x.editor.toggleLoop(); assert(!x.state.playback.transport.loop.enabled); assert.equal(x.state.playback.transport.loop.startOrdinal, 2);
    await x.editor.begin('toggle'); const before = x.calls.length; await x.editor.toggleLoop(); assert.equal(x.calls.length, before); x.editor.destroy(); h.editor.destroy();
  });
  await check('Closing cancels hold timers; a late enable result never starts a different video', async () => {
    const h = harness(true), gate = deferred(); h.session.setLoopEnabled = () => gate.promise; h.state.playback.transport.loop.enabled = false;
    const pending = h.editor.toggleLoop(); h.state.epoch++; h.editor.update(); gate.resolve({ status: 'applied' }); await pending;
    assert(!h.calls.some(c => c[0] === 'play')); assert(!h.editor.snapshot().busy);
    h.editor.keyDown(); h.editor.destroy(); h.hold(); assert(!h.editor.snapshot().editing); assert.equal(h.timers.size, 0);
  });
  await check('Unchanged hold preserves paused old range; zero-duration result remains editable', async () => {
    const h=harness(true); h.editor.keyDown();h.hold();await flush();h.editor.keyUp();await flush();
    assert.equal(h.state.state,'paused');assert(!h.calls.some(c=>c[0]==='apply'));assert.equal(h.state.playback.transport.loop.startOrdinal,2);
    await h.editor.begin('toggle');h.editor.move('end',.8,true);h.session.applyLoopRange=async()=>({status:'ignored',reason:'invalid-loop'});
    await h.editor.finish();assert(h.editor.snapshot().editing);assert(h.editor.snapshot().message.includes('有效时长'));assert(!h.editor.snapshot().busy);h.editor.destroy();
  });
  console.log('E06 selection: ' + count + ' deterministic interaction groups passed; actual Eagle input/layout pending.');
}
run().catch(error => { console.error(error.stack); process.exitCode = 1; });
