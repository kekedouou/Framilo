'use strict';
// Explicit bounded native check. Only E52 synthetic input/temporary directories.
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const root=path.resolve(__dirname,'../verification-runs/e52/lifecycle');fs.mkdirSync(root,{recursive:true});
const binary=n=>spawnSync('where.exe',[n],{encoding:'utf8',windowsHide:true}).stdout.trim().split(/\r?\n/)[0];
const tools={ffmpeg:binary('ffmpeg'),ffprobe:binary('ffprobe')};
async function main(){const results=[];
 for(const cancel of [false,true]){const fixture=fs.mkdtempSync(path.join(root,'run-')),began=performance.now(),m=require('../plugin/temporary-media.cjs').createTemporaryMedia({pluginRoot:fixture});await m.ready;const readyMs=performance.now()-began;
  const backend=require('../plugin/native-backend.cjs').createNativeBackend({pluginRoot:path.resolve('plugin'),tools,cacheRoot:m.directory,temporaryMedia:m,limitBytes:100*1024**3,ramBytes:512*1024**2,decoderPreference:'prefer-software',proxyEncoder:'cpu',gpuDrawing:false});let info,reader;const row={cancel,readyMs};
  try{info=await backend.media.prepare({filePath:path.resolve('verification-runs/e52/formats/aac.mkv')},{previewQuality:'720p'});reader=await info.nativeRuntime.createReader();const first=await reader.request(0);row.first={status:first.status,ms:performance.now()-began};if(cancel){await info.nativeRuntime.cancelProxy();row.proxy=info.nativeRuntime.status().status;}else{const proxy=await info.nativeRuntime.startProxy().ready;row.proxy=proxy?'ready':info.nativeRuntime.status();if(proxy){const pr=await info.nativeRuntime.createReader({proxy:true});row.seeks=[];for(const n of [0,59,30,3,30]){const r=await pr.request(n);row.seeks.push({ordinal:n,status:r.status,ms:r.ms});}await info.nativeRuntime.closeReader(pr);}}
  }catch(e){row.error=e.message;}finally{const at=performance.now();await backend.close();row.cleanup=await m.close();row.closeMs=performance.now()-at;row.remaining=fs.existsSync(m.directory);}
  results.push(row);console.log(JSON.stringify(row));
 }
 fs.writeFileSync(path.join(root,'result-'+Date.now()+'.json'),JSON.stringify({at:new Date().toISOString(),results},null,2));if(results.some(r=>r.error||r.remaining||r.first.status!=='exact'||r.seeks?.some(s=>s.status!=='exact')))process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
