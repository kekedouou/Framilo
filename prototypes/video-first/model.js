(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VFModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const coordinate = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const objectTypes = ['pen', 'arrow', 'rect', 'ellipse', 'text'];

  function createModel() {
    const pen = { type: 'pen', color: '#f0bd70', width: .003, points: [{ x: .34, y: .48 }, { x: .42, y: .39 }, { x: .5, y: .44 }] };
    const state = {
      frame: 56, count: 240, playing: false, rate: 1, mode: 'watch', recordsOpen: false, settingsOpen: false, selectedId: null,
      records: [
        { id: 'record-16', frame: 16, entries: [{ id: 'entry-16', text: '起手的重心变化' }], objects: [] },
        { id: 'record-56', frame: 56, entries: [{ id: 'entry-56-a', text: '能量聚拢，轮廓开始收紧' }, { id: 'entry-56-b', text: '留意外沿小粒子的运动方向' }], objects: [pen] },
        { id: 'record-90', frame: 90, entries: [{ id: 'entry-90', text: '爆发前的短暂停顿' }], objects: [{ type: 'ellipse', color: '#f0bd70', width: .003, x: .34, y: .28, x2: .65, y2: .64 }] },
        { id: 'record-126', frame: 126, entries: [{ id: 'entry-126', text: '主冲击与外围烟尘的时间差' }], objects: [{ type: 'arrow', color: '#a8c7e0', width: .004, x: .35, y: .65, x2: .61, y2: .42 }] },
        { id: 'record-176', frame: 176, entries: [{ id: 'entry-176', text: '余光逐渐消散' }], objects: [] },
        { id: 'record-211', frame: 211, entries: [], objects: [{ type: 'rect', color: '#dfb690', width: .003, x: .52, y: .52, x2: .71, y2: .73 }] }
      ],
      loop: { start: null, end: null, enabled: false }, selection: null, draft: null, message: ''
    };
    let serial = 0, carry = 0, context = null;
    const frameNumber = value => Number.isFinite(value) ? Math.max(0, Math.min(state.count - 1, Math.round(value))) : null;
    const watch = () => state.mode === 'watch' && !state.settingsOpen;
    const stop = () => { state.playing = false; carry = 0; };
    const recordAt = frame => state.records.find(record => record.frame === frame);
    const currentRecord = () => context && state.records.find(record => record.id === context.recordId);
    const editable = () => state.mode === 'annotation' && state.draft && state.draft.status !== 'unknown';

    function togglePlay() {
      if (!watch()) return false;
      state.message = '';
      if (state.playing) stop();
      else {
        if (state.loop.enabled && validLoop() && (state.frame < state.loop.start || state.frame > state.loop.end)) state.frame = state.loop.start;
        else if (state.frame === state.count - 1) state.frame = 0;
        carry = 0; state.playing = true;
      }
      return true;
    }
    function seek(frame) {
      const value = frameNumber(frame);
      if (!watch() || value === null) return false;
      stop(); state.frame = value; state.message = ''; return true;
    }
    function validLoop() { return Number.isInteger(state.loop.start) && Number.isInteger(state.loop.end) && state.loop.start < state.loop.end; }
    function tick(seconds) {
      if (!state.playing || !watch() || !Number.isFinite(seconds) || seconds <= 0) return false;
      const amount = carry + seconds * 24 * Math.max(.1, Math.min(4, Number.isFinite(state.rate) ? state.rate : 1));
      const steps = Math.floor(amount + 1e-9); carry = amount - steps;
      if (!steps) return false;
      if (state.loop.enabled && validLoop()) {
        const span = state.loop.end - state.loop.start + 1;
        const initial = state.frame < state.loop.start || state.frame > state.loop.end ? state.loop.start : state.frame;
        state.frame = state.loop.start + (initial - state.loop.start + steps) % span;
      } else {
        state.frame = Math.min(state.count - 1, state.frame + steps);
        if (state.frame === state.count - 1) stop();
      }
      return true;
    }
    function toggleRecords() {
      if (!watch()) return false;
      state.recordsOpen = !state.recordsOpen; return true;
    }
    function selectRecord(id) {
      const record = state.records.find(item => item.id === id);
      if (!watch() || !record) return false;
      stop(); state.frame = record.frame; state.selectedId = id; state.recordsOpen = true; state.message = ''; return true;
    }
    function openSettings() {
      if (state.mode !== 'watch') return false;
      stop(); state.settingsOpen = true; state.message = ''; return true;
    }
    function closeSettings() {
      if (!state.settingsOpen) return false;
      state.settingsOpen = false; stop(); return true;
    }
    function beginAnnotation(recordId, entryId) {
      if (!watch()) return false;
      const record = recordId ? state.records.find(item => item.id === recordId) : recordAt(state.frame);
      if (recordId && !record || entryId && !record?.entries.some(item => item.id === entryId)) return false;
      stop(); if (record) state.frame = record.frame;
      const entries = record ? record.entries : [];
      const chosen = entryId ? entries.find(item => item.id === entryId) : entries.length === 1 ? entries[0] : null;
      context = { recordId: record?.id || 'new-record-' + (++serial), baseObjects: copy(record?.objects || []), texts: Object.create(null), unassigned: '', newEntryId: null, undo: [], erase: null, pending: null };
      for (const entry of entries) context.texts[entry.id] = { original: entry.text, current: entry.text };
      state.draft = {
        frame: state.frame, recordId: record?.id || null, entryId: chosen?.id || null, text: chosen?.text || '',
        objects: copy(record?.objects || []), status: 'editing', message: '', restoreRecords: state.recordsOpen,
        entryChoices: entries.length > 1 ? copy(entries) : []
      };
      state.mode = 'annotation'; state.message = ''; return true;
    }
    function refreshChoices() {
      if (state.draft.entryChoices.length) state.draft.entryChoices = state.draft.entryChoices.map(entry => ({ id: entry.id, text: context.texts[entry.id].current }));
    }
    function chooseEntry(id) {
      if (!editable() || !context.texts[id]) return false;
      const d = state.draft;
      if (d.entryId) context.texts[d.entryId].current = d.text;
      else if (d.text) context.unassigned = d.text;
      d.entryId = id;
      if (context.unassigned) { context.texts[id].current = context.unassigned; context.unassigned = ''; }
      d.text = context.texts[id].current; d.status = 'editing'; d.message = ''; refreshChoices(); return true;
    }
    function updateText(text) {
      if (!editable() || typeof text !== 'string') return false;
      const d = state.draft; d.text = text.slice(0, 4096);
      if (d.entryId) context.texts[d.entryId].current = d.text;
      else context.unassigned = d.text;
      d.status = 'editing'; d.message = ''; refreshChoices(); return true;
    }
    function normalizeObject(value) {
      if (!value || !objectTypes.includes(value.type)) return null;
      const result = {
        type: value.type, color: /^#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?$/i.test(value.color || '') ? value.color : '#f0bd70',
        width: Math.max(.001, Math.min(.05, Number.isFinite(value.width) ? value.width : .003))
      };
      if (value.type === 'pen') {
        if (!Array.isArray(value.points) || !value.points.length) return null;
        result.points = value.points.slice(0, 2048).map(point => ({ x: coordinate(point?.x), y: coordinate(point?.y) }));
      } else {
        result.x = coordinate(value.x); result.y = coordinate(value.y); result.x2 = coordinate(value.x2); result.y2 = coordinate(value.y2);
        if (value.type === 'text') { result.text = String(value.text || '').slice(0, 4096); if (!result.text.trim()) return null; }
      }
      return result;
    }
    function replaceObjects(objects, remember = true) {
      if (remember) { context.undo.push(copy(state.draft.objects)); if (context.undo.length > 40) context.undo.shift(); }
      state.draft.objects = objects; state.draft.status = 'editing'; state.draft.message = ''; return true;
    }
    function addObject(object) {
      if (!editable() || state.draft.objects.length >= 128) return false;
      const value = normalizeObject(object); if (!value) return false;
      endErase(); return replaceObjects([...state.draft.objects, value]);
    }
    function undoObject() {
      if (!editable() || !context.undo.length) return false;
      endErase();
      state.draft.objects = context.undo.pop(); state.draft.status = 'editing'; state.draft.message = ''; return true;
    }
    function beginErase() {
      if (!editable() || context.erase) return false;
      context.erase = { remembered:false }; return true;
    }
    function endErase() {
      if (!context?.erase) return false;
      context.erase = null; return true;
    }
    function distanceToSegment(x, y, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const ratio = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
      return Math.hypot(x - a.x - ratio * dx, y - a.y - ratio * dy);
    }
    function hit(object, x, y, radius) {
      const r = radius + object.width / 2;
      if (object.type === 'pen') return object.points.some((point, index, points) => distanceToSegment(x, y, point, points[Math.max(0, index - 1)]) <= r);
      const a = { x: object.x, y: object.y }, b = { x: object.x2, y: object.y2 };
      if (object.type === 'arrow') return distanceToSegment(x, y, a, b) <= r;
      return x >= Math.min(a.x, b.x) - r && x <= Math.max(a.x, b.x) + r && y >= Math.min(a.y, b.y) - r && y <= Math.max(a.y, b.y) + r;
    }
    function eraseAt(x, y, radius = .025) {
      if (!editable() || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) return false;
      const remaining = state.draft.objects.filter(object => !hit(object, x, y, Math.min(.25, radius)));
      if (remaining.length === state.draft.objects.length) return false;
      const remember = !context.erase || !context.erase.remembered;
      if (context.erase) context.erase.remembered = true;
      return replaceObjects(remaining,remember);
    }
    function plan() {
      const d = state.draft, existing = currentRecord();
      const entries = copy(existing?.entries || []);
      for (const id of Object.keys(context.texts)) {
        const value = context.texts[id], text = value.current.trim() ? value.current : value.original;
        const entry = entries.find(item => item.id === id); if (entry) entry.text = text;
      }
      if (!Object.keys(context.texts).length && d.text.trim()) {
        if (!context.newEntryId) context.newEntryId = 'new-entry-' + (++serial);
        const entry = entries.find(item => item.id === context.newEntryId);
        if (entry) entry.text = d.text; else entries.push({ id: context.newEntryId, text: d.text });
      }
      return { id: context.recordId, frame: d.frame, entries, objects: copy(d.objects) };
    }
    function commitText(proposal) {
      let record = currentRecord();
      if (!record && proposal.entries.length) {
        record = { id: proposal.id, frame: proposal.frame, entries: [], objects: [] }; state.records.push(record);
      }
      if (record) { record.entries = copy(proposal.entries); state.draft.recordId = record.id; }
      for (const id of Object.keys(context.texts)) {
        const saved = proposal.entries.find(item => item.id === id); if (saved) context.texts[id].original = saved.text;
      }
      if (!Object.keys(context.texts).length && proposal.entries.length) context.committedNewText = proposal.entries[0].text;
      state.records.sort((a, b) => a.frame - b.frame);
    }
    function commitObjects(proposal) {
      let record = currentRecord();
      if (!record && (proposal.entries.length || proposal.objects.length)) {
        record = { id: proposal.id, frame: proposal.frame, entries: copy(proposal.entries), objects: [] }; state.records.push(record);
      }
      if (record) { record.objects = copy(proposal.objects); state.selectedId = record.id; }
      state.records.sort((a, b) => a.frame - b.frame);
    }
    function exitDraft(message) {
      const restore = state.draft.restoreRecords;
      state.draft = null; context = null; state.mode = 'watch'; state.recordsOpen = restore; state.message = message; stop();
    }
    function saveDraft(fault = 'none') {
      if (!state.draft || state.mode !== 'annotation') return 'ignored';
      const d = state.draft;
      if (d.status === 'unknown') { d.message = '保存结果尚未确认，请先核对。'; return 'unknown'; }
      endErase();
      if (d.entryChoices.length > 1 && !d.entryId && d.text.trim()) { d.message = '请选择这段文字对应的已有记录。'; return 'choose'; }
      const proposal = plan();
      if (!proposal.entries.length && !proposal.objects.length && !currentRecord()) { exitDraft(''); return 'cancelled'; }
      if (fault === 'failed') { d.status = 'failed'; d.message = '模拟保存失败，文字和圈画草稿仍保留。'; return 'failed'; }
      if (fault === 'unknown') { context.pending = proposal; d.status = 'unknown'; d.message = '保存结果未知，请核对；不要重复提交。'; return 'unknown'; }
      commitText(proposal);
      if (fault === 'partial') { d.status = 'partial'; d.message = '文字已保存，圈画尚未保存；重试会继续完成圈画。'; return 'partial'; }
      commitObjects(proposal); exitDraft('标注已保存'); return 'saved';
    }
    function checkDraft() {
      if (!state.draft || state.draft.status !== 'unknown' || !context?.pending) return 'ignored';
      const proposal = context.pending; commitText(proposal); commitObjects(proposal); exitDraft('已核对并完成保存'); return 'saved';
    }
    function dirty() {
      const d = state.draft;
      if (!same(d.objects, context.baseObjects)) return true;
      if (!Object.keys(context.texts).length) return d.text !== (context.committedNewText || '');
      if (!d.entryId && d.text) return true;
      return Object.values(context.texts).some(value => value.current !== value.original);
    }
    function cancelDraft(force = false) {
      if (!state.draft) return 'ignored';
      if (state.draft.status === 'unknown') { state.draft.message = '保存结果未知，请先核对，不能丢弃已发出的操作。'; return 'blocked'; }
      if (!force && dirty()) return 'confirm';
      const partial = state.draft.status === 'partial' || !!context.committedNewText;
      exitDraft(partial ? '已退出；先前确认保存的文字仍保留。' : ''); return 'cancelled';
    }
    function beginSelection() {
      if (!watch()) return false;
      stop(); state.mode = 'selection'; state.message = '';
      state.selection = { start: state.loop.start, end: state.loop.end, active: state.loop.start === null ? 'start' : 'end', restoreLoop: copy(state.loop) }; return true;
    }
    function setEndpoint(frame, which) {
      const d = state.selection, value = frameNumber(frame);
      if (state.mode !== 'selection' || !d || value === null) return false;
      const point = which || d.active || (d.start === null ? 'start' : 'end');
      if (!['start', 'end'].includes(point)) return false;
      d[point] = point === 'start' ? Math.min(value, d.end ?? state.count - 1) : Math.max(value, d.start ?? 0);
      d.active = point; state.frame = d[point]; state.message = ''; return true;
    }
    function controlEndpoint(which) {
      if (!state.selection || !['start', 'end'].includes(which)) return false;
      state.selection.active = which; if (state.selection[which] !== null) state.frame = state.selection[which]; return true;
    }
    function finishSelection() {
      const d = state.selection; if (!d) return 'ignored';
      if (d.start === null || d.end === null) { cancelSelection(); return 'cancelled'; }
      if (d.start === d.end) { Object.assign(state.loop, { start: null, end: null, enabled: false }); state.selection = null; state.mode = 'watch'; stop(); state.message = ''; return 'cleared'; }
      Object.assign(state.loop, { start: d.start, end: d.end, enabled: true });
      state.selection = null; state.mode = 'watch'; state.frame = state.loop.start; carry = 0; state.playing = true; state.message = ''; return 'saved';
    }
    function cancelSelection() {
      if (!state.selection) return false;
      Object.assign(state.loop, state.selection.restoreLoop); state.selection = null; state.mode = 'watch'; state.message = ''; stop(); return true;
    }
    function toggleLoop() {
      if (!watch()) return false;
      if (!validLoop()) { state.message = '请先选择循环片段'; return false; }
      state.loop.enabled = !state.loop.enabled; state.message = '';
      if (state.loop.enabled) { if (state.frame < state.loop.start || state.frame > state.loop.end) state.frame = state.loop.start; state.playing = true; carry = 0; }
      return true;
    }
    return { state, togglePlay, seek, tick, toggleRecords, selectRecord, openSettings, closeSettings,
      beginAnnotation, chooseEntry, updateText, addObject, undoObject, beginErase, endErase, eraseAt, saveDraft, checkDraft, cancelDraft,
      beginSelection, setEndpoint, controlEndpoint, finishSelection, cancelSelection, toggleLoop };
  }
  return { createModel };
});
