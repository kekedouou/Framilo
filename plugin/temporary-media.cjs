'use strict';
// Window-owned, disposable media. Never touches annotations/preferences/library data.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const identities=require('./process-identity.cjs'),{valid,proveGone}=identities._test;
const OWNER='motionote-temporary-media-v1',ID=/^[a-f0-9]{32}$/;
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
async function stat(file,dir=false){const s=await fs.promises.lstat(file);if(s.isSymbolicLink()||(dir?!s.isDirectory():!s.isFile()||s.nlink!==1)||!same(await fs.promises.realpath(file),file))throw Error('临时媒体身份无法确认');return s;}
async function readOwner(dir){const f=path.join(dir,'session.json');if((await stat(f)).size>64*1024)throw Error('临时媒体归属记录过大');return JSON.parse(await fs.promises.readFile(f,'utf8'));}
// Every permitted descendant has a fixed producer and naming contract. Even
// inside an owned directory, an unknown file/link stops the entire deletion.
async function inventory(dir){await stat(dir,true);const files=[],dirs=[];
 async function walk(at,rel=''){for(const entry of await fs.promises.readdir(at,{withFileTypes:true})){const r=rel?rel+'/'+entry.name:entry.name,f=path.join(at,entry.name);
  const directory=/^(?:whole-v1|leases-v1|whole-v1\/(?:[a-f0-9]{64}|\.pending-[a-f0-9]{32}))$/.test(r);
  if(entry.isDirectory()&&directory){await stat(f,true);
   if(r.startsWith('whole-v1/')){const marker=path.join(f,'owner.json');if((await stat(marker)).size>2048)throw Error('代理归属记录过大');const v=JSON.parse(await fs.promises.readFile(marker,'utf8'));if(v.schema!=='e44-whole-proxy-v1'||!ID.test(v.token||'')||!Number.isSafeInteger(v.pid)||v.pid<=0||!/^[a-f0-9]{64}$/.test(v.sourceHash||'')||(entry.name.startsWith('.pending-')&&entry.name!=='.pending-'+v.token))throw Error('代理生成物归属无法确认');}
   await walk(f,r);dirs.push(f);continue;}
  const allowed=/^(?:session(?:\.next)?\.json|space\.json|(?:access|allocation)\.lock|leases-v1\/[a-f0-9]{64}-[a-f0-9]{32}\.json|whole-v1\/[a-f0-9]{64}\.lock|whole-v1\/(?:[a-f0-9]{64}|\.pending-[a-f0-9]{32})\/(?:owner\.json|video\.mp4|complete\.json|last-use\.json))$/.test(r);
  if(!allowed||!entry.isFile())throw Error('临时媒体目录含未知文件，已保留');const s=await stat(f);files.push({file:f,identity:[s.dev,s.ino,s.size,s.mtimeMs].join(':')});
 }}await walk(dir);return{files,dirs};}
