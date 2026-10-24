'use strict';
const schemes = {
  a: { name: 'A　深炭暖金', accent: '#d7bd75', detail: '中轴顶栏 · 连体工具轨 · 内嵌记录区' },
  b: { name: 'B　青绿切角', accent: '#32c5a2', detail: '左齐顶栏 · 通高边轨 · 连续画幅' },
  c: { name: 'C　钴蓝浮页', accent: '#759cff', detail: '轻量顶栏 · 独立窄轨 · 离缝记录页' }
};
const requested = new URLSearchParams(location.search).get('scheme');
const key = Object.hasOwn(schemes, requested) ? requested : 'a';
const scheme = schemes[key];
document.documentElement.style.setProperty('--accent', scheme.accent);
document.getElementById('board').innerHTML = `<header class="board-heading"><div><h1><span class="swatch"></span>${scheme.name}</h1><div class="subtitle">${scheme.detail}</div></div><div class="board-meta">HTML / CSS 实际渲染　　静态方案，尚未定稿</div></header><figure class="hero"><img src="shots/${key}-records.png" alt="${scheme.name}的记录展开状态"><figcaption><span>记录展开 · 工具轨在左，四张缩略图单列排列</span><span>选中信息固定在记录区上方</span></figcaption></figure><div class="mini-grid">${[['watch', '默认观看', '画面完整、居中'], ['annotation', '统一标注', '画面不移位，无暗幕'], ['settings', '设置浮层', '与记录区分开展示']].map(([state, title, detail]) => `<figure class="mini"><img src="shots/${key}-${state}.png" alt="${title}状态"><figcaption><span>${title}</span><span>${detail}</span></figcaption></figure>`).join('')}</div><div class="footer">同一组代码绘制的特效示例，便于比较界面；面板与窗控均为静态设计，未接入正式播放器。</div>`;
window.DESIGN_READY = Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]);
