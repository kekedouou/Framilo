/* Pure, conservative eraser geometry. Existing {points,width} masks stay readable. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'object') window.EVADrawingErase = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const EPS = 1e-10, exhausted = {};
  const same = (a, b) => a.width === b.width && a.points.length === b.points.length && a.points.every((p, i) => p.x === b.points[i].x && p.y === b.points[i].y);
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  function distance(p, a, b) {
    const x = b.x - a.x, y = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (x * x + y * y || 1)));
    return Math.hypot(p.x - a.x - x * t, p.y - a.y - y * t);
  }
  function geometry(value = {}) {
    const width = Number.isFinite(value.width) && value.width > 0 ? value.width : 1000, height = Number.isFinite(value.height) && value.height > 0 ? value.height : 1000, scale = Math.min(width, height);
    const source = Number.isFinite(value.sourceWidth) && value.sourceWidth > 0 ? value.sourceWidth : width;
    return { x: width / scale, y: height / scale, pixel: 1 / scale, sourcePixel: width / source / scale, textBounds: value.textBounds || {} };
  }
  function simplify(stroke, g) {
    const rounded = stroke.points.map(p => ({ x: Math.round(p.x * 1e7) / 1e7, y: Math.round(p.y * 1e7) / 1e7 }));
    const points = rounded.filter((p, i) => !i || p.x !== rounded[i - 1].x || p.y !== rounded[i - 1].y);
    const xy = points.map(p => ({ x: p.x * g.x, y: p.y * g.y })), keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
    const tolerance = Math.min(g.pixel * .1, stroke.width / 50);
    while (stack.length) {
      const [a, b] = stack.pop(); let far = tolerance, index = -1;
      for (let i = a + 1; i < b; i++) { const d = distance(xy[i], xy[a], xy[b]); if (d > far) { far = d; index = i; } }
      if (index >= 0) { keep.add(index); stack.push([a, index], [index, b]); }
    }
    return { width: stroke.width, points: points.filter((p, i) => keep.has(i)) };
  }
  function segments(points) { return points.length === 1 ? [{ a: points[0], b: points[0] }] : points.slice(1).map((b, i) => ({ a: points[i], b })); }
  function partBox(parts, radius) {
    return { left: Math.min(...parts.map(s => Math.min(s.a.x, s.b.x))) - radius, right: Math.max(...parts.map(s => Math.max(s.a.x, s.b.x))) + radius,
      top: Math.min(...parts.map(s => Math.min(s.a.y, s.b.y))) - radius, bottom: Math.max(...parts.map(s => Math.max(s.a.y, s.b.y))) + radius };
  }
  const overlaps = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  function mask(stroke, g) {
    const result = { radius: stroke.width / 2, parts: segments(stroke.points.map(p => ({ x: p.x * g.x, y: p.y * g.y }))) };
    result.box = partBox(result.parts, result.radius); return result;
  }
  function band(v, d, low, high) {
    if (Math.abs(d) < EPS) return v >= low && v <= high ? [0, 1] : null;
    const a = (low - v) / d, b = (high - v) / d, start = Math.max(0, Math.min(a, b)), end = Math.min(1, Math.max(a, b));
    return start <= end ? [start, end] : null;
  }
  function circle(a, b, c, radius) {
    const x = b.x - a.x, y = b.y - a.y, px = a.x - c.x, py = a.y - c.y, aa = x * x + y * y;
    if (aa < EPS * EPS) return Math.hypot(px, py) <= radius ? [0, 1] : null;
    const bb = px * x + py * y, dd = bb * bb - aa * (px * px + py * py - radius * radius);
    if (dd < 0) return null;
    const root = Math.sqrt(dd), start = Math.max(0, (-bb - root) / aa), end = Math.min(1, (-bb + root) / aa);
    return start <= end ? [start, end] : null;
  }
  // Intersect a line segment with a round-capped eraser segment (a capsule).
  function ranges(a, b, masks, margin, budget) {
    const found = [];
    for (const m of masks) {
      const r = m.radius - margin; if (r < 0) continue;
      const extra = Math.max(0, -margin);
      if (Math.max(a.x, b.x) < m.box.left - extra || Math.min(a.x, b.x) > m.box.right + extra ||
          Math.max(a.y, b.y) < m.box.top - extra || Math.min(a.y, b.y) > m.box.bottom + extra) continue;
      for (const s of m.parts) {
        if (--budget.left < 0) throw exhausted;
        const c = s.a, d = s.b;
        if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - r || Math.min(a.x, b.x) > Math.max(c.x, d.x) + r ||
            Math.max(a.y, b.y) < Math.min(c.y, d.y) - r || Math.min(a.y, b.y) > Math.max(c.y, d.y) + r) continue;
        for (const p of [c, d]) { const v = circle(a, b, p, r); if (v) found.push(v); }
        const len = Math.hypot(d.x - c.x, d.y - c.y);
        if (len > EPS) {
          const ux = (d.x - c.x) / len, uy = (d.y - c.y) / len, x = a.x - c.x, y = a.y - c.y, dx = b.x - a.x, dy = b.y - a.y;
          const along = band(x * ux + y * uy, dx * ux + dy * uy, 0, len), across = band(x * -uy + y * ux, dx * -uy + dy * ux, -r, r);
          if (along && across) { const lo = Math.max(along[0], across[0]), hi = Math.min(along[1], across[1]); if (lo <= hi) found.push([lo, hi]); }
        }
      }
    }
    found.sort((x, y) => x[0] - y[0]); const merged = [];
    for (const v of found) { const end = merged[merged.length - 1]; if (end && v[0] <= end[1] + EPS) end[1] = Math.max(end[1], v[1]); else merged.push(v); }
    return merged;
  }
  const complete = intervals => intervals.length === 1 && intervals[0][0] <= EPS && intervals[0][1] >= 1 - EPS;
  const covered = (a, b, masks, margin, budget) => complete(ranges(a, b, masks, margin, budget));
  function contains(outer, inner, budget) { return inner.parts.every(s => covered(s.a, s.b, outer, inner.radius, budget)); }
  function outline(o, g) {
    const xy = p => ({ x: p.x * g.x, y: p.y * g.y });
    if (o.kind === 'pen') return { parts: segments(o.points.map(xy)), radius: o.width * (o.points.length === 1 ? 1 : .5) + EPS };
    const a = xy(o.a), b = xy(o.b), left = Math.min(a.x, b.x), top = Math.min(a.y, b.y), right = Math.max(a.x, b.x), bottom = Math.max(a.y, b.y);
    let points, radius = o.width / 2 + EPS;
    if (o.kind === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.max(12 * g.sourcePixel, o.width * 5);
      const wings = [angle - .45, angle + .45].map(t => ({ x: b.x - Math.cos(t) * length, y: b.y - Math.sin(t) * length }));
      return { radius, parts: [{ a, b }, ...wings.map(a => ({ a, b }))] };
    }
    if (o.kind === 'rect') {
      const r = Math.max(left + g.sourcePixel, right), d = Math.max(top + g.sourcePixel, bottom);
      points = [{ x: left, y: top }, { x: r, y: top }, { x: r, y: d }, { x: left, y: d }, { x: left, y: top }];
    }
    if (o.kind === 'ellipse') {
      const rx = Math.max(g.sourcePixel, (right - left) / 2), ry = Math.max(g.sourcePixel, (bottom - top) / 2), largest = Math.max(rx, ry);
      const n = Math.min(512, Math.max(32, Math.ceil(Math.PI * Math.sqrt(largest / (2 * g.pixel * .1)))));
      // This sag bound encloses the true curve: uncertainty never deletes visible ink.
      radius += largest * Math.PI ** 2 / (2 * n ** 2);
      points = Array.from({ length: n + 1 }, (_, i) => ({ x: (left + right) / 2 + rx * Math.cos(i * 2 * Math.PI / n), y: (top + bottom) / 2 + ry * Math.sin(i * 2 * Math.PI / n) }));
    }
    if (o.kind === 'text') {
      const candidate = g.textBounds[o.id], actual = candidate && ['x', 'y', 'right', 'bottom'].every(k => Number.isFinite(candidate[k])) && candidate.right >= candidate.x && candidate.bottom >= candidate.y ? candidate : null;
      const box = actual ? { left: actual.x * g.x, top: actual.y * g.y, right: actual.right * g.x, bottom: actual.bottom * g.y } :
        { left: left - o.size, top: top - o.size, right: right + o.size, bottom: bottom + o.size };
      return { box, actual: !!actual };
    }
    return { parts: segments(points), radius };
  }
  function boxContact(box, m) {
    return m.parts.some(s => {
      const x = band(s.a.x, s.b.x - s.a.x, box.left - m.radius, box.right + m.radius), y = band(s.a.y, s.b.y - s.a.y, box.top - m.radius, box.bottom + m.radius);
      return x && y && Math.max(x[0], y[0]) <= Math.min(x[1], y[1]);
    });
  }
  function boxCovered(box, masks, budget) {
    // Each cell's entire circumcircle must fit inside an existing capsule.
    // Conservative certificate for actual SVG text bounds, including whitespace.
    const dx = (box.right - box.left) / 16, dy = (box.bottom - box.top) / 16, radius = Math.hypot(dx, dy) / 2 + EPS;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) {
      const p = { x: box.left + (x + .5) * dx, y: box.top + (y + .5) * dy };
      if (!covered(p, p, masks, radius, budget)) return false;
    }
    return true;
  }
  function optimize(objects, stroke, display) {
    const g = geometry(display), compact = simplify(stroke, g), cut = mask(compact, g), output = [];
    const budget = { left: 250000 };
    for (const o of objects) {
      if ((o.erasures || []).some(s => same(s, compact) || same(s, stroke))) { output.push(o); continue; }
      const shape = outline(o, g), box = shape.box || partBox(shape.parts, shape.radius);
      if (!overlaps(box, cut.box)) { output.push(o); continue; }
      const old = (o.erasures || []).map(s => mask(s, g));
      try {
        const touches = shape.box ? boxContact(shape.box, cut) : shape.parts.some(s => ranges(s.a, s.b, [cut], -shape.radius, budget).length);
        if (!touches) { output.push(o); continue; }
        if (contains(old, cut, budget)) { output.push(o); continue; }
        const all = [...old, cut];
        const gone = shape.box ? shape.actual && boxCovered(shape.box, all, budget) : shape.parts.every(s => covered(s.a, s.b, all, shape.radius, budget));
        if (gone) continue;
        if (shape.parts && !shape.parts.some(s => ranges(s.a, s.b, [cut], -shape.radius, budget).some(v =>
          !covered(lerp(s.a, s.b, v[0]), lerp(s.a, s.b, v[1]), old, shape.radius, budget)))) { output.push(o); continue; }
        const retained = (o.erasures || []).filter((s, i) => !contains([cut], old[i], budget));
        output.push({ ...o, erasures: [...retained, compact] });
      } catch (error) {
        if (error !== exhausted) throw error;
        // Never replace an uncertain calculation with more hidden masks.
        throw Error('圈画较复杂，请分成更短的擦除笔画，或先删除对象。');
      }
    }
    return output;
  }
  return { optimize };
});