async function erase(dir,expected){const owner=await readOwner(dir);if(owner.owner!==OWNER||owner.id!==expected.id||JSON.stringify(owner.processIdentity)!==JSON.stringify(expected.processIdentity))throw Error('临时媒体归属变化');
 const list=await inventory(dir);for(const item of list.files){const s=await stat(item.file);if([s.dev,s.ino,s.size,s.mtimeMs].join(':')!==item.identity)throw Error('临时媒体仍在变化');}
 // Rename claims the entire inactive namespace. Another recoverer cannot enter
 // the original path after this point. A crash here is recovered next launch.
 const claimed=path.join(path.dirname(dir),'retiring-'+owner.id);if(dir!==claimed)await fs.promises.rename(dir,claimed);
 for(const item of list.files.filter(x=>!x.file.endsWith(path.sep+'session.json'))){const file=path.join(claimed,path.relative(dir,item.file));await stat(file);await fs.promises.unlink(file);}
 for(const d of list.dirs)await fs.promises.rmdir(path.join(claimed,path.relative(dir,d)));
 await fs.promises.unlink(path.join(claimed,'session.json'));await fs.promises.rmdir(claimed);return list.files.length;
}
function createTemporaryMedia({pluginRoot,query=identities.snapshotAsync,spawn=cp.spawn,stopGraceMs=2500,stopTimeoutMs=5000}={}){
 const parent=path.resolve(pluginRoot,'cache/sessions-v1'),id=crypto.randomBytes(16).toString('hex'),dir=path.join(parent,id);
 let body,closing=false,persist=Promise.resolve(),queryTask=null,stopTask=null;const children=new Set(),stopWaiters=new Set();
 const write=()=>{try{fs.writeFileSync(path.join(dir,'session.next.json'),JSON.stringify(body));fs.renameSync(path.join(dir,'session.next.json'),path.join(dir,'session.json'));}catch(e){persist=Promise.reject(e);persist.catch(()=>{});}return persist;};
 const ready=(async()=>{await fs.promises.mkdir(parent,{recursive:true});await stat(parent,true);let rows=[];const oldNames=await fs.promises.readdir(parent),hasOrphans=oldNames.some(n=>ID.test(n)||/^retiring-/.test(n));if(hasOrphans){try{rows=await query();}catch(_){}}const self=rows.find(r=>r.pid===process.pid);const recovery=[];
  for(const name of await fs.promises.readdir(parent)){if(!ID.test(name)&&!/^retiring-[a-f0-9]{32}$/.test(name))continue;const old=path.join(parent,name);try{await stat(old,true);const record=await readOwner(old);if(record.owner!==OWNER||!ID.test(record.id)||name.replace(/^retiring-/,'')!==record.id)throw Error('unknown-owner');const proof=proveGone(record,rows);if(!rows.length||!proof.safe)throw Error(proof.reason);const lock=path.join(parent,'capacity.lock');try{const ls=await stat(lock);if(ls.size>1024)throw Error('容量锁过大');const bytes=await fs.promises.readFile(lock,'utf8'),value=JSON.parse(bytes);if(value.id===record.id){const claimed=lock+'.reap-'+id;await fs.promises.rename(lock,claimed);if(await fs.promises.readFile(claimed,'utf8')!==bytes){await fs.promises.link(claimed,lock).catch(()=>{});throw Error('容量锁变化');}await fs.promises.unlink(claimed);}}catch(e){if(e.code!=='ENOENT')throw e;}recovery.push({id:record.id,status:'removed',files:await erase(old,record)});}catch(e){recovery.push({id:name,status:'retained',reason:e.message});}}
  await fs.promises.mkdir(dir);body={owner:OWNER,id,processIdentity:valid(self)?self:null,children:[],createdAt:new Date().toISOString()};await write();if(!hasOrphans)Promise.resolve().then(()=>query([process.pid])).then(rows=>{if(closing)return;const self=rows.find(r=>r.pid===process.pid);if(valid(self)){body.processIdentity=self;return write();}}).catch(()=>{});return{directory:dir,recovery};})();
 function refresh(){if(queryTask)return;queryTask=Promise.resolve().then(()=>query([...children].map(c=>c.proc.pid).filter(Number.isSafeInteger))).then(rows=>{if(closing)return;for(const c of children){if(c.record.state!=='starting'||c.proc.exitCode!=null)continue;const r=rows.find(r=>r.pid===c.proc.pid);if(valid(r)&&r.parentPid===process.pid){c.record.identity=r;c.record.state='running';}}return write();}).catch(()=>{}).finally(()=>{queryTask=null;});}
 function ownedSpawn(exe,args,options){if(closing||!body)throw Error('临时媒体尚未准备或正在关闭');const record={state:'starting',image:exe};body.children.push(record);
  // Register intent BEFORE spawning. A crash in this small interval retains the
  // directory, rather than guessing that an unregistered writer is dead.
  const bytes=JSON.stringify(body);fs.writeFileSync(path.join(dir,'session.next.json'),bytes);fs.renameSync(path.join(dir,'session.next.json'),path.join(dir,'session.json'));
  let proc;try{proc=spawn(exe,args,options);}catch(e){record.state='closed';write();throw e;}record.pid=proc.pid||null;const c={proc,record};children.add(c);write();refresh();
  proc.once('close',()=>{children.delete(c);body.children=body.children.filter(r=>r!==record);write();if(!children.size)for(const done of [...stopWaiters])done();});return proc;
 }
 function beginClose(){
  closing=true;if(stopTask)return stopTask;
  stopTask=ready.then(()=>new Promise((resolve,reject)=>{
   let grace,deadline,forced=0;
   const finish=error=>{clearTimeout(grace);clearTimeout(deadline);stopWaiters.delete(done);error?reject(error):resolve({forced,remaining:0});};
   const done=()=>finish();if(!children.size){done();return;}stopWaiters.add(done);
   // Bound to original ChildProcess handles, never kill by a reused PID or name.
   grace=setTimeout(()=>{for(const c of children)try{if(c.proc.exitCode==null&&c.proc.signalCode==null){c.proc.kill();forced++;}}catch(_){}},stopGraceMs);
   deadline=setTimeout(()=>finish(Error('媒体进程仍在运行，临时缓存保留以便恢复')),stopTimeoutMs);
  }));stopTask.catch(()=>{stopTask=null;});return stopTask;
 }
 async function close(){await beginClose();await persist;if(children.size)throw Error('媒体进程仍在运行，临时缓存保留以便恢复');body.children=[];await write();const files=await erase(dir,body);return{status:'cleared',files};}
 return{ready,directory:dir,spawn:ownedSpawn,beginClose,close,reserve:opts=>require('./media-space.cjs').reserve(dir,opts),active:()=>children.size};
}
module.exports={createTemporaryMedia,_test:{inventory,erase,readOwner,OWNER}};
