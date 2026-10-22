'use strict';
// Models only: no Eagle, real media generation, or disk writes.
const assert = require('assert'), path = require('path').win32;
const profile = require('../plugin/preview-profile.cjs');
const { harness, prepared, SOURCE_SHA } = require('./t1-cache.cjs');
const { _test: media } = require('../plugin/media.cjs');
const source = { sha256: SOURCE_SHA, codec: 'h264', width: 1920, height: 1080, hasAudioStream: false,
  itemId: 'preview', filePath: 'G:\测试 中文.mp4' };
async function build(h, q, sha = SOURCE_SHA, bytes = 2048) {
  const tx = h.cache.begin({ sourceSha256: sha, previewQuality: q });
  const a = await tx.writeAsset('0.jpg', Buffer.alloc(bytes, q === '720p' ? 7 : 8));
  const preview = profile.dimensions(source, q);
  const info = await tx.finish({ source: { ...source, sha256: sha }, preview, width: preview.width, height: preview.height,
    duration: 1, frames: [{ ...a, id: 0, ptsTicks: '0', timeBase: [1, 30], time: 0, end: 1 }], audio: null }, { ...source, sha256: sha });
  tx.close(); return info;
}
async function main() {
  for (const [w,h,q,expected,original] of [[3840,2160,'1080p',[1920,1080],false], [1080,1920,'720p',[720,1280],false],
    [1080,1920,'1080p',[1080,1920],true], [640,360,'1080p',[640,360],true], [1920,800,'720p',[1280,533],false],
    [1440,1440,'1080p',[1080,1080],false], [1919,1079,'1080p',[1919,1079],true]]) {
    const p = profile.dimensions({ width:w,height:h },q); assert.deepEqual([p.width,p.height],expected); assert.equal(p.originalResolution,original);
  }
  for(const [w,h,q,expected,original] of [[3840,2160,'1440p',[2560,1440],false],[2160,3840,'1440p',[1440,2560],false],[1920,1080,'1440p',[1920,1080],true],[2560,1440,'1440p',[2560,1440],true],[1440,2560,'1440p',[1440,2560],true]]){const p=profile.dimensions({width:w,height:h},q);assert.deepEqual([p.width,p.height],expected);assert.equal(p.originalResolution,original);profile.validate(p,{width:w,height:h});}
  const rotated=profile.dimensions({width:1920,height:1080,side_data_list:[{rotation:-90}]},'720p');
  assert.deepEqual([rotated.width,rotated.height],[720,1280]);
  const sar=profile.dimensions({width:720,height:576,sample_aspect_ratio:'16:15'},'720p'); assert.equal(sar.width,768); assert(!sar.originalResolution);
  assert.throws(()=>profile.dimensions(source,'2K'));
  const args=media.ffmpegArgs(source.filePath,false,'h264',source,profile.dimensions(source,'1080p'));
  assert(args[args.indexOf('-vf')+1].includes('scale=1920:1080:')); assert.equal(args[args.indexOf('-q:v')+1],'3');
  for(const [codec,q,threads] of [['h264','720p','2'],['h264','1080p','4'],['vp9','720p','1'],['vp9','1080p','2'],['hevc','1080p','4']]){
    const a=media.ffmpegArgs(source.filePath,true,codec,source,profile.dimensions(source,q));assert.equal(a[a.indexOf('-filter_threads')+1],threads);
    assert(a.includes('pcm_f32le'));assert.equal(a[a.indexOf('-q:v')+1],'3');assert(a.includes('passthrough'));
  }
  const h=harness(), old=await prepared(h); h.cache.release(old);
  const a=await build(h,'720p'); h.cache.release(a); const b=await build(h,'1080p'); h.cache.release(b);
  assert.notEqual(a.cacheDir,b.cacheDir); assert.notEqual(a.cacheDir,old.cacheDir);
  assert.equal(h.cache.inventory().caches.length,3);
  const reboot=h.reboot();
  for(const [q,dir] of [['720p',a.cacheDir],['1080p',b.cacheDir],[undefined,old.cacheDir]]) {
    const tx=reboot.begin({sourceSha256:SOURCE_SHA,previewQuality:q});const info=await tx.readComplete(); assert(info);
    const lease=await tx.finish(info,source); assert.equal(lease.cacheDir,dir); tx.close(); reboot.release(lease);
  }
  const other=await build({...h,cache:reboot},'1080p','b'.repeat(64)); reboot.release(other);
  const result=await reboot.clearOther({sourceSha256:SOURCE_SHA}); assert.equal(result.cleared,1);
  assert.equal(h.reboot().inventory().caches.length,3); // Both variants and legacy current source protected.
  const cancel=h.reboot().begin({sourceSha256:SOURCE_SHA,previewQuality:'1080p'});
  await cancel.writeAsset('partial.jpg',Buffer.from('partial')); await cancel.abort(); cancel.close();
  const after=h.reboot(); assert.equal(after.inventory().caches.length,3); assert(!h.nodes.has(path.join(h.root,'writer.lock')));
  const mismatch=after.begin({sourceSha256:'c'.repeat(64),previewQuality:'1080p'});
  const asset=await mismatch.writeAsset('0.jpg',Buffer.from('wrong variant'));
  await assert.rejects(()=>mismatch.finish({source:{...source,sha256:'c'.repeat(64)},width:1280,height:720,duration:1,
    frames:[{...asset,id:0,ptsTicks:'0',timeBase:[1,30],time:0,end:1}],audio:null},{...source,sha256:'c'.repeat(64)}),/画质/);
  await mismatch.abort(); mismatch.close(); assert.equal(h.descriptors.size,0);
  const limited=harness({diskBytes:48000}), pinned=await build(limited,'720p',SOURCE_SHA,6000);
  for(let i=1;i<=6;i++){const info=await build(limited,i%2?'1080p':'720p',String(i).repeat(64),6000);limited.cache.release(info);}
  const inventory=limited.cache.inventory();assert(inventory.usedBytes<=48000);assert(inventory.caches.length<7);
  assert(inventory.caches.some(c=>c.directory===pinned.cacheDir));limited.cache.release(pinned);
  const idle=harness(), idleA=await build(idle,'720p');idle.cache.release(idleA);const active=await build(idle,'1080p');
  const aged=idle.reboot({now:()=>Date.now()+86400001}), idleTx=aged.begin({sourceSha256:'d'.repeat(64),previewQuality:'720p'});idleTx.close();
  assert.equal(aged.inventory().caches.length,1);assert.equal(aged.inventory().caches[0].directory,active.cacheDir);idle.cache.release(active);
  const triple=harness(),variants=[];for(const q of profile.QUALITIES){const info=await build(triple,q);variants.push([q,info.cacheDir]);triple.cache.release(info);}assert.equal(new Set(variants.map(n=>n[1])).size,3);const reboot3=triple.reboot();for(const[q,dir]of variants){const tx=reboot3.begin({sourceSha256:SOURCE_SHA,previewQuality:q});const manifest=await tx.readComplete();const info=await tx.finish(manifest,source);assert.equal(info.cacheDir,dir);tx.close();reboot3.release(info);}assert.equal((await reboot3.clearOther({sourceSha256:SOURCE_SHA})).cleared,0);
  console.log('E03 preview profiles/cache: dimension, rotation/SAR, no-upscale, legacy and double-variant reuse, shared clear, cancel/reopen, identity mismatch passed; models only.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
