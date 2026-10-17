'use strict';
// One explicitly selected MP4, one short comparison; stdin lifetime owns outputs.
const fs=require('fs'),path=require('path');
const {identity,hashFile,store,REPO,LIMITS}=require('./workspace.cjs');
const {run,command}=require('./quality.cjs');
function windowStart(time,duration){return Math.max(0,Math.min(Number.isFinite(time)?time:0,Math.max(0,duration-1)));}
function journal(writer){
  return {writer:kind=>({append:value=>writer.append({kind,value}),flush:()=>writer.flush(),close:()=>{writer.flush();return null;}}),
    save:(kind,value)=>{writer.append({kind,value});writer.flush();return null;}};
}
function resumeJournal(receipt,records=store()){
  const root=records.root,file=path.resolve(REPO,receipt.file);
  if(path.dirname(file)!==root||!/^slot-\d{3}\.jsonl$/.test(path.basename(file)))throw Error('Selected journal path invalid');
  const original=identity(file);
  if(original.bytes!==receipt.bytes||hashFile(file)!==receipt.sha256)throw Error('Selected journal changed; retained');
  if(original.bytes>LIMITS.slot-65536){const e=Error('Current selected journal needs rotation');e.code='EVIDENCE_ROTATE';throw e;}
  const first=JSON.parse(fs.readFileSync(file,'utf8').split('\n')[0]);
  if(first.schema!=='eva-evolution-record-v1'||first.kind!=='selected-display-session')throw Error('Not a selected-display journal');
  const fd=fs.openSync(file,'a');let bytes=original.bytes,closed=false;
  const opened=fs.fstatSync(fd,{bigint:true});if(String(opened.ino)!==original.ino||String(opened.dev)!==original.dev){fs.closeSync(fd);throw Error('Journal identity changed');}
  return {append(value){if(closed)throw Error('Selected journal closed');const buffer=Buffer.from(JSON.stringify(value)+'\n');
    if(buffer.length>LIMITS.slot||bytes+buffer.length>LIMITS.slot)throw Error('本次对照记录已满，请停止本轮体验；原记录保留');
    const now=identity(file);if(now.dev!==original.dev||now.ino!==original.ino||now.bytes!==bytes)throw Error('Selected journal identity changed');
    let offset=0;while(offset<buffer.length)offset+=fs.writeSync(fd,buffer,offset,buffer.length-offset);bytes+=buffer.length;
  },flush(){if(!closed)fs.fsyncSync(fd);},close(){if(!closed){fs.fsyncSync(fd);fs.closeSync(fd);closed=true;}return {file:receipt.file,bytes,sha256:hashFile(file)};}};
}
function openJournal(receipt,records=store()){
  try{return receipt?resumeJournal(receipt,records):records.writer('selected-display-session');}
  catch(e){if(e.code!=='EVIDENCE_ROTATE')throw e;const writer=records.writer('selected-display-session');writer.append({previousJournal:receipt});writer.flush();return writer;}
}
async function inspect(request,tools,control={child:null,failure:null}){
  const source=require('../../plugin/eagle.cjs').validateSnapshot(request.source);
  const before=identity(source.filePath),sha256=hashFile(source.filePath);
  const chunks=[];let bytes=0;
  await command(tools.ffprobe,['-v','error','-show_streams','-show_format','-of','json',source.filePath],b=>{
    bytes+=b.length;if(bytes>2*1024**2)throw Error('视频信息超过实验限额');chunks.push(b);},null,control,15000);
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8')),v=data.streams.find(s=>s.codec_type==='video'),duration=Number(data.format.duration);
  if(!v||!Number.isFinite(duration)||duration<=0||duration>30||!/^\d+\/\d+$/.test(v.time_base))throw Error('本轮对照支持不超过30秒的MP4');
  if(JSON.stringify(before)!==JSON.stringify(identity(source.filePath)))throw Error('读取期间原视频已改变');
  return {key:'selected',file:source.filePath,sha256,identity:before,width:v.width,height:v.height,codec:v.codec_name,
    timeBase:v.time_base,duration,start:windowStart(request.time,duration), browserTimeOrigin:Number(data.format.start_time)||0, colorMetadata:v};
}
async function main(){
  let pipe='',request=null,captured=null,closing=false,finished=false,resolveInput,resolveRelease;
  const input=new Promise(r=>resolveInput=r),release=new Promise(r=>resolveRelease=r),control={child:null,failure:null};
  function cancel(){closing=true;control.failure=Error('对照准备已取消');if(control.child)control.child.kill();resolveInput(null);resolveRelease();}
  process.stdin.setEncoding('utf8');process.stdin.on('end',cancel);process.stdin.on('error',cancel);
  process.stdin.on('data',s=>{pipe+=s;if(pipe.length>16384){cancel();return;}let at;
    while((at=pipe.indexOf('\n'))>=0){const line=pipe.slice(0,at);pipe=pipe.slice(at+1);
      try{const value=JSON.parse(line);if(value.type==='release'){cancel();continue;}if(request)throw Error('Only one selected source per worker');
        if(value.type!=='prepare')throw Error('Invalid request');request=value;resolveInput(value);}catch(_){cancel();}}
  });
  const value=await input;if(!value||closing){process.stdin.destroy();return;}
  const writer=openJournal(value.journal);
  const records=journal(writer);
  const send=value=>{if(!finished)process.stdout.write(JSON.stringify(value)+'\n');};
  try{
    if(closing)throw Error('对照准备已取消');
    const local=JSON.parse(fs.readFileSync(path.join(__dirname,'config.local.json')));
    const source=await inspect(value,local,control);if(closing)throw control.failure;
    send({state:'preparing',start:source.start,width:source.width,height:source.height});
    await run(['selected'],[1080],['jpeg','png'],true,false,{config:{...local,sources:[source]},records,control,onCapture:value=>{captured=value;}});
    if(closing)throw control.failure;
    if(!captured)throw Error('未生成对照数据');
    send({state:'ready',location:captured.location,start:source.start,width:source.width,height:source.height,browserTimeOrigin:source.browserTimeOrigin,sourceIdentity:source.identity,frames:captured.data.times.length});
    await release;
  }catch(e){records.save('selected-display-failure',{cancelled:closing,message:String(e.message).replace(/[A-Za-z]:[^\n]*/g,'[local path]')});send({state:'failed',message:closing?'对照已取消':String(e.message).replace(/[A-Za-z]:[^\n]*/g,'[本机路径]')});}
  finally{
    if(control.child){control.child.kill();}
    if(captured&&captured.work.names().length){for(const name of captured.work.names())captured.work.seal(name);captured.work.remove(captured.work.names(),records);captured.work.finish();}
    const receipt=writer.close();send({state:'released',receipt});finished=true;process.stdin.destroy();
  }
}
if(require.main===module)main().catch(e=>{process.stdout.write(JSON.stringify({state:'failed',message:'对照工具停止：'+String(e.message).replace(/[A-Za-z]:[^\n]*/g,'[本机路径]')})+'\n');process.stdin.destroy();process.exitCode=1;});
module.exports={windowStart,journal,resumeJournal,openJournal,inspect};
