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
test('Undo/redo groups commits, bounds history and abandons redo after a new edit', () => {
  const e = model.createEditor(); e.replace([shape]); e.replace([{ ...shape, color: '#ffffff' }]); e.undo(); assert.equal(e.snapshot()[0].color, '#ff5252');
  e.redo(); assert.equal(e.snapshot()[0].color, '#ffffff'); e.undo(); e.replace([]); assert(!e.canRedo());
  for (let i = 0; i < 40; i++) e.replace([{ ...shape, a: { x: i / 100, y: .2 } }]); let undos = 0; while (e.undo()) undos++; assert.equal(undos, 32);
});
console.log('Drawing model checks: ' + count + '; pure geometry/data only.');
