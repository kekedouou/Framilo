/* Independent transparent editor. Operations go through Session only. */
(function (root, factory) {
  const view = typeof window === 'object' ? window : null;
  const api = factory(view ? view.EVADrawingModel : require('./drawing-model.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (view) view.EVADrawingUI = api;
})(typeof globalThis === 'object' ? globalThis : this, function (model) {
  'use strict';
  function createDrawingUI({ document: doc, window: win, getSession, getState, canBegin, isKey, menuActive = () => false }) {
    const ids = ['screen', 'picture', 'drawingLayer', 'drawingPanel', 'drawingTool', 'drawingColor', 'drawingWidth', 'drawingSize',
      'drawingToolPen', 'drawingToolArrow', 'drawingToolRect', 'drawingToolEllipse', 'drawingToolText', 'drawingToolEraser',
      'drawingColorButton', 'drawingOptions', 'drawingProperties', 'drawingPalette', 'drawingWidthLabel', 'drawingWidthName', 'drawingSizeLabel',
      'drawingText', 'drawingTextDelete', 'drawingDelete', 'drawingSave', 'drawingCancel', 'drawingMessage', 'drawingNew',
      'showDrawings', 'drawingStatus', 'drawingExit', 'drawingExitMessage', 'drawingExitSave', 'drawingExitDiscard', 'drawingExitReturn'];
    const el = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
    if (ids.some(id => !el[id])) throw Error('圈画界面缺少必要元素。');
    const listeners = [], on = (n, t, f, options) => { n.addEventListener(t, f, options); listeners.push([n, t, f, options]); };
    const buttons = Object.fromEntries([...model.KINDS, 'eraser'].map(k => [k, el['drawingTool' + k[0].toUpperCase() + k.slice(1)]]));
    let editor = null, committed = [], editorKey = null, selected = null, drag = null, work = null, textDraft = null, temporaryVisible = true;
    let snapshot = null, geometry = null, width = 1280, height = 720, normalKey = null, tool = 'pen', styles = model.defaultStyles(), stylesRef = null;
    let eraserPoint = null, eraserWidth = .045, normalGroups = [], normalRecords = null, normalOrder = [], groupNodes = new Map(), lastRender = null;
    const maskPrefix = 'erase-' + Math.random().toString(36).slice(2) + '-';
    let composing = false, compositionEnd = -Infinity, exitResolve = null, exitPromise = null, destroyed = false;
    const session = () => getSession(), draft = () => snapshot?.drawings?.draft;
    const set = (n, k, v) => { if (n[k] !== v) n[k] = v; };
    const now = () => win.performance && typeof win.performance.now === 'function' ? win.performance.now() : Date.now();
    const objects = () => work || committed;
    const current = () => textDraft?.object || objects().find(o => o.id === selected);
    function hideLayer(hidden) {
      el.drawingLayer.hidden = hidden;
      if (hidden) el.drawingLayer.setAttribute('hidden', ''); else el.drawingLayer.removeAttribute?.('hidden');
    }
    function node(tag, attrs = {}) {
      const n = doc.createElementNS ? doc.createElementNS('http://www.w3.org/2000/svg', tag) : doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n;
    }
    function message(text) { set(el.drawingMessage, 'textContent', text); }
    function layout() {
      const canvas = el.picture.getBoundingClientRect(), screen = el.screen.getBoundingClientRect();
      width = Number(el.picture.width) || 1280; height = Number(el.picture.height) || 720;
      geometry = model.imageRect(canvas, width, height); if (!geometry) return;
      Object.assign(el.drawingLayer.style, { left: geometry.left - screen.left + 'px', top: geometry.top - screen.top + 'px', width: geometry.width + 'px', height: geometry.height + 'px' });
      el.drawingLayer.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      // CSS layout quantizes fractional image-fit dimensions. Pointer positions
      // must use the actually displayed SVG rectangle, not the unrounded plan.
      const displayed = el.drawingLayer.getBoundingClientRect();
      if (displayed.width > 0 && displayed.height > 0) geometry = { left: displayed.left, top: displayed.top, width: displayed.width, height: displayed.height };
      geometry.sourceWidth = width;
      layoutText();
    }
    function point(e) { return geometry ? { x: Math.max(0, Math.min(1, (e.clientX - geometry.left) / geometry.width)), y: Math.max(0, Math.min(1, (e.clientY - geometry.top) / geometry.height)) } : null; }
    const measure = el.picture.getContext?.('2d');
    function textWidth(value, font) {
      if (measure?.measureText) { measure.font = font + 'px "Segoe UI", "Microsoft YaHei UI", sans-serif'; return measure.measureText(value).width; }
      return [...value].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1 : .6), 0) * font;
    }
    function layoutText() {
      el.drawingTextDelete.hidden = !textDraft || el.drawingText.hidden;
      if (!textDraft || !geometry) return;
      const o = textDraft.object, font = o.size * Math.min(width, height) * geometry.width / width;
      const lines = el.drawingText.value.split('\n'), natural = Math.max(36, ...lines.map(s => textWidth(s, font))) + 14;
      const left = parseFloat(el.drawingLayer.style.left) + o.a.x * geometry.width - 4;
      const top = parseFloat(el.drawingLayer.style.top) + o.a.y * geometry.height - 4;
      const available = Math.max(36, (1 - o.a.x) * geometry.width + 4), boxWidth = Math.min(natural, available);
      const boxHeight = Math.max(font * 1.25 + 10, lines.length * font * 1.25 + 10);
      Object.assign(el.drawingText.style, { left: left + 'px', top: top + 'px', width: boxWidth + 'px',
        height: boxHeight + (natural > available ? 16 : 0) + 'px', fontSize: font + 'px', color: o.color,
        overflowX: natural > available ? 'auto' : 'hidden' });
      Object.assign(el.drawingTextDelete.style, { left: left + boxWidth - 9 + 'px', top: Math.max(2, top - 8) + 'px' });
      el.drawingTextDelete.disabled = el.drawingText.disabled;
    }
    function properties() {
      const o = current();
      for (const [k, button] of Object.entries(buttons)) button.setAttribute('aria-pressed', String(k === tool));
      el.drawingTool.setAttribute('data-tool', tool);
      el.drawingColor.value = o?.color || styles.color; el.drawingColorButton.style.color = el.drawingColor.value;
      el.drawingWidthName.textContent = tool === 'eraser' ? '擦除直径' : '线宽';
      el.drawingWidth.min = tool === 'eraser' ? '.005' : '.001'; el.drawingWidth.max = tool === 'eraser' ? '.15' : '.05';
      el.drawingWidth.value = tool === 'eraser' ? eraserWidth : o && o.kind !== 'text' ? o.width : styles.widths[tool] || .004;
      el.drawingColorButton.hidden = tool === 'eraser';
      el.drawingSize.value = o?.kind === 'text' ? o.size : styles.size;
      el.drawingWidthLabel.hidden = tool === 'text'; el.drawingSizeLabel.hidden = tool !== 'text';
      el.drawingDelete.hidden = !o || !!textDraft && !el.drawingText.value.trim(); el.drawingDelete.disabled = !editor || !o;
      el.drawingOptions.setAttribute('aria-expanded', String(!el.drawingProperties.hidden));
      el.drawingColorButton.setAttribute('aria-expanded', String(!el.drawingPalette.hidden));
    }
    function closeProperties() { el.drawingProperties.hidden = el.drawingPalette.hidden = true; properties(); }
    function handles(o) {
      if (o.kind === 'arrow') return [['a', o.a], ['b', o.b]];
      const b = model.bounds(o); return [['nw', { x: b.x, y: b.y }], ['ne', { x: b.right, y: b.y }], ['sw', { x: b.x, y: b.bottom }], ['se', { x: b.right, y: b.bottom }]];
    }
    function render(value) {
      const nodes = [], scale = Math.min(width, height); groupNodes = new Map();
      const entries = editor ? value.map(o => ({ o, key: o.id, parent: nodes })) : normalGroups.flatMap(({ record, opacity }) => {
        const group = node('g', { 'data-drawing-group': record.id, opacity }); nodes.push(group); groupNodes.set(record.id, group);
        return record.objects.map(o => ({ o, key: record.id + '-' + o.id, parent: group }));
      });
      for (const { o, key, parent } of entries) {
        if (textDraft?.object.id === o.id) continue;
        const g = node('g', { 'data-object-id': o.id, fill: 'none', stroke: o.color, 'stroke-width': o.width * scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'pointer-events': 'none' });
        const x = o.a?.x * width, y = o.a?.y * height, x2 = o.b?.x * width, y2 = o.b?.y * height;
        if (o.kind === 'pen') {
          if (o.points.length === 1) g.appendChild(node('circle', { cx: o.points[0].x * width, cy: o.points[0].y * height, r: o.width * scale / 2, fill: o.color }));
          else g.appendChild(node('polyline', { points: o.points.map(p => p.x * width + ',' + p.y * height).join(' ') }));
        }
        if (o.kind === 'rect') g.appendChild(node('rect', { x: Math.min(x, x2), y: Math.min(y, y2), width: Math.max(1, Math.abs(x2 - x)), height: Math.max(1, Math.abs(y2 - y)) }));
        if (o.kind === 'ellipse') g.appendChild(node('ellipse', { cx: (x + x2) / 2, cy: (y + y2) / 2, rx: Math.max(1, Math.abs(x2 - x) / 2), ry: Math.max(1, Math.abs(y2 - y) / 2) }));
        if (o.kind === 'arrow') {
          const angle = Math.atan2(y2 - y, x2 - x), size = Math.max(12, o.width * scale * 5);
          g.appendChild(node('line', { x1: x, y1: y, x2, y2 }));
          g.appendChild(node('polyline', { points: [[x2 - Math.cos(angle - .45) * size, y2 - Math.sin(angle - .45) * size], [x2, y2], [x2 - Math.cos(angle + .45) * size, y2 - Math.sin(angle + .45) * size]].map(p => p.join(',')).join(' ') }));
        }
        if (o.kind === 'text') {
          const text = node('text', { x, y, fill: o.color, stroke: 'none', 'font-size': o.size * scale, 'font-family': 'Segoe UI, Microsoft YaHei UI, sans-serif', 'dominant-baseline': 'hanging' });
          o.text.split('\n').forEach((line, i) => { const span = node('tspan', { x, dy: i ? o.size * scale * 1.25 : 0 }); span.textContent = line || ' '; text.appendChild(span); }); g.appendChild(text);
        }
        if (o.erasures?.length) {
          const maskId = maskPrefix + key, defs = node('defs'), mask = node('mask', { id: maskId, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse', x: 0, y: 0, width, height, 'mask-type': 'luminance' });
          mask.appendChild(node('rect', { x: 0, y: 0, width, height, fill: 'white', stroke: 'none' }));
          for (const cut of o.erasures) {
            const attrs = { fill: 'none', stroke: 'black', 'stroke-width': cut.width * scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
            mask.appendChild(cut.points.length === 1 ? node('circle', { cx: cut.points[0].x * width, cy: cut.points[0].y * height, r: cut.width * scale / 2, fill: 'black', stroke: 'none' })
              : node('polyline', { ...attrs, points: cut.points.map(p => p.x * width + ',' + p.y * height).join(' ') }));
          }
          defs.appendChild(mask); g.appendChild(defs); g.setAttribute('mask', 'url(#' + maskId + ')');
        }
        if (Array.isArray(parent)) parent.push(g); else parent.appendChild(g);
      }
      const o = value.find(v => v.id === selected);
      if (editor && o && !textDraft && temporaryVisible && draft()?.kind !== 'delete') for (const [handle, p] of handles(o)) {
        // Constant screen-size handles. No visible or invisible bounding rectangle.
        const rx = 2.6 * width / Math.max(1, geometry?.width || width), ry = 2.6 * height / Math.max(1, geometry?.height || height);
        nodes.push(node('ellipse', { cx: p.x * width, cy: p.y * height, rx: rx * 3, ry: ry * 3, fill: 'transparent', stroke: 'none', 'data-object-id': o.id, 'data-handle': handle, 'pointer-events': 'all' }));
        nodes.push(node('ellipse', { cx: p.x * width, cy: p.y * height, rx, ry, fill: '#c5c9cf', 'fill-opacity': '.78', stroke: '#262626', 'stroke-width': width / Math.max(1, geometry?.width || width),
          'pointer-events': 'none', cursor: ['a', 'b'].includes(handle) ? 'crosshair' : ['nw', 'se'].includes(handle) ? 'nwse-resize' : 'nesw-resize' }));
      }
      if (editor && tool === 'eraser' && eraserPoint) nodes.push(node('ellipse', { 'data-eraser-cursor': 'true', cx: eraserPoint.x * width, cy: eraserPoint.y * height, rx: eraserWidth * scale / 2, ry: eraserWidth * scale / 2, fill: '#ffffff08', stroke: '#ddd', 'stroke-opacity': '.65', 'stroke-width': width / Math.max(1, geometry?.width || width), 'pointer-events': 'none' }));
      el.drawingLayer.replaceChildren(...nodes); properties(); layoutText();
      lastRender = { value, editor, geometry, selected, tool, textDraft, visible: temporaryVisible, kind: draft()?.kind };
    }
    function publish(next) {
      try {
        const changed = editor.replace(next); committed = editor.snapshot();
        if (changed) session()?.setDrawingObjects(committed);
        render(committed); return true;
      } catch (error) { work = null; message(error.message); render(committed); return false; }
    }
    function textObject(object, value) {
      if (value.length > 4096) throw Error('画面文字超过4096字，请缩短后保存。');
      const lines = value.split('\n'), size = object.size * Math.min(width, height);
      const length = Math.max(...lines.map(s => textWidth(s, size)));
      return { ...object, text: value, b: { x: Math.min(1, object.a.x + length / width), y: Math.min(1, object.a.y + lines.length * size * 1.25 / height) } };
    }
    function eraserGeometry() {
      const textBounds = Object.create(null);
      for (const element of el.drawingLayer.querySelectorAll('[data-object-id] > text')) {
        try {
          const b = element.getBBox();
          textBounds[element.parentNode.getAttribute('data-object-id')] = { x: b.x / width, y: b.y / height, right: (b.x + b.width) / width, bottom: (b.y + b.height) / height };
        } catch (_) { /* Hidden/unavailable glyph geometry: the model retains uncertain text. */ }
      }
      return { ...geometry, textBounds };
    }
    function commitText() {
      if (!textDraft) return;
      if (composing) throw Error('请先完成中文选字，再保存或切换工具。');
      const before = textDraft, value = el.drawingText.value;
      const next = committed.filter(o => o.id !== before.object.id);
      if (value.trim()) next.push(textObject(before.object, value));
      // Preserve original stacking order when editing an existing text.
      if (!before.fresh && value.trim()) { const index = committed.findIndex(o => o.id === before.object.id); const o = next.pop(); next.splice(index, 0, o); }
      textDraft = null; el.drawingText.hidden = true;
      if (!publish(next)) { textDraft = before; el.drawingText.hidden = false; throw Error(el.drawingMessage.textContent); }
      if (!value.trim()) selected = null;
    }
    function finish(event = null) {
      if (!drag || event && event.pointerId !== drag.pointerId) return;
      const before = drag, next = work; drag = null; work = null;
      try { if (el.drawingLayer.hasPointerCapture?.(before.pointerId)) el.drawingLayer.releasePointerCapture(before.pointerId); } catch (_) { /* Cancelled host pointer. */ }
      if (before.erasing) { if (next) publish(next); else render(committed); return; }
      const o = next?.find(n => n.id === before.object.id);
      const valid = !before.creating || before.moved && o && (['pen', 'arrow'].includes(o.kind) || Math.abs(o.a.x - o.b.x) * geometry.width >= 1 && Math.abs(o.a.y - o.b.y) * geometry.height >= 1);
      if (next && valid) publish(next); else { session()?.setDrawingObjects(committed); render(committed); }
    }
    function flush() { finish(); commitText(); }
    function editText(object, fresh = false) {
      selected = object.id; textDraft = { object: { ...object }, fresh }; el.drawingText.value = fresh ? '' : object.text;
      el.drawingText.hidden = false; render(committed); layoutText(); el.drawingText.focus();
      if (!fresh) el.drawingText.select?.();
    }
    function chooseTool(kind) {
      if (!editor || composing || exitPromise || draft()?.kind === 'delete') return;
      try { flush(); } catch (error) { message(error.message); return; }
      if (tool !== kind) selected = null; eraserPoint = null; tool = kind;
      el.drawingProperties.hidden = false; el.drawingPalette.hidden = true; render(committed); el.drawingLayer.focus?.({ preventScroll: true });
    }
    for (const [kind, button] of Object.entries(buttons)) on(button, 'click', () => chooseTool(kind));
    on(el.drawingOptions, 'click', () => { el.drawingProperties.hidden = !el.drawingProperties.hidden; el.drawingPalette.hidden = true; properties(); });
    on(el.drawingColorButton, 'click', () => { el.drawingPalette.hidden = !el.drawingPalette.hidden; el.drawingProperties.hidden = true; properties(); });
    function changeStyle(field, value) {
      if (!editor || draft()?.kind === 'delete' || ['saving', 'unknown'].includes(draft()?.status)) return;
      if (tool === 'eraser') { eraserWidth = Math.max(.005, Math.min(.15, Number(value))); properties(); return; }
      const next = model.validateStyles(styles);
      if (field === 'color') next.color = value; else if (field === 'size') next.size = Number(value); else next.widths[tool] = Number(value);
      try { model.validateStyles(next); } catch (error) { message(error.message); return; }
      const o = current();
      if (o) {
        let changed = { ...o, [field]: field === 'color' ? value : Number(value) };
        if (changed.kind === 'text' && field === 'size' && !textDraft) changed = textObject(changed, changed.text);
        if (textDraft) { textDraft.object = changed; if (el.drawingText.value.trim()) session()?.touchDrawing(); layoutText(); }
        else if (!publish(committed.map(n => n.id === o.id ? changed : n))) return;
      }
      styles = next;
      const result = session()?.setDrawingStyles?.(next);
      if (result?.status === 'failed') message(result.message);
      render(objects());
    }
    on(el.drawingColor, 'change', () => changeStyle('color', el.drawingColor.value));
    on(el.drawingWidth, 'change', () => changeStyle('width', el.drawingWidth.value));
    on(el.drawingSize, 'change', () => changeStyle('size', el.drawingSize.value));
    on(el.drawingPalette, 'click', event => {
      const swatch = event.target.closest?.('[data-drawing-color]'); if (!swatch) return;
      changeStyle('color', swatch.getAttribute('data-drawing-color')); el.drawingPalette.hidden = true; properties();
      if (!textDraft) el.drawingLayer.focus?.({ preventScroll: true });
    });
    on(el.drawingLayer, 'pointerdown', event => {
      if (!editor || !['editing', 'failed'].includes(draft()?.status) || draft()?.kind === 'delete' || !temporaryVisible || event.button !== 0 || exitPromise || composing) return;
      layout(); const p = point(event); if (!p) return;
      const handle = event.target.getAttribute?.('data-handle'), handleId = event.target.getAttribute?.('data-object-id');
      try { flush(); } catch (error) { message(error.message); return; }
      event.preventDefault(); el.drawingLayer.focus?.({ preventScroll: true }); closeProperties();
      if (tool === 'eraser') {
        selected = null; drag = { pointerId: event.pointerId, erasing: true, original: committed, geometry: eraserGeometry(), stroke: { points: [p], width: eraserWidth } };
        try { work = model.erase(committed, drag.stroke, drag.geometry); render(work); } catch (e) { message(e.message); drag = null; work = null; }
        try { el.drawingLayer.setPointerCapture?.(event.pointerId); } catch (_) {}
        return;
      }
      const hit = handle && selected === handleId ? committed.find(o => o.id === handleId && o.kind === tool) : model.hitTest(committed, tool, p, geometry);
      if (hit) {
        selected = hit.id; drag = { pointerId: event.pointerId, start: p, original: committed, object: hit, handle: handle && hit.id === handleId ? handle : false, moved: false };
        el.drawingProperties.hidden = false; render(committed);
      } else {
        const id = 'o-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        const object = { id, kind: tool, color: styles.color, width: styles.widths[tool] || .004,
          ...(tool === 'pen' ? { points: [p] } : { a: p, b: p }), ...(tool === 'text' ? { text: '', size: styles.size } : {}) };
        selected = null;
        if (tool === 'text') { editText(object, true); return; }
        drag = { pointerId: event.pointerId, start: p, original: committed, object, creating: true, moved: false }; render(committed);
      }
      try { el.drawingLayer.setPointerCapture?.(event.pointerId); } catch (_) { /* Window still owns pointerup. */ }
    });
    on(el.drawingLayer, 'dblclick', event => {
      if (!editor || tool !== 'text' || composing || !temporaryVisible || exitPromise) return;
      layout(); const hit = model.hitTest(committed, 'text', point(event), geometry);
      if (hit) { finish(); editText(hit); event.preventDefault(); }
    });
    on(win, 'pointermove', event => {
      if (!editor || !temporaryVisible) return;
      const p = point(event); if (!p) return;
      if (!drag) {
        if (tool === 'eraser' && event.target === el.drawingLayer) { eraserPoint = p; render(committed); }
        if (event.target === el.drawingLayer) el.drawingLayer.style.cursor = model.hitTest(committed, tool, p, geometry) ? 'move' : tool === 'text' ? 'text' : 'crosshair';
        return;
      }
      if (event.pointerId !== drag.pointerId) return;
      event.preventDefault();
      if (drag.erasing) {
        eraserPoint = p;
        const last = drag.stroke.points[drag.stroke.points.length - 1];
        if (Math.hypot((p.x - last.x) * geometry.width, (p.y - last.y) * geometry.height) < 1) return;
        if (drag.stroke.points.length >= 512) { finish(); message('这一段擦除已完成，请松手后继续。'); return; }
        drag.stroke.points.push(p);
        try { work = model.erase(drag.original, drag.stroke, drag.geometry); render(work); } catch (e) { finish(); message(e.message); }
        return;
      }
      const moved = Math.hypot((p.x - drag.start.x) * geometry.width, (p.y - drag.start.y) * geometry.height) >= 3;
      if (!drag.moved && !moved) return;
      const firstMove = !drag.moved; drag.moved = true;
      let o = drag.object;
      if (!drag.creating) o = model.transform(o, drag.start, p, drag.handle);
      else if (o.kind === 'pen') {
        const points = work?.find(n => n.id === o.id)?.points || o.points, last = points[points.length - 1];
        if (Math.hypot((p.x - last.x) * geometry.width, (p.y - last.y) * geometry.height) < .5) return;
        if (points.length >= 2048) { finish(); message('这一笔达到长度上限，请分几笔继续。'); return; }
        o = { ...o, points: [...points, p] };
      } else o = { ...o, b: p };
      selected = o.id; work = drag.creating ? [...drag.original, o] : drag.original.map(n => n.id === o.id ? o : n);
      if (firstMove) session()?.touchDrawing(); render(work);
    });
    on(win, 'pointerup', finish); on(win, 'pointercancel', finish); on(win, 'blur', () => finish());
    // Element resizing (including sidebar transitions) does not emit window resize.
    // Relayout only: keep SVG objects, drafts and pointer state intact.
    const layoutObserver = win.ResizeObserver ? new win.ResizeObserver(() => {
      if (!destroyed && snapshot?.drawings && !el.drawingLayer.hidden) layout();
    }) : null;
    layoutObserver?.observe(el.screen); layoutObserver?.observe(el.picture);
    on(el.drawingLayer, 'selectstart', event => event.preventDefault());
    on(el.screen, 'pointerdown', event => {
      if (event.target?.closest?.('input,textarea,[contenteditable]')) return;
      const selection = win.getSelection?.();
      if (selection && (el.drawingLayer.contains?.(selection.anchorNode) || el.drawingLayer.contains?.(selection.focusNode))) selection.removeAllRanges();
    }, true);
    on(win, 'resize', () => { if (snapshot?.drawings && (editor || !el.drawingLayer.hidden)) { finish(); layout(); render(editor ? committed : normalObjects()); } });
    on(el.screen, 'wheel', event => {
      if (!editor || !temporaryVisible || !['editing', 'failed'].includes(draft()?.status) || event.altKey || event.metaKey || !Number.isFinite(event.deltaY) || !event.deltaY) return;
      if (event.target?.closest?.('.drawing-palette,input[type=color]')) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      if (tool === 'eraser') changeStyle('width', eraserWidth + direction * .005);
      else if (tool === 'text') changeStyle('size', Math.max(.01, Math.min(.2, (current()?.size || styles.size) + direction * .002)));
      else changeStyle('width', Math.max(.001, Math.min(.05, (current()?.width || styles.widths[tool]) + direction * .001)));
    }, { passive: false });
    function undo() {
      if (!editor || draft()?.kind === 'delete') return;
      try { flush(); } catch (error) { message(error.message); return; }
      if (!editor.undo()) return;
      committed = editor.snapshot(); selected = null; session()?.setDrawingObjects(committed); render(committed);
    }
    function removeSelected() {
      if (!editor || !selected) return;
      textDraft = null; el.drawingText.hidden = true;
      if (publish(committed.filter(o => o.id !== selected))) selected = null; render(committed);
    }
    on(el.drawingDelete, 'click', removeSelected);
    on(el.drawingTextDelete, 'pointerdown', e => e.preventDefault());
    on(el.drawingTextDelete, 'click', () => { if (!el.drawingTextDelete.disabled) { removeSelected(); el.drawingLayer.focus?.({ preventScroll: true }); } });
    on(el.drawingText, 'input', () => { if (!textDraft) return; if (el.drawingText.value.trim() || !textDraft.fresh) session()?.touchDrawing(); layoutText(); });
    on(el.drawingText, 'compositionstart', () => { composing = true; });
    on(el.drawingText, 'compositionend', () => { composing = false; compositionEnd = now(); if (textDraft && el.drawingText.value.trim()) session()?.touchDrawing(); layoutText(); });
    function begin(id = null, kind = 'edit') { if (!canBegin() || !session()?.beginDrawing) return; session().beginDrawing(id, kind).catch(error => message(error.message)); }
    on(el.drawingNew, 'click', () => begin());
    async function save() {
      if (composing) return false;
      try { flush(); const r = await session()?.saveDrawing(); return r?.status === 'saved' || r?.status === 'cancelled'; }
      catch (error) { message(error.message); return false; }
    }
    on(el.drawingSave, 'click', save);
    function finishExit(result) { const done = exitResolve; exitResolve = null; exitPromise = null; el.drawingExit.hidden = true; if (done) done(result); }
    async function confirmExit(reason = '关闭或载入其他视频') {
      if (exitPromise) return exitPromise;
      try { flush(); } catch (error) { message(error.message); }
      const value = getState().drawings?.draft;
      if (!value) return true;
      if (!value.dirty && !textDraft) return session()?.cancelDrawing() !== false;
      el.drawingExit.hidden = false; el.drawingExitMessage.textContent = '圈画尚未保存。' + reason + '前，请选择如何处理。';
      exitPromise = new Promise(resolve => { exitResolve = resolve; }); el.drawingExitReturn.focus(); return exitPromise;
    }
    on(el.drawingExitSave, 'click', async () => {
      if (await save()) finishExit(true);
      else el.drawingExitMessage.textContent = '保存未完成，圈画仍保留。' + (getState().drawings?.draft?.message || el.drawingMessage.textContent || '请返回编辑检查，或明确放弃修改。');
    });
    on(el.drawingExitDiscard, 'click', () => { if (session()?.cancelDrawing() !== false) finishExit(true); });
    on(el.drawingExitReturn, 'click', () => finishExit(false));
    on(el.drawingCancel, 'click', () => { confirmExit('退出绘图').catch(error => message(error.message)); });
    function toggle() {
      if (editor) { finish(); temporaryVisible = !temporaryVisible; update(snapshot); }
      else session()?.setDrawingsVisible?.(!snapshot?.drawings?.visible);
    }
    on(el.showDrawings, 'change', () => { if (!editor) session()?.setDrawingsVisible?.(el.showDrawings.checked); });
    on(win, 'keydown', event => {
      if (event.key === 'Escape' && menuActive()) return;
      if (destroyed || event.defaultPrevented || event.isComposing || event.keyCode === 229 || composing || now() - compositionEnd < 50) return;
      if (exitPromise) { if (event.key === 'Escape') { event.preventDefault(); finishExit(false); } return; }
      if (isKey(event, 'H')) { if (session()) { event.preventDefault(); toggle(); } return; }
      if (isKey(event, 'D')) { if (!event.repeat && (editor || canBegin())) { event.preventDefault(); if (editor) save(); else begin(); } return; }
      if (!editor || event.repeat || event.altKey || event.metaKey) return;
      const input = event.target?.isContentEditable || event.target?.closest?.('input,textarea,select,[contenteditable]');
      if (event.key === 'Escape') { event.preventDefault(); confirmExit('退出绘图'); return; }
      if ((event.key === 'Enter' || event.code === 'NumpadEnter') && !event.shiftKey && !event.ctrlKey) {
        if (event.target?.closest?.('button,select,input')) return;
        event.preventDefault(); save(); return;
      }
      if (input) return;
      if (event.ctrlKey && !event.shiftKey && String(event.key).toLowerCase() === 'z') { event.preventDefault(); undo(); }
      else if (event.ctrlKey && !event.shiftKey && String(event.key).toLowerCase() === 'y') event.preventDefault();
      else if (!event.ctrlKey && !event.shiftKey && event.key === 'Delete') { event.preventDefault(); removeSelected(); }
    });

    function normalObjects() {
      const found = model.visibleGroups(snapshot?.drawings?.records || [], snapshot?.playback?.time, snapshot?.interactionSettings?.drawingFadeSeconds ?? model.FADE_SECONDS, snapshot?.playback?.frameOrdinal);
      const ids = new Set(found.map(n => n.record.id));
      normalOrder = normalOrder.filter(id => ids.has(id));
      for (const n of found) if (!normalOrder.includes(n.record.id)) normalOrder.push(n.record.id);
      normalGroups = normalOrder.map(id => found.find(n => n.record.id === id));
      return normalGroups.flatMap(n => n.record.objects);
    }
    function update(value) {
      snapshot = value; const state = value.drawings, d = state?.draft;
      if (normalRecords !== state?.records) { normalRecords = state?.records; normalKey = null; }
      if (state?.styles && state.styles !== stylesRef) { stylesRef = state.styles; styles = model.validateStyles(state.styles); }
      const key = d ? value.epoch + ':' + d.id : null;
      if (key !== editorKey) {
        editorKey = key; drag = null; work = null; textDraft = null; selected = null; temporaryVisible = true; editor = null; committed = []; composing = false; normalKey = null;
        if (d && d.status !== 'pausing') { editor = model.createEditor(d.objects); committed = editor.snapshot(); }
        el.drawingText.hidden = true; el.drawingLayer.replaceChildren(); closeProperties();
      } else if (d && !editor && d.status !== 'pausing') { editor = model.createEditor(d.objects); committed = editor.snapshot(); }
      const active = !!d;
      el.drawingPanel.hidden = !active || !value.interactionSettings?.drawingToolbar && d.kind !== 'delete'; el.drawingMessage.hidden = !active; el.showDrawings.checked = state?.visible !== false;
      el.showDrawings.disabled = active || !session(); el.drawingNew.disabled = !canBegin() || state?.status !== 'ready';
      el.drawingStatus.textContent = state?.message || '';
      const shown = active ? temporaryVisible : state?.visible !== false;
      if (active && (!shown || d.kind === 'delete')) closeProperties();
      el.drawingText.hidden = !textDraft || !shown; el.drawingTextDelete.hidden = el.drawingText.hidden;
      el.drawingLayer.style.pointerEvents = active && shown && d.kind !== 'delete' ? 'auto' : 'none';
      const valueObjects = active ? objects() : normalObjects();
      hideLayer(!shown || !active && !valueObjects.length || !['paused', 'playing', 'seeking'].includes(value.state));
      if (active) {
        if (geometry === null || normalKey !== key) { layout(); normalKey = key; }
        message(d.message || (shown ? d.kind === 'delete' ? '确认删除这条圈画标注？' : '右键短点保存 · 甩动/长按选工具 · 滚轮调整 · Esc退出' : '圈画已临时隐藏，按H恢复后继续绘图。'));
        set(el.drawingSave, 'textContent', '✓');
        set(el.drawingSave, 'title', d.status === 'unknown' ? '核对并保存' : d.kind === 'delete' ? '确认清除' : '保存（D）');
        set(el.drawingSave, 'ariaLabel', el.drawingSave.title);
        set(el.drawingSave, 'disabled', !['editing', 'failed', 'unknown'].includes(d.status));
        for (const control of [...Object.values(buttons), el.drawingColorButton, el.drawingOptions, el.drawingColor, el.drawingWidth, el.drawingSize, el.drawingText, el.drawingDelete]) control.disabled = !shown || d.kind === 'delete' || !['editing', 'failed'].includes(d.status);
        // Playback/status notifications do not change the editor's picture.
        // Direct pointer/tool edits still render immediately through render().
        if (!lastRender || lastRender.value !== valueObjects || lastRender.editor !== editor || lastRender.geometry !== geometry ||
            lastRender.selected !== selected || lastRender.tool !== tool || lastRender.textDraft !== textDraft ||
            lastRender.visible !== temporaryVisible || lastRender.kind !== d.kind) render(valueObjects);
        else { properties(); layoutText(); }
      } else {
        const nextKey = value.epoch + ':' + normalGroups.map(n => n.record.id).join('|') + ':' + (state?.visible !== false);
        if (nextKey !== normalKey) { normalKey = nextKey; if (valueObjects.length) layout(); render(valueObjects); }
        else for (const n of normalGroups) groupNodes.get(n.record.id)?.setAttribute('opacity', String(n.opacity));
      }
    }
    function menuState() {
      const d = draft(), editable = !!editor && temporaryVisible && !composing && !exitPromise && ['editing', 'failed'].includes(d?.status) && d?.kind !== 'delete';
      return { enabled: !!editor && !exitPromise && !composing && now() - compositionEnd >= 50 && d?.kind !== 'delete' && ['editing', 'failed', 'unknown'].includes(d?.status),
        tap: 'save', color: current()?.color || styles.color,
        items: [{ id: 'types', label: '类型', symbol: '✎', disabled: !editable,
          children: [['pen','手写','✎'],['arrow','箭头','↗'],['rect','矩形','▭'],['ellipse','椭圆','○'],['text','画面文字','T']].map(([id,label,symbol]) => ({ id, label, symbol, selected: tool === id, disabled: !editable })) },
          { id: 'color', label: '颜色', symbol: '●', disabled: !editable || tool === 'eraser' },
          { id: 'eraser', label: '橡皮', symbol: '◇', selected: tool === 'eraser', disabled: !editable },
          { id: 'undo', label: '撤销', symbol: '↶', disabled: !editable || !editor.canUndo() && !textDraft && !work }] };
    }
    function menuCommand(id, value) {
      const m = menuState(); if (!m.enabled) return;
      if (id === 'save') return save();
      const item = m.items.flatMap(n => [n, ...(n.children || [])]).find(n => n.id === id); if (!item || item.disabled) return;
      if (model.KINDS.includes(id) || id === 'eraser') chooseTool(id);
      else if (id === 'color' && typeof value === 'string') changeStyle('color', value);
      else if (id === 'undo') undo();
    }
    return { update, begin, confirmExit, flush, menuState, menuCommand,
      destroy() { destroyed = true; layoutObserver?.disconnect(); listeners.forEach(([n, t, f, o]) => n.removeEventListener(t, f, o)); if (exitResolve) finishExit(false); },
      reset() { editorKey = null; editor = null; committed = []; drag = null; work = null; textDraft = null; normalKey = null; normalOrder = []; normalGroups = []; groupNodes.clear(); if (exitResolve) finishExit(false); } };
  }
  return { createDrawingUI };
});
