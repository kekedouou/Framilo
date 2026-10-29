'use strict';
// Real native correctness and teardown checks, separate from performance timing.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {FilmcraftClient}=require('./client.cjs');
const root=path.resolve(__dirname,'../../verification-runs/e44'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const profile=JSON.parse(fs.readFileSync(path.join(root,'profile.json'))),indexBytes=fs.readFileSync(path.join(root,'source-index.json')),index=JSON.parse(indexBytes);
 if(sha(fs.readFileSync(profile.source))!==profile.sourceHash||sha(indexBytes)!==profile.indexHash)throw Error('Source identity changed');
 const exe=path.join(root,'filmcraft-tools/target/release/examples/e44_bridge.exe');
 const result={schema:'e44-filmcraft-correctness-v1',created:new Date().toISOString(),sourceHash:profile.sourceHash,exeHash:sha(fs.readFileSync(exe)),complete:false,pixels:[],lifecycle:[]};
 const output=path.join(root,'filmcraft-test',`verify-${Date.now()}.json`);let active,expired=false;
 const timer=setTimeout(()=>{expired=true;active?.close().catch(()=>{});},600000);
 try{
  const points=[0,.017,.033,12.3,44.2,58.4,index.sorted.at(-1).pts/1e6],baseline=[];
  for(const windowed of [false,true]){
   let lastHash;
   active=await FilmcraftClient.create({exe,source:profile.source,index,windowed,draw:p=>{lastHash=sha(p);}});
   for(let i=0;i<points.length;i++){
    if(expired)throw Error('10 minute bound');
    const r=await active.seek(points[i]);if(r.status!=='exact')throw Error(`Frame ${points[i]}: ${r.status}`);
    if(!windowed)baseline[i]=lastHash;
    result.pixels.push({windowed,seconds:points[i],actualPts:r.actualPts,rgbaSha256:lastHash,match:!windowed||baseline[i]===lastHash});
    if(windowed&&baseline[i]!==lastHash)throw Error('GPU output pixels differ from upstream');
   }
   result.lifecycle.push({kind:'after-frames',windowed,close:await active.close()});active=null;
  }
  // Empty, in-flight cold seek and superseded seek teardown, each in a fresh native process.
  for(let i=0;i<50;i++){
   if(expired)throw Error('10 minute bound');
   active=await FilmcraftClient.create({exe,source:profile.source,index,windowed:true});
   const requests=[];
   if(i%3!==0){requests.push(active.seek(58.4));await wait(30);}
   if(i%3===2){requests.push(active.seek(22.7));await wait(15);}
   const close=await active.close();const rows=await Promise.all(requests);active=null;
   result.lifecycle.push({kind:['ready','in-flight','superseded'][i%3],close,requests:rows.map(x=>x.status)});
   if(!close.ack||close.ack.cacheBytes!==0||close.ack.liveDecoders!==0||close.exit?.code!==0||close.ms>2000)throw Error('Native teardown failed');
  }
  result.complete=true;
 }catch(e){result.error=String(e.stack||e);}
 finally{if(active)result.finalClose=await active.close();clearTimeout(timer);fs.writeFileSync(output,JSON.stringify(result,null,2));}
 console.log(JSON.stringify({output,complete:result.complete,error:result.error,pixels:result.pixels.length,closes:result.lifecycle.length}));
 if(!result.complete)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
