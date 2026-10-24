'use strict';
const assert = require('node:assert/strict');
const { createModel } = require('./model.js');
let checks = 0;
function test(name, run) { run(); checks++; process.stdout.write('ok ' + checks + ' - ' + name + '\n'); }
const shape = () => ({ type: 'rect', x: .2, y: .2, x2: .4, y2: .4, color: '#ffcc88', width: .003 });
const at = (model, frame) => model.state.records.find(record => record.frame === frame);

test('state identity is stable and sample records aggregate six distinct frames', () => {
  const m = createModel(), state = m.state;
  assert.equal(state.records.length, 6); assert.equal(new Set(state.records.map(n => n.frame)).size, 6);
  assert.ok(at(m, 56).entries.length > 1); assert.ok(state.records.some(n => n.objects.length));
  m.toggleRecords(); m.togglePlay(); m.tick(.1); m.openSettings(); m.closeSettings();
  assert.equal(m.state, state);
});
test('records do not pause on opening or resume on closing; selecting pauses and stays open', () => {
  const m = createModel(); m.togglePlay(); m.toggleRecords(); assert.equal(m.state.playing, true);
  m.selectRecord('record-90'); assert.equal(m.state.frame, 90); assert.equal(m.state.playing, false); assert.equal(m.state.recordsOpen, true);
  m.toggleRecords(); assert.equal(m.state.playing, false);
});
test('settings pauses and closing does not resume', () => {
  const m = createModel(); m.togglePlay(); m.openSettings(); assert.equal(m.state.playing, false);
  assert.equal(m.togglePlay(), false); m.closeSettings(); assert.equal(m.state.playing, false);
});
test('24fps progression carries subframes, respects speed and pauses at the end', () => {
  const m = createModel(); m.seek(0); m.togglePlay();
  for (let i = 0; i < 10; i++) m.tick(1 / 240);
  assert.equal(m.state.frame, 1); m.state.rate = 2; m.tick(.5); assert.equal(m.state.frame, 25);
  m.tick(20); assert.equal(m.state.frame, 239); assert.equal(m.state.playing, false);
});
test('empty new annotation cancels without creating a record', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.updateText('   ');
  assert.equal(m.saveDraft(), 'cancelled'); assert.equal(at(m, 32), undefined); assert.equal(m.state.mode, 'watch');
});
test('text-only new annotation saves one frame card and returns paused', () => {
  const m = createModel(); m.seek(32); m.toggleRecords(); m.beginAnnotation(); m.updateText('观察说明');
  assert.equal(m.saveDraft(), 'saved'); assert.equal(at(m, 32).entries[0].text, '观察说明');
  assert.equal(m.state.playing, false); assert.equal(m.state.recordsOpen, true);
});
test('draw-only annotations are valid; objects and input coordinates are isolated', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); const object = shape(); m.addObject(object); object.x = .9;
  assert.equal(m.state.draft.objects[0].x, .2); assert.equal(m.saveDraft(), 'saved');
  assert.equal(at(m, 32).objects.length, 1); assert.equal(at(m, 32).entries.length, 0);
});
test('clearing existing text preserves its original value', () => {
  const m = createModel(), original = at(m, 16).entries[0].text;
  m.beginAnnotation('record-16'); m.updateText(''); m.addObject(shape()); m.saveDraft();
  assert.equal(at(m, 16).entries[0].text, original); assert.equal(at(m, 16).objects.length, 1);
});
test('multi-entry frame does not silently pick one; switching retains independent drafts', () => {
  const m = createModel(); m.beginAnnotation('record-56');
  assert.equal(m.state.draft.entryId, null); assert.equal(m.state.draft.entryChoices.length, 2);
  m.chooseEntry('entry-56-a'); m.updateText('第一段修改'); m.chooseEntry('entry-56-b'); m.updateText('第二段修改');
  m.chooseEntry('entry-56-a'); assert.equal(m.state.draft.text, '第一段修改');
  m.saveDraft(); assert.deepEqual(at(m, 56).entries.map(n => n.text), ['第一段修改', '第二段修改']);
  assert.equal(m.state.records.filter(n => n.frame === 56).length, 1);
});
test('typing before choosing a legacy entry requires a choice and preserves that text', () => {
  const m = createModel(); m.beginAnnotation('record-56'); m.updateText('还没有选择的输入');
  assert.equal(m.saveDraft(), 'choose'); m.chooseEntry('entry-56-b'); assert.equal(m.state.draft.text, '还没有选择的输入');
  m.saveDraft(); assert.equal(at(m, 56).entries[1].text, '还没有选择的输入'); assert.equal(at(m, 56).entries[0].text, '能量聚拢，轮廓开始收紧');
});
test('drawing on a multi-entry frame needs no forced text choice and keeps all entries', () => {
  const m = createModel(), before = JSON.stringify(at(m, 56).entries); m.beginAnnotation('record-56'); m.addObject(shape());
  assert.equal(m.saveDraft(), 'saved'); assert.equal(JSON.stringify(at(m, 56).entries), before);
});
test('failed save leaves both drafts and committed data untouched, retry saves once', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.updateText('保留草稿'); m.addObject(shape());
  assert.equal(m.saveDraft('failed'), 'failed'); assert.equal(at(m, 32), undefined); assert.equal(m.state.draft.text, '保留草稿');
  assert.equal(m.state.draft.objects.length, 1); assert.equal(m.saveDraft(), 'saved'); assert.equal(m.state.records.filter(n => n.frame === 32).length, 1);
});
test('partial save commits text only; retry neither duplicates cards nor entries', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.updateText('文字已成功'); m.addObject(shape());
  assert.equal(m.saveDraft('partial'), 'partial'); const savedId = at(m, 32).entries[0].id;
  assert.equal(at(m, 32).objects.length, 0); assert.equal(m.state.draft.objects.length, 1);
  assert.equal(m.saveDraft('partial'), 'partial'); assert.equal(at(m, 32).entries.length, 1);
  assert.equal(m.saveDraft(), 'saved'); assert.equal(at(m, 32).entries.length, 1); assert.equal(at(m, 32).entries[0].id, savedId);
  assert.equal(at(m, 32).objects.length, 1); assert.equal(m.state.records.filter(n => n.frame === 32).length, 1);
});
test('cancel after partial success preserves confirmed text but discards pending objects', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.updateText('已确认部分'); m.addObject(shape()); m.saveDraft('partial');
  assert.equal(m.cancelDraft(), 'confirm'); assert.equal(m.cancelDraft(true), 'cancelled');
  assert.equal(at(m, 32).entries[0].text, '已确认部分'); assert.equal(at(m, 32).objects.length, 0);
});
test('unknown save blocks mutations, resubmission and discard until check', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.updateText('待核对'); m.addObject(shape());
  assert.equal(m.saveDraft('unknown'), 'unknown'); assert.equal(m.updateText('不能覆盖'), false);
  assert.equal(m.addObject(shape()), false); assert.equal(m.cancelDraft(true), 'blocked'); assert.equal(m.saveDraft(), 'unknown');
  assert.equal(m.checkDraft(), 'saved'); assert.equal(at(m, 32).entries.length, 1); assert.equal(at(m, 32).objects.length, 1);
  assert.equal(m.checkDraft(), 'ignored'); assert.equal(m.state.records.filter(n => n.frame === 32).length, 1);
});
test('partial then unknown confirmation is idempotent', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.updateText('分步核对'); m.addObject(shape());
  m.saveDraft('partial'); const id = at(m, 32).entries[0].id; m.saveDraft('unknown'); m.checkDraft();
  assert.equal(at(m, 32).entries.length, 1); assert.equal(at(m, 32).entries[0].id, id); assert.equal(at(m, 32).objects.length, 1);
});
test('annotation cancels restore record visibility and never mutate old objects', () => {
  const m = createModel(), before = JSON.stringify(at(m, 56)); m.toggleRecords(); m.beginAnnotation('record-56', 'entry-56-a');
  assert.equal(m.toggleRecords(), false); assert.equal(m.openSettings(), false); assert.equal(m.seek(10), false);
  m.updateText('未保存'); m.addObject(shape()); assert.equal(m.cancelDraft(), 'confirm'); m.cancelDraft(true);
  assert.equal(JSON.stringify(at(m, 56)), before); assert.equal(m.state.recordsOpen, true); assert.equal(m.state.playing, false);
});
test('eraser misses create no undo; erased objects restore with one undo', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.addObject(shape());
  assert.equal(m.eraseAt(.95, .95, .01), false); assert.equal(m.eraseAt(.3, .3, .01), true); assert.equal(m.state.draft.objects.length, 0);
  assert.equal(m.undoObject(), true); assert.equal(m.state.draft.objects.length, 1);
});
test('one erase drag across multiple objects is restored by a single undo', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.addObject(shape());
  m.addObject({ ...shape(), x:.6, y:.6, x2:.8, y2:.8 }); const before = JSON.stringify(m.state.draft.objects);
  assert.equal(m.beginErase(), true); assert.equal(m.eraseAt(.3,.3,.01), true);
  assert.equal(m.beginErase(), false); // Duplicate start must not reset the gesture snapshot.
  assert.equal(m.eraseAt(.7,.7,.01), true); assert.equal(m.eraseAt(.95,.95,.01), false);
  assert.equal(m.state.draft.objects.length, 0); assert.equal(m.endErase(), true);
  assert.equal(m.undoObject(), true); assert.equal(JSON.stringify(m.state.draft.objects), before);
  assert.equal(m.undoObject(), true); assert.equal(m.state.draft.objects.length, 1);
});
test('an all-empty erase drag adds no undo step', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation();
  m.beginErase(); assert.equal(m.eraseAt(.8,.8,.01), false); m.endErase(); assert.equal(m.undoObject(), false);
  m.addObject(shape()); m.beginErase(); assert.equal(m.eraseAt(.8,.8,.01), false); m.endErase();
  assert.equal(m.undoObject(), true); assert.equal(m.state.draft.objects.length, 0); assert.equal(m.undoObject(), false);
});
test('separate erase drags and legacy direct calls retain separate undo steps', () => {
  const m = createModel(); m.seek(32); m.beginAnnotation(); m.addObject(shape());
  m.addObject({ ...shape(), x:.6, y:.6, x2:.8, y2:.8 });
  m.beginErase(); m.eraseAt(.3,.3,.01); m.endErase(); m.eraseAt(.7,.7,.01);
  m.undoObject(); assert.equal(m.state.draft.objects.length, 1); assert.equal(m.state.draft.objects[0].x,.6);
  m.undoObject(); assert.equal(m.state.draft.objects.length, 2);
});
test('incomplete selection exits without creating a range', () => {
  const m = createModel(); m.beginSelection(); m.setEndpoint(20, 'start'); assert.equal(m.finishSelection(), 'cancelled');
  assert.deepEqual(m.state.loop, { start: null, end: null, enabled: false }); assert.equal(m.state.mode, 'watch'); assert.equal(m.state.playing, false);
});
test('same-frame selection clears range and disables playback', () => {
  const m = createModel(); m.beginSelection(); m.setEndpoint(20, 'start'); m.setEndpoint(20, 'end');
  assert.equal(m.finishSelection(), 'cleared'); assert.deepEqual(m.state.loop, { start: null, end: null, enabled: false });
});
test('complete selection loops inclusively and cancellation restores previous range', () => {
  const m = createModel(); m.beginSelection(); m.setEndpoint(20, 'start'); m.setEndpoint(23, 'end'); assert.equal(m.finishSelection(), 'saved');
  assert.equal(m.state.playing, true); m.tick(4 / 24); assert.equal(m.state.frame, 20);
  m.beginSelection(); m.controlEndpoint('start'); assert.equal(m.state.frame, 20); m.setEndpoint(22); m.cancelSelection();
  assert.deepEqual(m.state.loop, { start: 20, end: 23, enabled: true }); assert.equal(m.state.playing, false);
});
test('loop without a valid range returns the exact transient message', () => {
  const m = createModel(); assert.equal(m.toggleLoop(), false); assert.equal(m.state.message, '请先选择循环片段');
});
process.stdout.write('Passed ' + checks + ' model scenarios.\n');
