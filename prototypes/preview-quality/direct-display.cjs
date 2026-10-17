'use strict';
// One paused browser frame -> visible Canvas. No codec, cache or pixel readback.
const {draw}=require('./native-reference.cjs');
function firstFrame(video,canvas,options={}){
  const schedule=options.setTimeout||setTimeout,unschedule=options.clearTimeout||clearTimeout;
  const valid=options.valid||(()=>true);
  let callback=null,timer=null,settled=false,resolve,reject;
  const ready=new Promise((r,j)=>{resolve=r;reject=j;});ready.catch(()=>{});
  function cleanup(){
    if(timer!==null){unschedule(timer);timer=null;}
    if(callback!==null){video.cancelVideoFrameCallback(callback);callback=null;}
    video.removeEventListener('loadedmetadata',metadata);video.removeEventListener('error',error);
  }
  function finish(failure,value){if(settled)return;settled=true;cleanup();if(failure)reject(failure);else resolve(value);}
  function cancel(){finish(null,{cancelled:true});}
  function checkMetadata(){
    const width=video.videoWidth,height=video.videoHeight,duration=video.duration;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>3840*2160)
      throw Error('本次显示对照仅支持4K及以下视频');
    if(!Number.isFinite(duration)||duration<=0||duration>30)throw Error('本次显示对照仅支持不超过30秒的视频');
    return {width,height,duration};
  }
  function metadata(){if(settled||callback!==null)return;try{if(!valid())return cancel();checkMetadata();callback=video.requestVideoFrameCallback(receive);}catch(e){finish(e);}}
  function error(){finish(Error('原视频解码失败；本次显示对照未成立'));}
  function receive(_now,frame){
    callback=null;if(settled)return;if(!valid())return cancel();
    try{
      const source=checkMetadata(),time=frame&&frame.mediaTime;
      if(video.readyState<2||video.seeking===true||!Number.isFinite(time)||time<0||time>source.duration)
        throw Error('首帧时间或解码状态尚未确定，未显示过期画面');
      video.pause();
      const scale=Math.min(1,1920/source.width,1080/source.height);
      const width=Math.max(1,Math.round(source.width*scale)),height=Math.max(1,Math.round(source.height*scale));
      const ctx=draw(video,canvas,width,height);
      finish(null,{sourceWidth:source.width,sourceHeight:source.height,width,height,duration:source.duration,
        actualMediaTime:time,currentTime:video.currentTime,scaled:scale<1,
        method:'requestVideoFrameCallback.mediaTime -> drawImage(same paused video)',
        canvasColorSpace:ctx.getContextAttributes?.().colorSpace||'unreported',
        pixelReadback:false,cacheEncoding:false,canvasPixelBytes:width*height*4,userVisualResult:'pending'});
    }catch(e){finish(e);}
  }
  try{
    if(typeof video.requestVideoFrameCallback!=='function'||typeof video.cancelVideoFrameCallback!=='function')
      throw Error('此宿主无法确认实际视频帧，本次对照未成立');
    video.pause();video.addEventListener('loadedmetadata',metadata);video.addEventListener('error',error);
    timer=schedule(()=>finish(Error('等待原视频首帧超时；本次对照未成立')),8000);
    if(video.readyState>=1)metadata();
  }catch(e){finish(e);}
  return {ready,cancel};
}
module.exports={firstFrame};
