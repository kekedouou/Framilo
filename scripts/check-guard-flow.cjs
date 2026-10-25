'use strict';
// Explicit bounded Windows pipe regression, fake media worker, no library/cache/media.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {createTaskClient}=require('../plugin/task-client.cjs');
const base=path.resolve(__dirname,'../verification-runs/e36-guard-flow'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
  fs.mkdirSync(base,{recursive:true});
  if(fs.readdirSync(base).filter(n=>/^run-.*\.json$/.test(n)).length>=4)throw Error('Guard flow budget sealed.');
  const id=crypto.randomBytes(8).toString('hex'),root=path.join(base,'scratch-'+id),record={id,started:new Date().toISOString(),realWindowsGuard:true,worker:'protocol fixture',media:false,files:[],events:[]};
  const file=path.join(base,'run-'+id+'.json');const save=()=>fs.writeFileSync(file,JSON.stringify(record,null,2));save();
  fs.mkdirSync(root);fs.mkdirSync(path.join(root,'native'));
  function write(name,bytes){bytes=Buffer.from(bytes);assert(record.files.reduce((s,f)=>s+f.bytes,0)+bytes.length<=2*1024**2);const p=path.join(root,name);fs.writeFileSync(p,bytes,{flag:'wx'});record.files.push({name,bytes:bytes.length,sha256:sha(bytes),ino:fs.statSync(p,{bigint:true}).ino.toString()});save();}
  record.sourceHashes=Object.fromEntries(['plugin/task-client.cjs','plugin/task-worker.cjs','scripts/check-guard-flow.cjs'].map(n=>[n,sha(fs.readFileSync(path.resolve(__dirname,'..',n)))]));save();
  for(const name of ['task-host.cs','task-host.local.exe','task-host.local.json'])write('native/'+name,fs.readFileSync(path.resolve(__dirname,'../plugin/native',name)));
  const index=require('../plugin/frame-index.cjs').buildIndex([{id:0,ptsTicks:'0',file:'frame-0.avc',bytes:1}],{timeBase:[1,1],lastFrameEndTicks:'1'});
  write('info.json',JSON.stringify(require('../plugin/media-wire.cjs').packInfo({...index,width:16,height:8,duration:1,lastFrameEndTicks:'1',streaming:'segments-v1',leaseId:'a'.repeat(24),source:{sha256:'b'.repeat(64)},segments:[{start:0,end:1,first:0,last:0}]})));
  write('task-worker.cjs',String.raw`
const readline=require('readline');const owner={key:process.env.EVA_TASK_KEY,epoch:process.env.EVA_TASK_EPOCH,guardPid:Number(process.env.EVA_TASK_GUARD_PID)};
const send=v=>process.stdout.write(JSON.stringify(v)+'\n');let targets=0,last=-1;
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='prepare'){
  send({type:'response',id:m.id,result:require('./info.json')});
  const until=Date.now()+2500;while(Date.now()<until){} // Slow synchronous worker boundary.
 }else if(m.method==='target'){targets++;last=m.time;if(m.controlId)send({type:'control-ack',id:m.controlId});}
 else if(m.method==='ping')send({type:'response',id:m.id,result:{targets,last,node:process.versions.node}});
 else if(m.method==='release')send({type:'response',id:m.id,result:true});
 else if(m.method==='close'){send({type:'response',id:m.id,result:true});process.stdout.write('',()=>process.exit(0));}
}).on('close',()=>process.exit(0));send({type:'ready',taskOwner:owner});
`);
  const client=createTaskClient({pluginRoot:root,runtime:process.env.EVA_TEST_RUNTIME||process.execPath,discoverTools:async()=>({})});
  let timer;const at=Date.now();
  try{
    await Promise.race([(async()=>{const info=await client.media.prepare({});for(let n=0;n<5000;n++)client.cache.target(info,n);
      const value=await client.ping();record.events.push({event:'ping-after-drag',...value,elapsedMs:Date.now()-at});
      // A queued latest intention must eventually arrive, even when ping overtakes it.
      let latest=value;for(let n=0;latest.last!==4999&&n<20;n++){await new Promise(r=>setTimeout(r,20));latest=await client.ping();}
      assert.equal(latest.last,4999);record.events.push({event:'latest-target',...latest});await client.cache.release(info);await client.close();
    })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Guard flow deadline')),20000);})]);record.passed=true;
  }catch(error){record.passed=false;record.error={code:error.code,message:error.message};}
  finally{clearTimeout(timer);try{await client.close();}catch(error){record.closeError=error.message;}record.stopped=client.stopped;record.elapsedMs=Date.now()-at;save();
    if(record.stopped){for(const f of record.files){const p=path.join(root,f.name),st=fs.lstatSync(p,{bigint:true});assert(st.isFile()&&!st.isSymbolicLink()&&st.ino.toString()===f.ino&&sha(fs.readFileSync(p))===f.sha256);}
      for(const f of record.files)fs.unlinkSync(path.join(root,f.name));fs.rmdirSync(path.join(root,'native'));fs.rmdirSync(root);record.cleaned=true;save();}}
  console.log(JSON.stringify(record));if(!record.passed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
