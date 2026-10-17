'use strict';
const cp=require('child_process'),path=require('path');
let active=false,lastJournal=null;
function start(source,time,onStatus,options={}){
  if(active)throw Error('请等待上一段对照清理完成');active=true;
  const child=(options.spawn||cp.spawn)(process.execPath,[path.join(__dirname,'selected-display.cjs')],{windowsHide:true,shell:false,
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_OPTIONS:''},stdio:['pipe','pipe','pipe']});
  let resolveReady,rejectReady,settled=false,closing=false,pending='',failure=null,receipt=null;
  const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});ready.catch(()=>{});
  function fail(e){failure=e;if(!settled){settled=true;rejectReady(e);}}
  const done=new Promise(resolve=>{child.once('error',e=>{active=false;fail(e);resolve({failure,receipt});});child.once('close',code=>{
    active=false;if(receipt)lastJournal=receipt;
    if(!settled)fail(Error('对照准备未完成'));if(code!==0&&!failure)failure=Error('对照工具异常退出');resolve({failure,receipt});});});
  child.stdout.on('data',b=>{pending+=b.toString('utf8');if(pending.length>65536){fail(Error('对照状态超限'));stop();return;}let at;
    while((at=pending.indexOf('\n'))>=0){try{const value=JSON.parse(pending.slice(0,at));
      if(value.state==='ready'&&!settled){settled=true;resolveReady(value);}
      if(value.state==='failed')fail(Error(value.message));if(value.state==='released')receipt=value.receipt;
      if(onStatus&&value.state)onStatus(value);
    }catch(e){fail(e);stop();}pending=pending.slice(at+1);}});
  child.stderr.resume();child.stdin.on('error',()=>fail(Error('对照工具通信已结束')));
  child.stdin.write(JSON.stringify({type:'prepare',source,time,journal:lastJournal||options.journal||null})+'\n');
  function stop(){if(!closing){closing=true;if(child.stdin.writable)child.stdin.end(JSON.stringify({type:'release'})+'\n');}return done;}
  return {ready,stop,done};
}
module.exports={start};
