/* Frame-relative drawing data and bounded edit history. No DOM, files or SDK. */
(function (root, factory) {
  const api = factory(typeof window === 'object' ? window.EVADrawingErase : require('./drawing-erase.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'object') window.EVADrawingModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function (eraser) {
  'use strict';
  const KINDS = Object.freeze(['pen', 'arrow', 'rect', 'ellipse', 'text']);
  const MAX_BYTES = 256 * 1024;
  const copy = value => JSON.parse(JSON.stringify(value));
  const defaultStyles = () => ({ color: '#ffd54f', widths: { pen: .004, arrow: .004, rect: .004, ellipse: .004 }, size: .04 });
  function validateStyles(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'color,size,widths' || !/^#[0-9a-f]{6}$/i.test(value.color) ||
        !Number.isFinite(value.size) || value.size < .01 || value.size > .2 || !value.widths ||
        Object.keys(value.widths).sort().join(',') !== 'arrow,ellipse,pen,rect' ||
        Object.values(value.widths).some(n => !Number.isFinite(n) || n < .001 || n > .05)) throw Error('圈画工具设置无效，旧设置保留。');
    return copy(value);
  }
  const point = p => p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  function validate(objects) {
    if (!Array.isArray(objects) || objects.length > 128 || JSON.stringify(objects).length * 2 > MAX_BYTES) throw Error('圈画内容达到本帧容量上限，可撤销或删除对象后继续。');
    const ids = new Set();
    for (const o of objects) {
      const keys = o && Object.keys(o).filter(k => k !== 'erasures').sort().join(',');
      if (o && Object.prototype.hasOwnProperty.call(o, 'erasures')) validateErasures(o.erasures);
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
    if (typeof resize === 'string') return resizeHandle(o, to, resize);
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
    return mapErasures(result, o, map, resize ? Math.sqrt(sx * sy) : 1);
  }
  function resizeHandle(o, to, handle) {
    const result = copy(o), clamp = n => Math.max(0, Math.min(1, n));
    if (o.kind === 'arrow' && ['a', 'b'].includes(handle)) {
      result[handle] = { x: clamp(to.x), y: clamp(to.y) };
      const old = bounds(o), next = bounds(result), sx = (next.right - next.x) / Math.max(.0001, old.right - old.x), sy = (next.bottom - next.y) / Math.max(.0001, old.bottom - old.y);
      return mapErasures(result, o, p => ({ x: clamp(next.x + (p.x - old.x) * sx), y: clamp(next.y + (p.y - old.y) * sy) }));
    }
    if (!['nw', 'ne', 'sw', 'se'].includes(handle)) return result;
    const box = bounds(o), west = handle.includes('w'), north = handle.includes('n');
    const anchor = { x: west ? box.right : box.x, y: north ? box.bottom : box.y };
    let x = west ? Math.min(anchor.x - .001, clamp(to.x)) : Math.max(anchor.x + .001, clamp(to.x));
    let y = north ? Math.min(anchor.y - .001, clamp(to.y)) : Math.max(anchor.y + .001, clamp(to.y));
    let sx = Math.abs(x - anchor.x) / Math.max(.0001, box.right - box.x), sy = Math.abs(y - anchor.y) / Math.max(.0001, box.bottom - box.y);
    if (o.kind === 'text') {
      const factor = Math.max(.01 / o.size, Math.min(.2 / o.size, sx, sy,
        (west ? anchor.x : 1 - anchor.x) / Math.max(.0001, box.right - box.x),
        (north ? anchor.y : 1 - anchor.y) / Math.max(.0001, box.bottom - box.y)));
      sx = sy = factor; result.size = o.size * factor;
    }
    const map = p => ({ x: clamp(anchor.x + (p.x - anchor.x) * sx), y: clamp(anchor.y + (p.y - anchor.y) * sy) });
    if (o.kind === 'pen') result.points = o.points.map(map); else { result.a = map(o.a); result.b = map(o.b); }
    return mapErasures(result, o, map, Math.sqrt(sx * sy));
  }
  // Hit only visible strokes (plus a few CSS pixels), never a hollow interior.
  function hitTest(objects, kind, p, geometry) {
    const w = geometry.width, h = geometry.height, q = { x: p.x * w, y: p.y * h };
    const xy = a => ({ x: a.x * w, y: a.y * h });
    const distance = (a, b) => {
      a = xy(a); b = xy(b); const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
    };
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]; if (o.kind !== kind || erasedAt(o, p, geometry)) continue;
      const b = bounds(o), tolerance = Math.max(5, o.width * Math.min(w, h) / 2 + 3);
      let hit = false;
      if (kind === 'text') hit = q.x >= b.x * w - 3 && q.x <= b.right * w + 3 && q.y >= b.y * h - 3 && q.y <= b.bottom * h + 3;
      else if (kind === 'pen') hit = o.points.some((v, index) => distance(index ? o.points[index - 1] : v, v) <= tolerance);
      else if (kind === 'arrow') {
        const angle = Math.atan2((o.b.y - o.a.y) * h, (o.b.x - o.a.x) * w);
        const size = Math.max(12 * w / (geometry.sourceWidth || w), o.width * Math.min(w, h) * 5);
        const ends = [angle - .45, angle + .45].map(a => ({ x: o.b.x - Math.cos(a) * size / w, y: o.b.y - Math.sin(a) * size / h }));
        hit = distance(o.a, o.b) <= tolerance || ends.some(p => distance(o.b, p) <= tolerance);
      }
      else if (kind === 'rect') {
        const corners = [{ x: b.x, y: b.y }, { x: b.right, y: b.y }, { x: b.right, y: b.bottom }, { x: b.x, y: b.bottom }];
        hit = corners.some((v, index) => distance(v, corners[(index + 1) % 4]) <= tolerance);
      } else if (kind === 'ellipse') {
        const rx = (b.right - b.x) * w / 2, ry = (b.bottom - b.y) * h / 2, cx = (b.x + b.right) * w / 2, cy = (b.y + b.bottom) * h / 2;
        const angle = Math.atan2((q.y - cy) / (ry || 1), (q.x - cx) / (rx || 1));
        hit = Math.hypot(q.x - cx - rx * Math.cos(angle), q.y - cy - ry * Math.sin(angle)) <= tolerance;
      }
      if (hit) return o;
    }
    return null;
  }

  const FADE_SECONDS = .25, MAX_ERASURES = 64;
  function validateErasures(value) {
    if (!Array.isArray(value) || value.length > MAX_ERASURES || value.reduce((n, s) => n + (s?.points?.length || 0), 0) > 4096)
      throw Error('擦除轨迹达到本对象上限，可撤销或删除对象后继续。');
    for (const s of value) if (!s || Object.keys(s).sort().join(',') !== 'points,width' || !Number.isFinite(s.width) || s.width < .001 || s.width > .3 ||
        !Array.isArray(s.points) || !s.points.length || s.points.length > 2048 || !s.points.every(point)) throw Error('擦除轨迹格式无效。');
    return copy(value);
  }
  function mapErasures(result, original, map, factor = 1) {
    if (original.erasures) result.erasures = original.erasures.map(s => ({ points: s.points.map(map), width: Math.max(.001, Math.min(.3, s.width * factor)) }));
    return result;
  }
  function segmentDistance(p, a, b, w = 1, h = 1) {
    const dx = (b.x - a.x) * w, dy = (b.y - a.y) * h;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * w * dx + (p.y - a.y) * h * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot((p.x - a.x) * w - t * dx, (p.y - a.y) * h - t * dy);
  }
  function erasedAt(o, p, geometry) {
    return (o.erasures || []).some(s => s.points.some((v, i) => segmentDistance(p, i ? s.points[i - 1] : v, v, geometry.width, geometry.height) <= s.width * Math.min(geometry.width, geometry.height) / 2));
  }
  function erase(objects, stroke, geometry) {
    validateErasures([stroke]);
    return validate(eraser.optimize(validate(objects), stroke, geometry));
  }
  function frameIndex(frames, time, duration = Infinity) {
    if (!Array.isArray(frames) || !frames.length || !Number.isFinite(time) || time < frames[0].time || time > duration) return -1;
    let a = 0, b = frames.length;
    while (a + 1 < b) { const m = (a + b) >> 1; if (frames[m].time <= time) a = m; else b = m; }
    return a;
  }
  function nativeAtFrame(items, frames, ordinal, duration) { return items.filter(n => frameIndex(frames, n.time, duration) === ordinal); }
  function visibleGroups(records, time, seconds = FADE_SECONDS, ordinal = null) {
    if (!Number.isFinite(time)) return [];
    if (seconds === 0) return records.filter(record => Number.isSafeInteger(ordinal) ? record.frameOrdinal === ordinal : Math.abs(time - record.time) < 1e-8).map(record => ({ record, opacity: 1 }));
    return records.map(record => ({ record, opacity: Math.max(0, 1 - Math.abs(time - record.time) / seconds) }))
      .filter(n => n.opacity > .00001).sort((a, b) => a.record.time - b.record.time || a.record.id.localeCompare(b.record.id));
  }

  function createEditor(initial = []) {
    let value = validate(initial), past = [];
    function trim() { while (past.length > 32 || past.reduce((n, v) => n + JSON.stringify(v).length * 2, 0) > 4 * 1024 ** 2) past.shift(); }
    return {
      snapshot: () => copy(value),
      replace(next) { next = validate(next); if (JSON.stringify(next) === JSON.stringify(value)) return false; past.push(value); value = next; trim(); return true; },
      undo() { if (!past.length) return false; value = past.pop(); return true; },
      canUndo: () => !!past.length
    };
  }
  function imageRect(rect, width, height) {
    if (!(rect.width > 0 && rect.height > 0 && width > 0 && height > 0)) return null;
    const scale = Math.min(rect.width / width, rect.height / height), w = width * scale, h = height * scale;
    return { left: rect.left + (rect.width - w) / 2, top: rect.top + (rect.height - h) / 2, width: w, height: h };
  }
  return { KINDS, MAX_BYTES, validate, bounds, transform, hitTest, defaultStyles, validateStyles, createEditor, imageRect, erase, erasedAt, validateErasures, frameIndex, nativeAtFrame, visibleGroups, FADE_SECONDS };
});
