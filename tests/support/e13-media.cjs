'use strict';
// Optional bounded real-media/filesystem smoke test; never in default checks.
const assert=require('assert'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const {scratch}=require('./annotation-scratch.cjs'),profile=require('../../plugin/preview-profile.cjs'),{createCache}=require('../../plugin/cache.cjs'),{createMedia,_test}=require('../../plugin/media.cjs'),{createMemoryPreferences}=require('../../plugin/preferences.cjs');
const root=path.resolve(__dirname,'../..'),MIB=1024**2,hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function tool(bin,args,input){const s=fs.lstatSync(bin);assert(s.isFile()&&!s.isSymbolicLink());const r=spawnSync(bin,args,{input,windowsHide:true,timeout:25000,maxBuffer:8*MIB});if(r.error||r.status!==0)throw Error('Existing FFmpeg tool failed: '+String(r.error||r.stderr).slice(-1000));return r.stdout;}
async function main(){
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'prototypes/preview-quality/config.local.json'))),temp=scratch('e13-media'),file=path.join(temp.root,'source.mp4'),checks=[];
 try{
  tool(cfg.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-n','-f','lavfi','-i','testsrc=size=3840x2160:rate=24','-frames:v','2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-fs',String(MIB),file]);
  const original=hash(fs.readFileSync(file)),selected={id:'e13-synthetic',filePath:file,ext:'mp4',name:'E13 synthetic two-frame sample'};
  const make=()=>createCache({pluginRoot:temp.root,diskBytes:4*MIB});let cache=make();
  const tools={ffmpeg:cfg.ffmpeg,ffprobe:cfg.ffprobe},prepare=()=>createMedia({cache,tools});
  const variants=[];
  for(const q of ['720p','1080p','1440p']){
   const info=await prepare().prepare(selected,{previewQuality:q});assert.equal(info.preview.quality,q);assert.equal(info.frames.length,2);
   assert.deepEqual([info.width,info.height],q==='1440p'?[2560,1440]:q==='1080p'?[1920,1080]:[1280,720]);
   const b=await cache.readAsset(info,info.frames[0].file),probe=JSON.parse(tool(cfg.ffprobe,['-v','error','-show_entries','stream=width,height','-of','json','pipe:0'],b));
   assert.deepEqual([probe.streams[0].width,probe.streams[0].height],[info.width,info.height]);
   checks.push({quality:q,size:[info.width,info.height],jpegBytes:b.length,frames:info.frames.length});variants.push(info.cacheDir);await cache.release(info);
  }
  assert.equal(new Set(variants).size,3);cache=make();
  const reused=await prepare().prepare(selected,{previewQuality:'1440p'});assert(reused.metrics.reused);await cache.release(reused);
  assert.equal((await cache.clearOther({sourceSha256:original})).cleared,0);assert.equal(cache.inventory().caches.length,3);
  const controller=new AbortController();controller.abort();await assert.rejects(()=>prepare().prepare(selected,{previewQuality:'1440p',signal:controller.signal}),e=>e.name==='AbortError'||e.code==='MEDIA_CANCELLED');
  const reopened=await prepare().prepare(selected,{previewQuality:'1440p'});assert(reopened.metrics.reused);await cache.release(reopened);
  let prefs=createMemoryPreferences({pluginRoot:temp.root,totalRamBytes:16*1024**3});prefs.save(1024,'1440p',true,{wheelFrames:1,showCacheStrip:true,rateStep:.1,drawingFadeSeconds:0});
  prefs=createMemoryPreferences({pluginRoot:temp.root,totalRamBytes:16*1024**3});assert.equal(prefs.quality(),'1440p');assert.equal(prefs.interaction().drawingFadeSeconds,0);assert.equal(prefs.snapshot().ramMiB,1024);
  assert.equal(hash(fs.readFileSync(file)),original);
  const portrait={width:2160,height:3840,color_space:'bt709',color_range:'tv'},p=profile.dimensions(portrait,'1440p'),args=_test.ffmpegArgs('unused',false,'h264',portrait,p),out=args.slice(args.indexOf('-map'));out.splice(out.indexOf('-fps_mode'),0,'-frames:v','1');
  const jpg=tool(cfg.ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc=size=2160x3840:rate=1',...out]),v=JSON.parse(tool(cfg.ffprobe,['-v','error','-show_entries','stream=width,height','-of','json','pipe:0'],jpg));
  assert.deepEqual([v.streams[0].width,v.streams[0].height],[1440,2560]);assert(jpg.length<MIB);
  console.log(JSON.stringify({checks,portrait:[1440,2560],node:process.versions.node,cacheVariants:3,reuse:true,cancelReopen:true,settingsReopen:true,sourceUnchanged:true,scope:'Real FFmpeg short synthetic media and Windows filesystem, not real Eagle UI or 2K performance'}));
 }finally{temp.clean();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
