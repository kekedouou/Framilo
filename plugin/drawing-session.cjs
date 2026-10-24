'use strict';
// One source-frame group; native comments are references, never copied graphics.
const { randomUUID } = require('crypto');
const { isDeepStrictEqual } = require('util');
const model = require('./drawing-model.js');
function createDrawingSession({ store, onChange = () => {} } = {}) {
  let binding = null, document = { records: [], token: null }, records = Object.freeze([]), draft = null;
  let status = store ? 'idle' : 'disabled', message = '', visible = true, preferenceToken = null;
  let listKey = null, merged = null, serial = 0;
  let styles = Object.freeze(model.defaultStyles()), stylesToken = null, stylesReadError = '';
  const notify = () => onChange();
  if (store) try { const p = store.readVisibility(); visible = p.visible; preferenceToken = p.token; } catch (e) { message = '显隐设置未读取：' + e.message; }
  if (store?.readStyles) try { const p = store.readStyles(); styles = Object.freeze(model.validateStyles(p.styles)); stylesToken = p.token; } catch (e) { stylesReadError = '工具设置未读取：' + e.message; }
  const linksOf = n => n.nativeLinks || (n.nativeId ? [{ id: n.nativeId, time: n.nativeTime }] : []);
  const sameFrame = (n, frame) => n.frameOrdinal === frame.frameOrdinal && n.frameId === frame.frameId;
  const atFrame = (items, ordinal) => binding?.frames ? model.nativeAtFrame(items, binding.frames, ordinal, binding.duration) : [];
  function refreshRecords() {
    const current = document.records.filter(n => n.sourceSha256 === binding.sourceSha256);
    if (binding.frames && current.some(n => { const frame = binding.frames[n.frameOrdinal]; return !frame || frame.id !== n.frameId || frame.time !== n.time; }))
      throw Error('圈画与源帧索引不一致，旧记录已保留，未显示到其它画面。');
    records = Object.freeze(current.map(n => Object.freeze(n))); listKey = null;
  }
  function open(next) {
    if (!store) return; if (draft) throw Error('请先保存或取消圈画。');
    binding = Object.freeze({ ...next }); status = 'ready'; message = '';
    try { document = store.read(binding); refreshRecords(); if (document.records.some(n => n.sourceSha256 !== binding.sourceSha256)) message = '源视频内容曾改变，旧圈画已保留，不会套到新画面。'; }
    catch (e) { status = 'error'; message = '圈画未载入：' + e.message; records = Object.freeze([]); }
    notify();
  }
  function list(native = []) {
    if (!records.length) return native;
    if (listKey === native && merged) return merged;
    const byFrame = new Map();for(const note of records)if(!byFrame.has(note.frameOrdinal))byFrame.set(note.frameOrdinal,note);
    const used = new Set(), result = native.map(item => {
      const ordinal = binding?.frames ? model.frameIndex(binding.frames, item.time, binding.duration) : null;
      const note = ordinal !== null ? byFrame.get(ordinal) : records.find(n => linksOf(n).some(l => l.id === item.id && l.time === item.time));
      if (!note) return item;
      used.add(note.id);
      // Each old native entry stays editable, but points to exactly the same group.
      return Object.freeze({ ...item, time: note.time, nativeTime: item.time, drawingId: note.id, drawingFrameId: note.frameId, drawingFrameOrdinal: note.frameOrdinal });
    });
    const shownFrames = new Set(records.filter(n => used.has(n.id)).map(n => n.frameOrdinal + ':' + n.frameId));
    for (const n of records) {
      const key = n.frameOrdinal + ':' + n.frameId;
      if (shownFrames.has(key)) continue; shownFrames.add(key);
      result.push(Object.freeze({ id: 'drawing:' + n.id, time: n.time,
        text: (n.objects.find(o => o.kind === 'text')?.text.split('\n')[0] || '第' + (n.frameOrdinal + 1) + '帧') + (linksOf(n).length ? '（关联文字已删除或时间改变）' : ''),
        drawingId: n.id, localDrawing: true, drawingFrameId: n.frameId, drawingFrameOrdinal: n.frameOrdinal }));
    }
    merged = Object.freeze(result.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))); listKey = native; return merged;
  }
  function resolve(id, native) {
    if (!id) return { note: null, nativeId: null };
    const row = list(native).find(n => n.id === id); if (!row) throw Error('标注条目已变化，请重新选择。');
    return { note: records.find(n => n.id === row.drawingId) || null, nativeId: row.localDrawing ? null : row.id, row };
  }
  function resolveFrame(frame, native) {
    const notes = records.filter(n => sameFrame(n, frame)), links = atFrame(native, frame.frameOrdinal).map(n => ({ id: n.id, time: n.nativeTime ?? n.time }));
    let note = null;
    if (notes.length) {
      const ids = new Set(), objects = [];
      for (const n of notes) for (const object of n.objects) {
        let id = object.id, i = 1; while (ids.has(id)) id = object.id.slice(0, 68) + '-merged-' + i++;
        ids.add(id); objects.push({ ...object, id });
      }
      note = { ...notes[0], objects: model.validate(objects), mergeNeeded: notes.length > 1 };
    }
    return { note, nativeId: links[0]?.id || null, nativeLinks: links, row: links[0] ? { time: links[0].time } : null };
  }
  function reserve() {
    if (status !== 'ready' || draft || !binding) return null;
    draft = Object.freeze({ id: ++serial, status: 'pausing', dirty: false, objects: [], message: '正在固定源帧…' }); notify(); return draft.id;
  }
  function begin(id, frame, target, kind = 'edit') {
    if (!draft || draft.id !== id) return false;
    const note = target.note;
    if (note && (!sameFrame(note, frame) || Math.abs(note.time - frame.time) > .000001)) throw Error('圈画对应的源帧不一致，未覆盖原内容。');
    const objects = note ? model.validate(note.objects) : [];
    const linkChanged = !!note && JSON.stringify(linksOf(note)) !== JSON.stringify(target.nativeLinks || []);
    draft = Object.freeze({ id, status: 'editing', kind, dirty: !!note?.mergeNeeded || linkChanged, mergeNeeded: !!note?.mergeNeeded, linkChanged, noteId: note ? note.id : randomUUID(),
      nativeId: target.nativeId, nativeTime: target.nativeId ? target.row.time : null,
      nativeLinks: target.nativeLinks || [], nativeAttempt: null, ...frame, objects, original: JSON.stringify(objects),
      message: kind === 'delete' ? '确认清除这组圈画？文字会保留。' : '' }); notify(); return true;
  }
  function objects(value) {
    if (!draft || !['editing', 'failed'].includes(draft.status) || draft.kind === 'delete') return { status: 'ignored' };
    try { const next = model.validate(value); draft = Object.freeze({ ...draft, objects: next, dirty: !!draft.noteDirty || !!draft.mergeNeeded || !!draft.linkChanged || JSON.stringify(next) !== draft.original, status: 'editing', message: '' }); }
    catch (e) { draft = Object.freeze({ ...draft, message: e.message }); }
    notify(); return { status: draft.message ? 'failed' : 'editing' };
  }
  function touch() { if (draft && draft.status === 'editing' && !draft.dirty) { draft = Object.freeze({ ...draft, dirty: true }); notify(); } }
  // Text stays in this in-memory draft; persisted graphics schema is unchanged.
  function noteSetup(items, preferred) {
    if (!draft) return;
    const choices = items.map(n => ({ id:n.id, time:n.nativeTime ?? n.time, text:n.text, ...(n.revision===undefined?{}:{revision:n.revision}) }));
    const original = choices.find(n => n.id === preferred) || (choices.length === 1 ? choices[0] : null);
    draft = Object.freeze({ ...draft, noteChoices:choices, noteOriginal:original, noteText:original?.text || '', noteDirty:false }); notify();
  }
  function noteText(text, id) {
    if (!draft || !['editing','failed'].includes(draft.status) || draft.kind === 'delete') return false;
    if (typeof text !== 'string' || text.length > 4096) { fail(Error('文字最多4096字，草稿仍保留。')); return false; }
    const original = id === undefined ? draft.noteOriginal : draft.noteChoices?.find(n => n.id === id);
    if (id !== undefined && !original) return false;
    if (id !== undefined && draft.noteDirty && draft.noteOriginal) { fail(Error('请先保存当前文字，再选择另一条。')); return false; }
    const value = id === undefined ? text : draft.noteDirty ? draft.noteText : original.text, dirty = !!value.trim() && value !== (original?.text || '');
    draft = Object.freeze({ ...draft,noteOriginal:original,noteText:value,noteDirty:dirty,dirty:dirty || !!draft.mergeNeeded || !!draft.linkChanged || JSON.stringify(draft.objects)!==draft.original,status:'editing',message:'' }); notify();return true;
  }
  function noteSaved() { if(draft){draft=Object.freeze({...draft,noteDirty:false,noteOriginal:draft.noteOriginal?{...draft.noteOriginal,text:draft.noteText}:null});notify();} }
  function discard() { if (draft && ['saving', 'unknown'].includes(draft.status)) return false; draft = null; notify(); return true; }
  function fail(e) { if (draft) draft = Object.freeze({ ...draft, status: 'failed', message: e.message }); else message = e.message; notify(); }
  function saveState(value, text = '', attempt) {
    if (!draft) return false;
    draft = Object.freeze({ ...draft, status: value, message: text, ...(attempt === undefined ? {} : { nativeAttempt: attempt }) }); notify(); return true;
  }
  function setLinks(links) {
    if (!draft) return;
    draft = Object.freeze({ ...draft, dirty: draft.dirty || JSON.stringify(draft.nativeLinks) !== JSON.stringify(links), nativeLinks: links, nativeId: links[0]?.id || null, nativeTime: links[0]?.time ?? null }); notify();
  }
  function saveRecords(next) {
    try { document = store.save(binding, next, document.token); }
    catch (failure) {
      // A committed revision may lose its acknowledgement. Verify all desired
      // records before declaring success; never overwrite a competing version.
      let recovered; try { recovered = store.read(binding); } catch (_) { throw failure; }
      if (!isDeepStrictEqual(recovered.records, next)) throw failure;
      document = recovered;
    }
    refreshRecords();
  }
  function save() {
    if (!draft || !['editing', 'failed', 'saving'].includes(draft.status)) return { status: 'ignored' };
    const before = draft;
    if (before.kind !== 'delete' && !before.dirty) { draft = null; notify(); return { status: 'saved' }; }
    draft = Object.freeze({ ...before, status: 'saving', message: '正在保存圈画…' }); notify();
    try {
      const next = document.records.filter(n => !(n.sourceSha256 === binding.sourceSha256 && sameFrame(n, before)));
      if (before.kind !== 'delete' && before.objects.length) next.push({ id: before.noteId, sourceSha256: binding.sourceSha256,
        nativeId: before.nativeId, nativeTime: before.nativeTime, nativeLinks: before.nativeLinks,
        frameId: before.frameId, frameOrdinal: before.frameOrdinal, time: before.time, objects: before.objects });
      saveRecords(next); draft = null; message = before.kind === 'delete' ? '圈画已清除，文字保留。' : '圈画与文字已保存。'; notify(); return { status: 'saved' };
    } catch (e) { draft = Object.freeze({ ...before, status: 'failed', message: e.message }); notify(); return { status: 'failed', message: e.message }; }
  }
  function remove(id) {
    if (draft || status !== 'ready') throw Error('请先完成圈画编辑。');
    const target = records.find(n => n.id === id); if (!target) return { status: 'ignored' };
    try { saveRecords(document.records.filter(n => !(n.sourceSha256 === binding.sourceSha256 && sameFrame(n, target)))); message = '圈画已清除，文字保留。'; notify(); return { status: 'saved' }; }
    catch (e) { message = '圈画仍保留：' + e.message; notify(); return { status: 'failed', message }; }
  }
  function nativeDeleted(id, remaining, original) {
    const ordinal = original && binding?.frames ? model.frameIndex(binding.frames, original.time, binding.duration) : null;
    const affected = n => n.sourceSha256 === binding.sourceSha256 && (n.frameOrdinal === ordinal || linksOf(n).some(l => l.id === id));
    if (!records.some(affected)) return { status: 'saved' };
    try {
      let retained = false;
      saveRecords(document.records.flatMap(n => {
        if (!affected(n)) return [n];
        const links = atFrame(remaining || [], n.frameOrdinal).map(row => ({ id: row.id, time: row.nativeTime ?? row.time }));
        if (!links.length) return [];
        retained = true;
        return [{ ...n, nativeId: links[0].id, nativeTime: links[0].time, nativeLinks: links }];
      }));
      message = retained ? '文字已删除，同帧共享圈画保留。' : '文字与圈画已删除。'; notify(); return { status: 'saved' };
    } catch (e) { message = '原生文字已删除，关联圈画仍保留：' + e.message; notify(); return { status: 'failed', message }; }
  }
  function setVisible(next) {
    if (typeof next !== 'boolean' || !store) return { status: 'ignored' };
    try { const p = store.saveVisibility(next, preferenceToken); preferenceToken = p.token; visible = p.visible; notify(); return { status: 'saved' }; }
    catch (e) { message = '显隐设置未保存：' + e.message; notify(); return { status: 'failed', message }; }
  }
  function setStyles(next) {
    if (!store?.saveStyles) return { status: 'ignored' };
    try { next = model.validateStyles(next); if (JSON.stringify(styles) === JSON.stringify(next)) return { status: 'saved' };
      const p = store.saveStyles(next, stylesToken); styles = Object.freeze(model.validateStyles(p.styles)); stylesToken = p.token; stylesReadError = ''; notify(); return { status: 'saved' };
    } catch (e) { message = '工具设置未保存：' + e.message; notify(); return { status: 'failed', message }; }
  }
  function deactivate() { if (draft) return false; binding = null; records = Object.freeze([]); document = { records: [], token: null }; status = store ? 'idle' : 'disabled'; listKey = null; return true; }
  return Object.freeze({ open, list, resolve, resolveFrame, reserve, begin, objects, touch, discard, fail, saveState, setLinks, noteSetup, noteText, noteSaved, save, remove, nativeDeleted, setVisible, setStyles, deactivate,
    snapshot: () => Object.freeze({ status, records, draft, visible, styles, message: message || stylesReadError }),
    atFrame: (ordinal, id) => records.filter(n => n.frameOrdinal === ordinal && n.frameId === id).flatMap(n => n.objects) });
}
module.exports = { createDrawingSession };
