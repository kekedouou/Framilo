'use strict';
// One approved cleanup, exact observed run IDs; never touches a later user run or media cache.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const repo=path.resolve(__dirname,'..'),keep='2026-10-27T10-01-37-500Z-8bc31f53';
const remove=new Set(['2026-10-27T07-08-42-138Z-b7e0d4b8','2026-10-27T07-09-23-484Z-77ed7cf8','2026-10-27T07-11-07-601Z-acaef966','2026-10-27T08-52-57-793Z-ce4701c2','2026-10-27T08-53-04-769Z-31709638','2026-10-27T08-56-58-756Z-5d4a50fc','2026-10-27T08-57-08-922Z-7dd4514f','2026-10-27T08-57-45-296Z-d5d32142','2026-10-27T10-04-55-218Z-b33e2faa','2026-10-27T06-24-48-148Z-c94fffaa','2026-10-27T06-30-00-868Z-83868a02','2026-10-27T06-45-12-434Z-80eb2b25']);
const allowed=new Set(['manifest.json','metrics.json','requests.json','events.jsonl','report.html','summary.md','analysis.md']);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function identity(file){const s=fs.lstatSync(file);assert(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1);assert.equal(fs.realpathSync(file).toLowerCase(),file.toLowerCase());return{file:path.relative(repo,file),bytes:s.size,dev:String(s.dev),ino:String(s.ino),sha256:hash(fs.readFileSync(file))};}
function same(row){assert.deepEqual(identity(path.join(repo,row.file)),row,'file changed since inventory');}
async function main(){
 const api=require('../plugin/performance-report.cjs'),inbox=require('../plugin/performance-inbox.cjs');const roots=['plugin/performance-reports','artifacts/performance'];const files=[],dirs=[],retained=[];
 for(const rel of roots){const root=path.join(repo,rel);assert.equal(fs.realpathSync(root).toLowerCase(),root.toLowerCase());await api.validate(path.join(root,'runs',keep));
  for(const name of allowed)retained.push(identity(path.join(root,'runs',keep,name)));
  for(const id of fs.readdirSync(path.join(root,'runs'))){if(!remove.has(id))continue;const dir=path.join(root,'runs',id);assert.equal(fs.realpathSync(dir).toLowerCase(),dir.toLowerCase());assert(!fs.lstatSync(dir).isSymbolicLink());assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))).runId,id);
   for(const name of fs.readdirSync(dir)){assert(allowed.has(name));files.push(identity(path.join(dir,name)));}dirs.push(dir);
  }
 }
 for(const rel of ['artifacts/performance/standard-profile.json','verification-runs/e40/manual-analysis.md','verification-runs/e40/standard-analysis.md']){
  const file=path.join(repo,rel);if(fs.existsSync(file))files.push(identity(file));
 }
 const receipt={at:new Date().toISOString(),keep,runCopies:dirs.length,files,retained,bytes:files.reduce((n,f)=>n+f.bytes,0),status:'inventoried'};
 if(!process.argv.includes('--execute')){console.log(JSON.stringify({runCopies:receipt.runCopies,files:files.length,bytes:receipt.bytes,keep}));return;}
 const out=path.join(repo,'verification-runs/e41/old-performance-cleanup.json');fs.writeFileSync(out,JSON.stringify(receipt,null,2),{flag:'wx'});
 for(const row of files){same(row);fs.unlinkSync(path.join(repo,row.file));}for(const dir of dirs)fs.rmdirSync(dir);
 for(const rel of roots){const root=path.join(repo,rel),pending=await inbox.read(root);for(const kind of ['manual','standard'])await inbox.replace(root,kind,pending.slots[kind],pending.slots[kind]);
  const conditionFile=path.join(root,'test-conditions.json');if(fs.existsSync(conditionFile)){const m=JSON.parse(fs.readFileSync(path.join(root,'runs',keep,'manifest.json'))),conditions=JSON.parse(fs.readFileSync(conditionFile));conditions.groups=conditions.groups.filter(g=>g.key===m.benchmark.key);conditions.active=conditions.groups[0]?.key||null;const tmp=conditionFile+'.e41-next';fs.writeFileSync(tmp,JSON.stringify(conditions,null,2),{flag:'wx'});fs.renameSync(tmp,conditionFile);}
  await api.index(root);
 }
 retained.forEach(same);receipt.status='completed';fs.writeFileSync(out,JSON.stringify(receipt,null,2));console.log(JSON.stringify({runCopies:dirs.length,files:files.length,bytes:receipt.bytes,keep,retainedUnchanged:true}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
