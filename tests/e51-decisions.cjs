'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDecisions}=require('../plugin/load-decisions.cjs'),policy=require('../plugin/media-policy.cjs'),profile=require('../plugin/preview-profile.cjs');
test('choices close on either owner abort; stale and invalid replies cannot affect new load',async()=>{
 const d=createDecisions(),a=new AbortController(),b=new AbortController();const spec={kind:'large-proxy',choices:[{value:'yes'},{value:'no'}]};
 const p=d.ask(spec,a.signal,b.signal),id=d.snapshot().id;assert.equal(d.answer(id,'invalid'),false);b.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(d.snapshot(),null);
 const next=d.ask(spec,a.signal);assert.equal(d.answer(id,'yes'),false);assert.equal(d.answer(d.snapshot().id,'no'),true);assert.equal(await next,'no');
 const last=d.ask(spec,a.signal);a.abort();await assert.rejects(last,{name:'AbortError'});await assert.rejects(d.ask(spec,a.signal),{name:'AbortError'});
});
test('large proxy estimate is a range; triggers on long/large output but not tiny clips',()=>{
 assert.equal(policy.largeProxy({width:1280,height:720,duration:13,sourcePts:Array(325)},5*1024**3).confirm,false);
 assert.equal(policy.largeProxy({width:1920,height:1080,duration:601,sourcePts:Array(15025)},5*1024**3).confirm,true);
 const range=policy.largeProxy({width:3840,height:2160,duration:60,sourcePts:Array(1500)},5*1024**3);assert(range.confirm);assert(range.high>range.low);
});
test('expanded inputs validate declared identity; UHD does not upscale or exceed aspect-fit bounds',()=>{
 for(const ext of policy.EXTENSIONS)assert(policy.accepts('/source/video.'+ext,ext));assert(!policy.accepts('/source/a.mov','mp4'));assert(!policy.accepts('/source/a.jpg'));
 for(const [w,h,out] of [[3840,2160,[3840,2160]],[2160,3840,[2160,3840]],[1920,1080,[1920,1080]],[4096,2160,[3840,2025]]]){const p=profile.dimensions({width:w,height:h},'2160p');assert.deepEqual([p.width,p.height],out);profile.validate(p,{width:w,height:h});}
});
test('2160p preferences survive reopening; old settings still select the original quality',async t=>{
 const fs=require('fs'),path=require('path'),{createMemoryPreferences}=require('../plugin/preferences.cjs');const root=path.resolve(__dirname,'../verification-runs/e51');await fs.promises.mkdir(root,{recursive:true});const pluginRoot=await fs.promises.mkdtemp(path.join(root,'preferences-'));t.after(()=>fs.promises.rm(pluginRoot,{recursive:true}));
 const opts={pluginRoot,totalRamBytes:16*1024**3};const first=createMemoryPreferences(opts);first.save(1024,'2160p');assert.equal(createMemoryPreferences(opts).quality(),'2160p');first.save(1024,'1080p');assert.equal(createMemoryPreferences(opts).quality(),'1080p');
});
