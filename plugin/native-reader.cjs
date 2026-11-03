'use strict';
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const { PacketReader } = require('./native-wire.cjs');
const TICKS = 254016000000;
function targetAt(frames, ordinal) {
  const frame=frames[ordinal];if(!frame)throw Error('源帧编号无效。');
  const [num, den]=frame.timeBase;
  const ticks=Number(BigInt(frame.ptsTicks)*BigInt(num)*BigInt(TICKS)/BigInt(den));
  if(!Number.isSafeInteger(ticks)) throw Error('Unsafe source timestamp');
  return {pts:frame.time,ticks,ordinal};
}
class FilmcraftClient {
  static async create(options) { const client=new FilmcraftClient(options);try{await client.ready;return client;}catch(e){await client.close();throw e;} }
  constructor({exe,source,frames,software=false,height=720,width,outputHeight,gpuDrawing=true,cacheBytes=384*1024**2,draw=()=>{},blank=()=>{},spawnProcess=spawn}) {
    Object.assign(this,{frames,draw,blank,id:0,current:null,dead:false,stats:{frames:0,stale:0,wrong:0,errors:0,hwFrames:0,hwFallbacks:0}});
      this.packets=new PacketReader((header,pixels)=>this.receive(header,pixels),header=>header.event!=='frame'||!this.dead&&this.current?.id===header.id);
    this.ready=new Promise((resolve,reject)=>{this.openResolve=resolve;this.openReject=reject;});
    this.proc=spawnProcess(exe,[source,software?'software':'hardware',String(height),String(cacheBytes),...(width&&outputHeight?[String(width),String(outputHeight),gpuDrawing?'yuv420p':'rgba']:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.stderr=''; this.proc.stderr.on('data',d=>{this.stderr=(this.stderr+d.toString()).slice(-8192);});
    this.proc.on('error',e=>this.fail(e));
    this.proc.on('exit',(code,signal)=>{this.exit={code,signal};if(!this.dead)this.fail(Error('Native reader exited: '+code));});
    // `close` follows stdio draining; `exit` alone may precede the final closed/cache receipt.
    this.proc.on('close',()=>{this.processClosed=true;this.exitResolve?.();});
    this.proc.stdin.on('error',e=>{if(!this.dead)this.fail(e);});
    this.proc.stdout.on('data',d=>{try{this.parse(d);}catch(e){this.fail(e);this.proc.kill();}});
    this.openTimer=setTimeout(()=>{this.fail(Error('Native reader open timeout'));this.proc.kill();},15000);
  }
  parse(chunk) {
    this.packets.push(chunk);
  }
  receive(h,pixels) {
    if(h.event==='ready'){
      if(h.protocol!==2||!Number.isSafeInteger(h.durationTicks)||h.durationTicks<0||
        !Number.isInteger(h.sourceWidth)||h.sourceWidth<1||!Number.isInteger(h.sourceHeight)||h.sourceHeight<1||
        !Number.isInteger(h.cacheCeilingBytes)||h.cacheCeilingBytes<128*1024**2||h.cacheCeilingBytes>384*1024**2)throw Error('Invalid native ready metadata');
      clearTimeout(this.openTimer);this.openInfo=h;this.openResolve(this);return;
    }
    if(h.event==='closed'){this.closedInfo=h;return;}
    if(h.event==='fatal'){this.fail(Error(h.message));this.proc.kill();return;}
    const cur=this.current;
    if(!cur||h.id!==cur.id||this.dead){this.stats.stale++;return;}
    if(h.event==='error'){this.stats.errors++;this.finish('error',{error:h.message});return;}
    if(h.event!=='frame')throw Error('Unexpected native event');
    this.stats.lastReceived=h;
    if(!Number.isInteger(h.width)||!Number.isInteger(h.height)||h.width<1||h.height<1||Math.max(h.width,h.height)>3840||Math.min(h.width,h.height)>2160)throw Error('Invalid native image shape');
    const yuv=h.pixelFormat==='yuv420p';
    if(yuv&&(!['bt709','bt601'].includes(h.colorMatrix)||typeof h.fullRange!=='boolean'))throw Error('Invalid native color metadata');
    if(!yuv&&h.pixelFormat&&!['rgba','rgba8'].includes(h.pixelFormat))throw Error('Unknown native pixel format');
    if(pixels.length!==(yuv?h.width*h.height+2*Math.ceil(h.width/2)*Math.ceil(h.height/2):h.width*h.height*4))throw Error('Invalid native pixel bytes');
    if(h.ptsTicks!==cur.target.ticks){this.stats.wrong++;this.finish('wrong-frame',{actualTicks:h.ptsTicks});return;}
    this.stats.frames++;this.stats.hwFrames+=h.hwFrames;this.stats.hwFallbacks+=h.hwFallbacks;this.stats.last=h;
    const renderAt=performance.now(); this.draw(pixels,{...h,ordinal:cur.target.ordinal});
    this.finish('exact',{actualPts:cur.target.pts,actualTicks:h.ptsTicks,metrics:h,pixels,renderMs:performance.now()-renderAt});
  }
  finish(status,more={}) { const cur=this.current;if(!cur)return;this.current=null;clearTimeout(cur.timer);cur.resolve({id:cur.id,target:cur.target.pts,targetTicks:cur.target.ticks,status,ms:performance.now()-cur.start,...more}); }
  fail(error){this.failure=error.message;clearTimeout(this.openTimer);this.openReject(error);this.finish('error',{error:error.message});}
  request(ordinal){
    if(this.dead)return Promise.resolve({status:'closed'});
    if(this.failure)return Promise.resolve({status:'error',error:this.failure});
    this.finish('superseded');this.blank();const target=targetAt(this.frames,ordinal);
    return new Promise(resolve=>{const id=++this.id;this.current={id,target,resolve,start:performance.now(),timer:setTimeout(()=>this.finish('timeout'),10000)};this.proc.stdin.write(`${id} ${target.ticks}\n`);});
  }
  cancel(){this.finish('superseded');if(!this.dead&&!this.exit&&!this.failure)this.proc.stdin.write(`cancel ${++this.id}\n`);}
  snapshot(){return {...this.stats,open:this.openInfo,stderr:this.stderr};}
  close(){
    if(this.closeTask)return this.closeTask;
    const at=performance.now();this.dead=true;this.finish('closed');clearTimeout(this.openTimer);
    if(!this.openInfo)this.openReject(Error('Native reader closed before ready'));
    this.closeTask=(async()=>{
      if(!this.processClosed){const done=new Promise(resolve=>{this.exitResolve=resolve;});
        if(!this.proc.stdin.destroyed&&!this.proc.stdin.writableEnded)this.proc.stdin.end('close\n');
        let timer;await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,2000)})]);clearTimeout(timer);
        if(!this.processClosed){this.proc.kill();let killTimer;await Promise.race([done,new Promise(r=>{killTimer=setTimeout(r,1000);})]);clearTimeout(killTimer);}}
      if(!this.processClosed)throw Error('视频读者尚未退出，缓存保留。');
      this.packets.reset();return {ms:performance.now()-at,ack:this.closedInfo||null,exit:this.exit||null};
    })();return this.closeTask;
  }
}
module.exports={FilmcraftClient,targetAt};
