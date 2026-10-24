'use strict';
// Deterministic iframe lifecycle regression. No browser, files written, or timers.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname,'lab.js'),'utf8');
const html = fs.readFileSync(path.join(__dirname,'lab.html'),'utf8');
const defaults = { glassOpacity:.2,blur:22,panelWidth:288,radius:20,hideDelay:650,editorHeight:82 };
const savedParams = { ...defaults,panelWidth:312,radius:22 };
const storeKey = 'vf-ui01-versions-v1';
const seed = () => new Map([[storeKey,JSON.stringify({ schema:'vf-ui01-versions-store-v1',versions:[
  { id:'v-old-a',name:'A',params:defaults,aspect:'wide',createdAt:1 },
  { id:'v-saved-b',name:'B',params:savedParams,aspect:'portrait',createdAt:2 }
] })]]);

function boot({ apiBeforeScript = false, readyState = 'loading', storage = seed() } = {}) {
  const nodes = new Map(), windowEvents = new Map(), messages = [];
  let quota = false, childParams = { ...defaults }, childAspect = 'wide', setCalls = 0;
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.value = ''; this.dataset = {}; this.events = new Map(); this.disabled = false; this.textContent = ''; }
    set id(value) { this._id = value; nodes.set(value,this); } get id() { return this._id; }
    append(...items) { this.children.push(...items); if (this.tag === 'select' && !this.value && items[0]) this.value = items[0].value; }
    replaceChildren(...items) { this.children = []; if (this.tag === 'select') this.value = ''; this.append(...items); }
    addEventListener(type,fn) { const handlers = this.events.get(type) || []; handlers.push(fn); this.events.set(type,handlers); }
    dispatch(type) { for (const fn of this.events.get(type) || []) fn({ target:this }); }
    setAttribute(key,value) { this[key] = value; } click() { this.dispatch('click'); } remove() {}
  }
  for (const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"/g)) { const element = new Element(match[1]); element.id = match[2]; }
  const frame = nodes.get('preview'); frame.contentWindow = {}; frame.contentDocument = { readyState };
  nodes.get('fault').value = 'none';
  const childApi = {
    setAspect(value) { childAspect = value; return true; },
    setParams(value) { setCalls++; childParams = { ...childParams,...value }; messages.push({ type:'vf-state',params:{ ...childParams },aspect:childAspect }); return true; },
    getParams() { return { ...childParams }; }, setFault() {}, showGuide() {}, dismissGuide() {}, reset() {}
  };
  if (apiBeforeScript) frame.contentWindow.VFPreview = childApi;
  const sandbox = {
    document:{ getElementById:id => nodes.get(id),createElement:tag => new Element(tag),body:new Element('body') },
    localStorage:{ getItem:key => storage.get(key) ?? null,setItem(key,value) { if (quota) throw Error('quota'); storage.set(key,value); } },
    window:{ addEventListener(type,fn) { const handlers = windowEvents.get(type) || []; handlers.push(fn); windowEvents.set(type,handlers); },
      __dispatch(event) { for (const fn of windowEvents.get('message') || []) fn(event); } },
    location:{ origin:'http://127.0.0.1:43719' },TextEncoder,Blob,URL,
    setTimeout() { throw Error('Lifecycle regression must not use timed retries.'); }
  };
  vm.createContext(sandbox); vm.runInContext(source,sandbox);
  const run = code => vm.runInContext(code,sandbox);
  const emit = value => run('window.__dispatch({source:document.getElementById("preview").contentWindow,origin:location.origin,data:JSON.parse(' + JSON.stringify(JSON.stringify(value)) + ')})');
  return {
    run,frame,storage,messages,emit,
    params:() => JSON.parse(run('JSON.stringify(window.VFLab.getParams())')),
    design:() => JSON.parse(run('JSON.stringify(window.VFLab.exportVersion())')),
    childParams:() => childApi.getParams(),childAspect:() => childAspect,setCalls:() => setCalls,
    load(withApi = true) { if (withApi) frame.contentWindow.VFPreview = childApi; frame.contentDocument.readyState = 'complete'; frame.dispatch('load'); },
    blockStorage(value) { quota = value; }
  };
}
let checks = 0;
function test(name,fn) { fn(); checks++; console.log('ok ' + checks + ' - ' + name); }
const defaultMessage = { type:'vf-state',params:defaults,aspect:'wide' };

