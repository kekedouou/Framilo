/* Native DOM/SVG checks with a Session stand-in; no Eagle, source video or user data. */
(async function () {
  'use strict';
  const results = [], el = id => document.getElementById(id), delay = (ms = 10) => new Promise(r => setTimeout(r, ms));
  const check = (ok, text) => { if (!ok) throw Error(text); results.push(text); }, copy = v => JSON.parse(JSON.stringify(v));
  const state = { epoch: 1, state: 'paused', duration: 10, source: { name: '界面检查（无真实视频）' },
    playback: { time: 2, frameId: 20, frameOrdinal: 20, frameCount: 100, transport: { rate: 1, loop: { valid: false } } },
    drawings: { status: 'ready', records: [], visible: true, styles: EVADrawingModel.defaultStyles(), draft: null, message: '' },
    comments: { status: 'ready', items: [{ id: 'one', time: 2, text: '第一条文字' }, { id: 'two', time: 4, text: '第二条文字' }], draft: null } };
  let ui, serial = 0, stored = [], failSave = false, changes = 0, seeks = 0, steps = 0, prepares = 0, savedPreferences = null;
  const publish = () => { changes++; ui.update({ ...state, drawings: { ...state.drawings } }); };
  const session = {
    async beginDrawing(id) { state.state = 'paused'; const objects = copy(stored); state.drawings.draft = { id: ++serial, status: 'editing', frameId: 20, frameOrdinal: 20, time: 2, objects, original: JSON.stringify(objects), dirty: false }; publish(); return { status: 'editing' }; },
    setDrawingObjects(objects) { EVADrawingModel.validate(objects); state.drawings.draft = { ...state.drawings.draft, objects: copy(objects), dirty: JSON.stringify(objects) !== state.drawings.draft.original }; publish(); },
    touchDrawing() { state.drawings.draft = { ...state.drawings.draft, dirty: true }; publish(); },
    saveDrawing() { if (failSave) { state.drawings.draft = { ...state.drawings.draft, status: 'failed', message: '模拟空间不足' }; publish(); return { status: 'failed' }; }
      stored = copy(state.drawings.draft.objects); state.drawings.records = [{ id: 'saved', frameId: 20, frameOrdinal: 20, time: 2, objects: stored }]; state.drawings.draft = null; publish(); return { status: 'saved' }; },
    cancelDrawing() { state.drawings.draft = null; publish(); return true; },
    setDrawingsVisible(visible) { state.drawings.visible = visible; publish(); return { status: 'saved' }; },
    setDrawingStyles(styles) { savedPreferences = EVADrawingModel.validateStyles(styles); state.drawings.styles = copy(savedPreferences); publish(); return { status: 'saved' }; },
    async seekComment() { seeks++; publish(); }, step() { steps++; }, setCommentsVisible() {}, refreshComments: async () => {}, memorySnapshot: () => null
  };
  const objects = () => state.drawings.draft.objects;
  const background = () => { el('picture').tabIndex = 0; el('picture').focus(); };
  function key(value, extra = {}, target = document.activeElement === document.body ? window : document.activeElement || window) {
    const e = new KeyboardEvent('keydown', { key: value, code: value.length === 1 ? 'Key' + value.toUpperCase() : value, bubbles: true, cancelable: true, ...extra }); target.dispatchEvent(e); return e;
  }
  function pointer(target, type, p, id = 31) {
    const r = el('drawingLayer').getBoundingClientRect();
    target.dispatchEvent(new PointerEvent(type, { pointerId: id, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: r.left + r.width * p[0], clientY: r.top + r.height * p[1], bubbles: true, cancelable: true }));
  }
  const tool = kind => el('drawingTool' + kind[0].toUpperCase() + kind.slice(1)).click();
  function stroke(kind, a, b) { tool(kind); pointer(el('drawingLayer'), 'pointerdown', a); if (b) pointer(window, 'pointermove', b); pointer(window, 'pointerup', b || a); }
  function change(id, value) { el(id).value = value; el(id).dispatchEvent(new Event('change', { bubbles: true })); }
  function input(value) { el('drawingText').value = value; el('drawingText').dispatchEvent(new Event('input', { bubbles: true })); }
  function doubleText(p) { const r = el('drawingLayer').getBoundingClientRect(); el('drawingLayer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.left + r.width * p[0], clientY: r.top + r.height * p[1] })); }
  try {
    ui = EVAUI.createUI(); ui.bindSession(session); publish(); background();
    const rows = () => [...document.querySelectorAll('.comment-row')];
    check(rows().every(row => row.querySelector('.comment-row-actions').hidden), 'Sidebar actions start collapsed');
    rows()[0].querySelector('.comment-item').click(); check(seeks === 1 && !rows()[0].querySelector('.comment-row-actions').hidden && rows()[1].querySelector('.comment-row-actions').hidden, 'Selecting one note seeks once and reveals only its actions');
    rows()[1].querySelector('.comment-item').click(); check(rows()[0].querySelector('.comment-row-actions').hidden && !rows()[1].querySelector('.comment-row-actions').hidden, 'Selecting another row collapses the previous row');
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); check(rows().every(row => row.querySelector('.comment-row-actions').hidden), 'Clicking outside collapses row actions');
    const before = el('screen').getBoundingClientRect(); background(); key('d'); await delay();
    check(!el('drawingPanel').hidden && el('play').disabled, 'D enters a paused editor and blocks normal playback');
    const after = el('screen').getBoundingClientRect(); check(before.width === after.width && before.height === after.height, 'Tools never shrink or resize the video area');
    check(el('drawingPanel').getBoundingClientRect().height <= 42 && !el('drawingTool').querySelector('select') && !el('drawingUndo') && !el('drawingRedo'), 'Five compact tool buttons replace selection and undo/redo controls');
    for (const kind of ['pen', 'arrow', 'rect', 'ellipse']) stroke(kind, [.85, .9]);
    check(objects().length === 0 && !state.drawings.draft.dirty, 'Click-only strokes create no object or unsaved change');
    stroke('pen', [.85, .9], [.851, .901]); check(objects().length === 0, 'Sub-threshold mouse jitter does not create a dot');
    stroke('text', [.2, .7]); check(!el('drawingText').hidden && el('drawingText').value === '' && objects().length === 0, 'New text starts empty and stays outside saved objects');
    stroke('text', [.4, .7]); check(objects().length === 0 && el('drawingText').value === '', 'A second blank click cancels the old empty text draft');
    tool('rect'); check(el('drawingText').hidden && !state.drawings.draft.dirty, 'Changing tools discards an empty text box without dirtying the note');
    background(); key('Escape'); await delay(); check(!state.drawings.draft && el('drawingExit').hidden, 'Misclick-only editing exits without an unsaved confirmation');
    background(); key('d'); await delay(); stroke('rect', [.1, .2], [.5, .6]);
    check(objects().length === 1 && !el('drawingLayer').querySelector('[stroke-dasharray]') && el('drawingLayer').querySelectorAll('[data-handle]').length === 4, 'Selected rectangle has four corner handles and no bounding frame');
    stroke('rect', [.25, .3], [.4, .5]); check(objects().length === 2, 'Hollow rectangle interior allows a nested rectangle');
    pointer(el('drawingLayer'), 'pointerdown', [.1, .4]); pointer(window, 'pointermove', [.15, .45]); pointer(window, 'pointerup', [.15, .45]);
    check(Math.abs(objects()[0].a.x - .15) < 1e-6 && objects().length === 2, 'Same-type edge drag moves an existing shape instead of making another');
    check(document.activeElement === el('drawingLayer'), 'Canvas interaction returns focus for immediate keyboard actions');
    const corner = el('drawingLayer').querySelector('[data-handle="nw"]'); pointer(corner, 'pointerdown', [.15, .25]); pointer(window, 'pointermove', [.08, .15]); pointer(window, 'pointerup', [.08, .15]);
    check(Math.abs(objects()[0].a.x - .08) < 1e-6 && Math.abs(objects()[0].b.x - .55) < 1e-6, 'Corner resize keeps the opposite corner fixed');
    key('z', { ctrlKey: true }); check(Math.abs(objects()[0].a.x - .15) < 1e-6, 'One Ctrl+Z undoes one complete transform');
    key('y', { ctrlKey: true }); check(Math.abs(objects()[0].a.x - .15) < 1e-6, 'Drawing Ctrl+Y does not redo an operation');
    pointer(el('drawingLayer'), 'pointerdown', [.15, .4]); pointer(window, 'pointerup', [.15, .4]); key('Delete');
    check(objects().length === 1 && state.comments.items[0].text === '第一条文字', 'Delete removes only the selected graphic');
    stroke('arrow', [.6, .2], [.8, .4]); const tip = el('drawingLayer').querySelector('[data-handle="b"]');
    pointer(tip, 'pointerdown', [.8, .4]); pointer(window, 'pointermove', [.85, .45]); pointer(window, 'pointerup', [.85, .45]);
    check(Math.abs(objects().at(-1).b.x - .85) < 1e-6 && Math.abs(objects().at(-1).a.x - .6) < 1e-6, 'Arrow endpoints adjust independently');
    change('drawingWidth', '.03'); const arrow = objects().at(-1), angle = Math.atan2((arrow.b.y - arrow.a.y) * 720, (arrow.b.x - arrow.a.x) * 1280), size = .03 * 720 * 5;
    tool('rect'); tool('arrow'); const head = [arrow.b.x - Math.cos(angle + .45) * size / 1280, arrow.b.y - Math.sin(angle + .45) * size / 720], arrowCount = objects().length;
    pointer(el('drawingLayer'), 'pointerdown', head); pointer(window, 'pointermove', [head[0] + .01, head[1] + .01]); pointer(window, 'pointerup', [head[0] + .01, head[1] + .01]);
    check(objects().length === arrowCount && objects().at(-1).a.x > arrow.a.x, 'Clicking a thick arrowhead selects its existing arrow instead of creating another');
    stroke('pen', [.65, .7], [.8, .8]); stroke('ellipse', [.55, .55], [.9, .85]);
    const oldRectColor = objects()[0].color; change('drawingColor', '#ff5252');
    check(objects().at(-1).color === '#ff5252' && objects()[0].color === oldRectColor, 'Color affects selected shape and shared defaults without recoloring other shapes');
    tool('arrow'); change('drawingWidth', '.008'); tool('pen'); change('drawingWidth', '.015'); tool('arrow');
    check(Number(el('drawingWidth').value) === .008 && savedPreferences.widths.pen === .015 && el('drawingColor').value === '#ff5252', 'Tool widths remain separate while color is shared');
    tool('text'); check(el('drawingWidthLabel').hidden && !el('drawingSizeLabel').hidden, 'Text exposes font size without an irrelevant stroke control');
    pointer(el('drawingLayer'), 'pointerdown', [.12, .68]); input('中文第一行\n第二行 <img onerror=bad>');
    el('drawingText').dispatchEvent(new Event('compositionstart')); key('Enter', { isComposing: true }, el('drawingText'));
    check(!!state.drawings.draft && stored.length === 0, 'IME candidate confirmation cannot save the annotation');
    el('drawingText').dispatchEvent(new Event('compositionend')); await delay(60);
    check(!key('z', { ctrlKey: true }, el('drawingText')).defaultPrevented, 'Text input keeps native Ctrl+Z behavior');
    key('Enter', { shiftKey: true }, el('drawingText')); check(!!state.drawings.draft, 'Shift+Enter remains text input');
    tool('rect'); check(objects().at(-1).text.includes('第二行') && !el('drawingLayer').querySelector('img'), 'Ending text commits multiline safe text without interpreting HTML');
    const textCount = objects().length; background(); key('z', { ctrlKey: true }); check(objects().length === textCount - 1, 'A complete text edit takes one drawing undo step');
    stroke('text', [.12, .68]); input('画面标注\n第二行'); tool('rect');
    tool('text'); doubleText([.13, .69]); check(!el('drawingText').hidden && el('drawingText').value.includes('画面标注'), 'Double click reopens existing text at its image location');
    const textRect = el('drawingText').getBoundingClientRect(), image = el('drawingLayer').getBoundingClientRect();
    check(textRect.left >= image.left - 5 && textRect.top >= image.top - 5 && textRect.right <= image.right + 1, 'Inline text stays aligned to the image instead of the toolbar');
    input(''); tool('rect'); check(!objects().some(o => o.kind === 'text'), 'Clearing existing text removes its graphic object'); background(); key('z', { ctrlKey: true }); check(objects().some(o => o.kind === 'text'), 'Cleared existing text can be undone');
    const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }); el('screen').dispatchEvent(wheel);
    for (const k of ['r', 'l', 'c', 'n', '[', ' ']) key(k);
    check(wheel.defaultPrevented && steps === 0 && prepares === 0 && !!state.drawings.draft, 'Drawing does not trigger frame stepping or normal playback shortcuts');
    background(); const preference = state.drawings.visible; key('h'); check(el('drawingLayer').hidden && state.drawings.visible === preference, 'Editor H only hides temporarily');
    const count = objects().length; stroke('rect', [.05, .05], [.2, .15]); check(objects().length === count, 'Hidden drawing does not accept invisible strokes'); background(); key('h');
    el('screen').style.maxHeight = '300px'; window.dispatchEvent(new Event('resize')); const fitted = el('drawingLayer').getBoundingClientRect();
    check(Math.abs(fitted.width / fitted.height - 1280 / 720) < .01, 'Resized overlay retains the image aspect ratio'); el('screen').style.maxHeight = ''; window.dispatchEvent(new Event('resize'));
    el('picture').width = 720; el('picture').height = 1280; window.dispatchEvent(new Event('resize')); const portrait = el('drawingLayer').getBoundingClientRect();
    check(Math.abs(portrait.width / portrait.height - 720 / 1280) < .001, 'Portrait layout uses the same source-relative drawing coordinates');
    el('picture').width = 1280; el('picture').height = 720; window.dispatchEvent(new Event('resize'));
    background(); key('Enter'); await delay(); check(!state.drawings.draft && stored.length === 5 && new Set(stored.map(o => o.kind)).size === 5, 'Enter saves the complete five-tool drawing');
    key('h'); check(!state.drawings.visible && el('drawingLayer').hidden, 'Normal H saves visibility immediately');
    key('d'); await delay(); check(!el('drawingLayer').hidden && !state.drawings.visible, 'Editing temporarily shows annotations without changing hidden preference');
    stroke('rect', [.1, .2], [.5, .6]); background(); key('Escape'); await delay(); check(!el('drawingExit').hidden, 'Changed drawing still requires an explicit exit decision');
    el('drawingExitReturn').click(); await delay(); check(!!state.drawings.draft && el('drawingExit').hidden, 'Returning to edit preserves unsaved objects');
    const closing = ui.confirmDrawingExit(); await delay(); failSave = true; el('drawingExitSave').click(); await delay();
    check(!el('drawingExit').hidden && state.drawings.draft && el('drawingExitMessage').textContent.includes('不足'), 'Failed save retains editor and explains the failure');
    failSave = false; el('drawingExitDiscard').click(); check(await closing, 'Explicit discard releases the pending close intent');
    check(!state.drawings.draft && el('drawingLayer').hidden && !state.drawings.visible, 'Exit restores the original hidden preference');
    state.playback = { ...state.playback, frameId: 21, frameOrdinal: 21, time: 2.3 }; session.setDrawingsVisible(true); check(el('drawingLayer').hidden, 'Leaving the uniform fade window hides its drawing');
    state.playback = { ...state.playback, frameId: 20, frameOrdinal: 20, time: 2 }; publish(); check(!el('drawingLayer').hidden, 'Returning to the same source frame restores the drawing');
    ui.destroy(); const beforeDestroy = changes; background(); key('d'); key('h'); check(changes === beforeDestroy, 'Destroy removes drawing keyboard listeners');
    ui = EVAUI.createUI(); ui.bindSession(session); publish(); background(); key('d'); await delay(); tool('pen');
    check(Number(el('drawingWidth').value) === .015 && el('drawingColor').value === '#ff5252', 'Recreated UI loads persisted tool preferences');
    stroke('rect', [.12, .2], [.48, .5]); stroke('arrow', [.55, .25], [.78, .4]); stroke('text', [.17, .65]); input('精简标注工具'); tool('text');

    // E-13: real text layout and local deletion.
    stroke('text',[.12,.45]);input('短句');
    const shortWidth=el('drawingText').getBoundingClientRect().width,shortHeight=el('drawingText').getBoundingClientRect().height;
    input('这是一段不会自动换行的较长画面文字 ABC');
    check(el('drawingText').getBoundingClientRect().width>shortWidth&&el('drawingText').getBoundingClientRect().height===shortHeight,'Text box grows horizontally with measured glyphs without automatic wrapping');
    check(el('drawingText').wrap==='off'&&el('drawingText').scrollHeight<=el('drawingText').clientHeight+1,'A single long line has no vertical scrolling controls');
    input('第一行\n第二行');check(el('drawingText').getBoundingClientRect().height>shortHeight,'Only an explicit newline grows text-box height');
    tool('rect');const textSaved=objects().find(o=>o.text==='第一行\n第二行');tool('text');doubleText([.13,.46]);
    check(!el('drawingTextDelete').hidden,'Text edit exposes one compact corner delete control');
    const otherIds=objects().filter(o=>o.id!==textSaved.id).map(o=>o.id);el('drawingTextDelete').click();
    check(!objects().some(o=>o.id===textSaved.id)&&JSON.stringify(objects().map(o=>o.id))===JSON.stringify(otherIds),'Corner delete removes only its text and keeps the other drawings');
    background();key('z',{ctrlKey:true});check(objects().some(o=>o.id===textSaved.id),'Corner deletion remains undoable');

    // E-11 additions exercise actual SVG masks and input, not a canvas stand-in.
    stored=[]; state.drawings.records=[]; state.drawings.draft=null; publish(); background(); key('d'); await delay();
    stroke('rect',[.2,.2],[.8,.8]); stroke('text',[.25,.3]); input('局部擦除'); tool('rect');
    const eraseCount=objects().length; tool('eraser');
    const sizeBefore=Number(el('drawingWidth').value);
    el('screen').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
    check(Number(el('drawingWidth').value)>sizeBefore,'Eraser wheel changes its radius without stepping the video');
    pointer(el('drawingLayer'),'pointerdown',[.1,.31]); pointer(window,'pointermove',[.9,.31]); pointer(window,'pointerup',[.9,.31]);
    check(objects().length===eraseCount&&objects().every(o=>o.erasures?.length===1),'One continuous eraser stroke locally cuts both text and shape without deleting either object');
    check(el('drawingLayer').querySelectorAll('mask').length===2,'Every cut object renders through its own SVG mask');
    const maskImage=new Image(),svg=el('drawingLayer').cloneNode(true);
    svg.removeAttribute('hidden');svg.style='';svg.setAttribute('width','1280');svg.setAttribute('height','720');
    maskImage.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));await maskImage.decode();
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');ctx.drawImage(maskImage,0,0);
    check(ctx.getImageData(256,223,1,1).data[3]===0&&ctx.getImageData(640,144,1,1).data[3]>0,'Native SVG rasterization confirms an actual transparent hole while untouched stroke pixels remain');
    background();key('z',{ctrlKey:true});check(objects().every(o=>!o.erasures),'One Ctrl+Z restores the entire continuous eraser stroke');
    tool('text');const fontBefore=Number(el('drawingSize').value);el('screen').dispatchEvent(new WheelEvent('wheel',{deltaY:-1,bubbles:true,cancelable:true}));
    check(Number(el('drawingSize').value)>fontBefore,'Text tool wheel adjusts font size without a video seek');
    background();key('d');await delay();check(!state.drawings.draft&&stored.length===eraseCount,'Pressing D again saves and exits the current group');
    state.drawings.records=[{id:'old',frameId:20,frameOrdinal:20,time:2,objects:copy(stored)},{id:'new',frameId:21,frameOrdinal:21,time:2.2,objects:copy(stored)}];
    state.playback={...state.playback,time:1.8};publish();
    const oldNode=el('drawingLayer').querySelector('[data-drawing-group="old"]');
    check(oldNode&&Math.abs(Number(oldNode.getAttribute('opacity'))-.2)<.001,'Annotation fades in according to video time before its own frame');
    state.playback={...state.playback,time:2.05};publish();
    let layers=[...el('drawingLayer').querySelectorAll('[data-drawing-group]')];
    check(layers.length===2&&layers.at(-1).getAttribute('data-drawing-group')==='new','Overlapping groups remain visible and the newly appearing group is above the older one');
    state.playback={...state.playback,time:2.1};publish();check(el('drawingLayer').querySelector('[data-drawing-group="old"]')===layers[0],'Opacity updates reuse existing SVG nodes rather than rebuilding every video frame');
    state.playback={...state.playback,time:2.4};publish();state.playback={...state.playback,time:2.1};publish();
    layers=[...el('drawingLayer').querySelectorAll('[data-drawing-group]')];
    check(layers.at(-1).getAttribute('data-drawing-group')==='old','Reverse observation also puts a newly appearing group above groups already visible');
    state.playback={...state.playback,time:3};publish();check(el('drawingLayer').hidden,'Groups disappear completely outside their uniform fade windows');
    state.interactionSettings={drawingFadeSeconds:0};state.playback={...state.playback,time:2.09,frameOrdinal:20};publish();check(el('drawingLayer').querySelectorAll('[data-drawing-group]').length===1&&el('drawingLayer').querySelector('[data-drawing-group=old]').getAttribute('opacity')==='1','Zero fade shows exactly the actual annotated source frame at full opacity');
    state.playback={...state.playback,time:2.11,frameOrdinal:99};publish();check(el('drawingLayer').hidden,'Zero fade hides graphics on every other frame');state.interactionSettings={drawingFadeSeconds:1};publish();check(!el('drawingLayer').hidden,'One-second configured fade updates visibility without rebuilding media');state.interactionSettings={drawingFadeSeconds:.25};
    state.playback={...state.playback,time:2};publish();background();key('d');await delay();

    tool('text');pointer(el('drawingLayer'),'pointerdown',[.16,.66]);input('画面文字随输入增长，不会自动换行');
    window.EVAUXProof = { checks: results, state, session, ui };
    const out = document.createElement('pre'); out.id = 'drawing-results'; out.hidden = true; out.textContent = JSON.stringify({ passed: true, checks: results }); document.body.appendChild(out);
  } catch (error) {
    ui?.destroy(); const out = document.createElement('pre'); out.id = 'drawing-results'; out.hidden = true; out.textContent = JSON.stringify({ passed: false, checks: results, objects: state.drawings.draft?.objects, error: error.stack }); document.body.appendChild(out);
  }
})();
