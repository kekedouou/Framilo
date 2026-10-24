'use strict';
// Candidate scheduler. No filesystem, clock, source-FPS assumptions or Eagle API.
// load(key, {signal, maxBytes}) must bound its own buffers and settle after abort.
const cancelled = () => Object.assign(Error('Superseded video window'), { name: 'AbortError' });
function createWindowCache({ load, maxBytes, entryLimit, onBackgroundError = () => {} }) {
  if (typeof load !== 'function' || !Number.isSafeInteger(maxBytes) || !Number.isSafeInteger(entryLimit) ||
      entryLimit < 1 || maxBytes < entryLimit * 2) throw Error('Need room for visible and incoming chunks');
  const cache = new Map();
  let used = 0, visible = null, wanted = [], foreground = null, running = null, closed = false, serial = 0;
  const keyCheck = key => { if (typeof key !== 'string' || !key.length || key.length > 128) throw Error('Invalid chunk identity'); };
  function dispose(value) { if (value && typeof value.dispose === 'function') value.dispose(); }
  function drop(key) { const entry = cache.get(key); if (!entry) return; cache.delete(key); used -= entry.bytes; dispose(entry); }
  function makeRoom() {
    const ranked = [...cache.keys()].filter(k => k !== visible).sort((a, b) => {
      const rank = k => wanted.includes(k) ? wanted.indexOf(k) : Infinity;
      return rank(b) - rank(a);
    });
    while (used + entryLimit > maxBytes && ranked.length) drop(ranked.shift());
    return used + entryLimit <= maxBytes;
  }
  function rejectForeground(error) { if (!foreground) return; const pending = foreground; foreground = null; pending.reject(error); }
  function deliver() {
    if (!foreground || !cache.has(foreground.key)) return;
    const request = foreground; foreground = null; visible = request.key;
    request.resolve(cache.get(visible).value);
  }
  function pump() {
    if (closed || running) return;
    deliver();
    const key = wanted.find(k => !cache.has(k));
    if (key === undefined || !makeRoom()) return;
    const controller = new AbortController(), ticket = { key, controller, done: null };
    running = ticket;
    ticket.done = (async () => {
      let entry;
      try {
        entry = await load(key, { signal: controller.signal, maxBytes: entryLimit });
        if (closed || controller.signal.aborted || !wanted.includes(key)) { dispose(entry); entry = null; return; }
        if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > entryLimit || typeof entry.dispose !== 'function')
          throw Error('Chunk exceeded its reservation or lacks disposal');
        cache.set(key, entry); used += entry.bytes; entry = null; deliver();
      } catch (error) {
        dispose(entry);
        if (!closed && !controller.signal.aborted) {
          wanted = wanted.filter(k => k !== key);
          if (foreground?.key === key) rejectForeground(error);
          else { try { onBackgroundError(error); } catch (_) { /* Observers cannot block disposal. */ } }
        }
      } finally { running = null; if (!closed) pump(); }
    })();
  }
  function seek(key, nearby = []) {
    if (closed) return Promise.reject(Error('Cache closed'));
    keyCheck(key); if (!Array.isArray(nearby) || nearby.length > 16) throw Error('Bounded prefetch window required'); nearby.forEach(keyCheck);
    ++serial; rejectForeground(cancelled());
    wanted = [...new Set([key, ...nearby])].slice(0, Math.floor(maxBytes / entryLimit));
    // Stop stale prefetch even if it remains in the new neighborhood: target first.
    if (running && running.key !== key && !cache.has(key)) running.controller.abort();
    const result = new Promise((resolve, reject) => { foreground = { key, resolve, reject }; });
    deliver(); pump(); return result;
  }
  async function close() {
    if (closed) { if (running) await running.done; return; }
    closed = true; ++serial; wanted = []; rejectForeground(cancelled());
    if (running) { running.controller.abort(); await running.done; }
    for (const key of [...cache.keys()]) drop(key); visible = null;
  }
  return Object.freeze({ seek, close, snapshot: () => Object.freeze({ used, reserved: running ? entryLimit : 0, maxBytes,
    visible, cached: [...cache.keys()], wanted: [...wanted], running: running?.key || null, serial, closed }) });
}
module.exports = { createWindowCache };
