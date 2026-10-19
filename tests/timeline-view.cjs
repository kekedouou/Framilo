'use strict';
const assert = require('assert');
const view = require('../plugin/timeline-view.js');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('ok timeline view: ' + name); }
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, a + ' != ' + b);
const loop = { enabled: true, valid: true, startTime: 2, endTime: 4, endBoundary: 4.3 };
test('Only a valid enabled loop expands; editing, invalid metadata and empty media stay whole', () => {
  for (const value of [null, { ...loop, enabled: false }, { ...loop, valid: false }, { ...loop, startTime: NaN }, { ...loop, startTime: 8 }])
    assert.deepStrictEqual(view.visibleRange(5, value), { start: 0, end: 5, focused: false });
  assert.deepStrictEqual(view.visibleRange(5, loop, true), { start: 0, end: 5, focused: false });
  assert.deepStrictEqual(view.visibleRange(NaN, loop), { start: 0, end: 0, focused: false });
});
test('VFR end-frame duration is included without estimating FPS; padding is bounded by the source', () => {
  const range = view.visibleRange(10, loop);
  near(range.start, 1.885); near(range.end, 4.415); assert(range.focused);
  assert(view.contains(4.299, range)); assert(view.ratio(4, range) < 1);
  const edge = view.visibleRange(4.3, { ...loop, startTime: 0 });
  assert.equal(edge.start, 0); assert.equal(edge.end, 4.3);
  assert.equal(view.visibleRange(10, { ...loop, startTime: 4, endTime: 4.001, endBoundary: 4.003 }).focused, true);
});
test('The same absolute-time mapping drives pointers and markers in both views', () => {
  const range = view.visibleRange(10, loop), rect = { left: 100, width: 300 };
  for (const time of [range.start, 2, 3, 4, range.end]) near(view.timeAt(100 + view.ratio(time, range) * 300, rect, range), time);
  assert.equal(view.timeAt(50, rect, range), range.start); assert.equal(view.timeAt(500, rect, range), range.end);
  assert.equal(view.timeAt(200, { width: 0 }, range), null);
  assert.equal(view.timeAt(250, rect, 10), 5);
  assert(!view.contains(1, range)); assert(!view.contains(6, range));
});
test('Coverage intersects the visible interval; offscreen data cannot paint a false edge', () => {
  const range = { start: 2, end: 4 };
  assert.equal(view.clip(0, 1, range), null); assert.equal(view.clip(5, 6, range), null);
  assert.deepStrictEqual(view.clip(1, 3, range), { start: 0, end: .5 });
  assert.deepStrictEqual(view.clip(3, 9, range), { start: .5, end: 1 });
});
test('Whole-video ticks thin as the track narrows; small focused intervals use absolute fractional seconds', () => {
  const range = { start: 0, end: 30, focused: false };
  const wide = view.ticks(range, 1600), narrow = view.ticks(range, 300);
  assert(wide.length > narrow.length); assert(wide.every(t => Number.isInteger(t.time)));
  const short = view.ticks({ start: 5.12, end: 5.31, focused: true }, 800);
  assert(short.length > 2); assert(short.every(t => t.time >= 5.12 && t.time <= 5.31));
  assert(short.some(t => /^5\.\d+s$/.test(t.label))); assert(!short.some(t => t.label === '0s'));
});
test('Bounded ticks handle tiny intervals, long absolute time, odd widths and no space without overlap', () => {
  for (const range of [{ start: 0, end: .013, focused: false }, { start: 29.99, end: 30, focused: true },
    { start: 61, end: 61.4, focused: true }, { start: 0, end: 30, focused: false }]) {
    for (const width of [0, 31, 85, 219, 900, 8000]) {
      const ticks = view.ticks(range, width); assert(ticks.length <= 256);
      let right = -10;
      for (const tick of ticks.filter(t => t.label)) {
        const left = tick.position * width + tick.labelOffset;
        assert(left >= -1e-7 && left >= right + 10 - 1e-7);
        right = left + tick.label.length * 7 + 4; assert(right <= width + 1e-7);
      }
    }
  }
});
console.log('Timeline view: ' + checks + ' pure checks; no Eagle, media or resource measurements.');
