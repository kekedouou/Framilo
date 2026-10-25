'use strict';
// Deterministic native-video/canvas models, sharing the real Player Budget.
// No filesystem/media/browser work; these cases do not measure native seek speed.
const assert = require('assert');
const { Budget } = require('../plugin/player.js');
const { createQuickPreview } = require('../plugin/quick-preview.js');
const MiB = 1024 ** 2;
const flush = async () => { for (let n = 0; n < 30; n++) await Promise.resolve(); };

function fixture(options = {}) {
  let time = 0, serial = 0, currentTime = 0, callbackSerial = 0;
  const timers = new Map(), listeners = new Map(), callbacks = new Map(), seeks = [], changes = [], canvases = [], allocations = [];
  const state = { current: true, failResize: options.failResize }, parent = { children: [], appendChild(node) { this.children.push(node); node.parentElement = this; } };
  function element() {
    return { width: 1, height: 1, hidden: false, style: {}, attributes: {}, draws: [],
      setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; },
      getContext() { return { drawImage: (...args) => this.draws.push(args) }; },
      remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; } };
  }
  const overlay = element(), canvas = element(); canvas.parentElement = parent;
  let overlayWidth = 1, overlayHeight = 1;
  for (const name of ['width', 'height']) Object.defineProperty(overlay, name, {
    get: () => name === 'width' ? overlayWidth : overlayHeight,
    set(value) {
      if (state.failResize === name && value > 1) { state.failResize = null; throw Error('model canvas resize failure'); }
      if (name === 'width') overlayWidth = value; else overlayHeight = value;
      allocations.push({ width: overlayWidth, height: overlayHeight, budget: budget.snapshot() });
    }
  });
  const video = Object.assign(element(), { readyState: options.metadata === false ? 0 : 1, duration: options.nativeDuration, paused: true, loads: 0, pauses: 0,
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    load() { this.loads++; }, pause() { this.pauses++; this.paused = true; } });
  Object.defineProperty(video, 'currentTime', { get: () => currentTime, set(value) { currentTime = value; seeks.push(value); } });
  if (options.frameCallback !== false) {
    video.requestVideoFrameCallback = fn => { const id = ++callbackSerial; callbacks.set(id, fn); return id; };
    video.cancelVideoFrameCallback = id => callbacks.delete(id);
  }
  const document = { createElement(name) {
    if (name === 'video') return options.unsupported ? null : video;
    const item = element(); canvases.push(item); if (options.cachePicture) options.cachePicture(item, budget); return item;
  } };
  canvas.ownerDocument = document;
  const budget = new Budget(options.limit || 128 * MiB);
  const preview = createQuickPreview({ canvas, info: { width: 1920, height: 1080, duration: 600, ...options.info }, sourceUrl: 'file:///own-synthetic-source.mp4',
    budget, evict: options.evict ? () => options.evict(budget) : undefined, isCurrent: () => state.current,
    onChange: value => changes.push(value), env: { document, ...(options.unsupported ? {} : { video }), overlay, now: () => time,
      setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, at: time + ms }); return id; }, clearTimeout: id => timers.delete(id) } });
  const emit = name => { for (const fn of [...(listeners.get(name) || [])]) fn(); };
  const advance = async ms => {
    const end = time + ms; let count = 0;
    while (true) {
      const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; assert(++count < 1000, 'deterministic timer loop must be bounded');
      time = next[1].at; if (timers.delete(next[0])) next[1].fn(); await flush();
    }
    time = end; await flush();
  };
  const complete = (mediaTime = currentTime) => { currentTime = mediaTime; video.readyState = 2; emit('seeked'); };
  const frame = (mediaTime = currentTime) => { const work = [...callbacks.values()]; callbacks.clear(); work.forEach(fn => fn(time, { mediaTime })); };
  async function close() {
    await preview.close(); assert.equal(budget.snapshot().used, 0, 'all preview/cache reservations must release');
    assert.deepEqual([overlay.width, overlay.height], [1, 1], 'closed preview has no uncharged full-size backing store');
  }
  return { preview, budget, state, video, canvas, overlay, parent, seeks, changes, timers, callbacks, canvases, allocations, listeners, advance, emit, complete, frame, close };
}

