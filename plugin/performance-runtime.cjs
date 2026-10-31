'use strict';
// Live, bounded observation only. No recordings, benchmark runner or disk report.
const {createCollector,metrics}=require('./performance-core.cjs');
const {breakdown}=require('./performance-stages.cjs');
const {createResources}=require('./live-resources.cjs');
function createMonitor({root,context,onUpdate=()=>{},now=()=>performance.now(),resources}){
 let collector=null,state='off',timer=null,resourceTimer=null,destroyed=false,identity=null,phaseKey=null,phaseAt=0,cachedData=null,cachedMetrics=null,dirty=true;
 const meter=resources||createResources({root,context});
 function sync(){const c=context(),id=c.source?.sha256||'none';if(identity!==id){identity=id;dirty=true;collector=createCollector({now,live:true,limits:{events:1000,requests:200}});}return c;}
 function view(){const c=sync();if(dirty){cachedData=collector?.snapshot();cachedMetrics=cachedData?metrics(cachedData):null;dirty=false;}const data=cachedData,r=data?.requests.at(-1),pending=r?.status==='pending';let stages=breakdown(r,now()),delay=r?Math.max(0,(pending?now():r.end)-r.start):null,title='等待操作';
  if(c.state==='preparing'&&!pending){const key=c.progressMessage||'读取源索引';if(phaseKey!==key){phaseKey=key;phaseAt=now();}delay=now()-phaseAt;title=key;stages=[{name:'prepare',label:key,ms:delay,active:true,note:'当前准备阶段的持续时间'}];}
  else{phaseKey=null;if(pending){title=r.activeStage?.name==='native'?'原片寻帧 / 解码中':r.activeStage?.name==='decode'?'解码中':'等待画面';if(c.proxyActive&&r.activeStage?.name==='native')title='代理寻帧 / 解码中';}else if(r)title=['shown','reused'].includes(r.status)?'画面已显示':r.status==='failed'?'画面读取失败':'目标已更新';}
  if(!pending&&Number.isFinite(c.activeNativeReadAt)){delay=Math.max(0,now()-c.activeNativeReadAt);title=c.proxyActive?'代理寻帧 / 解码中':'原片寻帧 / 解码中';stages=[{name:'native',label:'寻帧 / 解码',ms:delay,active:true,note:'打开监测前已开始的原生读取，包含解码与管道返回等待'}];}
  return{state,data,metrics:cachedMetrics,stages,explanation:{delay,title},resources:meter.view()};
 }
 const notify=()=>{if(state==='off'||destroyed)return;try{onUpdate(view());}catch(_){}};
 function enable(){if(destroyed||state!=='off')return;state='observing';meter.resume?.();sync();meter.sample().then(notify);resourceTimer=setInterval(()=>meter.sample().then(notify),2500);timer=setInterval(notify,100);notify();}
 function disable(){clearInterval(timer);clearInterval(resourceTimer);timer=resourceTimer=null;state='off';meter.pause?.();collector=null;cachedData=cachedMetrics=null;dirty=true;identity=null;return true;}
 function observe(e,b){if(state==='off'||destroyed)return;sync();collector.observe(e,b);dirty=true;}
 function destroy(){destroyed=true;disable();meter.close();}
 return{enable,disable,observe,view,destroy,enabled:()=>state!=='off'};
}
function playerContext(getPlayer,getSession=()=>({})){
  let previous=null,source=null;
  return()=>{const p=getPlayer(),s=getSession()||{},info=p?.info;
    if(info!==previous){previous=info;source=null;if(info){const f=info.frames||[],steps=new Set();for(let n=1;n<f.length;n++)steps.add((f[n].time-f[n-1].time).toFixed(6));
      source={sha256:info.source?.sha256||null,codec:info.source?.codec||'unknown',width:info.source?.width||info.width,height:info.source?.height||info.height,
        duration:info.duration,frames:f.length,averageFps:f.length/info.duration,variableFrameSpacing:steps.size>1,bitDepth:'unknown',index:'integer source PTS',firstPts:f[0]?.ptsTicks,lastPts:f.at(-1)?.ptsTicks};}}
    const b=p?.snapshot()||{},prep=s.proxyPreparation;
    return{source,config:{backend:info?.videoEncoding?'proxy':'jpeg',previewWidth:info?.width,previewHeight:info?.height,previewQuality:s.previewQuality||'unknown',
      proxyEncoder:s.proxyEncoder||'cpu',ramBytes:b.budget?.limit,forwardPredecode:b.forwardPredecode,decoder:b.frameDecoder?{codec:b.frameDecoder.codec,preference:b.frameDecoder.hardwarePreference}:null,rate:p?.playbackRate||1},
      environment:{decoderPreference:b.frameDecoder?.hardwarePreference||'unknown',viewport:typeof window==='object'?{width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio}:null},
      observationBoundary:{sessionEpoch:s.epoch||0,epoch:p?.epoch||0,requestId:p?.requestId||0},state:s.state,proxyActive:b.proxyActive,previewActive:!!s.preview?.active,progressMessage:s.progress?.message,backend:info?.videoEncoding?'proxy':'jpeg',proxyStage:prep?.stage,proxyRanges:prep?.readyRanges,
      cacheState:()=>({decoded:[...(p?.cache?.keys()||[])],compressed:[...(p?.compressed?.keys()||[])],pending:(p?.tasks?.size||0)+(p?.loads?.size||0)+(p?.target?.resolve?1:0)}),
      activeNativeReadAt:p?.readerBusy?p?.readOwner?.at:null,resourcePids:info?.nativeRuntime?.resourcePids?.()||[],diskUsage:info?.nativeRuntime?.diskUsage,managedBytes:b.cacheBytes||0,cachedFrames:p?.cache?.size||0,generating:prep?prep.stage==='preparing':false,prepared:prep?.ready??null};
  };
}
module.exports={createMonitor,playerContext};
