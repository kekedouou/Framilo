'use strict';
// Exercise the actual experimental toolbar and lifecycle with simulated DOM/video.
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm'),{EventEmitter}=require('events');
const actual=require('../prototypes/preview-quality/direct-display.cjs');
function harness(options={}){
  const videos=[],panels=[],events={},rows=[],timers=new Set();let selected={id:'one',name:'中文 空格',filePath:'D:/one.mp4',ext:'mp4'},stops=0,closedRecords=0;
  let releaseSelection,releaseStop;const selection=options.deferSelection?new Promise(r=>releaseSelection=r):null,stopGate=options.deferStop?new Promise(r=>releaseStop=r):null;
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.style={};this.map={};this.disabled=false;this.width=1;this.height=1;}
    set innerHTML(html){this.html=html;for(const match of html.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g)){
      const e=match[1]==='video'?video():new Element(match[1]);this.map['#'+match[2]]=e;}}
    querySelector(id){assert(this.map[id],'Missing UI element '+id);return this.map[id];}
    getContext(){return {fillRect(){},drawImage(v){this.lastVideo=v;},getContextAttributes(){return {colorSpace:'srgb'};}};}
    remove(){this.removed=true;}
  }
  function video(){
    const v=new EventEmitter(),callbacks=new Map();let next=0;Object.assign(v,{style:{},readyState:0,videoWidth:1920,videoHeight:1080,duration:9,currentTime:0,seeking:false,
      paused:true,src:'',loads:0,pause(){this.paused=true;},load(){this.loads++;},removeAttribute(name){if(name==='src')this.src='';},
      addEventListener:v.on.bind(v),removeEventListener:v.off.bind(v),requestVideoFrameCallback(fn){callbacks.set(++next,fn);return next;},cancelVideoFrameCallback(id){callbacks.delete(id);},callbacks});videos.push(v);return v;
  }
  const body={style:{},prepend(e){this.bar=e;},append(e){panels.push(e);}};
  const win={addEventListener:(name,fn)=>events[name]=fn,EVAEvolutionClose:async()=>{stops++;if(stopGate)await stopGate;return {status:'closed'};},EVAEvolutionRun:async()=>{},EVADiagnostics:{snapshot:()=>null}};
  const req=id=>{
    if(id==='path'||id==='url')return require(id);
    if(id.endsWith('eagle.cjs'))return {captureSelected:async()=>{if(selection)await selection;return {...selected};}};
    if(id.endsWith('workspace.cjs'))return {identity:()=>({same:true}),hashFile:file=>file.endsWith('one.mp4')?'1'.repeat(64):'2'.repeat(64)};
    if(id.endsWith('direct-display.cjs'))return {firstFrame:(v,c,o)=>actual.firstFrame(v,c,{...o,setTimeout:fn=>{timers.add(fn);return fn;},clearTimeout:fn=>timers.delete(fn)})};
    if(id.endsWith('check-recorder.cjs'))return {create:()=>({save:value=>{rows.push(value);return {};},close:()=>closedRecords++})};
    throw Error('Unexpected dependency; no codec/cache/observer allowed: '+id);
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../prototypes/preview-quality/observer-browser.js'),'utf8'),{
    require:req,document:{createElement:tag=>new Element(tag),body},window:win,eagle:{onPluginCreate:fn=>fn({path:'D:/repo/prototypes/preview-quality/scratch/host'})},process:{versions:{node:'model',chrome:'model'}}});
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  return {body,win,events,rows,videos,panels,timers,flush,releaseSelection:()=>releaseSelection(),releaseStop:()=>releaseStop(),setSelected:value=>selected=value,stops:()=>stops,closedRecords:()=>closedRecords,
    open:()=>body.bar.querySelector('#evDirect').onclick(),
    metadata(){const v=videos.at(-1);v.readyState=2;v.emit('loadedmetadata');},
    frame(time=0){const v=videos.at(-1),[id,fn]=v.callbacks.entries().next().value;v.callbacks.delete(id);fn(0,{mediaTime:time});}};
}
(async()=>{
  let h=harness(),pending=h.open();await h.flush();assert.strictEqual(h.videos.length,1);assert.strictEqual(h.rows.length,0);assert(h.videos[0].src.startsWith('file:'));
  assert.strictEqual(h.videos[0].callbacks.size,0);h.metadata();h.frame();await pending;
  assert.strictEqual(h.stops(),1);assert.strictEqual(h.rows.length,1);assert.strictEqual(h.rows[0].kind,'native-direct-canvas-v1');
  assert.strictEqual(h.rows[0].cacheEncoding,false);assert.strictEqual(h.rows[0].pixelReadback,false);assert.strictEqual(h.rows[0].userVisualResult,'pending');
  assert.strictEqual(h.rows[0].sourceSha256,'1'.repeat(64));assert(!JSON.stringify(h.rows).includes('D:/one.mp4'));assert(!JSON.stringify(h.rows).includes('中文'));
  assert.strictEqual(h.panels[0].querySelector('#evDirectCanvas').style.visibility,'visible');assert.strictEqual(h.timers.size,0);
  h.setSelected({id:'two',name:'另一个视频',filePath:'D:/two.mp4',ext:'mp4'});h.panels[0].querySelector('#evDirectSelect').onclick();await h.flush();
  assert(h.panels[0].removed);assert.strictEqual(h.videos[0].src,'');assert.strictEqual(h.panels[0].querySelector('#evDirectCanvas').width,1);
  assert.strictEqual(h.videos.length,2);h.metadata();h.frame();await h.flush();assert.strictEqual(h.rows.length,2);assert.strictEqual(h.rows[1].sourceSha256,'2'.repeat(64));
  h.events.pagehide();await h.flush();assert(h.panels[1].removed);assert.strictEqual(h.videos[1].src,'');assert.strictEqual(h.closedRecords(),1);

  h=harness();pending=h.open();await h.flush();h.metadata();assert.strictEqual(h.videos[0].callbacks.size,1);
  await h.win.EVAEvolutionBeforeRun();await pending;assert.strictEqual(h.rows.length,0);assert.strictEqual(h.videos[0].callbacks.size,0);assert.strictEqual(h.timers.size,0);assert.strictEqual(h.videos[0].src,'');
  assert.strictEqual(h.body.bar.querySelector('#evDirect').disabled,false);

  h=harness();pending=h.open();await h.flush();h.videos[0].emit('error');await pending;assert.strictEqual(h.rows.length,0);assert.strictEqual(h.videos[0].src,'');
  assert(h.panels[0].querySelector('#evDirectInfo').textContent.includes('未成立'));assert.strictEqual(h.timers.size,0);await h.win.EVAEvolutionBeforeRun();

  h=harness();pending=h.open();await h.flush();[...h.timers][0]();await pending;assert.strictEqual(h.rows.length,0);assert.strictEqual(h.videos[0].src,'');
  assert(h.panels[0].querySelector('#evDirectInfo').textContent.includes('超时'));assert.strictEqual(h.videos[0].listenerCount('error'),0);await h.win.EVAEvolutionBeforeRun();

  h=harness({deferSelection:true});pending=h.open();await h.flush();h.events.pagehide();h.releaseSelection();await pending;
  assert.strictEqual(h.panels.length,0);assert.strictEqual(h.videos.length,0);assert.strictEqual(h.rows.length,0);assert.strictEqual(h.stops(),0);
  h=harness({deferStop:true});pending=h.open();await h.flush();assert.strictEqual(h.stops(),1);h.events.pagehide();h.releaseStop();await pending;
  assert.strictEqual(h.panels.length,0);assert.strictEqual(h.videos.length,0);assert.strictEqual(h.rows.length,0);
  console.log('direct display toolbar: actual experimental wiring, selected source change, setup receipt, joined close/pagehide, decode/timeout cleanup; simulated DOM, not Eagle colors');
})().catch(e=>{console.error(e);process.exitCode=1;});
