'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { randomUUID } = require('crypto');
const { createAnnotationStore } = require('../plugin/drawing-store.cjs');
const { scratch } = require('./support/annotation-scratch.cjs');
const box = { id: 'box', kind: 'rect', color: '#ffffff', width: .004, a: { x: .1, y: .1 }, b: { x: .6, y: .6 } };
const note = (id = 'note', sourceSha256 = 'a'.repeat(64)) => ({ id, sourceSha256, nativeId: null, nativeTime: null, frameOrdinal: 2, frameId: 8, time: .125, objects: [box] });
let count = 0;
function test(name, fn) { fn(); count++; console.log('ok drawing store: ' + name); }
const s = scratch('store'), scope = { libraryPath: path.join(s.root, '中文 空格.library'), itemId: 'A' };
try {
  const plugin = path.join(s.root, 'plugin'); fs.mkdirSync(plugin); let store = createAnnotationStore({ pluginRoot: plugin });
  test('Read is lazy; default visibility and no drawing file do not create data', () => { assert.deepEqual(store.read(scope).records, []); assert(store.readVisibility().visible); assert(!fs.existsSync(store.root)); });
  let saved;
  test('Real filesystem save reopens with exact source frame and text objects; no source/library writes', () => {
    saved = store.save(scope, [note()], null); store = createAnnotationStore({ pluginRoot: plugin }); assert.equal(store.read(scope).records[0].frameId, 8); assert.equal(store.read(scope).token, saved.token); assert(!fs.existsSync(scope.libraryPath));
  });
  test('Stale writers cannot overwrite another complete revision', () => {
    const second = createAnnotationStore({ pluginRoot: plugin }), old = second.read(scope);
    saved = store.save(scope, [note(), note('two')], saved.token);
    assert.throws(() => second.save(scope, [], old.token), /改变|版本/); assert.equal(second.read(scope).records.length, 2);
  });
  test('Failed write before exclusive commit preserves previous valid state and can retry', () => {
    const broken = Object.create(fs); broken.linkSync = () => { const e = Error('injected disk full'); e.code = 'ENOSPC'; throw e; };
    const failed = createAnnotationStore({ pluginRoot: plugin, io: broken }); assert.throws(() => failed.save(scope, [], saved.token), /disk full/);
    assert.equal(store.read(scope).token, saved.token); saved = store.save(scope, [note()], saved.token);
  });
  test('A competing revision at the final atomic commit never overwrites the winner', () => {
    const racing = Object.create(fs); let raced = false;
    racing.linkSync = (from, to) => { if (!raced) { raced = true; store.save(scope, [note('winner')], saved.token); } return fs.linkSync(from, to); };
    const contender = createAnnotationStore({ pluginRoot: plugin, io: racing }); assert.throws(() => contender.save(scope, [note('loser')], saved.token), /另一个窗口/);
    saved = store.read(scope); assert.equal(saved.records[0].id, 'winner');
  });
  test('Committed hard-link interruption reopens correctly and known staging is released', () => {
    const fail = Object.create(fs); let injected = false;
    fail.unlinkSync = file => { if (!injected && path.basename(file).startsWith('next-')) { injected = true; throw Error('injected interruption after commit'); } return fs.unlinkSync(file); };
    const interrupted = createAnnotationStore({ pluginRoot: plugin, io: fail }); assert.throws(() => interrupted.save(scope, [note('committed')], saved.token), /可能已保存/);
    saved = store.read(scope); assert.equal(saved.records[0].id, 'committed');
  });
  test('Visibility persists independently; other libraries/items never borrow notes', () => {
    const visibility = store.readVisibility(); store.saveVisibility(false, visibility.token); assert(!createAnnotationStore({ pluginRoot: plugin }).readVisibility().visible);
    assert.deepEqual(store.read({ ...scope, itemId: 'B' }).records, []); assert.deepEqual(store.read({ ...scope, libraryPath: path.join(s.root, 'other.library') }).records, []);
  });
  test('New tool preferences reopen independently and do not change older drawing or visibility records', () => {
    const old = store.read(scope), visibility = store.readVisibility(), defaults = store.readStyles();
    const styles = { ...defaults.styles, color: '#ff5252', size: .065, widths: { ...defaults.styles.widths, pen: .008 } };
    const p = store.saveStyles(styles, defaults.token); const reopened = createAnnotationStore({ pluginRoot: plugin });
    assert.deepEqual(reopened.readStyles().styles, styles); assert.equal(reopened.read(scope).token, old.token); assert.equal(reopened.readVisibility().token, visibility.token);
    assert.throws(() => store.saveStyles({ ...styles, size: .025 }, defaults.token), /改变/);
    const fail = Object.create(fs); fail.linkSync = () => { throw Error('injected style interruption'); };
    assert.throws(() => createAnnotationStore({ pluginRoot: plugin, io: fail }).saveStyles({ ...styles, size: .025 }, p.token), /interruption/);
    assert.equal(reopened.readStyles().token, p.token); assert.throws(() => store.saveStyles({ ...styles, unknown: 1 }, p.token));
  });
  test('Known staging hard link is recovered; an unrelated outside hard link is preserved and rejected', () => {
    const dir = path.join(store.root, saved.key), final = path.join(dir, 'r-' + String(saved.revision).padStart(12, '0') + '.json');
    const staging = path.join(dir, 'next-' + randomUUID() + '.json'); fs.linkSync(final, staging);
    assert.equal(fs.lstatSync(final).nlink, 2); assert.equal(store.read(scope).token, saved.token); assert(!fs.existsSync(staging));
    const unrelated = path.join(s.root, 'outside-link.json'); fs.linkSync(final, unrelated);
    assert.throws(() => store.read(scope), /不安全/); assert(fs.existsSync(unrelated)); fs.unlinkSync(unrelated); assert.equal(store.read(scope).token, saved.token);
  });
  test('Source content versions are retained, document growth is bounded, recent revisions are compacted', () => {
    saved = store.save(scope, [note('old'), note('new', 'b'.repeat(64))], saved.token); const dir = path.join(store.root, saved.key);
    assert(fs.readdirSync(dir).filter(n => n.startsWith('r-')).length <= 2); assert.equal(store.read(scope).records.length, 2);
    assert.throws(() => store.save(scope, Array.from({ length: 257 }, (_, i) => note('n' + i)), saved.token));
    assert.throws(() => store.save(scope, [{ ...note(), objects: [{ ...box, kind: 'text', size: .04, text: 'x'.repeat(4097) }] }], saved.token));
  });
  test('Unknown or corrupt data is preserved and never silently treated as an empty video', () => {
    const dir = path.join(store.root, saved.key), unknown = path.join(dir, 'unknown.json'); fs.writeFileSync(unknown, 'keep');
    assert.throws(() => store.read(scope), /未知/); assert.equal(fs.readFileSync(unknown, 'utf8'), 'keep'); fs.unlinkSync(unknown);
    const final = path.join(dir, fs.readdirSync(dir).sort().at(-1)); fs.writeFileSync(final, '{broken'); assert.throws(() => store.read(scope)); assert.equal(fs.readFileSync(final, 'utf8'), '{broken');
  });
  console.log('Drawing store: ' + count + ' real isolated filesystem checks; no Eagle or original media writes.');
} finally { s.clean(); }