test('saved version survives default iframe snapshots before and after load',() => {
  const lab = boot();
  assert.deepEqual(lab.params(),savedParams); assert.equal(lab.design().aspect,'portrait');
  lab.emit(defaultMessage); assert.deepEqual(lab.params(),savedParams);
  lab.load(); assert.deepEqual(lab.childParams(),savedParams); assert.equal(lab.childAspect(),'portrait');
  lab.emit(defaultMessage); assert.deepEqual(lab.params(),savedParams); assert.deepEqual(lab.childParams(),savedParams);
  assert.equal(lab.frame.dataset.ready,'true');
});
test('an exposed API is not called until its loading document has completed',() => {
  const lab = boot({ apiBeforeScript:true });
  assert.equal(lab.setCalls(),0); lab.emit(defaultMessage); assert.deepEqual(lab.params(),savedParams);
  lab.load(); assert.equal(lab.setCalls(),1); assert.deepEqual(lab.childParams(),savedParams);
});
test('cached iframe loaded before deferred workbench script is restored without a timer',() => {
  const lab = boot({ apiBeforeScript:true,readyState:'complete' });
  assert.equal(lab.frame.dataset.ready,'true'); assert.deepEqual(lab.childParams(),savedParams);
  lab.emit(defaultMessage); assert.deepEqual(lab.params(),savedParams); assert.equal(lab.design().aspect,'portrait');
});
test('delayed A/B echoes cannot replace the latest selected version',() => {
  const lab = boot(); lab.load();
  assert.equal(lab.run('window.VFLab.applyVersion("v-old-a")'),true);
  assert.equal(lab.run('window.VFLab.applyVersion("v-saved-b")'),true);
  for (const message of lab.messages.slice().reverse()) lab.emit(message);
  lab.emit(defaultMessage); assert.deepEqual(lab.params(),savedParams); assert.deepEqual(lab.childParams(),savedParams);
  assert.equal(lab.design().aspect,'portrait');
});
test('missing API reports failure and keeps recovered design available for a later load',() => {
  const lab = boot(); lab.load(false); assert.equal(lab.frame.dataset.ready,'false');
  assert.equal(lab.run('window.VFLab.applyVersion("v-saved-b")'),false);
  assert.deepEqual(lab.params(),savedParams); lab.load(); assert.deepEqual(lab.childParams(),savedParams);
});
test('baseline navigation and return preserve the workbench-owned configuration',() => {
  const lab = boot(); lab.load();
  lab.run('document.getElementById("baselineView").click()'); lab.emit(defaultMessage); lab.load();
  assert.deepEqual(lab.params(),savedParams);
  lab.run('document.getElementById("newView").click()'); lab.emit(defaultMessage); lab.load();
  assert.deepEqual(lab.params(),savedParams); assert.deepEqual(lab.childParams(),savedParams);
});
test('storage quota failure and invalid import do not claim or mutate a saved version',() => {
  const lab = boot(); lab.load(); lab.blockStorage(true);
  assert.equal(lab.run('window.VFLab.saveVersion("quota")'),false);
  assert.equal(lab.run('window.VFLab.getVersions().length'),2); lab.blockStorage(false);
  assert.equal(lab.run('window.VFLab.importVersion(JSON.stringify({...window.VFLab.exportVersion(),extra:true}))'),false);
  assert.equal(lab.run('window.VFLab.getVersions().length'),2);
  assert.deepEqual(lab.params(),savedParams);
});
console.log('Passed ' + checks + ' deterministic lab lifecycle scenarios.');
