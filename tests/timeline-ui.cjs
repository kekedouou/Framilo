'use strict';
// Actual UI + selection + mapping with a deterministic DOM/Session stand-in.
const assert = require('assert');
const { createUI } = require('../plugin/ui.js');
const { visibleRange } = require('../plugin/timeline-view.js');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const near = (a, b) => assert(Math.abs(a - b) < 1e-7, a + ' != ' + b);
function harness(enabled = false) {
  const h = { width: 800, calls: [], paints: [], measurements: 0, intervals: new Map(), timers: new Map() };
  let serial = 0;
  function element(tag = 'div') {
    const handlers = new Map();
    return { tagName: tag, style: {}, attributes: {}, dataset: {}, children: [], hidden: false, disabled: false, offsetWidth: 80,
      addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
      removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
      fire(type, values = {}) { const event = { target: this, pointerId: 1, button: 0, buttons: 1, clientX: 100,
        preventDefault() { this.prevented = this.defaultPrevented = true; }, ...values }; for (const fn of handlers.get(type) || []) fn(event); return event; },
      setAttribute(name, value) { this.attributes[name] = value; },
      appendChild(child) { child.parentElement = this; this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      getBoundingClientRect() { h.measurements++; return { left: 100, width: h.width }; },
      getContext: () => ({ clearRect() { h.paints.length = 0; }, fillRect(...values) { h.paints.push(values); } }),
      closest(selector) { return selector.split(',').some(s => s === this.tagName || s === 'button[data-comment-id]' && this.dataset.commentId || s === '[role="slider"]' && this.attributes.role === 'slider') ? this : this.parentElement?.closest(selector) || null; },
      focus() { h.doc.activeElement = this; }, setPointerCapture() {}, hasPointerCapture() { return false; }
    };
  }
  const elements = new Map();
  h.doc = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element };
  h.el = id => h.doc.getElementById(id);
  h.win = element();
  Object.assign(h.win, { setTimeout(fn) { const id = ++serial; h.timers.set(id, fn); return id; }, clearTimeout(id) { h.timers.delete(id); },
    setInterval(fn, ms) { const id = ++serial; h.intervals.set(id, { fn, ms }); return id; }, clearInterval(id) { h.intervals.delete(id); } });
  h.hold = () => { for (const [id, fn] of [...h.timers]) { h.timers.delete(id); fn(); } };
  h.state = { epoch: 1, state: 'paused', duration: 10, playback: { time: 3, frameOrdinal: 30, frameCount: 100,
    transport: { rate: 1, loop: { valid: true, enabled, startOrdinal: 20, endOrdinal: 40, startTime: 2, endTime: 4, endBoundary: 4.1 } } },
    comments: { status: 'ready', draft: null, items: [{ id: 'before', time: 1, text: '之前' }, { id: 'inside', time: 3, text: '片段内' }, { id: 'after', time: 8, text: '之后' }] } };
  h.update = () => h.ui.update(h.state);
  h.session = {
    async pause() { h.calls.push(['pause']); h.state.state = 'paused'; h.update(); },
    async play() { h.calls.push(['play']); h.state.state = 'playing'; h.update(); },
    async seek(time, options) { h.calls.push(['seek', time, options]); h.state.state = 'paused';
      const index = options.index ?? Math.max(0, Math.min(99, Math.floor(time * 10 + 1e-8)));
      h.state.playback = { ...h.state.playback, time: index / 10, frameOrdinal: index }; h.update(); return { status: 'drawn' }; },
    loopFrameAt(time, bounds) { const ordinal = Math.max(bounds.minOrdinal ?? 0, Math.min(bounds.maxOrdinal ?? 99, bounds.ordinal ?? Math.floor(time * 10 + 1e-8)));
      return { ordinal, time: ordinal / 10 }; },
    async applyLoopRange(value) { h.calls.push(['apply', value]); h.state.playback.transport.loop = { ...value, valid: true, enabled: true,
      startTime: value.startOrdinal / 10, endTime: value.endOrdinal / 10, endBoundary: (value.endOrdinal + 1) / 10 };
      h.state.playback.time = value.startOrdinal / 10; h.state.state = 'playing'; h.update(); return { status: 'playing' }; },
    async setLoopEnabled(value) { h.calls.push(['loop', value]); h.state.playback.transport.loop.enabled = value; h.update(); return { status: 'applied' }; },
    async clearLoop() { h.calls.push(['clear']); h.state.playback.transport.loop = { valid: false, enabled: false }; h.update(); },
    async seekComment(id) { const item = h.state.comments.items.find(v => v.id === id), loop = h.state.playback.transport.loop;
      if (loop.enabled && (item.time < loop.startTime || item.time >= loop.endBoundary)) loop.enabled = false;
      return this.seek(item.time, { kind: 'annotation', final: true }); },
    step(value) { h.calls.push(['step', value]); },
    cacheCoverageSnapshot: () => ({ sessionEpoch: h.state.epoch, epoch: 1, revision: 1, duration: 10, decodedFrames: 50, totalFrames: 100,
      ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 7, end: 8 }] })
  };
  h.ui = createUI({ document: h.doc, window: h.win });
  h.el('timeline').setAttribute('role', 'slider'); h.ui.bindSession(h.session); h.update();
  h.key = (key, extra = {}) => h.win.fire('keydown', { key, code: 'Key' + key, ...extra });
  h.up = key => h.win.fire('keyup', { key, code: 'Key' + key });
  return h;
}
async function main() {
  let count = 0;
  async function test(name, fn) { await fn(); count++; console.log('ok timeline UI: ' + name); }
  await test('Whole ticks adapt on resize and are not rebuilt or remeasured for each frame', () => {
    const h = harness(), ticks = h.el('timeRuler').children, reads = h.measurements;
    for (let i = 0; i < 100; i++) { h.state.playback.time = i / 10; h.update(); }
    assert.strictEqual(h.el('timeRuler').children, ticks); assert.equal(h.measurements, reads);
    h.width = 200; h.win.fire('resize'); assert(h.el('timeRuler').children.length < ticks.length); h.ui.destroy();
  });
  await test('L/checkbox bind playback and view without a new key; off returns whole and retains dim endpoints', async () => {
    const h = harness(); h.key('L'); await flush();
    const range = visibleRange(10, h.state.playback.transport.loop);
    assert.equal(h.el('timeline').attributes['data-view'], 'loop'); near(Number(h.el('timeline').attributes['aria-valuemin']), range.start);
    assert.equal(h.state.state, 'playing'); assert(!h.el('loopHandleStart').hidden);
    h.el('loopEnabled').fire('change'); await flush();
    assert.equal(h.el('timeline').attributes['data-view'], 'full'); assert.equal(h.state.playback.transport.loop.startOrdinal, 20);
    assert.equal(h.state.state, 'playing'); assert.equal(h.el('timeline').attributes['data-loop-on'], 'false'); h.ui.destroy();
  });
  await test('Short R never flashes whole on keydown; release clears and returns whole', async () => {
    const h = harness(true); h.key('R'); assert.equal(h.el('timeline').attributes['data-view'], 'loop');
    h.up('R'); await flush(); assert.equal(h.el('timeline').attributes['data-view'], 'full');
    assert(h.el('loopHandleStart').hidden); assert(!h.state.playback.transport.loop.enabled); h.ui.destroy();
  });
  await test('Held R shows whole, preserves endpoints and freezes the mapping while dragging; key release confirms', async () => {
    const h = harness(true); h.key('R'); h.hold(); await flush();
    assert.equal(h.el('timeline').attributes['data-view'], 'full'); assert.equal(h.state.state, 'paused');
    const old = h.state.playback.transport.loop;
    h.key('L'); await flush(); assert.strictEqual(h.state.playback.transport.loop, old);
    h.el('timeline').fire('pointerdown', { clientX: 820, target: h.el('loopHandleEnd') });
    h.win.fire('pointermove', { clientX: 740 });
    near(h.calls.filter(c => c[0] === 'seek').at(-1)[1], 8);
    assert.equal(h.el('timeline').attributes['data-view'], 'full'); assert.equal(old.endOrdinal, 40);
    h.up('R'); await flush();
    assert.equal(h.state.playback.transport.loop.endOrdinal, 80); assert.equal(h.state.state, 'playing');
    assert.equal(h.el('timeline').attributes['data-view'], 'loop');
    assert(Number(h.el('timeline').attributes['aria-valuemax']) < 10);
    const applies = h.calls.filter(c => c[0] === 'apply').length;
    h.win.fire('pointerup', { clientX: 850 }); await flush(); assert.equal(h.calls.filter(c => c[0] === 'apply').length, applies); h.ui.destroy();
  });
  await test('Unchanged or returned endpoints confirm and loop; Esc alone restores paused range', async () => {
    for (const mode of ['unchanged', 'escape', 'returned']) {
      const h = harness(true), old = { ...h.state.playback.transport.loop };
      h.key('R'); h.hold(); await flush();
      if (mode !== 'unchanged') {
        h.el('timeline').fire('pointerdown', { clientX: 740, target: h.el('loopHandleEnd') });
        if (mode === 'returned') h.win.fire('pointermove', { clientX: 420 });
        h.win.fire('pointerup', { clientX: mode === 'returned' ? 420 : 740, buttons: 0 });
      }
      if (mode === 'escape') h.key('Escape');
      h.up('R'); await flush();
      assert.deepStrictEqual(h.state.playback.transport.loop, old); assert.equal(h.state.state, mode === 'escape' ? 'paused' : 'playing');
      assert.equal(h.el('timeline').attributes['data-view'], 'loop'); assert.equal(h.calls.some(c => c[0] === 'apply'), mode !== 'escape'); h.ui.destroy();
    }
  });
  await test('Coverage, thumb, hint, markers and pointer share absolute focused time without rebuilding notes', async () => {
    const h = harness(true), range = visibleRange(10, h.state.playback.transport.loop), markers = h.el('commentMarkers').children;
    assert(markers[0].hidden); assert(!markers[1].hidden); assert(markers[2].hidden);
    near(parseFloat(markers[1].style.left), (3 - range.start) / (range.end - range.start) * 100);
    assert.equal(h.paints.length, 1); near(h.paints[0][0], (2 - range.start) / (range.end - range.start) * 800);
    h.el('timeline').fire('pointerdown', { clientX: 500 }); await flush();
    near(h.calls.find(c => c[0] === 'seek')[1], (range.start + range.end) / 2);
    assert.equal(h.el('timeHint').textContent, h.el('currentTime').textContent);
    h.win.fire('pointerup', { clientX: 500, buttons: 0 }); h.key('L'); await flush();
    assert.strictEqual(h.el('commentMarkers').children, markers); assert(markers.every(m => !m.hidden)); h.ui.destroy();
  });
  await test('Epoch replacement cancels an unfinished held edit and timers/listeners cannot act after destroy', async () => {
    const h = harness(true); h.key('R'); h.hold(); await flush();
    h.state = { ...h.state, epoch: 2, duration: 5, playback: { time: 0 }, comments: { status: 'ready', items: [] } }; h.update();
    h.up('R'); await flush(); assert.equal(h.el('timeline').attributes['data-view'], 'full');
    assert(!h.calls.some(c => c[0] === 'apply')); h.ui.destroy();
    assert.equal(h.timers.size, 0); assert.equal(h.intervals.size, 0); const count = h.calls.length;
    h.key('L'); h.win.fire('resize'); assert.equal(h.calls.length, count);
  });
  await test('An outside sidebar annotation disables looping, returns whole, and retains endpoints for L', async () => {
    const h = harness(true), rows = h.el('commentList').children;
    h.el('commentList').fire('click', { target: rows[1].children[0] }); await flush();
    assert(h.state.playback.transport.loop.enabled); assert.equal(h.el('timeline').attributes['data-view'], 'loop');
    h.el('commentList').fire('click', { target: rows[2].children[0] }); await flush();
    assert(!h.state.playback.transport.loop.enabled); assert.equal(h.state.playback.time, 8);
    assert.equal(h.el('timeline').attributes['data-view'], 'full'); assert.equal(h.state.playback.transport.loop.startOrdinal, 20);
    assert.equal(h.state.playback.transport.loop.endOrdinal, 40); h.key('L'); await flush();
    assert(h.state.playback.transport.loop.enabled); assert.equal(h.el('timeline').attributes['data-view'], 'loop'); h.ui.destroy();
  });
  await test('Repeat/IME/modified L and text-entry R are protected; wheel remains source-frame stepping', async () => {
    const h = harness(true);
    for (const value of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { shiftKey: true }, { target: { isContentEditable: true } }]) h.key('L', value);
    h.key('R', { target: { closest: () => ({}) } }); h.hold(); await flush(); assert.equal(h.calls.length, 0);
    h.el('timeline').fire('wheel', { deltaY: -1 }); assert.deepStrictEqual(h.calls, [['step', -1]]); h.ui.destroy();
  });
  console.log('Timeline UI: ' + count + ' actual UI/helper models; no real Eagle/manual/performance claim.');
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { harness, flush };
