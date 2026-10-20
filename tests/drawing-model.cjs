'use strict';
const assert = require('assert'), model = require('../plugin/drawing-model.js');
const shape = { id: 'one', kind: 'rect', color: '#ff5252', width: .004, a: { x: .1, y: .2 }, b: { x: .3, y: .4 } };
let count = 0;
function test(name, fn) { fn(); count++; console.log('ok drawing model: ' + name); }
test('Source-relative geometry handles landscape/portrait/letterbox without resizing the video', () => {
  assert.deepStrictEqual(model.imageRect({ left: 10, top: 20, width: 800, height: 800 }, 1920, 1080), { left: 10, top: 195, width: 800, height: 450 });
  assert.deepStrictEqual(model.imageRect({ left: 10, top: 20, width: 800, height: 800 }, 720, 1280), { left: 185, top: 20, width: 450, height: 800 });
  assert.equal(model.imageRect({ width: 0, height: 20 }, 2, 3), null);
});
test('All five tools validate independently and never retain caller-owned mutation', () => {
  const objects = [shape, { ...shape, id: 'arrow', kind: 'arrow' }, { ...shape, id: 'ellipse', kind: 'ellipse' },
    { ...shape, id: 'text', kind: 'text', text: '中文\n<img onerror=x>', size: .04 }, { id: 'pen', kind: 'pen', color: '#ffffff', width: .004, points: [{ x: 0, y: 1 }] }];
  const v = model.validate(objects); v[0].a.x = 1; assert.equal(shape.a.x, .1);
  for (const bad of [{ ...shape, width: 0 }, { ...shape, color: 'url(javascript:x)' }, { ...shape, a: { x: Infinity, y: 0 } }, { ...shape, kind: 'script' }, { ...shape, kind: 'text', text: '', size: .04 }]) assert.throws(() => model.validate([bad]));
  assert.throws(() => model.validate([shape, shape]));
});
test('Movement clamps the entire object; resizing preserves normalized positions and safe bounds', () => {
  const move = model.transform(shape, { x: 0, y: 0 }, { x: 1, y: 1 }); assert(Math.abs(move.b.x - 1) < 1e-9); assert(Math.abs(move.b.y - 1) < 1e-9);
  const resize = model.transform(shape, shape.b, { x: .6, y: .7 }, true); assert(Math.abs(resize.b.x - .6) < 1e-9); assert(Math.abs(resize.b.y - .7) < 1e-9);
});
test('Undo groups commits, bounds history and exposes no drawing redo operation', () => {
  const e = model.createEditor(); e.replace([shape]); e.replace([{ ...shape, color: '#ffffff' }]); e.undo(); assert.equal(e.snapshot()[0].color, '#ff5252');
  assert.equal(e.redo, undefined); assert.equal(e.canRedo, undefined); e.replace([]);
  for (let i = 0; i < 40; i++) e.replace([{ ...shape, a: { x: i / 100, y: .2 } }]); let undos = 0; while (e.undo()) undos++; assert.equal(undos, 32);
});
test('Same-kind stroke selection keeps hollow interiors available and respects topmost order and screen scale', () => {
  const geometry = { width: 800, height: 450 }, duplicate = { ...shape, id: 'top' };
  assert.equal(model.hitTest([shape], 'rect', { x: .2, y: .3 }, geometry), null);
  assert.equal(model.hitTest([shape, duplicate], 'rect', { x: .2, y: .2 }, geometry).id, 'top');
  assert.equal(model.hitTest([shape], 'ellipse', { x: .2, y: .2 }, geometry), null);
  assert(model.hitTest([shape], 'rect', { x: .2, y: .21 }, geometry));
  const ellipse = { ...shape, kind: 'ellipse' };
  assert(model.hitTest([ellipse], 'ellipse', { x: .3, y: .3 }, geometry));
  assert.equal(model.hitTest([ellipse], 'ellipse', { x: .2, y: .3 }, geometry), null);
  const pen = { id: 'pen', kind: 'pen', color: '#ffffff', width: .004, points: [{ x: .1, y: .1 }, { x: .4, y: .4 }] };
  assert(model.hitTest([pen], 'pen', { x: .25, y: .25 }, geometry));
  assert(model.hitTest([{ ...shape, kind: 'text', text: '字', size: .04 }], 'text', { x: .2, y: .3 }, geometry));
  const arrow = { ...shape, kind: 'arrow', width: .03, a: { x: .1, y: .5 }, b: { x: .8, y: .5 } }, head = .03 * geometry.height * 5;
  assert(model.hitTest([arrow], 'arrow', { x: .8 - Math.cos(.45) * head / geometry.width, y: .5 - Math.sin(.45) * head / geometry.height }, geometry));
});
test('All four corners and arrow endpoints transform without changing the opposite anchor or leaving image bounds', () => {
  for (const [handle, x, y, anchor] of [['nw', .05, .1, 'b'], ['se', .5, .7, 'a'], ['ne', .5, .1, null], ['sw', .05, .7, null]]) {
    const changed = model.transform(shape, shape.a, { x, y }, handle); model.validate([changed]);
    if (anchor) assert.deepEqual(changed[anchor], shape[anchor]);
    const box = model.bounds(changed); assert(Math.abs((handle.includes('w') ? box.x : box.right) - x) < 1e-8);
  }
  const arrow = { ...shape, kind: 'arrow' }, changed = model.transform(arrow, shape.a, { x: .9, y: .8 }, 'a');
  assert.deepEqual(changed.b, arrow.b); assert.deepEqual(changed.a, { x: .9, y: .8 });
});
test('Tools share one color while keeping separate valid widths and one text size', () => {
  const p = model.defaultStyles(); p.widths.pen = .02; p.color = '#ffffff';
  const checked = model.validateStyles(p); assert.equal(checked.widths.rect, .004); checked.widths.pen = .004; assert.equal(p.widths.pen, .02);
  for (const invalid of [{ ...p, color: 'red' }, { ...p, extra: true }, { ...p, size: .5 }, { ...p, widths: { ...p.widths, pen: 0 } }]) assert.throws(() => model.validateStyles(invalid));
});
console.log('Drawing model checks: ' + count + '; pure geometry/data only.');
