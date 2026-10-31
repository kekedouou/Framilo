'use strict';
// Read-only ambient load. Never closes apps or treats unavailable telemetry as zero.
const {execFile}=require('child_process');
function monitor(){
 const samples=[];let active=null,closed=false;
 function sample(){if(closed||active)return;active=new Promise(resolve=>execFile('nvidia-smi',['--query-gpu=name,utilization.gpu,utilization.decoder,utilization.encoder,temperature.gpu,power.draw','--format=csv,noheader,nounits'],{windowsHide:true,timeout:2500,maxBuffer:8192},(error,stdout)=>{
   if(samples.length<601)samples.push({at:new Date().toISOString(),...(error?{unavailable:error.code||error.message}:{devices:stdout.trim().split(/\r?\n/).map(row=>{const [name,gpu,decode,encode,temp,power]=row.split(',').map(v=>v.trim());const number=v=>Number.isFinite(Number(v))?Number(v):null;return {name,gpuPercent:number(gpu),decoderPercent:number(decode),encoderPercent:number(encode),temperatureC:number(temp),powerW:number(power)};})})});resolve();}));active.finally(()=>active=null);}
 sample();const timer=setInterval(sample,1000);timer.unref();
 return {async stop(){closed=true;clearInterval(timer);if(active)await active;return samples;}};
}
module.exports={monitor};
