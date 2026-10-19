/* Actual browser SVG/DOM/input checks, no real video, SDK or user data. */
(async function () {
  'use strict';
  const results = [], el = id => document.getElementById(id), delay = (ms = 10) => new Promise(r => setTimeout(r, ms));
  const check = (value, text) => { if (!value) throw Error(text); results.push(text); };
  const clone = v => JSON.parse(JSON.stringify(v));
  const state = { epoch: 1, state: 'paused', duration: 10, source: { name: '圈画检查（无真实视频）' },
    playback: { time: 2, frameId: 20, frameOrdinal: 20, frameCount: 100, transport: { rate: 1, loop: { valid: false } } },
    drawings: { status: 'ready', records: [], visible: true, draft: null, message: '' }, comments: { status: 'ready', items: [], draft: null } };
  let ui, serial = 0, stored = [], failSave = false, changes = 0;
  const publish = () => { changes++; ui.update({ ...state, drawings: { ...state.drawings } }); };
  const session = {
    async beginDrawing() { state.state = 'paused'; state.drawings.draft = { id: ++serial, status: 'editing', frameId: 20, frameOrdinal: 20, time: 2, objects: [], dirty: false }; publish(); return { status: 'editing' }; },
    setDrawingObjects(objects) { state.drawings.draft = { ...state.drawings.draft, objects: clone(objects), dirty: !!objects.length }; publish(); },
    touchDrawing() { state.drawings.draft = { ...state.drawings.draft, dirty: true }; publish(); },
    saveDrawing() { if (failSave) { state.drawings.draft = { ...state.drawings.draft, status: 'failed', message: '模拟空间不足' }; publish(); return { status: 'failed' }; }
      stored = clone(state.drawings.draft.objects); state.drawings.records = [{ id: 'saved', frameId: 20, frameOrdinal: 20, time: 2, objects: stored }]; state.drawings.draft = null; publish(); return { status: 'saved' }; },
    cancelDrawing() { state.drawings.draft = null; publish(); return true; },
    setDrawingsVisible(visible) { state.drawings.visible = visible; publish(); return { status: 'saved' }; },
    setCommentsVisible() {}, refreshComments: async () => {}, memorySnapshot: () => null
  };
  function key(value, extra = {}, target = document.activeElement === document.body ? window : document.activeElement || window) {
    const event = new KeyboardEvent('keydown', { key: value, code: value.length === 1 ? 'Key' + value.toUpperCase() : value, bubbles: true, cancelable: true, ...extra }); target.dispatchEvent(event); return event;
  }
  const background = () => { el('picture').tabIndex = 0; el('picture').focus(); };
  function pointer(target, type, x, y, id = 31) { target.dispatchEvent(new PointerEvent(type, { pointerId: id, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true })); }
  function draw(kind, a = [.2, .3], b = [.55, .6]) {
    el('drawingTool').value = kind; el('drawingTool').dispatchEvent(new Event('change'));
    const r = el('drawingLayer').getBoundingClientRect(), x = r.left + r.width * a[0], y = r.top + r.height * a[1];
    pointer(el('drawingLayer'), 'pointerdown', x, y);
    if (kind !== 'text') { pointer(window, 'pointermove', r.left + r.width * b[0], r.top + r.height * b[1]); pointer(window, 'pointerup', r.left + r.width * b[0], r.top + r.height * b[1]); }
  }
  try {
    ui = EVAUI.createUI(); ui.bindSession(session); publish(); background();
    const screenBefore = el('screen').getBoundingClientRect(); key('d'); await delay();
    check(!el('drawingPanel').hidden && el('play').disabled, 'D enters a paused editor and blocks normal transport');
    const screenAfter = el('screen').getBoundingClientRect(); check(screenBefore.height === screenAfter.height && screenBefore.width === screenAfter.width, 'Opening drawing tools never shrinks the video area');
    for (const kind of ['pen', 'arrow', 'rect', 'ellipse', 'text']) draw(kind);
    check(state.drawings.draft.objects.length === 5, 'Five tools create five validated independent objects');
    check(el('drawingLayer').querySelectorAll('polyline,rect,ellipse,text').length >= 5, 'Actual SVG renders all tools');
    el('drawingText').value = '中文第一行\n第二行 <img onerror=bad>';
    el('drawingText').dispatchEvent(new Event('compositionstart')); el('drawingText').dispatchEvent(new Event('input')); key('Enter', { isComposing: true }, el('drawingText'));
    check(!!state.drawings.draft && stored.length === 0, 'IME confirmation cannot save the annotation');
    el('drawingText').dispatchEvent(new Event('compositionend')); await delay(60);
    check(state.drawings.draft.objects.at(-1).text.includes('第二行'), 'Chinese multiline text is preserved');
    check(!el('drawingLayer').querySelector('img'), 'Text remains text and cannot create HTML');
    key('Enter', { shiftKey: true }, el('drawingText')); check(!!state.drawings.draft, 'Shift+Enter remains text input rather than saving');
    background(); const beforeUndo = state.drawings.draft.objects.length; key('z', { ctrlKey: true }); check(state.drawings.draft.objects.length <= beforeUndo, 'Ctrl+Z operates on drawing history outside text'); key('y', { ctrlKey: true });
    const originalPreference = state.drawings.visible; key('h'); check(el('drawingLayer').hidden && state.drawings.visible === originalPreference, 'Editor H is temporary and does not overwrite the saved visibility preference');
    const oldCount = state.drawings.draft.objects.length; draw('rect'); check(state.drawings.draft.objects.length === oldCount, 'Hidden overlay does not accept invisible strokes'); key('h');
    const beforeRect = el('drawingLayer').getBoundingClientRect(); el('screen').style.maxHeight = '300px'; window.dispatchEvent(new Event('resize')); const afterRect = el('drawingLayer').getBoundingClientRect();
    check(afterRect.height <= beforeRect.height && afterRect.width / afterRect.height > 1.7, 'Resize fits the same image aspect without stretching annotations'); el('screen').style.maxHeight = ''; window.dispatchEvent(new Event('resize'));
    background(); key('Enter'); await delay(); check(!state.drawings.draft && stored.length === 5, 'Enter saves the complete drawing and exits editing');
    key('h'); check(!state.drawings.visible && el('drawingLayer').hidden, 'Normal H updates the immediate visibility preference');
    key('d'); await delay(); check(!el('drawingLayer').hidden && !state.drawings.visible, 'Entering from hidden temporarily shows editing without altering preference');
    draw('rect'); background(); key('Escape'); await delay(); check(!el('drawingExit').hidden, 'Esc with changes opens the unsaved choice');
    el('drawingExitReturn').click(); await delay(); check(!!state.drawings.draft && el('drawingExit').hidden, 'Return to editing preserves all unsaved objects');
    const closing = ui.confirmDrawingExit(); await delay(); failSave = true; el('drawingExitSave').click(); await delay();
    check(!el('drawingExit').hidden && state.drawings.draft && el('drawingExitMessage').textContent.includes('不足'), 'Save failure keeps the close dialog and shows the actual error');
    failSave = false; el('drawingExitDiscard').click(); check(await closing, 'Explicit discard resolves the pending close intent');
    check(!state.drawings.draft && !state.drawings.visible && el('drawingLayer').hidden, 'Exit restores original hidden preference without deleting saved notes');
    state.playback = { ...state.playback, frameId: 21, frameOrdinal: 21 }; session.setDrawingsVisible(true); check(el('drawingLayer').hidden, 'Leaving the exact source frame hides its saved overlay');
    state.playback = { ...state.playback, frameId: 20, frameOrdinal: 20 }; publish(); check(!el('drawingLayer').hidden, 'Returning to the source frame restores the saved overlay');
    background(); key('d'); await delay(); draw('rect'); el('drawingTool').value = 'select'; el('drawingTool').dispatchEvent(new Event('change'));
    el('drawingTool').focus();
    const g = el('drawingLayer').querySelector('g'), r = el('drawingLayer').getBoundingClientRect();
    pointer(g.firstElementChild, 'pointerdown', r.left + r.width * .3, r.top + r.height * .4); pointer(window, 'pointermove', r.left + r.width * .4, r.top + r.height * .5); pointer(window, 'pointerup', r.left + r.width * .4, r.top + r.height * .5);
    check(state.drawings.draft.objects[0].a.x > .2, 'Selecting and dragging an SVG object changes normalized coordinates');
    check(document.activeElement === el('drawingLayer'), 'Clicking the drawing returns focus from the tool selector for immediate hotkeys');
    const handle = el('drawingLayer').querySelector('[data-resize]'); pointer(handle, 'pointerdown', r.left + r.width * .65, r.top + r.height * .7); pointer(window, 'pointermove', r.left + r.width * .8, r.top + r.height * .85); pointer(window, 'pointerup', r.left + r.width * .8, r.top + r.height * .85);
    check(state.drawings.draft.objects[0].b.x > .65, 'Corner handle resizes the selected object');
    key('Delete'); check(state.drawings.draft.objects.length === 0, 'Delete removes only the selected object without an extra focus click');
    session.cancelDrawing(); ui.destroy();
    const afterDestroy = changes; background(); key('d'); key('h'); check(changes === afterDestroy, 'Destroyed UI leaves no drawing hotkey listeners');
    const out = document.createElement('pre'); out.id = 'drawing-results'; out.hidden = true; out.textContent = JSON.stringify({ passed: true, checks: results }); document.body.appendChild(out);
  } catch (error) {
    ui?.destroy(); const out = document.createElement('pre'); out.id = 'drawing-results'; out.hidden = true; out.textContent = JSON.stringify({ passed: false, checks: results, error: error.stack }); document.body.appendChild(out);
  }
})();
