(async function () {
  'use strict';
  const checks = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  window.__VFChecks = checks;
  const painted = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const expect = (value, message) => { if (!value) throw Error(message); };
  const el = id => { const node = document.getElementById(id); expect(node, 'Missing required UI: ' + id); return node; };
  const button = action => { const node = action.startsWith('close-') ? document.querySelector('[data-close="' + action.slice(6) + '"]') : document.querySelector('[data-action="' + action + '"]'); expect(node, 'Missing action: ' + action); return node; };
  const click = action => button(action).click();
  const rect = id => { const r = el(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const unchanged = (a, b, message) => expect(Object.keys(a).every(key => Math.abs(a[key] - b[key]) <= 1.5), message + ': ' + JSON.stringify({ before: a, after: b }));
  const visible = node => { const s = getComputedStyle(node); return !node.hidden && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && node.getBoundingClientRect().width > 0; };
  const pointer = (target, type, x, y, right = false) => target.dispatchEvent(new PointerEvent(type, { pointerId: 911, pointerType: 'mouse', isPrimary: true, button: right ? 2 : 0, buttons: type === 'pointerup' ? 0 : right ? 2 : 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  function rightGesture(dx = 0, dy = 0) {
    const r = rect('scene'), x = r.x + r.width * .45, y = r.y + r.height * .4;
    pointer(el('scene'), 'pointerdown', x, y, true);
    if (dx || dy) pointer(window, 'pointermove', x + dx, y + dy, true);
    pointer(window, 'pointerup', x + dx, y + dy, true);
  }
  const api = window.VFPreview;
  expect(api.model && api.model.state && typeof api.render === 'function' && typeof api.reset === 'function', 'Isolated model / render interface missing');
  api.reset(); const m = api.model; document.getElementById('dismissGuide')?.click(); await wait(250);
  for (const id of ['viewer', 'mediaRegion', 'scene', 'dock', 'edgeTrigger', 'timeline', 'annotationInput', 'annotationEditor', 'recordsPanel', 'recordGrid', 'selectedInfo', 'settingsPopover', 'guide', 'transientNotice']) el(id);
  expect(!m.state.recordsOpen && !m.state.settingsOpen && m.state.mode === 'watch', 'Default sample must open in watch mode');
  expect(!visible(el('recordsPanel')) && !visible(el('settingsPopover')), 'No permanent records / settings sidebar');
  for (const selector of ['#frameReadout', '#currentTime', '#duration', '#memoryUsage', '.timeline-ruler']) {
    const node = document.querySelector(selector); expect(!node || !visible(node), 'Development / numeric readouts must not be visible by default: ' + selector);
  }
  checks.push('Default centered scene has no permanent sidebar or development/numeric readouts');

  el('edgeTrigger').dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse', bubbles: false }));
  await painted(); await Promise.all(el('dock').getAnimations().map(animation => animation.finished.catch(() => {})));
  expect(visible(el('dock')), 'Approaching right edge must expose the actions');
  el('edgeTrigger').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse', bubbles: false }));
  await wait(Number(api.getParams().hideDelay) + 80); await painted();
  await Promise.all(el('dock').getAnimations().map(animation => animation.finished.catch(() => {})));
  expect(!visible(el('dock')), 'Leaving right edge must hide idle actions after the configured delay');
  checks.push('Right-edge hover reveals actions and leaving collapses them after the configured delay');

  const focusSnapshot = () => {
    const style = getComputedStyle(el('dock'));
    return { active: document.activeElement?.outerHTML.slice(0, 180), hasFocus: document.hasFocus(), disabled: button('annotation').disabled, dock: el('viewer').dataset.dock, opacity: style.opacity, visibility: style.visibility, display: style.display };
  };
  window.__VFFocusDiagnostics = { before: focusSnapshot() };
  button('annotation').focus(); await painted();
  window.__VFFocusDiagnostics.afterPaint = focusSnapshot();
  await Promise.all(el('dock').getAnimations().map(animation => animation.finished.catch(() => {})));
  window.__VFFocusDiagnostics.afterTransition = focusSnapshot();
  expect(visible(el('dock')), 'Keyboard focus must reveal the right-side actions');
  const delay = Number(api.getParams().hideDelay) || 1000;
  await wait(Math.min(1600, delay + 100));
  expect(visible(el('dock')) && document.activeElement === button('annotation'), 'Focused actions must not auto-hide');
  button('annotation').blur();
  checks.push('Keyboard focus reveals dock and prevents unintended auto-hide');

  const base = rect('scene');
  if (!m.state.playing) m.togglePlay(); api.render();
  click('records'); await wait(280);
  expect(m.state.recordsOpen && m.state.playing, 'Opening records must preserve active playback');
  const cards = [...el('recordGrid').querySelectorAll('[data-record-id]')];
  expect(cards.length === m.state.records.length, 'Each distinct source frame must have one card');
  expect(cards.every(card => card.querySelector('canvas,img,svg')), 'Every record needs a visible preview thumbnail');
  expect(cards.every(card => !card.innerText.trim()), 'Record cards should contain thumbnails without permanent text labels');
  cards[1].click(); await wait(60);
  expect(!m.state.playing && m.state.recordsOpen && m.state.frame === m.state.records[1].frame, 'Selecting a record must jump, pause, and keep records expanded');
  expect(visible(el('selectedInfo')), 'Selected record must expose concise information above the thumbnails');
  const recordsGeometry = rect('scene');
  click('annotation'); await wait(100);
  expect(m.state.mode === 'annotation' && visible(el('annotationEditor')), 'Unified annotation editor must open');
  unchanged(recordsGeometry, rect('scene'), 'Annotation opened from records must not move the video');
  expect(visible(el('annotationInput')) && visible(el('scene')), 'Text input and drawing scene must be available together');
  m.cancelDraft(true); api.render(); await wait(60);
  expect(m.state.recordsOpen, 'Exiting record-origin annotation must restore the record panel');
  click('close-records'); await wait(280);
  expect(!m.state.recordsOpen && !m.state.playing, 'Closing records must preserve paused state');
  unchanged(base, rect('scene'), 'Closing records must restore the original video geometry');
  checks.push('Records retain playback, show thumbnail-only cards, pause on selection, retain panel, and restore video geometry');

  m.seek(37); api.render(); const beforeEdit = rect('scene'); click('annotation'); await wait(80);
  expect(m.state.mode === 'annotation' && !m.state.playing, 'Beginning annotation must pause on a fixed frame');
  unchanged(beforeEdit, rect('scene'), 'Beginning annotation from watch must not shift video');
  const input = el('annotationInput'); input.value = '浏览器样稿检查：能量边缘'; input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(m.state.draft.text === input.value, 'Text input must update the same unified draft');
  const canvas = rect('scene');
  pointer(el('scene'), 'pointerdown', canvas.x + canvas.width * .2, canvas.y + canvas.height * .25);
  pointer(window, 'pointermove', canvas.x + canvas.width * .3, canvas.y + canvas.height * .3);
  pointer(window, 'pointerup', canvas.x + canvas.width * .45, canvas.y + canvas.height * .38);
  expect(m.state.draft.objects.length > 0 && m.state.draft.text.length > 0, 'Text and drawing must coexist in one draft');
  expect(m.cancelDraft() === 'confirm' && m.state.draft, 'Dirty draft exit must require protection');
  const protectedText = m.state.draft.text;
  expect(m.saveDraft('failed') === 'failed', 'Failure simulation must remain in failed status'); api.render();
  expect(visible(el('annotationEditor')) && input.value === protectedText, 'Failed save must retain visible editor and input');
  m.updateText(protectedText); api.render();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); await wait(100);
  expect(m.state.mode === 'watch' && !m.state.draft, 'Enter must save and exit unified annotation');
  const saved = m.state.records.find(record => record.frame === 37);
  expect(saved && saved.entries.some(entry => entry.text === protectedText) && saved.objects.length > 0, 'Saved record must contain text and drawing together');
  unchanged(beforeEdit, rect('scene'), 'Saving unified annotation must preserve geometry');
  checks.push('Unified fixed-frame annotation supports text + drawing, guarded exit, retained failed-save draft, and Enter save');

  m.togglePlay(); api.render(); const beforeSettings = rect('scene'); click('settings'); await wait(80);
  expect(m.state.settingsOpen && !m.state.playing && visible(el('settingsPopover')), 'Settings must float and pause playback');
  unchanged(beforeSettings, rect('scene'), 'Opening settings must not move video');
  click('close-settings'); await wait(80);
  expect(!m.state.settingsOpen && !m.state.playing, 'Closing settings must not resume playback');
  unchanged(beforeSettings, rect('scene'), 'Closing settings must preserve geometry');
  checks.push('Floating settings pause without changing scene geometry and stay paused on close');

  const marker = el('timeline').querySelector('[data-frame], [data-record-id]');
  expect(marker, 'Thin timeline must provide clickable annotation markers');
  const frame = marker.dataset.frame !== undefined ? Number(marker.dataset.frame) : m.state.records.find(record => record.id === marker.dataset.recordId)?.frame;
  m.togglePlay(); api.render(); marker.click(); await wait(40);
  expect(m.state.frame === frame && !m.state.playing, 'Timeline annotation marker must jump to the corresponding frame and pause');
  checks.push('Timeline annotation markers jump to source frame and pause');

  click('clip'); m.setEndpoint(20, 'start'); m.setEndpoint(40, 'end'); api.render();
  rightGesture(-48, 0); expect(m.state.selection.active === 'start' && m.state.frame === 20, 'Left right-button flick must choose selection head');
  rightGesture(48, 0); expect(m.state.selection.active === 'end' && m.state.frame === 40, 'Right right-button flick must choose selection tail');
  rightGesture(); expect(m.state.loop.enabled && m.state.playing && m.state.mode === 'watch', 'Short right-click must confirm complete selection and start looping');
  m.beginSelection(); m.controlEndpoint('start'); api.render(); expect(m.state.selection.active === 'start', 'Selection must support controlling the start endpoint');
  m.cancelSelection(); api.render(); expect(m.state.loop.start === 20 && m.state.loop.end === 40, 'Cancelling selection must restore existing endpoints');
  checks.push('Selection right-button flicks choose head / tail, short right-click confirms, and cancellation restores previous loop');
  m.seek(39); api.render(); click('annotation'); await wait(60);
  el('annotationInput').value = '右键保存检查'; el('annotationInput').dispatchEvent(new Event('input', { bubbles: true }));
  rightGesture(); expect(m.state.mode === 'watch' && m.state.records.some(record => record.frame === 39), 'Short right-click on scene must save and exit annotation');
  checks.push('Short right-click on scene saves and exits unified annotation');
  api.reset(); document.getElementById('dismissGuide')?.click();
  return checks;
})()
