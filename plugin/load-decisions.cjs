'use strict';
// Session-scoped choices. No files, SDK or UI; aborted generations cannot settle new choices.
function createDecisions(changed=()=>{}) {
 let pending=null,serial=0;
 const cancelled=()=>Object.assign(Error('准备选择已取消。'),{code:'MEDIA_CANCELLED',name:'AbortError'});
 function ask(spec,...signals){signals=signals.filter(Boolean);if(signals.some(s=>s.aborted))return Promise.reject(cancelled());if(pending)return Promise.reject(Error('已有待确认操作。'));
  return new Promise((resolve,reject)=>{const view=Object.freeze({...spec,id:++serial,choices:Object.freeze(spec.choices.map(c=>Object.freeze({...c})))});
   const finish=(value,error)=>{if(pending?.view!==view)return;pending=null;signals.forEach(s=>s.removeEventListener('abort',abort));changed();error?reject(error):resolve(value);};
   const abort=()=>finish(null,cancelled());pending={view,finish};signals.forEach(s=>s.addEventListener('abort',abort,{once:true}));changed();});}
 return{ask,snapshot:()=>pending?.view||null,answer(id,value){if(!pending||pending.view.id!==id||!pending.view.choices.some(c=>c.value===value))return false;pending.finish(value);return true;}};
}
module.exports={createDecisions};
