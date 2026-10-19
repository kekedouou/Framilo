/* Native browser check only: actual UI, no Eagle, media or real export. */
(async function () {
  'use strict';
  const results = [], el = id => document.getElementById(id), wait = () => new Promise(resolve => setTimeout(resolve, 10));
  const check = (value, text) => { if (!value) throw Error(text); results.push(text); };
  const key = (value, options = {}) => (options.target || window).dispatchEvent(new KeyboardEvent('keydown', { key: value, code: 'Key' + value.toUpperCase(), bubbles: true, cancelable: true, ...options }));
  let ui;
  try {
    const calls = []; let finishExport;
    const state = { epoch: 1, state: 'paused', duration: 10, source: { name: '快捷键检查（无真实视频）' },
      previewQuality: '720p', forwardPredecode: true, interactionSettings: { wheelFrames: 1, showCacheStrip: true, rateStep: .1 },
      memorySettings: { ramMiB: 1024, ramBytes: 1024 ** 3 }, comments: { status: 'ready', items: [], draft: null },
      playback: { time: 2, frameOrdinal: 20, frameCount: 100, transport: { rate: 1,
        loop: { valid: true, enabled: false, startTime: 1, endTime: 3, endBoundary: 3.1, startOrdinal: 10, endOrdinal: 30 } } } };
    const publish = () => ui.update(state);
    const session = {
      async setPlaybackRate(rate) { calls.push(['rate', rate]); state.playback.transport.rate = rate; publish(); return { status: 'applied' }; },
      async setPlaybackSettings(value) { calls.push(['settings', value]); state.interactionSettings = { wheelFrames: value.wheelFrames, showCacheStrip: value.showCacheStrip, rateStep: value.rateStep }; state.state = 'paused'; publish(); return { status: 'applied' }; },
      async beginComment() { calls.push(['note']); state.comments = { ...state.comments, draft: { id: 1, kind: 'add', status: 'editing', time: 2, text: '' } }; publish(); },
      cancelComment() { state.comments = { ...state.comments, draft: null }; publish(); },
      setCommentText() {},
      async beginExport(kind, destination) { calls.push(['export', kind, destination]); state.exportState = { status: 'busy', cancellable: false }; publish();
        await new Promise(resolve => { finishExport = resolve; }); state.exportState = {}; publish(); return { status: 'saved' }; }
    };
    ui = EVAUI.createUI(); ui.bindSession(session); publish();
    key('V'); await wait();
    check(el('playbackRate').value === '1.1' && el('playbackRate').selectedOptions[0].textContent === '1.1×', 'V selects a real visible 1.1x option instead of leaving the select blank');
    key('X'); await wait(); check(el('playbackRate').value === '1', 'X returns to 1x');
    el('playbackRate').value = '4'; el('playbackRate').dispatchEvent(new Event('change')); await wait();
    const rateCalls = calls.length; key('V'); await wait(); check(calls.length === rateCalls && state.playback.transport.rate === 4, '4x upper boundary causes no extra operation');
    key('Z'); await wait(); check(state.playback.transport.rate === 1, 'Z restores 1x');
    el('rateStep').value = '0.25'; publish(); key('V'); await wait();
    check(state.playback.transport.rate === 1.1 && el('rateStep').value === '0.25', 'pending step survives frame updates without affecting keys');
    el('memoryApply').click(); await wait(); key('V'); await wait();
    check(state.playback.transport.rate === 1.35 && el('playbackRate').selectedOptions[0].textContent === '1.35×', 'Apply changes step; intermediate native selection remains visible');
    check(state.playback.time === 2 && state.playback.transport.loop.startOrdinal === 10, 'changing speed/step retains frame and range');
    const protectedCount = calls.length;
    for (const letter of ['Z', 'X', 'V', 'N', 'S', 'E']) for (const extra of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { shiftKey: true }]) key(letter, extra);
    check(calls.length === protectedCount, 'native repeated/composing/modified keys do not trigger operations');
    key('N'); await wait(); check(state.comments.draft && document.activeElement === el('commentText'), 'N opens and focuses the existing annotation editor');
    const noteCount = calls.length;
    for (const letter of ['Z', 'X', 'V', 'N', 'S', 'E']) key(letter, { target: el('commentText') });
    check(calls.length === noteCount, 'letters typed in the annotation editor cannot change speed or export');
    el('commentCancel').click(); await wait(); el('timeline').focus();
    key('S'); key('S'); key('E'); el('exportFrame').click(); await wait();
    check(calls.filter(c => c[0] === 'export').length === 1 && calls.at(-1)[1] === 'frame', 'S and buttons share one pending export gate');
    check(calls.at(-1)[2].destination === 'local', 'S preserves the selected local destination');
    finishExport(); await wait(); key('E'); await wait();
    check(calls.filter(c => c[0] === 'export').length === 2 && calls.at(-1)[1] === 'clip', 'E uses the existing selected-clip export');
    finishExport(); await wait(); state.playback.transport.loop.valid = false; publish();
    const beforeInvalid = calls.length; key('E'); await wait(); check(calls.length === beforeInvalid, 'E cannot export an undefined clip');
    document.body.dataset.shortcutResult = 'pass';
  } catch (error) { document.body.dataset.shortcutResult = 'fail'; results.push({ error: error.stack || String(error) }); }
  finally {
    if (ui) ui.destroy(); const pre = document.createElement('pre'); pre.id = 'shortcut-browser-results'; pre.hidden = true;
    pre.textContent = JSON.stringify({ result: document.body.dataset.shortcutResult, checks: results, userAgent: navigator.userAgent }); document.body.appendChild(pre);
  }
})();
