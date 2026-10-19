'use strict';
const assert = require('assert');
const { harness } = require('./t1-app.cjs');
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function main() {
  let count = 0; const test = async (name, fn) => { await fn(); count++; console.log('ok drawing app: ' + name); };
  await test('Cancel native close retains UI/resources and a later approved close can finish exactly once', async () => {
    const h = harness(); await h.hooks.onPluginCreate({ path: h.root }); h.settings.drawingDraft = true;
    const gate = deferred(); let asks = 0; h.ui.confirmDrawingExit = () => { asks++; return gate.promise; };
    const first = h.hooks.onPluginBeforeExit(); h.hooks.beforeunload({ preventDefault() {} }); assert.equal(asks, 1); assert.equal(h.counts().closed, 0);
    gate.resolve(false); assert.equal((await first).status, 'cancelled'); await tick(); assert.equal(h.counts().destroyed, 0);
    h.ui.confirmDrawingExit = async () => { h.settings.drawingDraft = false; return true; };
    await h.hooks.onPluginBeforeExit(); assert.equal(h.counts().closed, 1); assert.equal(h.counts().destroyed, 1);
  });
  await test('New selection is captured before the save decision; cancel cannot reload or destroy the old source', async () => {
    const h = harness(); await h.hooks.onPluginCreate({ path: h.root }); h.settings.drawingDraft = true;
    const gate = deferred(); h.ui.confirmDrawingExit = () => gate.promise;
    const loading = h.hooks.onPluginRun(); assert.equal(h.log.filter(v => v.type === 'selected').length, 1);
    gate.resolve(false); assert.equal((await loading).status, 'cancelled'); assert.equal(h.log.filter(v => v.type === 'selected').length, 1);
    h.ui.confirmDrawingExit = async () => { h.settings.drawingDraft = false; return true; }; await h.hooks.onPluginRun();
    assert(h.log.filter(v => v.type === 'selected').at(-1).captured instanceof Promise);
  });
  await test('Failed save/return decision keeps library change pending rather than dropping the editor', async () => {
    const h = harness(); await h.hooks.onPluginCreate({ path: h.root }); h.settings.drawingDraft = true;
    h.ui.confirmDrawingExit = async () => false; await h.hooks.onLibraryChanged(); assert.equal(h.log.filter(v => v.type === 'library').length, 0);
    h.ui.confirmDrawingExit = async () => { h.settings.drawingDraft = false; return true; }; await h.hooks.onLibraryChanged(); assert.equal(h.log.filter(v => v.type === 'library').length, 1);
  });
  console.log('Drawing app: ' + count + ' actual app lifecycle models; not real Eagle close/selection tests.');
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
