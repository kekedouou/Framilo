'use strict';
// E50 bounded read-only comparison. Writes one evidence JSON; never cleans cache.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto'),{execFileSync}=require('child_process'),{performance}=require('perf_hooks');
const root=path.resolve(__dirname,'..'),baseline='503e0a6';
const original=execFileSync('git',['show',baseline+':plugin/proxy-storage.cjs'],{cwd:root,encoding:'utf8',windowsHide:true});
const moduleBefore={exports:{}};vm.runInNewContext(original,{require,module:moduleBefore,exports:moduleBefore.exports,process,Buffer,setTimeout,setImmediate});
const current=require('../plugin/proxy-storage.cjs');
async function measure(fn){let last=performance.now(),gap=0,ticks=0;const timer=setInterval(()=>{const at=performance.now();gap=Math.max(gap,at-last);last=at;ticks++;},16),start=performance.now();
 try{const bytes=await fn(path.join(root,'plugin/cache'));const scanMs=performance.now()-start;await new Promise(r=>setTimeout(r,20));return{bytes,scanMs,maxTimerGapMs:gap,ticks};}finally{clearInterval(timer);}}
async function main(){const rounds=[];for(let n=0;n<3;n++){const before=await measure(moduleBefore.exports.usage),after=await measure(current.usage);rounds.push({before,after});}
 const result={at:new Date().toISOString(),node:process.version,baseline,currentStorageSHA:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'plugin/proxy-storage.cjs'))).digest('hex'),boundary:'Same plugin/cache, read-only; separate Node process, not Eagle. 16ms timer, three serial pairs; no media decode or user input.',rounds};
 const dir=path.join(root,'verification-runs/e50');await fs.promises.mkdir(dir,{recursive:true});const file=path.join(dir,'scan-'+Date.now()+'.json');await fs.promises.writeFile(file,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({file,...result}));}
main().catch(e=>{console.error(e);process.exitCode=1;});
