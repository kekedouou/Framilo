/* Ephemeral input state only. Source-frame mapping/playback belong to Session/Player. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'object' && window) window.EVALoopSelection = api;
  else if (root && root.document) root.EVALoopSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createSelection(options) {
    const { getSession, getState, changed } = options;
    const later = options.setTimeout || setTimeout, stop = options.clearTimeout || clearTimeout;
    let draft = null, press = null, message = '', messageFading = false, fadeTimer = null, messageTimer = null, messageToken = 0, busy = false, action = 0, seenEpoch = getState().epoch;
    const ready = () => !!getSession() && !getState().comments?.draft && ['paused', 'playing', 'seeking'].includes(getState().state);
    const loop = () => getState().playback?.transport?.loop;
    const live = value => draft === value && value.session === getSession() && value.epoch === getState().epoch && ready();
    function clearMessage() {
      ++messageToken;if(fadeTimer!==null)stop(fadeTimer);if(messageTimer!==null)stop(messageTimer);
      fadeTimer=messageTimer=null;message='';messageFading=false;
    }
    function announce(text, transient = false) {
      clearMessage();message=text||'';
      if(transient&&message){const token=messageToken,epoch=getState().epoch;
        fadeTimer=later(()=>{if(token!==messageToken||epoch!==getState().epoch)return;fadeTimer=null;messageFading=true;changed();},1840);
        messageTimer=later(()=>{if(token!==messageToken||epoch!==getState().epoch)return;messageTimer=null;clearMessage();changed();},2000);
      }changed();
    }
    const forgetPress = () => { if (press) stop(press.timer); press = null; };
    function snapshot() { return { editing: !!draft, mode: draft?.mode, start: draft?.start || null, end: draft?.end || null,
      active: draft?.active || null, controlled: !!draft?.controlled, busy: busy || !!draft?.initializing || !!draft?.finishing, message, messageFading }; }
    function cancel(pause = true) {
      const old = draft; draft = null; ++action; busy = false; forgetPress(); clearMessage();
      if (pause && old && old.session === getSession() && old.epoch === getState().epoch && ready()) {
        // A seek to the displayed frame cancels an unfinished preview/commit;
        // pause alone does not cancel an outstanding source-frame request.
        const shown = getState().playback;
        if (shown && Number.isSafeInteger(shown.frameOrdinal))
          Promise.resolve(old.session.seek(shown.time, { index: shown.frameOrdinal, final: true, kind: 'loop-cancel' })).catch(() => {});
        else Promise.resolve(old.session.pause()).catch(() => {});
      }
      changed();
    }
    async function begin(mode) {
      if (!ready() || busy) return;
      if (draft) { draft.mode = mode; changed(); return; }
      const saved = loop();
      const value = draft = { session: getSession(), epoch: getState().epoch, mode, initializing: true, active: null, modified: false,
        originalStart: saved?.startOrdinal ?? null, originalEnd: saved?.endOrdinal ?? null,
        start: saved?.startOrdinal != null ? { ordinal: saved.startOrdinal, time: saved.startTime } : null,
        end: saved?.endOrdinal != null ? { ordinal: saved.endOrdinal, time: saved.endTime } : null, pending: Promise.resolve({ status: 'drawn' }) };
      clearMessage(); changed();
      try { await value.session.pause(); if (live(value)) { value.initializing = false; changed(); } }
      catch (_) { if (live(value)) cancel(false); }
    }
    function move(point, time, final, inputAt, ordinal) {
      const value = draft;
      if (!value || !live(value) || value.initializing || value.finishing || !['start', 'end'].includes(point)) return false;
      const count = getState().playback?.frameCount;
      const bounds = point === 'start' ? { maxOrdinal: value.end ? value.end.ordinal : count - 1 } :
        { minOrdinal: value.start ? value.start.ordinal : 0 };
      if (ordinal !== undefined) bounds.ordinal = ordinal;
      const frame = value.session.loopFrameAt(time, bounds);
      if (!frame) { announce('该视频暂时无法选择两个不同的帧。'); return false; }
      value[point] = frame; value.active = point;
      value.modified = (value.start?.ordinal ?? null) !== value.originalStart || (value.end?.ordinal ?? null) !== value.originalEnd;
      clearMessage(); changed();
      value.pending = Promise.resolve(value.session.seek(frame.time, { index: frame.ordinal, final: !!final, inputAt, kind: 'loop-select' }))
        .catch(() => ({ status: 'error' }));
      return true;
    }
    function step(delta) {
      if (!draft || !draft.active) return false;
      const point = draft[draft.active] || { time: getState().playback.time, ordinal: getState().playback.frameOrdinal };
      return move(draft.active, point.time, true, undefined, point.ordinal + delta);
    }
    function selectEndpoint(point) {
      const value = draft;
      if (!value || !live(value) || value.initializing || value.finishing || !['start', 'end'].includes(point)) return;
      value.active = point; value.controlled = true; clearMessage(); changed();
      const frame = value[point];
      if (frame) value.pending = Promise.resolve(value.session.seek(frame.time, { index: frame.ordinal, final: true, kind: 'loop-endpoint' })).catch(() => ({ status: 'error' }));
      return value.pending;
    }
    async function finish() {
      const value = draft;
      if (!value || !live(value) || value.finishing) return;
      if (value.initializing || !value.start || !value.end) { cancel(); return; }
      value.finishing = true; changed();
      const result = await value.pending;
      if (!live(value)) return;
      if (!result || !['drawn', 'reused'].includes(result.status)) { cancel(); return; }
      try {
        if (value.start.ordinal >= value.end.ordinal) {
          await value.session.clearLoop();
          if (live(value)) { draft = null; clearMessage(); changed(); }
          return;
        }
        const applied = await value.session.applyLoopRange({ startOrdinal: value.start.ordinal, endOrdinal: value.end.ordinal });
        if (!live(value)) return;
        if (applied?.status === 'ignored') { await value.session.clearLoop(); if (!live(value)) return; }
        draft = null; clearMessage(); if(applied?.status === 'superseded')announce('选择已取消。',true);else changed();
      } catch (_) { if (live(value)) cancel(false); }
    }
    async function clearOrChoose() {
      if (!ready() || busy) return;
      if (draft) return finish();
      if (loop()?.startOrdinal == null && loop()?.endOrdinal == null) return begin('toggle');
      const active = getSession(), epoch = getState().epoch, token = ++action; busy = true; changed();
      try {
        if (getState().state === 'seeking') {
          const shown = getState().playback;
          await active.seek(shown.time, { index: shown.frameOrdinal, final: true, kind: 'loop-clear' });
        }
        if (token === action && active === getSession() && epoch === getState().epoch) await active.clearLoop();
      }
      catch (_) { /* Session publishes failures. */ }
      finally { if (token === action) { busy = false; changed(); } }
    }
    async function toggleLoop() {
      if (!ready() || draft || busy || !['paused', 'playing'].includes(getState().state)) return;
      if (!loop()?.valid) { announce('请先选择循环片段。', true); return; }
      const enabled = !loop().enabled, active = getSession(), epoch = getState().epoch, token = ++action;
      busy = true; clearMessage(); changed();
      try {
        const result = await active.setLoopEnabled(enabled);
        if (enabled && token === action && active === getSession() && epoch === getState().epoch &&
            result?.status !== 'superseded' && getState().state === 'paused') await active.play();
      } catch (_) { /* Session publishes failures. */ }
      finally { if (token === action) { busy = false; changed(); } }
    }
    function keyDown() {
      if (press || !ready() || busy) return;
      const value = press = { epoch: getState().epoch, held: false, timer: null };
      value.timer = later(() => {
        if (press !== value || value.epoch !== getState().epoch) return;
        value.held = true; begin('hold');
      }, 250);
    }
    function keyUp() {
      const value = press; if (!value) return;
      forgetPress();
      if (value.epoch !== getState().epoch) return;
      if (value.held) finish(); else clearOrChoose();
    }
    function update() {
      if (seenEpoch !== getState().epoch) { seenEpoch = getState().epoch; cancel(false); }
      if (press && (press.epoch !== getState().epoch || !ready())) forgetPress();
      if (draft && !live(draft)) cancel(false);
    }
    return { snapshot, begin, move, step, selectEndpoint, finish, cancel, clearOrChoose, toggleLoop, keyDown, keyUp, update,
      active(point) { if (draft && draft[point]) { draft.active = point; draft.controlled = true; changed(); } },
      nextPoint() { return !draft || draft.initializing || draft.finishing ? null : !draft.start ? 'start' : !draft.end ? 'end' : null; },
      blur() { cancel(); }, destroy() { cancel(false); } };
  }
  return { createSelection };
});
