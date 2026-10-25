'use strict';
// Exact-thumbnail service with controlled reads/decode/timers and real Budget.
// Fake byte identities are deliberate; this suite does not decode JPEG media.
const assert = require('assert');
const { Budget } = require('../plugin/player.js');
const { createRecordPreviews } = require('../plugin/record-previews.js');
const MiB = 1024 ** 2, thumbBytes = 240 * 135 * 4;
const flush = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(options = {}) {
  const info = { width: 1280, height: 720, frames: Array.from({ length: 140 }, (_, id) => ({ id })) };
  const budget = new Budget(options.limit || 128 * MiB), reads = [], decodes = [], images = [], timers = new Map(), readGates = new Map(), decodeGates = new Map();
  const state = { current: true, busy: false, playing: false }; let clock = 0, serial = 0, activeReads = 0, maximumReads = 0;
  const picture = (ordinal, overrides = {}) => ({ ordinal, width: info.width, height: info.height, bytes: Buffer.from([ordinal, 1, 2, 3]), ...overrides });
  const service = createRecordPreviews({ info, budget, isCurrent: () => state.current, busy: () => state.busy,
    evict: options.evict ? () => options.evict(budget) : undefined,
    read: async (ordinal, settings) => {
      const row = { ordinal, signal: settings.signal, budget: budget.snapshot() }; reads.push(row); activeReads++; maximumReads = Math.max(maximumReads, activeReads);
      try {
        if (options.abortRead) settings.signal.addEventListener('abort', () => readGates.get(ordinal)?.reject(Object.assign(Error('cancelled read'), { code: 'MEDIA_CANCELLED' })), { once: true });
        if (readGates.has(ordinal)) await readGates.get(ordinal).promise;
        if (options.read) return options.read(ordinal, settings, picture);
        return picture(ordinal);
      } finally { activeReads--; }
    }, env: {
      setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, at: clock + ms }); return id; }, clearTimeout: id => timers.delete(id),
      async decode(bytes, width, height) {
        const ordinal = bytes[0]; decodes.push({ ordinal, width, height, budget: budget.snapshot() });
        if (decodeGates.has(ordinal)) await decodeGates.get(ordinal).promise;
        const image = { ordinal, width, height, closed: 0, close() { this.closed++; }, ...(options.image || {}) }; images.push(image); return image;
      }
    } });
  async function advance(ms) {
    const end = clock + ms; let count = 0;
    while (true) {
      const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break; assert(++count < 1000, 'deterministic thumbnail timer must be bounded'); clock = next[1].at;
      if (timers.delete(next[0])) next[1].fn(); await flush();
    }
    clock = end; await flush();
  }
  function canvas() { return { width: 1, height: 1, draws: [], getContext() { return { drawImage: (...args) => this.draws.push(args) }; } }; }
  async function close() {
    const work = service.close(); for (const gate of readGates.values()) gate.resolve(); for (const gate of decodeGates.values()) gate.resolve(); await work;
    assert.equal(budget.snapshot().used, 0); assert.equal(service.snapshot().pending, 0); assert.equal(timers.size, 0);
    assert(images.every(image => image.closed === 1), 'each decoded bitmap is closed exactly once');
  }
  return { service, info, budget, state, reads, decodes, images, timers, advance, canvas, close,
    readGate(n) { const gate = deferred(); readGates.set(n, gate); return gate; }, decodeGate(n) { const gate = deferred(); decodeGates.set(n, gate); return gate; }, maximumReads: () => maximumReads };
}

