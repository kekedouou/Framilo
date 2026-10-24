'use strict';

// PCM blocks share Player's Web Audio clock and RAM ledger. Scheduling uses
// absolute context times; no timer callback is used as an audio boundary.
function createSegmentAudio({ info, context, read, budget, evict, onError }) {
  const entries = new Map(), sources = new Set(), loads = new Set(), prefetchFailed = new Set();
  let closed = false, cursor = null, generation = 0, serial = 0;
  function indexAt(time) {
    let low = 0, high = info.segments.length;
    while (low < high) { const mid = (low + high) >>> 1; if (info.segments[mid].start <= time) low = mid + 1; else high = mid; }
    return Math.max(0, Math.min(info.segments.length - 1, low - 1));
  }
  function prune() {
    while (entries.size > 6) {
      const candidates = [...entries.values()].filter(e => e.ready && !e.users).sort((a, b) => a.used - b.used);
      if (!candidates.length) break;
      const entry = candidates[0]; entries.delete(entry.index); budget.release(entry.token);
    }
  }
  function load(index) {
    if (closed) return Promise.reject(new Error('音频读取已关闭。'));
    let entry = entries.get(index);
    if (entry) { entry.used = ++serial; return entry.promise; }
    const range = info.segments[index];
    const estimate = Math.ceil((range.end - range.start + .1) * Math.max(48000, context.sampleRate) * info.audio.channels) * 4;
    entry = { index, token: null, users: 0, ready: false, used: ++serial, buffer: null, start: range.start }; entries.set(index, entry);
    entry.promise = (async () => {
      try {
        entry.token = budget.reserve(estimate * 3 + 8192, 'segment-audio-loading', evict);
        const value = await read(index);
        if (closed) return entry;
        if (value) {
          if (value.bytes.byteLength > estimate + 4096) throw new Error('分段音频超过预留容量。');
          const array = value.bytes.buffer.slice(value.bytes.byteOffset, value.bytes.byteOffset + value.bytes.byteLength);
          entry.buffer = await context.decodeAudioData(array); entry.start = value.start;
          const bytes = entry.buffer.length * entry.buffer.numberOfChannels * 4;
          if (bytes > estimate) throw new Error('分段音频解码超过预留容量。');
          budget.shrink(entry.token, bytes, 'segment-audio');
        } else budget.shrink(entry.token, 0, 'segment-audio');
        entry.ready = true; prune(); return entry;
      } catch (error) { entries.delete(index); budget.release(entry.token); entry.token = null; throw error; }
      finally { if (closed) { budget.release(entry.token); entries.delete(index); } }
    })();
    loads.add(entry.promise); entry.promise.then(() => loads.delete(entry.promise), () => loads.delete(entry.promise)); return entry.promise;
  }
  async function prime(media, loop) {
    const first = indexAt(media); await load(first);
    const nextTime = loop && info.segments[first].end >= loop.end ? loop.start : info.segments[first].end;
    if (nextTime < info.duration) await load(indexAt(nextTime));
  }
  function stop() {
    generation++; cursor = null; prefetchFailed.clear();
    for (const graph of sources) { graph.node.onended = null; try { graph.node.stop(); graph.node.disconnect(); } catch (_) { /* already ended */ } graph.entry.users--; }
    sources.clear(); prune();
  }
  function update() {
    if (!cursor || closed) return true;
    // Prepare PCM before the scheduling deadline; a cold segment may take
    // longer than the 350ms scheduling horizon. Keep at most two ahead.
    let playing = cursor.media - Math.max(0, cursor.when - context.currentTime) * cursor.rate;
    if (cursor.loop) { const span = cursor.loop.end - cursor.loop.start; playing = cursor.loop.start + ((playing-cursor.loop.start)%span+span)%span; }
    let upcoming = indexAt(Math.max(0, playing)); const seen = new Set();
    for (let n = 0; n < 3; n++) {
      if (seen.has(upcoming)) break; seen.add(upcoming);
      const candidate = upcoming, token = generation;
      if (!prefetchFailed.has(candidate)) load(candidate).catch(() => { if(generation===token)prefetchFailed.add(candidate); }); // Demand reports failures, without an idle retry loop.
      const end = info.segments[upcoming].end;
      if (cursor.loop && end >= cursor.loop.end) upcoming = indexAt(cursor.loop.start);
      else if (++upcoming >= info.segments.length) break;
    }
    for (let count = 0; count < 32 && cursor.when < context.currentTime + .35; count++) {
      if (cursor.media >= info.duration && !cursor.loop) return true;
      const index = indexAt(cursor.media), range = info.segments[index], entry = entries.get(index);
      if (!entry || !entry.ready) {
        const token = generation;
        load(index).catch(error => { if (!closed && generation === token && error.code !== 'MEDIA_CANCELLED') onError(error); });
        return cursor.when > context.currentTime + .004;
      }
      entry.used = ++serial;
      const end = Math.min(range.end, cursor.loop ? cursor.loop.end : info.duration);
      if (!(end > cursor.media)) throw new Error('音频分段播放范围无效。');
      if (entry.buffer) {
        const start = Math.max(cursor.media, entry.start), stopAt = Math.min(end, entry.start + entry.buffer.duration);
        if (stopAt > start) {
          const node = context.createBufferSource(), graph = { node, entry }; entry.users++;
          node.buffer = entry.buffer; node.playbackRate.value = cursor.rate; node.connect(context.destination);
          node.onended = () => { if (sources.delete(graph)) { entry.users--; node.disconnect(); prune(); } };
          sources.add(graph); node.start(cursor.when + (start - cursor.media) / cursor.rate, start - entry.start, stopAt - start);
        }
      }
      cursor.when += (end - cursor.media) / cursor.rate;
      cursor.media = cursor.loop && end >= cursor.loop.end ? cursor.loop.start : end;
    }
    prune(); return true;
  }
  function start(media, when, rate, loop) { stop(); cursor = { media, when, rate, loop }; return update(); }
  async function close() { closed = true; stop(); await Promise.allSettled([...loads]); for (const entry of entries.values()) budget.release(entry.token); entries.clear(); }
  return { prime, start, update, stop, close };
}
module.exports = { createSegmentAudio };
