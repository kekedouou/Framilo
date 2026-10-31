'use strict';
const fs=require('fs');
const EXTENSIONS=Object.freeze(['mp4','m4v','mov','mkv','webm','avi','ts','mts','m2ts','mpeg','mpg','3gp','flv','f4v','wmv','ogv','rm','rmvb','av1','hevc','vp8','vp9']);
const CONTAINERS=Object.freeze(['mov','mp4','m4a','3gp','3g2','mj2','matroska','webm','avi','mpegts','mpeg','flv','asf','ogg','rm','av1','obu','hevc','ivf']);
const sourceExt=p=>require('path').extname(p).slice(1).toLowerCase();
const nativeContainer=file=>['mp4','m4v','mov','3gp'].includes(sourceExt(file));
function probeDuration(exe,file,signal){return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(Object.assign(Error('准备已取消。'),{name:'AbortError',code:'MEDIA_CANCELLED'}));return;}
 const child=require('child_process').spawn(exe,['-v','error','-show_entries','format=duration','-of','json',file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let data='',tail='',failure=null;const stop=e=>{failure=failure||e;child.kill();},abort=()=>stop(Object.assign(Error('准备已取消。'),{name:'AbortError',code:'MEDIA_CANCELLED'}));
 const timer=setTimeout(()=>stop(Error('读取视频时长超时。')),30000);signal?.addEventListener('abort',abort,{once:true});
 child.stdout.on('data',d=>{if(data.length+d.length>65536)stop(Error('时长信息超过上限。'));else data+=d;});child.stderr.on('data',d=>{tail=(tail+d).slice(-1024);});
 child.on('error',e=>{failure=e;});child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure||code!==0){reject(failure||Error('读取视频时长失败：'+tail));return;}try{resolve(JSON.parse(data));}catch(e){reject(e);}});
 });}
function accepts(file,declared){const ext=sourceExt(file);return EXTENSIONS.includes(ext)&&(declared==null||String(declared).replace(/^\./,'').toLowerCase()===ext);}
function proxyEstimate(width,height,frames){return{low:Math.ceil(width*height*frames*.03),high:Math.ceil(width*height*frames*.25)};}
function largeProxy(spec,limit){const estimate=proxyEstimate(spec.width,spec.height,spec.sourcePts.length);return{...estimate,confirm:spec.duration>=600&&estimate.high>=1024**3||estimate.high>=Math.max(1024**3,limit/2)};}
function createJpegGate(){const accepted=new Set();return async function(source,settings,tools){
 if(!settings.requestDecision)return;const s=await fs.promises.stat(source.filePath),key=[source.filePath,s.size,s.mtimeMs,settings.previewQuality].join('|');if(accepted.has(key))return;
 const p=await probeDuration(tools.ffprobe,source.filePath,settings.signal);
 if(Number(p.format?.duration)<=120||!Number.isFinite(Number(p.format?.duration)))return;
 const canProxy=nativeContainer(source.filePath);
 const answer=await settings.requestDecision({kind:'jpeg-long',title:'准备较长的JPEG序列',body:'视频超过2分钟。首次准备需处理整片，可能等待较久并占用较多磁盘；已有完整缓存则直接复用。'+(canProxy?'可继续，或改用能先播放原片的代理模式。':'此格式暂用JPEG兼容播放。'),choices:[{value:'continue',label:'继续JPEG'},...(canProxy?[{value:'proxy',label:'改用代理'}]:[])]});
 if(answer!=='continue')throw Object.assign(Error('已取消JPEG准备。'),{name:'AbortError',code:'MEDIA_CANCELLED'});
 if(accepted.size>=64)accepted.delete(accepted.values().next().value);accepted.add(key);
 };}
module.exports={EXTENSIONS,CONTAINERS,accepts,sourceExt,nativeContainer,proxyEstimate,largeProxy,createJpegGate};
