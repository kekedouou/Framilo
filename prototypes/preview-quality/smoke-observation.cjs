'use strict';
const assert=require('assert'),{start}=require('./observation.cjs'),{store}=require('./workspace.cjs');
async function main(){const scope=process.argv[2]==='quality'?'quality':'natural',states=[],observer=start({scope,snapshot:()=>({state:'paused',epoch:1,playback:{frameCount:30,drawCount:1,
  budget:{used:1024,limit:1024**3},compressed:{residentBytes:512,residentFrames:1},activeImageTasks:0}}),onStatus:x=>states.push(x)});
  await new Promise(r=>setTimeout(r,4200));const first=observer.stop(),second=observer.stop();assert.strictEqual(first,second);
  const result=await first;assert.strictEqual(result.issue,null);assert(result.ticks>=3);assert.strictEqual(observer.active,false);
  const saved=store().save('observer-smoke',{runtime:process.version,scope,result,states,realEagleWindow:false});console.log(JSON.stringify({saved,result}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={main};
