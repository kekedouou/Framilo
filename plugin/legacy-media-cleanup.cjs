'use strict';
// Retire only caches accepted by their original ownership/lease validators.
// An old, unprovable lease is retained; PID disappearance alone grants nothing.
const fs=require('fs'),path=require('path');
// This is a negative work check, never deletion authority. Receipts stay intact.
// Unknown entries and unfinished transactions must still reach the old validators.
async function pendingLegacy(pluginRoot){
 const root=path.join(pluginRoot,'cache');let entries;
 try{entries=await fs.promises.readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return{sequence:false,proxy:false};throw e;}
 const names=new Set(entries.filter(e=>e.isFile()).map(e=>e.name));
 const sequence=entries.some(e=>e.name==='owner.json')&&entries.some(e=>{
  if(e.isDirectory()&&['sessions-v1','e44-whole'].includes(e.name))return false;
  if(!e.isFile())return true;
  if(e.name==='owner.json')return false;
  const match=/^(cleanup|reap)-([a-f0-9]{24})(\.result)?\.json$/.exec(e.name);
  if(!match)return true;
  return !names.has(`${match[1]}-${match[2]}${match[3]?'':'.result'}.json`);
 });
 const proxyRoot=entries.find(e=>e.name==='e44-whole');let proxy=false;
 if(proxyRoot){
  if(!proxyRoot.isDirectory())proxy=true;
  else for(const e of await fs.promises.readdir(path.join(root,'e44-whole'),{withFileTypes:true})){
   if(!e.isDirectory()||!['whole-v1','leases-v1'].includes(e.name)){proxy=true;break;}
   if((await fs.promises.readdir(path.join(root,'e44-whole',e.name))).length){proxy=true;break;}
  }
 }
 return{sequence,proxy};
}
async function cleanLegacy({pluginRoot,tools,createClient=require('./task-client.cjs').createTaskClient,onPhase=()=>{}}){
 const cache=path.join(pluginRoot,'cache'),result={sequence:null,proxy:null};let client;
 try{
  onPhase('preflight');const pending=await pendingLegacy(pluginRoot);
  if(pending.sequence){onPhase('sequence');client=createClient({pluginRoot,discoverTools:async()=>tools});result.sequence=await client.cache.clearOther({sourceSha256:'0'.repeat(64),independentWholeProxy:true,clearAll:true});}
  if(pending.proxy){onPhase('proxy');result.proxy=await require('./proxy-storage.cjs').createStorage(path.join(cache,'e44-whole')).clearOther(null);}
  return result;
 }finally{if(client){onPhase('worker-close');await client.close();}onPhase('settled');}
}
module.exports={cleanLegacy,pendingLegacy};
