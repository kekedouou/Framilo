'use strict';

// Local drawing maintenance only; no library writes, media scans or UI work.
function createDrawingLifetime({ store, adapter, protectedItem = () => null, report = () => {},
  schedule = setTimeout, cancel = clearTimeout, yieldWork = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
  let stopped = false, pending = null, timer = null, generation = 0, cursor = '';
  const protectedScope = scope => {
    const active = protectedItem();
    return active && active.itemId === scope.itemId; // Conservative across a library transition.
  };
  async function pass() {
    const token = generation; let checked = 0, removed = 0;
    try {
      const library = adapter.drawingLibrary();
      const current = () => !stopped && token === generation && adapter.drawingLibrary() === library;
      for await (const candidate of store.maintenanceCandidates(library, cursor)) {
        cursor = candidate.key || cursor;
        if (!current()) break;
        await yieldWork(); // Never process a whole collection in one UI turn.
        if (!current()) break;
        if (!candidate.scope) continue;
        if (protectedScope(candidate.scope)) continue;
        checked++;
        const first = await adapter.drawingDeletion(candidate.scope);
        if (!first || !current() || protectedScope(candidate.scope)) continue;
        await yieldWork();
        const second = await adapter.drawingDeletion(candidate.scope);
        if (!second || first !== second || !current() || protectedScope(candidate.scope)) continue;
        if (store.removeDeleted(candidate, () => current() && !protectedScope(candidate.scope))) removed++;
      }
      if (!stopped) report({ checked, removed });
    } catch (error) { if (!stopped) report({ checked, removed, error: String(error.message) }); }
    return { checked, removed };
  }
  function run() {
    if (stopped) return Promise.resolve({ checked: 0, removed: 0 });
    if (pending) return pending;
    if (timer !== null) { cancel(timer); timer = null; }
    pending = pass().finally(() => {
      pending = null;
      if (!stopped) timer = schedule(() => { timer = null; run(); }, 30000);
    });
    return pending;
  }
  async function stop() {
    stopped = true; generation++;
    if (timer !== null) { cancel(timer); timer = null; }
    if (pending) await pending;
  }
  return Object.freeze({ run, stop });
}
module.exports = { createDrawingLifetime };
