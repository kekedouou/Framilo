'use strict';
// One bounded same-bitrate GPU quality probe. Not a production encoder preset.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const {ffmpeg}=require('../tests/support/e41-quality.cjs'),{AccessUnitParser}=require('../plugin/avc-access-units.cjs');
async function main(){
 const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1];assert(args.includes('--source')&&args.includes('--tools'));
 const source=get('--source'),tools=JSON.parse(fs.readFileSync(get('--tools'))),base=path.resolve(__dirname,'../verification-runs/e41'),out=path.join(base,'bitrate-quality.json');assert(!fs.existsSync(out));
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),'c6e025b647bf733411779212b8a99580b5bfc012a14c8e974720234877513f8f');
 const cpu=JSON.parse(fs.readFileSync(path.join(base,'browser-cpu-follow.json'))).rounds[0].production.find(p=>p.metrics.segmentStart===84);
 const bitrate=Math.round(cpu.bytes*8/cpu.duration),start=performance.now();
 const encoded=await ffmpeg(tools.ffmpeg,['-loglevel','info','-copyts','-noaccurate_seek','-seek_timestamp','1','-ss','84','-hwaccel','cuda','-hwaccel_output_format','cuda','-i',source,'-an','-sn','-dn','-vf','trim=start=84,showinfo@v=checksum=0,scale_cuda=w=1280:h=720:interp_algo=bilinear:format=nv12,setsar=1','-frames:v','60','-c:v','h264_nvenc','-preset','p1','-tune','ull','-rc','vbr','-b:v',String(bitrate),'-maxrate',String(bitrate),'-bufsize',String(bitrate*2),'-profile:v','baseline','-level:v','5.1','-g','1','-bf','0','-aud','1','-zerolatency','1','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-f','h264','pipe:1']);
 const ms=performance.now()-start,parser=new AccessUnitParser(),packets=[...parser.push(encoded.bytes),...parser.end()];assert.equal(packets.length,60);
 const pts=[...encoded.log.matchAll(/n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:/g)];assert(pts.some(m=>m[1]==='18'&&m[2]==='1353600'),'sample source PTS');
 const ref=await ffmpeg(tools.ffmpeg,['-copyts','-noaccurate_seek','-ss','84.6','-i',source,'-an','-vf','trim=start=84.6,scale=1280:720:flags=bilinear:out_range=tv:out_color_matrix=bt709,format=yuv420p','-frames:v','1','-f','rawvideo','pipe:1']);
 const decoded=await ffmpeg(tools.ffmpeg,['-v','error','-f','h264','-i','pipe:0','-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','pipe:1'],packets[18].bytes);assert.equal(ref.bytes.length,decoded.bytes.length);let sum=0;for(let i=0;i<ref.bytes.length;i++)sum+=(ref.bytes[i]-decoded.bytes[i])**2;
 fs.writeFileSync(out,JSON.stringify({status:'completed',scope:'one 2-second bitrate-target probe; pipeline time excludes formal publishing and audio',sourceTime:84.6,cpuReferenceBytes:cpu.bytes,targetBitrate:bitrate,actualBytes:encoded.bytes.length,encodePipelineMs:ms,psnr:10*Math.log10(255**2/(sum/ref.bytes.length)),generatedBytes:encoded.bytes.length+ref.bytes.length+decoded.bytes.length,productionPreset:false},null,2),{flag:'wx'});
 console.log(fs.readFileSync(out,'utf8'));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
