'use strict';
// Native backend-only measurement, never labelled Eagle/UI acceptance.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {performance}=require('perf_hooks');
const {FilmcraftClient}=require('./client.cjs');
const root=path.resolve(__dirname,'../../verification-runs/e44');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pct=(a,p)=>a.slice().sort((x,y)=>x-y)[Math.max(0,Math.ceil(a.length*p)-1)]??null;
async function main(){
  const profile=JSON.parse(fs.readFileSync(path.join(root,'profile.json'))),indexFile=path.join(root,'source-index.json');
  if(hash(profile.source)!==profile.sourceHash||hash(indexFile)!==profile.indexHash)throw Error('Source/index identity changed');
  const index=JSON.parse(fs.readFileSync(indexFile)),exe=path.join(root,'filmcraft-tools/target/release/examples/e44_bridge.exe');
  const windowed=process.argv.includes('--target-readback');
  const result={schema:'e44-filmcraft-native-v1',created:new Date().toISOString(),windowed,sourceHash:profile.sourceHash,upstream:'176e6a9c585fd29e4b18d691663fe88a936c5b37',exeHash:hash(exe),scope:'native backend and pipe only; no Eagle display; upstream 384MiB per-track cache vs earlier 256MiB target cache; no draft decoding',complete:false,runs:[]};
  const output=path.join(root,'filmcraft-test',`native-${Date.now()}.json`);
  let active,expired=false;
  const limit=setTimeout(()=>{expired=true;console.error('10 minute experiment bound');active?.close().catch(console.error);},600000);limit.unref();
  try{
    for(const software of (process.argv.includes('--both')?[false,true]:[false])){
      const run={software,rows:[],complete:false};result.runs.push(run);let client;const pending=[];
      try{
        if(expired)throw Error('Experiment time bound reached');
        client=await FilmcraftClient.create({exe,source:profile.source,index,software,windowed});
        active=client;
        const input=(s,scenario)=>{const t=performance.now(),p=client.seek(s).then(r=>({...r,scenario,seconds:s}));pending.push(p);return p;};
        for(const s of [58.4,22.7,44.2,1.5,72.4,12.3]){const r=await input(s,'remote');console.log(software?'software':'hardware',s,r.status,r.ms.toFixed(1));if(r.status!=='exact')throw Error('remote: '+r.status+' '+(r.error||''));}
        for(let n=0;n<12;n++){await input(12.3+n/60,'step');await wait(20);}
        for(let n=0;n<60;n++){input(5+n*.92,'fast');await wait(16);}
        await input(59.28,'release');
        for(let n=0;n<12;n++){await input(59.28-n/60,'reverse');await wait(20);}
        run.rows=await Promise.all(pending);run.stats=client.snapshot();
        const exact=run.rows.filter(x=>x.status==='exact');
        run.summary={requests:run.rows.length,exact:exact.length,superseded:run.rows.filter(x=>x.status==='superseded').length,errors:run.rows.filter(x=>!['exact','superseded'].includes(x.status)).length,remoteP95:pct(exact.filter(x=>x.scenario==='remote').map(x=>x.ms),.95),stepP95:pct(exact.filter(x=>x.scenario==='step').map(x=>x.ms),.95),reverseP95:pct(exact.filter(x=>x.scenario==='reverse').map(x=>x.ms),.95),releaseMs:run.rows.find(x=>x.scenario==='release')?.ms};
        run.complete=run.summary.errors===0;console.log(JSON.stringify(run.summary));
      }catch(e){run.error=String(e.stack||e);console.error(run.error);}
      finally{if(client){run.stats=client.snapshot();run.close=await client.close();}run.rows=await Promise.all(pending);fs.writeFileSync(output,JSON.stringify(result,null,2));}
    }
    result.complete=result.runs.every(x=>x.complete);fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(output);
  }finally{clearTimeout(limit);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
