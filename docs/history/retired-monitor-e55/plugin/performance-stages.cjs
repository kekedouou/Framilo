'use strict';
// Exclusive accounting: nested observations replace, never add to, their parent.
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const DEFINITIONS=[
 ['locate','寻帧定位','#a0afc0','源帧索引定位；不含原视频解码'],
 ['native','原生寻帧与解码','#829fc9','原生读取、GOP前滚、解码与进程传输的实际等待；未拆成纯磁盘或纯GPU时间'],
 ['readIO','文件读取与解封装','#d4ac72','已准备数据的读取、身份校验及读取队列往返；帧内包已预先解封装，不能再细分为纯磁盘速度'],
 ['decodeNative','视频解码','#829fc9','WebCodecs提交到输出回调，包含解码器内部排队；不是纯GPU计时'],
 ['convert','图像转换','#a4a1c7','VideoFrame转换为可绘制位图'],
 ['transfer','数据传输','#7fabb5','收到字节后的Buffer复制；跨线程往返仍含在读取中，未测GPU上传'],
 ['submit','渲染提交','#66ae99','Canvas drawImage调用，不代表显示器已刷新'],
 ['queue','任务排队','#b59c83','等待播放器有限的图像任务槽'],
 ['prepare','分段等待','#c48f78','等待分段租约；可能含代理生成、后台排队或安全校验，不能只归因于编码'],
 ['renderWait','等待绘制','#81959e','画面就绪到提交；包括界面调度，旧RAM命中记录无法再拆出其中的界面处理'],
 ['asset','读取 / 准备未拆分','#a69780','旧记录或尚未细分的资源返回部分'],
 ['decode','解码未拆分','#959abb','解码初始化或旧解码总段，已测解码/转换部分扣除'],
 ['other','未归因','#697780','测量边界没有覆盖的时间；不会猜成硬件瓶颈']
];
function breakdown(r,at){
 const end=r?.status==='pending'?at:r?.end;if(!r||!finite(end))return DEFINITIONS.map(([name,label,color,note])=>({name,label,color,note,ms:null}));
 const spans=(r.stages||[]).filter(s=>finite(s.start)&&finite(s.end)).map(s=>({...s}));
 if(r.status==='pending')for(const [name,start]of Object.entries(r.activeStages||{}))spans.push({name,start,end});
 const good=['shown','reused'].includes(r.status);
 // A legacy decoded-cache hit is known ready at input, even without decoder events.
 const ready=finite(r.readyAt)?Math.max(r.start,r.readyAt):r.cache==='decoded'?r.start:null;
 if(good&&finite(ready))spans.push({name:'renderWait',start:ready,end:finite(r.submitStartedAt)?r.submitStartedAt:end});
 if(good&&finite(r.submitStartedAt))spans.push({name:'submit',start:r.submitStartedAt,end});
 const clipped=spans.map(s=>({...s,start:Math.max(r.start,s.start),end:Math.min(end,s.end)})).filter(s=>s.end>=s.start);
 const points=[...new Set([r.start,end,...clipped.flatMap(s=>[s.start,s.end])])].sort((a,b)=>a-b);
 const priority=['locate','transfer','convert','decodeNative','readIO','native','prepare','queue','submit','renderWait','decode','asset'];
 const totals={};for(const s of clipped)totals[s.name]=0;
 totals.other=0;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];const covering=clipped.filter(s=>s.start<=a&&s.end>=b);const name=priority.find(n=>covering.some(s=>s.name===n))||'other';totals[name]=(totals[name]||0)+b-a;}
 return DEFINITIONS.map(([name,label,color,note])=>({name,label,color,note,ms:finite(totals[name])?totals[name]:null,active:Object.hasOwn(r.activeStages||{},name)}));
}
function summary(requests){
 const good=(requests||[]).filter(r=>['shown','reused'].includes(r.status)),rows=good.map(r=>breakdown(r,r.end));
 return DEFINITIONS.map(([name,label,color,note])=>{const values=rows.map(row=>row.find(p=>p.name===name)?.ms).filter(finite);return {name,label,color,note,n:values.length,ms:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};});
}
module.exports={DEFINITIONS,breakdown,summary};
