'use strict';
const assert=require('assert'),{EventEmitter}=require('events'),{create}=require('../prototypes/preview-quality/native-reference.cjs');
function fixture(){const v=new EventEmitter();let next=0;const callbacks=new Map();Object.assign(v,{readyState:1,style:{},pause(){},addEventListener:v.on.bind(v),removeEventListener:v.off.bind(v),
  requestVideoFrameCallback:f=>{callbacks.set(++next,f);return next;},cancelVideoFrameCallback:id=>callbacks.delete(id),load(){v.loaded=true;},removeAttribute(){v.removed=true;}});
  const timers=new Set();return {v,callbacks,timers,reference:create(v,{setTimeout:f=>{timers.add(f);return f;},clearTimeout:f=>timers.delete(f)}),
    frame(time){const [id,f]=callbacks.entries().next().value;callbacks.delete(id);f(0,{mediaTime:time});}};
}
(async()=>{let h=fixture();const a=h.reference.seek(1,1.04);h.frame(0);assert.strictEqual(h.v.style.visibility,'hidden');h.frame(1);assert.strictEqual((await a).sameFrame,true);
  assert.strictEqual(h.callbacks.size,0);assert.strictEqual(h.timers.size,0);assert.strictEqual((await h.reference.seek(1,1.04)).sameFrame,true);
  const old=h.reference.seek(2,2.04),newest=h.reference.seek(3,3.04);assert((await old).cancelled);h.frame(3);assert.strictEqual((await newest).time,3);
  const cancelled=h.reference.seek(4,4.04);h.reference.dispose();assert((await cancelled).cancelled);assert(h.v.removed&&h.v.loaded);assert.strictEqual(h.callbacks.size,0);assert.strictEqual(h.timers.size,0);
  h=fixture();const timeout=h.reference.seek(1,1.04);[...h.timers][0]();await assert.rejects(timeout,/未成立/);assert.strictEqual(h.v.style.visibility,'hidden');assert.strictEqual(h.callbacks.size,0);
  h=fixture();const error=h.reference.seek(1,1.04);h.v.emit('error');await assert.rejects(error,/解码失败/);h.reference.dispose();
  h=fixture();delete h.v.requestVideoFrameCallback;await assert.rejects(h.reference.seek(1,1.04),/未冒充同帧/);h.reference.dispose();
  console.log('native color reference: stale frames, latest seek, same-frame reuse, timeout, error and close release checked with simulated video; not Eagle GUI');
})().catch(e=>{console.error(e);process.exitCode=1;});
