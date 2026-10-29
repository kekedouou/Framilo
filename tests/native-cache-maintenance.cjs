'use strict';
// Every deletion here targets the shared VM-only filesystem; the registered
// plugin/cache and Eagle/source media are never opened or modified.
const assert=require('assert'),path=require('path').win32;
const {harness,prepared,SOURCE_SHA}=require('./t1-cache.cjs');
let count=0;async function test(name,body){await body();count++;console.log('ok native cache maintenance: '+name);}
function whole(h){
 const root=path.join(h.root,'e44-whole'),version=path.join(root,'whole-v1'),complete=path.join(version,'c'.repeat(64)),pending=path.join(version,'.pending-'+'d'.repeat(32));
 for(const dir of [root,version,complete,pending])h.make(dir,'dir');
 const files=[path.join(complete,'video.mp4'),path.join(complete,'complete.json'),path.join(pending,'owner.json'),path.join(pending,'video.mp4'),path.join(version,'c'.repeat(64)+'.lock')];
 for(const file of files)h.make(file,'file','protected whole fixture '+file);return{root,files,bytes:files.reduce((n,f)=>n+h.nodes.get(f).data.length,0)};
}
async function main(){
 await test('legacy cleanup clears only other unleased media and never whole complete/pending/locks',async()=>{
  const h=harness({protectWholeProxy:true}),info=await prepared(h);h.cache.release(info);const protectedAssets=whole(h),before=protectedAssets.files.map(f=>Buffer.from(h.nodes.get(f).data));
  const result=h.cache.clearOther({sourceSha256:'b'.repeat(64)});assert.equal(result.cleared,1);assert(result.freedBytes>0);assert(!h.nodes.has(info.cacheDir));
  protectedAssets.files.forEach((f,n)=>assert(h.nodes.get(f).data.equals(before[n])));assert(!h.deleted.some(f=>f.startsWith(protectedAssets.root+'\\')));
  const inventory=h.cache.inventory();assert(inventory.usedBytes>=protectedAssets.bytes);assert.equal(inventory.caches.length,0);assert.equal(inventory.deletionAuthorized,false);
 });
 await test('current source and occupied other material remain protected',async()=>{
  const h=harness({protectWholeProxy:true}),info=await prepared(h);whole(h);
  const occupied=h.cache.clearOther({sourceSha256:'b'.repeat(64)});assert.equal(occupied.cleared,0);assert(h.nodes.has(info.cacheDir));
  h.cache.release(info);const current=h.cache.clearOther({sourceSha256:SOURCE_SHA});assert.equal(current.cleared,0);assert(h.nodes.has(info.cacheDir));
 });
 await test('whole bytes remain inside the unchanged total5GiB quota',async()=>{
  const h=harness({protectWholeProxy:true}),info=await prepared(h);h.cache.release(info);whole(h);const used=h.cache.inventory().usedBytes;
  const tighter=h.reboot({diskBytes:used-1});assert.throws(()=>tighter.clearOther({sourceSha256:'b'.repeat(64)}),/预算|容量/);assert(h.nodes.has(info.cacheDir));
  assert.equal(h.api.LIMITS.cacheBytes,5*1024**3);assert(!h.nodes.has(path.join(h.root,'writer.lock')));
 });
 await test('links in whole namespace cause a conservative zero-delete failure',async()=>{
  const h=harness({protectWholeProxy:true}),info=await prepared(h);h.cache.release(info);const w=whole(h);h.nodes.get(w.files[0]).kind='link';const deleted=h.deleted.length;
  assert.throws(()=>h.cache.clearOther({sourceSha256:'b'.repeat(64)}),/普通文件|链接/);assert(h.nodes.has(info.cacheDir));assert(!h.deleted.slice(deleted).some(f=>f.startsWith(info.cacheDir+'\\')));
 });
 await test('unknown roots and unknown legacy writer locks are never accepted by the native option',async()=>{
  for(const kind of ['unknown','lock']){
   const h=harness({protectWholeProxy:true}),info=await prepared(h);h.cache.release(info);whole(h);
   if(kind==='unknown')h.make(path.join(h.root,'foreign-root'),'dir');else h.make(path.join(h.root,'writer.lock'),'file','unknown writer');
   assert.throws(()=>h.cache.clearOther({sourceSha256:'b'.repeat(64)}));assert(h.nodes.has(info.cacheDir));
  }
 });
 await test('independent whole quota is not scanned or charged to legacy cleanup',async()=>{
  const h=harness({protectWholeProxy:true,independentWholeProxy:true}),info=await prepared(h);h.cache.release(info);const w=whole(h);h.nodes.get(w.files[0]).kind='link';const result=h.cache.clearOther({sourceSha256:'b'.repeat(64)});assert.equal(result.cleared,1);assert(!h.deleted.some(f=>f.startsWith(w.root+'\\')));assert(h.nodes.has(w.files[0]));
 });
 await test('protected whole accounting is explicitly enabled and rejects invalid option types',async()=>{
  const h=harness(),info=await prepared(h);h.cache.release(info);whole(h);assert.throws(()=>h.cache.clearOther({sourceSha256:'b'.repeat(64)}),/未知/);
  assert.throws(()=>h.api.createCache({pluginRoot:'D:\\fixtures\\plugin',protectWholeProxy:'yes'}),/保护选项/);
 });
 console.log('Native cache maintenance: '+count+' in-memory cleanup/accounting guards passed; no real cache/media deletion.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
