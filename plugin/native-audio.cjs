'use strict';
// An owned, bounded copy of the original compressed track. No video encoder,
// persistent cache, audio recompression or source-file writes belong here.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawn:systemSpawn}=require('child_process'),{StringDecoder}=require('string_decoder');
const MAX_AUDIO_BYTES=64*1024**2,MAX_METADATA_BYTES=64*1024**2,MAX_LINE_BYTES=64*1024,TIMEOUT_MS=30000;
const STREAM_FIELDS=['codec_name','codec_type','sample_rate','channels','channel_layout','time_base','start_pts','duration_ts','extradata_hash'];
function issue(code,message){return Object.assign(Error(message),{code});}
function integer(value,label){if(typeof value!=='string'||! /^-?\d{1,20}$/.test(value))throw issue('AUDIO_TIMING',label+'缺少可靠的整数时间。');const n=BigInt(value);if(n<-(1n<<63n)||n>=(1n<<63n))throw issue('AUDIO_TIMING',label+'超出时间范围。');return n;}
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||path.resolve(fs.realpathSync(file)).toLowerCase()!==path.resolve(file).toLowerCase())throw issue('AUDIO_SOURCE','音轨源文件身份无法确认。');return s;}
function stamp(s){return[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');}
function copyArgs(file){return['-hide_banner','-nostdin','-loglevel','warning','-copyts','-i',file,'-map','0:a:0','-vn','-sn','-dn','-c:a','copy','-avoid_negative_ts','disabled','-use_editlist','1','-movflags','empty_moov+delay_moov+default_base_moof','-frag_duration','1000000','-f','mp4','pipe:1'];}
function probeArgs(file,source){return['-v','error',...(source?['-select_streams','a:0']:[]),'-show_streams','-show_packets','-show_data_hash','sha256','-show_entries','stream='+STREAM_FIELDS.join(',')+':stream_disposition=:stream_tags=:packet=pts,dts,duration,size,data_hash:packet_side_data=side_data_type,skip_samples,discard_padding,skip_reason,discard_reason','-of','flat','-i',file];}
function fingerprint(maxPayloadBytes=null){
 let packet=null,previous=null,count=0,first=null,last=null,payloadBytes=0n;const digest=crypto.createHash('sha256'),streams=new Map();
 function checked(p){for(const name of ['pts','dts'])p[name]=integer(p[name],name).toString();const size=integer(p.size,'音频包大小');if(size<1n)throw issue('AUDIO_VALIDATE','音频包为空。');p.size=size.toString();
  payloadBytes+=size;if(maxPayloadBytes!==null&&payloadBytes>BigInt(maxPayloadBytes))throw issue('AUDIO_BUDGET','原音轨压缩数据已超过安全上限。');
  if(!/^SHA256:[a-fA-F0-9]{64}$/.test(p.data_hash||''))throw issue('AUDIO_VALIDATE','音频包缺少内容指纹。');
  if(p.duration!==undefined&&p.duration!=='N/A'){if(integer(p.duration,'音频包时长')<=0n)throw issue('AUDIO_TIMING','音频包时长无效。');}else delete p.duration;
  for(const [key,value]of Object.entries(p.side))if(!key.endsWith('side_data_type')){const n=integer(value,'音频跳过信息');if(n<0n||n>4294967295n)throw issue('AUDIO_TIMING','音频跳过信息无效。');}
  return p;
 }
 function add(p,nextPts){const interval=nextPts===null?null:integer(nextPts,'下一音频包')-integer(p.pts,'音频包');if(interval!==null&&interval<=0n)throw issue('AUDIO_TIMING','音频包时间不是严格递增。');
  const duration=p.duration===undefined?interval:integer(p.duration,'音频包时长');if(duration===null||duration<=0n)throw issue('AUDIO_TIMING','音频包边界无法确认。');
  digest.update(JSON.stringify([p.pts,p.dts,duration.toString(),p.size,p.data_hash.toLowerCase(),Object.keys(p.side||{}).sort().map(k=>[k,p.side[k]])])+'\n');
  if(first===null)first=p.pts;last={pts:p.pts,duration:duration.toString()};count++;
 }
 function finishPacket(){if(!packet)return;checked(packet);if(previous)add(previous,packet.pts);previous=packet;packet=null;}
 function line(text){if(!text)return;const found=/^(packets\.packet\.(\d+)\.([^=]+)|streams\.stream\.(\d+)\.([^=]+))=(.*)$/.exec(text);if(!found)throw issue('AUDIO_METADATA','音轨校验输出格式无效。');
  let value=found[6];if(value.startsWith('"')){try{value=JSON.parse(value);}catch(_){throw issue('AUDIO_METADATA','音轨校验字符串无效。');}}if(typeof value!=='string')throw issue('AUDIO_METADATA','音轨校验字段无效。');
  if(found[2]!==undefined){const ordinal=Number(found[2]),key=found[3];if(!Number.isSafeInteger(ordinal)||ordinal<0)throw issue('AUDIO_METADATA','音频包序号无效。');
   if(!packet||packet.ordinal!==ordinal){if(ordinal!==(packet?packet.ordinal+1:count+(previous?1:0)))throw issue('AUDIO_METADATA','音频包序号不连续。');finishPacket();packet={ordinal,side:{}};}
   if(['pts','dts','duration','size','data_hash'].includes(key)){if(packet[key]!==undefined)throw issue('AUDIO_METADATA','音频包字段重复。');packet[key]=value;}
   else if(/^side_data_list\.side_data\.[0-7]\.(?:side_data_type|skip_samples|discard_padding|skip_reason|discard_reason)$/.test(key)){if(packet.side[key]!==undefined)throw issue('AUDIO_METADATA','音频跳过信息重复。');packet.side[key]=value;}
   else throw issue('AUDIO_METADATA','存在无法校验的音频包信息。');
  }else{finishPacket();const ordinal=Number(found[4]),key=found[5];if(!Number.isSafeInteger(ordinal)||ordinal!==0||!STREAM_FIELDS.includes(key))throw issue('AUDIO_VALIDATE','独立音轨含额外流或未知信息。');const stream=streams.get(ordinal)||{};if(stream[key]!==undefined)throw issue('AUDIO_METADATA','音轨字段重复。');stream[key]=value;streams.set(ordinal,stream);}
 }
 function end(){finishPacket();const stream=streams.get(0);if(!stream||streams.size!==1||stream.codec_type!=='audio'||!previous)throw issue('AUDIO_VALIDATE','独立音轨必须只有一条有效音频流。');
  const tb=/^(\d{1,10})\/(\d{1,10})$/.exec(stream.time_base||'');if(!tb||BigInt(tb[1])<=0n||BigInt(tb[2])<=0n||integer(stream.sample_rate,'音频采样率')<=0n||integer(stream.channels,'音频声道')<=0n)throw issue('AUDIO_TIMING','音轨时基或采样格式无效。');
  if(!stream.codec_name||stream.codec_name.length>64)throw issue('AUDIO_VALIDATE','音轨编码无法确认。');if(stream.extradata_hash!==undefined&&!/^SHA256:[a-fA-F0-9]{64}$/.test(stream.extradata_hash))throw issue('AUDIO_VALIDATE','音轨初始化数据指纹无效。');
  const start=integer(stream.start_pts,'音轨起点'),duration=integer(stream.duration_ts,'音轨时长');if(duration<=0n)throw issue('AUDIO_TIMING','音轨时长无效。');const end=start+duration,lastPts=integer(previous.pts,'末尾音频包');
  if(previous.duration!==undefined&&lastPts+integer(previous.duration,'末尾音频包时长')!==end)throw issue('AUDIO_TIMING','音轨末尾与音频包边界不一致。');
  add(previous,end.toString());return{stream:Object.fromEntries(STREAM_FIELDS.map(k=>[k,stream[k]===undefined?null:stream[k]])),packets:count,firstPts:first,lastPts:last.pts,endPts:end.toString(),sha256:digest.digest('hex')};
 }
 return{line,end};
}
function createAudioTrack(options={}){
 const {source,tools,maxBytes,signal,expectedStamp}=options,spawn=options.spawn||systemSpawn,children=new Set();let failure=null,timer=null,sourceStamp=null;
 function stop(reason){failure=failure||reason;for(const child of children)try{child.kill();}catch(_){} }
 function check(){if(failure)throw failure;if(signal?.aborted)throw issue('AUDIO_CANCELLED','音轨准备已取消。');}
 function checkSource(){let unchanged=false;try{unchanged=stamp(regular(source.filePath))===sourceStamp;}catch(_){}if(!unchanged)throw issue('AUDIO_SOURCE_CHANGED','准备音轨时源文件发生变化或已无法确认。');}
 const cancel=()=>stop(issue('AUDIO_CANCELLED','音轨准备已取消。'));
 function run(exe,args,{input=null,collect=false,consume=null}={}){check();return new Promise((resolve,reject)=>{
  let child,failed=null,total=0,tail='',pending='',decoder=new StringDecoder('utf8');const chunks=[];
  const fail=e=>{failed=failed||e;try{child?.kill();}catch(_){} };
  try{child=spawn(exe,args,{windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});}catch(e){reject(e);return;}children.add(child);
  child.once('error',fail);child.stderr.on('data',chunk=>{if(chunk.length>1024*1024){fail(issue('AUDIO_TOOL','音轨工具输出块超过安全上限。'));return;}tail=(tail+chunk.toString()).slice(-8192);});
  child.stdout.on('data',chunk=>{if(failed||failure)return;try{total+=chunk.length;if(total>(collect?maxBytes:MAX_METADATA_BYTES))throw issue(collect?'AUDIO_BUDGET':'AUDIO_METADATA','音轨准备输出超过安全上限。');
    if(collect)chunks.push(chunk);else{pending+=decoder.write(chunk);let at;while((at=pending.indexOf('\n'))!==-1){const line=pending.slice(0,at).replace(/\r$/,'');pending=pending.slice(at+1);if(Buffer.byteLength(line)>MAX_LINE_BYTES)throw issue('AUDIO_METADATA','音轨校验行超过安全上限。');consume(line);}if(Buffer.byteLength(pending)>MAX_LINE_BYTES)throw issue('AUDIO_METADATA','音轨校验行超过安全上限。');}
   }catch(e){fail(e);}});
  child.stdin.on('error',e=>{if(e.code!=='EPIPE'&&!failure)fail(e);});
  child.once('close',code=>{children.delete(child);try{check();if(failed)throw failed;if(code!==0)throw issue('AUDIO_TOOL','音轨准备失败：'+tail);if(collect){if(!total)throw issue('AUDIO_VALIDATE','独立音轨为空。');resolve(Buffer.concat(chunks,total));}else{pending+=decoder.end();if(Buffer.byteLength(pending)>MAX_LINE_BYTES)throw issue('AUDIO_METADATA','音轨校验行超过安全上限。');if(pending)consume(pending.replace(/\r$/,''));resolve();}}catch(e){reject(e);}});
  try{child.stdin.end(input||undefined);}catch(e){fail(e);}
 });}
 async function probe(file,input){const parsed=fingerprint(input===null?maxBytes:null);await run(tools.ffprobe,probeArgs(file,input===null),{input,consume:parsed.line});return parsed.end();}
 const promise=(async()=>{if(!source||!path.isAbsolute(source.filePath||'')||!tools||![tools.ffmpeg,tools.ffprobe].every(p=>typeof p==='string'&&path.isAbsolute(p))||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_AUDIO_BYTES)throw issue('AUDIO_OPTIONS','独立音轨准备参数无效。');check();
  if(typeof expectedStamp!=='string'||!expectedStamp||expectedStamp.length>512)throw issue('AUDIO_SOURCE_CHANGED','音轨缺少已确认的视频源身份。');sourceStamp=expectedStamp;checkSource();signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(()=>stop(issue('AUDIO_TIMEOUT','独立音轨准备超时。')),TIMEOUT_MS);
  const original=await probe(source.filePath,null);check();const bytes=await run(tools.ffmpeg,copyArgs(source.filePath),{collect:true});check();const copied=await probe('pipe:0',bytes);check();
  checkSource();if(JSON.stringify(original)!==JSON.stringify(copied))throw issue('AUDIO_CHANGED','独立音轨的内容或时序与原声不一致。');
  return{bytes,mime:'audio/mp4',method:'audio-only-copy',verification:{codec:copied.stream.codec_name,packetCount:copied.packets,packetSha256:copied.sha256,stream:copied.stream,firstPts:copied.firstPts,endPts:copied.endPts}};
 })().catch(e=>{if(sourceStamp!==null)checkSource();throw e;}).finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);});
 return{promise,cancel(){cancel();return promise.catch(()=>null);},pids:()=>[...children].map(c=>c.pid).filter(Number.isSafeInteger)};
}
module.exports={createAudioTrack,MAX_AUDIO_BYTES,_test:{copyArgs,probeArgs,fingerprint}};
