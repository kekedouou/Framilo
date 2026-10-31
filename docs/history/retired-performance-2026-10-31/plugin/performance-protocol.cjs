'use strict';
const fs=require('fs').promises,path=require('path'),crypto=require('crypto');
const VERSION='ready-review-v3';
const FIXED=Object.freeze({repeats:3,maxRepeats:3,sceneTimeoutMs:30000,runTimeoutMs:180000,requestTimeoutMs:8000,cadenceMs:33,dragInputs:40,randomSeeks:8,seed:38591});
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));return value;}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function identity(context){return {source:context.source,config:{...context.config,proxyEncoder:context.config?.proxyEncoder||'cpu'},environment:context.environment};}
function same(a,b){return hash(identity(a))===hash(identity(b));}
function ready(context){
  if(!context.source?.sha256||!context.source.duration||context.canRun===false)throw Error('先打开视频，结束标注或循环，再开始固定测试。');
  if(context.config?.backend==='proxy'&&context.proxyStage!=='complete')throw Error('固定测试先等代理全部就绪，以免每次准备进度不同。眼前的加载原因仍可在实时面板查看。');
}
async function reference(root,context,{replace=false}={}){
  ready(context);const file=path.join(root,'test-conditions.json'),value={protocol:VERSION,options:FIXED,...identity(context)},key=hash(value);
  await fs.mkdir(root,{recursive:true});let stored=null;
  try{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>131072)throw Error('固定测试条件文件异常');stored=JSON.parse(await fs.readFile(file,'utf8'));if(stored.version!==1||!Array.isArray(stored.groups))throw Error('固定测试条件格式无法识别');}catch(e){if(e.code!=='ENOENT')throw e;}
  const active=stored?.groups.find(g=>g.key===stored.active)?.value;
  // A protocol-only upgrade creates a new comparison group; never mixes v2/v3.
  const upgraded=(active?.protocol==='ready-review-v2'||active&&active.config?.proxyEncoder===undefined)&&same(active,context);
  if(stored&&stored.active!==key&&!replace&&!upgraded)throw Error('当前视频、画质或运行环境与固定测试组不同。切回原条件，或在“更多”中点击“新建测试组”。');
  if(!stored||replace||upgraded){
    stored=stored||{version:1,active:null,groups:[]};
    if(!stored.groups.some(g=>g.key===key)){if(stored.groups.length>=32)throw Error('已有32个测试组，请先审阅整理。');stored.groups.push({key,value});}
    stored.active=key;const temp=file+'.next';await fs.writeFile(temp,JSON.stringify(stored,null,2),{flag:'wx'});try{await fs.rename(temp,file);}catch(e){await fs.unlink(temp).catch(()=>{});throw e;}
  }
  return {version:VERSION,key,verified:false,preparation:'fixed-warmup',options:FIXED};
}
function cacheState(context){
  const state=context.cacheState?.();
  return {known:!!state,fingerprint:state?hash(state):null};
}
// Wait for the existing preparation work to settle; never changes a cache or its policy.
async function settleCache({capture,check=()=>{},signal,timeoutMs=10000,now=()=>performance.now(),pollMs=100,stableMs=300}){
  const start=now();let last=null,since=start;
  while(true){
    if(signal?.aborted)throw Object.assign(Error('用户停止测试'),{code:'CANCELLED'});check();
    const current=capture();if(!current||!Number.isSafeInteger(current.pending))throw Error('无法核对准备中的任务，本轮不作为固定对照');
    const stamp=JSON.stringify(current),at=now();
    if(current.pending===0&&stamp===last&&at-since>=stableMs)return current;
    if(current.pending!==0||stamp!==last){last=stamp;since=at;}
    if(at-start>=timeoutMs)throw Object.assign(Error('固定测试起点的缓存仍在变化，已停止本轮'),{code:'TIMEOUT'});
    await new Promise((resolve,reject)=>{const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);},cancel=()=>{done();reject(Object.assign(Error('用户停止测试'),{code:'CANCELLED'}));},timer=setTimeout(()=>{done();resolve();},pollMs);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();});
  }
}
module.exports={VERSION,FIXED,identity,same,ready,reference,cacheState,hash,settleCache};
