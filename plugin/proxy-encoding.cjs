'use strict';
// Codec recipes are part of cache identity. CPU v1 remains byte-policy compatible.
const ENCODERS = Object.freeze(['cpu', 'nvidia']);
const DECODERS = Object.freeze(['no-preference', 'prefer-hardware', 'prefer-software']);
function encoder(value='cpu') { if(!ENCODERS.includes(value))throw Error('代理生成方式无效。');return value; }
function decoder(value='prefer-hardware') { if(!DECODERS.includes(value))throw Error('播放解码偏好无效。');return value; }
function encoding(value) { return {format:'annexb-idr-v1',codec:'avc1.42c033',...(encoder(value)==='nvidia'?{recipe:'nvenc-p1-qp20-v1'}:{})}; }
function cudaCompatible(video,preview) {
  return ['av1','h264','hevc','vp9'].includes(video.codec_name) && ['yuv420p','nv12'].includes(video.pix_fmt) &&
    video.color_space==='bt709' && video.color_range==='tv' && ['bt709',undefined,'unknown'].includes(video.color_transfer) &&
    preview.rotation%360===0 && preview.sampleAspectRatio==='1:1' && preview.width%2===0 && preview.height%2===0;
}
function configure(args,info,video) {
  const gpu=info.videoEncoding?.recipe==='nvenc-p1-qp20-v1',cuda=gpu&&cudaCompatible(video,info.preview);
  args[args.indexOf('-c:v')+1]=gpu?'h264_nvenc':'libx264';
  args.splice(args.indexOf('-q:v'),2,...(gpu?
    ['-preset','p1','-tune','ull','-rc','constqp','-qp','20','-init_qpI','20','-aud','1','-zerolatency','1']:
    ['-preset','ultrafast','-crf','20','-x264-params','aud=1:repeat-headers=1:keyint=1:scenecut=0']),
    '-profile:v','baseline','-level:v','5.1','-g','1','-bf','0','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv');
  args[args.indexOf('-f')+1]='h264';
  const vf=args.indexOf('-vf')+1;
  if(cuda){
    args[vf]=`showinfo@v=checksum=0,scale_cuda=w=${info.width}:h=${info.height}:interp_algo=bilinear:format=nv12,setsar=1`;
    args.splice(args.indexOf('-i'),0,'-hwaccel','cuda','-hwaccel_output_format','cuda');
  }else args[vf]=args[vf].replace('out_range=pc:out_color_matrix=bt601','out_range=tv:out_color_matrix=bt709').replace('format=yuvj420p','format=yuv420p');
  return {encoder:gpu?'h264_nvenc':'libx264',sourceDecoder:cuda?'cuda':'cpu',scale:cuda?'cuda-bilinear':'cpu-reference',recipe:info.videoEncoding.recipe||'x264-ultrafast-crf20-v1'};
}
module.exports={ENCODERS,DECODERS,encoder,decoder,encoding,cudaCompatible,configure};
