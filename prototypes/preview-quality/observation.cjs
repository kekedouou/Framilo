'use strict';
// Opt-in controller; sends one small numeric sample/second, never a trace array.
const path=require('path'),cp=require('child_process'),{performance}=require('perf_hooks');
const MAX=8192, STATES=new Set(['empty','loading','preparing','ready','paused','playing','seeking','error','closed','disposed']);
function number(n) { return typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null; }
function exactSelf(){
  // CIM CreationDate can truncate sub-microsecond birth ticks. Use the same
  // .NET/OS process birth source as the native observer, for this PID only.
  const query=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    "$ErrorActionPreference='Stop'; [Console]::Write([string](Get-Process -Id "+process.pid+").StartTime.ToUniversalTime().Ticks)"],
    {windowsHide:true,shell:false,encoding:'utf8',timeout:5000,maxBuffer:4096});
  const ticks=String(query.stdout||'').trim();
  if(query.error||query.status!==0||!/^\d{16,20}$/.test(ticks))throw Error('Cannot prove exact observation process identity');
  return {pid:process.pid,startTicks:ticks,image:process.execPath};
}
function project(snapshot,memory,atMs) {
  const p=snapshot&&snapshot.playback,b=p&&p.budget,c=p&&p.compressed;
  return {schema:'eva-natural-sample-v1',atMs:number(atMs),state:STATES.has(snapshot&&snapshot.state)?snapshot.state:'other',
    epoch:number(snapshot&&snapshot.epoch),frameCount:number(p&&p.frameCount),drawCount:number(p&&p.drawCount),
    managedBytes:number(b&&b.used),managedLimit:number(b&&b.limit),imageTasks:number(p&&p.activeImageTasks),
    compressedBytes:number(c&&c.residentBytes),compressedFrames:number(c&&c.residentFrames),
    rss:number(memory&&memory.rss),heapUsed:number(memory&&memory.heapUsed),external:number(memory&&memory.external),arrayBuffers:number(memory&&memory.arrayBuffers)};
}
function start(options) {
  if(!options||typeof options.snapshot!=='function')throw Error('Explicit observation snapshot required');
  const identity=exactSelf();
  if(!identity)throw Error('Observer cannot prove renderer identity');
  const child=cp.spawn(process.execPath,[path.join(__dirname,'observe-worker.cjs'),String(identity.pid),identity.startTicks,identity.image,options.scope==='quality'?'quality':'natural'],
    {windowsHide:true,shell:false,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:''},stdio:['pipe','pipe','pipe']});
  const began=performance.now();let closed=false,stopping=false,issue=null,ticks=0,maxProjectionMs=0,projectionMs=0,pending='';
  function notify(message){try{if(options.onStatus)options.onStatus(message);}catch(_){}}
  const done=new Promise(resolve=>{child.once('error',e=>{issue=e.message;finish();});child.once('close',code=>{if(code!==0)issue=issue||'Observation helper stopped unexpectedly';finish();});
    function finish(){if(closed)return;closed=true;clearInterval(timer);notify({state:issue?'stopped':'saved',issue});resolve({issue,ticks,maxProjectionMs,projectionMs});}});
  function sample(){if(stopping||closed)return;
    try{const at=performance.now(),value=project(options.snapshot(),process.memoryUsage(),at-began),line=JSON.stringify(value)+'\n';
      const elapsed=performance.now()-at;projectionMs+=elapsed;maxProjectionMs=Math.max(maxProjectionMs,elapsed);ticks++;
      if(Buffer.byteLength(line)>MAX||child.stdin.writableLength>MAX||!child.stdin.writable)throw Error('Observation input capacity reached');
      child.stdin.write(line);notify({state:'sample',sample:value});
    }catch(e){issue=e.message;stop();}}
  child.stdout.on('data',b=>{pending+=b.toString('utf8');if(pending.length>32768){issue='Observation status too large';stop();return;}let at;
    while((at=pending.indexOf('\n'))>=0){try{notify(JSON.parse(pending.slice(0,at)));}catch(_){issue='Observation status invalid';stop();}pending=pending.slice(at+1);}});
  child.stderr.resume();child.stdin.on('error',()=>{issue=issue||'Observation input closed';stop();});
  const timer=setInterval(sample,1000);
  function stop(){if(!stopping){stopping=true;clearInterval(timer);if(child.stdin.writable)child.stdin.end(JSON.stringify({schema:'eva-natural-stop-v1',ticks,maxProjectionMs,projectionMs})+'\n');}return done;}
  return Object.freeze({stop,done,sample,get active(){return !closed&&!stopping;}});
}
module.exports={start,project,exactSelf,MAX};
