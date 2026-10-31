'use strict';
// Explicit local workflow commands. Never launches AI, changes baseline or commits.
const fs=require('fs').promises,path=require('path');
const api=require('../plugin/performance-report.cjs');
const inbox=require('../plugin/performance-inbox.cjs');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'artifacts/performance'),docs=path.join(repo,'docs/performance');
async function status(dir){
  await api.validate(dir);const manifest=await api.json(path.join(dir,'manifest.json')),metrics=await api.json(path.join(dir,'metrics.json'));
  const old=await api.json(path.join(docs,'status-data.json')).catch(()=>({analysis:null}));
  const analysis=await fs.readFile(path.join(dir,'analysis.md'),'utf8');
  const actual=!analysis.includes('尚未进行 AI 分析')&&analysis.includes(manifest.runId)&&analysis.includes(manifest.code.workspaceHash);
  if(actual&&manifest.analysis!=='complete'){
    manifest.analysis='complete';manifest.analysisCode=manifest.code.workspaceHash;
    const file=path.join(dir,'manifest.json'),tmp=file+'.analysis.tmp';await fs.writeFile(tmp,JSON.stringify(manifest,null,2));await fs.rename(tmp,file);
  }
  const data={facts:{runId:manifest.runId,code:manifest.code.workspaceHash,status:manifest.status,requests:metrics.requests,p50:metrics.latency.p50,p95:metrics.latency.p95,source:manifest.source.sha256,scope:manifest.measurementScope},analysis:actual?{runId:manifest.runId,code:manifest.code.workspaceHash}:old.analysis};
  await fs.mkdir(docs,{recursive:true});await api.validate(dir);
  await fs.writeFile(path.join(docs,'status-data.json'),JSON.stringify(data,null,2)+'\n');
  const stale=data.analysis?.runId!==data.facts.runId||data.analysis?.code!==data.facts.code;
  await fs.writeFile(path.join(docs,'STATUS.md'),`# 性能当前状态\n\n## 最新测试事实\n\n运行：${data.facts.runId}\n\n代码快照：${data.facts.code}\n\n状态：${data.facts.status}，待审阅；范围：${data.facts.scope}。请求 ${metrics.requests}，成功 ${metrics.latency.n}，P50 ${metrics.latency.p50} ms，P95 ${metrics.latency.p95} ms。未设定达标阈值，尚未接受基准。\n\n[测试对比图](../../artifacts/performance/report.html) · [事实摘要](../../artifacts/performance/runs/${manifest.runId}/summary.md)\n\n## 最新 AI 分析\n\n${stale?'**旧分析，尚未更新**（或尚无分析）；与最新测试未绑定。':'分析与本轮运行及代码快照一致。'}\n\n${data.analysis?`运行：${data.analysis.runId}\n\n代码快照：${data.analysis.code}\n\n[分析](../../artifacts/performance/runs/${data.analysis.runId}/analysis.md)`:'尚未进行 AI 分析。'}\n`);
  return data;
}
async function main(args=process.argv.slice(2)){
 const [command,target,...rest]=args;
 if(command==='refresh'){const destination=target?path.resolve(target):root;if(![root,path.join(repo,'plugin/performance-reports')].includes(destination))throw Error('重绘只写当前工作区报告目录');await api.index(destination);console.log(path.join(destination,'report.html'));return;}
 if(command==='latest'){const rows=[];for(const base of [root,path.join(repo,'plugin/performance-reports')]){const pending=await inbox.read(base);for(const [kind,id]of Object.entries(pending.slots)){if(!id||rows.some(r=>r.runId===id))continue;const dir=path.join(base,'runs',id);await api.validate(dir);const m=await api.json(path.join(dir,'manifest.json'));rows.push({kind,runId:id,status:m.status,path:dir,complete:m.reportComplete});}}rows.sort((a,b)=>b.runId.localeCompare(a.runId));console.log(JSON.stringify(rows.length?{...rows[0],pending:rows}:{status:'no-pending-report'},null,2));return;}
 if(!target)throw Error('用法：node scripts/performance.cjs latest | validate <run目录> [--optimization] | import <run目录> | analyze <run目录> <分析文件>');
 const dir=path.resolve(target);
 if(command==='validate'){console.log(JSON.stringify(await api.validate(dir,{optimization:rest.includes('--optimization')})));return;}
 if(command==='import'){
   await api.validate(dir);await api.capacity(root);const dest=path.join(root,'runs',path.basename(dir));
   if(dest!==dir){await fs.mkdir(dest);for(const name of ['manifest.json','metrics.json','events.jsonl','requests.json','report.html','summary.md','analysis.md'])await fs.copyFile(path.join(dir,name),path.join(dest,name),require('fs').constants.COPYFILE_EXCL);}
   await api.validate(dest);await api.index(root);await status(dest);console.log(dest);return;
 }
 if(command==='analyze'){
   if(path.dirname(dir)!==path.join(root,'runs'))throw Error('先导入工作区再登记分析');
   await api.validate(dir);const m=await api.json(path.join(dir,'manifest.json')),text=await fs.readFile(path.resolve(rest[0]),'utf8');
   if(text.length>65536||!text.includes(m.runId)||!text.includes(m.code.workspaceHash)||text.includes('尚未进行 AI 分析'))throw Error('分析必须绑定本轮run_id与代码快照');
   const existing=await fs.readFile(path.join(dir,'analysis.md'),'utf8');if(!existing.includes('尚未进行 AI 分析'))throw Error('已有分析，禁止覆盖历史');
   // Freeze legacy migration before marking the manifest analysed. Otherwise
   // a missing pending index would resurrect the previous unanalysed run.
   for(const base of [root,path.join(repo,'plugin/performance-reports')]){const pending=await inbox.read(base);await inbox.replace(base,'standard',pending.slots.standard,pending.slots.standard);}
   await fs.writeFile(path.join(dir,'analysis.md'),text);await status(dir);
   for(const base of [root,path.join(repo,'plugin/performance-reports')]){await inbox.acknowledge(base,m.runId);await api.index(base);}
   console.log('AI分析登记完成；对应待分析槽已核销');return;
 }
 throw Error('未知命令');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,status};