async function run() {
  const rows = [];
  async function check(name, action) {
    try { await action(); rows.push({ name, status: 'passed' }); }
    catch (error) { rows.push({ name, status: 'failed', error: error.stack || String(error) }); }
  }
  await check('annotation startup prepares exact records before the record panel is painted', async () => {
    const h = fixture();
    try {
      h.service.prioritize({ all: [3, 4, 3], visible: [] }); assert.equal(h.reads.length, 0); await h.advance(240);
      assert.deepEqual(h.reads.map(row => row.ordinal), [3, 4]); assert.equal(h.service.snapshot().frames, 2);
      assert(h.decodes.every(row => row.width === 240 && row.height === 135));
      h.service.prioritize({ all: [3, 4], visible: [] }); await h.advance(240); assert.equal(h.reads.length, 2);
    } finally { await h.close(); }
  });
  await check('playing with no foreground work still allows bounded startup preparation', async () => {
    const h = fixture();
    try { h.state.playing = true; h.service.prioritize({ all: [0, 1], visible: [] }); await h.advance(240); assert.equal(h.reads.length, 2); assert(h.maximumReads() <= 2); }
    finally { await h.close(); }
  });
  await check('foreground busy defers background preparation and resumes after release', async () => {
    const h = fixture();
    try {
      h.state.busy = true; h.service.prioritize({ all: [0], visible: [] }); await h.advance(360); assert.equal(h.reads.length, 0);
      h.state.busy = false; await h.advance(120); assert.deepEqual(h.reads.map(row => row.ordinal), [0]);
    } finally { await h.close(); }
  });
  await check('visible paint cannot start a new read while foreground work is busy', async () => {
    const h = fixture();
    try { h.state.busy = true; assert.equal(await h.service.paint(0, h.canvas()), null); assert.equal(h.reads.length, 0); assert.equal(h.budget.snapshot().used, 0); }
    finally { await h.close(); }
  });
  await check('visible records precede other annotation records and invalid ordinals are ignored', async () => {
    const h = fixture();
    try {
      h.service.prioritize({ all: [0, 1, 8, -1, 999, 1.5], visible: [8, 9, 8] }); await h.advance(480);
      assert.deepEqual(h.reads.map(row => row.ordinal), [8, 9, 0, 1]);
    } finally { await h.close(); }
  });
  await check('two auxiliary reads are permitted but a third never enters read/decode', async () => {
    const h = fixture(); const a = h.readGate(0), b = h.readGate(1);
    try {
      const first = h.service.paint(0, h.canvas()), second = h.service.paint(1, h.canvas());
      assert.equal(await h.service.paint(2, h.canvas()), null); assert.equal(h.service.snapshot().pending, 2); assert.equal(h.maximumReads(), 2);
      a.resolve(); b.resolve(); const leases = await Promise.all([first, second]); assert(leases.every(Boolean)); leases.forEach(lease => lease.release());
      assert.deepEqual(h.reads.map(row => row.ordinal), [0, 1]);
    } finally { await h.close(); }
  });
  await check('global reservation is acquired before reading and allocation failure reads nothing', async () => {
    const h = fixture({ limit: MiB });
    try { assert.equal(await h.service.paint(0, h.canvas()), null); assert.equal(h.reads.length, 0); assert.equal(h.budget.snapshot().used, 0); }
    finally { await h.close(); }
    const enough = fixture();
    try {
      const lease = await enough.service.paint(0, enough.canvas()); assert(lease);
      assert(enough.reads[0].budget.kinds['record-preview-loading'] >= enough.info.width * enough.info.height * 4 + 16 * MiB + thumbBytes);
      assert(enough.decodes[0].budget.kinds['record-preview-loading'] >= enough.info.width * enough.info.height * 4 + thumbBytes + 8);
      lease.release(); assert.equal(enough.budget.snapshot().used, thumbBytes);
    } finally { await enough.close(); }
  });
  await check('bounded thumbnails can evict reusable Player memory before read', async () => {
    let blocker = null, calls = 0;
    const h = fixture({ limit: 32 * MiB, evict: budget => { if (!blocker) return false; calls++; budget.release(blocker); blocker = null; return true; } });
    try {
      blocker = h.budget.reserve(20 * MiB, 'model-player-cache'); const lease = await h.service.paint(0, h.canvas());
      assert(lease); assert.equal(calls, 1); assert(h.reads[0].budget.used <= h.budget.limit); lease.release();
    } finally { if (blocker) h.budget.release(blocker); await h.close(); }
  });
  await check('cache reuse and independent display leases are charged and idempotently released', async () => {
    const h = fixture();
    try {
      const one = h.canvas(), two = h.canvas(), a = await h.service.paint(0, one), b = await h.service.paint(0, two);
      assert(a && b); assert.equal(h.reads.length, 1); assert.equal(h.decodes.length, 1); assert.equal(h.budget.snapshot().used, thumbBytes * 3);
      assert.equal(one.draws[0][0], two.draws[0][0]); a.release(); a.release(); assert.equal(h.budget.snapshot().used, thumbBytes * 2);
      assert.deepEqual([one.width, one.height], [1, 1]); b.release(); assert.equal(h.budget.snapshot().used, thumbBytes);
    } finally { await h.close(); }
  });
  await check('busy state can reuse cached or already-running exact pictures without extra reads', async () => {
    const h = fixture(), gate = h.readGate(0);
    try {
      const a = h.service.paint(0, h.canvas()); h.state.busy = true; const b = h.service.paint(0, h.canvas()); gate.resolve();
      const leases = await Promise.all([a, b]); assert(leases.every(Boolean)); assert.equal(h.reads.length, 1); leases.forEach(lease => lease.release());
      const cached = await h.service.paint(0, h.canvas()); assert(cached); cached.release(); assert.equal(h.reads.length, 1);
      assert.equal(await h.service.paint(1, h.canvas()), null); assert.equal(h.reads.length, 1);
    } finally { await h.close(); }
  });
  await check('wrong ordinal, dimensions, empty bytes and oversized source cannot become records', async () => {
    const variants = [{ ordinal: 1 }, { width: 1279 }, { height: 721 }, { bytes: Buffer.alloc(0) }, { bytes: { byteLength: 8 * MiB + 1 } }];
    for (const value of variants) {
      const h = fixture({ read: (n, settings, picture) => picture(n, value) });
      try { assert.equal(await h.service.paint(0, h.canvas()), null); assert.equal(h.decodes.length, 0); assert.equal(h.service.snapshot().frames, 0); assert.equal(h.budget.snapshot().used, 0); }
      finally { await h.close(); }
    }
  });
  await check('wrong decoded size is rejected and its bitmap is closed', async () => {
    const h = fixture({ image: { width: 239 } });
    try { assert.equal(await h.service.paint(0, h.canvas()), null); assert.equal(h.images[0].closed, 1); assert.equal(h.budget.snapshot().used, 0); }
    finally { await h.close(); }
  });
  await check('a source switch during read prevents decode and paint without leaking a token', async () => {
    const h = fixture(), gate = h.readGate(0);
    try {
      const canvas = h.canvas(), pending = h.service.paint(0, canvas); h.state.current = false; gate.resolve();
      assert.equal(await pending, null); assert.equal(h.decodes.length, 0); assert.equal(canvas.draws.length, 0); assert.equal(h.budget.snapshot().used, 0);
    } finally { await h.close(); }
  });
  await check('a source switch during decode closes the late image without publishing or painting it', async () => {
    const h = fixture(), gate = h.decodeGate(0), canvas = h.canvas(), pending = h.service.paint(0, canvas);
    try {
      await flush(); assert.equal(h.decodes.length, 1); h.state.current = false; gate.resolve();
      assert.equal(await pending, null); assert.equal(h.images[0].closed, 1); assert.equal(canvas.draws.length, 0);
      assert.equal(h.service.snapshot().frames, 0); assert.equal(h.budget.snapshot().used, 0);
    } finally { await h.close(); }
  });
  await check('close aborts a pending reader and retains its reservation until it settles', async () => {
    const h = fixture({ abortRead: true }); h.readGate(0); const pending = h.service.paint(0, h.canvas());
    await flush(); const signal = h.reads[0].signal; assert(h.budget.snapshot().used > 0);
    await h.service.close(); assert(signal.aborted); assert.equal(await pending, null); assert.equal(h.budget.snapshot().used, 0); await h.close();
  });
  await check('close waits for an uncancellable read and never paints its late result', async () => {
    const h = fixture(), gate = h.readGate(0), canvas = h.canvas(); const pending = h.service.paint(0, canvas); let closed = false;
    const work = h.service.close().then(() => { closed = true; }); await flush(); assert.equal(closed, false); assert(h.budget.snapshot().used > 0);
    gate.resolve(); await work; assert.equal(await pending, null); assert.equal(canvas.draws.length, 0); assert.equal(h.budget.snapshot().used, 0); await h.close();
  });
  await check('close waits for decode, closes its returned bitmap, and returns all reservations', async () => {
    const h = fixture(), gate = h.decodeGate(0), canvas = h.canvas(), pending = h.service.paint(0, canvas); await flush();
    assert.equal(h.decodes.length, 1); let closed = false; const work = h.service.close().then(() => { closed = true; }); await flush();
    assert.equal(closed, false); assert(h.budget.snapshot().used > 0); gate.resolve(); await work; assert.equal(await pending, null);
    assert.equal(h.images[0].closed, 1); assert.equal(canvas.draws.length, 0); assert.equal(h.budget.snapshot().used, 0); await h.close();
  });
  await check('cancelled reads do not poison an otherwise valid record retry', async () => {
    let attempts = 0; const h = fixture({ read: (n, settings, picture) => { if (++attempts === 1) throw Object.assign(Error('cancel'), { code: 'MEDIA_CANCELLED' }); return picture(n); } });
    try { assert.equal(await h.service.paint(0, h.canvas()), null); const lease = await h.service.paint(0, h.canvas()); assert(lease); assert.equal(attempts, 2); lease.release(); }
    finally { await h.close(); }
  });
  await check('entry count, byte cap and eviction hold across more records than fit', async () => {
    for (const limit of [64 * MiB, 1024 * MiB]) {
      const h = fixture({ limit });
      try {
        for (let n = 0; n < 102; n++) { const lease = await h.service.paint(n, h.canvas()); assert(lease); lease.release(); }
        const value = h.service.snapshot(); assert(value.frames <= 96); assert(value.bytes <= value.limit); assert.equal(h.budget.snapshot().used, value.bytes);
        assert(h.images.some(image => image.closed === 1)); assert(h.images.filter(image => !image.closed).length === value.frames);
      } finally { await h.close(); }
    }
  });
  await check('two finishing decodes cannot race past the shared resident byte/entry limit', async () => {
    for (const limit of [64 * MiB, 1024 * MiB]) {
      const h = fixture({ limit });
      try {
        const count = Math.min(95, Math.floor(h.service.snapshot().limit / thumbBytes) - 1);
        for (let n = 0; n < count; n++) { const lease = await h.service.paint(n, h.canvas()); assert(lease); lease.release(); }
        const a = h.decodeGate(count), b = h.decodeGate(count + 1), first = h.service.paint(count, h.canvas()), second = h.service.paint(count + 1, h.canvas());
        await flush(); assert.equal(h.service.snapshot().pending, 2); a.resolve(); b.resolve();
        const leases = await Promise.all([first, second]); leases.filter(Boolean).forEach(lease => lease.release());
        const value = h.service.snapshot(); assert(value.bytes <= value.limit, 'concurrent decode completion must enforce the byte cap'); assert(value.frames <= 96, 'concurrent decode completion must enforce the entry cap');
      } finally { await h.close(); }
    }
  });
  await check('close releases display canvas leases as well as cached bitmaps and scheduled work', async () => {
    const h = fixture(), canvas = h.canvas(); const lease = await h.service.paint(0, canvas); assert(lease);
    h.service.prioritize({ all: [1], visible: [] }); await h.service.close(); assert.deepEqual([canvas.width, canvas.height], [1, 1]);
    assert.equal(h.budget.snapshot().used, 0); assert.equal(h.images[0].closed, 1); lease.release(); await h.close();
    assert.equal(await h.service.paint(0, h.canvas()), null); h.service.prioritize({ all: [2], visible: [] }); await h.advance(1000); assert.equal(h.reads.length, 1);
  });
  await check('a failed display draw shrinks the unleased canvas before refunding its bytes', async () => {
    const h = fixture(), canvas = h.canvas(); canvas.getContext = () => ({ drawImage() { throw Error('model context lost'); } });
    try {
      assert.equal(await h.service.paint(0, canvas), null); assert.deepEqual([canvas.width, canvas.height], [1, 1]);
      assert.equal(h.budget.snapshot().used, h.service.snapshot().bytes, 'failed canvas has no display lease and no uncharged backing store');
    } finally { await h.close(); }
  });
  const failed = rows.filter(row => row.status === 'failed');
  console.log(JSON.stringify({ suite: 'record-previews', runtime: process.versions.node, passed: rows.length - failed.length, failed: failed.length, rows }, null, 2));
  if (failed.length) throw Error(`${failed.length} record-previews model(s) failed`);
  return rows;
}
if (require.main === module) run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
module.exports = { run };
