'use strict';
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');
const { PacketReader } = require('./wire.cjs');
const TICKS = 254016000000;
function targetAt(index, seconds) {
  const us = Math.round(seconds * 1e6); let lo=0, hi=index.sorted.length;
  while(lo<hi) { const mid=(lo+hi)>>>1; if(index.sorted[mid].pts<=us) lo=mid+1; else hi=mid; }
  const item=index.sorted[Math.max(0,lo-1)], packet=index.packets[item.n];
  const [num, den]=index.timeBase.split('/').map(Number);
  const ticks=Number(BigInt(packet.sourcePts)*BigInt(num)*BigInt(TICKS)/BigInt(den));
  if(!Number.isSafeInteger(ticks)) throw Error('Unsafe source timestamp');
  return {pts:item.pts,ticks};
}
class FilmcraftClient {
  static async create(options) { const client=new FilmcraftClient(options); await client.ready; return client; }
  constructor({exe,source,index,software=false,windowed=false,draw=()=>{},blank=()=>{}}) {
    Object.assign(this,{index,draw,blank,id:0,current:null,dead:false,stats:{frames:0,stale:0,wrong:0,errors:0,hwFrames:0,hwFallbacks:0}});
    this.packets=new PacketReader((header,pixels)=>this.receive(header,pixels));
    this.ready=new Promise((resolve,reject)=>{this.openResolve=resolve;this.openReject=reject;});
    this.proc=spawn(exe,[source,software?'software':'hardware',windowed?'target-readback':'all-readback'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.stderr=''; this.proc.stderr.on('data',d=>{this.stderr=(this.stderr+d.toString()).slice(-8192);});
    this.proc.on('error',e=>this.fail(e));
    this.proc.on('exit',(code,signal)=>{this.exit={code,signal};if(!this.dead)this.fail(Error('Native reader exited: '+code));this.exitResolve?.();});
    this.proc.stdin.on('error',e=>{if(!this.dead)this.fail(e);});
    this.proc.stdout.on('data',d=>{try{this.parse(d);}catch(e){this.fail(e);this.proc.kill();}});
    this.openTimer=setTimeout(()=>{this.fail(Error('Native reader open timeout'));this.proc.kill();},15000);
  }
  parse(chunk) {
    this.packets.push(chunk);
  }
  receive(h,pixels) {
    if(h.event==='ready'){clearTimeout(this.openTimer);this.openInfo=h;this.openResolve(this);return;}
    if(h.event==='closed'){this.closedInfo=h;return;}
    if(h.event==='fatal'){this.fail(Error(h.message));this.proc.kill();return;}
    const cur=this.current;
    if(!cur||h.id!==cur.id||this.dead){this.stats.stale++;return;}
    if(h.event==='error'){this.stats.errors++;this.finish('error',{error:h.message});return;}
    if(h.event!=='frame')throw Error('Unexpected native event');
    this.stats.lastReceived=h;
    if(!Number.isInteger(h.width)||!Number.isInteger(h.height)||h.width<1||h.height<1||h.width*h.height*4!==pixels.length)throw Error('Invalid native image shape');
    if(h.ptsTicks!==cur.target.ticks){this.stats.wrong++;this.finish('wrong-frame',{actualTicks:h.ptsTicks});return;}
    this.stats.frames++;this.stats.hwFrames+=h.hwFrames;this.stats.hwFallbacks+=h.hwFallbacks;this.stats.last=h;
    const renderAt=performance.now(); this.draw(pixels,h);
    this.finish('exact',{actualPts:cur.target.pts,actualTicks:h.ptsTicks,metrics:h,renderMs:performance.now()-renderAt});
  }
  finish(status,more={}) { const cur=this.current;if(!cur)return;this.current=null;clearTimeout(cur.timer);cur.resolve({id:cur.id,target:cur.target.pts,targetTicks:cur.target.ticks,status,ms:performance.now()-cur.start,...more}); }
  fail(error){this.failure=error.message;clearTimeout(this.openTimer);this.openReject(error);this.finish('error',{error:error.message});}
  seek(seconds){
    if(this.dead)return Promise.resolve({status:'closed'});
    if(this.failure)return Promise.resolve({status:'error',error:this.failure});
    this.finish('superseded');this.blank();const target=targetAt(this.index,seconds);
    return new Promise(resolve=>{const id=++this.id;this.current={id,target,resolve,start:performance.now(),timer:setTimeout(()=>this.finish('timeout'),10000)};this.proc.stdin.write(`${id} ${target.ticks}\n`);});
  }
  snapshot(){return {...this.stats,open:this.openInfo,stderr:this.stderr};}
  async close(){
    const at=performance.now();this.dead=true;this.finish('closed');clearTimeout(this.openTimer);
    if(!this.exit){const done=new Promise(resolve=>{this.exitResolve=resolve;});this.proc.stdin.end('close\n');let timer;await Promise.race([done,new Promise(resolve=>{timer=setTimeout(resolve,2000)})]);clearTimeout(timer);if(!this.exit){this.proc.kill();await Promise.race([done,new Promise(r=>setTimeout(r,1000))]);}}
    this.packets.reset();return {ms:performance.now()-at,ack:this.closedInfo||null,exit:this.exit||null};
  }
}
module.exports={FilmcraftClient,targetAt};
