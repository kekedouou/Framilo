'use strict';

// Real UI controllers, deterministic DOM/clock/session doubles. No media,
// browser, Eagle process, cache or permanent annotations are touched.
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { createUI } = require('../plugin/ui.js');
const microtasks = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function node(tagName = 'div') {
  const handlers = new Map(), attributes = {}, classes = new Set();
  const value = { tagName, children: [], dataset: {}, attributes, disabled: false, hidden: false, width: 1280, height: 720,
    clientWidth: 260, clientHeight: 300, scrollTop: 0, textContent: '', offsetWidth: 80,
    style: { setProperty(key, data) { this[key] = data; }, removeProperty(key) { delete this[key]; } },
    classList: { add(key) { classes.add(key); }, remove(key) { classes.delete(key); }, contains(key) { return classes.has(key); }, toggle(key, enabled) { if (enabled) classes.add(key); else classes.delete(key); } },
    setAttribute(key, data) { attributes[key] = String(data); }, removeAttribute(key) { delete attributes[key]; },
    addEventListener(type, fn, capture = false) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push({ fn, capture }); },
    removeEventListener(type, fn) { handlers.set(type, (handlers.get(type) || []).filter(item => item.fn !== fn)); },
    fire(type, data = {}) { const event = { type, target: this, pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, stopPropagation() {}, ...data };
      for (const item of [...handlers.get(type) || []].sort((a, b) => Number(!!b.capture) - Number(!!a.capture))) { item.fn(event); if (event.stopped) break; } return event; },
    dispatchEvent(event) { this.fire(event.type, event); },
    append(...children) { for (const child of children) { child.remove?.(); child.parentNode = child.parentElement = this; this.children.push(child); } },
    appendChild(child) { this.append(child); }, prepend(child) { child.remove?.(); child.parentNode = child.parentElement = this; this.children.unshift(child); },
    replaceChildren(...children) { for (const child of this.children) child.parentNode = child.parentElement = null; this.children = []; this.append(...children); },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = this.parentElement = null; },
    insertBefore(child, before) { child.remove?.(); const at = this.children.indexOf(before); child.parentNode = child.parentElement = this; this.children.splice(at < 0 ? this.children.length : at, 0, child); },
    contains(child) { return child === this || this.children.some(item => item.contains?.(child)); },
    closest(selector) { return selector.split(',').some(key => key === tagName || key === '[role="slider"]' && attributes.role === 'slider') ? this : this.parentElement?.closest(selector) || null; },
    querySelector(selector) { const key = selector.slice(1); for (const child of this.children) { if (String(child.className || '').split(' ').includes(key)) return child; const found = child.querySelector?.(selector); if (found) return found; } return null; },
    getBoundingClientRect() { return { left: 100, top: 0, width: 200, height: 200, right: 300, bottom: 200 }; },
    getContext() { return { clearRect() {}, fillRect() {}, scale() {} }; }, focus() {}, setPointerCapture() {}, hasPointerCapture() { return false; },
    animate() {} };
  Object.defineProperties(value, { firstChild: { get() { return this.children[0]; } }, nextSibling: { get() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; } } });
  return value;
}
function uiHarness() {
  const elements = new Map(), win = node(), frames = new Map(); let serial = 0, clock = 0;
  win.requestAnimationFrame = fn => { const id = ++serial; frames.set(id, fn); return id; }; win.cancelAnimationFrame = id => frames.delete(id);
  const doc = { getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); } };
  const ui = createUI({ document: doc, window: win, now: () => clock }), pending = [], calls = [];
  const session = { seek(time, options) { calls.push({ time, ...options }); return new Promise(resolve => pending.push({ time, resolve, due: clock + 1500 })); }, step() {}, saveComment() { calls.push({ saved: true }); } };
  const state = { epoch: 1, state: 'paused', duration: 10, playback: { time: 2, frameId: 120, frameOrdinal: 120, frameCount: 601 }, comments: { status: 'ready' } };
  ui.bindSession(session); ui.update(state);
  return { ui, win, doc, calls, pending, state, el: id => doc.getElementById(id), clock: value => { clock = value; },
    flushFrames() { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } } };
}
async function cursorCases() {
  const h = uiHarness(), observed = []; h.el('timeline').fire('pointerdown', { clientX: 140 });
  for (let n = 0; n < 240; n++) {
    h.clock(n * 1000 / 60); const x = 110 + (n % 180), target = (x - 100) / 200 * 10;
    h.win.fire('pointermove', { clientX: x });
    h.ui.update({ ...h.state, state: 'seeking', playback: { ...h.state.playback, pendingTargets: 1, targetTime: target } });
    for (const item of h.pending) if (!item.done && item.due <= n * 1000 / 60) { item.done = true; item.resolve({ status: 'superseded' }); }
    await microtasks(); observed.push({ target, cursor: parseFloat(h.el('thumb').style.left), actual: h.el('currentTime').textContent });
    assert(Math.abs(observed.at(-1).cursor - target * 10) < 1e-8); assert.equal(h.el('currentTime').textContent, '0:02.000');
    assert.equal(h.el('frameReadout').textContent, '第 121 / 601 帧');
  }
  h.win.fire('pointerup', { clientX: 244, buttons: 0 }); const final = h.pending.at(-1);
  assert.equal(h.calls.at(-1).kind, 'release'); assert(Math.abs(final.time - 7.2) < 1e-9);
  for (const elapsed of [500, 1000, 1499]) {
    h.clock(4000 + elapsed); h.ui.update({ ...h.state, state: 'seeking', playback: { ...h.state.playback, pendingTargets: 1 } });
    assert.equal(h.el('thumb').style.left, '72%', 'Release must not return to the stale actual frame');
  }
  h.ui.update({ ...h.state, playback: { time: 7.2, frameId: 432, frameOrdinal: 432, frameCount: 601, pendingTargets: 0 } });
  final.resolve({ status: 'drawn' }); await microtasks(); assert.equal(h.el('thumb').style.left, '72%');
  for (const old of h.pending.slice(0, -1)) old.resolve({ status: 'superseded' }); await microtasks(); assert.equal(h.el('thumb').style.left, '72%');
  h.ui.destroy(); console.log('ok E36 UI: 240 latest-intent inputs, 1500ms virtual frame delay, physical release and stale outcomes remain independent from actual frame readouts');

  const screen = uiHarness(); screen.el('screen').fire('pointerdown'); screen.win.fire('pointermove', { clientX: 160 }); screen.flushFrames();
  const requested = screen.calls.at(-1).time; assert.equal(parseFloat(screen.el('thumb').style.left), requested * 10);
  screen.win.fire('pointerup', { clientX: 180, buttons: 0 }); assert(screen.calls.at(-1).final);
  const last = screen.calls.at(-1).time; screen.ui.update({ ...screen.state, state: 'seeking', playback: { ...screen.state.playback, pendingTargets: 1 } });
  assert.equal(parseFloat(screen.el('thumb').style.left), last * 10);
  screen.ui.update({ ...screen.state, epoch: 2, playback: { time: 3, frameId: 180 } });
  screen.pending.at(-1).resolve({ status: 'drawn' }); await microtasks(); assert.equal(screen.el('thumb').style.left, '30%'); screen.ui.destroy();
  console.log('ok E36 UI: screen gesture seek shares intent ownership and a prior source completion cannot move the new source cursor');

  const preview = uiHarness(); preview.ui.update({ ...preview.state, preview: { active: true }, comments: { status: 'ready', draft: { id: 'n', kind: 'new', status: 'editing', text: 'actual frame', time: 2 } } });
  assert(preview.el('drawingLayer').hidden); assert(preview.el('drawingSave').disabled); assert(preview.el('commentSave').disabled);
  preview.el('commentSave').fire('click'); assert(!preview.calls.some(item => item.saved));
  assert(preview.win.fire('keydown', { key: 'Enter', code: 'Enter' }).defaultPrevented);
  preview.ui.update({ ...preview.state, preview: { active: false } }); assert.equal(preview.el('drawingExitSave').disabled, false);
  preview.ui.destroy(); console.log('ok E36 UI: temporary preview hides drawing and prevents save without changing picture geometry');
}

