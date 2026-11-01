'use strict';
// Retire only caches accepted by their original ownership/lease validators.
// An old, unprovable lease is retained; PID disappearance alone grants nothing.
const fs=require('fs'),path=require('path');
async function cleanLegacy({pluginRoot,tools,createClient=require('./task-client.cjs').createTaskClient}){
 const cache=path.join(pluginRoot,'cache'),result={sequence:null,proxy:null};let client;
 try{
  if(fs.existsSync(path.join(cache,'owner.json'))){client=createClient({pluginRoot,discoverTools:async()=>tools});result.sequence=await client.cache.clearOther({sourceSha256:'0'.repeat(64),independentWholeProxy:true,clearAll:true});}
  const root=path.join(cache,'e44-whole');if(fs.existsSync(root))result.proxy=await require('./proxy-storage.cjs').createStorage(root).clearOther(null);
  return result;
 }finally{await client?.close();}
}
module.exports={cleanLegacy};
