'use strict';
const assert = require('assert');
const { createProxyDecoder, annexB } = require('../plugin/proxy-decoder.js');
const packet = Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0, 0x1f, 0x80, 0, 0, 1, 0x68, 0x80, 0, 0, 1, 0x65, 0x80]);
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(settings = {}) {
  const timers = new Map(), instances = [], frames = [], images = []; let next = 0;
  class Chunk { constructor(value) { Object.assign(this, value); } }
  class Decoder {
    static async isConfigSupported(config) { return { supported: settings.unsupportedHardware ? config.hardwareAcceleration !== 'prefer-hardware' : !settings.unsupported, config }; }
    constructor(callbacks) { this.callbacks = callbacks; this.state = 'unconfigured'; this.chunks = []; instances.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    decode(chunk) { this.chunks.push(chunk); if (settings.immediate) this.deliver(chunk); }
    deliver(chunk, overrides = {}) { const frame = { timestamp: chunk.timestamp, displayWidth: 16, displayHeight: 8, closed: 0, close() { this.closed++; }, ...overrides }; frames.push(frame); this.callbacks.output(frame); return frame; }
    flush() { for (const chunk of this.chunks.splice(0)) this.deliver(chunk); return Promise.resolve(); }
    close() { this.state = 'closed'; }
  }
  const decoder = createProxyDecoder({ width: 16, height: 8, VideoDecoder: Decoder, EncodedVideoChunk: Chunk,
    setTimeout: (fn, ms) => { const id = ++next; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    createImageBitmap: async frame => {
      if (settings.bitmap) return settings.bitmap(frame);
      const image = { width: 16, height: 8, closed: 0, close() { this.closed++; } }; images.push(image); return image;
    }, ...settings.options });
  function fire(ms) { const due = [...timers.entries()].filter(([, item]) => item.ms === ms); for (const [id, item] of due) if (timers.delete(id)) item.fn(); }
  return { decoder, instances, frames, images, timers, fire };
}
async function main() {
  assert.equal(annexB(packet).codec, 'avc1.42001f');
  for (const bytes of [Buffer.alloc(0), packet.subarray(0, 10), Buffer.from([0, 0, 1, 0x61, 0x80])])
    assert.throws(() => annexB(bytes), /代理/);
  {
    const h = fixture(), one = h.decoder.decode(packet, { id: 100, time: 5 }), two = h.decoder.decode(packet, { id: 1, time: 0 });
    await assert.rejects(h.decoder.decode(packet, { id: 2 }), e => e.code === 'PROXY_DECODE_LIMIT'); await tick();
    assert.equal(h.instances.length, 1); const native = h.instances[0];
    assert.deepEqual(native.chunks.map(c => c.timestamp), [1, 2]);
    native.deliver(native.chunks[1]); native.deliver(native.chunks[0]);
    const images = await Promise.all([one, two]); assert.equal(images.length, 2); assert(h.frames.every(f => f.closed === 1));
    assert.equal(h.decoder.snapshot().pending, 0); assert.equal(h.decoder.snapshot().hardwareVerified, false);
    await h.decoder.close(); assert(images.every(i => i.closed === 0), 'returned images belong to caller'); images.forEach(i => i.close());
  }
  {
    const h = fixture(), pending = h.decoder.decode(packet, { id: 0 }); await tick(); assert.equal(h.decoder.snapshot().pending, 1);
    h.fire(8); const image = await pending; assert.equal(h.decoder.snapshot().flushes, 1); image.close(); await h.decoder.close();
  }
  {
    const h = fixture({ options: { flushAfterMs: null } }), pending = h.decoder.decode(packet, { id: 0 });
    const rejected = assert.rejects(pending, e => e.code === 'PROXY_DECODE_TIMEOUT'); await tick(); h.fire(2000); await rejected;
    assert.equal(h.instances[0].state, 'closed'); assert.equal(h.decoder.snapshot().pending, 0); await h.decoder.close();
  }
  {
    const h = fixture(), controller = new AbortController(), pending = h.decoder.decode(packet, { id: 0 }, { signal: controller.signal });
    const rejected = assert.rejects(pending, e => e.code === 'MEDIA_CANCELLED'); await tick(); controller.abort(); await rejected;
    assert.equal(h.decoder.snapshot().pending, 1, 'cancelled native work retains slot until output');
    h.instances[0].deliver(h.instances[0].chunks[0]); await tick(); assert.equal(h.decoder.snapshot().pending, 0);
    assert.equal(h.frames[0].closed, 1); assert.equal(h.images.length, 0); await h.decoder.close();
  }
  {
    let finishBitmap; const h = fixture({ bitmap: () => new Promise(resolve => { finishBitmap = resolve; }) });
    const pending = h.decoder.decode(packet, { id: 0 }); const rejected = assert.rejects(pending, e => e.code === 'PROXY_DECODER_CLOSED');
    await tick(); h.instances[0].deliver(h.instances[0].chunks[0]); await tick();
    let closed = false; const closing = h.decoder.close().then(() => { closed = true; }); await tick(); assert.equal(closed, false);
    const image = { width: 16, height: 8, closed: 0, close() { this.closed++; } }; finishBitmap(image);
    await Promise.all([rejected, closing]); assert.equal(image.closed, 1); assert.equal(h.frames[0].closed, 1);
    assert.equal(h.decoder.snapshot().pending, 0); assert.equal(h.decoder.snapshot().bitmapConversions, 0);
  }
  {
    const h = fixture(), pending = h.decoder.decode(packet, { id: 0 }); const rejected = assert.rejects(pending, e => e.code === 'PROXY_FRAME_SIZE');
    await tick(); h.instances[0].deliver(h.instances[0].chunks[0], { displayWidth: 17 }); await rejected; await tick();
    assert.equal(h.frames[0].closed, 1); assert.equal(h.images.length, 0); await h.decoder.close();
  }
  {
    const h = fixture({ immediate: true, unsupportedHardware: true }); const image = await h.decoder.decode(packet, { id: 0 });
    assert.equal(h.decoder.snapshot().hardwarePreference, 'no-preference'); image.close(); await h.decoder.close();
  }
  {
    const h = fixture({ unsupported: true }); await assert.rejects(h.decoder.decode(packet, { id: 0 }), e => e.code === 'PROXY_DECODER_UNSUPPORTED');
    assert.equal(h.instances.length, 0); assert.equal(h.decoder.snapshot().pending, 0); await h.decoder.close();
  }
  {
    const h = fixture(); await assert.rejects(h.decoder.decode(Buffer.alloc(8 * 1024 ** 2 + 1), { id: 0 }), e => e.code === 'PROXY_PACKET_LIMIT');
    await h.decoder.close(); await assert.rejects(h.decoder.decode(packet, { id: 0 }), e => e.code === 'PROXY_DECODER_CLOSED');
  }
  console.log('Proxy decoder: independent Annex-B keys, one native instance, two slots, reverse targets, flush, cancellation, size checks and actual close ownership passed (models; no browser/media).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
