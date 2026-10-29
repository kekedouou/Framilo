'use strict';
const fs=require('fs'),path=require('path'),{execFile}=require('child_process');
const {usage}=require('./proxy-storage.cjs');
function createResources({root,context}){
 let value={ramTotal:null,ramVideo:null,diskTotal:null,diskVideo:null},busy=false,closed=false,child=null,lastDisk=0;
 async function sample(){if(busy||closed)return;busy=true;const c=context(),source=c.source?.sha256;
  try{value.ramVideo=c.managedBytes??null;
   const pids=[...new Set([process.pid,...(c.resourcePids||[])])].filter(p=>Number.isSafeInteger(p)&&p>0);
   if(process.platform==='win32'){
    const data=await new Promise(resolve=>{child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=@(${pids.join(',')}); $rows=@(Get-Process -Id $p -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64); ConvertTo-Json -Compress -InputObject $rows`],{windowsHide:true,timeout:2000,maxBuffer:16384},(error,stdout)=>{child=null;try{resolve(error?null:JSON.parse(stdout));}catch(_){resolve(null);}});});
    value.ramTotal=Array.isArray(data)&&data.length===pids.length?data.reduce((sum,r)=>sum+Number(r.WorkingSet64),0):null;
   }else value.ramTotal=pids.length===1?process.memoryUsage().rss:null;
   if(Date.now()-lastDisk>5000){lastDisk=Date.now();const dir=path.join(root,'cache');let current=0;
    for(const e of await fs.promises.readdir(dir,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return[];throw e;}))if(source&&e.isDirectory()&&e.name.startsWith('media-'+source+'-'))current+=await usage(path.join(dir,e.name));
    const native=await c.diskUsage?.();current+=native?.currentBytes||0;
    value.diskTotal=await usage(dir);value.diskVideo=source?current:null;
   }
  }catch(_){value.ramTotal=null;}
  finally{if(context().source?.sha256!==source){value.diskVideo=null;lastDisk=0;}busy=false;}
 }
 return{sample,view:()=>({...value,ramScope:'插件界面进程 + 本插件持有的解码/生成进程工作集；不含共享 GPU/其它 Eagle 窗口',videoScope:'当前视频受管 RAM，包含缓存与解码/绘制预留',diskScope:'插件全部视频缓存；不含原视频、软件与测试文件'}),close(){closed=true;child?.kill();}};
}
module.exports={createResources};
