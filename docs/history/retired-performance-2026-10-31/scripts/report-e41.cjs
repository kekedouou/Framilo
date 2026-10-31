'use strict';
// Rebuilds charts from completed E41 evidence. No media processing or baseline adoption.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'verification-runs/e41'),out=path.join(root,'artifacts/performance');
const read=name=>JSON.parse(fs.readFileSync(path.join(evidence,name+'.json'),'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const q=(a,p)=>{const b=a.slice().sort((x,y)=>x-y);return b[Math.max(0,Math.ceil(b.length*p)-1)];};
const stats=a=>({n:a.length,p50:q(a,.5),p95:q(a,.95),max:Math.max(...a)});
function summarize(file){
 const v=read(file);assert.equal(v.status,'completed');assert(v.rounds.length);
 const cold=v.rounds.flatMap(r=>r.browser.cold.rows);assert(cold.every(r=>!r.prepared.ready&&r.result==='drawn'&&r.ordinal===r.actual.frameId));
 const preview=cold.map(r=>r.preview[0]?.ms).filter(Number.isFinite);
 const fullTargets=[84.6,257.2,28.4,303.4,158.8];
 const production=v.rounds.flatMap(r=>fullTargets.map(t=>r.production.find(x=>x.metrics.segmentStart===Math.floor(t/2)*2))).filter(Boolean);
 assert.equal(production.length,fullTargets.length*v.rounds.length);
 const bytes=production.reduce((s,x)=>s+x.bytes,0),seconds=production.reduce((s,x)=>s+x.duration,0);
 return {file,rounds:v.rounds.length,source:v.rounds[0].source,sourceHash:v.sourceHash,cold:stats(cold.map(r=>r.ms)),preview:preview.length?stats(preview):null,
  previewCoverage:preview.length/cold.length,disk:stats(v.rounds.flatMap(r=>r.browser.disk.map(x=>x.ms))),hot:stats(v.rounds.flatMap(r=>r.browser.hot.map(x=>x.ms))),
  drag:v.rounds.map(r=>{const b=r.browser.drag;return {previewCount:b.preview.length,maxPreviewGapMs:Math.max(0,...b.preview.slice(1).map((p,i)=>p.ms-b.preview[i].ms)),releaseMs:b.exactAt-b.releaseAt};}),
  proxyMBPerMinute:bytes/seconds*60/1e6,quality:v.rounds[0].quality||[],
  production:production.map(p=>({start:p.metrics.segmentStart,bytes:p.bytes,...p.metrics.production})),
  hash:hash(fs.readFileSync(path.join(evidence,file+'.json')))};
}
const before=summarize('browser-before'),cpu=summarize('browser-cpu-follow'),gpu=summarize('browser-gpu'),follow=summarize('browser-gpu-follow-final');
assert([cpu,gpu,follow].every(x=>x.sourceHash===before.sourceHash));
const bitrate=read('bitrate-quality'),cleanup=read('old-performance-cleanup');assert.equal(bitrate.status,'completed');assert.equal(cleanup.status,'completed');
const summary={createdAt:new Date().toISOString(),scope:'independent Chrome/formal Player; software submission; cold targets, disk and RAM separated; not Eagle acceptance',before,cpu,gpu,gpuFollow:follow,bitrate,cleanup:{files:cleanup.files.length,bytes:cleanup.bytes,keep:cleanup.keep}};
fs.writeFileSync(path.join(evidence,'comparison-summary.json'),JSON.stringify(summary,null,2)+'\n');
const round=x=>Math.round(x),dec=x=>x.toFixed(1),esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg=(content,h,label)=>`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${h}" viewBox="0 0 1000 ${h}" role="img" aria-label="${label}"><rect width="1000" height="${h}" fill="#111619"/><style>text{font-family:Segoe UI,Microsoft YaHei,sans-serif;fill:#e2e8ed;font-size:16px}.small{fill:#94a4ae;font-size:13px}.value{font-size:20px;font-weight:600}</style>${content}</svg>`;
function responseChart(){
 let s='<text x="26" y="32">未准备位置 · P95</text><text class="small" x="26" y="57">越短越好 · 每种配置 18 次固定跳转 · 蓝色为临时画面，空心为准确帧</text>';
 const scale=650/1500;
 for(const [i,label,m,color] of [[0,'修改前',before,'#667680'],[1,'现在 · CPU',cpu,'#9fc9e4'],[2,'现在 · GPU',gpu,'#baa6d4']]){
  const y=89+i*77;s+=`<text x="26" y="${y+24}">${label}</text><rect x="190" y="${y}" width="${m.cold.p95*scale}" height="27" fill="none" stroke="${color}" stroke-width="1.5"/><text x="${202+m.cold.p95*scale}" y="${y+21}">${round(m.cold.p95)} ms</text>`;
  if(m.preview)s+=`<rect x="190" y="${y}" width="${m.preview.p95*scale}" height="27" fill="${color}"/><text class="small" x="190" y="${y+49}">先有临时画面：${round(m.preview.p95)} ms</text>`;
  else s+=`<text class="small" x="190" y="${y+49}">直接跳转没有临时补位，需等准确帧</text>`;
 }
 return svg(s,327,'未准备位置临时画面与准确帧的等待对比');
}
function readyChart(){
 let s='<text x="26" y="32">已准备区域 · P95</text><text class="small" x="26" y="57">代理在磁盘：每种 18 次 · 已解码帧在 RAM：每种 54 次 · 各自固定起点</text>';
 for(const [i,label,key] of [[0,'磁盘读取 + 解码','disk'],[1,'RAM 直接取帧','hot']]){
  const y=90+i*125;s+=`<text x="26" y="${y+18}">${label}</text>`;
  for(const [j,name,m,color] of [[0,'修改前',before,'#667680'],[1,'CPU',cpu,'#9fc9e4'],[2,'GPU',gpu,'#baa6d4']]){const yy=y+j*27;s+=`<text class="small" x="205" y="${yy+14}">${name}</text><rect x="280" y="${yy}" height="15" width="${m[key].p95/60*565}" fill="${color}"/><text x="${294+m[key].p95/60*565}" y="${yy+14}">${dec(m[key].p95)} ms</text>`;}
 }
 return svg(s,326,'磁盘与 RAM 的响应独立对比');
}
function costChart(){
 const max=Math.max(cpu.proxyMBPerMinute,gpu.proxyMBPerMinute)*1.08;let s='<text x="26" y="32">磁盘代价 · MB / 分钟</text><text class="small" x="26" y="57">同样五段各 2 秒素材，按时长外推；并非整片测量，包含段内音频</text>';
 for(const [i,label,m,color] of [[0,'CPU · 默认',cpu,'#9fc9e4'],[1,'GPU · 可选',gpu,'#baa6d4']]){const y=90+i*60;s+=`<text x="26" y="${y+23}">${label}</text><rect x="190" y="${y}" width="${m.proxyMBPerMinute/max*650}" height="28" fill="${color}"/><text x="${203+m.proxyMBPerMinute/max*650}" y="${y+23}">${round(m.proxyMBPerMinute)}</text>`;}
 return svg(s,222,'CPU 与 GPU 代理磁盘占用对比');
}
const style=`:root{color-scheme:dark;font:15px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;background:#090c0e;color:#e2e8ed}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:auto;padding:36px 36px 60px}header{display:flex;align-items:center;gap:20px;justify-content:space-between}h1{font-size:29px;font-weight:600;letter-spacing:-.6px;margin:10px 0}h2{font-size:20px;margin:0 0 10px;font-weight:550}p{color:#a3b1ba;margin:8px 0}.eyebrow{font-size:12px;color:#8facc0;letter-spacing:1px}.actions{display:flex;gap:8px;flex-wrap:wrap}button,a{color:#b9d9ed}button{font:inherit;font-size:13px;background:#1b2b35;border:1px solid #364852;padding:8px 13px;cursor:pointer}button:hover{background:#294150}a{text-underline-offset:4px}.lead{max-width:780px;font-size:17px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0}.card{padding:19px 22px;border:1px solid #29353d;background:#111619}.card b{display:block;font-size:36px;font-weight:550;font-variant-numeric:tabular-nums;color:#b7d7eb;line-height:1.4}.card span,.small{font-size:12px;color:#94a4ae}.block{margin:24px 0;padding:22px;background:#111619;border-top:1px solid #303d46}.block svg{display:block;width:100%;height:auto}.note{border-left:2px solid #90b4cf;padding:4px 16px;margin:14px 0;color:#b1c0cb}.flag{display:inline-block;padding:3px 8px;background:#27313a;color:#c5d2dc;font-size:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.grid .block{margin:0}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{text-align:left;padding:13px 12px;border-bottom:1px solid #2c363d}th{color:#9aaab5;font-weight:400}details{margin:14px 0;color:#97aab7}summary{cursor:pointer;color:#b9d9ed}.samples{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.samples figure{margin:0}.samples img{display:block;width:100%;border:1px solid #34424b}.samples figcaption{font-size:13px;color:#a5b5bf;margin-top:5px}.sample-nav{display:flex;gap:8px;margin:12px 0}.sample-nav button[aria-pressed=true]{border-color:#a4cce5}footer{color:#8499a7;font-size:12px;margin-top:32px;border-top:1px solid #29353d;padding-top:20px}@media(max-width:760px){main{padding:20px 14px}.cards{gap:8px}.card{padding:14px 10px}.card b{font-size:26px}.grid{grid-template-columns:1fr}header{display:block}.samples{grid-template-columns:1fr}.block{padding:12px}h1{font-size:25px}}@media print{button,.sample-nav{display:none}.block,.card{break-inside:avoid}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>E41 · 等待改善与 GPU 代价</title><style>${style}</style></head><body><main>
<header><div><div class="eyebrow">流放之路 / E41 / 720P</div><h1>先看到画面，再等准确帧</h1></div><div class="actions"><button data-export="svg">导出对比图</button><button data-export="png">导出 PNG</button><button onclick="print()">打印 / PDF</button></div></header>
<p>本页数据来自E41首次交付快照。后续<a href="../../docs/experiments/E41/decoder-fix.md">GPU解码超时修复</a>已完成组件回归，尚未重测整套性能，不计入这里的改善幅度。</p>
<p class="lead">低清补位已接通。准确帧的生产仍是主要等待，GPU 在当前短段配方下没有稳定更快，继续保留 CPU 为默认。</p>
<p class="small">本页为同素材的独立 Chrome 实测；正式 Player + 真实 FFmpeg。真实 Eagle 的那次标准测试保留在 <a href="report.html">主报告</a>，两者分开比较。</p>
<div class="cards"><div class="card">临时画面 / CPU<b>${round(cpu.preview.p50)} <small>ms</small></b><span>中位数 · P95 ${round(cpu.preview.p95)} ms</span></div><div class="card">准确帧 / CPU<b>${round(cpu.cold.p50)} <small>ms</small></b><span>中位数 · P95 ${round(cpu.cold.p95)} ms</span></div><div class="card">临时图覆盖<b>18 / 18</b><span>固定冷区跳转，修改前为 0 / 18</span></div></div>
<section class="block"><div id="cold-chart">${responseChart()}</div><p class="note">200 ms 的临时图 P95 目标尚差 ${round(cpu.preview.p95-200)} ms。准确帧 P95 从 ${round(before.cold.p95)} 降到 ${round(cpu.cold.p95)} ms，尚未减半；不能把低清速度当成准确帧速度。</p></section>
<section class="block">${readyChart()}<p>用户那次真实 Eagle 标准记录：288 次输入、100% RAM 命中、P95 6.3 ms。它证明缓存就绪后响应很快，没有测代理生成。</p></section>
<section class="block"><h2>快速拖动：画面追随，松手等准确帧</h2><div class="table"><table><thead><tr><th>最终跟随策略</th><th>约 0.8 秒内临时图</th><th>最长图间隔</th><th>松手后准确帧</th></tr></thead><tbody>${cpu.drag.map((d,i)=>`<tr><td>CPU · 第 ${i+1} 轮</td><td>${d.previewCount} 张</td><td>${round(d.maxPreviewGapMs)} ms</td><td>${round(d.releaseMs)} ms</td></tr>`).join('')}${follow.drag.map(d=>`<tr><td>GPU · 补充复验 1 轮</td><td>${d.previewCount} 张</td><td>${round(d.maxPreviewGapMs)} ms</td><td>${round(d.releaseMs)} ms</td></tr>`).join('')}</tbody></table></div><p class="small">每轮 24 次固定输入、间隔 32 ms。拖动中允许有界的近邻临时帧；松手不再接受相距过远的旧帧。GPU 冷区三轮已完成，最终连续跟随补测仅一轮。</p></section>
<section class="block">${costChart()}<div class="table"><table><thead><tr><th>方案</th><th>样本画质误差</th><th>本轮决定</th></tr></thead><tbody><tr><td>CPU H.264 / CRF20</td><td>PSNR ${dec(Math.min(...cpu.quality.map(x=>x.psnr)))}–${dec(Math.max(...cpu.quality.map(x=>x.psnr)))} dB</td><td>默认保留</td></tr><tr><td>GPU H.264 / QP20</td><td>PSNR ${dec(Math.min(...gpu.quality.map(x=>x.psnr)))}–${dec(Math.max(...gpu.quality.map(x=>x.psnr)))} dB</td><td>可选；体积约 ${dec(gpu.proxyMBPerMinute/cpu.proxyMBPerMinute)} 倍</td></tr><tr><td>GPU / 接近 CPU 码率的试验</td><td>单帧 ${dec(bitrate.psnr)} dB</td><td>仅 2 秒探测；未作为正式配方</td></tr></tbody></table></div><p class="small">PSNR 是像素误差指标，越高误差越小，不等于主观观感验收。取三个相同源帧、相同 720p 参考；CPU / GPU 缩放器不同，误差包含缩放差异。同码率探测体积为 CPU 的 ${dec(bitrate.actualBytes/bitrate.cpuReferenceBytes)} 倍；不能据单帧推断整片质量。</p></section>
<section class="block"><h2>画质对照</h2><p>点击样本切换；点击画面查看原尺寸。</p><div class="sample-nav">${[2538,7716,9102].map((id,i)=>`<button data-frame="${id}" aria-pressed="${i===0}">样本 ${i+1}</button>`).join('')}</div><div class="samples">${[['source','720p 参考'],['cpu','CPU · 默认'],['gpu','GPU · 可选']].map(([id,label])=>`<figure><a data-full="${id}" href="../../verification-runs/e41/quality/${id}-2538.png"><img data-image="${id}" src="../../verification-runs/e41/quality/${id}-2538.png" alt="${label}"></a><figcaption>${label}</figcaption></figure>`).join('')}</div></section>
<div class="grid"><section class="block"><h2>已修复</h2><p>连续拖动使用最新目标；松手与直接跳转也能低清补位；超时后可恢复；过期结果不能覆盖新准确帧。</p><p>容量将满时停止接收新操作，收尾后保存；截断或未完成的测试不进报告。</p></section><section class="block"><h2>尚未验证</h2><p>Eagle 原生菜单、关窗闪烁及实际操作手感。系统捕获工具未返回正确 Eagle 画面，没有冒充亲测通过。</p><p>本轮没有证明高分辨率、不同素材及长时间音画全部达标。</p></section></div>
<details><summary>条件与来源</summary><p>同一 AV1 1080p / 328.609 秒 / 9858 帧，预览 720p、10 GiB 配额。RTX 3060 Laptop、i7-12700H；固定源 SHA256：${esc(cpu.sourceHash)}。关闭闲时 RAM 填充以控制起点；冷区、磁盘、RAM 独立统计。P95 采用最近秩，18 个样本时接近最慢请求，因此只作本轮有限样本事实。</p><p>CPU 和 GPU 各三轮；GPU 最终跟随策略另补一轮。浏览器计时到软件绘制提交，未测物理屏幕刷新、功耗或纯 GPU 时间。短段 FFmpeg 阶段并行重叠，不能相加。此次只改 H.264 可选生产链，未启用 HEVC / ProRes。</p><p><a href="../../docs/experiments/E41/report.md">实施、验证和完整限制</a> · <a href="../../docs/experiments/E41/result-analysis.md">原因分析与下一步方向</a></p></details>
<footer>仅本地数据，无上传。已清理旧性能产物 ${cleanup.files.length} 个文件 / ${(cleanup.bytes/1024**2).toFixed(1)} MiB，唯一指定的“流放之路”标准原件与导入副本保留。未接受性能基准，未提交 Git。</footer>
</main><script>
document.querySelectorAll('[data-frame]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-frame]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('[data-image]').forEach(i=>{i.src='../../verification-runs/e41/quality/'+i.dataset.image+'-'+b.dataset.frame+'.png';document.querySelector('[data-full='+i.dataset.image+']').href=i.src;});});
const download=(blob,name)=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>{const source=new XMLSerializer().serializeToString(document.querySelector('#cold-chart svg')),blob=new Blob([source],{type:'image/svg+xml'});if(b.dataset.export==='svg')return download(blob,'E41-冷区等待.svg');const u=URL.createObjectURL(blob),i=new Image();i.onload=()=>{const c=document.createElement('canvas');c.width=1000;c.height=327;c.getContext('2d').drawImage(i,0,0);URL.revokeObjectURL(u);c.toBlob(p=>download(p,'E41-冷区等待.png'));};i.src=u;});
</script></body></html>`;
async function main(){
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'e41-comparison.html'),html);
 const sidecar=path.join(out,'comparisons.json');let links=fs.existsSync(sidecar)?JSON.parse(fs.readFileSync(sidecar,'utf8')):[];assert(Array.isArray(links));
 links=links.filter(x=>x.file!=='e41-comparison.html');links.unshift({file:'e41-comparison.html',title:'E41 · 准备中响应与 CPU / GPU 对比',scope:'独立 Chrome 实测；与下方 Eagle 标准记录分开。'});
 fs.writeFileSync(sidecar,JSON.stringify(links,null,2)+'\n');await require('../plugin/performance-report.cjs').index(out);
 if(process.argv.includes('--check'))await checkView(path.join(out,'e41-comparison.html'));
 console.log(JSON.stringify({report:path.join(out,'e41-comparison.html'),cpu:custom(cpu),gpu:custom(gpu),cleanedBytes:cleanup.bytes}));
}
function custom(m){return {cold:m.cold,preview:m.preview,disk:m.disk,hot:m.hot,proxyMBPerMinute:m.proxyMBPerMinute};}
async function checkView(file){
 const {spawn}=require('child_process'),{pathToFileURL}=require('url'),temp=require('../tests/support/annotation-scratch.cjs').scratch('e41-report');
 const profile=path.join(temp.root,'profile'),downloads=path.join(temp.root,'exports'),wait=ms=>new Promise(r=>setTimeout(r,ms)),calls=new Map();let child,ws,session,id=0;
 const call=(method,params={},target=session)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{calls.delete(n);reject(Error(method+' timeout'));},10000);calls.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,...(target?{sessionId:target}:{})}));});
 try{
  child=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--proxy-server=http://127.0.0.1:9','--remote-debugging-port=0','--window-size=1440,1100','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<150&&!port;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);}catch(_){await wait(40);}}assert(port);
  ws=new WebSocket('ws://127.0.0.1:'+port[0]+port[1]);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});ws.onmessage=e=>{const v=JSON.parse(e.data),p=calls.get(v.id);if(!p)return;clearTimeout(p.timer);calls.delete(v.id);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);};
  const target=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Page.navigate',{url:pathToFileURL(file).href});await wait(400);
  assert(await evaluate('document.querySelectorAll("svg").length===3&&Array.from(document.images).every(i=>i.complete&&i.naturalWidth===1280)'));
  for(const width of [1440,960,640]){await call('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'report overflow '+width);}
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,'report-view.png'),Buffer.from(shot.data,'base64'));
  await evaluate('document.querySelector("[data-frame=\\\"7716\\\"]").click()');await wait(150);assert(await evaluate('Array.from(document.images).every(i=>i.src.endsWith("7716.png")&&i.naturalWidth===1280)'));
  fs.mkdirSync(downloads);await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads},null);
  await evaluate('document.querySelector("[data-export=svg]").click()');await evaluate('document.querySelector("[data-export=png]").click()');
  for(let i=0;i<50&&fs.readdirSync(downloads).length<2;i++)await wait(100);
  assert(fs.readdirSync(downloads).some(x=>x.endsWith('.png'))&&fs.readdirSync(downloads).some(x=>x.endsWith('.svg')));
  await call('Page.navigate',{url:pathToFileURL(path.join(out,'report.html')).href});await wait(200);assert(await evaluate('!!document.querySelector("a[href=\\\"e41-comparison.html\\\"]")'));
  fs.writeFileSync(path.join(evidence,'report-view-check.json'),JSON.stringify({at:new Date().toISOString(),status:'passed',scope:'independent Chrome layout/export, not Eagle',widths:[1440,960,640],images:'three exact 720p samples loaded; switching works',export:['SVG','PNG'],mainIndexLink:true},null,2)+'\n');
  await Promise.race([call('Browser.close',{},null).catch(()=>{}),wait(500)]);
 }finally{for(const p of calls.values()){clearTimeout(p.timer);p.reject(Error('closed'));}calls.clear();ws?.close();if(child&&child.exitCode===null)child.kill();await wait(500);temp.clean();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
