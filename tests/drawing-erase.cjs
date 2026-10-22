'use strict';
const assert = require('assert'), model = require('../plugin/drawing-model.js');
const g = { width: 1600, height: 900, sourceWidth: 1600 };
const rect = { id: 'rect', kind: 'rect', color: '#ffffff', width: .004, a: { x: .1, y: .1 }, b: { x: .9, y: .9 } };
const line = { id: 'line', kind: 'pen', color: '#ffffff', width: .008, points: [{ x: .1, y: .5 }, { x: .9, y: .5 }] };
const cut = (x, y, width = .06) => ({ width, points: [{ x, y }] });
const bytes = value => JSON.stringify(value).length * 2;
let count = 0, failures = 0;
function test(name, fn) { try { fn(); count++; console.log('ok eraser: ' + name); } catch (e) { failures++; console.error('FAIL eraser: ' + name + '\n' + e.stack); } }
test('Empty rectangle and ellipse interiors never grow records or undo history', () => {
  for (const object of [rect, { ...rect, kind: 'ellipse' }]) {
    const editor = model.createEditor([object]); let value = editor.snapshot();
    for (let i = 0; i < 100; i++) value = model.erase(value, cut(.5 + i * .00001, .5), g);
    assert.deepStrictEqual(value, [object]); assert.equal(editor.replace(value), false); assert.equal(editor.canUndo(), false);
  }
});
test('Repeated erasure and movement wholly inside an old hole add no masks', () => {
  const first = model.erase([line], cut(.5, .5, .15), g);
  const again = model.erase(first, cut(.501, .5, .04), g); assert.deepStrictEqual(again, first);
  const crossed = model.erase([line], { width: .12, points: [{ x: .5, y: .2 }, { x: .5, y: .8 }] }, g);
  assert.deepStrictEqual(model.erase(crossed, cut(.5, .5, .04), g), crossed);
});
test('A larger replacement removes masks it wholly covers', () => {
  const first = model.erase([line], cut(.5, .5, .03), g), next = model.erase(first, cut(.5, .5, .1), g);
  assert.equal(next[0].erasures.length, 1); assert.equal(next[0].erasures[0].width, .1);
});
test('A completely erased object is removed and one undo restores all original ink', () => {
  const dot = { ...line, points: [{ x: .5, y: .5 }] }, editor = model.createEditor([dot]);
  const next = model.erase([dot], cut(.5, .5, .1), g); assert.deepStrictEqual(next, []);
  editor.replace(next); assert(editor.undo()); assert.deepStrictEqual(editor.snapshot(), [dot]);
  assert.deepStrictEqual(model.erase([line], { width: .05, points: line.points }, g), []);
});
test('Several erasures collectively remove a shape while an uncovered end is retained', () => {
  const left = { width: .08, points: [{ x: .1, y: .5 }, { x: .5, y: .5 }] };
  let value = model.erase([line], left, g); assert.equal(value.length, 1);
  value = model.erase(value, { width: .08, points: [{ x: .49, y: .5 }, { x: .9, y: .5 }] }, g); assert.deepStrictEqual(value, []);
});
test('Hollow outlines, arrow wings and untouched pieces survive partial erasure', () => {
  const arrow = { ...rect, kind: 'arrow', a: { x: .2, y: .5 }, b: { x: .8, y: .5 }, width: .02 };
  const wing = { x: .8 - Math.cos(.45) * .1 * 900 / 1600, y: .5 - Math.sin(.45) * .1 };
  const value = model.erase([arrow], cut(wing.x, wing.y, .025), g);
  assert.equal(value.length, 1); assert(value[0].erasures?.length);
  const shaftOnly = model.erase([arrow], { width: .04, points: [arrow.a, arrow.b] }, g);
  assert.equal(shaftOnly.length, 1, 'Wings outside the erased shaft must remain');
  for (const kind of ['rect', 'ellipse']) assert.equal(model.erase([{ ...rect, kind }], cut(.5, .1), g).length, 1);
});
test('Thin strokes and non-square aspect ratios use physical circular eraser distance', () => {
  const dot = { ...line, width: .001, points: [{ x: .5, y: .5 }] };
  assert.deepStrictEqual(model.erase([dot], cut(.54, .5, .1), g), [dot]); // 64px > 45px radius
  assert.deepStrictEqual(model.erase([dot], cut(.5, .54, .1), { ...g, width: 900, height: 1600, sourceWidth: 900 }), [dot]);
  assert.equal(model.erase([dot], cut(.5, .54, .1), g).length, 0);
});
test('Dense straight tracks are compact; corners remain present', () => {
  const stroke = { width: .04, points: Array.from({ length: 500 }, (_, i) => ({ x: .2 + i / 1000, y: .1 })) };
  const next = model.erase([rect], stroke, g); assert(next[0].erasures[0].points.length <= 3); assert(bytes(next) < 1000);
  const corner = { width: .04, points: [{ x: .1, y: .2 }, { x: .1, y: .8 }, { x: .8, y: .8 }] };
  assert.equal(model.erase([rect], corner, g)[0].erasures[0].points.length, 3);
  const duplicatedEnd = model.erase([rect], { width: .04, points: [{ x: .1, y: .2 }, { x: .1, y: .8 }, { x: .1, y: .8 }] }, g);
  assert.deepStrictEqual(duplicatedEnd[0].erasures[0].points, [{ x: .1, y: .2 }, { x: .1, y: .8 }]);
});
test('Identical and collinear repeated strokes never consume another mask', () => {
  const stroke = { width: .03, points: [{ x: .5, y: .2 }, { x: .5, y: .8 }] }, first = model.erase([line], stroke, g);
  assert.deepStrictEqual(model.erase(first, stroke, g), first);
  assert.deepStrictEqual(model.erase(first, { width: .03, points: [{ x: .5, y: .4 }, { x: .5, y: .6 }] }, g), first);
});
test('Existing masks at their count limit can be superseded without raising the limit', () => {
  const old = { ...line, erasures: Array.from({ length: 64 }, (_, i) => cut(.5 + i * .000001, .5, .02)) };
  const value = model.erase([old], cut(.5, .5, .08), g); assert.equal(value[0].erasures.length, 1); model.validate(value);
});
test('A nearly full frame can ignore blanks, store a compact cut and remove erased objects', () => {
  const text = { ...rect, kind: 'text', size: .01, a: { x: .95, y: .95 }, b: { x: 1, y: 1 }, text: 'x'.repeat(4096) };
  const value = [rect, ...Array.from({ length: 30 }, (_, i) => ({ ...text, id: 't' + i }))];
  const padding = ['padding1', 'padding2'].map(id => ({ ...text, id, text: 'x' })); value.push(...padding);
  let remaining = Math.floor((model.MAX_BYTES - 280 - bytes(value)) / 2);
  for (const p of padding) { const add = Math.min(4095, remaining); p.text = 'x'.repeat(1 + add); remaining -= add; }
  assert.equal(remaining, 0);
  model.validate(value); assert(model.MAX_BYTES - bytes(value) <= 281);
  assert.deepStrictEqual(model.erase(value, cut(.5, .5), g), value);
  const result = model.erase(value, { width: .04, points: Array.from({ length: 500 }, (_, i) => ({ x: .2 + i / 1000, y: .1 })) }, g);
  assert(result[0].erasures[0].points.length <= 3); assert(bytes(result) <= model.MAX_BYTES);
  const path = [rect.a, { x: .9, y: .1 }, rect.b, { x: .1, y: .9 }, rect.a];
  const removed = model.erase(value, { width: .08, points: path }, g);
  assert.equal(removed.length, value.length - 1); assert(bytes(removed) < bytes(value));
});
test('Legacy masks read unchanged; failed capacity validation leaves input and editor intact', () => {
  const old = { ...rect, erasures: [cut(.1, .3)] }, original = JSON.stringify(old), editor = model.createEditor([old]);
  assert.deepStrictEqual(model.validate([old]), [old]);
  const full = { ...line, erasures: Array.from({ length: 64 }, (_, i) => cut(.12 + i * .009, .5, .001)) };
  assert.throws(() => model.erase([full], cut(.88, .5, .002), g), /上限/);
  assert.equal(JSON.stringify(old), original); assert.equal(editor.canUndo(), false);
});
test('Text removal requires a proven actual glyph bound; partial text remains intact', () => {
  const text = { ...rect, kind: 'text', a: { x: .45, y: .45 }, b: { x: .55, y: .52 }, text: '文字', size: .04 };
  const actual = { x: .45, y: .45, right: .55, bottom: .52 };
  assert.deepStrictEqual(model.erase([text], cut(.5, .485, .3), { ...g, textBounds: { rect: actual } }), []);
  assert.equal(model.erase([text], cut(.45, .46, .02), { ...g, textBounds: { rect: actual } }).length, 1);
});
test('Bounded complex geometry stops without appending uncertain masks or modifying input', () => {
  const dense = { ...line, points: Array.from({ length: 2048 }, (_, i) => ({ x: i % 2 ? .49 : .51, y: .5 })) };
  const stroke = { width: .1, points: Array.from({ length: 500 }, (_, i) => ({ x: .1 + i * .001, y: i % 2 ? .49 : .51 })) };
  const original = JSON.stringify(dense), editor = model.createEditor([dense]);
  assert.throws(() => model.erase([dense], stroke, g), /较复杂/);
  assert.equal(JSON.stringify(dense), original); assert.equal(editor.canUndo(), false);
  const repeated = { ...dense, erasures: [stroke] };
  assert.deepStrictEqual(model.erase([repeated], stroke, g), [repeated], 'An identical legacy cut bypasses expensive geometry');
});
console.log('Eraser regression: ' + count + ' passed, ' + failures + ' failed');
if (failures) process.exitCode = 1;