async function run() {
  const rows = [];
  async function check(name, action) {
    try { await action(); rows.push({ name, status: 'passed' }); }
    catch (error) { rows.push({ name, status: 'failed', error: error.stack || String(error) }); }
  }
  await check('unsupported native element remains optional and consumes no budget', async () => {
    const h = fixture({ unsupported: true }); h.preview.request(4); h.preview.clear(); h.preview.cancel(); await h.close();
    assert.equal(h.preview.snapshot().active, false); assert.equal(h.parent.children.length, 0);
  });
  await check('metadata delay merges requests and only begins the newest seek', async () => {
    const h = fixture({ metadata: false, frameCallback: false });
    try {
      h.preview.request(1); await h.advance(20); h.preview.request(2); await h.advance(20); h.preview.request(3);
      assert.deepEqual(h.seeks, []); h.video.readyState = 1; h.emit('loadedmetadata'); assert.deepEqual(h.seeks, [3]);
      h.complete(3); assert.equal(h.preview.snapshot().time, 3); assert.equal(h.preview.snapshot().active, true);
      assert(h.changes.some(row => row.active && row.approximate)); assert(!('frameId' in h.preview.snapshot()), 'approximate video time never claims a source-frame identity');
    } finally { await h.close(); }
  });
  await check('positive source PTS offsets native seeks even when duration reports only the span', async () => {
    const info = { duration: 20, frames: [{ ptsTicks: '3000000', timeBase: [1, 1000000] }] };
    for (const mode of ['frame', 'fallback', 'seeked', 'already-current']) {
      const h = fixture({ info, nativeDuration: 20, frameCallback: mode !== 'seeked' });
      try {
        if (mode === 'already-current') h.complete(7);
        h.preview.request(4); assert.deepEqual(h.seeks, mode === 'already-current' ? [] : [7]);
        if (mode !== 'already-current') h.complete(7);
        if (mode === 'frame') h.frame(7);
        if (mode === 'fallback') await h.advance(35);
        assert.equal(h.preview.snapshot().active, true, mode); assert.equal(h.preview.snapshot().time, 4, mode);
        assert.equal(h.preview.snapshot().cachedFrames, 1); const before = h.seeks.length;
        h.preview.clear(); h.preview.request(4); assert.equal(h.seeks.length, before, 'cache keys use the relative media position');
        assert.equal(h.preview.snapshot().time, 4); assert.equal(h.preview.snapshot().pending, false);
      } finally { await h.close(); }
    }
  });
  await check('different or unavailable native duration never overrides the positive source PTS origin', async () => {
    const info = { duration: 20, frames: [{ ptsTicks: '3000000', timeBase: [1, 1000000] }] };
    // E36 real VFR pixels disproved duration-based normalization. This model
    // verifies the conversion only; media barcodes must verify real alignment.
    for (const nativeDuration of [23.04, 23.11, 17, NaN, undefined]) {
      const h = fixture({ info, nativeDuration });
      try {
        h.preview.request(4); assert.deepEqual(h.seeks, [7]); h.complete(7); h.frame(7);
        assert.equal(h.preview.snapshot().active, true); assert.equal(h.preview.snapshot().time, 4);
        assert(h.changes.some(value => value.active && value.time === 4));
      } finally { await h.close(); }
    }
  });
  await check('one native seek is in flight and intermediate pointer targets are merged', async () => {
    const h = fixture({ frameCallback: false });
    try {
      h.preview.request(1); await h.advance(20); h.preview.request(2); await h.advance(20); h.preview.request(3);
      assert.deepEqual(h.seeks, [1]); h.complete(1); assert.deepEqual(h.seeks, [1, 3]); h.complete(3);
      assert.equal(h.preview.snapshot().time, 3); assert.equal(h.preview.snapshot().pending, false);
    } finally { await h.close(); }
  });
  await check('a slow result for the still-current target can display without claiming the 250ms goal', async () => {
    const h = fixture({ frameCallback: false });
    try {
      h.preview.request(15); await h.advance(600); h.complete(15);
      assert.equal(h.overlay.draws.length, 1); assert.equal(h.preview.snapshot().active, true); assert.equal(h.preview.snapshot().time, 15);
      assert.equal(h.preview.snapshot().pending, false); assert.equal(h.preview.snapshot().lastAttempt.ageMs, 600);
      assert(h.preview.snapshot().lastAttempt.ageMs > 250, 'usable late preview is still a cold-latency miss');
    }
    finally { await h.close(); }
  });
  await check('an initial wrong-PTS callback keeps the current target and its fallback alive', async () => {
    const h = fixture({ info: { duration: 20, frames: [{ ptsTicks: '3000000', timeBase: [1, 1000000] }] }, nativeDuration: 20 });
    try {
      h.preview.request(10.5); assert.deepEqual(h.seeks, [13.5]); h.complete(13.5); h.frame(3);
      assert.equal(h.preview.snapshot().active, false); assert.equal(h.preview.snapshot().pending, true);
      assert.equal(h.preview.snapshot().lastAttempt.matching, false); assert.equal(h.preview.snapshot().lastAttempt.returned, 0);
      await h.advance(35);
      assert.equal(h.preview.snapshot().active, true); assert.equal(h.preview.snapshot().time, 10.5); assert.equal(h.preview.snapshot().pending, false);
      assert.equal(h.preview.snapshot().lastAttempt.matching, true); assert.equal(h.callbacks.size, 0); assert.equal(h.timers.size, 0);
    } finally { await h.close(); }
  });
  await check('an automatic initial seek race reasserts the target after metadata and waits for its picture', async () => {
    const h = fixture({ metadata: false, info: { duration: 20, frames: [{ ptsTicks: '3000000', timeBase: [1, 1000000] }] }, nativeDuration: 20 });
    try {
      h.preview.request(13.5); assert.deepEqual(h.seeks, []); h.video.readyState = 1; h.emit('loadedmetadata');
      assert.deepEqual(h.seeks, [16.5]); h.complete(3);
      assert.deepEqual(h.seeks, [16.5, 16.5], 'native automatic seek to its first presentation must not consume the intended target');
      assert.equal(h.preview.snapshot().pending, true); assert.equal(h.preview.snapshot().active, false); assert.equal(h.callbacks.size, 0);
      h.complete(16.5); h.frame(16.5); assert.equal(h.preview.snapshot().time, 13.5); assert.equal(h.preview.snapshot().pending, false);
    } finally { await h.close(); }
  });
  await check('a superseded picture older than 250ms cannot display or cover the newer accurate generation', async () => {
    const h = fixture();
    try {
      h.preview.request(1); await h.advance(300); h.preview.request(8); h.complete(1); const oldCallbacks = [...h.callbacks.values()]; h.frame(1);
      assert.equal(h.overlay.draws.length, 0); assert.deepEqual(h.seeks, [1, 8]); assert.equal(h.preview.snapshot().pending, true);
      h.complete(8); h.frame(8); assert.equal(h.preview.snapshot().time, 8); assert.equal(h.overlay.draws.length, 1);
      h.preview.clear(); h.canvas.getContext('2d').drawImage({ kind: 'new-accurate-source-frame' });
      oldCallbacks.forEach(fn => fn(0, { mediaTime: 1 })); await h.advance(40);
      assert.equal(h.overlay.draws.length, 1); assert.equal(h.canvas.draws.length, 1); assert.equal(h.preview.snapshot().active, false);
      assert.equal(h.preview.snapshot().lastAttempt.requested, 8, 'the one diagnostic row is replaced, not an unbounded attempt history');
    } finally { await h.close(); }
  });
  await check('a switched source prevents a late native picture from displaying', async () => {
    const h = fixture({ frameCallback: false });
    try { h.preview.request(15); h.state.current = false; h.complete(15); assert.equal(h.overlay.draws.length, 0); assert.equal(h.preview.snapshot().active, false); }
    finally { await h.close(); }
  });
  await check('clear for an accurate frame cancels late video callbacks and hides the overlay', async () => {
    const h = fixture();
    try {
      h.preview.request(5); h.complete(5); assert.equal(h.callbacks.size, 1); h.preview.clear();
      h.canvas.getContext('2d').drawImage({ kind: 'accurate-source-frame' }); h.frame(5); await h.advance(40);
      assert.equal(h.overlay.draws.length, 0); assert.equal(h.canvas.draws.length, 1);
      assert.equal(h.preview.snapshot().active, false); assert.equal(h.preview.snapshot().pending, false); assert(h.overlay.hidden);
    } finally { await h.close(); }
  });
  await check('cancelled generation cannot cover a newer request or an accurate draw', async () => {
    const h = fixture();
    try {
      h.preview.request(1); h.complete(1); const oldCallbacks = [...h.callbacks.values()]; h.preview.clear(); h.preview.request(9);
      oldCallbacks.forEach(fn => fn(0, { mediaTime: 1 })); assert.equal(h.overlay.draws.length, 0);
      h.complete(9); h.frame(9); assert.equal(h.preview.snapshot().time, 9); h.preview.clear();
      assert.equal(h.preview.snapshot().active, false); assert.equal(h.budget.snapshot().used, h.preview.snapshot().cachedBytes, 'accurate clear retains only the bounded low-resolution history');
    } finally { await h.close(); }
  });
  await check('native unsupported/error disables only the temporary path and clears pending work', async () => {
    const h = fixture();
    try {
      h.preview.request(2); h.emit('error'); const count = h.seeks.length; h.preview.request(5);
      assert.equal(h.seeks.length, count); assert.equal(h.preview.snapshot().disabled, true); assert.equal(h.preview.snapshot().pending, false);
      assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0);
    } finally { await h.close(); }
  });
  await check('two slow native timeouts stop retries without presenting a stale picture', async () => {
    const h = fixture();
    try {
      h.preview.request(2); await h.advance(1500); assert.equal(h.preview.snapshot().pending, false);
      h.preview.request(6); await h.advance(1500); assert.equal(h.preview.snapshot().disabled, true);
      h.complete(6); h.frame(6); assert.equal(h.overlay.draws.length, 0); assert.equal(h.timers.size, 0);
    } finally { await h.close(); }
  });
  await check('visited low-resolution picture is reused immediately without another native seek', async () => {
    const h = fixture({ frameCallback: false });
    try {
      h.preview.request(12); h.complete(12); const before = h.seeks.length; assert.equal(h.preview.snapshot().cachedFrames, 1);
      h.preview.clear(); h.preview.request(12); assert.equal(h.seeks.length, before); assert.equal(h.preview.snapshot().time, 12);
      assert.equal(h.preview.snapshot().active, true); assert.equal(h.preview.snapshot().pending, false);
    } finally { await h.close(); }
  });
  await check('history entry count and bytes remain bounded and charged to the global Budget', async () => {
    const h = fixture({ frameCallback: false, limit: 1024 * MiB });
    try {
      for (let n = 1; n <= 90; n++) { await h.advance(40); h.preview.request(n); h.complete(n); }
      const value = h.preview.snapshot(); assert(value.cachedFrames > 0 && value.cachedFrames <= 64);
      assert(value.cachedBytes <= value.cacheLimit && value.cacheLimit <= 8 * MiB);
      assert.equal(h.budget.snapshot().used, value.cachedBytes + h.overlay.width * h.overlay.height * 4);
    } finally { await h.close(); }
  });
  await check('preview allocation failure stays optional and never overdraws the global budget', async () => {
    const h = fixture({ frameCallback: false, limit: 1024 });
    try { h.preview.request(2); h.complete(2); assert.equal(h.preview.snapshot().active, false); assert.equal(h.budget.snapshot().used, 0); }
    finally { await h.close(); }
  });
  await check('construct clear and close keep a tiny canvas; every regrowth follows the real Budget reservation', async () => {
    const h = fixture({ frameCallback: false, limit: MiB });
    try {
      assert.deepEqual([h.overlay.width, h.overlay.height], [1, 1]); assert.equal(h.budget.snapshot().used, 0);
      h.preview.request(1); h.complete(1); assert.deepEqual([h.overlay.width, h.overlay.height], [480, 270]);
      assert.equal(h.budget.snapshot().kinds['temporary-preview-canvas'], 480 * 270 * 4);
      h.preview.clear(); assert.deepEqual([h.overlay.width, h.overlay.height], [1, 1]); assert.equal(h.budget.snapshot().used, 0);
      h.preview.request(2); h.complete(2); assert.equal(h.preview.snapshot().time, 2); assert.deepEqual([h.overlay.width, h.overlay.height], [480, 270]);
      assert(h.allocations.filter(row => row.width > 1 || row.height > 1).every(row => row.budget.kinds['temporary-preview-canvas'] >= 480 * 270 * 4), 'no backing-store growth can precede its reservation');
    } finally { await h.close(); }
    assert.deepEqual([h.overlay.width, h.overlay.height], [1, 1]);
  });
  await check('a failed first draw returns its reservation and shrinks the canvas before a later request', async () => {
    const h = fixture({ frameCallback: false, limit: MiB }), context = h.overlay.getContext;
    try {
      h.overlay.getContext = () => ({ drawImage() { throw Error('model context lost'); } });
      h.preview.request(1); h.complete(1); assert.equal(h.preview.snapshot().active, false);
      assert.deepEqual([h.overlay.width, h.overlay.height], [1, 1]); assert.equal(h.budget.snapshot().used, 0);
      h.overlay.getContext = context; h.preview.request(2); h.complete(2);
      assert.equal(h.preview.snapshot().active, true); assert.equal(h.budget.snapshot().used, 480 * 270 * 4);
    } finally { await h.close(); }
    assert.deepEqual([h.overlay.width, h.overlay.height], [1, 1]);
  });
  await check('a partial canvas resize failure rolls back both dimensions and budget before retry', async () => {
    const h = fixture({ frameCallback: false, limit: MiB, failResize: 'height' });
    try {
      h.preview.request(1); h.complete(1); assert.equal(h.preview.snapshot().active, false);
      assert.deepEqual([h.overlay.width, h.overlay.height], [1, 1]); assert.equal(h.budget.snapshot().used, 0);
      h.preview.request(2); h.complete(2); assert.equal(h.preview.snapshot().time, 2); assert.deepEqual([h.overlay.width, h.overlay.height], [480, 270]);
      h.preview.clear(); assert.equal(h.budget.snapshot().used, 0); assert.deepEqual([h.overlay.width, h.overlay.height], [1, 1]);
    } finally { await h.close(); }
  });
  await check('a failed history draw shrinks its picture before refund and leaves the active preview intact', async () => {
    let attempts = 0;
    const h = fixture({ frameCallback: false, cachePicture(picture, budget) {
      if (++attempts === 1) picture.getContext = () => ({ drawImage() {
        assert.equal(budget.snapshot().kinds['temporary-preview-cache'], 240 * 135 * 4);
        throw Error('model history canvas context lost');
      } });
    } });
    try {
      h.preview.request(1); h.complete(1); assert.equal(h.preview.snapshot().active, true); assert.equal(h.preview.snapshot().time, 1);
      assert.equal(h.preview.snapshot().cachedFrames, 0); assert.deepEqual([h.canvases[0].width, h.canvases[0].height], [1, 1]);
      assert.equal(h.budget.snapshot().used, 480 * 270 * 4, 'only the successful display remains charged');
      h.preview.request(2); h.complete(2); assert.equal(h.preview.snapshot().cachedFrames, 1);
      assert.equal(h.budget.snapshot().used, 480 * 270 * 4 + 240 * 135 * 4);
    } finally { await h.close(); }
    assert(h.canvases.every(picture => picture.width === 1 && picture.height === 1));
  });
  await check('history eviction and close shrink their canvas while its Budget token is still held', async () => {
    let shrinks = 0;
    const h = fixture({ frameCallback: false, limit: 16 * MiB, cachePicture(picture, budget) {
      let w = 1, height = 1;
      for (const name of ['width', 'height']) Object.defineProperty(picture, name, {
        get: () => name === 'width' ? w : height,
        set(value) {
          const previous = name === 'width' ? w : height;
          if (value === 1 && previous > 1) {
            assert.equal(budget.snapshot().kinds['temporary-preview-cache'], h.preview.snapshot().cachedBytes + 240 * 135 * 4, 'the removed picture remains charged until its dimensions shrink'); shrinks++;
          }
          if (name === 'width') w = value; else height = value;
        }
      });
    } });
    try {
      for (let n = 1; n <= 4; n++) { h.preview.request(n); h.complete(n); }
      assert.equal(h.preview.snapshot().cachedFrames, 2); assert.equal(shrinks, 4, 'two evictions each shrink both dimensions');
      assert.equal(h.budget.snapshot().kinds['temporary-preview-cache'], 2 * 240 * 135 * 4);
    } finally { await h.close(); }
    assert.equal(shrinks, 8, 'close also shrinks both retained histories');
  });
  await check('preview can evict reusable Player memory before charging its canvas', async () => {
    let blocker = null, calls = 0;
    const h = fixture({ frameCallback: false, limit: MiB, evict: budget => { if (!blocker) return false; calls++; budget.release(blocker); blocker = null; return true; } });
    try {
      blocker = h.budget.reserve(700000, 'model-player-cache'); h.preview.request(2); h.complete(2);
      assert.equal(calls, 1); assert.equal(h.preview.snapshot().active, true); assert(h.budget.snapshot().used <= MiB);
    } finally { if (blocker) h.budget.release(blocker); await h.close(); }
  });
  await check('paused native callback fallback is bounded and a mismatching media time is rejected', async () => {
    const h = fixture();
    try {
      h.preview.request(4); h.complete(4); await h.advance(35); assert.equal(h.preview.snapshot().time, 4);
      assert.equal(h.callbacks.size, 0, 'fallback completion cancels the redundant native frame callback');
      h.preview.clear(); await h.advance(100); h.preview.request(10); h.complete(8); h.frame(8);
      assert.equal(h.preview.snapshot().active, false);
    } finally { await h.close(); }
  });
  await check('close removes listeners, native callbacks, timers and both DOM nodes', async () => {
    const h = fixture(); h.preview.request(7); h.complete(7); await h.close();
    assert.equal(h.timers.size, 0); assert.equal(h.callbacks.size, 0); assert.equal(h.parent.children.length, 0);
    assert([...h.listeners.values()].every(set => set.size === 0)); assert.equal(h.video.pauses, 1);
    const before = h.seeks.length; h.preview.request(8); h.frame(7); await h.advance(2000);
    assert.equal(h.seeks.length, before); assert.equal(h.overlay.draws.length, 0); await h.close();
  });
  const failed = rows.filter(row => row.status === 'failed');
  console.log(JSON.stringify({ suite: 'quick-preview', runtime: process.versions.node, passed: rows.length - failed.length, failed: failed.length, rows }, null, 2));
  if (failed.length) throw Error(`${failed.length} quick-preview model(s) failed`);
  return rows;
}
if (require.main === module) run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { run };
