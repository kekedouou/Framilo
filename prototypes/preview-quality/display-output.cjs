'use strict';
// Experimental one-frame output only. No pixel readback, encoding or media files.
function shortError(error){return String(error&&error.message||error||'unknown').slice(0,200);}
function describeFrame(video,options={}){
  const Frame=Object.prototype.hasOwnProperty.call(options,'VideoFrame')?options.VideoFrame:
    (typeof globalThis.VideoFrame==='function'?globalThis.VideoFrame:null);
  if(typeof Frame!=='function')return {available:false,reason:'unsupported'};
  let frame;
  try{
    frame=new Frame(video);
    const result={available:true};
    for(const key of ['format','codedWidth','codedHeight','displayWidth','displayHeight','timestamp','duration']){
      const value=frame[key];
      if(value===null||typeof value==='string'||(typeof value==='number'&&Number.isFinite(value)))result[key]=value;
    }
    const raw=frame.colorSpace&&typeof frame.colorSpace.toJSON==='function'?frame.colorSpace.toJSON():null;
    if(raw&&typeof raw==='object'){
      result.colorSpace={};
      for(const key of ['primaries','transfer','matrix','fullRange']){
        const value=raw[key];
        if(value===null||typeof value==='string'||typeof value==='boolean')result.colorSpace[key]=value;
      }
    }else result.colorSpace={available:false,reason:'unreported'};
    return result;
  }catch(error){return {available:false,reason:'read-failed',error:shortError(error)};}
  finally{if(frame&&typeof frame.close==='function'){try{frame.close();}catch(_){/* metadata failure must not retain the frame */}}}
}
function describeCanvas(ctx){
  if(!ctx||typeof ctx.getContextAttributes!=='function')return {available:false,reason:'unsupported'};
  try{
    const raw=ctx.getContextAttributes();
    if(!raw||typeof raw!=='object')return {available:false,reason:'unreported'};
    const result={available:true};
    for(const key of ['alpha','desynchronized','willReadFrequently','colorSpace','colorType']){
      const value=raw[key];
      if(typeof value==='boolean'||typeof value==='string')result[key]=value;
    }
    return result;
  }catch(error){return {available:false,reason:'read-failed',error:shortError(error)};}
}
function bridge(canvas,video,options={}){
  const valid=options.valid||(()=>true),schedule=options.setTimeout||setTimeout,unschedule=options.clearTimeout||clearTimeout;
  let stream=null,track=null,callback=null,timer=null,settled=false,released=false,attached=false;
  let resolve,reject;
  const ready=new Promise((r,j)=>{resolve=r;reject=j;});ready.catch(()=>{});
  function cleanWait(){
    if(timer!==null){unschedule(timer);timer=null;}
    if(callback!==null){video.cancelVideoFrameCallback(callback);callback=null;}
    video.removeEventListener('error',error);
  }
  function release(){
    if(released)return;released=true;cleanWait();
    if(stream){for(const item of stream.getTracks()){try{item.stop();}catch(_){/* try every owned track */}}}
    if(attached){video.pause();if(video.srcObject===stream)video.srcObject=null;if(typeof video.load==='function')video.load();}
  }
  function finish(failure,value){if(settled)return;settled=true;cleanWait();if(failure){release();reject(failure);}else resolve(value);}
  function cancel(){if(!settled)finish(null,{cancelled:true});release();}
  function error(){finish(Error('单帧视频输出失败；此候选未成立'));}
  function redraw(ctx){
    // captureStream(0).requestFrame() arms capture; Chromium also needs a Canvas draw.
    // The existing opaque 2D surface has no persistent clipping. Copy it 1:1,
    // preserving the caller's state and using neither a readback nor an encoder.
    ctx.save();
    try{
      ctx.resetTransform();ctx.globalAlpha=1;ctx.globalCompositeOperation='copy';ctx.filter='none';
      ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
      ctx.drawImage(canvas,0,0);
    }finally{ctx.restore();}
  }
  function receive(_now,frame){
    callback=null;if(settled)return;if(!valid())return cancel();
    try{
      const time=frame&&frame.mediaTime;
      if(video.readyState<2||video.seeking===true||!Number.isFinite(time)||time<0)
        throw Error('单帧视频输出尚未确认实际画面；此候选未成立');
      if(video.videoWidth!==canvas.width||video.videoHeight!==canvas.height)
        throw Error('单帧视频输出尺寸已变化；此候选未成立');
      video.pause();
      finish(null,{actualMediaTime:time,currentTime:video.currentTime,width:video.videoWidth,height:video.videoHeight,
        decodedFrame:describeFrame(video,options),method:'fixed Canvas -> captureStream(0) -> requestFrame + same-pixel redraw -> video frame callback',
        pixelReadback:false,cacheEncoding:false,targetSourcePtsVerified:false,userVisualResult:'pending'});
    }catch(failure){finish(failure);}
  }
  try{
    if(!valid()){cancel();return {ready,cancel};}
    if(!Number.isInteger(canvas.width)||!Number.isInteger(canvas.height)||canvas.width<=0||canvas.height<=0||
       canvas.width>1920||canvas.height>1080||canvas.width%2!==0||canvas.height%2!==0)
      throw Error('单帧输出仅支持1920×1080以内的偶数尺寸画布');
    if(typeof canvas.captureStream!=='function'||typeof video.requestVideoFrameCallback!=='function'||
       typeof video.cancelVideoFrameCallback!=='function'||typeof video.play!=='function')
      throw Error('此宿主不支持已确认的单帧视频输出');
    if(video.srcObject)throw Error('单帧输出视频仍有旧流；请先释放旧显示');
    const ctx=typeof canvas.getContext==='function'?canvas.getContext('2d'):null;
    if(!ctx||['save','restore','resetTransform','drawImage'].some(key=>typeof ctx[key]!=='function'))
      throw Error('此宿主不支持保持画布内容的单帧重绘');
    stream=canvas.captureStream(0);
    const tracks=stream.getVideoTracks();
    if(tracks.length!==1||typeof tracks[0].requestFrame!=='function')throw Error('此宿主不支持手动提交单帧画布流');
    track=tracks[0];video.muted=true;video.playsInline=true;
    video.addEventListener('error',error);
    timer=schedule(()=>finish(Error('单帧视频输出等待超时；此候选未成立')),8000);
    attached=true;video.srcObject=stream;
    callback=video.requestVideoFrameCallback(receive);
    // play() may remain pending until the first captured frame; never gate capture on it.
    Promise.resolve(video.play()).then(()=>{if(!settled&&!valid())cancel();},failure=>finish(Error('单帧视频输出无法开始：'+shortError(failure))));
    if(!settled){track.requestFrame();redraw(ctx);}
  }catch(failure){finish(failure);}
  return {ready,cancel};
}
module.exports={describeFrame,describeCanvas,bridge};
