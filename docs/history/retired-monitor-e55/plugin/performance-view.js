/* Owns a single detached monitor window; never moves or resizes the player. */
(function(root){'use strict';
function create({createMonitor,windowURL}){
 const trigger=root.document.getElementById('performanceMonitor');if(!trigger)return{destroy(){}};
 let monitor=null,child=null,destroyed=false,closing=false,token=null,watch=null;
 const send=value=>{if(child&&!child.closed)child.postMessage({...value,channel:'eva-performance',token},'*');};
 function draw(v){
  const requests=v.data?.requests||[],hits=requests.filter(r=>r.cache==='decoded').length;
  send({type:'view',value:{state:v.state,
   delay:v.explanation?.delay,p95:v.metrics?.latency?.p95,hit:requests.length?hits/requests.length:null,
   resources:v.resources,title:v.explanation?.title,stages:v.stages||[],count:requests.length}});
 }
 async function action(name){if(!monitor||destroyed||name!=='close')return;monitor.disable();closing=true;child?.close();child=null;root.clearInterval(watch);watch=null;closing=false;}
 function message(e){
  if(e.source!==child||!e.data||e.data.channel!=='eva-performance')return;
  if(e.data.type==='ready'){send({type:'hello'});draw(monitor.view());return;}
  if(e.data.token===token&&e.data.type==='action'&&['close'].includes(e.data.action))action(e.data.action);
 }
 async function closed(){
  if(!child||!child.closed||closing||destroyed)return;
  child=null;
  root.clearInterval(watch);watch=null;
  // Native X ends observation; there is no recording or save operation.
  try{await monitor.disable();}catch(e){trigger.title=e.message;}
 }
 function show(){
  if(destroyed)return;if(child&&!child.closed){child.focus();return;}
  token ||= Array.from(root.crypto.getRandomValues(new Uint32Array(4))).join('-');
  child=root.open(windowURL||new URL('performance-window.html',root.location.href).href,'eva-performance-'+token,
   'popup=yes,frame=false,autoHideMenuBar=true,width=420,height=485,resizable=yes,scrollbars=no,left='+Math.round(root.screenX+root.outerWidth-450)+',top='+Math.round(root.screenY+80));
  if(!child){trigger.title='监测窗口未能打开，请允许此本地窗口。';return;}
  watch=root.setInterval(closed,750);
  if(!monitor)monitor=createMonitor(draw);monitor.enable();
 }
 root.addEventListener('message',message);trigger.addEventListener('click',show);
 return{async destroy(){destroyed=true;if(watch!==null)root.clearInterval(watch);root.removeEventListener('message',message);trigger.removeEventListener('click',show);try{await monitor?.destroy();}finally{child?.close();child=null;}}};
}
root.EVAPerformanceView={create};
})(window);