async function shellCases() {
  const elements = new Map(), workspace = node(), pane = node(), settings = node(), win = node(), timers = new Map(); let serial = 0, rendered = 0, released = 0, pauses = 0;
  settings.className = 'memory-settings'; workspace.className = 'workspace'; pane.className = 'player-pane'; workspace.append(pane, settings);
  const doc = { activeElement: null, hidden: false, documentElement: { dataset: {} },
    getElementById(id) { if (id === 'screenGestureRing') return null; if (!elements.has(id)) { const el = node(); elements.set(id, el); pane.append(el); } return elements.get(id); },
    createElement: node, querySelector(selector) { return selector === '.workspace' ? workspace : selector === '.player-pane' ? pane : selector === '.memory-settings' ? settings : null; },
    addEventListener() {}, removeEventListener() {} };
  Object.assign(win, { innerWidth: 1200, innerHeight: 800, localStorage: { getItem: () => 'seen' }, matchMedia: () => ({ matches: true }),
    requestAnimationFrame: fn => { fn(); return 1; } });
  const context = { window: win, Event: class { constructor(type) { this.type = type; } },
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); }, Option: class {} };
  win.EVAIcons = { svg: () => '<svg></svg>' }; win.EVASettingsView = { create({ settings: host }) { const footer = node(); footer.className = 'shell-settings-footer'; host.append(footer); return { update() {}, close() {}, destroy() {}, contains: () => false }; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/graphite-shell.js'), 'utf8'), context);
  const priorities = [], prioritySources = [], state = { epoch: 1, state: 'preparing', duration: 30, source: { id: 'a', name: 'fixture' }, comments: { items: Array.from({ length: 20 }, (_, n) => ({ id: String(n), time: n + 1, text: 'note' })) }, playback: null, drawings: {} };
  state.comments.items.push({ id: 'duplicate', time: 1, text: 'same frame' });
  const session = { annotationFrame: time => state.state === 'preparing' ? null : time * 60, prioritizeRecords(value) { assert(state.playback && state.state !== 'preparing', 'Session must be able to consume priorities'); priorities.push(JSON.parse(JSON.stringify(value))); prioritySources.push(state.source.id); },
    pause() { pauses++; }, async renderThumbnail(time, canvas) { rendered++; canvas.width = 160; canvas.height = 90; return { release() { released++; } }; } };
  const shell = win.EVAGraphite.createShell({ document: doc, window: win, getState: () => state, getSession: () => session, annotate() {}, clip() {}, exitDrawing() {} });
  shell.update(state); assert.equal(priorities.length, 0, 'Early comments must not be marked as delivered to an unready Session');
  state.source = { ...state.source, sha256: 'a'.repeat(64) }; shell.update(state);
  assert.equal(priorities.length, 0, 'Source SHA arriving before the player does not make the record service ready');
  state.state = 'playing'; state.playback = { time: 0 }; shell.update(state);
  assert.deepEqual(priorities.at(-1), { all: Array.from({ length: 20 }, (_, n) => n + 1), visible: [] }, 'Final ready must replay the same comment collection without opening records');
  for (let n = 0; n < 240; n++) { state.playback.time = n / 60; shell.update(state); }
  assert.equal(priorities.length, 1, 'Playback ticks must not requeue the same preparation sets');
  shell.records(); assert(priorities.at(-1).visible.length > 0 && priorities.at(-1).visible.length < 10, 'Visible means viewport rows, not the overscan cache');
  for (let n = 0; n < 12; n++) { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } await microtasks(); }
  assert(rendered > 0 && rendered <= 10); assert.equal(pauses, 0, 'Independent thumbnail requests must not pause active playback');
  const list = workspace.querySelector('.shell-record-list'); list.scrollTop = 600; const before = priorities.length; list.fire('scroll');
  assert.equal(priorities.length, before + 1); assert(priorities.at(-1).visible.every(time => time > 1));
  shell.records(); assert.deepEqual(priorities.at(-1).visible, []);
  state.source = { id: 'b', name: 'next source' }; shell.update(state); assert.equal(priorities.length, before + 3, 'Source changes reissue priorities even with unchanged time sets');
  const delivered = priorities.length;
  state.epoch++; state.state = 'preparing'; state.playback = null; state.source = { id: 'c', sha256: 'c'.repeat(64) }; state.comments.items = [{ id: 'c-note', time: 4, text: 'superseded source' }]; shell.update(state);
  state.epoch++; state.source = { id: 'd', sha256: 'd'.repeat(64) }; state.comments.items = [{ id: 'd-note', time: 8, text: 'current source' }]; shell.update(state);
  assert.equal(priorities.length, delivered, 'Neither unready source may consume an obsolete priority collection');
  state.state = 'paused'; state.playback = { time: 0 }; shell.update(state);
  assert.equal(priorities.length, delivered + 1); assert.deepEqual(priorities.at(-1), { all: [8], visible: [] });
  assert.equal(prioritySources.at(-1), 'd'); assert(!prioritySources.includes('c'), 'A superseded unready source must not leak records into the ready source');
  shell.destroy(); assert.equal(released, rendered);
  console.log('ok E36 shell: early comments/SHA replay at actual ready, closed-record preparation, deduplicated priorities, source isolation and playing thumbnail cleanup');
}
async function main() { await cursorCases(); await shellCases(); console.log('E36 UI models passed; virtual clock and DOM doubles do not prove Chrome latency or real Eagle acceptance.'); }
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
