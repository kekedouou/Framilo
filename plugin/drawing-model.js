/* Frame-relative drawing data and bounded edit history. No DOM, files or SDK. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'object') window.EVADrawingModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const KINDS = Object.freeze(['pen', 'arrow', 'rect', 'ellipse', 'text']);
  const MAX_BYTES = 256 * 1024;
  const copy = value => JSON.parse(JSON.stringify(value));
  const point = p => p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  function validate(objects) {
    if (!Array.isArray(objects) || objects.length > 128 || JSON.stringify(objects).length * 2 > MAX_BYTES) throw Error('圈画内容达到本帧容量上限，请减少对象或分开记录。');
    const ids = new Set();
    for (const o of objects) {
      const keys = o && Object.keys(o).sort().join(',');
      const expected = o && (o.kind === 'pen' ? 'color,id,kind,points,width' : o.kind === 'text' ? 'a,b,color,id,kind,size,text,width' : 'a,b,color,id,kind,width');
      if (keys !== expected) throw Error('圈画包含未知字段，未覆盖原件。');
      if (!o || !KINDS.includes(o.kind) || typeof o.id !== 'string' || !/^[\w-]{1,80}$/.test(o.id) || ids.has(o.id) ||
          !/^#[0-9a-f]{6}$/i.test(o.color) || !Number.isFinite(o.width) || o.width < .001 || o.width > .05)
        throw Error('圈画对象格式无法识别，未覆盖原件。');
      ids.add(o.id);
      if (o.kind === 'pen') {
        if (!Array.isArray(o.points) || !o.points.length || o.points.length > 2048 || !o.points.every(point)) throw Error('一笔过长或坐标无效，请分几笔绘制。');
      } else if (!point(o.a) || !point(o.b)) throw Error('圈画坐标无效。');
      if (o.kind === 'text' && (typeof o.text !== 'string' || !o.text.trim() || o.text.length > 4096 || !Number.isFinite(o.size) || o.size < .01 || o.size > .2))
        throw Error('画面文字为空、过长或字号无效。');
    }
    return copy(objects);
  }
  function bounds(o) {
    const points = o.kind === 'pen' ? o.points : [o.a, o.b];
    return { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
      right: Math.max(...points.map(p => p.x)), bottom: Math.max(...points.map(p => p.y)) };
  }
  function transform(o, from, to, resize = false) {
    const result = copy(o), box = bounds(o);
    const dx = Math.max(-box.x, Math.min(1 - box.right, to.x - from.x));
    const dy = Math.max(-box.y, Math.min(1 - box.bottom, to.y - from.y));
    const sx = resize ? Math.max(.02, Math.min(1, to.x) - box.x) / Math.max(.0001, box.right - box.x) : 1;
    const sy = resize ? Math.max(.02, Math.min(1, to.y) - box.y) / Math.max(.0001, box.bottom - box.y) : 1;
    const map = p => ({ x: Math.max(0, Math.min(1, resize ? box.x + (p.x - box.x) * sx : p.x + dx)),
      y: Math.max(0, Math.min(1, resize ? box.y + (p.y - box.y) * sy : p.y + dy)) });
    if (result.kind === 'pen') result.points = result.points.map(map);
    else { result.a = map(result.a); result.b = map(result.b); }
    if (resize && result.kind === 'text') result.size = Math.max(.01, Math.min(.2, result.size * Math.min(sx, sy)));
    return result;
  }
  function createEditor(initial = []) {
    let value = validate(initial), past = [], future = [];
    function trim() { while (past.length > 32 || past.reduce((n, v) => n + JSON.stringify(v).length * 2, 0) > 4 * 1024 ** 2) past.shift(); }
    return {
      snapshot: () => copy(value),
      replace(next) { next = validate(next); if (JSON.stringify(next) === JSON.stringify(value)) return false; past.push(value); value = next; future = []; trim(); return true; },
      undo() { if (!past.length) return false; future.push(value); value = past.pop(); return true; },
      redo() { if (!future.length) return false; past.push(value); value = future.pop(); trim(); return true; },
      canUndo: () => !!past.length, canRedo: () => !!future.length
    };
  }
  function imageRect(rect, width, height) {
    if (!(rect.width > 0 && rect.height > 0 && width > 0 && height > 0)) return null;
    const scale = Math.min(rect.width / width, rect.height / height), w = width * scale, h = height * scale;
    return { left: rect.left + (rect.width - w) / 2, top: rect.top + (rect.height - h) / 2, width: w, height: h };
  }
  return { KINDS, MAX_BYTES, validate, bounds, transform, createEditor, imageRect };
});
