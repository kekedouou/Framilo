'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),os=require('os');
const {metrics,DEFINITION}=require('./performance-core.cjs');
const fsp=fs.promises;
const STORE_LIMIT=256*1024*1024, MAX_RUNS=100;
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const esc=v=>String(v??'未知').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>typeof v==='number'?v.toFixed(2):'未测';
function runId(){return new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex');}
async function codeSnapshot(root){
  const names=(await fsp.readdir(root)).filter(n=>/\.(js|cjs|css|html)$/.test(n)||n==='manifest.json').sort();
  const files={};for(const name of names){const p=path.join(root,name),st=await fsp.lstat(p);if(st.isFile()&&!st.isSymbolicLink()&&st.size<4*1024*1024)files[name]=hash(await fsp.readFile(p,'utf8'));}
  let commit='unknown',dirty='unknown';
  const repo=path.dirname(root);
  if(fs.existsSync(path.join(repo,'.git'))){
    const exec=(args)=>new Promise(resolve=>require('child_process').execFile('git',args,{cwd:repo,windowsHide:true,timeout:3000,maxBuffer:1024*1024},(e,out)=>resolve(e?'unknown':out.trim())));
    commit=await exec(['rev-parse','HEAD']);dirty=await exec(['status','--porcelain']);
  }
  return {commit,dirty:dirty==='unknown'?'unknown':!!dirty,workspaceHash:hash(files),files};
}
function environment(){return {platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model||'unknown',logicalCpus:os.cpus().length,totalMemory:os.totalmem(),versions:{...process.versions},gpu:'unknown',actualHardwareDecode:'unknown',ffmpegVersion:'unknown'};}
function condition(manifest){return {definition:DEFINITION.version,source:manifest.source,config:manifest.config,environment:manifest.environment,protocol:manifest.protocol,conditions:manifest.conditions,measurementScope:manifest.measurementScope,...(manifest.benchmark?{benchmark:manifest.benchmark}: {})};}
function compare(current,previous){
  if(current.manifest.mode!=='standard')return{eligible:false,reason:'体验记录不用于优化比较'};
  if(!current.manifest.benchmark?.verified)return{eligible:false,reason:'尚未锁定固定测试的准备条件'};
  if(!previous)return{eligible:false,reason:'尚无对照'};
  const same=hash(condition(current.manifest))===hash(condition(previous.manifest));
  if(!same||current.manifest.status!=='completed'||previous.manifest.status!=='completed'||current.metrics.coverage.truncated||previous.metrics.coverage.truncated)
    return{eligible:false,reason:'条件、完成状态或数据完整性不一致，仅可分别查看'};
  const a=previous.metrics.latency,b=current.metrics.latency;
  return{eligible:true,runId:previous.manifest.runId,previous:a,current:b,
    p50Delta:a.p50===null||b.p50===null?null:b.p50-a.p50,p95Delta:a.p95===null||b.p95===null?null:b.p95-a.p95,
    p95Relative:a.p95>0?(b.p95-a.p95)/a.p95:null,previousOutcomes:previous.metrics.outcomes,previousResources:previous.metrics.resources,
    note:'同条件描述性差异；未设定达标阈值，不代表统计显著或已接受基准；画质仅配置相同，像素质量未独立测量'};
}
function spark(rows,width=920,height=200){
  if(!rows.length)return '<p>暂无请求样本</p>';
  const start=Math.min(...rows.map(r=>r.start)),span=Math.max(1,...rows.map(r=>r.start-start)),max=Math.max(1,...rows.map(r=>r.latencyMs||0));
  const dots=rows.map(r=>{const x=30+(r.start-start)/span*(width-50),y=height-25-(r.latencyMs||0)/max*(height-45),ok=['shown','reused'].includes(r.status);return `<circle cx="${x}" cy="${y}" r="${ok?3:4}" fill="${ok?'#9fc9e4':'#df9d8d'}"><title>${esc(r.id)} / ${esc(r.status)} / ${num(r.latencyMs)} ms / ${esc(r.cache)} / ${esc(r.backend)} / 生成中 ${r.generating}</title></circle>`;}).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="操作时间与延迟"><path d="M30 10V${height-25}H${width-10}" stroke="#697681" fill="none"/><text x="32" y="18">${num(max)} ms</text><text x="32" y="${height-4}">0 秒</text><text x="${width-100}" y="${height-4}">${num(span/1000)} 秒</text>${dots}</svg>`;
}
function timeline(r){
  if(!r)return '<p>尚无请求可展示</p>';
  const duration=Math.max(1,r.latencyMs||0),stages=r.stages.filter(s=>Number.isFinite(s.start)&&s.end>=s.start);
  const names={'asset':'资源返回（含未拆分读取/生成/传输）','decode':'浏览器图像解码'};
  const clipped=stages.map(s=>[Math.max(r.start,s.start),Math.min(r.end||r.start,s.end)]).filter(p=>p[1]>p[0]).sort((a,b)=>a[0]-b[0]);
  let covered=0,end=r.start;for(const [a,b]of clipped){covered+=Math.max(0,b-Math.max(end,a));end=Math.max(end,b);}
  return `<p>请求 ${esc(r.id)} · ${esc(r.status)} · ${num(r.latencyMs)} ms。未被独立阶段覆盖 ${num(Math.max(0,duration-covered))} ms（包括调度/等待；不推断原因）。</p>`+
    (stages.length?stages.map(s=>`<div class="stage"><span>${esc(names[s.name]||s.name)}</span><div><i style="margin-left:${Math.max(0,(s.start-r.start)/duration*100)}%;width:${Math.min(100,(s.end-s.start)/duration*100)}%"></i></div><span>${num(s.end-s.start)} ms</span></div>`).join(''):'<p>读取/解码未独立测量，可能为缓存复用；不可据此推断零耗时。</p>')+
    '<p>阶段可重叠，仅显示真实起止；未将阶段耗时相加作为总延迟。</p>';
}
const STYLE=`:root{color-scheme:dark}*{box-sizing:border-box}body{background:#000;color:#d7dfe5;font:15px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;margin:0}main{max-width:1120px;margin:48px auto;padding:0 28px}h1{font-size:28px;font-weight:500}h2{font-size:20px;font-weight:500;margin-top:36px}p{max-width:80ch;color:#aab6bf}a{color:#9fc9e4}section{padding:20px 0;border-top:1px solid #343e46}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid #242c32;overflow-wrap:anywhere}svg{width:100%;background:#15191c}svg text{fill:#96a4af;font-size:12px}.stage{display:grid;grid-template-columns:240px 1fr 110px;gap:12px;margin:12px 0}.stage>div{background:#15191c;overflow:hidden}.stage i{display:block;height:22px;background:#7297b1}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin-top:18px}summary{cursor:pointer;color:#9fc9e4}.warn{color:#e5b48a}button{background:#202b34;color:#c4dfef;border:1px solid #52636f;padding:8px;cursor:pointer}@media(max-width:650px){main{padding:0 16px;margin:20px auto}.stage{grid-template-columns:1fr}table{font-size:11px}th,td{padding:6px}}`;
function render(manifest,data,m,history=[]){return require('./performance-dashboard.cjs').render([...history,{manifest,data,metrics:m}],{single:true});}
async function safeDir(root){await fsp.mkdir(root,{recursive:true});if((await fsp.lstat(root)).isSymbolicLink())throw Error('报告目录不能是链接');}
async function capacity(root){
  await safeDir(root);await safeDir(path.join(root,'runs'));await recover(root);let bytes=0,count=0;
  for(const n of await fsp.readdir(path.join(root,'runs'))){const dir=path.join(root,'runs',n),st=await fsp.lstat(dir);if(st.isSymbolicLink()||!st.isDirectory())throw Error('报告目录含未知条目');count++;for(const f of await fsp.readdir(dir)){const s=await fsp.lstat(path.join(dir,f));if(!s.isFile()||s.isSymbolicLink())throw Error('报告含未知文件');bytes+=s.size;}}
  if(count>=MAX_RUNS||bytes>STORE_LIMIT-20*1024*1024)throw Error('报告存储达到上限（100轮 / 256MiB），已有证据已保留，请先审阅归档');return {bytes,count};
}
async function json(file){return JSON.parse(await fsp.readFile(file,'utf8'));}
async function atomic(file,value){const tmp=file+'.tmp';await fsp.writeFile(tmp,value);await fsp.rename(tmp,file);}
async function list(root){const names=await fsp.readdir(path.join(root,'runs')).catch(()=>[]),rows=[];for(const n of names){if(n.startsWith('.pending-'))continue;try{const m=await json(path.join(root,'runs',n,'manifest.json'));rows.push(m);}catch(_){rows.push({runId:n,status:'report-failed',createdAt:'unknown'});}}return rows.sort((a,b)=>b.runId.localeCompare(a.runId));}
async function previous(root,manifest){for(const m of await list(root)){if(m.runId===manifest.runId||m.conditionHash!==hash(condition(manifest))||m.status!=='completed'||!m.reportComplete)continue;try{const dir=path.join(root,'runs',m.runId);await validate(dir);return{manifest:m,metrics:await json(path.join(dir,'metrics.json'))};}catch(_){/* Damaged history cannot validate a comparison. */}}return null;}
async function entries(root){
  const result=[];
  for(const manifest of await list(root)){
    if(!manifest.reportComplete)continue;
    const dir=path.join(root,'runs',manifest.runId);
    try{await validate(dir);const data=await json(path.join(dir,'requests.json'));result.push({manifest,metrics:await json(path.join(dir,'metrics.json')),data:{...data,events:[],samples:[]}});}catch(_){/* Invalid evidence must not enter a user comparison. */}
  }
  return result;
}
async function index(root){
  const pending=await require('./performance-inbox.cjs').read(root);
  // Optional locally authored experiment charts stay separate from valid host runs.
  const comparisons=[];
  try{
    const file=path.join(root,'comparisons.json'),st=await fsp.lstat(file);
    if(st.isFile()&&!st.isSymbolicLink()&&st.size<=8192){
      const rows=await json(file);
      if(Array.isArray(rows))for(const row of rows.slice(0,12)){
        if(!row||typeof row.file!=='string'||!/^[a-z0-9][a-z0-9-]*\.html$/i.test(row.file)||typeof row.title!=='string'||row.title.length>100||typeof row.scope!=='string'||row.scope.length>200)continue;
        const target=await fsp.lstat(path.join(root,row.file)).catch(()=>null);
        if(target?.isFile()&&!target.isSymbolicLink()&&target.size<=2*1024*1024)comparisons.push(row);
      }
    }
  }catch(_){/* A missing or invalid navigation sidecar never creates a run. */}
  let html=require('./performance-dashboard.cjs').render(await entries(root),{pending:pending.slots});
  if(comparisons.length){
    const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    html=html.replace('</h1>','</h1><aside aria-label="独立实验报告">'+comparisons.map(r=>'<p><a href="'+r.file+'">'+escape(r.title)+'</a><br><small>'+escape(r.scope)+'</small></p>').join('')+'</aside>');
  }
  await atomic(path.join(root,'report.html'),html);await atomic(path.join(root,'index.html'),html);
}
function usable(manifest,data){
  if(manifest.status!=='completed')throw Error('本次记录未完成，已作废');
  if(!['manual','standard'].includes(manifest.mode)||!manifest.source?.sha256||!data.requests?.length)throw Error('没有完整的素材与操作记录');
  if(data.capacity?.truncated||data.capacity?.dropped||data.capacity?.orphanEvents)throw Error('记录被截断或缺少操作身份，已作废');
  if(data.requests.some(r=>!['shown','reused','superseded','failed','wrong-frame','timeout'].includes(r.status)||!Number.isFinite(r.end)||r.end<r.start))throw Error('记录含未完成操作，已作废');
  if(manifest.mode==='standard'){
    if(!manifest.benchmark?.verified||!manifest.conditions?.initialCache)throw Error('标准测试准备条件未确认');
    const protocol=require('./performance-protocol.cjs'),runner=require('./performance-runner.cjs');
    for(const key of ['repeats','cadenceMs','dragInputs','randomSeeks','seed'])if(manifest.protocol?.[key]!==protocol.FIXED[key])throw Error('固定操作协议改变');
    const expected=[];for(let round=1;round<=3;round++)for(const scene of runner.sequence(manifest.source.duration,protocol.FIXED))scene.times.forEach((target,i)=>expected.push({target,scenario:scene.name+'/round-'+round,final:scene.kind!=='drag'||i===scene.times.length-1}));
    if(data.requests.length!==expected.length||data.requests.some((r,i)=>r.scenario!==expected[i].scenario||Math.abs(r.target-expected[i].target)>1e-7||r.final!==expected[i].final))throw Error('固定测试轨迹不完整或被其它输入干扰');
  }
  return true;
}
const STAGED_FILES=new Set(['owner.json','manifest.json','manifest.json.tmp','metrics.json','events.jsonl','requests.json','report.html','summary.md','analysis.md']);
async function removeStage(root,dir){
  const runs=path.resolve(root,'runs');
  if(path.dirname(path.resolve(dir))!==runs||!/^\.pending-[\w-]+$/.test(path.basename(dir)))throw Error('临时记录路径越界');
  if((await fsp.lstat(dir)).isSymbolicLink()||path.resolve(await fsp.realpath(dir)).toLowerCase()!==path.resolve(dir).toLowerCase())throw Error('临时记录目录身份改变');
  const names=await fsp.readdir(dir);for(const name of names){const s=await fsp.lstat(path.join(dir,name));if(!STAGED_FILES.has(name)||!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('临时记录包含未知文件');}
  for(const name of names)await fsp.unlink(path.join(dir,name));await fsp.rmdir(dir);
}
async function recover(root){
  const runs=path.join(root,'runs');
  for(const name of await fsp.readdir(runs))if(/^\.pending-[\w-]+$/.test(name)){
    const dir=path.join(runs,name);if((await fsp.lstat(dir)).isSymbolicLink())throw Error('临时记录不能是链接');
    const owner=await json(path.join(dir,'owner.json'));
    if(owner.owner!=='eva-performance-stage-v1'||name!=='.pending-'+owner.runId||!Number.isSafeInteger(owner.pid)||owner.pid<=0)throw Error('临时记录归属无法确认');
    let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
    if(!alive)await removeStage(root,dir);
  }
}
async function save(root,manifest,data,previous=null){
  usable(manifest,data);await capacity(root);if(!/^[\w-]+$/.test(manifest.runId))throw Error('无效运行编号');
  const finalDir=path.join(root,'runs',manifest.runId),dir=path.join(root,'runs','.pending-'+manifest.runId);
  if(fs.existsSync(finalDir))throw Error('记录已存在，禁止覆盖');
  await fsp.mkdir(dir);let published=false;
  manifest={...manifest,schema:2,definition:DEFINITION,capacity:data.capacity,conditionHash:hash(condition(manifest)),reportComplete:false,baseline:'unset',analysis:'pending',sync:'未同步到工作区'};
  try {
    await fsp.writeFile(path.join(dir,'owner.json'),JSON.stringify({owner:'eva-performance-stage-v1',runId:manifest.runId,pid:process.pid}));
    await atomic(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
    const m=metrics(data);m.comparison=compare({manifest,metrics:m},previous);
    await fsp.writeFile(path.join(dir,'events.jsonl'),data.events.map(e=>JSON.stringify(e)).join('\n')+'\n');
    await fsp.writeFile(path.join(dir,'requests.json'),JSON.stringify(data));
    await fsp.writeFile(path.join(dir,'metrics.json'),JSON.stringify(m,null,2));
    await fsp.writeFile(path.join(dir,'analysis.md'),'# AI 分析\n\n尚未进行 AI 分析。程序只生成统计、图表与规则提示。\n');
    await fsp.writeFile(path.join(dir,'summary.md'),`# 自动事实摘要\n\n运行：${manifest.runId}\n代码：${manifest.code?.workspaceHash}\n状态：${manifest.status}\n范围：${manifest.measurementScope}\n请求：${m.requests}；结果：${JSON.stringify(m.outcomes)}\n成功 n=${m.latency.n}，P50=${num(m.latency.p50)}ms，P95=${num(m.latency.p95)}ms。\n${m.latency.lowSample?'样本不足40，尾部统计仅描述。':''}\n截断：${data.capacity.truncated}；丢弃：${data.capacity.dropped}\n${manifest.error||''}\n未设定达标阈值；尚未接受基准。终点为画布提交/同帧复用，不是物理显示。\n读取含未拆分生成/IPC，实际硬解、像素质量、全进程资源未独立验证。\n比较：${m.comparison.reason||m.comparison.note}\n`);
    const history=(await entries(root)).filter(e=>e.manifest.conditionHash===manifest.conditionHash);
    await fsp.writeFile(path.join(dir,'report.html'),render(manifest,data,m,history));
    manifest.fileHashes={};for(const name of ['metrics.json','requests.json','events.jsonl','report.html','summary.md'])manifest.fileHashes[name]=hash(await fsp.readFile(path.join(dir,name),'utf8'));
    manifest.reportComplete=true;await atomic(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));
    await validate(dir,{staged:true});await fsp.rename(dir,finalDir);published=true;
    return {dir:finalDir,manifest,metrics:m};
  }catch(e){if(!published)try{await removeStage(root,dir);}catch(cleanup){e.message+='；未发布记录清理失败：'+cleanup.message;}throw e;}
}
async function validate(dir,{optimization=false,staged=false}={}){
  const required=['manifest.json','metrics.json','events.jsonl','requests.json','report.html','summary.md','analysis.md'];
  for(const f of required){const st=await fsp.lstat(path.join(dir,f));if(!st.isFile()||st.isSymbolicLink()||st.size>24*1024*1024)throw Error('证据文件无效：'+f);}
  const m=await json(path.join(dir,'manifest.json')),metric=await json(path.join(dir,'metrics.json')),data=await json(path.join(dir,'requests.json'));
  if((staged?'.pending-':'')+m.runId!==path.basename(dir)||!m.code?.workspaceHash||!m.source||!m.environment||!m.definition||!m.measurementScope||!m.reportComplete)throw Error('运行身份、口径或完整状态缺失');
  usable(m,data);
  if(!['completed','failed','cancelled','timeout'].includes(m.status))throw Error('完成状态无效');
  if(m.status==='completed'&&(!metric.requests||!m.source.sha256))throw Error('完成记录没有素材或请求证据');
  if(metric.definition.version!==DEFINITION.version||metric.requests!==data.requests.length||data.requests.some(r=>r.status==='pending'))throw Error('请求闭环或统计口径无效');
  if(new Set(data.requests.map(r=>r.id)).size!==data.requests.length||data.requests.some(r=>!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.end<r.start))throw Error('请求身份或单调时序无效');
  if(m.schema>=2){
    if(m.conditionHash!==hash(condition(m))||!m.fileHashes)throw Error('条件或证据摘要缺失');
    for(const name of ['metrics.json','requests.json','events.jsonl','report.html','summary.md'])if(m.fileHashes[name]!==hash(await fsp.readFile(path.join(dir,name),'utf8')))throw Error('证据被改动：'+name);
    const expected=metrics(data);if(JSON.stringify(expected.latency)!==JSON.stringify(metric.latency))throw Error('延迟统计不可复算');
    const raw=(await fsp.readFile(path.join(dir,'events.jsonl'),'utf8')).trim();const events=raw?raw.split('\n').map(JSON.parse):[];if(JSON.stringify(events)!==JSON.stringify(data.events))throw Error('事件源与统计输入不一致');
  }
  if(JSON.stringify(metrics(data).outcomes)!==JSON.stringify(metric.outcomes)||metric.coverage.truncated!==data.capacity.truncated)throw Error('统计与证据不一致');
  if(m.benchmark?.verified&&m.status==='completed'){
    if(!['ready-review-v2','isolated-ready-v2','ready-review-v3'].includes(m.benchmark.version)||!m.conditions?.initialCache)throw Error('固定测试准备证据缺失');
    const protocol=require('./performance-protocol.cjs'),runner=require('./performance-runner.cjs');
    for(const key of ['repeats','cadenceMs','dragInputs','randomSeeks','seed'])if(m.protocol?.[key]!==protocol.FIXED[key])throw Error('固定操作协议改变');
    const expected=[];for(let round=1;round<=3;round++)for(const scene of runner.sequence(m.source.duration,protocol.FIXED))scene.times.forEach((target,i)=>expected.push({target,scenario:scene.name+'/round-'+round,final:scene.kind!=='drag'||i===scene.times.length-1}));
    if(data.requests.length!==expected.length||data.requests.some((r,i)=>r.scenario!==expected[i].scenario||Math.abs(r.target-expected[i].target)>1e-7||r.final!==expected[i].final))throw Error('固定测试轨迹不完整或被其它输入干扰');
  }
  const html=await fsp.readFile(path.join(dir,'report.html'),'utf8');for(const id of ['latency','stages','comparison'])if(!html.includes('id="'+id+'"'))throw Error('缺少图表：'+id);
  if(metric.comparison.eligible){
    if(!/^[\w-]+$/.test(metric.comparison.runId||'')||metric.comparison.runId===m.runId)throw Error('对照身份缺失');
    const before=await json(path.join(path.dirname(dir),metric.comparison.runId,'manifest.json'));
    if(hash(condition(before))!==hash(condition(m))||before.status!=='completed'||m.status!=='completed')throw Error('对照条件无效');
  }
  if(optimization){const a=await fsp.readFile(path.join(dir,'analysis.md'),'utf8');if(!metric.comparison.eligible||a.includes('尚未进行 AI 分析')||!a.includes(m.runId)||!a.includes(m.code.workspaceHash))throw Error('优化交付缺少有效前后数据或本轮AI分析');}
  return {runId:m.runId,evidenceComplete:true,performancePassed:null,status:m.status};
}
module.exports={entries,render,save,validate,index,list,previous,json,hash,runId,codeSnapshot,environment,condition,compare,capacity,usable,recover,STYLE,spark,STORE_LIMIT,MAX_RUNS};
