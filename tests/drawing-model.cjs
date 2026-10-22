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

test('A local eraser cuts every tool without deleting its object or source pixels, and undo restores the complete group', () => {
  const stroke={width:.05,points:[{x:.1,y:.2},{x:.7,y:.2}]};
  for(const kind of model.KINDS){
    const object=kind==='pen'?{id:kind,kind,color:'#ffffff',width:.01,points:[{x:.1,y:.2},{x:.7,y:.2}]}:
      {id:kind,kind,color:'#ffffff',width:.01,a:{x:.1,y:.2},b:{x:.7,y:.5},...(kind==='text'?{text:'完整文字',size:.04}:{})};
    const editor=model.createEditor([object]), next=model.erase([object],stroke);assert.equal(next.length,1);assert.equal(next[0].kind,kind);assert.equal(next[0].erasures.length,1);
    assert.equal(object.erasures,undefined);editor.replace(next);assert(editor.undo());assert.deepEqual(editor.snapshot(),[object]);
  }
});
test('Erased holes are no longer selectable; the rest of a stroke remains selectable at the same scale',()=>{
  const line={id:'line',kind:'pen',color:'#ffffff',width:.01,points:[{x:.1,y:.5},{x:.9,y:.5}]}, g={width:1000,height:600};
  const [cut]=model.erase([line],{width:.1,points:[{x:.5,y:.3},{x:.5,y:.7}]});
  assert(!model.hitTest([cut],'pen',{x:.5,y:.5},g));assert(model.hitTest([cut],'pen',{x:.2,y:.5},g));
});
test('Move and resize carry eraser holes with the object, including arrow endpoint and font transforms',()=>{
  const cut={...shape,erasures:[{width:.02,points:[{x:.2,y:.2},{x:.3,y:.3}]}]};
  const moved=model.transform(cut,{x:.2,y:.2},{x:.3,y:.3});assert(Math.abs(moved.erasures[0].points[0].x-.3)<1e-8);
  for(const object of [cut,{...cut,kind:'arrow'},{...cut,kind:'text',text:'A',size:.04}]){const resized=model.transform(object,object.a,{x:.8,y:.8},'se');model.validate([resized]);assert(resized.erasures[0].width>object.erasures[0].width);}
  model.validate([model.transform({...cut,kind:'arrow'},cut.a,{x:.05,y:.05},'a')]);
});
test('Eraser data is bounded and strictly validated; out-of-image and unknown fields cannot overwrite valid data',()=>{
  assert.throws(()=>model.erase([shape],{width:.1,points:[{x:2,y:0}]}));
  assert.throws(()=>model.validate([{...shape,erasures:[{width:.02,points:[{x:.2,y:.2}],unknown:true}]}]));
  assert.throws(()=>model.validate([{...shape,erasures:Array.from({length:65},()=>({width:.02,points:[{x:.2,y:.2}]}))}]));
  assert.deepEqual(model.erase([shape],{width:.01,points:[{x:.99,y:.99}]}),[shape]);
});
test('Fade follows video time in both directions; overlaps keep all groups and remain attached to original frames',()=>{
  const records=[{id:'a',time:1,frameId:8,objects:[shape]},{id:'b',time:1.1,frameId:9,objects:[shape]}];
  const middle=model.visibleGroups(records,1.05);assert.equal(middle.length,2);assert(Math.abs(middle[0].opacity-.8)<1e-8);
  assert.equal(model.visibleGroups(records,.749).length,0);assert.equal(model.visibleGroups(records,1.351).length,0);
  assert.equal(model.visibleGroups(records,1)[0].opacity,1);assert.deepEqual(records.map(n=>n.frameId),[8,9]);
  assert.equal(model.frameIndex([{time:0},{time:.033},{time:.099}],.08,.15),1);
});

console.log('Drawing model checks: ' + count + '; pure geometry/data only.');
