/* Independent transparent editor. Operations go through Session only. */
(function (root, factory) {
  const view = typeof window === 'object' ? window : null;
  const api = factory(view ? view.EVADrawingModel : require('./drawing-model.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (view) view.EVADrawingUI = api;
})(typeof globalThis === 'object' ? globalThis : this, function (model) {
  'use strict';
  function createDrawingUI({ document: doc, window: win, getSession, getState, canBegin, isKey }) {
    const ids = ['screen', 'picture', 'drawingLayer', 'drawingPanel', 'drawingTool', 'drawingColor', 'drawingWidth', 'drawingSize',
      'drawingText', 'drawingUndo', 'drawingRedo', 'drawingDelete', 'drawingSave', 'drawingCancel', 'drawingMessage', 'drawingNew',
      'showDrawings', 'drawingStatus', 'drawingExit', 'drawingExitMessage', 'drawingExitSave', 'drawingExitDiscard', 'drawingExitReturn'];
    const el = Object.fromEntries(ids.map(id => [id, doc.getElementById(id)]));
    if (ids.some(id => !el[id])) throw Error('圈画界面缺少必要元素。');
    const listeners = [], on = (node, type, fn, options) => { node.addEventListener(type, fn, options); listeners.push([node, type, fn, options]); };
    let editor = null, editorKey = null, selected = null, drag = null, work = null, temporaryVisible = true;
    let snapshot = null, geometry = null, width = 1280, height = 720, normalKey = null;
    let composing = false, compositionEnd = -Infinity, exitResolve = null, exitPromise = null, destroyed = false;
    const session = () => getSession();
    const draft = () => snapshot?.drawings?.draft;
    const set = (node, key, value) => { if (node[key] !== value) node[key] = value; };
    const now = () => win.performance && typeof win.performance.now === 'function' ? win.performance.now() : Date.now();
    function hideLayer(hidden) {
      // SVGElement has no reflected HTMLElement.hidden property in Chromium.
      el.drawingLayer.hidden = hidden;
      if (hidden) el.drawingLayer.setAttribute('hidden', '');
      else el.drawingLayer.removeAttribute?.('hidden');
    }
    function node(tag, attrs = {}) {
      const n = doc.createElementNS ? doc.createElementNS('http://www.w3.org/2000/svg', tag) : doc.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value)); return n;
    }
    function layout() {
      const canvas = el.picture.getBoundingClientRect(), screen = el.screen.getBoundingClientRect();
      width = Number(el.picture.width) || 1280; height = Number(el.picture.height) || 720;
      geometry = model.imageRect(canvas, width, height); if (!geometry) return;
      Object.assign(el.drawingLayer.style, { left: geometry.left - screen.left + 'px', top: geometry.top - screen.top + 'px', width: geometry.width + 'px', height: geometry.height + 'px' });
      el.drawingLayer.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    }
    function point(event) { return geometry ? { x: Math.max(0, Math.min(1, (event.clientX - geometry.left) / geometry.width)), y: Math.max(0, Math.min(1, (event.clientY - geometry.top) / geometry.height)) } : null; }
    const allObjects = () => work || editor && editor.snapshot() || [];
    function message(text) { set(el.drawingMessage, 'textContent', text); }
    function render(objects) {
      const nodes = [], scale = Math.min(width, height);
      for (const o of objects) {
        const g = node('g', { 'data-object-id': o.id, fill: 'none', stroke: o.color, 'stroke-width': o.width * scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        const box = model.bounds(o), x = o.a?.x * width, y = o.a?.y * height, x2 = o.b?.x * width, y2 = o.b?.y * height;
        if (o.kind === 'pen') {
          if (o.points.length === 1) g.appendChild(node('circle', { cx: o.points[0].x * width, cy: o.points[0].y * height, r: o.width * scale / 2, fill: o.color }));
          else g.appendChild(node('polyline', { points: o.points.map(p => p.x * width + ',' + p.y * height).join(' ') }));
        }
        if (o.kind === 'rect') g.appendChild(node('rect', { x: Math.min(x, x2), y: Math.min(y, y2), width: Math.max(1, Math.abs(x2 - x)), height: Math.max(1, Math.abs(y2 - y)) }));
        if (o.kind === 'ellipse') g.appendChild(node('ellipse', { cx: (x + x2) / 2, cy: (y + y2) / 2, rx: Math.max(1, Math.abs(x2 - x) / 2), ry: Math.max(1, Math.abs(y2 - y) / 2) }));
        if (o.kind === 'arrow') {
          const angle = Math.atan2(y2 - y, x2 - x), size = Math.max(12, o.width * scale * 5);
          g.appendChild(node('line', { x1: x, y1: y, x2, y2 }));
          g.appendChild(node('polyline', { points: [x2 - Math.cos(angle - .45) * size, y2 - Math.sin(angle - .45) * size, x2, y2, x2 - Math.cos(angle + .45) * size, y2 - Math.sin(angle + .45) * size].reduce((a, v, i, xs) => i % 2 ? a : a.concat(v + ',' + xs[i + 1]), []).join(' ') }));
        }
        if (o.kind === 'text') {
          const text = node('text', { x, y, fill: o.color, stroke: 'none', 'font-size': o.size * scale, 'font-family': 'Segoe UI, Microsoft YaHei UI, sans-serif', 'dominant-baseline': 'hanging' });
          o.text.split('\n').forEach((line, i) => { const span = node('tspan', { x, dy: i ? o.size * scale * 1.25 : 0 }); span.textContent = line || ' '; text.appendChild(span); }); g.appendChild(text);
        }
        nodes.push(g);
        if (editor && selected === o.id) {
          const w = Math.max(.015, box.right - box.x) * width, h = Math.max(.015, box.bottom - box.y) * height;
          const rect = node('rect', { x: box.x * width, y: box.y * height, width: w, height: h, fill: 'transparent', stroke: '#ffffff', 'stroke-width': Math.max(1, scale * .001), 'stroke-dasharray': '5 4', 'data-object-id': o.id });
          nodes.push(rect, node('rect', { x: box.x * width + w - 5, y: box.y * height + h - 5, width: 10, height: 10, fill: '#ffffff', stroke: '#222222', 'data-object-id': o.id, 'data-resize': 'true' }));
        }
      }
      el.drawingLayer.replaceChildren(...nodes);
      set(el.drawingUndo, 'disabled', !editor || !editor.canUndo()); set(el.drawingRedo, 'disabled', !editor || !editor.canRedo());
      set(el.drawingDelete, 'disabled', !editor || !selected);
    }
    function publish(next) {
      try { if (!editor.replace(next)) { session()?.setDrawingObjects(editor.snapshot()); render(editor.snapshot()); return; }
        session()?.setDrawingObjects(editor.snapshot()); render(editor.snapshot()); }
      catch (error) { work = null; message(error.message); render(editor.snapshot()); }
    }
    function syncText() {
      if (!editor || !selected) return;
      const objects = editor.snapshot(), o = objects.find(n => n.id === selected);
      if (!o || o.kind !== 'text') return;
      if (!el.drawingText.value.trim()) throw Error('画面文字不能为空；可删除该文字对象。');
      if (o.text !== el.drawingText.value) {
        const text = el.drawingText.value, lines = text.split('\n'), size = o.size * Math.min(width, height);
        const b = { x: Math.min(1, o.a.x + Math.max(...lines.map(line => [...line].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1 : .6), 0))) * size / width),
          y: Math.min(1, o.a.y + lines.length * size * 1.25 / height) };
        publish(objects.map(n => n.id === selected ? { ...n, text, b } : n));
      }
    }
    function finish(event = null) {
      if (!drag || event && event.pointerId !== drag.pointerId) return;
      const pointer = drag.pointerId, next = work; drag = null; work = null;
      try { if (el.drawingLayer.hasPointerCapture?.(pointer)) el.drawingLayer.releasePointerCapture(pointer); } catch (_) { /* Cancelled host pointer. */ }
      if (next) publish(next);
    }
    function flush() { finish(); syncText(); }
    on(el.drawingLayer, 'pointerdown', event => {
      if (!editor || draft()?.status === 'pausing' || draft()?.kind === 'delete' || !temporaryVisible || event.button !== 0 || exitPromise) return;
      layout(); const p = point(event); if (!p) return; event.preventDefault();
      el.drawingLayer.focus?.({ preventScroll: true });
      const target = event.target.closest?.('[data-object-id]'), objects = editor.snapshot();
      if (el.drawingTool.value === 'select') {
        selected = target && target.getAttribute('data-object-id');
        const object = objects.find(o => o.id === selected);
        if (object) { drag = { pointerId: event.pointerId, start: p, original: objects, object, resize: event.target.getAttribute?.('data-resize') === 'true' };
          set(el.drawingText, 'hidden', object.kind !== 'text'); if (object.kind === 'text') el.drawingText.value = object.text; }
        render(objects);
      } else {
        const kind = el.drawingTool.value, id = 'o-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        const object = { id, kind, color: el.drawingColor.value, width: Number(el.drawingWidth.value) || .004,
          ...(kind === 'pen' ? { points: [p] } : { a: p, b: p }), ...(kind === 'text' ? { text: '文字', size: Number(el.drawingSize.value) || .04,
            b: { x: Math.min(1, p.x + .15), y: Math.min(1, p.y + .08) } } : {}) };
        selected = id;
        if (kind === 'text') { publish([...objects, object]); el.drawingText.hidden = false; el.drawingText.value = object.text; el.drawingText.focus(); el.drawingText.select?.(); return; }
        drag = { pointerId: event.pointerId, start: p, original: objects, object, creating: true };
        work = [...objects, object]; render(work);
      }
      if (drag) { session()?.touchDrawing(); try { el.drawingLayer.setPointerCapture?.(event.pointerId); } catch (_) { /* Window still owns pointerup. */ } }
    });
    on(win, 'pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId || !temporaryVisible) return;
      event.preventDefault(); const p = point(event); if (!p) return;
      let o = drag.object;
      if (!drag.creating) o = model.transform(o, drag.start, p, drag.resize);
      else if (o.kind === 'pen') {
        const points = work?.find(n => n.id === o.id)?.points || o.points, last = points[points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) < .0008) return;
        if (points.length >= 2048) { finish(); message('这一笔达到长度上限，请分几笔继续。'); return; }
        o = { ...o, points: [...points, p] };
      } else o = { ...o, b: p };
      work = drag.creating ? [...drag.original, o] : drag.original.map(n => n.id === o.id ? o : n); render(work);
    });
    on(win, 'pointerup', finish); on(win, 'pointercancel', finish); on(win, 'blur', () => finish());
    on(win, 'resize', () => { if (snapshot?.drawings && (editor || !el.drawingLayer.hidden)) { finish(); layout(); render(editor ? editor.snapshot() : normalObjects()); } });
    function history(kind) { if (!editor || draft()?.kind === 'delete' || !editor[kind]()) return; selected = null; session()?.setDrawingObjects(editor.snapshot()); render(editor.snapshot()); }
    on(el.drawingUndo, 'click', () => history('undo')); on(el.drawingRedo, 'click', () => history('redo'));
    function removeSelected() { if (!editor || !selected) return; publish(editor.snapshot().filter(o => o.id !== selected)); selected = null; el.drawingText.hidden = true; render(editor.snapshot()); }
    on(el.drawingDelete, 'click', removeSelected);
    on(el.drawingTool, 'change', () => { finish(); selected = null; el.drawingText.hidden = el.drawingTool.value !== 'text'; render(editor ? editor.snapshot() : []); });
    for (const [control, field] of [[el.drawingColor, 'color'], [el.drawingWidth, 'width'], [el.drawingSize, 'size']]) on(control, 'change', () => {
      if (!editor || !selected) return;
      publish(editor.snapshot().map(o => o.id !== selected || field === 'size' && o.kind !== 'text' ? o : { ...o, [field]: field === 'color' ? control.value : Number(control.value) }));
    });
    on(el.drawingText, 'input', () => { if (composing) return; session()?.touchDrawing(); try { syncText(); } catch (error) { message(error.message); } });
    on(el.drawingText, 'compositionstart', () => { composing = true; });
    on(el.drawingText, 'compositionend', () => { composing = false; compositionEnd = now(); session()?.touchDrawing(); try { syncText(); } catch (error) { message(error.message); } });
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
      if (!value.dirty) return session()?.cancelDrawing() !== false;
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
      if (destroyed || event.defaultPrevented || event.isComposing || event.keyCode === 229 || composing || now() - compositionEnd < 50) return;
      if (exitPromise) { if (event.key === 'Escape') { event.preventDefault(); finishExit(false); } return; }
      const toolChoice = editor && event.target?.closest?.('select') && el.drawingPanel.contains?.(event.target);
      const hKey = isKey(event, 'H') || toolChoice && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey && !event.repeat && (event.code === 'KeyH' || String(event.key).toLowerCase() === 'h');
      if (hKey) { if (session()) { event.preventDefault(); toggle(); } return; }
      if (isKey(event, 'D')) { if (!editor && canBegin()) { event.preventDefault(); begin(); } return; }
      if (!editor || event.repeat || event.altKey || event.metaKey) return;
      const input = event.target?.isContentEditable || event.target?.closest?.('input,textarea,select,[contenteditable]');
      if (event.key === 'Escape') { event.preventDefault(); confirmExit('退出绘图'); return; }
      if ((event.key === 'Enter' || event.code === 'NumpadEnter') && !event.shiftKey && !event.ctrlKey) {
        if (event.target?.closest?.('button,select,input')) return;
        event.preventDefault(); save(); return;
      }
      if (input) return;
      if (event.ctrlKey && !event.shiftKey && ['z', 'y'].includes(String(event.key).toLowerCase())) { event.preventDefault(); finish(); history(String(event.key).toLowerCase() === 'z' ? 'undo' : 'redo'); }
      else if (!event.ctrlKey && !event.shiftKey && event.key === 'Delete') { event.preventDefault(); removeSelected(); }
    });
    function normalObjects() {
      const p = snapshot?.playback;
      return snapshot?.drawings?.records?.filter(n => n.frameOrdinal === p?.frameOrdinal && n.frameId === p?.frameId && Math.abs(n.time - p.time) < .000001).flatMap(n => n.objects) || [];
    }
    function update(value) {
      snapshot = value; const state = value.drawings, current = state?.draft;
      const key = current ? value.epoch + ':' + current.id : null;
      if (key !== editorKey) {
        editorKey = key; drag = null; work = null; selected = null; temporaryVisible = true; editor = null; composing = false; normalKey = null;
        if (current && current.status !== 'pausing') editor = model.createEditor(current.objects);
        el.drawingText.hidden = true; el.drawingLayer.replaceChildren();
      } else if (current && !editor && current.status !== 'pausing') editor = model.createEditor(current.objects);
      const active = !!current;
      el.drawingPanel.hidden = !active; el.showDrawings.checked = state?.visible !== false;
      el.showDrawings.disabled = active || !session();
      el.drawingNew.disabled = !canBegin() || state?.status !== 'ready';
      el.drawingStatus.textContent = state?.message || '';
      const shown = active ? temporaryVisible : state?.visible !== false;
      el.drawingLayer.style.pointerEvents = active && shown && current.kind !== 'delete' ? 'auto' : 'none';
      const objects = active ? allObjects() : normalObjects();
      hideLayer(!shown || !active && !objects.length || !['paused', 'playing', 'seeking'].includes(value.state));
      if (active) {
        if (geometry === null || normalKey !== key) { layout(); normalKey = key; }
        message(current.message || (shown ? current.kind === 'delete' ? '确认整条删除圈画；原始视频不变。' : '固定当前帧 · Enter保存 · Esc退出 · H对照原图' : '圈画已临时隐藏，按H恢复后继续绘图。'));
        set(el.drawingSave, 'textContent', current.kind === 'delete' ? '确认删除' : '保存（Enter）');
        set(el.drawingSave, 'disabled', !['editing', 'failed'].includes(current.status));
        for (const control of [el.drawingTool, el.drawingColor, el.drawingWidth, el.drawingSize, el.drawingText]) control.disabled = !shown || current.kind === 'delete' || current.status === 'pausing';
        render(objects);
      } else {
        const nextKey = objects.map(o => o.id).join('|') + ':' + (state?.visible !== false);
        if (nextKey !== normalKey) { normalKey = nextKey; if (objects.length) layout(); render(objects); }
      }
    }
    return { update, begin, confirmExit, flush,
      destroy() { destroyed = true; listeners.forEach(([n, t, f, o]) => n.removeEventListener(t, f, o)); if (exitResolve) finishExit(false); },
      reset() { editorKey = null; editor = null; drag = null; work = null; normalKey = null; if (exitResolve) finishExit(false); } };
  }
  return { createDrawingUI };
});
