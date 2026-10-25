'use strict';
// Retain verified disk-segment leases for this source session. Byte storage
// remains owned/accounted by cache; no compressed frame data is kept here.
function createProxyBackground({ info, prepare, release, enqueue, idle, budget, closeBatch, emit,
  prepareRecord, onSegment = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
  if (typeof budget !== 'function' || typeof closeBatch !== 'function') throw new Error('代理后台缺少长会话预算或关闭能力。');
  const ready = new Set(), published = new Set(), retained = new Map(), pendingRelease = new Set(), retaining = new Set();
  let cursor = 0, timer = null, running = null, closed = false, state = 'preparing', failure = null, cleanupFailure = null, preparationCleanupFailure = null, closing = null, transitioning = null;
  const total = info.segments.length;
  const records=new Map(),preparedRecords=new Set();let allRecords=[],visibleRecords=[],recordSegments=[],targetOrdinal=null,direction=1,recordClock=0;
  let visibleCursor=0,allCursor=0,recordSegmentCursor=0;
  const valid = ordinal => Number.isSafeInteger(ordinal) && ordinal >= 0 && ordinal < total;
  const snapshot = () => ({ stage: state, ready: retained.size, total, ...(failure ? { error: failure } : {}) });
  const notify = () => emit(snapshot());
  const sameLease = (left, right) => left === right || left?.leaseId && left.leaseId === right?.leaseId;
  function finishState(next) {
    if (transitioning) return transitioning;
    const operation = Promise.resolve().then(closeBatch).then(() => {
      // Ready leases are usable while the final full-root reconciliation runs.
      // Do not report complete/budget until that reconciliation has succeeded.
      if (!closed) { state = next; notify(); }
    }).catch(error => {
      if (!closed) { state = 'error'; failure = error.message; notify(); }
      throw error;
    });
    transitioning = operation;
    operation.then(() => { if (transitioning === operation) transitioning = null; },
      () => { if (transitioning === operation) transitioning = null; });
    return operation;
  }
  async function discard(value) {
    pendingRelease.add(value);
    try { await release(value); pendingRelease.delete(value); }
    catch (error) { cleanupFailure = error; throw error; }
  }
  function retain(ordinal, value) {
    if (!valid(ordinal) || !value || typeof value !== 'object') return Promise.reject(Error('无效的代理分段占用记录。'));
    const work = (async () => {
      const existing = retained.get(ordinal);
      if (closed) {
        if (!existing || !sameLease(existing, value)) await discard(value);
        throw Object.assign(Error('代理会话已关闭。'), { code: 'MEDIA_CANCELLED' });
      }
      if (existing && sameLease(existing, value)) return existing;
      if (existing) {
        await discard(value);
        if (closed) throw Object.assign(Error('代理会话已关闭。'), { code: 'MEDIA_CANCELLED' });
        return existing;
      }
      // Install synchronously, before a concurrent foreground/background result.
      retained.set(ordinal, value); ready.add(ordinal);
      await onSegment(ordinal, value); published.add(ordinal); notify();
      if (published.size === total) await finishState('complete');
      return value;
    })();
    retaining.add(work); work.then(() => retaining.delete(work), () => retaining.delete(work)); return work;
  }
  function get(ordinal) { return valid(ordinal) ? retained.get(ordinal) : undefined; }
  function groupAt(time){let low=0,high=total;while(low<high){const mid=(low+high)>>>1;if(info.segments[mid].start<=time)low=mid+1;else high=mid;}return Math.max(0,low-1);}
  function target(time){
    if(closed||!Number.isFinite(time))return;
    const next=groupAt(time);if(targetOrdinal!==null&&next!==targetOrdinal)direction=next>targetOrdinal?1:-1;
    const changed=next!==targetOrdinal;targetOrdinal=next;
    if(changed&&running&&!retained.has(next)&&(running.kind!=='segment'||running.ordinal!==next))running.controller.abort();
    kick();
  }
  function prioritizeRecords(value){
    const validate=items=>Array.isArray(items)&&items.length<=120000&&items.every(n=>Number.isSafeInteger(n)&&n>=0&&!!info.frames?.[n]);
    if(!value||!validate(value.all)||!validate(value.visible))throw Error('后台标注帧列表无效。');
    allRecords=[...new Set(value.all)];visibleRecords=[...new Set(value.visible)];
    visibleCursor=0;allCursor=0;recordSegmentCursor=0;
    recordSegments=[...new Set([...visibleRecords,...allRecords].map(n=>groupAt(info.frames[n].time)))];kick();
  }
  async function retainRecord(ordinal,value){
    if(!Number.isSafeInteger(ordinal)||!info.frames?.[ordinal]||!value)throw Error('标注静帧占用无效。');
    const prior=records.get(ordinal);
    if(closed){if(!prior||!sameLease(prior.value,value))await discard(value);throw Object.assign(Error('代理会话已关闭。'),{code:'MEDIA_CANCELLED'});}
    if(prior){if(!sameLease(prior.value,value))await discard(value);if(prior.retiring)throw prior.failure||Error('标注静帧正在交还。');prior.used=++recordClock;return prior.value;}
    while(records.size>=32){const candidates=[...records.entries()].filter(([,entry])=>!entry.users&&!entry.retiring).sort((a,b)=>a[1].used-b[1].used);if(!candidates.length){await discard(value);throw Error('标注静帧占用池已满。');}const [key,entry]=candidates[0];
      // The input-side cached borrow can run while release is awaiting I/O.
      // Withdraw the capability before starting that release, not afterwards.
      entry.retiring=true;try{await discard(entry.value);}catch(error){entry.failure=error;pendingRelease.add(value);throw error;}records.delete(key);}
    records.set(ordinal,{value,users:0,used:++recordClock});preparedRecords.add(ordinal);return value;
  }
  function borrowRecord(ordinal){const entry=records.get(ordinal);if(closed||!entry||entry.retiring)return null;entry.users++;entry.used=++recordClock;return entry.value;}
  function returnRecord(value){for(const entry of records.values())if(sameLease(entry.value,value)){if(entry.users<1)throw Error('标注静帧重复交还。');entry.users--;return true;}throw Error('标注静帧占用不属于当前源。');}
  function select(){
    if(targetOrdinal!==null)for(const n of [targetOrdinal,targetOrdinal+direction,targetOrdinal-direction,targetOrdinal+2*direction,targetOrdinal-2*direction])if(valid(n)&&!retained.has(n))return {kind:'segment',ordinal:n};
    if(prepareRecord){
      while(visibleCursor<visibleRecords.length&&preparedRecords.has(visibleRecords[visibleCursor]))visibleCursor++;
      if(visibleCursor<visibleRecords.length)return {kind:'record',ordinal:visibleRecords[visibleCursor]};
      while(allCursor<allRecords.length&&preparedRecords.has(allRecords[allCursor]))allCursor++;
      if(allCursor<allRecords.length)return {kind:'record',ordinal:allRecords[allCursor]};
    }
    while(recordSegmentCursor<recordSegments.length&&retained.has(recordSegments[recordSegmentCursor]))recordSegmentCursor++;
    if(recordSegmentCursor<recordSegments.length)return {kind:'segment',ordinal:recordSegments[recordSegmentCursor]};
    while(cursor<total&&retained.has(cursor))cursor++;
    return cursor<total?{kind:'segment',ordinal:cursor}:null;
  }
  function kick() {
    if (closed || !['preparing','complete'].includes(state) || timer !== null || running || state==='complete'&&!select()) return;
    timer = schedule(() => { timer = null; pump(); }, 50);
  }
  function pump() {
    if (closed || !['preparing','complete'].includes(state)) return;
    if (!idle()) { kick(); return; }
    const controller = new AbortController(), work = running = { controller, promise: null };
    work.promise = enqueue(async () => {
      try {
      if (closed || controller.signal.aborted) return;
      const selected=select();if(!selected){if(state!=='complete'&&published.size===total)await finishState('complete');return;}
      const {ordinal,kind}=selected;work.ordinal=ordinal;work.kind=kind;const disk=await budget(controller.signal);
      if (closed || controller.signal.aborted) return;
      if (!disk || !Number.isSafeInteger(disk.usedBytes) || disk.usedBytes < 0 || !Number.isSafeInteger(disk.diskLimitBytes) || disk.diskLimitBytes <= 0)
        throw Object.assign(new Error('代理长会话预算账本无效。'), { code: 'PROXY_BUDGET_INVALID' });
      // Do not generate a tail which evicts the already prepared front forever.
      if (disk.usedBytes > disk.diskLimitBytes - 128 * 1024 ** 2) { await finishState('budget'); return; }
      const value = kind==='record'?await prepareRecord(ordinal,controller.signal):await prepare(ordinal, controller.signal);
      if (closed || controller.signal.aborted) { await discard(value); return; }
      if(kind==='record')await retainRecord(ordinal,value);else await retain(ordinal,value);
      } catch (error) {
      if (error.code === 'MEDIA_CLEANUP_FAILED') preparationCleanupFailure = error;
      if (!closed && error.code !== 'MEDIA_CANCELLED' && error.name !== 'AbortError') {
        // Keep this direct: this catch still belongs to the current queued work.
        // Adding another queued close and awaiting it would deadlock the worker.
        try { await closeBatch(); } catch (closeError) { cleanupFailure = closeError; }
        state = 'error'; failure = error.message + (cleanupFailure ? '；长会话关闭失败：' + cleanupFailure.message : ''); notify();
      }
      }
    }).finally(() => { if (running === work) running = null; kick(); });
  }
  function foreground(ordinal,kind='segment') { if (running && !(running.kind===kind&&Number.isSafeInteger(ordinal)&&running.ordinal===ordinal)) running.controller.abort(); }
  function mark(ordinal) {
    if (!valid(ordinal)) throw Error('无效的代理分段编号。');
    if (closed) return; ready.add(ordinal); notify();
  }
  function close() {
    if (closing) return closing;
    closed = true; state = 'closed';
    if (timer !== null) { cancel(timer); timer = null; }
    foreground();
    const operation = (async () => {
      if (running) await running.promise;
      while (retaining.size) await Promise.allSettled([...retaining]);
      if([...records.values()].some(entry=>entry.users))throw Object.assign(Error('标注静帧仍在读取。'),{code:'PROXY_RELEASE_FAILED'});
      const values = [...new Set([...retained.values(), ...[...records.values()].map(entry=>entry.value), ...pendingRelease])];
      const results = await Promise.allSettled(values.map(async value => {
        await discard(value);
        for (const [ordinal, current] of retained) if (current === value) retained.delete(ordinal);
        for (const [ordinal, entry] of records) if(entry.value===value)records.delete(ordinal);
      }));
      const rejected = results.filter(result => result.status === 'rejected');
      try { await closeBatch(); } catch (error) { rejected.push({ status: 'rejected', reason: error }); }
      if (rejected.length) {
        const error = Object.assign(Error('代理占用释放失败：' + rejected.map(result => result.reason?.message || result.reason).join('；')),
          { code: 'PROXY_RELEASE_FAILED', failures: rejected.map(result => result.reason) });
        cleanupFailure = error; throw error;
      }
      // Preparation cleanup can own unknown output outside the retained set.
      if (preparationCleanupFailure) throw preparationCleanupFailure;
      cleanupFailure = null;
    })();
    closing = operation; operation.then(() => { if (closing === operation) closing = null; }, () => { if (closing === operation) closing = null; });
    return operation;
  }
  return { kick, foreground, mark, retain, get, close, snapshot, target, prioritizeRecords, retainRecord, borrowRecord, returnRecord, getRecord:ordinal=>!closed&&!records.get(ordinal)?.retiring?records.get(ordinal)?.value:undefined };
}
module.exports = { createProxyBackground };
