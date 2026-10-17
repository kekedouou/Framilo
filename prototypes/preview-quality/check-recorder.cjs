'use strict';
// Batches small Canvas results. No frame pixels or unbounded history retained.
const {store}=require('./workspace.cjs');
function create(options={}){
  const open=options.open||(()=>store().writer('eagle-canvas-check'));
  let writer=null,pending=null,unknown=false;
  function save(value){
    if(pending)throw Error(unknown?'上次保存结果尚未确认，未覆盖待核对结果':'请先重试保存上次核对结果');
    const serialized=JSON.stringify(value);
    if(Buffer.byteLength(serialized)>32768)throw Error('画面核对结果超过本次记录限额');
    pending=JSON.parse(serialized);unknown=false;return retry();
  }
  function retry(){
    if(!pending)throw Error('没有待保存的核对结果');
    if(unknown)throw Error('上次写入结果不确定，请交由Codex核对，未重复保存');
    const size=Buffer.byteLength(JSON.stringify(pending))+1;
    if(writer&&writer.bytes+size>writer.capacityBytes){writer.close();writer=null;}
    if(!writer)writer=open(); // Allocation failure writes no result; retry is safe.
    try{writer.append(pending);writer.flush();const result=writer.receipt();pending=null;return result;}
    catch(e){unknown=true;throw e;}
  }
  return {save,retry,get pending(){return pending!==null;},get uncertain(){return unknown;},
    close(){if(writer){writer.close();writer=null;}}};
}
module.exports={create};
