'use strict';
// Retain verified disk-segment leases for this source session. Byte storage
// remains owned/accounted by cache; no compressed frame data is kept here.
function createProxyBackground({ info, prepare, release, enqueue, idle, budget, closeBatch, emit,
  onSegment = () => {}, schedule = setTimeout, cancel = clearTimeout }) {
  if (typeof budget !== 'function' || typeof closeBatch !== 'function') throw new Error('代理后台缺少长会话预算或关闭能力。');
  const ready = new Set(), published = new Set(), retained = new Map(), pendingRelease = new Set(), retaining = new Set();
  let cursor = 0, timer = null, running = null, closed = false, state = 'preparing', failure = null, cleanupFailure = null, preparationCleanupFailure = null, closing = null, transitioning = null;
  const total = info.segments.length;
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
  function kick() {
    if (closed || state !== 'preparing' || timer !== null || running) return;
    timer = schedule(() => { timer = null; pump(); }, 50);
  }
  function pump() {
    if (closed || state !== 'preparing') return;
    if (!idle()) { kick(); return; }
    const controller = new AbortController(), work = running = { controller, promise: null };
    work.promise = enqueue(async () => {
      try {
      if (closed || controller.signal.aborted) return;
      while (cursor < total && retained.has(cursor)) cursor++;
      if (cursor >= total) { if (published.size === total) await finishState('complete'); return; }
      const ordinal = cursor, disk = await budget(controller.signal);
      if (closed || controller.signal.aborted) return;
      if (!disk || !Number.isSafeInteger(disk.usedBytes) || disk.usedBytes < 0 || !Number.isSafeInteger(disk.diskLimitBytes) || disk.diskLimitBytes <= 0)
        throw Object.assign(new Error('代理长会话预算账本无效。'), { code: 'PROXY_BUDGET_INVALID' });
      // Do not generate a tail which evicts the already prepared front forever.
      if (disk.usedBytes > disk.diskLimitBytes - 128 * 1024 ** 2) { await finishState('budget'); return; }
      const value = await prepare(ordinal, controller.signal);
      if (closed || controller.signal.aborted) { await discard(value); return; }
      await retain(ordinal, value); cursor++;
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
  function foreground() { if (running) running.controller.abort(); }
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
      const values = [...new Set([...retained.values(), ...pendingRelease])];
      const results = await Promise.allSettled(values.map(async value => {
        await discard(value);
        for (const [ordinal, current] of retained) if (current === value) retained.delete(ordinal);
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
  return { kick, foreground, mark, retain, get, close, snapshot };
}
module.exports = { createProxyBackground };
