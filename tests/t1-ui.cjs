'use strict';
const assert = require('assert');
const { createUI, pointerTime, formatTime, spaceAllowed } = require('../plugin/ui.js');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('ok ' + name); }
function target(tagName = 'div', parent = null) {
  const handlers = new Map(), paints = [];
  const context = { clearRect(...args) { paints.push(['clear',...args]); }, fillRect(...args) { paints.push(['fill',...args]); } };
  return { paints, getContext: () => context, style: {}, attributes: {}, tagName: tagName.toLowerCase(), parentElement: parent, disabled: false, hidden: false, textContent: '', offsetWidth: 80,
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    removeEventListener(type, fn) { if (handlers.has(type)) handlers.get(type).delete(fn); },
    fire(type, values = {}) { const e = { pointerId: 1, button: 0, buttons: 1, clientX: 100, preventDefault() { this.prevented = true; }, ...values }; for (const fn of handlers.get(type) || []) fn(e); return e; },
    setAttribute(name, value) { this.attributes[name] = value; }, replaceChildren(...children) { this.children = children; },
    getBoundingClientRect() { return { left: 100, width: 200 }; },
    focus() {}, setPointerCapture(id) { this.capture = id; }, hasPointerCapture(id) { return this.capture === id; }, releasePointerCapture() { this.capture = null; },
    closest(selector) {
      const matches = selector.split(',').some(part => part[0] !== '[' ? part === this.tagName
        : part === '[contenteditable]' ? Object.hasOwn(this.attributes, 'contenteditable')
        : /^\[role="([^"]+)"\]$/.test(part) && this.attributes.role === part.match(/^\[role="([^"]+)"\]$/)[1]);
      return matches ? this : this.parentElement ? this.parentElement.closest(selector) : null;
    } };
}
function harness() {
  const elements = new Map(), win = target(), calls = [], doc = { getElementById(id) { if (!elements.has(id)) elements.set(id, target()); return elements.get(id); } };
  const ui = createUI({ document: doc, window: win, now: () => 123 });
  doc.getElementById('timeline').setAttribute('role', 'slider');
  doc.getElementById('timeline').focus = () => { doc.activeElement = doc.getElementById('timeline'); };
  const session = { seek(time, options) { calls.push(['seek', time, options]); return Promise.resolve(); }, toggle() { calls.push(['toggle']); }, step(delta) { calls.push(['step', delta]); }, retry() { calls.push(['retry']); } };
  const state = { epoch: 1, state: 'paused', duration: 10, source: { name: '中文 空格.mp4' }, playback: { time: 2, frameId: 120 } };
  ui.bindSession(session); ui.update(state);
  return { ui, el: id => doc.getElementById(id), win, calls, state, doc };
}
test('Bracket shortcuts step globally, repeat safely, and protect text, composing and modifier input', () => {
  const h = harness();
  for (const [values, delta] of [[{ code: 'BracketLeft', key: '[' }, -1], [{ key: '】' }, 1], [{ key: '【', repeat: true }, -1], [{ code: 'BracketRight', key: ']' }, 1]]) {
    const event = h.win.fire('keydown', { ...values, target: h.el('next') });
    assert(event.prevented); assert.deepStrictEqual(h.calls[h.calls.length - 1], ['step', delta]);
  }
  const before = h.calls.length;
  for (const values of [{ isComposing: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { metaKey: true },
    { target: target('textarea') }, { target: target('input') }, { target: { isContentEditable: true } }])
    h.win.fire('keydown', { code: 'BracketLeft', key: '[', ...values });
  assert.strictEqual(h.calls.length, before);
  h.ui.update({ ...h.state, state: 'preparing' }); h.win.fire('keydown', { key: ']' }); assert.strictEqual(h.calls.length, before);
  h.ui.destroy(); h.win.fire('keydown', { key: '[' }); assert.strictEqual(h.calls.length, before);
});
test('Frame readout uses the actually displayed ordinal, not pending time, IDs or average FPS', () => {
  const h = harness();
  h.ui.update({ ...h.state, playback: { time: 2, frameId: 900, frameOrdinal: 5, frameCount: 56 } });
  assert.strictEqual(h.el('frameReadout').textContent, '第 6 / 56 帧');
  h.ui.update({ ...h.state, state: 'seeking', playback: { time: 2, frameId: 900, frameOrdinal: 5, frameCount: 56, targetFrameId: 999 } });
  assert.strictEqual(h.el('frameReadout').textContent, '第 6 / 56 帧');
  h.ui.update({ ...h.state, state: 'empty', playback: null }); assert.strictEqual(h.el('frameReadout').textContent, '帧：—');
  h.ui.destroy();
});
test('Time formatting rounds presentation only; pointer mapping clamps actual track bounds', () => {
  assert.strictEqual(formatTime(4.2509), '0:04.250'); assert.strictEqual(formatTime(61), '1:01.000');
  assert.strictEqual(pointerTime(50, { left: 100, width: 200 }, 10), 0);
  assert.strictEqual(pointerTime(400, { left: 100, width: 200 }, 10), 10);
  assert.strictEqual(pointerTime(200, { left: 100, width: 200 }, 10), 5);
  assert.strictEqual(pointerTime(200, { left: 100, width: 0 }, 10), null);
});
test('Space ignores repeat, composition, modifiers, text and focused controls', () => {
  assert(spaceAllowed({ key: ' ', target: target() }));
  for (const value of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { shiftKey: true }, { target: { isContentEditable: true } }, { target: { closest: () => ({}) } }]) assert(!spaceAllowed({ key: ' ', ...value }));
});
test('RAM form retains edited tier across frame updates and only applies on click', () => {
  const h = harness(), memory = { ramMiB: 1024, ramBytes: 1024 ** 3 };
  h.ui.update({ ...h.state, memorySettings: memory });
  h.el('memoryMiB').value = '2048'; h.ui.update({ ...h.state, memorySettings: memory });
  assert.equal(h.el('memoryMiB').value, '2048'); assert.equal(h.el('memoryApply').disabled, false);
  let requested = null;
  h.ui.bindSession({ setMemoryMiB(value) { requested = value; return Promise.resolve({ status: 'applied' }); } });
  h.ui.update({ ...h.state, memorySettings: memory }); h.el('memoryMiB').value = '2048';
  assert.equal(requested, null); h.el('memoryApply').fire('click'); assert.equal(requested, 2048);
  assert.equal(h.el('memoryApply').disabled, true); h.ui.destroy();
});
test('Other-cache clearing is disabled outside readiness and blocks duplicate clicks during cleanup',()=>{
  const h=harness();let calls=0;h.ui.bindSession({clearOtherCaches(){calls++;return Promise.resolve({status:'cleared',cleared:1,freedBytes:1024});}});
  h.ui.update({...h.state,memorySettings:{ramMiB:1024,ramBytes:1024**3}});
  h.el('cacheClearOther').fire('click');h.el('cacheClearOther').fire('click');assert.equal(calls,1);assert(h.el('cacheClearOther').disabled);assert(h.el('memoryApply').disabled);h.ui.destroy();
});
test('Space toggles once after dragging leaves the custom timeline focused', () => {
  const h = harness(); h.el('timeline').fire('pointerdown', { clientX: 240 }); h.win.fire('pointerup', { clientX: 240, buttons: 0 });
  h.ui.update({ ...h.state, playback: { time: 7, frameId: 420 } });
  assert.strictEqual(h.doc.activeElement, h.el('timeline'));
  const before = h.calls.length;
  const event = h.win.fire('keydown', { code: 'Space', key: ' ', target: h.doc.activeElement });
  assert(event.prevented); assert.strictEqual(h.calls.length, before + 1); assert.deepStrictEqual(h.calls[before], ['toggle']);
  h.win.fire('keydown', { code: 'Space', key: ' ', repeat: true, target: h.doc.activeElement });
  assert.strictEqual(h.calls.length, before + 1); h.ui.destroy();
});
test('Gesture thumb follows pointer while time hint remains the actual submitted frame', () => {
  const h = harness(); h.el('timeline').fire('pointerdown', { clientX: 260 });
  assert.strictEqual(h.el('thumb').style.left, '80%'); assert.strictEqual(h.calls[0][1], 8);
  assert.strictEqual(h.calls[0][2].inputAt, 123); assert.strictEqual(h.el('timeHint').textContent, '0:02.000');
  h.ui.update({ ...h.state, state: 'seeking', playback: { time: 3, frameId: 180 } });
  assert.strictEqual(h.el('thumb').style.left, '80%'); assert.strictEqual(h.el('timeHint').textContent, '0:03.000');
  assert.strictEqual(h.el('currentTime').textContent, '0:03.000'); assert(h.el('play').disabled);
  h.ui.destroy();
});
test('Capture loss does not freeze slider; release takes final physical coordinates', () => {
  const h = harness(); h.el('timeline').fire('pointerdown', { clientX: 180 });
  h.el('timeline').fire('lostpointercapture'); h.win.fire('pointermove', { clientX: 240 });
  assert.strictEqual(h.el('thumb').style.left, '70%');
  h.win.fire('pointerup', { clientX: 280, buttons: 0 });
  assert.strictEqual(h.calls[h.calls.length - 1][1], 9);
  assert.strictEqual(h.calls[h.calls.length - 1][2].kind, 'release');
  assert(!h.el('timeHint').hidden); assert.strictEqual(h.el('timeHint').textContent, '0:02.000'); h.ui.destroy();
});
test('Epoch switch cancels gesture without issuing a release against the new video', () => {
  const h = harness(); h.el('timeline').fire('pointerdown', { clientX: 260 }); const count = h.calls.length;
  h.ui.update({ ...h.state, epoch: 2, state: 'preparing', playback: null });
  h.win.fire('pointerup', { clientX: 300, buttons: 0 }); assert.strictEqual(h.calls.length, count);
  assert(h.el('play').disabled && h.el('previous').disabled); assert(h.el('timeHint').hidden);
  h.ui.destroy();
});
test('Blur settles last requested target; unrelated pointer and focus controls do not interfere', () => {
  const h = harness(); h.el('timeline').fire('pointerdown', { clientX: 240 }); const count = h.calls.length;
  h.win.fire('pointermove', { pointerId: 2, clientX: 300 }); assert.strictEqual(h.calls.length, count);
  h.win.fire('blur'); assert.strictEqual(h.calls[h.calls.length - 1][1], 7);
  h.win.fire('keydown', { key: ' ', target: target() }); assert.strictEqual(h.calls[h.calls.length - 1][0], 'toggle');
  const before = h.calls.length;
  h.win.fire('keydown', { key: ' ', target: { closest: () => ({}) } });
  h.win.fire('keydown', { key: ' ', repeat: true }); assert.strictEqual(h.calls.length, before);
  h.ui.destroy(); h.win.fire('keydown', { key: ' ' }); assert.strictEqual(h.calls.length, before);
});
test('Hint clamps to timeline edges, and UI renders material text without HTML interpretation', () => {
  const h = harness(); h.ui.update({ ...h.state, source: { name: '<script>素材</script>' }, playback: { time: 0, frameId: 0 } });
  h.el('timeline').fire('pointerdown'); assert.strictEqual(h.el('timeHint').style.left, '40px');
  h.ui.update({ ...h.state, playback: { time: 10, frameId: 600 } }); assert.strictEqual(h.el('timeHint').style.left, '160px');
  h.ui.update({ ...h.state, source: { name: '<script>素材</script>' } }); assert.strictEqual(h.el('sourceName').textContent, '<script>素材</script>');
  h.ui.destroy();
});
test('Space protects native controls, editable descendants and other sliders', () => {
  const h = harness(), timelineChild = target('span', h.el('timeline'));
  assert(spaceAllowed({ code: 'Space', target: timelineChild }, h.el('timeline')));
  const controls = ['button', 'input', 'textarea', 'select', 'a'].map(name => target(name));
  const textbox = target(), otherSlider = target(), editable = target();
  textbox.setAttribute('role', 'textbox'); otherSlider.setAttribute('role', 'slider'); editable.setAttribute('contenteditable', 'true');
  controls.push(textbox, otherSlider, editable, target('span', editable));
  const editableTimelineChild = target('span', h.el('timeline')); editableTimelineChild.setAttribute('contenteditable', 'true'); controls.push(editableTimelineChild);
  for (const control of controls) {
    const event = h.win.fire('keydown', { code: 'Space', key: ' ', target: control });
    assert(!event.prevented); assert.strictEqual(h.calls.length, 0);
  }
  h.ui.destroy();
});
test('Space during a held drag or nonplayable states cannot queue playback', () => {
  const h = harness(); h.el('timeline').fire('pointerdown', { clientX: 200 });
  const before = h.calls.length;
  h.win.fire('keydown', { code: 'Space', key: ' ', target: h.el('timeline') }); assert.strictEqual(h.calls.length, before);
  h.win.fire('pointerup', { clientX: 200, buttons: 0 });
  for (const state of ['empty', 'preparing', 'seeking', 'error', 'closed']) {
    h.ui.update({ ...h.state, state }); const count = h.calls.length;
    h.win.fire('keydown', { code: 'Space', key: ' ', target: h.el('timeline') }); assert.strictEqual(h.calls.length, count);
  }
  h.ui.update(h.state); assert.strictEqual(h.calls.filter(call => call[0] === 'toggle').length, 0); h.ui.destroy();
});
test('Release hint follows actual final frame, stays readable, and clears on a new operation or epoch', () => {
  const h = harness(); h.el('timeline').fire('pointerdown', { clientX: 300 }); h.win.fire('pointerup', { clientX: 300, buttons: 0 });
  assert.strictEqual(h.el('timeHint').textContent, '0:02.000');
  h.ui.update({ ...h.state, state: 'seeking', playback: { time: 3, frameId: 180 } });
  assert.strictEqual(h.el('timeHint').textContent, '0:03.000'); assert(!h.el('timeHint').hidden);
  h.ui.update({ ...h.state, playback: { time: 9.966666, frameId: 599 } });
  assert.strictEqual(h.el('timeHint').textContent, '0:09.966'); assert.strictEqual(h.el('currentTime').textContent, '0:09.966');
  assert.strictEqual(h.el('thumb').style.left, '99.66666%'); assert.strictEqual(h.el('timeHint').style.left, '160px');
  h.el('next').fire('click'); assert(h.el('timeHint').hidden);
  h.el('timeline').fire('pointerdown'); h.win.fire('pointerup', { buttons: 0 });
  h.ui.update({ ...h.state, epoch: 2 }); assert(h.el('timeHint').hidden);
  h.el('timeline').fire('pointerdown'); h.win.fire('pointerup', { buttons: 0 });
  h.ui.update({ ...h.state, epoch: 2, state: 'playing' }); assert(h.el('timeHint').hidden); h.ui.destroy();
});
test('Library-change empty state tells the user to call the plugin again', () => {
  const h = harness(); h.el('timeline').fire('pointerdown');
  h.ui.update({ state: 'empty', epoch: 2, duration: 0, source: null, playback: null, progress: { stage: 'library-changed', message: '素材库已变化，请重新调用插件。' } });
  assert.strictEqual(h.el('status').textContent, '素材库已变化，请重新调用插件。');
  assert.strictEqual(h.el('notice').textContent, '素材库已变化，请重新调用插件。');
  assert(!h.el('notice').hidden); assert(h.el('timeHint').hidden); assert(h.el('play').disabled); h.ui.destroy();
});
test('Continuous hint updates do not repeatedly force layout; resize and new gestures remeasure', () => {
  const h = harness(); let rectangles = 0, widths = 0, trackWidth = 200;
  h.el('timeline').getBoundingClientRect = () => { rectangles++; return { left: 100, width: trackWidth }; };
  Object.defineProperty(h.el('timeHint'), 'offsetWidth', { get() { widths++; return 80; } });
  h.el('timeline').fire('pointerdown', { clientX: 200 });
  const afterDown = { rectangles, widths };
  for (let i = 0; i < 120; i++) {
    h.win.fire('pointermove', { clientX: 200 + i / 10 });
    h.ui.update({ ...h.state, state: i % 2 ? 'seeking' : 'paused', playback: { time: i / 60, frameId: i } });
  }
  assert.equal(rectangles, afterDown.rectangles, 'No layout measurement inside the input/draw loop.');
  assert.equal(widths, afterDown.widths);
  trackWidth = 400; h.win.fire('resize');
  assert(rectangles > afterDown.rectangles && widths > afterDown.widths);
  h.ui.update({ ...h.state, playback: { time: 9.9, frameId: 594 } });
  assert.equal(h.el('timeHint').style.left, '360px');
  h.win.fire('pointerup', { clientX: 500, buttons: 0 });
  const afterResize = rectangles; trackWidth = 300; h.el('timeline').fire('pointerdown');
  assert(rectangles > afterResize); h.ui.destroy();
});
test('Identical observations do not rewrite static material text or ARIA attributes', () => {
  const h = harness(); let textWrites = 0, attributes = 0, sourceName = h.el('sourceName').textContent;
  Object.defineProperty(h.el('sourceName'), 'textContent', { get() { return sourceName; }, set(value) { textWrites++; sourceName = value; } });
  const set = h.el('timeline').setAttribute;
  h.el('timeline').setAttribute = function(name, value) { attributes++; set.call(this, name, value); };
  for (let i = 0; i < 120; i++) h.ui.update({ ...h.state });
  assert.equal(textWrites, 0); assert.equal(attributes, 0);
  h.ui.update({ ...h.state, source: { name: '另一视频' }, playback: { time: 3, frameId: 180 } });
  assert.equal(textWrites, 1); assert.equal(sourceName, '另一视频'); assert.equal(attributes, 2);
  h.ui.destroy();
});
test('Video RAM is current, distinct from process memory, and its timer ends on destroy', () => {
  const h = harness(); let tick, cleared = 0, budget = null;
  h.win.setInterval = (fn, ms) => { assert([500,50].includes(ms)); if(ms===500)tick=fn; return ms; };
  h.win.clearInterval = id => { assert([500,50].includes(id)); cleared++; };
  h.ui.bindSession({ memorySnapshot: () => budget });
  assert.equal(h.el('memoryUsage').textContent, '视频缓存 RAM：—');
  budget = { used: 128.5 * 1048576, limit: 512 * 1048576 }; tick();
  assert.equal(h.el('memoryUsage').textContent, '视频缓存 RAM：128.5 / 512 MiB');
  budget = null; tick(); assert.equal(h.el('memoryUsage').textContent, '视频缓存 RAM：—');
  h.ui.destroy(); assert.equal(cleared, 2); tick(); assert.equal(h.el('memoryUsage').textContent, '视频缓存 RAM：—');
});
test('E03 quality selection remains pending until unified apply, label uses actual source size', () => {
  const h=harness(), memory={ramMiB:1024,ramBytes:1024**3};let applied=null;
  const session={setPlaybackSettings(value){applied=value;return Promise.resolve({status:'applied'});}};
  h.el('qualitySelect').options=[{value:'720p'},{value:'1080p'}];h.ui.bindSession(session);
  h.ui.update({epoch:1,state:'paused',memorySettings:memory,previewQuality:'720p',preview:{quality:'720p',width:1280,height:720,
    sourceWidth:1920,sourceHeight:1080,sampleAspectRatio:'1:1',originalResolution:false}});
  assert.equal(h.el('qualitySelect').options[1].textContent,'1080p（原始分辨率）');
  h.el('qualitySelect').value='1080p';h.el('qualitySelect').fire('change');assert.equal(applied,null);
  h.el('memoryApply').fire('click');assert.deepEqual(applied,{ramMiB:1024,previewQuality:'1080p',forwardPredecode:false,wheelFrames:1,showCacheStrip:true});
  assert.equal(h.el('qualitySelect').disabled,true);h.ui.destroy();
});
test('E05 strip is sampled separately; unchanged residency and frame updates do not repaint or scan',()=>{
  const h=harness(),timers=new Map();let scans=0,coverage={sessionEpoch:1,epoch:4,revision:1,duration:10,
    decodedFrames:10,totalFrames:100,ranges:[{start:0,end:1},{start:8,end:10}],enabled:true,phase:'preparing'};
  h.win.setInterval=(fn,ms)=>{timers.set(ms,fn);return ms;};h.win.clearInterval=id=>timers.delete(id);
  h.ui.bindSession({cacheCoverageSnapshot(){scans++;return coverage;}});
  const strip=h.el('decodedCache'),paints=strip.paints.length,initialScans=scans;
  for(let i=0;i<120;i++)h.ui.update({...h.state,playback:{time:i/60}});
  assert.equal(scans,initialScans);assert.equal(strip.paints.length,paints);
  timers.get(50)();assert.equal(strip.paints.length,paints);
  assert.deepEqual(strip.paints.filter(p=>p[0]==='fill').slice(-2).map(p=>p.map(v=>typeof v==='number'?+v.toFixed(4):v)),
    [['fill',0,0,20,3],['fill',160,0,40,3]]);
  coverage={...coverage,enabled:false};timers.get(50)();assert(h.el('cacheStatus').textContent.includes('按需缓存'));assert.equal(strip.paints.length,paints);
  coverage={...coverage,revision:2,decodedFrames:9,ranges:[{start:8,end:10}]};timers.get(50)();assert(strip.paints.length>paints);
  h.ui.update({...h.state,epoch:2});assert.equal(h.el('cacheStatus').textContent,'');const cleared=strip.paints.length;
  timers.get(50)();assert.equal(strip.paints.length,cleared,'Stale source coverage cannot reappear.');
  h.ui.destroy();assert.equal(timers.size,0);
});
test('E04 switch keeps pending edits across frame updates and applies with unified settings',()=>{
  const h=harness();let applied;
  h.ui.bindSession({setPlaybackSettings(value){applied=value;return Promise.resolve({status:'applied'});}});
  const settings={...h.state,memorySettings:{ramMiB:1024,ramBytes:1024**3},previewQuality:'720p',forwardPredecode:true};
  h.ui.update(settings);assert.equal(h.el('forwardPredecode').checked,true);
  h.el('forwardPredecode').checked=false;h.ui.update({...settings,playback:{time:3}});assert.equal(h.el('forwardPredecode').checked,false);
  h.el('memoryApply').fire('click');assert.deepEqual(applied,{ramMiB:1024,previewQuality:'720p',forwardPredecode:false,wheelFrames:1,showCacheStrip:true});h.ui.destroy();
});
test('E05 fractional scaling fills the full rail; changing residency avoids repeated layout queries',()=>{
  const fs=require('fs'),path=require('path'),css=fs.readFileSync(path.join(__dirname,'../plugin/styles.css'),'utf8');
  const stripRule=css.match(/\.cache-strip\s*\{([^}]+)\}/)[1];assert(/object-fit:\s*fill/.test(stripRule));assert(/pointer-events:\s*none/.test(stripRule));
  for(const scale of [1,1.25,1.5,1.75,2,2.25]){
    const h=harness(),timers=new Map();let revision=1,layout=0;
    h.win.devicePixelRatio=scale;h.win.setInterval=(fn,ms)=>{timers.set(ms,fn);return ms;};h.win.clearInterval=id=>timers.delete(id);
    h.el('timeline').getBoundingClientRect=()=>{layout++;return {left:100,width:200};};
    h.ui.bindSession({cacheCoverageSnapshot:()=>({sessionEpoch:1,epoch:1,revision,duration:10,decodedFrames:100,totalFrames:100,ranges:[{start:0,end:10}],enabled:true,phase:'complete'})});
    const strip=h.el('decodedCache');assert.equal(strip.width,Math.round(200*scale));assert.equal(strip.height,Math.round(3*scale));
    assert.deepEqual(strip.paints.filter(p=>p[0]==='fill').pop(),['fill',0,0,strip.width,strip.height]);assert.equal(layout,1);
    for(let n=0;n<20;n++){revision++;timers.get(50)();}assert.equal(layout,1);
    h.win.fire('resize');assert.equal(layout,2);h.ui.destroy();assert.equal(timers.size,0);
  }
  const previousContainWidth=Math.min(200/250,3/4)*250;
  assert.equal(previousContainWidth,187.5,'At 125% the old contain rule created 6.25% total blank width.');
});
test('E06 controls act directly, display actual frame endpoints and obey editing/seek gates',()=>{
  const transport={rate:.5,loop:{enabled:false,valid:true,startOrdinal:2,endOrdinal:8,startTime:.2,endTime:.8}};
  for(const [id,event,value,method,argument]of [['playbackRate','change','0.25','setPlaybackRate',.25],
    ['loopEnabled','change',true,'setLoopEnabled',true],['loopSelect','click',null,'clearLoop',undefined]]){
    const h=harness(),calls=[];h.ui.bindSession({[method](arg){calls.push([method,arg]);return Promise.resolve({status:'applied'});}});
    h.ui.update({...h.state,playback:{time:.8,frameOrdinal:8,frameCount:100,transport}});
    assert(h.el('loopRange').textContent.includes('第3帧'));assert(h.el('loopRange').textContent.includes('第9帧'));assert.equal(h.el('playbackRate').value,'0.5');
    if(id==='playbackRate')h.el(id).value=value;if(id==='loopEnabled')h.el(id).checked=value;
    h.el(id).fire(event);assert.deepEqual(calls,[[method,argument]]);assert(h.el(id).disabled);h.ui.destroy();
  }
  const h=harness();h.ui.update({...h.state,playback:{time:.8,transport:{...transport,loop:{...transport.loop,valid:false,endOrdinal:null}}}});
  assert(h.el('loopEnabled').disabled);assert(!h.el('loopSelect').disabled);assert(h.el('loopRange').textContent.includes('未设'));
  assert(!h.el('loopHandleStart').hidden);assert(h.el('loopHandleEnd').hidden);
  h.ui.update({...h.state,state:'seeking'});for(const id of ['playbackRate','loopEnabled'])assert(h.el(id).disabled);
  h.ui.update({...h.state,comments:{draft:{id:'text',status:'editing',time:2,text:'a b'},items:[]}});assert(h.el('playbackRate').disabled);assert(h.el('loopSelect').disabled);
  h.ui.update({...h.state,epoch:2,state:'empty',playback:null});assert.equal(h.el('loopRange').textContent,'未设置范围');assert.equal(h.el('playbackRate').value,'1');h.ui.destroy();
});
test('Wheel steps on screen/track with applied sensitivity; sidebar, editing focus, modifiers, drag and stale states are protected',()=>{
  const h=harness();let e=h.el('screen').fire('wheel',{deltaY:-100});assert(e.prevented);assert.deepEqual(h.calls.pop(),['step',-1]);
  h.ui.update({...h.state,interactionSettings:{wheelFrames:5,showCacheStrip:true}});e=h.el('timeline').fire('wheel',{deltaY:1});assert(e.prevented);assert.deepEqual(h.calls.pop(),['step',5]);
  h.el('wheelFrames').value='10';h.el('screen').fire('wheel',{deltaY:-1});assert.deepEqual(h.calls.pop(),['step',-5],'Unsaved edits must not change sensitivity.');
  for(const extra of [{ctrlKey:true},{shiftKey:true},{altKey:true},{metaKey:true},{deltaY:0},{deltaY:NaN},{deltaY:1,deltaX:5}]){
    const before=h.calls.length;h.el('screen').fire('wheel',{deltaY:100,...extra});assert.equal(h.calls.length,before);
  }
  h.doc.activeElement=target('select');h.el('screen').fire('wheel',{deltaY:100});assert.equal(h.calls.length,0);h.doc.activeElement=null;
  h.el('sourceName').fire('wheel',{deltaY:100});assert.equal(h.calls.length,0);
  h.el('timeline').fire('pointerdown');const during=h.calls.length;h.el('screen').fire('wheel',{deltaY:100});assert.equal(h.calls.length,during);h.win.fire('pointerup');
  for(const patch of [{state:'preparing'},{state:'closed'},{comments:{draft:{status:'editing'},items:[]}}]){
    h.ui.update({...h.state,...patch});const before=h.calls.length;h.el('screen').fire('wheel',{deltaY:100});assert.equal(h.calls.length,before);
  }
  h.ui.destroy();const before=h.calls.length;h.el('screen').fire('wheel',{deltaY:100});assert.equal(h.calls.length,before);
});
test('Wheel/strip settings stay pending until apply; hidden green cache stops painting and returns at current revision',()=>{
  const h=harness(),timers=new Map();let applied=null,revision=1;
  h.win.setInterval=(fn,ms)=>{timers.set(ms,fn);return ms;};h.win.clearInterval=id=>timers.delete(id);
  h.ui.bindSession({setPlaybackSettings(v){applied=v;return Promise.resolve({status:'applied'});},cacheCoverageSnapshot:()=>({sessionEpoch:1,epoch:1,revision,duration:10,
    decodedFrames:2,totalFrames:10,ranges:[{start:0,end:2}],enabled:true,phase:'preparing'})});
  const state={...h.state,memorySettings:{ramMiB:1024,ramBytes:1024**3},previewQuality:'720p',forwardPredecode:true,interactionSettings:{wheelFrames:1,showCacheStrip:true}};
  h.ui.update(state);h.el('wheelFrames').value='5';h.el('showCacheStrip').checked=false;h.ui.update({...state,playback:{time:3}});
  assert.equal(h.el('wheelFrames').value,'5');assert.equal(h.el('showCacheStrip').checked,false);assert.equal(h.el('decodedCache').hidden,false);
  h.el('memoryApply').fire('click');assert.deepEqual(applied,{ramMiB:1024,previewQuality:'720p',forwardPredecode:true,wheelFrames:5,showCacheStrip:false});
  h.ui.update({...state,interactionSettings:{wheelFrames:5,showCacheStrip:false}});const before=h.el('decodedCache').paints.length;
  revision++;timers.get(50)();assert.equal(h.el('decodedCache').paints.length,before);assert(h.el('cacheStatus').textContent.includes('2 / 10'));
  h.ui.update({...state,interactionSettings:{wheelFrames:5,showCacheStrip:true}});timers.get(50)();assert(h.el('decodedCache').paints.length>before);assert(!h.el('decodedCache').hidden);h.ui.destroy();
});
console.log('T1 UI: ' + checks + ' in-memory checks passed; real layout/input experience not tested.');
