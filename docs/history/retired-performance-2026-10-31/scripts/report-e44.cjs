'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..'), dir = path.join(root, 'verification-runs/e44');
const groups = [
  ['eagle-gate-1793170714655.json', '首次真实 Eagle · 第1轮', 0],
  ['eagle-gate-1793170714655.json', '首次真实 Eagle · 第3轮', 2],
  ['eagle-gate-1793171518098.json', '仅隐藏画面，不清空画布', 0],
  ['eagle-gate-1793171983497.json', '限制到2个待解码包', 0]
];
const labels = { native: '原生视频', 'prefer-hardware': '新路径 · 硬件偏好', 'prefer-software': '新路径 · 软件偏好' };
const rows = groups.flatMap(([file, label, round]) => {
  const report = JSON.parse(fs.readFileSync(path.join(dir, file)));
  if (!report.complete || !report.host?.kind?.startsWith('real-Eagle')) throw Error('Incomplete or wrong host');
  return report.runs.filter(x => x.round === round).map(r => {
    if (!r.complete || !r.summary || r.rows.length !== 91) throw Error('Invalid run');
    return { file, label, mode: r.hardware, ...r.summary };
  });
});
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chart = (key, max, title, unit) => `<section><h2>${title}</h2>${rows.map(r => `<div class="row"><div>${r.label}<small>${labels[r.mode]}</small></div><div class="track"><i class="${r.mode}" style="width:${Math.min(100,r[key]/max*100)}%"></i></div><b>${r[key].toFixed(1)} ${unit}</b></div>`).join('')}</section>`;
let html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>E44 技术关实测</title><style>
*{box-sizing:border-box}body{background:#0c0e10;color:#d9e2e8;margin:0;font:15px/1.6 system-ui,'Microsoft YaHei'}main{max-width:1120px;margin:48px auto;padding:0 24px}h1{font-size:30px;margin-bottom:8px}h2{font-size:20px}p{color:#9eacb7}.flag{color:#e5af72}.row{display:grid;grid-template-columns:245px 1fr 105px;gap:16px;align-items:center;margin:18px 0}small{display:block;color:#9eacb7}.track{height:12px;background:#20262b}i{height:100%;display:block;background:#788a98}i.prefer-hardware{background:#dc9c65}i.native{background:#7daac7}section{padding:22px 0;border-top:1px solid #283139;margin-top:30px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:10px 8px;border-bottom:1px solid #283139}a{color:#9ec9e5}@media(max-width:700px){.row{grid-template-columns:1fr 90px}.row>div:first-child{grid-column:1/-1}table{display:block;overflow:auto}}
</style><main><h1>先把直接播放测清楚</h1><strong class="flag">A 技术关未通过 · 未替换正式播放器</strong><p>真实 Eagle · 同一77秒4K原片 · 720p绘制 · 每组91次输入。硬件偏好不是硬件解码已确认。P95表示95%的测量不超过此值。</p>
${chart('cursorP95',100,'光标响应 P95 · 越短越好，目标 ≤16.7ms','ms')}
${chart('remoteP95',3500,'远跳出图 P95 · 原片未生成代理','ms')}
<section><h2>准确性与完整分母</h2><table><thead><tr><th>试验 / 路径</th><th>输入</th><th>准确出图</th><th>旧请求被替代</th><th>错误 / 超时 / 错帧</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.label}<small>${labels[r.mode]}</small></td><td>${r.total}</td><td>${r.exact}</td><td>${r.superseded}</td><td>${r.errors} / ${r.timeout} / ${r.wrongFrame}</td></tr>`).join('')}</tbody></table><p>快拖以最新目标为准，被替代请求不算准确出图。0错帧指PTS（源帧时间）身份检查，不是像素级或音画验收。</p></section>
<section><h2>结论与限制</h2><p>新硬件偏好路径的远跳接近原生视频，但快拖光标约68ms，未达16.7ms目标。换成隐藏画面、严格限制解码队列均未消除；尚不能断言GPU硬件或驱动故障。软件偏好光标较快，但远跳约3.1秒，不能作为无代价替代。</p><p>首次三轮中的第2轮被并行Chrome试验干扰，整轮排除，原始记录保留。后两次是单轮诊断，不是三个有效重复的验收。未测完整播放音频、50次关闭/切换、30分钟稳定性、其它视频、整片代理。此页仅E44技术关，不替换正式性能基准。</p><h2>原始记录</h2>${[...new Set(groups.map(x=>x[0]))].map(f=>`<a href="${esc(f)}">${esc(f)}</a><br>`).join('')}<a href="../../docs/experiments/E44/report.md">实施分析</a> · <a href="../../docs/experiments/E44/native-option.md">下一步内核取舍</a></section></main></html>`;
html = html.replace('<main><h1>', '<main><p><a href="filmcraft-report.html">最新：FilmCraft 原生源码三轮实测 →</a></p><h1>')
  .replace('A 技术关未通过 · 未替换正式播放器', '此前 WebCodecs 路线未通过 · 本页保留历史对照');
fs.writeFileSync(path.join(dir, 'report.html'), html);
console.log(`E44 report: ${rows.length} valid individual runs; excludes contaminated round; not acceptance.`);
