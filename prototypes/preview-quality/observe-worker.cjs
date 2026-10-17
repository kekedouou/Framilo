'use strict';
// No playback control. Raw native identities remain transient; only roles/numbers persist.
const cp=require('child_process'),{performance}=require('perf_hooks');
const {store,LIMITS}=require('./workspace.cjs');
const ROLES=new Set(['renderer','task-guard','task-worker','console-host','system-helper','ffmpeg','ffprobe','observer','observer-child','owned-unclassified']);
function redactNative(row){
  if(!row||row.schema!=='mvp-process-sample-v1'||!Array.isArray(row.processes)||row.processes.length>64||!Array.isArray(row.errors))throw Error('Invalid native sample');
  const roles={};for(const p of row.processes){if(!ROLES.has(p.role)||!Number.isSafeInteger(p.rssBytes)||p.rssBytes<0)throw Error('Invalid native process');
    const r=roles[p.role]||(roles[p.role]={count:0,rssBytes:0});r.count++;r.rssBytes+=p.rssBytes;}
  return {schema:'eva-natural-native-v1',atMs:row.atMs,sampleDurationMs:row.sampleDurationMs,roles,errorCount:row.errors.length,
    liveRenderer:row.roots.some(r=>r.role==='renderer'&&r.alive)};
}
function validateSample(value){
  if(!value||value.schema!=='eva-natural-sample-v1')throw Error('Invalid browser observation sample');
  const allowed=['schema','atMs','state','epoch','frameCount','drawCount','managedBytes','managedLimit','imageTasks','compressedBytes','compressedFrames','rss','heapUsed','external','arrayBuffers'];
  if(Object.keys(value).some(k=>!allowed.includes(k))||allowed.some(k=>!(k in value)))throw Error('Unexpected observation fields');
  for(const k of allowed)if(!['schema','state'].includes(k)&&value[k]!==null&&(!Number.isFinite(value[k])||value[k]<0))throw Error('Invalid observation number');
  if(!/^[a-z]{1,15}$/.test(value.state))throw Error('Invalid observation state');return value;
}
async function run(argv){
  if(![3,4].includes(argv.length)||!/^\d+$/.test(argv[0])||!/^\d{16,20}$/.test(argv[1])||argv[3]&&!['quality','natural'].includes(argv[3]))throw Error('Explicit renderer identity required');
  const scope=argv[3]||'natural',kind=scope==='quality'?'quality-clip-observation':'natural-use';
  const records=store(), receipts=[];let writer=records.writer(kind),bytes=0,stopping=false,issue=null,lastWindow=null,pipe='',nativePipe='',nativeRows=0,windowRows=0;
  const started=performance.now();const peaks={plugin:0,preprocessing:0,observer:0,managed:0};let metrics=null;
  function write(value){const size=Buffer.byteLength(JSON.stringify(value))+1;
    if(size>LIMITS.line)throw Error('Observation line too large');
    if(bytes+size>LIMITS.slot-4096){receipts.push(writer.close());writer=records.writer(kind);bytes=0;}
    writer.append(value);bytes+=size;
  }
  // Explicit observer root keeps helper memory separate from product RSS.
  const sampler=cp.spawn(require('../../scripts/build-resource-sampler.cjs').verify(),['1000','3900000',argv[0],argv[1],'renderer',argv[2],String(process.pid),'parent','observer',process.execPath],
    {windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  const samplerDone=new Promise(resolve=>{sampler.once('error',e=>{issue=e.message;resolve();});sampler.once('close',code=>{if(!stopping)issue=issue||'Native observation ended before explicit stop';if(code!==0)issue=issue||'Native observation exit failure';resolve();});});
  let deadline=null;
  function stop(reason){if(reason&&!issue)issue=reason;if(!stopping){stopping=true;sampler.stdin.end();deadline=setTimeout(()=>{issue=issue||'Native observer shutdown deadline';sampler.kill();},5000);}}
  sampler.stdout.on('data',b=>{nativePipe+=b.toString('utf8');let at;
    try{while((at=nativePipe.indexOf('\n'))>=0){const row=redactNative(JSON.parse(nativePipe.slice(0,at)));nativePipe=nativePipe.slice(at+1);nativeRows++;
      let plugin=0,preprocessing=0,observer=0;for(const [role,r]of Object.entries(row.roles)){
        if(role==='observer'||role==='observer-child')observer+=r.rssBytes;else if(role==='ffmpeg'||role==='ffprobe')preprocessing+=r.rssBytes;else plugin+=r.rssBytes;}
      peaks.plugin=Math.max(peaks.plugin,plugin);peaks.preprocessing=Math.max(peaks.preprocessing,preprocessing);peaks.observer=Math.max(peaks.observer,observer);
      write({...row,context:lastWindow?{epoch:lastWindow.epoch,state:lastWindow.state}:null});
      process.stdout.write(JSON.stringify({state:'resources',pluginBytes:row.liveRenderer?plugin:null,preprocessingBytes:row.liveRenderer?preprocessing:null,observerBytes:observer})+'\n');
      if(!row.liveRenderer)stop('Renderer identity not observed; process memory unknown; playback is unaffected');
      if(row.errorCount||row.roles['owned-unclassified'])stop('Observation incomplete; playback is unaffected');
      if(plugin>=1.5*1024**3)stop('Natural observation reached baseline RSS line; playback is unaffected');
    }if(nativePipe.length>65536)throw Error('Native observation line too large');}catch(e){stop(e.message);}});
  sampler.stderr.resume();sampler.stdin.on('error',()=>stop('Native observation input closed'));
  process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{pipe+=s;let at;
    try{while((at=pipe.indexOf('\n'))>=0){const x=JSON.parse(pipe.slice(0,at));pipe=pipe.slice(at+1);
      if(x.schema==='eva-natural-stop-v1'){metrics={ticks:x.ticks,maxProjectionMs:x.maxProjectionMs,projectionMs:x.projectionMs};stop();continue;}
      if(stopping)continue;lastWindow=validateSample(x);windowRows++;peaks.managed=Math.max(peaks.managed,x.managedBytes||0);write(x);
    }if(pipe.length>LIMITS.line)throw Error('Browser observation line too large');}catch(e){stop(e.message);}});
  process.stdin.on('end',()=>stop());
  process.stdout.write(JSON.stringify({state:'recording',intervalMs:1000})+'\n');
  await samplerDone;stopping=true;if(deadline)clearTimeout(deadline);
  try{write({schema:'eva-natural-end-v1',scope,elapsedMs:performance.now()-started,nativeRows,windowRows,peaks,metrics,issue,
    longTermPassed:false,limitation:'Only declared owned processes; shared Eagle/GPU excluded;1-second samples may miss peaks.'});}catch(e){issue=issue||e.message;}
  receipts.push(writer.close());process.stdout.write(JSON.stringify({state:'saved',issue,receipts,nativeRows,windowRows})+'\n');process.stdin.destroy();
  return {issue,nativeRows,windowRows,receipts};
}
if(require.main===module)run(process.argv.slice(2)).catch(e=>{process.stdout.write(JSON.stringify({state:'stopped',issue:e.message})+'\n');process.exitCode=1;});
module.exports={redactNative,validateSample,run};
