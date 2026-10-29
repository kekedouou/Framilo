'use strict';
// Continuous bounded source windows. Only pipes here: publication belongs to
// long-media/cache's existing serial writer, never to this decoder.
const LIMITS=Object.freeze({windowGroups:15,batchBytes:8*1024**2,frameBytes:1024**2,queuedPts:512,logBytes:1024**2});
function createScrubProducer({info,video,preview,origin,start,source,tool,helpers:h,signal}){
 const groups=info.segments,end=Math.min(groups.length,start+LIMITS.windowGroups);
 const last=groups[end-1],job={signal,children:new Set(),operations:new Set(),failure:null};
 const args=h.ffmpegArgs(source,false,video.codec_name,video,preview);
 const begin=origin+groups[start].start,finishTime=origin+last.end;
 args.splice(args.indexOf('-i'),0,...(['h264','hevc'].includes(video.codec_name)?['-skip_frame','noref']:[]),'-noaccurate_seek','-seek_timestamp','1','-ss',begin.toFixed(9));
 const vf=args.indexOf('-vf')+1;args[vf]=`trim=start=${begin.toFixed(9)}:end=${finishTime.toFixed(9)},select='isnan(prev_selected_t)+gte(t-prev_selected_t,0.1)',`+args[vf];
 args[args.indexOf('-q:v')+1]='5';
 const {child,finish}=h.childProcess(job,tool,args,['ignore','pipe','pipe'],false),iterator=child.stdout[Symbol.asyncIterator](),parser=new h.JpegParser();
 const images=[],stamps=[],sourceIndex=new Map(info.frames.map((f,n)=>[f.ptsTicks,n]));
 let base=null,index=0,readIndex=0,logEnded=false,stdoutEnded=false,closed=false,failure=null,wake=null,lookahead=null,current=start;
 const notify=()=>{if(wake){const done=wake;wake=null;done();}};
 const abort=()=>{closed=true;h.stopChildren(job);child.stdout.destroy();notify();};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const log=(async()=>{let pending='',count=0;
  try{for await(const bytes of child.stderr){count+=bytes.length;if(count>LIMITS.logBytes)throw Error('低清预览日志超过上限。');pending+=bytes.toString();const rows=pending.split(/\r?\n/);pending=rows.pop();
   for(const row of rows){if(!row.includes('showinfo@v'))continue;const tb=/config in time_base:\s*(\d+)\/(\d+)/.exec(row);if(tb)base=[Number(tb[1]),Number(tb[2])];
    const match=/n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:/.exec(row);if(match){if(Number(match[1])!==index++||stamps.length>=LIMITS.queuedPts)throw Error('低清预览时间戳队列无效。');stamps.push(match[2]);notify();}}
  }}catch(e){failure=e;h.stopChildren(job);}finally{logEnded=true;notify();}
 })();
 finish.then(exit=>{if(!closed&&(exit.error||exit.code!==0)){failure=exit.error||Error('低清预览生成中断。');notify();}});
 function check(){h.check(job);if(failure)throw failure;if(closed)throw Object.assign(Error('低清预览已取消。'),{code:'MEDIA_CANCELLED'});}
 async function frame(){
  check();while(!images.length&&!stdoutEnded){const value=await iterator.next();check();if(value.done){stdoutEnded=true;if(parser.buffer.length)throw Error('低清JPEG尾部不完整。');break;}
   for(const bytes of parser.push(value.value)){if(bytes.length>LIMITS.frameBytes)throw Error('低清单帧超过上限。');images.push(Buffer.from(bytes));}}
  if(!images.length){await log;await finish;check();if(stamps.length)throw Error('低清图片与时间戳数量不一致。');return null;}
  while(!stamps.length&&!logEnded){await new Promise(resolve=>wake=resolve);check();}
  const pts=stamps.shift(),ordinal=sourceIndex.get(pts),bytes=images.shift();readIndex++;
  if(!base||ordinal===undefined||base[0]!==info.frames[ordinal].timeBase[0]||base[1]!==info.frames[ordinal].timeBase[1])throw Error('低清预览没有通过源帧身份校验。');
  return {ordinal,bytes};
 }
 return {
  end,
  async next(){
   if(current>=end)return null;check();const group=groups[current],items=[];let bytes=0;
   for(;;){const item=lookahead||await frame();lookahead=null;if(!item)break;
    if(item.ordinal<group.first)throw Error('低清源帧顺序错误。');
    if(item.ordinal>group.last){lookahead=item;break;}
    bytes+=item.bytes.length;if(bytes>LIMITS.batchBytes)throw Error('低清分段缓冲超过上限。');items.push(item);
   }
   const ordinal=current++;if(current===end){if(lookahead||await frame())throw Error('低清窗口溢出。');}
   return {ordinal,items,bytes};
  },
  async close(){abort();await Promise.allSettled([log,finish]);signal.removeEventListener('abort',abort);images.length=stamps.length=0;lookahead=null;}
 };
}
module.exports={createScrubProducer,LIMITS};
