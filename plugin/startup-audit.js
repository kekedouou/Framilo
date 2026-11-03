/* Bounded, opt-in local investigation. No media/annotation contents or network. */
(function(root){
 'use strict';
 function createAudit(env){
  const start=env.performance.now(),rows=[];let sink=null,closed=false,count=0;
  function mark(stage,values={}){
   if(closed||count>=160)return;count++;
   const row={stage:String(stage).slice(0,64),ms:Math.round((env.performance.now()-start)*100)/100,navigationMs:Math.round(env.performance.now()*100)/100};
   for(const[k,v]of Object.entries(values))if(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(k)&&['string','number','boolean'].includes(typeof v))row[k]=typeof v==='string'?v.slice(0,384):Number.isFinite(v)||typeof v!=='number'?v:String(v);
   if(sink){try{sink(row);}catch(_){stop();}}else rows.push(row);
  }
  function stop(){closed=true;try{sink?.close?.();}catch(_){}sink=null;rows.length=0;}
  function connect(pluginRoot){
   if(sink||closed)return;
   try{
    const fs=require('fs'),path=require('path'),crypto=require('crypto');
    const configPath=path.join(pluginRoot,'startup-audit.local.json');if(!fs.existsSync(configPath))return;
    const regular=(p,dir=false)=>{const s=fs.lstatSync(p);if(s.isSymbolicLink()||(dir?!s.isDirectory():!s.isFile()||s.nlink!==1)||fs.realpathSync(p).toLowerCase()!==path.resolve(p).toLowerCase())throw Error('unsafe audit path');return s;};
    regular(pluginRoot,true);if(regular(configPath).size>1024)return;
    const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
    if(config.stage!=='E60'||!Number.isFinite(config.expiresAt)||Date.now()>config.expiresAt||config.expiresAt-Date.now()>48*3600000)return;
    const project=path.resolve(pluginRoot,'..');regular(project,true);regular(path.join(project,'.git'),true);
    const evidence=path.join(project,'verification-runs');regular(evidence,true);const out=path.join(evidence,'e60');regular(out,true);
    if(fs.readdirSync(out).filter(n=>/^startup-host-.*\.jsonl$/.test(n)).length>=10)return;
    const file=path.join(out,'startup-host-'+process.pid+'-'+Date.now()+'.jsonl'),fd=fs.openSync(file,'wx');let bytes=0;
    sink=row=>{if(Date.now()>config.expiresAt)throw Error('audit expired');const line=JSON.stringify(row)+'\n',n=Buffer.byteLength(line);if(bytes+n>64*1024)throw Error('audit limit');fs.writeSync(fd,line);bytes+=n;};sink.close=()=>fs.closeSync(fd);
    for(const row of rows)sink(row);rows.length=0;
    const fingerprint=crypto.createHash('sha256');for(const name of ['app.js','ui.js','window-drag.cjs','native-player.js','index.html','startup-audit.js'])fingerprint.update(fs.readFileSync(path.join(pluginRoot,name)));
    mark('audit-connected',{pid:process.pid,codeHash:fingerprint.digest('hex'),timeOrigin:env.performance.timeOrigin,uptimeMs:Math.round(process.uptime()*1000),electron:process.versions.electron||'none',chrome:process.versions.chrome||'none'});
   }catch(_){stop();}
  }
  return{mark,connect,stop,snapshot:()=>rows.map(r=>({...r}))};
 }
 if(typeof module==='object')module.exports={createAudit};
 if(!root?.document||!root.performance?.now||root.EVAStartup)return;
 const audit=root.EVAStartup=createAudit(root);audit.mark('first-script',{timeOrigin:root.performance.timeOrigin});
 const geometry=()=>({hidden:root.document.hidden,width:root.innerWidth,height:root.innerHeight,dpi:root.devicePixelRatio});
 root.document.addEventListener?.('DOMContentLoaded',()=>audit.mark('dom-ready',geometry()),{once:true});
 root.addEventListener('load',()=>audit.mark('window-load',geometry()),{once:true});
 root.document.addEventListener?.('visibilitychange',()=>audit.mark('visibility',geometry()));
 root.addEventListener('error',e=>audit.mark('script-error',{name:e.error?.name||'Error',code:e.error?.code||'unknown'}));
 root.addEventListener('unhandledrejection',e=>audit.mark('unhandled-rejection',{name:e.reason?.name||'Error',code:e.reason?.code||'unknown'}));
 let paintObserver;
 try{if(root.PerformanceObserver){paintObserver=new root.PerformanceObserver(list=>{for(const e of list.getEntries())audit.mark('browser-paint',{name:e.name,startMs:e.startTime});});paintObserver.observe({type:'paint',buffered:true});}}catch(_){}
 root.requestAnimationFrame?.(()=>{audit.mark('first-raf',geometry());root.requestAnimationFrame(()=>audit.mark('second-raf',geometry()));});
 for(const delay of [0,250,1000])root.setTimeout?.(()=>audit.mark('timer',{expectedMs:delay,...geometry()}),delay);
 root.addEventListener('unload',()=>{audit.mark('unload');audit.stop();paintObserver?.disconnect();},{once:true});
})(typeof window==='object'?window:null);
