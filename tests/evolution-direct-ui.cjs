'use strict';
// Actual toolbar/lifecycle source, simulated DOM/video, controlled bridge.
// These are UI models, never real Eagle color or GPU-route verification.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),{EventEmitter}=require('events');
const actual=require('../prototypes/preview-quality/direct-display.cjs'),display=require('../prototypes/preview-quality/display-output.cjs');
function harness(options={}){
  const videos=[],panels=[],events={},rows=[],timers=new Set(),bridges=[],trace=[];
  let selected={id:'one',name:'中文 空格',filePath:'D:/one.mp4',ext:'mp4'},stops=0,closedRecords=0,frameClosed=0,saveCalls=0,saveFailures=options.saveFailures||0;
  let releaseSelection,releaseStop;const selection=options.deferSelection?new Promise(r=>releaseSelection=r):null,stopGate=options.deferStop?new Promise(r=>releaseStop=r):null;
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.style={};this.map={};this.disabled=false;this.width=1;this.height=1;this.draws=0;
      this.context={fillRect(){},drawImage:v=>{this.draws++;this.lastVideo=v;trace.push('draw');},getContextAttributes:()=>({colorSpace:'srgb',alpha:false}),
        getImageData(){throw Error('Display UI must not read pixels');}};}
    set innerHTML(html){this.html=html;for(const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){
      const e=match[1]==='video'?video():new Element(match[1]);this.map['#'+match[2]]=e;}}
    querySelector(id){assert(this.map[id],'Missing UI element '+id);return this.map[id];}
    getContext(){return this.context;}
    remove(){this.removed=true;}
  }
  function video(){
    const v=new EventEmitter(),callbacks=new Map(),callbackHistory=[];let next=0,src='';
    Object.assign(v,{style:{},readyState:0,videoWidth:1920,videoHeight:1080,duration:9,currentTime:0,seeking:false,
      paused:true,srcObject:null,loads:0,pause(){this.paused=true;},load(){this.loads++;this.readyState=0;trace.push('load:'+this.src);},removeAttribute(name){if(name==='src')this.src='';},
      addEventListener:v.on.bind(v),removeEventListener:v.off.bind(v),requestVideoFrameCallback(fn){callbacks.set(++next,fn);callbackHistory.push(fn);return next;},
      cancelVideoFrameCallback(id){callbacks.delete(id);},callbacks,callbackHistory});
    Object.defineProperty(v,'src',{get:()=>src,set:value=>{src=value;trace.push('src:'+value);}});videos.push(v);return v;
  }
  class Frame{
    constructor(v){this.format=v.srcObject?'I420':'NV12';this.codedWidth=this.displayWidth=v.videoWidth;this.codedHeight=this.displayHeight=v.videoHeight;
      this.timestamp=Math.round(v.currentTime*1e6);this.colorSpace={toJSON:()=>({matrix:'bt709',primaries:'bt709',transfer:'bt709',fullRange:false})};}
    close(){frameClosed++;}
  }
  function bridge(canvas,v,settings){
    assert.strictEqual(v.src,'','Clear source before attaching stream');assert.strictEqual(v.srcObject,null);assert.strictEqual(v.callbacks.size,0);
    trace.push('bridge');let resolve,reject,settled=false;const stream={owned:true};v.srcObject=stream;
    const entry={canvas,video:v,settings,cancelled:false,ready:new Promise((r,j)=>{resolve=r;reject=j;}),
      finish(value={actualMediaTime:0,cacheEncoding:false,pixelReadback:false,targetSourcePtsVerified:false}){if(!settled){settled=true;resolve(value);}},
      fail(){if(!settled){settled=true;reject(Error('Model bridge failed'));}},
      cancel(){this.cancelled=true;if(v.srcObject===stream)v.srcObject=null;if(!settled){settled=true;resolve({cancelled:true});}}};
    entry.ready.catch(()=>{});bridges.push(entry);return entry;
  }
  const body={style:{},prepend(e){this.bar=e;},append(e){panels.push(e);}};
  const win={VideoFrame:Frame,getComputedStyle:v=>({mixBlendMode:v.style.mixBlendMode}),addEventListener:(name,fn)=>events[name]=fn,
    EVAEvolutionClose:async()=>{stops++;if(stopGate)await stopGate;return {status:'closed'};},EVAEvolutionRun:async()=>{},EVADiagnostics:{snapshot:()=>null}};
  const req=id=>{
    if(id==='path'||id==='url')return require(id);
    if(id.endsWith('eagle.cjs'))return {captureSelected:async()=>{if(selection)await selection;return {...selected};}};
    if(id.endsWith('workspace.cjs'))return {identity:()=>({same:true}),hashFile:file=>file.endsWith('one.mp4')?'1'.repeat(64):'2'.repeat(64)};
    if(id.endsWith('direct-display.cjs'))return {firstFrame:(v,c,o)=>actual.firstFrame(v,c,{...o,setTimeout:fn=>{timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn)})};
    if(id.endsWith('display-output.cjs'))return {describeFrame:display.describeFrame,describeCanvas:display.describeCanvas,bridge};
    if(id.endsWith('check-recorder.cjs'))return {create:()=>({save:value=>{saveCalls++;if(saveFailures){saveFailures--;throw Error('Model record budget unavailable');}rows.push(value);return {};},close:()=>closedRecords++})};
    throw Error('Unexpected dependency; no codec/cache/observer allowed: '+id);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../prototypes/preview-quality/observer-browser.js'),'utf8'),{
    require:req,document:{createElement:tag=>new Element(tag),body},window:win,eagle:{onPluginCreate:fn=>fn({path:'D:/repo/prototypes/preview-quality/scratch/host'})},process:{versions:{node:'model',chrome:'model'}}});
  const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
  return {body,win,events,rows,videos,panels,timers,bridges,trace,flush,releaseSelection:()=>releaseSelection(),releaseStop:()=>releaseStop(),setSelected:value=>selected=value,
    stops:()=>stops,closedRecords:()=>closedRecords,frameClosed:()=>frameClosed,saveCalls:()=>saveCalls,open:()=>body.bar.querySelector('#evDirect').onclick(),
    mode(value){const e=panels.at(-1).querySelector('#evDirectMode');e.value=value;return e.onchange();},
    metadata(){const v=videos.at(-1);v.readyState=2;v.emit('loadedmetadata');},
    frame(time=0){const v=videos.at(-1),entry=v.callbacks.entries().next().value;assert(entry,'Expected actual-frame callback model');const[id,fn]=entry;v.callbacks.delete(id);v.currentTime=time;fn(0,{mediaTime:time});}};
}
async function loaded(h,time=0){const pending=h.open();await h.flush();h.metadata();h.frame(time);await pending;return h.panels.at(-1);}
(async()=>{
  let count=0,h=harness(),panel=await loaded(h),v=h.videos[0],canvas=panel.querySelector('#evDirectCanvas'),mode=panel.querySelector('#evDirectMode');
  assert.strictEqual(h.stops(),1);assert.strictEqual(h.rows.length,1);assert.strictEqual(h.rows[0].kind,'native-display-output-v1');
  assert.strictEqual(h.rows[0].mode,'source');assert.strictEqual(h.rows[0].sourceFrame.cacheEncoding,false);assert.strictEqual(h.rows[0].sourceFrame.pixelReadback,false);
  assert.strictEqual(h.rows[0].physicalDisplayMeasured,false);assert.strictEqual(h.rows[0].actualOverlayRoute,'unobserved');assert.strictEqual(h.rows[0].userVisualResult,'pending');
  assert.strictEqual(h.rows[0].decodedFrame.colorSpace.matrix,'bt709');assert.strictEqual(h.frameClosed(),1);
  assert.strictEqual(h.rows[0].sourceSha256,'1'.repeat(64));assert(!JSON.stringify(h.rows).includes('D:/one.mp4'));assert(!JSON.stringify(h.rows).includes('中文'));
  assert.strictEqual(canvas.style.visibility,'visible');assert.strictEqual(v.style.visibility,'visible');assert.strictEqual(h.timers.size,0);count++;
  const source=v.src,loads=v.loads,draws=canvas.draws,width=canvas.width;
  await h.mode('composite');assert.strictEqual(h.videos.length,1);assert.strictEqual(v.src,source);assert.strictEqual(v.loads,loads);
  assert.strictEqual(canvas.draws,draws);assert.strictEqual(canvas.width,width);assert.strictEqual(v.currentTime,0);assert.strictEqual(v.style.mixBlendMode,'multiply');
  assert.strictEqual(panel.querySelector('#evDirectBackdrop').style.isolation,'isolate');assert.strictEqual(h.rows.at(-1).sourcePtsPreserved,0);
  await h.mode('source');assert.strictEqual(v.loads,loads);assert.strictEqual(canvas.draws,draws);assert.strictEqual(v.style.mixBlendMode,'normal');count++;
  let pending=h.mode('bridge');await h.flush();assert.strictEqual(h.bridges.length,1);assert.strictEqual(v.src,'');assert(v.srcObject);
  assert.strictEqual(mode.disabled,true);assert.strictEqual(h.rows.at(-1).mode,'source');assert.strictEqual(canvas.draws,1);
  h.bridges[0].finish();await pending;assert.strictEqual(h.rows.at(-1).mode,'bridge');assert.strictEqual(v.style.visibility,'visible');assert.strictEqual(mode.disabled,false);
  assert.strictEqual(h.rows.at(-1).stream.targetSourcePtsVerified,false);count++;
  const rowsBefore=h.rows.length;pending=h.mode('source');await h.flush();assert(h.bridges[0].cancelled);assert.strictEqual(v.srcObject,null);
  assert.strictEqual(v.src,source);assert.strictEqual(h.rows.length,rowsBefore);assert.strictEqual(v.callbacks.size,0);
  h.metadata();assert.strictEqual(v.callbacks.size,1);assert.strictEqual(h.rows.length,rowsBefore);h.frame();await pending;
  assert.strictEqual(h.rows.at(-1).mode,'source');assert.strictEqual(h.rows.at(-1).sourcePtsPreserved,0);assert.strictEqual(canvas.draws,2);count++;
  h.setSelected({id:'two',name:'另一个视频',filePath:'D:/two.mp4',ext:'mp4'});panel.querySelector('#evDirectSelect').onclick();await h.flush();
  assert(panel.removed);assert.strictEqual(v.src,'');assert.strictEqual(canvas.width,1);assert.strictEqual(h.videos.length,2);
  h.metadata();h.frame();await h.flush();assert.strictEqual(h.rows.at(-1).sourceSha256,'2'.repeat(64));
  h.events.pagehide();await h.flush();assert(h.panels[1].removed);assert.strictEqual(h.videos[1].src,'');assert.strictEqual(h.closedRecords(),1);count++;
  h=harness();pending=h.open();await h.flush();h.metadata();const late=h.videos[0].callbackHistory.at(-1);
  await h.win.EVAEvolutionBeforeRun();await pending;late(0,{mediaTime:0});
  assert.strictEqual(h.rows.length,0);assert.strictEqual(h.videos[0].callbacks.size,0);assert.strictEqual(h.timers.size,0);assert.strictEqual(h.videos[0].src,'');
  assert.strictEqual(h.panels[0].querySelector('#evDirectCanvas').draws,0);assert.strictEqual(h.body.bar.querySelector('#evDirect').disabled,false);count++;
  h=harness();panel=await loaded(h);pending=h.mode('bridge');await h.flush();const bridge=h.bridges[0];
  await h.win.EVAEvolutionBeforeRun();bridge.finish();await pending;
  assert(bridge.cancelled);assert.strictEqual(h.rows.length,1);assert(panel.removed);assert.strictEqual(h.videos[0].srcObject,null);assert.strictEqual(panel.querySelector('#evDirectCanvas').width,1);count++;
  h=harness();panel=await loaded(h);pending=h.mode('bridge');await h.flush();h.setSelected({id:'two',name:'二',filePath:'D:/two.mp4',ext:'mp4'});
  panel.querySelector('#evDirectSelect').onclick();await h.flush();h.bridges[0].finish();await pending;
  assert(h.bridges[0].cancelled);assert(panel.removed);assert.strictEqual(h.videos.length,2);h.metadata();h.frame();await h.flush();
  assert.strictEqual(h.rows.length,2);assert.strictEqual(h.rows.at(-1).sourceSha256,'2'.repeat(64));await h.win.EVAEvolutionBeforeRun();count++;
  h=harness();panel=await loaded(h);pending=h.mode('bridge');await h.flush();h.bridges[0].fail();await pending;
  assert(panel.querySelector('#evDirectMessage').textContent.includes('未成立'));assert.strictEqual(panel.querySelector('#evDirectMode').disabled,false);
  assert.strictEqual(h.videos[0].srcObject,null);assert.strictEqual(h.rows.at(-1).failure,'display-mode-failed');
  pending=h.mode('source');await h.flush();h.metadata();h.frame();await pending;assert.strictEqual(h.videos[0].style.visibility,'visible');
  assert.strictEqual(h.rows.at(-1).mode,'source');await h.win.EVAEvolutionBeforeRun();count++;
  h=harness();panel=await loaded(h);pending=h.mode('bridge');await h.flush();h.bridges[0].finish();await pending;
  pending=h.mode('source');await h.flush();h.metadata();h.frame(.25);await pending;
  assert(panel.querySelector('#evDirectMessage').textContent.includes('重载首帧不一致'));assert.strictEqual(h.videos[0].style.visibility,'hidden');
  assert.strictEqual(h.rows.at(-1).failure,'display-mode-failed');await h.win.EVAEvolutionBeforeRun();count++;
  h=harness({saveFailures:1});panel=await loaded(h);assert.strictEqual(h.rows.length,0);assert.strictEqual(h.saveCalls(),1);
  assert(panel.querySelector('#evDirectMessage').textContent.includes('记录未保存'));assert.strictEqual(panel.querySelector('#evDirectCanvas').style.visibility,'visible');
  assert.strictEqual(h.videos[0].style.visibility,'visible');assert.strictEqual(h.videos[0].src.startsWith('file:'),true);
  await h.mode('composite');assert.strictEqual(h.rows.length,1);assert.strictEqual(h.rows[0].mode,'composite');await h.win.EVAEvolutionBeforeRun();count++;
  h=harness();panel=await loaded(h);for(let i=0;i<18;i++)await h.mode(i%2?'source':'composite');
  assert.strictEqual(h.rows.length,12);assert.strictEqual(h.saveCalls(),12);assert.strictEqual(panel.querySelector('#evDirectMode').disabled,false);
  assert.strictEqual(h.videos[0].style.visibility,'visible');assert.strictEqual(panel.querySelector('#evDirectCanvas').draws,1);await h.win.EVAEvolutionBeforeRun();count++;
  for(const error of ['decode','timeout']){
    h=harness();pending=h.open();await h.flush();if(error==='decode')h.videos[0].emit('error');else [...h.timers][0]();await pending;
    assert.strictEqual(h.rows.length,1);assert.strictEqual(h.rows[0].failure,'display-mode-failed');assert.strictEqual(h.videos[0].src,'');
    assert(h.panels[0].querySelector('#evDirectMessage').textContent.includes(error==='decode'?'解码失败':'超时'));
    assert.strictEqual(h.timers.size,0);assert.strictEqual(h.videos[0].listenerCount('error'),0);
    pending=h.mode('source');await h.flush();h.metadata();h.frame();await pending;assert.strictEqual(h.rows.at(-1).mode,'source');
    await h.win.EVAEvolutionBeforeRun();count++;
  }
  h=harness({deferSelection:true});pending=h.open();await h.flush();h.events.pagehide();h.releaseSelection();await pending;
  assert.strictEqual(h.panels.length,0);assert.strictEqual(h.videos.length,0);assert.strictEqual(h.rows.length,0);assert.strictEqual(h.stops(),0);count++;
  h=harness({deferStop:true});pending=h.open();await h.flush();assert.strictEqual(h.stops(),1);h.events.pagehide();h.releaseStop();await pending;
  assert.strictEqual(h.panels.length,0);assert.strictEqual(h.videos.length,0);assert.strictEqual(h.rows.length,0);count++;
  console.log('direct display toolbar: '+count+' actual-source UI/lifecycle models passed; simulated DOM and controlled bridge, not Eagle colors or GPU-route verification');
})().catch(e=>{console.error(e);process.exitCode=1;});
