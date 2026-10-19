/* Loaded only by the optional local browser check, never by the plugin. */
(async function () {
  'use strict';
  const results = [], el = id => document.getElementById(id), wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let ui;
  function check(value, message) { if (!value) throw Error(message); results.push(message); }
  function sameScreen(rect, message) {
    const current = el('screen').getBoundingClientRect();
    check(['width', 'height', 'x', 'y'].every(k => Math.abs(current[k] - rect[k]) < .1), message);
  }
  const key = (type, value) => window.dispatchEvent(new KeyboardEvent(type, { key: value, code: 'Key' + value, bubbles: true, cancelable: true }));
  const pointer = (node, type, x) => node.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: el('timeline').getBoundingClientRect().y + 12,
    pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
  function labelsFit(message) {
    const labels = [...document.querySelectorAll('.tick-label')].map(n => n.getBoundingClientRect());
    const track = el('timeline').getBoundingClientRect();
    check(labels.length > 0 && labels.every((r, i) => r.left >= track.left - .5 && r.right <= track.right + .5 && (!i || r.left >= labels[i - 1].right + 2)), message);
  }
  try {
    let applies = 0;
    const state = { epoch: 1, state: 'paused', duration: 10, source: { name: '时间轴布局检查（无真实视频）' },
      playback: { time: 3, frameOrdinal: 30, frameCount: 100, transport: { rate: 1,
        loop: { enabled: false, valid: true, startOrdinal: 20, endOrdinal: 40, startTime: 2, endTime: 4, endBoundary: 4.1 } } },
      comments: { status: 'ready', draft: null, items: [{ id: 'inside', time: 3, text: '片段内' }, { id: 'outside', time: 8, text: '片段外' }] } };
    const publish = () => ui.update(state);
    const session = {
      async pause() { state.state = 'paused'; publish(); }, async play() { state.state = 'playing'; publish(); },
      async setLoopEnabled(enabled) { state.playback.transport.loop.enabled = enabled; publish(); return { status: 'applied' }; },
      async seek(time, options) { const ordinal = options.index ?? Math.max(0, Math.min(99, Math.floor(time * 10 + 1e-8)));
        state.playback = { ...state.playback, time: ordinal / 10, frameOrdinal: ordinal }; state.state = 'paused'; publish(); return { status: 'drawn' }; },
      loopFrameAt(time, bounds) { const ordinal = Math.max(bounds.minOrdinal ?? 0, Math.min(bounds.maxOrdinal ?? 99, bounds.ordinal ?? Math.floor(time * 10 + 1e-8)));
        return { ordinal, time: ordinal / 10 }; },
      async applyLoopRange(value) { applies++; state.playback.transport.loop = { ...value, enabled: true, valid: true,
        startTime: value.startOrdinal / 10, endTime: value.endOrdinal / 10, endBoundary: (value.endOrdinal + 1) / 10 };
        state.playback.time = value.startOrdinal / 10; state.state = 'playing'; publish(); return { status: 'playing' }; },
      async clearLoop() { state.playback.transport.loop = { valid: false, enabled: false }; publish(); },
      async seekComment(id) { const item = state.comments.items.find(v => v.id === id), loop = state.playback.transport.loop;
        if (loop.enabled && (item.time < loop.startTime || item.time >= loop.endBoundary)) loop.enabled = false;
        return this.seek(item.time, { kind: 'annotation', final: true }); },
      cacheCoverageSnapshot() { return { sessionEpoch: 1, epoch: 1, revision: 1, duration: 10, decodedFrames: 40, totalFrames: 100,
        ranges: [{ start: 1, end: 5 }] }; }
    };
    ui = EVAUI.createUI(); ui.bindSession(session); publish(); await wait(30);
    const screen = el('screen').getBoundingClientRect();
    labelsFit('whole-video labels stay inside track without overlap');
    const ticks = el('timeRuler').firstChild;
    for (let n = 0; n < 30; n++) publish();
    check(el('timeRuler').firstChild === ticks, 'frame updates keep ruler nodes');
    key('keydown', 'L'); await wait(10);
    check(el('timeline').dataset.view === 'loop' && state.state === 'playing', 'native L expands loop and starts playback');
    sameScreen(screen, 'loop expansion keeps video layout fixed'); labelsFit('focused fractional labels do not overlap');
    check(document.querySelectorAll('.comment-marker')[1].hidden, 'offscreen marker is hidden rather than clamped to edge');
    key('keydown', 'R'); check(el('timeline').dataset.view === 'loop', 'R keydown does not flash whole before hold threshold');
    await wait(280);
    check(el('timeline').dataset.view === 'full' && state.state === 'paused', 'native Window timer enters held whole-video edit');
    sameScreen(screen, 'held edit keeps video layout fixed');
    const rect = el('timeline').getBoundingClientRect();
    pointer(el('loopHandleEnd'), 'pointerdown', rect.left + rect.width * .8);
    pointer(window, 'pointermove', rect.left + rect.width * .7);
    const hint = el('timeHint').getBoundingClientRect(), ruler = el('timeRuler').getBoundingClientRect(), handle = el('loopHandleEnd').getBoundingClientRect();
    check(hint.top >= ruler.bottom && hint.bottom <= handle.top + .5, 'selection hint sits between ruler and endpoint label');
    key('keyup', 'R'); await wait(10);
    check(applies === 1 && state.playback.transport.loop.endOrdinal === 70 && el('timeline').dataset.view === 'loop', 'release during drag confirms exactly once and expands new range');
    pointer(window, 'pointerup', rect.right); check(applies === 1, 'late mouse release cannot reconfirm');
    sameScreen(screen, 'confirmation keeps video layout fixed');
    key('keydown', 'R'); await wait(280); key('keyup', 'R'); await wait(10);
    check(applies === 1 && state.state === 'paused' && el('timeline').dataset.view === 'loop', 'unchanged hold restores focused paused view');
    key('keydown', 'R'); await wait(280); key('keydown', 'Escape'); key('keyup', 'R'); await wait(10);
    check(applies === 1 && el('timeline').dataset.view === 'loop' && state.state === 'paused', 'Esc restores range and focused paused view');
    const help = document.querySelector('.shortcut-help'); help.open = true; sameScreen(screen, 'shortcut overlay does not resize video'); help.open = false;
    document.querySelector('.workspace').style.width = '660px'; window.dispatchEvent(new Event('resize')); await wait(10);
    labelsFit('narrow-track labels remain inside bounds');
    const narrowScreen = el('screen').getBoundingClientRect();
    key('keydown', 'R'); await wait(280); sameScreen(narrowScreen, 'narrow held edit keeps video layout fixed');
    key('keyup', 'R'); await wait(10);
    document.querySelectorAll('.comment-item')[1].click(); await wait(10);
    check(!state.playback.transport.loop.enabled && el('timeline').dataset.view === 'full' && state.playback.time === 8, 'outside sidebar note disables looping and returns whole');
    check(state.playback.transport.loop.startOrdinal === 20 && state.playback.transport.loop.endOrdinal === 70, 'outside note preserves confirmed endpoints');
    key('keydown', 'L'); await wait(10);
    key('keydown', 'L'); await wait(10);
    check(el('timeline').dataset.view === 'full' && !state.playback.transport.loop.enabled, 'L off returns whole and keeps endpoints');
    check(!el('loopHandleStart').hidden && !el('loopHandleEnd').hidden, 'disabled loop retains endpoint markers');
    key('keydown', 'L'); await wait(10); key('keydown', 'R'); key('keyup', 'R'); await wait(10);
    check(el('timeline').dataset.view === 'full' && el('loopHandleStart').hidden, 'short R clears endpoints and whole view');
    document.querySelector('.workspace').style.width = ''; window.dispatchEvent(new Event('resize')); await wait(10);
    document.body.dataset.e08Result = 'pass';
  } catch (error) {
    document.body.dataset.e08Result = 'fail'; results.push({ error: error.stack || String(error) });
  } finally {
    if (ui) ui.destroy();
    const pre = document.createElement('pre'); pre.id = 'e08-browser-results'; pre.hidden = true;
    pre.textContent = JSON.stringify({ result: document.body.dataset.e08Result, checks: results, userAgent: navigator.userAgent }); document.body.appendChild(pre);
    document.title = 'E08 ' + document.body.dataset.e08Result;
  }
})();
