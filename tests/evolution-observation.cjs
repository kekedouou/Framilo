'use strict';
const assert=require('assert'),{project}=require('../prototypes/preview-quality/observation.cjs'),{redactNative,validateSample}=require('../prototypes/preview-quality/observe-worker.cjs');
const p=project({state:'ready',epoch:2,source:{name:'PRIVATE',filePath:'C:/secret.mp4'},comments:{items:['PRIVATE']},playback:{frameCount:60,drawCount:10,budget:{used:512,limit:1024},compressed:{residentBytes:100,residentFrames:2},activeImageTasks:1}},
  {rss:1000,heapUsed:400,external:200,arrayBuffers:100},1);
assert.strictEqual(p.managedBytes,512);assert.strictEqual(p.epoch,2);assert(!JSON.stringify(p).includes('PRIVATE'));assert(!JSON.stringify(p).includes('secret'));
validateSample(p);assert.throws(()=>validateSample({...p,source:'secret'}),/Unexpected/);assert.throws(()=>validateSample({...p,rss:Infinity}),/Invalid/);
const native=redactNative({schema:'mvp-process-sample-v1',atMs:1,sampleDurationMs:2,roots:[{role:'renderer',alive:true}],errors:[],processes:[{role:'renderer',pid:7,imagePath:'PRIVATE',rssBytes:100},{role:'observer',rssBytes:30}]});
assert.strictEqual(native.roles.renderer.rssBytes,100);assert.strictEqual(native.roles.observer.rssBytes,30);assert(!JSON.stringify(native).includes('PRIVATE'));assert(!('pid' in native));
assert.throws(()=>redactNative({schema:'mvp-process-sample-v1',processes:[{role:'alien',rssBytes:1}],errors:[]}),/Invalid/);
console.log('evolution observation: whitelisted numeric snapshots, private fields excluded, resource roles and malformed data checks passed');
