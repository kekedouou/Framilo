'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {model,scenarios}=require('../scripts/seek-reuse-compare.cjs');
const code=fs.readFileSync(path.join(__dirname,'../plugin/native-player.js'),'utf8');
for(const name of ['slow-forward-60','slow-forward-100','slow-backward-60','back-and-forth-100','cost-spike','duplicate-100','promote-fill-60','release-different-100','deadline-180'])test(name+' completes accurate release within the unchanged budget',async()=>{
 const result=await model(code,scenarios().find(s=>s.name===name));
 if(name.startsWith('slow-'))assert(result.usefulDraws>=7,'continuous input must not starve useful slow reads');
 if(name==='back-and-forth-100')assert(result.usefulDraws>=5);
 if(name==='promote-fill-60'){assert.equal(result.cancels,0);assert.equal(result.releaseMs,25);}
 if(name==='release-different-100')assert.equal(result.releaseMs,100);
 if(name==='duplicate-100'){assert.equal(result.requests,1);assert.equal(result.releaseMs,0);}
 if(name==='deadline-180'){assert.equal(result.usefulDraws,0);assert(result.cancels>0,'a stalled active request cannot hold the latest target forever');}
});
