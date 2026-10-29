'use strict';
// Whole-proxy ownership, read leases and LRU. Only known derived assets may be removed.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const SCHEMA='e44-whole-proxy-v1',HEX=/^[a-f0-9]{64}$/;
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||!same(fs.realpathSync(file),file))throw Error('代理文件身份不符');return s;}
function json(file,max=6*1024**2){if(regular(file).size>max)throw Error('代理记录过大');return JSON.parse(fs.readFileSync(file,'utf8'));}
function directory(dir){const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||!same(fs.realpathSync(dir),dir))throw Error('代理目录身份不符');}
async function usage(root){let bytes=0;try{directory(root);for(const e of await fs.promises.readdir(root,{withFileTypes:true})){const f=path.join(root,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())bytes+=await usage(f);else if(e.isFile())bytes+=regular(f).size;}return bytes;}catch(e){if(e.code==='ENOENT')return 0;throw e;}}
function createStorage(root){
 root=path.resolve(root);const assets=path.join(root,'whole-v1'),leases=path.join(root,'leases-v1');
 async function init(){await fs.promises.mkdir(assets,{recursive:true});await fs.promises.mkdir(leases,{recursive:true});directory(root);directory(assets);directory(leases);}
 async function lock(name,wait=true){await init();const file=path.join(root,name+'.lock'),token=crypto.randomBytes(16).toString('hex'),body={owner:'eva-proxy-storage-v1',pid:process.pid,token},until=Date.now()+(wait?3000:0);
  for(;;){try{await fs.promises.writeFile(file,JSON.stringify(body),{flag:'wx'});return async()=>{try{const v=json(file,2048);if(v.token===token)await fs.promises.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}};}catch(e){if(e.code!=='EEXIST')throw e;
    let v;try{v=json(file,2048);}catch(_){throw Error('代理空间占用记录无法确认');}
    if(v.owner==='eva-proxy-storage-v1'&&Number.isSafeInteger(v.pid)&&v.pid>0&&!alive(v.pid)){// rename isolates a dead record before removal
     const moved=file+'.dead-'+token;try{await fs.promises.rename(file,moved);const after=json(moved,2048);if(after.token!==v.token){await fs.promises.link(moved,file);throw Error('代理占用状态变化');}await fs.promises.unlink(moved);continue;}catch(e){if(e.code==='ENOENT')continue;throw e;}}
    if(Date.now()>=until)throw Object.assign(Error('其它窗口正在管理代理空间，请稍后重试'),{code:'WHOLE_BUSY'});await new Promise(r=>setTimeout(r,25));}}
 }
 async function guarded(fn){const release=await lock('access');try{return await fn();}finally{await release();}}
 async function acquire(key){if(!HEX.test(key))throw Error('代理键无效');return guarded(async()=>{const token=crypto.randomBytes(16).toString('hex'),file=path.join(leases,key+'-'+token+'.json');await fs.promises.writeFile(file,JSON.stringify({owner:'eva-proxy-read-v1',pid:process.pid,key,token}),{flag:'wx'});let released=false;return async()=>{if(released)return;await guarded(async()=>{try{const v=json(file,2048);if(v.token!==token)throw Error('代理读者身份变化');await fs.promises.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}released=true;});};});}
 async function candidates(){directory(assets);const protectedKeys=new Set();for(const name of await fs.promises.readdir(leases)){await new Promise(resolve=>setImmediate(resolve));if(!/^([a-f0-9]{64})-([a-f0-9]{32})\.json$/.test(name))continue;const key=name.slice(0,64),file=path.join(leases,name);try{const v=json(file,2048);if(v.owner!=='eva-proxy-read-v1'||v.key!==key||!Number.isSafeInteger(v.pid)||v.pid<=0||alive(v.pid))protectedKeys.add(key);else await fs.promises.unlink(file);}catch(_){protectedKeys.add(key);}}
  const out=[];for(const key of await fs.promises.readdir(assets)){await new Promise(resolve=>setImmediate(resolve));if(!HEX.test(key)||protectedKeys.has(key)||fs.existsSync(path.join(assets,key+'.lock')))continue;
   const dir=path.join(assets,key);try{directory(dir);const names=fs.readdirSync(dir);if(names.some(n=>!['owner.json','video.mp4','complete.json','last-use.json'].includes(n)))continue;
    const m=json(path.join(dir,'complete.json'));if(m.schema!==SCHEMA||m.key!==key||!HEX.test(m.sourceHash)||!m.identity||crypto.createHash('sha256').update(JSON.stringify(m.identity)).digest('hex')!==key||m.identity.sourceHash!==m.sourceHash||!m.allKeyFrames||regular(path.join(dir,'video.mp4')).size!==m.bytes)continue;
    for(const n of names)regular(path.join(dir,n));let last=Date.parse(m.generatedAt)||0;try{last=Math.max(last,json(path.join(dir,'last-use.json'),2048).at||0);}catch(_){}
    out.push({key,dir,sourceHash:m.sourceHash,last,bytes:await usage(dir)});
   }catch(_){/* Unknown/foreign assets remain protected. */}}
  return out.sort((a,b)=>a.last-b.last);
 }
 async function touch(key){return guarded(async()=>{const dir=path.join(assets,key);directory(dir);const f=path.join(dir,'last-use.json');if(fs.existsSync(f))regular(f);await fs.promises.writeFile(f,JSON.stringify({at:Date.now()}));});}
 async function makeRoom(limit,needed,sourceHash){return guarded(async()=>{let used=await usage(root),freed=0,removed=0;for(const item of await candidates()){if(limit-used>=needed)break;if(item.sourceHash===sourceHash)continue;directory(item.dir);const actual=path.resolve(item.dir);if(path.dirname(actual)!==assets||!HEX.test(path.basename(actual)))throw Error('代理清理路径不在归属目录内');await fs.promises.rm(actual,{recursive:true});used-=item.bytes;freed+=item.bytes;removed++;}return{used,freed,removed,available:Math.max(0,limit-used)};});}
 async function measure(sourceHash){await init();let current=0;for(const name of await fs.promises.readdir(assets)){const dir=path.join(assets,name);try{if(HEX.test(name)){const m=json(path.join(dir,'complete.json'));if(m.schema===SCHEMA&&m.sourceHash===sourceHash)current+=await usage(dir);}else if(name.startsWith('.pending-')){const m=json(path.join(dir,'owner.json'),2048);if(m.schema===SCHEMA&&m.sourceHash===sourceHash)current+=await usage(dir);}}catch(_){}}
  return{totalBytes:await usage(root),currentBytes:current};}
 return{acquire,touch,makeRoom,clearOther:sourceHash=>makeRoom(0,1,sourceHash),measure,allocation:()=>lock('allocation',false)};
}
module.exports={createStorage,usage};
