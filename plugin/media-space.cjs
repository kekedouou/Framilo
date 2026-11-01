'use strict';
const fs=require('fs'),path=require('path');
const CONSENT_BYTES=1000000000,PHYSICAL_RESERVE=2*1024**3,MAX_BYTES=100*1024**3;
async function freeBytes(dir){
 if(fs.promises.statfs){const s=await fs.promises.statfs(dir);return Number(s.bavail)*Number(s.bsize);}
 // Older Eagle Node hosts lack statfs. Query one volume asynchronously, never
 // enumerate cached files or block the renderer with a synchronous shell.
 return new Promise((resolve,reject)=>{const c=require('child_process').spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $d=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($env:MOTIONOTE_VOLUME)); [Console]::Write($d.AvailableFreeSpace)"],{windowsHide:true,env:{...process.env,MOTIONOTE_VOLUME:path.resolve(dir)},stdio:['ignore','pipe','pipe']});let data='',failure;const t=setTimeout(()=>{failure=Error('无法确认硬盘可用空间');c.kill();},5000);c.stdout.on('data',b=>{data+=b;if(data.length>256){failure=Error('硬盘空间回执无效');c.kill();}});c.stderr.resume();c.on('error',e=>{failure=e;});c.on('close',code=>{clearTimeout(t);const n=Number(data);if(failure||code||!Number.isSafeInteger(n)||n<0)reject(failure||Error('无法确认硬盘可用空间'));else resolve(n);});});
}
function allowance({used,free,consented=false,threshold=CONSENT_BYTES,reserve=PHYSICAL_RESERVE}){if(![used,free].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error('媒体空间统计无效');return Math.max(0,Math.min(MAX_BYTES-used,free-reserve,consented?Infinity:threshold-used));}
function decision({low,high,used,free,actual=false}){const gb=n=>(n/1e9).toFixed(2);return{kind:'large-proxy',title:'临时文件将超过 1 GB',body:(actual?'实际生成量超过了预计。未完成文件已回收；继续后将重新生成。':'预计临时占用 '+gb(used+low)+'–'+gb(used+high)+' GB。')+' 硬盘可用 '+gb(free)+' GB。关闭播放器后自动清理；也可以继续播放原片。',choices:[{value:'generate',label:'继续生成'},{value:'source',label:'继续播放原片'}]};}
async function reserve(directory,{used,consented,readFree=freeBytes}={}){
 const parent=path.dirname(directory),lock=path.join(parent,'capacity.lock'),file=path.join(directory,'space.json'),token=require('crypto').randomBytes(16).toString('hex');
 const {readOwner}=require('./temporary-media.cjs')._test,identity=require('./process-identity.cjs'),owner=await readOwner(directory),until=Date.now()+5000;
 for(;;){try{await fs.promises.writeFile(lock,JSON.stringify({id:owner.id,token}),{flag:'wx'});break;}catch(e){if(e.code!=='EEXIST')throw e;
   try{const s=await fs.promises.lstat(lock);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>1024)throw Error('空间预留锁身份不符');
   const before=await fs.promises.readFile(lock,'utf8'),old=JSON.parse(before);if(!/^[a-f0-9]{32}$/.test(old.id||''))throw Error('空间预留归属未知');
   let record;try{record=await readOwner(path.join(parent,old.id));}catch(_){}
   if(record&&record.processIdentity?.pid!==process.pid&&identity._test.proveGone(record,await identity.snapshotAsync()).safe&&await fs.promises.readFile(lock,'utf8')===before){const claimed=lock+'.reap-'+token;await fs.promises.rename(lock,claimed);if(await fs.promises.readFile(claimed,'utf8')!==before){await fs.promises.link(claimed,lock).catch(()=>{});throw Error('空间预留锁变化');}await fs.promises.unlink(claimed);continue;}
   }catch(failure){if(failure.code==='ENOENT')continue;throw failure;}
   if(Date.now()>=until)throw Error('其他窗口正在预留临时空间，继续播放原片。');await new Promise(r=>setTimeout(r,50));
  }}
 try{let reserved=0;for(const name of await fs.promises.readdir(parent)){if(!/^[a-f0-9]{32}$/.test(name)||name===owner.id)continue;const other=path.join(parent,name,'space.json');try{const s=await fs.promises.lstat(other);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>2048)throw Error('空间预留身份不符');const v=JSON.parse(await fs.promises.readFile(other,'utf8'));if(v.id!==name||!Number.isSafeInteger(v.bytes)||v.bytes<0||v.bytes>MAX_BYTES)throw Error('空间预留记录无效');reserved+=v.bytes;}catch(e){if(e.code!=='ENOENT')throw e;}}
  const bytes=allowance({used,free:Math.max(0,await readFree(directory)-reserved),consented});
  if(fs.existsSync(file))throw Error('本窗口已有生成任务预留空间');
  await fs.promises.writeFile(file,JSON.stringify({id:owner.id,token,bytes}),{flag:'wx'});
  return{bytes,async release(){try{const v=JSON.parse(await fs.promises.readFile(file,'utf8'));if(v.token!==token)throw Error('空间预留已变化');await fs.promises.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}};
 }finally{const v=JSON.parse(await fs.promises.readFile(lock,'utf8'));if(v.token!==token)throw Error('空间预留锁已变化');await fs.promises.unlink(lock);}
}
module.exports={CONSENT_BYTES,PHYSICAL_RESERVE,MAX_BYTES,freeBytes,allowance,decision,reserve};
