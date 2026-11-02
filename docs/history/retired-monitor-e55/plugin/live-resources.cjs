'use strict';
const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
const {usage,createStorage}=require('../../../../plugin/proxy-storage.cjs');
function createResources({root,context}){
 let value={ramTotal:null,ramVideo:null,diskTotal:null,diskVideo:null},busy=false,closed=false,child=null,lastDisk=0,controller=null,paused=false;
 async function sample(){if(busy||closed||paused)return;busy=true;controller=new AbortController();const signal=controller.signal,c=context(),source=c.source?.sha256;
  try{value.ramVideo=c.managedBytes??null;
   const pids=[...new Set([process.pid,...(c.resourcePids||[])])].filter(p=>Number.isSafeInteger(p)&&p>0);
   if(process.platform==='win32'){
    const data=await new Promise(resolve=>{child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=@(${pids.join(',')}); $rows=@(Get-Process -Id $p -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64); ConvertTo-Json -Compress -InputObject $rows`],{windowsHide:true,timeout:2000,maxBuffer:16384},(error,stdout)=>{child=null;try{resolve(error?null:JSON.parse(stdout));}catch(_){resolve(null);}});});
    if(signal.aborted)return;value.ramTotal=Array.isArray(data)&&data.length===pids.length?data.reduce((sum,r)=>sum+Number(r.WorkingSet64),0):null;
   }else value.ramTotal=pids.length===1?process.memoryUsage().rss:null;
   if(Date.now()-lastDisk>5000){const dir=path.join(root,'cache');let current=0,jpeg=0;
    for(const e of await fs.promises.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return[];throw e;}))if(e.isDirectory()&&/^media-[a-f0-9]{64}-/.test(e.name)){
      const bytes=await usage(path.join(dir,e.name),{signal});jpeg+=bytes;if(source&&e.name.startsWith('media-'+source+'-'))current+=bytes;
    }
    const native=await (c.diskUsage?c.diskUsage({signal}):createStorage(path.join(dir,'e44-whole')).measure(source,{signal}));current+=native?.currentBytes||0;
    const total=await usage(dir,{signal});if(signal.aborted||context().source?.sha256!==source)return;
    value.diskTotal=total;value.diskVideo=source?current:null;
    value.diskParts={proxy:native?.totalBytes??null,jpeg,pending:native?.pendingBytes??null,other:native?Math.max(0,total-jpeg-native.totalBytes):null};lastDisk=Date.now();
   }
  }catch(e){if(e.name!=='AbortError'){value.ramTotal=null;value.diskTotal=null;value.diskVideo=null;value.diskParts=null;lastDisk=0;}}
  finally{controller=null;if(context().source?.sha256!==source){value.diskVideo=null;lastDisk=0;}busy=false;}
 }
 return{sample,view:()=>({...value,ramScope:'插件界面进程 + 本插件持有的解码/生成进程工作集；不含共享 GPU/其它 Eagle 窗口',videoScope:'当前视频受管 RAM，包含缓存与解码/绘制预留',diskScope:'插件全部视频缓存；不含原视频、软件与测试文件'}),pause(){paused=true;controller?.abort();child?.kill();lastDisk=0;},resume(){paused=false;},close(){closed=true;controller?.abort();child?.kill();}};
}
module.exports={createResources};
