'use strict';
// Derived comparison only. Completed raw runs stay immutable, no baseline adoption.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),base=path.join(root,'verification-runs/e42'),out=path.join(root,'artifacts/performance');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const quantile=(a,p)=>a.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(a.length*p)-1)];
const stats=a=>a.length?{n:a.length,p50:quantile(a,.5),p95:quantile(a,.95),max:Math.max(...a)}:null;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function read(variant,label){
 const file=path.join(base,'browser-'+variant+'-'+label+'.json'),r=JSON.parse(fs.readFileSync(file));
 assert(r.status==='completed'&&r.rounds.length===2&&r.rounds.every(x=>x.cleaned&&!x.error&&!x.closeError&&!x.ownerError),'Incomplete run');
 const cold=r.rounds.flatMap(x=>x.browser.cold.rows);assert(cold.length===6&&cold.every(x=>!x.prepared.ready&&x.result==='drawn'&&x.ordinal===x.actual.frameId),'Cold targets or exact frame validation failed');
 const frames=cold.flatMap(x=>x.preview.map(p=>({delta:Math.abs(p.time-x.actual.time),ms:p.ms}))),previews=cold.map(x=>x.preview[0]?.ms).filter(Number.isFinite);
 const requests=r.rounds.flatMap(x=>x.browser.cold.data.requests),stages=require('../plugin/performance-stages.cjs').summary(requests);
 return {label,variant,sourceHash:r.sourceHash,protocol:r.protocol,evidence:path.relative(root,file),sha256:sha(fs.readFileSync(file)),runtimeHashes:r.rounds.map(x=>x.runtimeHash||null),
  cold:stats(cold.map(x=>x.ms)),preview:stats(previews),previewCoverage:previews.length+'/6',maxFinalPreviewOffsetMs:frames.length?Math.max(...frames.map(p=>p.delta))*1000:null,
  disk:stats(r.rounds.flatMap(x=>x.browser.disk.map(t=>t.ms))),ram:stats(r.rounds.flatMap(x=>x.browser.hot.map(t=>t.ms))),
  release:stats(r.rounds.map(x=>x.browser.drag.exactAt-x.browser.drag.releaseAt)),stages,
  cleanup:stats(r.rounds.map(x=>x.cleanupMs)),bytes:r.cleanup.reduce((s,x)=>s+x.bytes,0)};
}
async function main(label='verified'){
 assert(/^[a-z0-9-]{1,40}$/.test(label));const data=[];
 for(const variant of ['cpu','gpu']){const before=read(variant,'before'),after=read(variant,label);assert.equal(before.sourceHash,after.sourceHash);assert.equal(before.protocol,after.protocol);data.push({variant,before,after});}
 assert.equal(data[0].after.sourceHash,data[1].after.sourceHash);
 const runtimeHashes=data.flatMap(d=>d.after.runtimeHashes);assert(runtimeHashes.every(x=>/^[0-9a-f]{64}$/.test(x))&&new Set(runtimeHashes).size===1,'Do not mix different runtime builds in one after pair');
 const summary={label,scope:'Independent Chromium / guarded real media; canvas submission; not Eagle or physical display',conditions:'Same 4K H.264 source, 77.46s, 720p, 10GiB RAM allowance, 2 rounds, 3 cold targets; OS cache/load not controlled',data};
 fs.writeFileSync(path.join(base,'summary-'+label+'.json'),JSON.stringify(summary,null,2));
 const colors={before:'#586772',after:'#a2c9e4'},num=x=>Number.isFinite(x)?Math.round(x)+' ms':'—';
 let svg='<rect width="1000" height="1000" fill="#11171b"/><style>text{fill:#e5edf2;font:16px Segoe UI,Microsoft YaHei,sans-serif}.minor{fill:#94a6b1;font-size:13px}.head{font-size:21px;font-weight:600}</style>';
 const max=Math.max(...data.flatMap(x=>[x.before.cold.p95,x.after.cold.p95]))*1.15;
 svg+='<text x="28" y="38" class="head">未代理位置 · 准确帧等待</text><text x="28" y="64" class="minor">P95 / 越短越好 · 每种配置 6 次跳转，小样本描述</text>';
 for(const [i,d]of data.entries())for(const [j,key]of ['before','after'].entries()){
  const y=94+i*104+j*39,v=d[key].cold.p95,w=650*v/max;
  svg+=`<text x="28" y="${y+22}">${d.variant.toUpperCase()} · ${key==='before'?'优化前':'本轮'}</text><rect x="190" y="${y}" width="${w}" height="27" fill="${colors[key]}"/><text x="${202+w}" y="${y+22}">${num(v)}</text>`;
 }
 svg+='<text x="28" y="342" class="head">先显示低清 · 本轮</text><text x="28" y="368" class="minor">有显示才计时；没有补位不能记作 0 ms</text>';
 for(const [i,d]of data.entries()){
  const y=394+i*60,w=d.after.preview?650*d.after.preview.p95/max:0;
  svg+=`<text x="28" y="${y+22}">${d.variant.toUpperCase()} · ${d.after.previewCoverage}</text><rect x="190" y="${y}" width="${w}" height="27" fill="#74aaa5"/><text x="${202+w}" y="${y+22}">${num(d.after.preview?.p95)}</text>`;
 }
 svg+='<text x="28" y="553" class="head">已准备区域 · P95</text><text x="28" y="579" class="minor">灰色优化前 / 蓝色本轮 · 与上方分别计量</text>';
 for(const [i,key]of ['disk','ram'].entries()){
  const scale=600/Math.max(10,...data.flatMap(d=>[d.before[key].p95,d.after[key].p95]));
  for(const [v,d]of data.entries())for(const [j,version]of ['before','after'].entries()){
   const y=602+i*174+v*70+j*29,w=d[version][key].p95*scale;
   svg+=`<text class="minor" x="28" y="${y+17}">${key==='disk'?'磁盘 + 解码':'RAM'} / ${d.variant.toUpperCase()} ${j?'本轮':'之前'}</text><rect x="220" y="${y}" width="${w}" height="19" fill="${colors[version]}"/><text x="${234+w}" y="${y+17}">${d[version][key].p95.toFixed(1)} ms</text>`;
  }
 }
 svg+='<text x="28" y="978" class="minor">同源固定轨迹 / 独立 Chrome，非 Eagle 验收 / 2 轮，不代表统计显著或已达标</text>';
 const chart=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" role="img" aria-label="冷区与就绪区域优化前后对比">${svg}</svg>`;
 const keys=[['locate','寻帧定位'],['asset','代理准备 / 读取'],['readIO','文件读取与解封装'],['decodeNative','视频解码'],['convert','图像转换'],['transfer','数据传输'],['submit','渲染提交'],['queue','任务排队'],['renderWait','等待绘制'],['other','未归因']];
 const table=keys.map(([key,name])=>`<tr><th>${name}</th>${data.flatMap(d=>['before','after'].map(k=>{const x=d[k].stages.find(x=>x.name===key)?.ms;return '<td>'+ (Number.isFinite(x)?x.toFixed(1)+' ms':'—')+'</td>';})).join('')}</tr>`).join('');
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>E42 · 冷区响应对比</title>
 <style>:root{color-scheme:dark;background:#090d10;color:#e5edf2;font:15px/1.7 Segoe UI,Microsoft YaHei,sans-serif}*{box-sizing:border-box}main{max-width:1080px;padding:30px 24px 60px;margin:auto}h1{font-size:28px;font-weight:600;margin:10px 0}p,small{color:#9cafba}header{display:flex;justify-content:space-between;gap:16px;align-items:center}button,a{color:#b5d9ef}button{background:#19252e;border:1px solid #334754;padding:7px 12px;cursor:pointer}svg{width:100%;height:auto;display:block}section{margin:24px 0}details{border-top:1px solid #28343d;padding:14px 0}.table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-weight:500}td{text-align:right;white-space:nowrap}td,th{padding:9px;border-bottom:1px solid #26333d}.status{border-left:3px solid #94bbd5;padding:12px 18px;background:#141e25}@media(max-width:640px){header{display:block}main{padding:20px 12px}h1{font-size:24px}}@media print{button{display:none}}</style>
 <main><header><div><small>固定条件 · E42</small><h1>冷区响应对比</h1></div><div><button data-export="svg">导出 SVG</button> <button data-export="png">导出 PNG</button> <button onclick="print()">打印</button></div></header>
 <p>同一段 4K H.264 视频 · 77.46 秒 · 720p 预览 · RAM 额度 10 GiB。CPU 与 GPU 各跑前后两轮。</p>
 <p class="status">本轮尚未达到冷区等待减半、低清 P95 ≤ 200 ms 的目标。GPU 仍较慢；画质配方保持原样。</p>
 <section id="latency">${chart}</section><section id="stages"><details><summary>延迟分布 · 冷区平均值</summary><p>没有测到的项显示 —。代理准备与读取为合并计时，不能全算作编码，也不能重复相加。</p><div class="table"><table><thead><tr><th>阶段</th><th>CPU 前</th><th>CPU 本轮</th><th>GPU 前</th><th>GPU 本轮</th></tr></thead><tbody>${table}</tbody></table></div></details></section>
 <section id="comparison"><p>最终低清画面与准确帧的最大时间偏差：CPU ${num(data[0].after.maxFinalPreviewOffsetMs)}，GPU ${num(data[1].after.maxFinalPreviewOffsetMs)}。按呈现时间戳核对，未做画面像素身份验收。</p><details><summary>条件与限制</summary><p>每轮全新自有代理缓存；冷区、磁盘已有代理、RAM 已解码分开。固定目标 58.4 / 22.7 / 44.2 秒；24 次拖动每次间隔 32 ms。原始媒体后台含音频准备，浏览器测试不播放声音。操作系统缓存、温度与其它软件负载不能完全固定；画布提交不是物理屏幕显示。</p><p>代理生成首包实验未见线程参数的显著收益，因此没有改变参数或格式。窗口隐藏已做宿主模型验证，真实 Eagle 关窗观感仍需验证。</p></details></section><a href="report.html">返回全部有效记录</a></main>
 <script>document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>{const s=document.querySelector('svg'),xml=new XMLSerializer().serializeToString(s),blob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob);function save(href,ext){const a=document.createElement('a');a.href=href;a.download='E42-冷区响应.'+ext;a.click();}if(b.dataset.export==='svg'){save(url,'svg');setTimeout(()=>URL.revokeObjectURL(url),1000);return;}const img=new Image();img.onload=()=>{const c=document.createElement('canvas');c.width=1000;c.height=1000;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url);save(c.toDataURL('image/png'),'png');};img.src=url;});</script></html>`;
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'e42-comparison.html'),html);
 const index=path.join(out,'comparisons.json'),links=fs.existsSync(index)?JSON.parse(fs.readFileSync(index)):[];assert(Array.isArray(links));
 const rows=links.filter(x=>x.file!=='e42-comparison.html');rows.unshift({file:'e42-comparison.html',title:'E42 · 同源 CPU / GPU 冷区优化对比',scope:'自动冷区、磁盘及 RAM 分开；独立 Chrome，不混入 Eagle 标准成绩。'});
 fs.writeFileSync(index,JSON.stringify(rows,null,2));await require('../plugin/performance-report.cjs').index(out);
 console.log(JSON.stringify(data.map(x=>({variant:x.variant,before:x.before.cold,after:x.after.cold,preview:x.after.preview,coverage:x.after.previewCoverage})),null,2));
 return summary;
}
if(require.main===module)main(process.argv[2]||'verified').catch(e=>{console.error(e);process.exitCode=1;});
module.exports={main};
