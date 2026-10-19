'use strict';
const assert = require('assert'), path = require('path');
const { createSession } = require('../plugin/session.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(value => { resolve = value; }); return { promise, resolve }; }
function harness(options = {}) {
  const h = { created: [], published: [], discarded: [], destinations: [], imports: 0, pauses: 0 };
  const source = { id: 'A', name: 'Source', filePath: path.resolve('source.mp4') };
  const info = { source: { ...source, sha256: 'a'.repeat(64) }, duration: 3, frames: [0, 1, 2].map(id => ({ id, time: id, end: id + 1 })) };
  const adapter = { captureSelected: async () => source, readComments: async () => ({ items: [], libraryPath: path.resolve('test.library') }),
    async exportDestination(proposal) { h.destinations.push(proposal); return options.choose ? options.choose(proposal) : { kind: proposal.destination || 'local', filePath: path.resolve('output.png'), folderId: 'folder' }; },
    async importExport(proposal, settings) { h.imports++; if (options.importing) return options.importing(proposal, settings);
      return { status: 'saved', message: 'imported' }; },
    verifyExport: async () => ({ status: 'saved', message: 'verified' }) };
  const exports = { async create(owned, request, settings) { h.created.push({ owned, request, settings });
      if (options.generating) await options.generating(settings);
      return { token: 'token', filePath: path.resolve('temp.png'), sha256: 'b'.repeat(64) }; },
    async publish(token, destination) { h.published.push({ token, destination }); return { status: 'saved' }; },
    async discard(token) { h.discarded.push(token); } };
  h.session = createSession({ eagleAdapter: adapter, exports,
    media: { prepare: async () => info }, cache: { readAsset() {}, async release() {} },
    createPlayer: config => {
      let state = 'paused', ordinal = 0;
      const player = { snapshot: () => ({ state, frameId: ordinal, frameOrdinal: ordinal, time: ordinal, pendingTargets: 0 }),
        async load() {}, async play() {}, async dispose() {}, async step() {}, async seek() {},
        async pause() { h.pauses++; state = 'paused'; config.onChange(this.snapshot()); },
        transportSnapshot: () => ({ rate: .25, loop: { valid: true, startOrdinal: 1, endOrdinal: 2 } }) };
      h.frame = value => { ordinal = value; config.onChange(player.snapshot()); }; return player;
    } });
  h.load = async () => { await h.session.loadSelected(); await tick(); };
  return h;
}
let checks = 0;
async function test(name, fn) { await fn(); checks++; console.log('ok ' + name); }
(async () => {
  await test('Frame export freezes the actual displayed ordinal and uses only the prepared original source', async () => {
    const h = harness(); await h.load(); h.frame(2);
    assert.equal((await h.session.beginExport('frame')).status, 'saved');
    assert.deepEqual(h.created[0].request, { kind: 'frame', frameOrdinal: 2 });
    assert.equal(h.created[0].owned.source.sha256, 'a'.repeat(64)); assert.equal(h.published.length, 1); await h.session.close();
  });
  await test('Clip uses committed endpoints and original speed even when preview is slow', async () => {
    const h = harness(); await h.load(); await h.session.beginExport('clip');
    assert.deepEqual(h.created[0].request, { kind: 'clip', firstOrdinal: 1, lastOrdinal: 2 });
    assert(!Object.hasOwn(h.created[0].request, 'rate')); await h.session.close();
  });
  await test('Saving dialog cancellation never generates, publishes or imports a file', async () => {
    const h = harness({ choose: async () => ({ kind: 'cancelled' }) }); await h.load();
    assert.equal((await h.session.beginExport('frame')).status, 'cancelled');
    assert.equal(h.created.length, 0); assert.equal(h.imports, 0); await h.session.close();
  });
  await test('Busy export rejects playback, double export and comment mutation; normal cancellation settles', async () => {
    const gate = deferred(), h = harness({ generating: async settings => { await gate.promise; if (settings.signal.aborted) throw Error('cancelled'); } });
    await h.load(); const work = h.session.beginExport('frame'); await tick();
    await assert.rejects(h.session.play(), /正在导出/); assert.equal((await h.session.beginExport('clip')).status, 'ignored');
    assert.equal((await h.session.beginComment()).status, 'ignored'); h.session.cancelExport(); gate.resolve();
    assert.equal((await work).status, 'cancelled'); assert.equal(h.published.length, 0); await h.session.close();
  });
  await test('Closing cancels an outstanding save dialog; late response cannot start an old export', async () => {
    const gate = deferred(), h = harness({ choose: () => gate.promise }); await h.load();
    const work = h.session.beginExport('frame'); await tick(); await h.session.close();
    assert.equal((await work).status, 'cancelled'); gate.resolve({ kind: 'local', filePath: path.resolve('late.png') });
    await tick(); assert.equal(h.created.length, 0); assert.equal(h.session.snapshot().state, 'closed');
  });
  await test('Reload during export clears the old busy state after cancellation rather than freezing the new session', async () => {
    const gate = deferred(), h = harness({ generating: async settings => { await gate.promise; if (settings.signal.aborted) throw Error('cancelled'); } });
    await h.load(); const work = h.session.beginExport('frame'); await tick();
    await h.session.loadSelected(); gate.resolve(); assert.equal((await work).status, 'cancelled');
    assert.equal(h.session.snapshot().state, 'paused'); assert.equal(h.session.snapshot().exportState.status, 'idle');
    await h.session.play(); assert.equal(h.published.length, 0); await h.session.close();
  });
  await test('Unknown import retains its original file, blocks resending, and only offers read-only verification', async () => {
    const h = harness({ importing: async (proposal, settings) => { settings.onIssued(); return { status: 'unknown', attempt: { id: 'attempt' }, message: 'unknown' }; } });
    await h.load(); assert.equal((await h.session.beginExport('frame', { destination: 'eagle' })).status, 'unknown');
    assert.equal(h.discarded.length, 0); assert.equal((await h.session.beginExport('frame')).status, 'ignored');
    assert.equal((await h.session.checkExport()).status, 'saved'); assert.deepEqual(h.discarded, ['token']); assert.equal(h.imports, 1); await h.session.close();
  });
  console.log('Source export session checks: ' + checks + '; in-memory models, no real exports or SDK writes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
