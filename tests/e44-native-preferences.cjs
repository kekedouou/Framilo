'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {createMemoryPreferences,OWNER}=require('../plugin/preferences.cjs');
const {scratch}=require('./support/annotation-scratch.cjs');
async function main(){
 const temp=scratch('e46-unified-gpu-prefs'),file=path.join(temp.root,'memory-settings.json'),next=path.join(temp.root,'memory-settings.next.json');
 const open=(io=fs)=>createMemoryPreferences({pluginRoot:temp.root,io,totalRamBytes:8*1024**3});let checks=0;
 const saveGpu=(p,on)=>p.save(1024,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,on);
 const effective=(p,on)=>{assert.equal(p.gpuAcceleration(),on);assert.equal(p.proxyEncoder(),on?'nvidia':'cpu');assert.equal(p.decoderPreference(),on?'prefer-hardware':'prefer-software');assert.equal(p.gpuDrawing(),on);assert.equal(p.automaticProxy(),true);assert.equal(p.forwardPredecode(),true);};
 try{
  const legacy=Buffer.from(JSON.stringify({owner:OWNER,ramMiB:1024,previewQuality:'720p'}));fs.writeFileSync(file,legacy);
  let p=open();effective(p,true);assert.equal(p.proxyDiskGiB(),5);assert(fs.readFileSync(file).equals(legacy));
  p.save(1024,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,20);assert.equal(open().proxyDiskGiB(),5);checks++;
  saveGpu(p,false);effective(p,false);effective(open(),false);assert.equal(JSON.parse(fs.readFileSync(file)).gpuAcceleration,false);checks++;
  p=open();p.save(2048,'1080p');effective(open(),false);assert.equal(open().quality(),'1080p');assert.equal(open().proxyDiskGiB(),5);checks++;
  const committed=fs.readFileSync(file),io=Object.create(fs);io.renameSync=()=>{throw Error('before commit');};
  const before=open(io);assert.throws(()=>saveGpu(before,true),/before commit/);effective(before,false);effective(open(),false);
  assert(fs.readFileSync(file).equals(committed));assert(!fs.existsSync(next));checks++;
  fs.writeFileSync(next,'interrupted new preference');effective(open(),false);assert.throws(()=>saveGpu(open(),true),/EEXIST/);
  assert.equal(fs.readFileSync(next,'utf8'),'interrupted new preference');assert(fs.readFileSync(file).equals(committed));fs.unlinkSync(next);checks++;
  const post=Object.create(fs);post.renameSync=(a,b)=>{fs.renameSync(a,b);throw Error('after commit');};
  assert.throws(()=>saveGpu(open(post),true),/after commit/);effective(open(),true);assert(!fs.existsSync(next));checks++;
  p=open();p.save(1024,undefined,false,undefined,undefined,'cpu','prefer-software',false,false);effective(open(),true);checks++;
  for(const item of [
   {decoderPreference:'prefer-software',gpuDrawing:true,proxyEncoder:'nvidia',expected:false},
   {decoderPreference:'prefer-hardware',gpuDrawing:false,proxyEncoder:'cpu',expected:false},
   {decoderPreference:'prefer-hardware',gpuDrawing:true,proxyEncoder:'cpu',expected:true},
   {gpuAcceleration:true,decoderPreference:'prefer-software',gpuDrawing:false,proxyEncoder:'cpu',expected:true},
   {gpuAcceleration:false,decoderPreference:'prefer-hardware',gpuDrawing:true,proxyEncoder:'nvidia',expected:false}
  ]){const {expected,...old}=item,raw=Buffer.from(JSON.stringify({owner:OWNER,ramMiB:1024,previewQuality:'720p',autoProxy:false,forwardPredecode:false,...old}));fs.writeFileSync(file,raw);p=open();effective(p,expected);assert(fs.readFileSync(file).equals(raw));p.save(2048);effective(open(),expected);assert.equal(JSON.parse(fs.readFileSync(file)).gpuAcceleration,expected);}checks++;
  const good=fs.readFileSync(file);p=open();for(const value of [null,1,'false'])assert.throws(()=>saveGpu(p,value));assert(fs.readFileSync(file).equals(good));
  for(const extra of [{gpuAcceleration:'yes'},{autoProxy:'yes'},{gpuDrawing:'no'},{forwardPredecode:1},{proxyEncoder:'automatic'},{decoderPreference:'cuda'}]){const raw=Buffer.from(JSON.stringify({...JSON.parse(good),...extra}));fs.writeFileSync(file,raw);assert.throws(()=>open());assert(fs.readFileSync(file).equals(raw));}checks++;
  console.log(`E46 unified GPU preferences: ${checks} real isolated read/write/restart/interruption/migration checks passed; automatic proxy and predecode stay on; no Eagle writes.`);
 }finally{temp.clean();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
