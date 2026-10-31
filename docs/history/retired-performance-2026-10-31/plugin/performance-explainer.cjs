'use strict';
// Presentation only: conclusions must follow a measured boundary, not guessed internals.
const finite = n => typeof n === 'number' && Number.isFinite(n);
const success = r => ['shown','reused'].includes(r.status);
function time(value) {
  if (!finite(value)) return '未测到';
  if (value >= 1000) return (value / 1000).toFixed(2) + ' 秒';
  return Math.round(value) + ' 毫秒';
}
function phases(request, at) {
  if (!request) return [];
  const end = request.status === 'pending' ? at : request.end;
  if (!finite(end)) return [];
  const spans = (request.stages || []).filter(s=>finite(s.start)&&finite(s.end)).map(s=>({...s}));
  if (request.status === 'pending' && request.activeStage) spans.push({...request.activeStage,end:at});
  const rows = [
    {name:'asset',label:'读取 / 准备',color:'#d5a36c'},
    {name:'decode',label:'解码',color:'#839dc6'}
  ].map(row=>{
    const found=spans.filter(s=>s.name===row.name);
    return {...row,ms:found.length?found.reduce((sum,s)=>sum+Math.max(0,Math.min(end,s.end)-Math.max(request.start,s.start)),0):null,
      active:request.status==='pending'&&request.activeStage?.name===row.name};
  });
  const decoded=spans.filter(s=>s.name==='decode').at(-1)?.end;
  rows.push({name:'submit',label:'等待绘制',color:'#6ba694',
    ms:finite(decoded)&&success(request)?Math.max(0,end-decoded):null,active:false});
  const intervals=spans.map(s=>[Math.max(request.start,s.start),Math.min(end,s.end)]).filter(([a,b])=>b>=a).sort((a,b)=>a[0]-b[0]);
  if(finite(decoded)&&success(request))intervals.push([decoded,end]);
  intervals.sort((a,b)=>a[0]-b[0]);let covered=0,last=request.start;
  for(const [a,b]of intervals){covered+=Math.max(0,b-Math.max(a,last));last=Math.max(last,b);}
  rows.push({name:'other',label:'未归因',color:'#71818d',ms:Math.max(0,end-request.start-covered),active:false});
  return rows;
}
function explain(data, context={}, at=0) {
  const requests=data?.requests||[],latest=requests.at(-1),pending=latest?.status==='pending',preview=!!context.previewActive;
  const age=latest?Math.max(0,(pending?at:latest.end)-latest.start):null;
  const rows=phases(latest,at);
  let title='等待操作',detail='拖动或播放时，这里说明正在等待什么。',action='无需操作。',tone='quiet';
  if(context.state==='preparing'){
    title='正在准备视频';detail=context.progressMessage||'播放器还没有可显示的画面，具体内部耗时暂时无法细分。';action='准备完成后可继续。';tone='waiting';
  }else if(preview){
    title='低清预览';detail='目标画面还没就绪，先显示临时预览，避免画面一直停住。';action='松手后等待准确画面；如果持续不恢复，保存这次记录。';tone='waiting';
  }else if(pending){
    tone='waiting';
    if(latest.activeStage?.name==='decode'){title='解码中';detail='目标数据已拿到，正在将压缩数据还原为画面。';}
    else if(latest.targetPrepared===false&&context.backend==='proxy'){title='分段准备中';detail='尚未收到这个位置的代理就绪通知，取画面仍在等待。';}
    else if(latest.activeStage?.name==='asset'){title='读取中';detail='等待数据返回；读取、检查和内部传输目前不能单独区分。';}
    else if(latest.cache==='inflight'){title='等待已有准备任务';detail='这个位置已有任务在处理，当前操作正在等它返回。';}
    else{title='等待目标画面';detail='已收到最新位置，等待环节尚不能进一步确定。';}
    action='不需要反复点击；若总在同一位置卡住，可保存体验记录。';
  }else if(latest?.status==='failed'||latest?.status==='wrong-frame'){
    title='这次画面没有正常完成';detail='已保留失败记录，不能当成一次很快的操作。';action='保存体验记录，供后续排查。';tone='error';
  }else if(latest&&success(latest)){
    title='画面已跟上';detail=(latest.cache==='decoded'?'这次直接使用已准备好的画面。':'准确目标画面已交给绘制系统。');
    if(age>=120){const largest=rows.filter(r=>finite(r.ms)).sort((a,b)=>b.ms-a.ms)[0];detail='刚才等待 '+time(age)+'，主要时间在“'+largest.label+'”。';}
    action='可以继续观察，不需要调整设置。';tone='ready';
  }else if(latest){title='目标已随操作更新';detail='旧位置已经放弃，后续等待以最新位置为准。';}
  return {title,detail,action,tone,delay:age,preview,phases:rows,requestId:latest?.id||null,
    caution:'耗时来自软件内部观察，不能据此直接认定显卡、硬盘或CPU慢。'};
}
function score(metrics,data) {
  const p95=a=>{const v=a.filter(finite).sort((a,b)=>a-b);return v.length?v[Math.ceil(v.length*.95)-1]:null;};
  const rows=data?.requests||[],jumps=rows.filter(r=>r.scenario?.startsWith('fixed-random-seek')&&success(r));
  const releases=rows.filter(r=>r.final&&['drag','rapid','release'].includes(r.kind)&&success(r));
  const low=rows.filter(r=>r.preview&&success(r)&&r.end>=r.preview.at);
  const drags=Object.values(metrics.drags||{});
  return {jump:p95(jumps.map(r=>r.latencyMs)),release:p95(releases.map(r=>r.latencyMs)),
    freeze:drags.length?Math.max(...drags.map(r=>r.maxNoUpdateMs)):null,
    previewWait:p95(low.map(r=>r.end-r.preview.at)),previewCount:rows.filter(r=>r.preview).length,
    failed:(metrics.outcomes.failed||0)+(metrics.outcomes['wrong-frame']||0)+(metrics.outcomes.timeout||0),
    displaced:metrics.outcomes.superseded||0,total:metrics.requests,samples:{jump:jumps.length,release:releases.length,drags:drags.length,preview:low.length},
    memory:metrics.resources.rssPeakBytes,managed:metrics.resources.managedPeakBytes};
}
module.exports={explain,phases,time,score};
