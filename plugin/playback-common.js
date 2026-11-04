/* Shared playback controls and bounded RAM accounting; no decoder or filesystem. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(typeof window==='object'&&window)window.EVAPlaybackCommon=api;else if(root&&root.document)root.EVAPlaybackCommon=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){'use strict';
  const RAM_LIMIT = 1024 * 1024 * 1024;
  const RATE_STEPS = Object.freeze([.1, .2, .25, .5]);
  const RATE_PRESETS = Object.freeze([.1, .25, .5, 1, 1.5, 2, 3, 4]);
  const validRate = rate => Number.isFinite(rate) && rate >= .1 && rate <= 4;
  function steppedRate(rate, direction, step = .1) {
    if (!validRate(rate) || ![-1, 0, 1].includes(direction) || !RATE_STEPS.includes(step)) throw new Error('播放速度或调整步长无效。');
    return Math.max(100, Math.min(4000, Math.round(rate * 1000) + direction * Math.round(step * 1000))) / 1000;
  }
  function preparationWindow(frames, center, capacity, first = 0, last = frames.length - 1) {
    const count = Math.max(1, Math.min(last - first + 1, capacity)), order = [center], time = frames[center].time;
    let left = center - 1, right = center + 1;
    while (order.length < count) {
      if (right > last || left >= first && time - frames[left].time < frames[right].time - time) order.push(left--);
      else order.push(right++);
    }
    return { center, capacity: count, start: left + 1, end: right - 1, order };
  }
  function directionalWindow(frames, center, capacity, direction = 1, first = 0, last = frames.length - 1, looping = false, symmetricCore = false, outerDirection = direction) {
    const total = last - first + 1, count = Math.max(1, Math.min(total, capacity)), order = [center], seen = new Set(order);
    const span = frames[last].end - frames[first].time;
    let ahead = 1, behind = 1;
    const candidate = (step, sign) => {
      if (step >= total) return null;
      const raw = center + sign * step;
      if (!looping && (raw < first || raw > last)) return null;
      return first + ((raw - first) % total + total) % total;
    };
    const distance = (ordinal, sign) => {
      let delta = (frames[ordinal].time - frames[center].time) * sign;
      if (looping && delta < 0) delta += span;
      return delta;
    };
    while (order.length < count) {
      let a = candidate(ahead, direction), b = candidate(behind, -direction);
      while (a !== null && seen.has(a)) a = candidate(++ahead, direction);
      while (b !== null && seen.has(b)) b = candidate(++behind, -direction);
      if (a === null && b === null) break;
      // Source-time distance matters for VFR; favour the current direction 3:1.
      const weight = symmetricCore && order.length < 3 ? (ahead === 1 ? Infinity : 0) : outerDirection === direction ? 3 : 1/3;
      const next = b === null || a !== null && distance(a, direction) / weight <= distance(b, -direction) ? (ahead++, a) : (behind++, b);
      seen.add(next); order.push(next);
    }
    return { center, capacity: order.length, direction, start: Math.min(...order), end: Math.max(...order), order };
  }
  function decodedRanges(frames, ordinals, duration = 0) {
    const ranges = [];
    for (const ordinal of [...ordinals].sort((a, b) => a - b)) {
      const frame = frames[ordinal];
      if (!frame) continue;
      const end = ordinal === frames.length - 1 ? Math.max(frame.end, duration) : frame.end;
      if (!(end > frame.time)) continue;
      const last = ranges[ranges.length - 1];
      if (last && frame.time <= last.end) last.end = Math.max(last.end, end);
      else ranges.push({ start: frame.time, end });
    }
    return Object.freeze(ranges.map(range => Object.freeze(range)));
  }
  class Budget {
    constructor(limit) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('RAM预算必须是有效的正整数字节数。');
      this.limit = limit; this.used = 0; this.peak = 0; this.tokens = new Set();this.kindTotals=new Map();
    }
    reserve(bytes, kind, evict) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit) throw new Error('单次缓存预留超过RAM预算或字节无效。');
      while (this.used + bytes > this.limit && evict && evict()) { /* finite cache */ }
      if (this.used + bytes > this.limit) throw new Error('RAM预算不足，固定资源或在途任务不能提前释放。');
      const token = { bytes, kind }; this.tokens.add(token); this.used += bytes; this.peak = Math.max(this.peak, this.used);this._kind(token.kind,bytes,1); return token;
    }
    shrink(token, bytes, kind) {
      if (!this.tokens.has(token) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > token.bytes) throw new Error('无效的预算转移。');
      this._kind(token.kind,-token.bytes,-1);this._kind(kind,bytes,1);this.used -= token.bytes - bytes; token.bytes = bytes; token.kind = kind;
    }
    release(token) { if (token && this.tokens.delete(token)) { this._kind(token.kind,-token.bytes,-1);this.used -= token.bytes; token.bytes = 0; } }
    _kind(kind,bytes,count){const key=typeof kind==='symbol'?kind:String(kind),old=this.kindTotals.get(key)||{bytes:0,count:0};const next={bytes:old.bytes+bytes,count:old.count+count};if(next.count)this.kindTotals.set(key,next);else this.kindTotals.delete(key);}
    snapshot() {
      // Totals change only with reservations. Reading UI snapshots must not
      // rescan tens of thousands of resident compressed-image tokens.
      const kinds=Object.fromEntries([...this.kindTotals].map(([kind,row])=>[kind,row.bytes]));
      return { used: this.used, peak: this.peak, limit: this.limit, kinds };
    }
  }

return {Budget,ManagedBudget:Budget,decodedRanges,preparationWindow,directionalWindow,validRate,steppedRate,RATE_STEPS,RATE_PRESETS};
});
