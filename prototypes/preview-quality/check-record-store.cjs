'use strict';
// Explicit bounded real-filesystem check, never part of the default model suite.
const fs=require('fs'),path=require('path'),assert=require('assert'),cp=require('child_process');
const w=require('./workspace.cjs'),{openStore,allocationOwner}=w._test;
if(process.argv[2]==='--child'){
  const writer=openStore(process.argv[3]).writer('concurrent-fixture');
  for(let n=0;n<3;n++)writer.append({fixture:true,n});
  console.log(JSON.stringify(writer.close()));
}else main().catch(e=>{console.error(e.stack);process.exitCode=1;});
async function main(){
  const actual=w.store(),confirmedClosed=process.argv.includes('--confirmed-legacy-writers-closed');
  if(!actual.inventory().upgraded&&!confirmedClosed)throw Error('先取得旧窗口关闭确认，再显式启用记录分配更新；本次未创建测试现场');
  const work=w.scratch();if(work.bytes()+2*1024**2>w.LIMITS.disk)throw Error('No scratch space reserved for record check');
  const dirs=[],checks=[];
  function fixture(name){const root=path.join(work.root,name);fs.mkdirSync(root);dirs.push({root,identity:w.identity(root,true)});return root;}
  function legacy(root,count){fs.writeFileSync(path.join(root,'owner.json'),JSON.stringify(allocationOwner()),{flag:'wx'});
    for(let i=1;i<=count;i++)fs.writeFileSync(path.join(root,'slot-'+String(i).padStart(3,'0')+'.jsonl'),JSON.stringify({fixture:i})+'\n',{flag:'wx'});}
  const root=fixture('legacy');legacy(root,63);
  const original=fs.readdirSync(root).map(name=>({name,sha256:w.hashFile(path.join(root,name))})),old=openStore(root);
  assert.throws(()=>old.writer('must-wait'),e=>e.code==='EVIDENCE_POLICY_UPGRADE_REQUIRED');
  assert.throws(()=>old.upgrade(),/Close legacy/);assert(!fs.existsSync(path.join(root,'policy-v2.json')));
  const upgrade=old.upgrade({confirmedClosed:true});assert(upgrade.allOriginalsUnchanged);
  for(const x of original)assert.strictEqual(w.hashFile(path.join(root,x.name)),x.sha256);
  const bounded=old.writer('exact-boundary');bounded.append('x'.repeat(w.LIMITS.slot-bounded.bytes-3));
  assert.strictEqual(bounded.bytes,w.LIMITS.slot);assert.throws(()=>bounded.append({overflow:true}),e=>e.code==='EVIDENCE_CAPACITY');
  assert.deepStrictEqual(bounded.close(),bounded.close());assert.throws(()=>bounded.append(1),/closed/);
  while(old.inventory().files<w.LIMITS.files)old.save('fill-fixture',{bounded:true});
  assert.strictEqual(old.inventory().files,128);assert(old.inventory().bytes<=w.LIMITS.evidence);
  assert.throws(()=>old.writer('overflow'),e=>e.code==='EVIDENCE_CAPACITY');assert.strictEqual(openStore(root).inventory().files,128);
  checks.push('63 legacy records and owner preserved; cap boundary,127th record refusal, repeated close and reopen');
  const large=fixture('large');legacy(large,1);fs.appendFileSync(path.join(large,'slot-001.jsonl'),Buffer.alloc(w.LIMITS.slot));
  const largeHash=w.hashFile(path.join(large,'slot-001.jsonl'));assert.throws(()=>openStore(large).upgrade({confirmedClosed:true}),/exceeds new/);
  assert.strictEqual(w.hashFile(path.join(large,'slot-001.jsonl')),largeHash);assert(!fs.existsSync(path.join(large,'policy-v2.json')));
  checks.push('oversized legacy record refuses upgrade without mutation');
  const changed=fixture('changed'),changedStore=openStore(changed),record=changedStore.writer('changed-fixture');record.append({owned:true});
  fs.appendFileSync(record.file,'{"foreign":true}\n');assert.throws(()=>record.append(1),/changed/);assert.throws(()=>record.close(),/changed/);
  fs.writeFileSync(path.join(changed,'unexpected.json'),'{}',{flag:'wx'});assert.throws(()=>openStore(changed),/Unknown/);
  checks.push('changed record cannot be appended or blessed; unknown file retained');
  const rotation=fixture('rotation'),rotationStore=openStore(rotation),first=rotationStore.writer('selected-display-session');
  first.append({fixture:true,padding:'x'.repeat(66000)});const firstReceipt=first.close();
  const next=require('./selected-display.cjs').openJournal(firstReceipt,rotationStore);assert.notStrictEqual(next.file,first.file);next.close();
  assert.strictEqual(w.hashFile(first.file),firstReceipt.sha256);
  checks.push('selected-session rollover opens a new file and preserves old receipt/hash');
  const concurrent=fixture('concurrent');openStore(concurrent);
  const results=await Promise.allSettled(Array.from({length:8},()=>new Promise((resolve,reject)=>{
    const child=cp.spawn(process.execPath,[__filename,'--child',concurrent],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let out='',err='';
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',reject);child.once('close',code=>{
      if(code!==0)return reject(Error(err||String(code)));try{resolve(JSON.parse(out));}catch(e){reject(e);}});
  })));
  for(const result of results)assert.strictEqual(result.status,'fulfilled',result.reason&&result.reason.message);
  assert.strictEqual(new Set(results.map(r=>r.value.file)).size,8);
  for(const result of results){const rows=fs.readFileSync(path.join(w.REPO,result.value.file),'utf8').trim().split('\n').map(JSON.parse);assert.strictEqual(rows.length,4);}
  checks.push('8 actual concurrent processes receive distinct atomically allocated files');
  const files=dirs.flatMap(d=>fs.readdirSync(d.root).map(name=>{const file=path.join(d.root,name);return {file,identity:w.identity(file),sha256:w.hashFile(file)};}));
  const migration=actual.upgrade({confirmedClosed}),log=actual.writer('record-store-check');
  log.append({runtime:process.version,checks,realEagleWindow:false,migrationReceipt:migration.receipt||null});
  log.append({cleanupPlan:{root:path.relative(w.REPO,work.root),files:files.map(f=>({...f,file:path.relative(w.REPO,f.file)}))}});log.flush();
  for(const f of files){assert(path.relative(work.root,f.file)&&!path.relative(work.root,f.file).startsWith('..'));assert.deepStrictEqual(w.identity(f.file),f.identity);assert.strictEqual(w.hashFile(f.file),f.sha256);fs.unlinkSync(f.file);}
  for(const d of dirs){const now=w.identity(d.root,true);assert.strictEqual(now.ino,d.identity.ino);assert.strictEqual(now.dev,d.identity.dev);assert.strictEqual(fs.readdirSync(d.root).length,0);fs.rmdirSync(d.root);}
  log.append({cleanupResult:{files:files.length,bytes:files.reduce((n,x)=>n+x.identity.bytes,0)}});log.flush();
  work.remove([],require('./selected-display.cjs').journal(log));
  console.log(JSON.stringify({passed:true,checks,originalsPreserved:migration.allOriginalsUnchanged||migration.alreadyUpgraded,receipt:log.close(),realEagleWindow:false}));
}
