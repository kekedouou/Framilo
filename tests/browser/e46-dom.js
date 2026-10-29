/* E46 current settings and transient feedback. Session double, no files/media/Eagle. */
(async function(){
 'use strict';
 const $=id=>document.getElementById(id),q=s=>document.querySelector(s),checks=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(ok,text)=>{if(!ok)throw Error(text);checks.push(text);};let ui,failApply=false;
 const applied=[];
 const state={epoch:1,state:'paused',duration:10,playbackBackend:'proxy',gpuAcceleration:true,proxyDiskGiB:5,previewQuality:'720p',forwardPredecode:true,
  source:{id:'e46-dom-readonly',name:'E46 设置与提示 · 合成界面'},memorySettings:{ramMiB:512,ramBytes:512*1024**2},
  interactionSettings:{wheelFrames:1,showCacheStrip:false,rateStep:.1,drawingFadeSeconds:.25,drawingToolbar:false},
  playback:{time:2,frameId:60,frameOrdinal:60,frameCount:300,transport:{rate:1,loop:{valid:false}}},
  comments:{status:'ready',items:[],draft:null},drawings:{status:'ready',visible:true,records:[],styles:EVADrawingModel.defaultStyles(),draft:null}};
 const publish=()=>ui.update({...state,comments:{...state.comments},drawings:{...state.drawings},playback:state.playback?{...state.playback}:null});
 const session={setCommentsVisible(){},refreshComments:async()=>{},memorySnapshot:()=>null,timelineFrames:()=>[],
  async setPlaybackSettings(value){await sleep(30);if(failApply)throw Error('设置失败，旧配置仍保留。');applied.push({...value});state.gpuAcceleration=value.gpuAcceleration;publish();return{status:'applied'};},
  async clearOtherCaches(){await sleep(60);return{status:'cleared',cleared:2,freedBytes:1024**2,message:'已清除2个旧视频缓存。'};},
  async pause(){},async play(){},loopFrameAt(time,b={}){const ordinal=Math.max(b.minOrdinal??0,Math.min(b.maxOrdinal??299,b.ordinal??Math.floor(time*30)));return{ordinal,time:ordinal/30};}};
 const visible=n=>!!n&&!n.hidden&&getComputedStyle(n).display!=='none'&&n.getClientRects().length>0;
 try{
  localStorage.setItem('eva-graphite-guide','seen');ui=EVAUI.createUI();ui.bindSession(session);publish();await sleep(100);
  q('button[aria-label="设置"]').click();await sleep(220);q('[data-setting="display"]').click();await sleep(180);
  check(!visible($('gpuAcceleration')),'GPU acceleration is absent from the display submenu');
  q('[data-setting="advanced"]').click();await sleep(180);
  check(document.querySelectorAll('#gpuAcceleration').length===1&&visible($('gpuAcceleration'))&&$('gpuAcceleration').closest('.shell-settings-level'),'One GPU acceleration checkbox is visible only in Advanced');
  for(const id of ['autoProxy','proxyGenerate','proxyCancel','gpuDrawing','proxyEncoder','decoderPreference'])check(!visible($(id)),'Retired control is not displayed: '+id);
  check($('forwardPredecode').hidden&&!visible($('forwardPredecode'))&&$('forwardPredecode').checked,'Predecode is enabled internally without a visible setting');
  for(const id of ['memoryStatus','cacheClearStatus'])check($(id).closest('.shell-alerts')&&!$(id).closest('.shell-settings,.shell-settings-level'),'Feedback lives in lower-left shell alerts: '+id);
  $('gpuAcceleration').checked=false;$('memoryApply').click();await sleep(110);
  check(applied.length===1&&applied[0].gpuAcceleration===false&&applied[0].forwardPredecode===true,'Apply calls only the stub and carries unified GPU/predecode settings');
  check($('memoryStatus').textContent==='设置已保存。'&&$('memoryStatus').getAttribute('data-faded')!=='true','Settings success initially appears');
  await sleep(2300);check($('memoryStatus').getAttribute('data-faded')==='true','Settings success fades after 2200 ms');
  const oldRevision=$('memoryStatus').getAttribute('data-notice-revision');$('memoryApply').click();await sleep(110);
  check(applied.length===2&&$('memoryStatus').getAttribute('data-notice-revision')!==oldRevision&&$('memoryStatus').getAttribute('data-faded')!=='true','Repeated identical success receives a new lifetime');
  await sleep(2300);check($('memoryStatus').getAttribute('data-faded')==='true','Repeated identical success also fades');
  $('cacheClearOther').click();check($('cacheClearStatus').textContent.includes('正在清理'),'Cache cleanup immediately reports pending work');await sleep(150);
  check($('cacheClearStatus').textContent==='已清除2个旧视频缓存。','Cache cleanup completion is visible outside the settings panel');
  await sleep(2300);check($('cacheClearStatus').getAttribute('data-faded')==='true','Cache cleanup success fades');
  failApply=true;$('memoryApply').click();await sleep(110);check($('memoryStatus').textContent.includes('失败'),'Failed apply is reported');
  state.comments.message='还有未保存内容。';publish();await sleep(2300);
  check($('memoryStatus').getAttribute('data-faded')!=='true','Failure remains visible after the normal toast interval');
  check($('commentStatus').textContent==='还有未保存内容。'&&$('commentStatus').getAttribute('data-faded')!=='true','Unsaved content remains visible after the normal toast interval');
  state.playbackBackend='jpeg';state.state='preparing';state.playback=null;state.progress={stage:'decode',message:'正在生成JPEG序列',frames:37};publish();await sleep(50);
  const box=$('proxyState').getBoundingClientRect();check(visible($('proxyState'))&&$('proxyState').textContent.includes('37帧'),'JPEG preparation displays its live frame count');
  check(box.left<50&&box.bottom>innerHeight-130&&getComputedStyle($('proxyState')).position==='fixed','JPEG preparation feedback is anchored at the lower left');
  state.state='paused';state.playback={time:2,frameId:60,frameOrdinal:60,frameCount:300,transport:{rate:1,loop:{valid:false}}};publish();
  check(!visible($('proxyState')),'JPEG preparation feedback retires when the player becomes ready');
  const result=document.createElement('pre');result.id='drawing-results';result.hidden=true;result.textContent=JSON.stringify({passed:true,checks,scope:'Current formal UI in independent Chrome with Session double; no media/Eagle/files saved.'});document.body.append(result);
 }catch(e){const result=document.createElement('pre');result.id='drawing-results';result.hidden=true;result.textContent=JSON.stringify({passed:false,checks,error:e.stack});document.body.append(result);}
})();
