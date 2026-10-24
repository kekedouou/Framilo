'use strict';
// Static drawings only: there are no click handlers, media engines, or save APIs.
(function () {
  const params = new URLSearchParams(location.search);
  const requested = params.get('state') || 'records';
  const state = ['watch', 'records', 'annotation', 'settings'].includes(requested) ? requested : 'records';
  const icons = {
    annotation: '<path d="M4 18.5 5 14 16.5 2.5a2.1 2.1 0 0 1 3 3L8 17l-4 1.5Zm10.5-14 3 3M4 22h16"/>',
    clip: '<path d="M8 4H4v16h4M16 4h4v16h-4M9 12h6"/>',
    records: '<rect x="4" y="6" width="16" height="14" rx="1"/><path d="M7 3h10M4 15l4-4 4 4 3-3 5 5"/>',
    settings: '<path d="M4 6h6m4 0h6M4 18h10m4 0h2M4 12h2m4 0h10"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
    minimize: '<path d="M5 12h14"/>',
    maximize: '<rect x="5" y="5" width="14" height="14" rx=".5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    edit: '<path d="m4 17 1-4L16 2l4 4L9 17l-5 1Zm10-13 4 4M4 22h16"/>',
    delete: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    down: '<path d="m7 9 5 5 5-5"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    pen: '<path d="m5 17 1-4L16 3l4 4L10 17l-5 1Zm9-12 4 4"/>',
    brand: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5M10 8l6 4-6 4z"/>'
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const button = (name, label, cls = 'icon-button', attrs = '') => `<button type="button" class="${cls}" aria-label="${label}" title="${label}" ${attrs}>${icon(name)}</button>`;
  const labels = { annotation: '标注', clip: '片段', records: '记录', settings: '设置' };
  const notes = '<svg class="drawing-overlay" viewBox="0 0 1600 900" aria-hidden="true"><path d="M915 422c90-13 156 28 170 82 14 54-43 99-122 92-82-6-122-44-112-89 4-16 14-36 31-48"/><path d="m1094 414-49 40m4-25-4 25 24-4"/></svg>';
  const thumbNote = '<svg class="thumb-drawing" viewBox="0 0 1600 900" aria-hidden="true"><path d="M915 422c90-13 156 28 170 82 14 54-43 99-122 92-82-6-122-44-112-89 4-16 14-36 31-48"/></svg>';
  const recordList = [1, 2, 3, 4].map((n, i) => `<figure class="record-card${i === 1 ? ' is-selected' : ''}" data-qa="record-card" aria-label="${i === 1 ? '当前选中，' : ''}第${n}条画面记录"><div class="thumbnail"><img src="assets/scene-${n}.svg" alt="特效变化示例画面${n}" draggable="false">${i === 1 ? thumbNote : ''}</div>${i === 1 ? '<span class="record-selected-mark" aria-label="已选中">' + icon('check') + '</span>' : ''}</figure>`).join('');
  document.getElementById('app').className = `app state-${state}`;
  document.getElementById('app').innerHTML = `
    <header class="titlebar" data-qa="titlebar"><span class="brand-symbol" aria-label="播放器">${icon('brand')}</span><span class="file-title">炎舞连斩</span><div class="window-controls">${button('minimize', '最小化', 'window-button', 'data-qa="minimize"')}${button('maximize', '最大化', 'window-button', 'data-qa="maximize"')}${button('close', '关闭', 'window-button close-window', 'data-qa="close"')}</div></header>
    <main class="workspace">
      <section class="stage" aria-label="视频画面"><div class="frame-area"><div class="frame" data-qa="viewer"><img class="scene-image" src="assets/scene-2.svg" alt="代码绘制的特效画面，用于静态界面设计比较" draggable="false">${['records', 'annotation'].includes(state) ? notes : ''}</div><span class="edge-hint" aria-hidden="true"></span>
        <section class="annotation-editor" data-qa="annotation" aria-label="统一标注"><div class="editor-heading"><span>标注</span><span class="editor-keep">文字与圈画一起保存</span></div><div class="editor-copy">火焰边缘散开，主体轮廓开始消失。</div><div class="editor-foot"><span>在画面上直接圈画</span><span><kbd>Enter</kbd> 保存　<kbd>Shift + Enter</kbd> 换行</span></div></section>
      </div><div class="timeline" aria-label="进度、标注帧与片段范围"><div class="track"><span class="played"></span><span class="selected-range"></span><i class="range-handle start"></i><i class="range-handle end"></i>${[14, 29, 48, 67, 82].map((n, i) => `<i class="annotation-dot${i === 2 ? ' current' : ''}" style="left:${n}%"></i>`).join('')}<i class="playhead"></i></div></div></section>
      <nav class="tool-rail" aria-label="工具">${Object.keys(labels).map(name => button(name, labels[name], `tool-button${state === name ? ' is-active' : ''}`, `data-tool="${name}"${state === name ? ' aria-current="true"' : ''}`)).join('')}</nav>
      <aside class="records-panel" data-qa="records" aria-label="标注记录"><div class="panel-heading"><h2>记录</h2>${button('close', '收起记录')}</div><div class="record-summary"><span class="summary-label">选中画面</span><p class="summary-text">火焰边缘散开，<br>主体轮廓开始消失。</p><div class="record-actions">${button('edit', '编辑这条标注')}${button('delete', '删除这条标注')}</div></div><div class="record-list">${recordList}</div></aside>
      <aside class="settings-panel" data-qa="settings" aria-label="设置"><div class="panel-heading"><h2>设置</h2>${button('close', '关闭设置')}</div><div class="settings-list"><div class="setting-row"><span class="setting-label">预览画质</span><span class="setting-value">1080p ${icon('down')}</span></div><div class="setting-row"><span class="setting-label">缓存标记</span><span class="toggle" role="img" aria-label="关闭"></span></div><div class="setting-row"><span class="setting-label">操作图示</span><span class="setting-value">重新查看 ${icon('down')}</span></div></div><div class="advanced-row"><span>高级</span>${icon('down')}</div></aside>
    </main>`;
  window.DESIGN_STATE = state;
  window.DESIGN_READY = Promise.all([document.fonts.ready, ...Array.from(document.images, img => img.decode())]).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
})();
