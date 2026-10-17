'use strict';
// Diagnostic only: an opt-in paused native video, never a playback/cache mode.
function create(video, options){
  let pending=null,closed=false,last=null;
  const schedule=options.setTimeout||setTimeout,unschedule=options.clearTimeout||clearTimeout;
  function cancel(){if(!pending)return;const p=pending;pending=null;unschedule(p.timer);
    if(p.callback!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(p.callback);
    video.removeEventListener('loadedmetadata',p.start);video.removeEventListener('error',p.error);p.resolve({cancelled:true});}
  function seek(time,end){
    if(closed)return Promise.resolve({cancelled:true});
    if(!Number.isFinite(time)||!Number.isFinite(end)||end<=time)return Promise.reject(Error('原视频参考时间区间不明'));
    const wasPending=!!pending;cancel();video.style.visibility='hidden';video.pause();
    if(typeof video.requestVideoFrameCallback!=='function')return Promise.reject(Error('此宿主无法核对原视频实际显示时间，未冒充同帧'));
    if(!wasPending&&last&&Math.abs(last.time-time)<1e-7&&video.seeking!==true&&Number.isFinite(video.currentTime)&&
      video.currentTime>=time-(options.origin||0)&&video.currentTime<end-(options.origin||0)){video.style.visibility='visible';return Promise.resolve(last);}
    last=null; // Any different/incomplete seek invalidates the previously shown frame.
    return new Promise((resolve,reject)=>{const p={resolve,reject,callback:null,timer:null,start:null,error:null};pending=p;
      function finish(error,result){if(pending!==p)return;pending=null;unschedule(p.timer);video.removeEventListener('loadedmetadata',p.start);video.removeEventListener('error',p.error);
        if(p.callback!==null)video.cancelVideoFrameCallback(p.callback);if(error)reject(error);else{last=result;video.style.visibility='visible';resolve(result);}}
      p.error=()=>finish(Error('原视频参考解码失败；不代表缓存播放失败'));
      p.start=()=>{if(pending!==p)return;video.removeEventListener('loadedmetadata',p.start);
        const receive=(_now,metadata)=>{p.callback=null;if(pending!==p)return;
          const actual=metadata.mediaTime+(options.origin||0);
          if(Math.abs(actual-time)<=.00001){finish(null,{time,actual,method:'requestVideoFrameCallback.mediaTime',sameFrame:true});return;}
          // A queued callback can still report the pre-seek frame. Keep waiting
          // for the requested picture; a deadline reports unknown, not success.
          p.callback=video.requestVideoFrameCallback(receive);
        };
        p.callback=video.requestVideoFrameCallback(receive);
        try{video.currentTime=Math.max(0,time-(options.origin||0)+Math.min((end-time)/4,.001));}catch(e){finish(e);}
      };
      p.timer=schedule(()=>finish(Error('原视频同帧参考尚未就绪；本次颜色对照未成立')),5000);
      video.addEventListener('error',p.error);if(video.readyState>=1)p.start();else video.addEventListener('loadedmetadata',p.start);
    });
  }
  function dispose(){if(closed)return;closed=true;cancel();last=null;video.pause();video.removeAttribute('src');video.load();video.style.visibility='hidden';}
  return {seek,dispose};
}
function render(video,ref,width,height){
  if(ref.width!==width)ref.width=width;if(ref.height!==height)ref.height=height;
  const ctx=ref.getContext('2d',{alpha:false,colorSpace:'srgb'});
  ctx.fillStyle='black';ctx.fillRect(0,0,width,height);
  const scale=Math.min(width/video.videoWidth,height/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;
  ctx.drawImage(video,(width-w)/2,(height-h)/2,w,h);
  return ctx.getImageData(0,0,width,height).data;
}
function compare(video,canvas,document){
  const ref=document.createElement('canvas'),width=canvas.width,height=canvas.height;
  const pixels=render(video,ref,width,height);
  const a=pixels,b=canvas.getContext('2d').getImageData(0,0,width,height).data;
  const hist=new Uint32Array(256),delta=[0,0,0];let sum=0;
  for(let i=0;i<a.length;i+=4)for(let c=0;c<3;c++){const d=b[i+c]-a[i+c];sum+=Math.abs(d);hist[Math.abs(d)]++;delta[c]+=d;}
  let n=0,p95=0;for(;p95<255;p95++){n+=hist[p95];if(n>=width*height*3*.95)break;}
  ref.width=ref.height=1;
  return {width,height,mae:sum/(width*height*3),p95,meanDelta:delta.map(x=>x/(width*height)),canvasColorSpace:canvas.getContext('2d').getContextAttributes?.().colorSpace||'unreported',
    scope:'Same reported mediaTime; native video drawn to sRGB Canvas vs cached Canvas. Scaling/chroma/JPEG differ; no raw pixels saved, not monitor calibration or HDR validation.'};
}
module.exports={create,compare,render};
