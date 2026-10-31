'use strict';
const DEFAULTS=Object.freeze({repeats:3,maxRepeats:5,sceneTimeoutMs:30000,runTimeoutMs:180000,requestTimeoutMs:8000,cadenceMs:33,dragInputs:40,randomSeeks:8,seed:38591});
function sequence(duration,options={}){
  const p={...DEFAULTS,...options};let seed=p.seed>>>0;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const span=Math.max(0,duration-.05),forward=Array.from({length:p.dragInputs},(_,i)=>span*(.1+.8*i/(p.dragInputs-1)));
  return [{name:'forward-drag',kind:'drag',times:forward},{name:'backward-drag',kind:'drag',times:forward.slice().reverse()},
    {name:'fixed-random-seek',kind:'seek',times:Array.from({length:p.randomSeeks},()=>random()*span)},
    {name:'same-frame',kind:'seek',times:Array(8).fill(span*.42)}];
}
async function run({seek,pause,context,collector,signal,options={},now=()=>performance.now()}){
  const p={...DEFAULTS,...options};
  for(const k of Object.keys(p))if(!Number.isFinite(p[k])||p[k]<=0)throw Error('标准测试配置无效：'+k);
  if(!Number.isInteger(p.repeats)||p.repeats>5||p.runTimeoutMs>600000||p.sceneTimeoutMs>60000||p.dragInputs>240||p.randomSeeks>64||p.cadenceMs<16)throw Error('标准测试配置超过边界');
  const initial=context();if(!initial.source?.sha256||!initial.source?.duration||initial.canRun===false)throw Error('没有可测试的已就绪素材，或仍有编辑/循环状态');
  const schedule=sequence(initial.source.duration,p),began=now();let sceneAt=began,issued=0;
  function check(){if(signal?.aborted)throw Object.assign(Error('用户停止测试'),{code:'CANCELLED'});if(now()-began>p.runTimeoutMs||now()-sceneAt>p.sceneTimeoutMs)throw Object.assign(Error('标准测试超时'),{code:'TIMEOUT'});const current=context();if(current.source?.sha256!==initial.source.sha256)throw Error('测试过程中素材改变');if(JSON.stringify(current.config)!==JSON.stringify(initial.config)||JSON.stringify(current.environment)!==JSON.stringify(initial.environment))throw Error('测试过程中画质、额度、速度或窗口环境改变；本轮不参与比较');if(current.canRun===false)throw Error('测试被标注、循环或播放器状态变化打断');}
  const wait=ms=>new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',aborted);},aborted=()=>{done();reject(Object.assign(Error('用户停止测试'),{code:'CANCELLED'}));},timer=setTimeout(()=>{done();resolve();},Math.max(0,ms));signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted)aborted();});
  async function bounded(work,ms){let timeout;const failure=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Object.assign(Error('准确帧请求超时'),{code:'TIMEOUT'})),ms);});let abort;const stopped=new Promise((_,reject)=>{abort=()=>reject(Object.assign(Error('用户停止测试'),{code:'CANCELLED'}));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});try{return await Promise.race([work,failure,stopped]);}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}}
  await bounded(Promise.resolve().then(pause),p.requestTimeoutMs);
  const results=[];
  for(let round=1;round<=p.repeats;round++)for(const scene of schedule){
    sceneAt=now();check();collector.setScenario(scene.name+'/round-'+round);let backgroundFailure=null;
    for(let i=0;i<scene.times.length;i++){
      if(scene.kind==='drag')await wait(sceneAt+i*p.cadenceMs-now());check();
      const last=i===scene.times.length-1,startedAt=now();
      const pending=Promise.resolve().then(()=>seek(scene.times[i],{kind:scene.kind,final:scene.kind!=='drag'||last,inputAt:startedAt}));issued++;
      if(scene.kind==='drag'&&!last)pending.catch(e=>{backgroundFailure=e;});
      else{const value=await bounded(pending,Math.min(p.requestTimeoutMs,p.sceneTimeoutMs-(now()-sceneAt),p.runTimeoutMs-(now()-began)));if(!['drawn','reused'].includes(value?.status))throw Error('目标未完成：'+value?.status);}
      if(backgroundFailure)throw backgroundFailure;
    }
    check();results.push({scene:scene.name,round,elapsedMs:now()-sceneAt});
  }
  collector.setScenario(null);return{issued,results,protocol:{...p,sequence:schedule},scope:'formal Session/Player calls, fixed input cadence; no physical mouse or display measurement'};
}
module.exports={run,sequence,DEFAULTS};
