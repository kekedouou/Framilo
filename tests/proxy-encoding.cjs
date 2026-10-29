'use strict';
const assert=require('assert'),recipe=require('../plugin/proxy-encoding.cjs'),pack=require('../plugin/frame-pack.cjs');
const media=require('../plugin/media.cjs')._test,profile=require('../plugin/preview-profile.cjs');
const video={codec_name:'av1',width:1920,height:1080,pix_fmt:'yuv420p',color_space:'bt709',color_range:'tv',color_transfer:'bt709',color_primaries:'bt709'};
function make(encoder,source=video){const preview=profile.dimensions(source),info={videoEncoding:recipe.encoding(encoder),preview,width:preview.width,height:preview.height};const args=media.ffmpegArgs('source.mp4',false,source.codec_name,source,preview);return{args,info,result:recipe.configure(args,info,source)};}
assert.deepEqual(recipe.encoding(),{format:'annexb-idr-v1',codec:'avc1.42c033'});
const cpu=make('cpu'),gpu=make('nvidia');assert(cpu.args.includes('libx264'));assert(cpu.args.includes('20'));assert(!cpu.args.includes('-hwaccel'));
assert(gpu.args.includes('h264_nvenc'));assert(gpu.args.includes('-hwaccel'));assert(gpu.args.includes('cuda'));assert(gpu.args.includes('1'));assert.equal(gpu.result.sourceDecoder,'cuda');
for(const patch of [{pix_fmt:'yuv420p10le'},{color_range:'pc'},{color_space:'bt2020nc'},{side_data_list:[{rotation:90}]},{sample_aspect_ratio:'2:1'}]){
 const tested=make('nvidia',{...video,...patch});assert.equal(tested.result.sourceDecoder,'cpu');assert(tested.args.includes('h264_nvenc'));assert(!tested.args.includes('-hwaccel'),'unsupported CUDA color/geometry retains established CPU conversion');
}
for(const videoEncoding of [cpu.info.videoEncoding,gpu.info.videoEncoding])assert.strictEqual(pack.validateEncoding({videoEncoding,frames:[{file:'0.avc'}]}),videoEncoding);
assert.throws(()=>pack.validateEncoding({videoEncoding:{...gpu.info.videoEncoding,recipe:'unknown'},frames:[{file:'0.avc'}]}));
const key=require('../plugin/long-media.cjs')._test.segmentKey,info={...cpu.info,source:{sha256:'a'.repeat(64)},frames:[{ptsTicks:'0',timeBase:[1,30]}],audio:null};
const group={first:0,last:0,start:0,end:1/30};assert.notEqual(key(info,group,'v1'),key({...info,videoEncoding:gpu.info.videoEncoding},group,'v1'),'encoder recipes cannot reuse each other');
assert.throws(()=>recipe.encoder('hevc'));assert.throws(()=>recipe.decoder('gpu'));
console.log('E41 codec recipes: CPU compatibility, GPU cache isolation, explicit decoder preference, CUDA color/geometry boundaries and unknown recipe rejection passed.');
