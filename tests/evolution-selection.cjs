'use strict';
const assert=require('assert'),{EventEmitter}=require('events');
const {windowStart,journal}=require('../prototypes/preview-quality/selected-display.cjs');
const {start}=require('../prototypes/preview-quality/selected-display-client.cjs');
assert.strictEqual(windowStart(4,10),4);assert.strictEqual(windowStart(10,10),9);
assert.strictEqual(windowStart(-2,.5),0);assert.strictEqual(windowStart(NaN,5),0);
const rows=[];let closed=0,flushed=0;const records=journal({append:x=>rows.push(x),flush:()=>flushed++,close:()=>closed++});
records.writer('generation').append({sourceSha256:'same'});records.writer('generation').close();records.save('cleanup',{removed:true});
assert.strictEqual(closed,0);assert.strictEqual(rows.length,2);assert.strictEqual(flushed,2);
function fake(){const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr={resume(){}};
  child.stdin=new EventEmitter();child.stdin.writable=true;child.sent=[];child.stdin.write=x=>child.sent.push(JSON.parse(x));
  child.stdin.end=x=>{child.sent.push(JSON.parse(x));child.stdin.writable=false;setImmediate(()=>child.emit('close',0));};
  child.output=x=>child.stdout.emit('data',Buffer.from(JSON.stringify(x)+'\n'));return child;}
async function main(){
  const {harness}=require('./t1-app.cjs'),fs=require('fs'),path=require('path'),{bridgeApp}=require('../prototypes/preview-quality/prepare-host.cjs');
  const h=harness({code:bridgeApp(fs.readFileSync(path.join(__dirname,'../plugin/app.js'),'utf8')),deferNativeAck:true});
  await h.hooks.onPluginCreate({path:h.root});let release;
  const pending=new Promise(r=>release=r);h.win.EVAEvolutionBeforeRun=()=>pending;h.requestClose();
  const close=h.win.EVAEvolutionClose();assert.strictEqual(h.win.EVAEvolutionClose(),close);
  assert.strictEqual(h.windowState().destroyed,false);release();await close;await h.flushNativeTasks();assert.strictEqual(h.windowState().destroyed,true);
  const a=fake(),first=start({id:'first',name:'中文 空格',filePath:'D:/first.mp4'},2,null,{spawn:()=>a});
  assert.strictEqual(a.sent[0].source.id,'first');assert.strictEqual(a.sent[0].time,2);
  assert.throws(()=>start({id:'overlap'},0,null,{spawn:()=>fake()}),/上一段/);
  a.output({state:'ready',location:{meta:'first'},frames:30});assert.strictEqual((await first.ready).location.meta,'first');
  const p=first.stop();assert.strictEqual(first.stop(),p);await p;assert.strictEqual(a.sent.length,2);
  const b=fake(),second=start({id:'second',filePath:'D:/second.mp4'},0,null,{spawn:()=>b});
  assert.strictEqual(b.sent[0].source.id,'second');const stopped=second.stop();await assert.rejects(second.ready,/未完成/);await stopped;
  assert.strictEqual(b.sent[1].type,'release');
  const c=fake(),third=start({id:'third'},0,null,{spawn:()=>c});c.output({state:'failed',message:'生成失败'});
  await assert.rejects(third.ready,/生成失败/);await third.stop();
  console.log('evolution selection: explicit source forwarding, time bounds, shared journal, ready/cancel/error and joined stop passed; no Eagle/media writes');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
