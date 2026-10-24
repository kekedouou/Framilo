'use strict';
const assert = require('assert');
const { createSegmentAudio } = require('../plugin/segment-audio.cjs');
const { createSegmentReader } = require('../plugin/segment-reader.cjs');
const { Player, Budget } = require('../plugin/player.js');
const index = require('../plugin/frame-index.cjs');
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function manifest() {
  const frames = index.buildIndex(Array.from({ length: 1080 }, (_, id) => ({ id, ptsTicks: String(id), file: `frame-${id}.jpg`, bytes: 64 })),
    { timeBase: [1, 24], lastFrameEndTicks: '1080' }).frames;
  return { streaming: 'segments-v1', source: { sha256: 'a'.repeat(64) }, width: 8, height: 8, duration: 45, frames,
    segments: Array.from({ length: 45 }, (_, i) => ({ start: i, end: i + 1, first: i * 24, last: i * 24 + 23 })),
    audio: { segmented: true, file: 'streamed-audio.wav', bytes: 1, start: 0, duration: 45, channels: 1, sampleRate: 48000 } };
}
function audioHarness(info, read) {
  const nodes = [], budget = new Budget(32 * 1024 ** 2), errors = [];
  const context = { currentTime: 0, sampleRate: 48000, state: 'running', destination: {}, resume: async () => {}, close: async () => { context.state = 'closed'; },
    decodeAudioData: async () => ({ length: 48000, numberOfChannels: 1, duration: 1, sampleRate: 48000 }),
    createBufferSource() { const node = { playbackRate: {}, connect() {}, disconnect() {}, stop() { node.stopped = true; },
      start(when, offset, duration) { Object.assign(node, { when, offset, duration }); } }; nodes.push(node); return node; } };
  const audio = createSegmentAudio({ info, context, budget, read: read || (async i => ({ bytes: Buffer.alloc(16), start: i, duration: 1 })), onError: e => errors.push(e) });
  return { audio, context, budget, nodes, errors };
}
async function main() {
  const info = manifest();
  {
    const h = audioHarness(info); await h.audio.prime(30.5, null); h.audio.start(30.5, .02, 1, null);
    for (let t = .05; t < 3; t += .05) {
      h.context.currentTime = t;
      for (const node of h.nodes) if (!node.ended && node.when + node.duration <= t) { node.ended = true; if (node.onended) node.onended(); }
      assert(h.audio.update(), 'preloaded audio should not starve'); await flush();
    }
    assert(h.nodes.length >= 4); assert.equal(h.nodes[0].offset, .5);
    for (let i = 1; i < h.nodes.length; i++) assert(Math.abs(h.nodes[i].when - (h.nodes[i - 1].when + h.nodes[i - 1].duration)) < 1e-9);
    h.audio.stop(); assert(h.nodes.every(n => n.ended || n.stopped)); await h.audio.close(); assert.equal(h.budget.used, 0); assert.deepEqual(h.errors, []);
  }
  {
    const h = audioHarness(info), loop = { start: .25, end: .5 };
    await h.audio.prime(.25, loop); h.audio.start(.25, .02, 2, loop);
    assert(h.nodes.length >= 3); for (const node of h.nodes) { assert.equal(node.offset, .25); assert.equal(node.duration, .25); }
    await h.audio.close(); assert.equal(h.budget.used, 0);
  }
  {
    let resolve; const h = audioHarness(info, () => new Promise(r => { resolve = r; }));
    const loading = h.audio.prime(0, null).catch(() => {}); await flush(); const closing = h.audio.close();
    assert(h.budget.used > 0); resolve({ bytes: Buffer.alloc(16), start: 0 }); await Promise.all([loading, closing]); assert.equal(h.budget.used, 0);
  }
  {
    let acquired = 0, released = 0;
    const reader = createSegmentReader({ info, acquire: async ordinal => { acquired++; return { ordinal, frames: info.frames.slice(ordinal * 24, ordinal * 24 + 24), audio: null }; },
      release: async () => { released++; }, readAsset: async () => Buffer.alloc(8) });
    await Promise.all([reader.frame('frame-0.jpg'), reader.frame('frame-1.jpg')]); assert.equal(acquired, 1);
    for (const frame of [24, 48, 72, 96, 120]) await reader.frame(`frame-${frame}.jpg`);
    assert(released >= 3); await reader.close(); assert.equal(acquired, released);
  }
  {
    let attempts = 0;
    const reader = createSegmentReader({ info, acquire: (_, signal) => { attempts++; return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(Error('cancelled'), { code: 'MEDIA_CANCELLED' })), { once: true }); }); },
      release: async () => {}, readAsset: async () => Buffer.alloc(8) });
    const pending = reader.frame('frame-0.jpg'); reader.cancelAll(); await assert.rejects(pending, /cancelled/);
    await reader.close(); assert.equal(attempts, 1, 'closing must not retry the current cancelled frame');
  }
  {
    let time = 0, serial = 0; const callbacks = new Map(), h = audioHarness(info), read = [];
    const player = new Player({ canvas: { getContext: () => ({ drawImage() {} }) }, frameIndex: index, budget: h.budget,
      env: { now: () => time, raf: fn => { const id = ++serial; callbacks.set(id, fn); return id; }, caf: id => callbacks.delete(id),
        sleep: async () => {}, createAudioContext: () => h.context, decodeImage: async () => ({ width: 8, height: 8, close() {} }) },
      readAsset: async (_, file) => { assert.notEqual(file, 'streamed-audio.wav'); read.push(file); return Buffer.alloc(8); },
      createSegmentAudio: settings => createSegmentAudio({ ...settings, read: async i => ({ bytes: Buffer.alloc(16), start: i, duration: 1 }) }) });
    async function settle(work) { let done = false, failure; work.then(() => { done = true; }, e => { done = true; failure = e; });
      for (let n = 0; n < 100 && !done; n++) { await flush(); const tasks = [...callbacks.values()]; callbacks.clear(); tasks.forEach(fn => fn()); }
      assert(done); if (failure) throw failure; return work; }
    await settle(player.load(info)); assert.equal(player.snapshot().state, 'paused'); assert(read.length < 10, 'no whole-video warm');
    await settle(player.seek(31.5, { final: true })); assert.equal(player.snapshot().frameOrdinal, 756);
    await settle(player.play()); assert.equal(player.snapshot().state, 'playing');
    time += 100; h.context.currentTime += .1; for (const fn of [...callbacks.values()]) fn(); await flush();
    await settle(player.pause()); await player.dispose(); assert.equal(h.budget.used, 0); assert.equal(h.context.state, 'closed');
  }
  console.log('long playback: audio schedule continuity, loop/rate, pending-close budget, lease reuse/eviction and formal Player long-seek/play/dispose passed (models).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
