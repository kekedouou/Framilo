(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORE_KEY = 'vf-ui05-versions-v1', STORE_SCHEMA = 'vf-ui05-versions-store-v1', SCHEMA = 'vf-ui05-design-v1';
  const MAX_BYTES = 64 * 1024, MAX_VERSIONS = 12;
  const defaults = { glassOpacity:.2, blur:22, panelWidth:288, radius:3, hideDelay:650, editorHeight:82 };
  const ranges = { glassOpacity:[.08,.55], blur:[0,36], panelWidth:[220,360], radius:[0,8], hideDelay:[150,1800], editorHeight:[48,128] };
  const descriptions = {
    glassOpacity:['玻璃不透明度',.01,''], blur:['背景模糊',1,'px'], panelWidth:['记录栏宽度',1,'px'],
    radius:['面板圆角',1,'px'], hideDelay:['自动收起延迟',50,'ms'], editorHeight:['标注框高度',1,'px']
  };
  const aspects = ['wide','portrait','square'], parameterNames = Object.keys(defaults);
  const forbidden = new Set(['__proto__','prototype','constructor']);
  let params = { ...defaults }, aspect = 'wide', versions = [], selectedId = null, counter = 0;
  let view = 'new', compareSide = null, storageProblem = '', previewPhase = 'loading';
  const iframe = $('preview');
  const cloneParams = value => Object.fromEntries(parameterNames.map(name => [name,value[name]]));
  function report(message, error = false) { $('labMessage').textContent = message; $('labMessage').dataset.error = String(error); }
  function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
  function noPollution(value) {
    const pending = [{ value,depth:0 }], seen = new Set();
    while (pending.length) {
      const item = pending.pop();
      if (!item.value || typeof item.value !== 'object') continue;
      if (item.depth > 8 || seen.has(item.value)) return false;
      seen.add(item.value);
      for (const key of Object.keys(item.value)) {
        if (forbidden.has(key)) return false;
        pending.push({ value:item.value[key],depth:item.depth + 1 });
      }
    }
    return true;
  }
  function keysOnly(value, keys) { return plain(value) && Object.keys(value).every(key => keys.includes(key)) && keys.every(key => Object.prototype.hasOwnProperty.call(value,key)); }
  function validParams(value, partial = false) {
    return plain(value) && noPollution(value) && Object.keys(value).every(name => parameterNames.includes(name) && typeof value[name] === 'number' && Number.isFinite(value[name]) && value[name] >= ranges[name][0] && value[name] <= ranges[name][1]) && (partial || parameterNames.every(name => Object.prototype.hasOwnProperty.call(value,name)));
  }
  function validName(value) { return typeof value === 'string' && !!value.trim() && value.trim().length <= 40; }
  function validDesign(value) { return keysOnly(value,['schema','name','params','aspect']) && noPollution(value) && value.schema === SCHEMA && validName(value.name) && validParams(value.params) && aspects.includes(value.aspect); }
  function preview() { try { return iframe.contentWindow?.VFPreview || null; } catch (_) { return null; } }
  const sameParams = (actual, expected) => actual && parameterNames.every(name => actual[name] === expected[name]);
  function applyPreview(nextParams, nextAspect) {
    // The outer workbench owns design parameters. Keep restored / newly chosen
    // values pending until this iframe document has completed initialization.
    if (view === 'baseline' || previewPhase === 'loading') return true;
    const api = preview();
    if (!api) { report('播放器样稿尚未就绪，参数暂未应用。',true); return false; }
    // setParams posts an iframe snapshot; set the aspect first so that snapshot
    // cannot restore the previous aspect in the outer controls asynchronously.
    try {
      const applied = api.setAspect(nextAspect) !== false && api.setParams(cloneParams(nextParams)) !== false;
      if (!applied || !sameParams(api.getParams(),nextParams)) { report('播放器未确认这组参数，已保留工作台中的版本。',true); return false; }
      return true;
    }
    catch (_) { report('播放器样稿尚未就绪，参数暂未应用。',true); return false; }
  }
  function syncControls() {
    for (const name of parameterNames.filter(key=>!['glassOpacity','blur','radius'].includes(key))) {
      $('param-' + name).value = String(params[name]);
      $('value-' + name).textContent = name === 'glassOpacity' ? Math.round(params[name] * 100) + '%' : params[name] + descriptions[name][2];
    }
    $('aspect').value = aspect;
  }
  function setParams(value) {
    if (!validParams(value,true)) { report('参数无效：只接受已列出的参数及其范围内数值。',true); return false; }
    const next = { ...params,...value };
    if (!applyPreview(next,aspect)) return false;
    params = next; syncControls(); compareSide = null; syncCompare(); return true;
  }
  function setAspect(value) {
    if (!aspects.includes(value)) return false;
    if (!applyPreview(params,value)) return false;
    aspect = value; syncControls(); compareSide = null; syncCompare(); return true;
  }
  function buildControls() {
    for (const name of parameterNames.filter(key=>!['glassOpacity','blur','radius'].includes(key))) {
      const group = document.createElement('div'); group.className = 'param-control';
      const label = document.createElement('label'); label.htmlFor = 'param-' + name;
      const caption = document.createElement('span'); caption.textContent = descriptions[name][0];
      const output = document.createElement('output'); output.id = 'value-' + name; output.htmlFor = 'param-' + name;
      label.append(caption,output);
      const input = document.createElement('input'); input.type = 'range'; input.id = 'param-' + name; input.min = ranges[name][0]; input.max = ranges[name][1]; input.step = descriptions[name][1];
      input.addEventListener('input',() => { if (setParams({ [name]:Number(input.value) })) report(view === 'baseline' ? '参数已暂存，返回新样稿后应用。' : ''); });
      group.append(label,input); $('paramControls').append(group);
    }
  }
  function validStoredVersion(value) {
    return keysOnly(value,['id','name','params','aspect','createdAt']) && noPollution(value) && typeof value.id === 'string' && /^v-[a-z0-9-]{1,64}$/.test(value.id) && validName(value.name) && validParams(value.params) && aspects.includes(value.aspect) && Number.isSafeInteger(value.createdAt) && value.createdAt > 0;
  }
  function loadVersions() {
    try {
      const text = localStorage.getItem(STORE_KEY); if (text === null) return;
      const stored = JSON.parse(text);
      if (!keysOnly(stored,['schema','versions']) || !noPollution(stored) || stored.schema !== STORE_SCHEMA || !Array.isArray(stored.versions) || stored.versions.length > MAX_VERSIONS || !stored.versions.every(validStoredVersion) || new Set(stored.versions.map(value => value.id)).size !== stored.versions.length) throw Error('invalid');
      versions = stored.versions.map(value => ({ ...value,name:value.name.trim(),params:cloneParams(value.params) }));
    } catch (_) { storageProblem = '本地版本记录无法读取；未覆盖原记录。参数调节仍可使用。'; report(storageProblem,true); }
  }
  function persist(next) {
    if (storageProblem) { report(storageProblem,true); return false; }
    try { localStorage.setItem(STORE_KEY,JSON.stringify({ schema:STORE_SCHEMA,versions:next })); return true; }
    catch (_) { report('版本未保存：浏览器存储不可用或空间不足。可导出当前参数后重试。',true); return false; }
  }
  function option(id, name) { const node = document.createElement('option'); node.value = id; node.textContent = name; return node; }
  function rebuildVersions() {
    const previousA = $('compareA').value, previousB = $('compareB').value;
    for (const id of ['versionList','compareA','compareB']) {
      const select = $(id); select.replaceChildren();
      if (!versions.length) select.append(option('','尚未保存版本'));
      else for (const version of versions) select.append(option(version.id,version.name));
      select.disabled = !versions.length;
    }
    if (selectedId) $('versionList').value = selectedId;
    if (versions.length) {
      $('compareA').value = versions.some(value => value.id === previousA) ? previousA : versions[0].id;
      $('compareB').value = versions.some(value => value.id === previousB) ? previousB : versions[versions.length - 1].id;
    }
    $('versionCount').textContent = versions.length + ' / ' + MAX_VERSIONS;
    for (const id of ['applyVersion','deleteVersion','applyA','applyB','toggleCompare']) $(id).disabled = !versions.length;
    syncCompare();
  }
  function syncCompare() {
    const current = compareSide && versions.find(value => value.id === $(compareSide === 'A' ? 'compareA' : 'compareB').value);
    $('toggleCompare').textContent = compareSide === 'A' ? '切换到 B' : '切换到 A';
    $('compareState').textContent = current ? '正在查看 ' + compareSide + '：' + current.name : versions.length < 2 ? '先保存两个版本，再比较参数。' : '比较仅替换参数，保留当前播放与标注状态。';
  }
  function appendVersion(name, versionParams, versionAspect) {
    if (!validName(name)) { report('请输入1～40字的版本名。',true); return false; }
    if (versions.length >= MAX_VERSIONS) { report('已达到12个版本，请先导出或删除不需要的版本。',true); return false; }
    let id; do { id = 'v-' + Date.now().toString(36) + '-' + (++counter).toString(36); } while (versions.some(value => value.id === id));
    const item = { id,name:name.trim(),params:cloneParams(versionParams),aspect:versionAspect,createdAt:Date.now() };
    const next = [...versions,item]; if (!persist(next)) return false;
    versions = next; selectedId = id; rebuildVersions(); $('versionName').value = item.name; return id;
  }
  function saveVersion(name) {
    const id = appendVersion(name,params,aspect); if (id) report('已保存参数版本：' + name.trim()); return id;
  }
  function applyVersion(id) {
    const item = versions.find(value => value.id === id);
    if (!item) { report('没有找到该参数版本。',true); return false; }
    if (!applyPreview(item.params,item.aspect)) return false;
    params = cloneParams(item.params); aspect = item.aspect; selectedId = id; compareSide = null;
    syncControls(); $('versionList').value = id; $('versionName').value = item.name; syncCompare(); report('已应用：' + item.name); return true;
  }
  function exportVersion() {
    const selected = versions.find(value => value.id === $('versionList').value);
    const name = validName($('versionName').value) ? $('versionName').value.trim() : selected?.name || '当前参数';
    return { schema:SCHEMA,name,params:cloneParams(params),aspect };
  }
  function importVersion(text) {
    if (typeof text !== 'string' || text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) { report('导入失败：JSON文件不能超过64 KiB。',true); return false; }
    let value;
    try { value = JSON.parse(text); } catch (_) { report('导入失败：不是有效的JSON文件。',true); return false; }
    if (!validDesign(value)) { report('导入失败：格式、字段、参数范围或版本名不符合样稿要求。',true); return false; }
    const id = appendVersion(value.name,value.params,value.aspect); if (!id) return false;
    if (!applyVersion(id)) { report('已导入参数版本，但样稿暂未应用；请稍后点击应用。',true); return id; }
    report('已导入并应用：' + value.name.trim()); return id;
  }
  function applyCompare(side) {
    const id = $(side === 'A' ? 'compareA' : 'compareB').value;
    if (!applyVersion(id)) return false;
    compareSide = side; syncCompare(); return true;
  }
  function switchView(next) {
    if (next === view) return;
    view = next; $('newView').setAttribute('aria-pressed',String(next === 'new')); $('baselineView').setAttribute('aria-pressed',String(next === 'baseline'));
    $('viewNote').textContent = next === 'baseline' ? '正在比较现状布局结构；不运行旧正式产品，也不代表性能对照。' : '现状结构只比较布局，不运行旧正式产品。';
    previewPhase = 'loading'; iframe.dataset.ready = 'false'; iframe.dataset.configAck = 'false';
    iframe.src = next === 'baseline' ? '../baseline.html' : 'index.html';
  }
  $('aspect').addEventListener('change',event => setAspect(event.target.value));
  $('resetParams').addEventListener('click',() => { if (setParams(defaults)) report('已恢复六项参数初值。'); });
  $('saveVersion').addEventListener('click',() => saveVersion($('versionName').value));
  $('versionName').addEventListener('keydown',event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); saveVersion($('versionName').value); } });
  $('applyVersion').addEventListener('click',() => applyVersion($('versionList').value));
  $('deleteVersion').addEventListener('click',() => {
    const id = $('versionList').value, deleted = versions.find(value => value.id === id); if (!deleted) return;
    const next = versions.filter(value => value.id !== id); if (!persist(next)) return;
    versions = next; selectedId = versions[versions.length - 1]?.id || null; compareSide = null; rebuildVersions(); report('已删除参数版本：' + deleted.name);
  });
  $('exportVersion').addEventListener('click',() => {
    let url = null;
    try {
      const data = exportVersion(), blob = new Blob([JSON.stringify(data,null,2)],{ type:'application/json' });
      url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
      link.download = data.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_') + '.json'; document.body.append(link); link.click(); link.remove();
      report('已请求下载设计参数JSON；不含媒体或标注。');
    } catch (_) { report('无法导出JSON：当前浏览器不支持下载。',true); }
    finally { if (url) setTimeout(() => URL.revokeObjectURL(url),1000); }
  });
  $('importVersion').addEventListener('click',() => $('importFile').click());
  $('importFile').addEventListener('change',async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { if (file.size > MAX_BYTES) report('导入失败：JSON文件不能超过64 KiB。',true); else importVersion(await file.text()); }
    catch (_) { report('无法读取所选JSON文件。',true); }
    finally { event.target.value = ''; }
  });
  $('applyA').addEventListener('click',() => applyCompare('A')); $('applyB').addEventListener('click',() => applyCompare('B'));
  $('toggleCompare').addEventListener('click',() => applyCompare(compareSide === 'A' ? 'B' : 'A'));
  for (const id of ['compareA','compareB']) $(id).addEventListener('change',() => { compareSide = null; syncCompare(); });
  $('newView').addEventListener('click',() => switchView('new')); $('baselineView').addEventListener('click',() => switchView('baseline'));
  $('fault').addEventListener('change',() => { const api = preview(); if (api) { api.setFault($('fault').value); report('仅内存模拟：' + $('fault').selectedOptions[0].textContent); } else report('请先返回新样稿，再演示保存保护。',true); });
  $('resetSample').addEventListener('click',() => { const api = preview(); if (api) { api.reset(); api.setFault($('fault').value); report('已重置内存示例；设计参数与版本保留。'); } });
  $('showGuide').addEventListener('click',() => preview()?.showGuide()); $('hideGuide').addEventListener('click',() => preview()?.dismissGuide());
  function onPreviewLoad() {
    iframe.dataset.ready = 'false'; iframe.dataset.configAck = 'false';
    if (view !== 'new') { previewPhase = 'baseline'; return; }
    previewPhase = 'applying';
    const api = preview(); if (!api) { previewPhase = 'failed'; report('播放器样稿未能加载，请使用本地预览地址打开。',true); return; }
    if (!applyPreview(params,aspect)) { previewPhase = 'failed'; return; }
    api.setFault($('fault').value); previewPhase = 'ready'; iframe.dataset.ready = 'true';
  }
  iframe.addEventListener('load',onPreviewLoad);
  window.addEventListener('message',event => {
    if (previewPhase !== 'ready' || event.source !== iframe.contentWindow || event.origin !== location.origin || event.data?.type !== 'vf-state' || !validParams(event.data.params) || !aspects.includes(event.data.aspect)) return;
    // Startup snapshots and old A/B echoes may arrive after load. They are
    // acknowledgements only and can never replace the workbench-owned values.
    if (sameParams(event.data.params,params) && event.data.aspect === aspect) iframe.dataset.configAck = 'true';
  });
  buildControls(); syncControls(); loadVersions();
  selectedId = versions[versions.length - 1]?.id || null; rebuildVersions();
  if (selectedId) applyVersion(selectedId);
  window.VFLab = {
    saveVersion,applyVersion,exportVersion,importVersion,
    getVersions:() => versions.map(value => ({ ...value,params:cloneParams(value.params) })),
    setParams,getParams:() => cloneParams(params)
  };
  // A cached iframe can finish before this deferred script binds its listener.
  // Verify its current document directly rather than relying on a timed retry.
  if (preview() && iframe.contentDocument?.readyState === 'complete') onPreviewLoad();
})();
