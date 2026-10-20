'use strict';
// Annotation state only. Persistence is injected; no SDK, filesystem or DOM.
const { randomUUID } = require('crypto');
const { validate, defaultStyles, validateStyles } = require('./drawing-model.js');
function createDrawingSession({ store, onChange = () => {} } = {}) {
  let binding = null, document = { records: [], token: null }, records = Object.freeze([]), draft = null;
  let status = store ? 'idle' : 'disabled', message = '', visible = true, preferenceToken = null;
  let listKey = null, merged = null, serial = 0;
  let styles = Object.freeze(defaultStyles()), stylesToken = null, stylesReadError = '';
  const notify = () => { onChange(); };
  if (store) try { const p = store.readVisibility(); visible = p.visible; preferenceToken = p.token; } catch (error) { message = '显隐设置未读取：' + error.message; }
  if (store?.readStyles) try { const p = store.readStyles(); styles = Object.freeze(validateStyles(p.styles)); stylesToken = p.token; } catch (error) { stylesReadError = '工具设置未读取：' + error.message; }
  function refreshRecords() { records = Object.freeze(document.records.filter(n => n.sourceSha256 === binding.sourceSha256).map(n => Object.freeze(n))); listKey = null; }
  function open(next) {
    if (!store) return;
    if (draft) throw Error('请先保存或取消圈画。');
    binding = Object.freeze({ ...next }); status = 'ready'; message = '';
    try { document = store.read(binding); refreshRecords();
      if (document.records.some(n => n.sourceSha256 !== binding.sourceSha256)) message = '源视频内容曾改变，旧圈画已保留，不会套到新画面。';
    } catch (error) { status = 'error'; message = '圈画未载入：' + error.message; records = Object.freeze([]); }
    notify();
  }
  function list(native = []) {
    if (!records.length) return native;
    if (listKey === native && merged) return merged;
    const used = new Set(), result = native.map(item => {
      const note = records.find(n => n.nativeId === item.id && Math.abs(n.nativeTime - item.time) < .000001);
      if (!note) return item;
      used.add(note.id); return Object.freeze({ ...item, time: note.time, drawingId: note.id, drawingFrameId: note.frameId, drawingFrameOrdinal: note.frameOrdinal });
    });
    for (const n of records) if (!used.has(n.id)) result.push(Object.freeze({ id: 'drawing:' + n.id, time: n.time,
      text: n.nativeId ? '圈画（关联文字已删除或时间改变）' : '画面圈画', drawingId: n.id, localDrawing: true,
      drawingFrameId: n.frameId, drawingFrameOrdinal: n.frameOrdinal }));
    merged = Object.freeze(result.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))); listKey = native; return merged;
  }
  function resolve(id, native) {
    if (!id) return { note: null, nativeId: null };
    const row = list(native).find(n => n.id === id); if (!row) throw Error('标注条目已变化，请重新选择。');
    return { note: records.find(n => n.id === row.drawingId) || null, nativeId: row.localDrawing ? null : row.id, row };
  }
  function reserve() {
    if (status !== 'ready' || draft || !binding) return null;
    draft = Object.freeze({ id: ++serial, status: 'pausing', dirty: false, objects: [], message: '正在固定源帧…' }); notify(); return draft.id;
  }
  function begin(id, frame, target, kind = 'edit') {
    if (!draft || draft.id !== id) return false;
    const note = target.note;
    if (note && (note.frameId !== frame.frameId || note.frameOrdinal !== frame.frameOrdinal || Math.abs(note.time - frame.time) > .000001)) throw Error('圈画对应的源帧不一致，未覆盖原内容。');
    const objects = note ? validate(note.objects) : [];
    draft = Object.freeze({ id, status: 'editing', kind, dirty: false, noteId: note ? note.id : randomUUID(),
      nativeId: note ? note.nativeId : target.nativeId, nativeTime: note ? note.nativeTime : target.nativeId ? target.row.time : null,
      ...frame, objects, original: JSON.stringify(objects),
      message: kind === 'delete' ? '确认删除这条圈画标注？' : '' }); notify(); return true;
  }
  function objects(value) {
    if (!draft || !['editing', 'failed'].includes(draft.status) || draft.kind === 'delete') return { status: 'ignored' };
    try { const next = validate(value); draft = Object.freeze({ ...draft, objects: next, dirty: JSON.stringify(next) !== draft.original, status: 'editing', message: '' }); }
    catch (error) { draft = Object.freeze({ ...draft, message: error.message }); }
    notify(); return { status: draft.message ? 'failed' : 'editing' };
  }
  function touch() { if (draft && draft.status === 'editing' && !draft.dirty) { draft = Object.freeze({ ...draft, dirty: true }); notify(); } }
  function discard() { if (draft && draft.status === 'saving') return false; draft = null; notify(); return true; }
  function fail(error) { if (draft) draft = Object.freeze({ ...draft, status: 'failed', message: error.message }); else message = error.message; notify(); }
  function saveRecords(next) { document = store.save(binding, next, document.token); refreshRecords(); }
  function save() {
    if (!draft || !['editing', 'failed'].includes(draft.status)) return { status: 'ignored' };
    if (draft.kind !== 'delete' && !draft.objects.length && !draft.original.length) { discard(); return { status: 'cancelled' }; }
    const before = draft;
    if (before.kind !== 'delete' && !before.dirty) { draft = null; notify(); return { status: 'saved' }; }
    draft = Object.freeze({ ...before, status: 'saving', message: '正在保存圈画…' }); notify();
    try {
      const next = document.records.filter(n => !(n.id === before.noteId && n.sourceSha256 === binding.sourceSha256));
      if (before.kind !== 'delete' && before.objects.length) next.push({ id: before.noteId, sourceSha256: binding.sourceSha256,
        nativeId: before.nativeId, nativeTime: before.nativeTime, frameId: before.frameId, frameOrdinal: before.frameOrdinal, time: before.time, objects: before.objects });
      saveRecords(next); draft = null; message = before.kind === 'delete' ? '圈画标注已删除。' : '圈画已保存。'; notify(); return { status: 'saved' };
    } catch (error) { draft = Object.freeze({ ...before, status: 'failed', message: error.message }); notify(); return { status: 'failed', message: error.message }; }
  }
  function remove(id) {
    if (draft || status !== 'ready') throw Error('请先完成圈画编辑。');
    if (!records.some(n => n.id === id)) return { status: 'ignored' };
    try { saveRecords(document.records.filter(n => !(n.id === id && n.sourceSha256 === binding.sourceSha256))); message = '圈画已清除，文字保留。'; notify(); return { status: 'saved' }; }
    catch (error) { message = '圈画仍保留：' + error.message; notify(); return { status: 'failed', message }; }
  }
  function nativeDeleted(id) {
    if (!records.some(n => n.nativeId === id)) return { status: 'saved' };
    try { saveRecords(document.records.filter(n => !(n.nativeId === id && n.sourceSha256 === binding.sourceSha256))); notify(); return { status: 'saved' }; }
    catch (error) { message = '原生文字已删除，关联圈画仍保留：' + error.message; notify(); return { status: 'failed', message }; }
  }
  function setVisible(next) {
    if (typeof next !== 'boolean' || !store) return { status: 'ignored' };
    try { const p = store.saveVisibility(next, preferenceToken); preferenceToken = p.token; visible = p.visible; notify(); return { status: 'saved' }; }
    catch (error) { message = '显隐设置未保存：' + error.message; notify(); return { status: 'failed', message }; }
  }
  function setStyles(next) {
    if (!store?.saveStyles) return { status: 'ignored' };
    try {
      next = validateStyles(next);
      if (JSON.stringify(styles) === JSON.stringify(next)) return { status: 'saved' };
      const p = store.saveStyles(next, stylesToken); stylesToken = p.token; styles = Object.freeze(validateStyles(p.styles)); stylesReadError = ''; notify(); return { status: 'saved' };
    } catch (error) { message = '工具设置未保存：' + error.message; notify(); return { status: 'failed', message }; }
  }
  function deactivate() { if (draft) return false; binding = null; records = Object.freeze([]); document = { records: [], token: null }; status = store ? 'idle' : 'disabled'; listKey = null; return true; }
  return Object.freeze({ open, list, resolve, reserve, begin, objects, touch, discard, fail, save, remove, nativeDeleted, setVisible, setStyles, deactivate,
    snapshot: () => Object.freeze({ status, records, draft, visible, styles, message: message || stylesReadError }),
    atFrame: (ordinal, id) => records.filter(n => n.frameOrdinal === ordinal && n.frameId === id).flatMap(n => n.objects) });
}
module.exports = { createDrawingSession };
