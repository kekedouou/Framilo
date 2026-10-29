'use strict';

// Passive observer. This module owns no playback, cache or file capabilities.
const DEFINITION = Object.freeze({ version: 1, clock: 'renderer performance.now',
  start: 'formal input timestamp supplied to Player._request; excludes physical input and unknown OS queue',
  end: 'Canvas drawImage returned, or same indexed frame already held; not physical presentation',
  observation: 'next Player rAF observes submitted identity; no pixel/monitor scanout proof',
  exactness: 'source integer PTS index identity; no independent pixel reference for ordinary media',
  read: 'renderer request to asset bytes returned; includes unseparated IPC, validation, generation and disk',
  decode: 'browser decoder promise; internal GPU/CPU stages not independently measured' });
const LIMITS = Object.freeze({ events: 20000, requests: 5000, bytes: 12 * 1024 * 1024, seconds: 600 });
function percentile(values, p) { if (!values.length) return null; const a = values.slice().sort((x,y)=>x-y); return a[Math.max(0,Math.ceil(a.length*p)-1)]; }
function distribution(values) { return { n: values.length, p50: percentile(values,.5), p95: percentile(values,.95), max: values.length?Math.max(...values):null, lowSample: values.length<40 }; }
const finite = v => typeof v === 'number' && Number.isFinite(v);
function createCollector({ now = () => performance.now(), limits = LIMITS, live = false, onLimit = () => {}, excludeThrough = null } = {}) {
  limits = { ...LIMITS, ...limits };
  let events=[], requests=new Map(), samples=[], dropped=0, bytes=0, paused=false, pausedAt=0, pauseMs=0;
  let started=now(), ended=null, count=0, overheadMs=0, orphan=0, scenario=null, peakManaged=0, lastProxy=null;
  let context={},dragSerial=0,dragId=null,dragDomain=null,draining=false,stopReason=null;
  function drain(reason='manual') { if(live||draining)return;draining=true;stopReason=reason; }
  function capacityCheck() {
    if(live||draining)return;
    const reason=events.length>=Math.floor(limits.events*.8)?'events':bytes>=limits.bytes*.8?'bytes':
      requests.size>=Math.floor(limits.requests*.8)?'requests':samples.length>=2300?'samples':
      now()-started>=Math.max(0,limits.seconds*1000-8000)?'duration':null;
    if(reason){drain(reason);try{onLimit(reason);}catch(_){/* observer never owns playback */}}
  }
  const key = (e,b) => [b.sessionEpoch||0,e.epoch||0,e.requestId].join(':');
  function push(e) {
    const size = JSON.stringify(e).length * 2;
    if(live) while(events.length && (events.length>=limits.events || bytes+size>limits.bytes)){bytes-=events[0]._bytes;events.shift();}
    if(events.length>=limits.events || bytes+size>limits.bytes){dropped++;return;}
    const item={...e};Object.defineProperty(item,'_bytes',{value:size});events.push(item);bytes+=size;capacityCheck();
  }
  function finish(r,status,at) { if(!r||r.status!=='pending')return; for(const [name,start] of Object.entries(r.activeStages||{})) if(r.stages.length<32)r.stages.push({name,start,end:at,incomplete:true}); r.activeStages={}; r.status=status;r.end=at;r.latencyMs=Math.max(0,at-r.start); }
  function observe(e,b={}) {
    if(paused||ended!==null||!e||!finite(e.at))return;
    const before=now();count++;
    try {
      const id = e.requestId == null ? null : key(e,b);
      if(excludeThrough && (b.sessionEpoch||0)===(excludeThrough.sessionEpoch||0) && (e.epoch||0)===(excludeThrough.epoch||0) && Number.isSafeInteger(e.requestId) && e.requestId<=excludeThrough.requestId)return;
      let r=id?requests.get(id):null;
      // A capacity stop closes the observation window, not the user's player.
      // Only already-admitted requests may finish in the reserved tail.
      if(draining && !r)return;
      if(e.type==='request' && e.phase==='input'){
        if(live&&requests.size>=limits.requests)requests.delete(requests.keys().next().value);
        if(requests.size>=limits.requests){dropped++;return;}
        const domain=[b.sessionEpoch||0,e.epoch||0].join(':');
        if(['rapid','drag'].includes(e.kind)){if(!dragId||dragDomain!==domain){dragId=(scenario||'manual')+'/gesture-'+(++dragSerial);dragDomain=domain;}}
        else if(e.kind!=='release')dragId=null;
        r={id, start:finite(e.inputAt)?e.inputAt:e.at, received:e.at, target:e.targetTime, frameId:e.frameId,
          ordinal:e.frameOrdinal, pts:e.ptsTicks||null, timeBase:e.timeBase||null, sourceTime:e.sourceTime,
          kind:e.kind, final:!!e.final, cache:e.cacheStateAtInput, backend:context.backend||'unknown', detailVersion:2, activeStages:{},
          generating:context.generating ?? null, targetPrepared:b.targetPrepared??null, scenario, dragId, status:'pending', stages:[], activeStage:null, observation:null, preview:null};
        requests.set(id,r);
        if(e.final)dragId=null;
      }
      if(finite(e.budgetBytes))peakManaged=Math.max(peakManaged,e.budgetBytes);
      if(e.type==='stage-begin' && r?.status==='pending'){r.activeStages[e.phase]=e.startedAt;r.activeStage={name:e.phase,start:e.startedAt};}
      if(e.type==='stage' && r?.status==='pending' && r.stages.length<32){r.stages.push({name:e.phase,start:e.startedAt,end:e.at});delete r.activeStages[e.phase];r.activeStage=Object.entries(r.activeStages).map(([name,start])=>({name,start})).at(-1)||null;}
      if(e.type==='ready' && r && e.phase==='effective-target-available')r.ready=e.at;
      if(e.type==='preview' && r){r.preview={at:e.at,time:e.time,approximate:true,targetDeltaMs:finite(e.time)&&finite(r.target)?Math.abs(e.time-r.target)*1000:null};}
      if(['draw','reused'].includes(e.type)&&r){
        r.readyAt=finite(e.readyAt)?e.readyAt:r.cache==='decoded'?r.start:null;
        r.submitStartedAt=finite(e.submitStartedAt)?e.submitStartedAt:null;
        const matched=e.frameId===r.frameId && (!finite(r.sourceTime)||Math.abs(e.time-r.sourceTime)<1e-7);
        r.actual={frameId:e.frameId,time:e.time,matched};
        finish(r,matched?(e.type==='reused'?'reused':'shown'):'wrong-frame',finite(e.drawAt)?e.drawAt:e.at);
      }
      if(e.type==='superseded')finish(r,'superseded',e.at);
      if(e.type==='error'&&r)finish(r,'failed',e.at);
      if(e.type==='observation'&&r)r.observation=e.observedAt;
      if(id&&!r)orphan++;
      if(id||e.type==='preview'||e.type==='resource'||e.type==='proxy'||e.type==='error') {
        const data={type:e.type,phase:e.phase||null,at:e.at,id};
        for(const k of ['frameId','time','frameOrdinal','inputAt','startedAt','cacheStateAtInput','budgetBytes','observedAt','reason','targetTime','targetDeltaMs','final','readyAt','submitStartedAt','readyToSubmitMs'])if(e[k]!==undefined)data[k]=e[k];
        // Do not save source paths, annotation text, arbitrary error messages or frames.
        push(data);
      }
    } finally { overheadMs+=Math.max(0,now()-before); }
  }
  function sample(value){
    if(paused||ended!==null||draining)return;
    context={backend:value.backend,generating:value.generating};
    const item={at:now(),managedBytes:value.managedBytes||0,rss:value.rss||null,heap:value.heap||null,
      cachedFrames:value.cachedFrames||0,backend:value.backend||'unknown',generating:value.generating??null,prepared:value.prepared??null};
    if(live&&samples.length>=180)samples.shift();
    if(samples.length<2400)samples.push(item);else dropped++;
    peakManaged=Math.max(peakManaged,item.managedBytes);lastProxy=item;capacityCheck();
  }
  function pause(){if(paused||ended!==null)return;paused=true;pausedAt=now();for(const r of requests.values())finish(r,'incomplete',pausedAt);push({type:'pause',at:pausedAt});}
  function resume(){if(!paused)return;pauseMs+=now()-pausedAt;paused=false;push({type:'resume',at:now()});}
  function end(status='completed'){if(ended!==null)return;ended=now();if(paused)pauseMs+=ended-pausedAt;for(const r of requests.values())finish(r,status==='cancelled'?'cancelled':status==='timeout'?'timeout':'incomplete',ended);}
  function expirePending(){for(const r of requests.values())if(r.status==='pending'){push({type:'observation-timeout',id:r.id,at:now(),reason:'capture-drain-limit'});finish(r,'timeout',now());}}
  function snapshot(){return {started,ended,activeMs:Math.max(0,(ended??now())-started-pauseMs-(paused&&ended===null?now()-pausedAt:0)),paused,draining,stopReason,
    events:events.slice(),requests:[...requests.values()].map(r=>({...r,activeStages:{...r.activeStages},stages:r.stages.slice()})),samples:samples.slice(),
    capacity:{...limits,eventsUsed:events.length,requestsUsed:requests.size,bytesUsed:bytes,dropped,truncated:dropped>0,orphanEvents:orphan},
    overhead:{events:count,callbackMs:overheadMs,perEventUs:count?overheadMs/count*1000:0,scope:'collector only; UI/report and diagnostics not included'},peakManaged,lastProxy};}
  return {observe,sample,pause,resume,end,snapshot,drain,expirePending,pending:()=>[...requests.values()].some(r=>r.status==='pending'),setScenario:value=>{scenario=value;dragId=null;}};
}
function metrics(data) {
  const rows=data.requests, outcomes={};for(const r of rows)outcomes[r.status]=(outcomes[r.status]||0)+1;
  const good=rows.filter(r=>r.status==='shown'||r.status==='reused'),shown=rows.filter(r=>r.status==='shown');
  const groups={};for(const r of rows){const key=[r.backend,r.cache,'generating='+r.generating].join('/');(groups[key]??=[]).push(r);}
  const byScenario={};for(const r of rows)(byScenario[r.scenario||'manual']??=[]).push(r);
  const summarise=list=>({requests:list.length,latency:distribution(list.filter(r=>['shown','reused'].includes(r.status)).map(r=>r.latencyMs)),outcomes:list.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})});
  const drags={};
  const dragGroups={};for(const r of rows){if(!['drag','rapid','release'].includes(r.kind))continue;const k=r.dragId||r.scenario||'manual';(dragGroups[k]??=[]).push(r);}
  for(const [name,list]of Object.entries(dragGroups)){
    const drag=list.filter(r=>['drag','rapid','release'].includes(r.kind));if(!drag.length)continue;
    const start=Math.min(...drag.map(r=>r.start)),end=Math.max(...drag.map(r=>r.end||r.start));
    const updates=drag.filter(r=>r.status==='shown').map(r=>r.end).sort((a,b)=>a-b);
    const provisional=drag.filter(r=>r.preview).map(r=>r.preview.at).sort((a,b)=>a-b);
    const times=[start,...[...updates,...provisional].sort((a,b)=>a-b),end];
    drags[name]={inputs:drag.length,exactSubmissions:updates.length,provisionalSubmissions:provisional.length,
      maxNoUpdateMs:Math.max(0,...times.slice(1).map((v,i)=>v-times[i])),
      intervals:distribution(updates.slice(1).map((v,i)=>v-updates[i])),
      releaseToExact:distribution(drag.filter(r=>r.final&&['shown','reused'].includes(r.status)).map(r=>r.latencyMs))};
  }
  return {definition:DEFINITION,requests:rows.length,outcomes,latency:distribution(good.map(r=>r.latencyMs)),
    newSubmissions:distribution(shown.map(r=>r.latencyMs)),preview:distribution(rows.filter(r=>r.preview).map(r=>Math.max(0,r.preview.at-r.start))),
    groups:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,summarise(v)])),
    scenarios:Object.fromEntries(Object.entries(byScenario).map(([k,v])=>[k,summarise(v)])),drags,
    resources:{managedPeakBytes:data.peakManaged,rssPeakBytes:data.samples.some(s=>finite(s.rss))?Math.max(...data.samples.map(s=>s.rss||0)):null,scope:'renderer process sample; not all Eagle/FFmpeg/GPU'},
    proxyGeneration:{observedActiveMs:data.samples.slice(1).reduce((sum,s,i)=>sum+(data.samples[i].generating?Math.max(0,s.at-data.samples[i].at):0),0),
      exactGenerationMs:null,note:'333ms status sampling; active portion during recording only, not total transcoding time'},
    coverage:{orphanEvents:data.capacity.orphanEvents,truncated:data.capacity.truncated,dropped:data.capacity.dropped},
    errorRate:rows.length?((outcomes.failed||0)+(outcomes['wrong-frame']||0))/rows.length:0,
    cancelRate:rows.length?((outcomes.superseded||0)+(outcomes.cancelled||0))/rows.length:0,
    thresholds:null,comparison:{eligible:false,reason:'尚无同条件对照'},overhead:data.overhead};
}
module.exports={createCollector,metrics,distribution,DEFINITION,LIMITS};
