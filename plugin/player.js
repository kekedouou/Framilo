/* Canvas/Web Audio playback core. Host, filesystem and frame index are injected. */
(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  // Eagle can expose window and CommonJS together; neither export excludes the other.
  if (typeof window === 'object' && window) window.EVAPlayer = exported;
  else if (root && root.document) root.EVAPlayer = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RAM_LIMIT = 1024 * 1024 * 1024;
  const RATE_STEPS = Object.freeze([.1, .2, .25, .5]);
  const RATE_PRESETS = Object.freeze([.1, .25, .5, 1, 1.5, 2, 3, 4]);
  const validRate = rate => Number.isFinite(rate) && rate >= .1 && rate <= 4;
  function steppedRate(rate, direction, step = .1) {
    if (!validRate(rate) || ![-1, 0, 1].includes(direction) || !RATE_STEPS.includes(step)) throw new Error('播放速度或调整步长无效。');
    return Math.max(100, Math.min(4000, Math.round(rate * 1000) + direction * Math.round(step * 1000))) / 1000;
  }
  function preparationWindow(frames, center, capacity) {
    const count = Math.max(1, Math.min(frames.length, capacity)), order = [center], time = frames[center].time;
    let left = center - 1, right = center + 1;
    while (order.length < count) {
      if (right >= frames.length || left >= 0 && time - frames[left].time < frames[right].time - time) order.push(left--);
      else order.push(right++);
    }
    return { center, capacity: count, start: left + 1, end: right - 1, order };
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
      this.limit = limit; this.used = 0; this.peak = 0; this.tokens = new Set();
    }
    reserve(bytes, kind, evict) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > this.limit) throw new Error('单次缓存预留超过RAM预算或字节无效。');
      while (this.used + bytes > this.limit && evict && evict()) { /* finite cache */ }
      if (this.used + bytes > this.limit) throw new Error('RAM预算不足，固定资源或在途任务不能提前释放。');
      const token = { bytes, kind }; this.tokens.add(token); this.used += bytes; this.peak = Math.max(this.peak, this.used); return token;
    }
    shrink(token, bytes, kind) {
      if (!this.tokens.has(token) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > token.bytes) throw new Error('无效的预算转移。');
      this.used -= token.bytes - bytes; token.bytes = bytes; token.kind = kind;
    }
    release(token) { if (token && this.tokens.delete(token)) { this.used -= token.bytes; token.bytes = 0; } }
    snapshot() {
      const kinds = {}; this.tokens.forEach(token => { kinds[token.kind] = (kinds[token.kind] || 0) + token.bytes; });
      return { used: this.used, peak: this.peak, limit: this.limit, kinds };
    }
  }
  function readBarcode(context, expected, ordinal) {
    const spec = expected && expected.barcode;
    if (!spec || !expected.barcodes || expected.barcodes[ordinal] === undefined) return null;
    const pixels = context.getImageData(spec.x + spec.sampleXOffset, spec.y + spec.sampleYOffset, (spec.bits - 1) * spec.step + 1, 1).data;
    let actual = 0, uncertain = false; const samples = [];
    for (let bit = 0; bit < spec.bits; bit++) {
      const at = bit * spec.step * 4, value = (pixels[at] + pixels[at + 1] + pixels[at + 2]) / 3; samples.push(value);
      if (value > 175) actual += 2 ** bit; else if (value >= 80) uncertain = true;
    }
    return { actual: uncertain ? null : actual, expected: expected.barcodes[ordinal], ok: uncertain ? null : actual === expected.barcodes[ordinal],
      uncertain, samples, method: 'canvas-pixel-barcode-lsb-left-single-row-readback' };
  }
  function browserEnvironment() {
    return { now: () => performance.now(), raf: callback => requestAnimationFrame(callback), caf: id => cancelAnimationFrame(id),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      decodeImage: bytes => createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })),
      createAudioContext: options => new (globalThis.AudioContext || globalThis.webkitAudioContext)(options) };
  }
  function freezeInfo(info) {
    const frames = info.frames.map(frame => Object.freeze(Object.assign({}, frame, { timeBase: Object.freeze(frame.timeBase.slice()) })));
    const expected = info.expected ? Object.freeze(Object.assign({}, info.expected, {
      barcodes: info.expected.barcodes ? Object.freeze(info.expected.barcodes.slice()) : undefined,
      times: info.expected.times ? Object.freeze(info.expected.times.slice()) : undefined,
      barcode: info.expected.barcode ? Object.freeze(Object.assign({}, info.expected.barcode)) : undefined
    })) : null;
    return Object.freeze(Object.assign({}, info, { frames: Object.freeze(frames), source: Object.freeze(Object.assign({}, info.source)),
      audio: info.audio ? Object.freeze(Object.assign({}, info.audio)) : null,
      ...(info.segments ? { segments: Object.freeze(info.segments.map(segment => Object.freeze({ ...segment }))) } : {}),
      ...(info.framePack ? { framePack: Object.freeze(Object.assign({}, info.framePack)) } : {}), expected }));
  }
  class Player {
    constructor(options) {
      if (!options || !options.canvas || typeof options.readAsset !== 'function') throw new Error('缺少画布或受限资源读取函数。');
      this.index = options.frameIndex;
      if (!this.index || ['validateIndex', 'frameAt', 'stepIndex', 'audioStartPlan'].some(name => typeof this.index[name] !== 'function')) throw new Error('缺少纯帧索引模块。');
      this.env = Object.assign(browserEnvironment(), options.env || {}); this.canvas = options.canvas;
      this.ctx = this.canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' }); if (!this.ctx) throw new Error('无法取得2D画布。');
      this.readAsset = options.readAsset; this.readFrameBatch = options.readFrameBatch;
      this.setMediaTarget = options.setMediaTarget; this.createSegmentAudio = options.createSegmentAudio; this.segmentAudio = null;
      this.createFrameDecoder = options.createFrameDecoder; this.frameDecoder = null;
      this.cancelMediaReads = options.cancelMediaReads; this.prefetchMedia = options.prefetchMedia;
      this.emit = options.emit || (() => {}); this.onChange = options.onChange || (() => {});
      this.budget = options.budget || new Budget(options.ramBytes === undefined ? RAM_LIMIT : options.ramBytes);
      if (['reserve', 'shrink', 'release', 'snapshot'].some(name => typeof this.budget[name] !== 'function')) throw new Error('注入的RAM账本无效。');
      const ledgerLimit = this.budget.snapshot().limit;
      if (!Number.isSafeInteger(ledgerLimit) || ledgerLimit <= 0) throw new Error('注入的RAM账本无效。');
      this.playbackGuardMs = options.playbackGuardMs === undefined ? 150 : options.playbackGuardMs;
      if (!Number.isFinite(this.playbackGuardMs) || this.playbackGuardMs <= 0) throw new Error('播放欠载保护间隔无效。');
      this.experimentMode = options.experimentMode || 'baseline';
      if (!['baseline', 'compressed-ram', 'ready-submit'].includes(this.experimentMode)) throw new Error('未知T0对照模式。');
      this.compressedLimit = options.compressedRamBytes === undefined ? Math.floor(ledgerLimit / 8) : options.compressedRamBytes;
      if (!Number.isSafeInteger(this.compressedLimit) || this.compressedLimit < 0 || this.compressedLimit > Math.floor(ledgerLimit / 8)) throw new Error('压缩图像池不得超过总RAM额度的1/8。');
      if (options.forwardPredecode !== undefined && typeof options.forwardPredecode !== 'boolean') throw new Error('提前解压设置必须为开或关。');
      this.forwardPredecode = !!options.forwardPredecode; this.forwardToken = 0; this.preparePlan = null;
      this.forwardStatus = 'idle'; this.forwardIssue = null; this.warmPlan = null; this.warmCursor = 0;
      this.coverageVersion = 0; this.coverageMemo = null; this.loadTimings = null;
      this.observeCanvas = !!options.observeCanvas;
      this.compressed = new Map(); this.compressedBytes = 0; this.compressedCapacity = 0;
      this.compressedStats = { warmedBytes: 0, warmedFrames: 0, hits: 0, misses: 0, warmMs: 0, admittedFrames: 0, evictions: 0 };
      this.inRaf = false; this.lastSubmissionRaf = -1; this.submissionSerial = 0; this.lastSubmission = null;
      this.observedSerial = 0; this.observedFrame = null;
      this.info = null; this.state = 'empty'; this.epoch = 0; this.playToken = 0; this.requestId = 0;
      this.target = null; this.currentIndex = null; this.time = 0; this.targetTime = 0;
      this.cache = new Map(); this.tasks = new Map(); this.loads = new Set(); this.prefetchFailed = new Set();this.thumbnailLeases=new Set();
      this.audioContext = null; this.audioBuffer = null; this.audioBudget = null; this.contexts = new Set(); this.graph = null; this.anchor = null;
      this.decodeDelayMs = 0; this.verifyMarkers = true; this.rafCount = 0; this.drawCount = 0; this.lastDrawAt = null; this.maxDrawGapMs = 0;
      this.lastTickAt = null; this.displayInterval = 1000 / 60; this.recovery = null;
      this.lastClockEmit = -Infinity; this.waitingSince = null; this.ended = false; this.lastIssue = null; this.lastErrorCode = null;
      this.rafId = null; this.disposed = false; this.disposePromise = null; this._schedule();
      this.playbackRate = 1; this.loopStart = null; this.loopEnd = null; this.loopEnabled = false;
    }
    _emit(type, values) {
      try { this.emit(Object.assign({ type, at: this.env.now(), epoch: this.epoch }, values || {})); }
      catch (error) { this.telemetryIssue = error.message; }
    }
    _change(state) {
      if (state) this.state = state;
      const epoch = this.epoch, snapshot = this.snapshot(); this._emit('state', { state: this.state });
      if (epoch !== this.epoch || snapshot.state !== this.state) return;
      try { this.onChange(snapshot); } catch (error) { this.telemetryIssue = error.message; }
    }
    snapshot() {
      const ledger = this.budget.snapshot(), frame = this.info && this.currentIndex !== null ? this.info.frames[this.currentIndex] : null;
      return { state: this.state, time: this.time, frameId: frame ? frame.id : null, frameOrdinal: this.currentIndex,
        frameCount: this.info ? this.info.frames.length : 0,
        targetTime: this.targetTime, targetFrameId: this.info && this.target ? this.info.frames[this.target.index].id : null,
        pendingTargets: this.target && this.target.resolve ? 1 : 0, activeImageTasks: this.tasks.size,
        cacheBytes: ledger.used, cachePeakBytes: ledger.peak, budget: ledger, audioAvailable: !!(this.audioBuffer || this.segmentAudio),
        decodeDelayMs: this.decodeDelayMs, verifyMarkers: this.verifyMarkers, epoch: this.epoch, drawCount: this.drawCount,
        rafOpportunity: this.rafCount, maxDrawGapMs: this.maxDrawGapMs, lastIssue: this.lastIssue, lastErrorCode: this.lastErrorCode,
        buffering: !!this.recovery, playbackGuardMs: this.playbackGuardMs, telemetryIssue: this.telemetryIssue || null,
        experimentMode: this.experimentMode, compressed: { ...this.compressedStats, residentFrames: this.compressed.size,
          residentBytes: ledger.kinds && ledger.kinds['compressed-jpeg'] || 0, limitBytes: this.experimentMode === 'compressed-ram' ? this.compressedLimit : 0 },
        forwardPredecode: this.forwardPredecode, forwardStatus: this.forwardStatus, forwardIssue: this.forwardIssue,
        loadTimings: this.loadTimings ? { ...this.loadTimings } : null,
        frameDecoder: this.frameDecoder ? this.frameDecoder.snapshot() : null,
        transport: this.transportSnapshot(),
        memoryScope: 'managed decoded RGBA, audio, compressed/copy buffers and in-flight reservations; browser/GPU/internal decoder copies excluded' };
    }
    async paintThumbnail(time, canvas) {
      const epoch=this.epoch,info=this.info;
      if(!info||!canvas?.getContext||this.disposed)return null;
      const ordinal=this.index.frameAt(info.frames,time),bytes=240*135*4;
      let reservation=null;
      try {
        // Thumbnail canvases share the existing ledger. Never evict playback
        // frames or start a new decoder while playback/seek is in progress.
        reservation=this.budget.reserve(bytes,'record-thumbnail');
        let entry=this.cache.get(ordinal);
        if(!entry){if(this.state!=='paused'||this.tasks.size||this.target?.resolve)return null;entry=await this._decode(ordinal,'thumbnail',null);}
        if(!entry||!this._valid(epoch))return null;
        const factor=Math.min(240/info.width,135/info.height);canvas.width=Math.max(1,Math.round(info.width*factor));canvas.height=Math.max(1,Math.round(info.height*factor));const ctx=canvas.getContext('2d');
        ctx.fillStyle='#141619';ctx.fillRect(0,0,canvas.width,canvas.height);
        const scale=Math.min(canvas.width/info.width,canvas.height/info.height),w=info.width*scale,h=info.height*scale;
        ctx.drawImage(entry.bitmap,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
        const token=reservation;reservation=null;let released=false;
        const lease={release:()=>{if(!released){released=true;this.budget.release(token);canvas.width=canvas.height=1;this.thumbnailLeases.delete(lease);}}};this.thumbnailLeases.add(lease);return lease;
      } catch (_) { return null; }
      finally {if(reservation)this.budget.release(reservation);}
    }
    setForwardPredecode(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('提前解压设置必须为开或关。');
      this.forwardPredecode = enabled; ++this.forwardToken; this.preparePlan = null;
      this.forwardStatus = enabled ? 'idle' : 'disabled'; this.forwardIssue = null; this._change();
    }
    _loopRange() {
      if (!this.info || this.loopStart === null || this.loopEnd === null || this.loopStart > this.loopEnd) return null;
      const start = this.info.frames[this.loopStart].time;
      const end = this.loopEnd === this.info.frames.length - 1 ? this.info.duration : this.info.frames[this.loopEnd].end;
      return end > start ? { start, end, first: this.loopStart, last: this.loopEnd } : null;
    }
    transportSnapshot() {
      const range = this._loopRange(), frames = this.info && this.info.frames;
      return { rate: this.playbackRate, loop: { enabled: this.loopEnabled, valid: !!range,
        startId: frames && this.loopStart !== null ? frames[this.loopStart].id : null,
        endId: frames && this.loopEnd !== null ? frames[this.loopEnd].id : null,
        startOrdinal: this.loopStart, endOrdinal: this.loopEnd,
        startTime: frames && this.loopStart !== null ? frames[this.loopStart].time : null,
        endTime: frames && this.loopEnd !== null ? frames[this.loopEnd].time : null,
        endBoundary: range ? range.end : null } };
    }
    async _editTransport(edit, resume = false) {
      if (!this._canSeek()) throw new Error('视频尚未就绪。');
      const epoch = this.epoch, playing = this.state === 'playing', paused = this.pause(), token = this.playToken;
      await paused;
      if (!this._playValid(epoch, token) || this.state !== 'paused') return { status: 'superseded' };
      const result = await edit();
      if (!this._playValid(epoch, token)) return { status: 'superseded' };
      if (resume === 'always' && result && result.status !== 'applied') return result;
      this._change();
      if (!this._playValid(epoch, token)) return { status: 'superseded' };
      return resume === 'always' || playing && resume ? this.play() : result || { status: 'applied' };
    }
    setPlaybackRate(rate) {
      if (!validRate(rate)) return Promise.reject(new Error('播放速度须在0.1×至4×之间。'));
      if (!this._canSeek()) return Promise.reject(new Error('视频尚未就绪。'));
      if (rate === this.playbackRate) return Promise.resolve({ status: 'applied' });
      return this._editTransport(() => { this.playbackRate = rate; }, true);
    }
    setLoopPoint(point) {
      if (!['start', 'end'].includes(point)) return Promise.reject(new Error('未知循环端点。'));
      return this._editTransport(() => {
        const at = this.currentIndex;
        if (point === 'start') { this.loopStart = at; if (this.loopEnd !== null && this.loopEnd < at) this.loopEnd = null; }
        else { this.loopEnd = at; if (this.loopStart !== null && this.loopStart > at) this.loopStart = null; }
        this.loopEnabled = false;
      });
    }
    clearLoop() { return this._editTransport(() => { this.loopStart = this.loopEnd = null; this.loopEnabled = false; }, true); }
    loopFrameAt(time, bounds = {}) {
      if (!this._canSeek() || this.info.frames.length < 2 || !Number.isFinite(time)) return null;
      const frames = this.info.frames, min = bounds.minOrdinal === undefined ? 0 : bounds.minOrdinal,
        max = bounds.maxOrdinal === undefined ? frames.length - 1 : bounds.maxOrdinal;
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max >= frames.length || min > max) return null;
      const raw = bounds.ordinal === undefined ? this.index.frameAt(frames, time) : bounds.ordinal;
      if (!Number.isSafeInteger(raw)) return null;
      const ordinal = Math.max(min, Math.min(max, raw)), frame = frames[ordinal];
      return { ordinal, frameId: frame.id, time: frame.time };
    }
    applyLoopRange(value) {
      const first = value && value.startOrdinal, last = value && value.endOrdinal;
      if (!this.info || !Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0 || last >= this.info.frames.length || first >= last)
        return Promise.reject(new Error('请选择两个不同的源帧。'));
      if (!((last === this.info.frames.length - 1 ? this.info.duration : this.info.frames[last].end) > this.info.frames[first].time))
        return Promise.resolve({ status: 'ignored', reason: 'invalid-loop' });
      return this._editTransport(async () => {
        const epoch = this.epoch, token = this.playToken;
        const located = await this._request(this.info.frames[first].time, { index: first, kind: 'loop-confirm', final: true, inputAt: this.env.now() });
        // Nothing is committed before the starting image really settles. A newer
        // seek/pause/dispose owns the token and leaves the previous range intact.
        if (!this._playValid(epoch, token) || !['drawn', 'reused'].includes(located.status)) return located;
        this.loopStart = first; this.loopEnd = last; this.loopEnabled = !!this._loopRange();
        if (!this.loopEnabled) return { status: 'ignored', reason: 'invalid-loop' };
        return { status: 'applied' };
      }, 'always');
    }
    setLoopEnabled(enabled) {
      if (typeof enabled !== 'boolean') return Promise.reject(new Error('循环状态必须为开或关。'));
      return this._editTransport(async () => {
        const range = this._loopRange();
        if (enabled && !range) return { status: 'ignored', reason: 'invalid-loop' };
        this.loopEnabled = enabled;
        if (enabled && (this.currentIndex < range.first || this.currentIndex > range.last))
          await this._request(range.start, { index: range.first, kind: 'loop-enable', final: true, inputAt: this.env.now() });
      }, true);
    }
    restoreTransport(value) {
      if (!value || !validRate(value.rate) || !value.loop || typeof value.loop.enabled !== 'boolean')
        return Promise.reject(new Error('播放控制恢复数据无效。'));
      return this._editTransport(() => {
        const ordinal = id => id === null ? null : this.info.frames.findIndex(frame => frame.id === id);
        const start = ordinal(value.loop.startId), end = ordinal(value.loop.endId);
        if (start === -1 || end === -1) throw new Error('原循环范围与当前源帧不匹配。');
        this.playbackRate = value.rate; this.loopStart = start; this.loopEnd = end;
        this.loopEnabled = value.loop.enabled && !!this._loopRange();
      });
    }
    setDecodeDelay(ms) {
      if (!Number.isFinite(ms) || ms < 0 || ms > 2000) throw new Error('解码延迟须在0～2000ms。');
      this.decodeDelayMs = ms; this._change();
    }
    setVerifyMarkers(enabled) { this.verifyMarkers = !!enabled; this._change(); }
    cacheCoverageSnapshot() {
      // Coverage is sampled separately; normal seeks never enumerate bitmaps.
      if (!this.info || this.disposed) return null;
      if (!this.coverageMemo || this.coverageMemo.revision !== this.coverageVersion)
        this.coverageMemo = Object.freeze({ revision: this.coverageVersion, ranges: decodedRanges(this.info.frames, this.cache.keys(), this.info.duration) });
      return Object.freeze({ epoch: this.epoch, revision: this.coverageVersion, duration: this.info.duration,
        decodedFrames: this.cache.size, totalFrames: this.info.frames.length, ranges: this.coverageMemo.ranges,
        enabled: this.forwardPredecode, phase: this.forwardStatus, issue: this.forwardIssue });
    }
    _valid(epoch) { return !this.disposed && epoch === this.epoch; }
    _playValid(epoch, token) { return this._valid(epoch) && token === this.playToken; }
    _settle(target, status, values) {
      if (!target || !target.resolve) return;
      const resolve = target.resolve; target.resolve = null;
      resolve(Object.assign({ status, requestId: target.requestId, frameId: target.frameId }, values || {}));
      if (status !== 'drawn') this._emit(status === 'superseded' || status === 'reused' ? status : 'error', Object.assign({
        epoch: target.epoch, requestId: target.requestId, kind: target.kind, frameId: target.frameId, inputAt: target.inputAt, status
      }, values || {}));
    }
    _clearTarget(reason) { const target = this.target; this.target = null; this._settle(target, 'superseded', { reason }); }
    async load(rawInfo) {
      if (this.disposed) throw new Error('播放器已释放。');
      const oldLoads = Array.from(this.loads), oldTasks = Array.from(this.tasks.values()).map(task => task.promise);
      const epoch = ++this.epoch; this.state = 'loading'; this._halt(false); this._clearTarget('material-switch'); this._clearCache(); this._clearCompressed();
      this.compressedStats = { warmedBytes: 0, warmedFrames: 0, hits: 0, misses: 0, warmMs: 0, admittedFrames: 0, evictions: 0 };
      this.lastSubmission = null; this.observedSerial = this.submissionSerial; this.observedFrame = null;
      const oldContext = this.audioContext; this.audioContext = null; this.audioBuffer = null;
      const oldFrameDecoder = this.frameDecoder; this.frameDecoder = null;
      const oldSegmentAudio = this.segmentAudio; this.segmentAudio = null;
      this.budget.release(this.audioBudget); this.audioBudget = null; this.info = null;
      ++this.forwardToken; this.preparePlan = null; this.forwardStatus = this.forwardPredecode ? 'waiting' : 'disabled';
      this.forwardIssue = null; this.warmPlan = null; this.warmCursor = 0; this.loadTimings = null;
      this.currentIndex = null; this.time = 0; this.targetTime = 0; this.lastIssue = null; this.lastErrorCode = null; this.prefetchFailed.clear(); this.ended = false;
      this.playbackRate = 1; this.loopStart = this.loopEnd = null; this.loopEnabled = false;
      this._change('loading');
      const loadStartedAt = this.env.now();
      const operation = Promise.resolve().then(async () => {
        let context = null, reservation = null, transferred = false;
        try {
          if (oldFrameDecoder) await oldFrameDecoder.close();
          if (oldSegmentAudio) await oldSegmentAudio.close();
          if (oldContext) await this._closeContext(oldContext);
          // Uncancellable work keeps its reservation; do not overlap images from two materials.
          await Promise.allSettled(oldLoads.concat(oldTasks)); if (!this._valid(epoch)) return { status: 'superseded' };
          this.index.validateIndex(rawInfo); const info = freezeInfo(rawInfo);
          this.info = info;
          if (info.videoEncoding) {
            if (!this.createFrameDecoder) throw new Error('当前宿主没有帧内代理解码能力，请在设置中切换JPEG序列。');
            this.frameDecoder = this.createFrameDecoder({ width: info.width, height: info.height });
          }
          this.canvas.width = info.width; this.canvas.height = info.height;
          if (info.audio && info.streaming) {
            if (!this.createSegmentAudio) throw new Error('缺少分段音频读取能力。');
            context = this.env.createAudioContext({ sampleRate: 48000 }); this.contexts.add(context); this.audioContext = context;
            this.segmentAudio = this.createSegmentAudio({ info, context, budget: this.budget, evict: () => this._evict(), onError: error => { if (this._valid(epoch)) this._fail(error); } });
            transferred = true;
          } else if (info.audio) {
            context = this.env.createAudioContext(); this.contexts.add(context); this.audioContext = context;
            const estimate = Math.ceil((info.audio.duration + 0.1) * context.sampleRate * info.audio.channels) * 4;
            reservation = this.budget.reserve(estimate + info.audio.bytes * 2, 'audio-loading', () => this._evict());
            const bytes = await this.readAsset(info, info.audio.file);
            if (!bytes || bytes.byteLength !== info.audio.bytes) throw new Error('音频资源长度与清单不符。');
            if (!this._valid(epoch)) return { status: 'superseded' };
            const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const buffer = await new Promise((resolve, reject) => {
              const promise = context.decodeAudioData(array, resolve, reject);
              if (promise && typeof promise.then === 'function') promise.then(resolve, reject);
            });
            if (!this._valid(epoch)) return { status: 'superseded' };
            const actual = buffer.length * buffer.numberOfChannels * 4;
            if (!Number.isSafeInteger(actual) || actual > estimate) throw new Error('解码音频超过预留RAM。');
            this.budget.shrink(reservation, actual, 'audio'); this.audioBudget = reservation; this.audioBuffer = buffer; transferred = true;
            this._emit('clock', { epoch, phase: 'audio-ready', start: info.audio.start, duration: buffer.duration,
              sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, bytes: actual });
          }
          if (!this._valid(epoch)) return { status: 'superseded' };
          const warmStartedAt = this.env.now();
          if (this.experimentMode === 'compressed-ram' && !info.streaming) {
            if (this.forwardPredecode) this.warmPlan = this._planCompressed(info);
            else await this._warmCompressed(info, epoch);
          }
          this.loadTimings = { initialWarmDeferred: this.forwardPredecode, compressedWarmMs: this.env.now() - warmStartedAt };
          if (!this._valid(epoch)) return { status: 'superseded' };
          const result = await this._request(0, { kind: 'load', final: true, inputAt: this.env.now(), preserveLoading: true, index: 0 });
          if (result.status === 'error') throw new Error(result.error);
          if (this._valid(epoch)) { this.loadTimings.firstFrameReadyMs = this.env.now() - loadStartedAt;
            this._emit('cache', { phase: 'first-frame-ready', ...this.loadTimings }); }
          return result;
        } catch (error) {
          if (!this._valid(epoch)) return { status: 'superseded' };
          this._fail(error); throw error;
        } finally {
          if (!transferred) this.budget.release(reservation);
          if (context && (!this._valid(epoch) || !transferred)) await this._closeContext(context);
        }
      });
      this.loads.add(operation);
      try { return await operation; } finally { this.loads.delete(operation); }
    }
    _request(time, options) {
      const targetTime = Math.max(0, Math.min(this.info.duration, time));
      const ordinal = options.index === undefined ? this.index.frameAt(this.info.frames, targetTime) : options.index;
      const frame = this.info.frames[ordinal], epoch = this.epoch;
      if (this.info.streaming && this.setMediaTarget && !['play', 'buffer', 'pause', 'ended'].includes(options.kind)) this.setMediaTarget(frame.time);
      const previous = this.target; this.targetTime = targetTime; this.ended = options.kind === 'ended';
      let target;
      const promise = new Promise(resolve => { target = { index: ordinal, frameId: frame.id, epoch, targetTime,
        requestId: ++this.requestId, inputAt: options.inputAt, kind: options.kind, final: !!options.final, resolve, effectiveEmitted: false, readyEmitted: false }; });
      if (options.kind === 'step') target.stepDirection = options.stepDirection;
      // One speculative frame can make the next pointer target a RAM hit. Without
      // it, input immediately before every rAF can supersede each completed image.
      const moving = !target.final && ['drag', 'rapid'].includes(target.kind);
      if (moving && previous && !previous.final && previous.epoch === epoch && ['drag', 'rapid'].includes(previous.kind) &&
        target.inputAt > previous.inputAt && target.inputAt - previous.inputAt <= 100) {
        target.dragDelta = targetTime - previous.targetTime;
        if (target.dragDelta && Math.sign(target.dragDelta) === Math.sign(previous.dragDelta || 0)) {
          // Frame-snapped positions alternate short/long deltas. Repeating the
          // last delta predicts the opposite rounding error, often one frame
          // away on every event. Fit the last few positions instead; event
          // order avoids turning OS input timestamp jitter into video motion.
          target.dragSamples = (previous.dragSamples || [previous.targetTime]).concat(targetTime).slice(-5);
          const points = target.dragSamples, middle = (points.length - 1) / 2;
          const mean = points.reduce((sum, value) => sum + value, 0) / points.length;
          let numerator = 0, denominator = 0;
          for (let n = 0; n < points.length; n++) { numerator += (n - middle) * (points[n] - mean); denominator += (n - middle) ** 2; }
          const predictedTime = mean + numerator / denominator * (points.length - middle);
          const predicted = this.index.frameAt(this.info.frames, Math.max(0, Math.min(this.info.duration, predictedTime)));
          if (predicted !== ordinal) target.predictedIndex = predicted;
        } else target.dragSamples = [previous.targetTime, targetTime];
      }
      target.cacheStateAtInput = this.cache.has(ordinal) ? 'decoded' : this.tasks.has(epoch + ':' + ordinal) ? 'inflight' : this.compressed.has(ordinal) ? 'jpeg-ram' : 'disk';
      if (!['load', 'play', 'ended'].includes(options.kind)) ++this.forwardToken;
      this.target = target;
      this._emit('request', { epoch, phase: 'input', requestId: target.requestId, kind: target.kind, frameId: frame.id,
        frameOrdinal: ordinal, targetTime, inputAt: target.inputAt, final: target.final, cacheStateAtInput: target.cacheStateAtInput,
        workReused: this.cache.has(ordinal) || this.tasks.has(epoch + ':' + ordinal) });
      this._settle(previous, 'superseded', { reason: 'new-request' });
      if (this._valid(epoch) && this.target === target && !options.preserveLoading && options.kind !== 'play') this._change('seeking');
      // Baseline drawing remains rAF-only. The explicitly approved experiment
      // can submit a still-current ready target under the same final guard.
      if (this._valid(epoch) && this.target === target) { this._startTargetWork(); this._startDragAheadWork(); this._tryReadySubmit(); }
      return promise;
    }
    _canSeek() { return !this.disposed && this.info && this.state !== 'loading' && (this.state !== 'error' || this.lastErrorCode === 'UNDERRUN'); }
    seek(time, options) {
      if (!this._canSeek() || !Number.isFinite(time)) return Promise.reject(new Error('播放器尚未就绪或定位时间无效。'));
      const settings = Object.assign({ final: false, kind: 'seek', inputAt: this.env.now() }, options || {});
      if (!Number.isFinite(settings.inputAt)) return Promise.reject(new Error('原始输入时间无效。'));
      if (settings.kind === 'annotation' && this.loopEnabled) {
        const range = this._loopRange();
        const ordinal = settings.index === undefined ? this.index.frameAt(this.info.frames, Math.max(0, Math.min(this.info.duration, time))) : settings.index;
        // One owned seek publishes both changes. No awaited toggle can resume
        // playback or act on another video's player before the annotation seek.
        if (range && (ordinal < range.first || ordinal > range.last)) this.loopEnabled = false;
      }
      this._halt(false); this.lastIssue = null; this.lastErrorCode = null; return this._request(time, settings);
    }
    step(delta) {
      if (!this._canSeek() || !Number.isSafeInteger(delta)) return Promise.reject(new Error('播放器尚未就绪或逐帧参数无效。'));
      const base = this.target && this.target.resolve ? this.target.index : (this.currentIndex === null ? 0 : this.currentIndex);
      const ordinal = this.index.stepIndex(this.info.frames, base, delta);
      this._halt(false); this.lastIssue = null; this.lastErrorCode = null;
      return this._request(this.info.frames[ordinal].time, { index: ordinal, final: true, kind: 'step', stepDirection: Math.sign(delta), inputAt: this.env.now() });
    }
    _playAheadOrdinals(time, ordinal, count = 12) {
      const loop = this.loopEnabled ? this._loopRange() : null, found = new Set();
      // At 4x on a 60Hz display, decoding every intervening 60fps source frame
      // wastes both slots. Forecast the frames actually due at future refreshes.
      const step = this.displayInterval / 1000 * this.playbackRate;
      for (let n = 1; n <= count; n++) {
        let next = time + step * n;
        if (loop && next >= loop.end) next = loop.start + (next - loop.end) % (loop.end - loop.start);
        if (!loop && next >= this.info.duration) break;
        const at = this.index.frameAt(this.info.frames, next);
        if (at !== ordinal && (!loop || at >= loop.first && at <= loop.last)) found.add(at);
      }
      return [...found];
    }
    _readyPlayOrdinal(ordinal) {
      // At fast playback the media clock keeps moving. A late decoded frame
      // can still advance the picture, but never draw a future or older frame
      // in the current loop pass. Manual seek/step retain their exact target.
      const loop = this.loopEnabled ? this._loopRange() : null;
      const lower = this.drawnPlayCycle === this.playCycle ? this.currentIndex : loop ? loop.first - 1 : -1;
      let ready = null;
      for (const index of this.cache.keys()) {
        if (index <= ordinal && index >= (loop ? loop.first : 0) && index >= lower && (ready === null || index > ready)) ready = index;
      }
      return ready;
    }
    _recoverSupply(time, ordinal) {
      if (this.recovery || this.state !== 'playing') return;
      const epoch = this.epoch; this._halt(false);
      const job = this.recovery = { epoch, token: this.playToken, started: this.env.now(), ordinal };
      this._emit('clock', { phase: 'supply-buffer-start', mediaTime: time, frameOrdinal: ordinal });
      // Pin one real target. Advancing the clock while decoding kept replacing
      // it with a future frame and could starve the display indefinitely.
      this._request(time, { index: ordinal, kind: 'buffer', final: true, inputAt: this.env.now() }).then(async result => {
        if (this.recovery !== job || !this._playValid(epoch, job.token)) return;
        if (!['drawn', 'reused'].includes(result.status)) { this.recovery = null; return; }
        this.recovery = null;
        this._emit('clock', { phase: 'supply-buffer-ready', mediaTime: this.time, waitMs: this.env.now() - job.started });
        if (this.state === 'paused') await this.play();
      }).catch(error => { if (this._valid(epoch) && this.recovery === job) { this.recovery = null; this._fail(error); } });
    }
    async _prime(ordinal, epoch, token) {
      while (this._playValid(epoch, token)) {
        if (this.cache.has(ordinal)) return this.cache.get(ordinal);
        const existing = this.tasks.get(epoch + ':' + ordinal); if (existing) return existing.promise;
        if (this.tasks.size < 2) return this._decode(ordinal, 'play-ahead', null);
        await Promise.race(Array.from(this.tasks.values()).map(task => task.promise.catch(() => null)));
      }
      return null;
    }
    async play() {
      if (this.disposed || !this.info || this.state !== 'paused') throw new Error('播放器未处于可播放的暂停状态。');
      const epoch = this.epoch, token = ++this.playToken, context = this.audioContext;
      const resumed = context ? context.resume() : Promise.resolve(); this._change('seeking');
      try {
        await resumed; if (!this._playValid(epoch, token)) return { status: 'superseded' };
        let ordinal = this.currentIndex === null ? 0 : this.currentIndex;
        const loop = this.loopEnabled ? this._loopRange() : null;
        if (this.ended || this.time >= this.info.duration || loop && (ordinal < loop.first || ordinal > loop.last)) {
          const first = loop ? loop.first : 0;
          const result = await this._request(this.info.frames[first].time, { kind: 'restart', final: true, index: first, inputAt: this.env.now() });
          if (!['drawn', 'reused'].includes(result.status) || !this._playValid(epoch, token)) return { status: 'superseded' };
          ordinal = first; this._change('seeking');
        }
        for (const next of [ordinal, ...this._playAheadOrdinals(this.info.frames[ordinal].time, ordinal, 3)]) {
          await this._prime(next, epoch, token); if (!this._playValid(epoch, token)) return { status: 'superseded' };
        }
        const media = this.info.frames[ordinal].time;
        if (this.segmentAudio) { await this.segmentAudio.prime(media, loop); if (!this._playValid(epoch, token)) return { status: 'superseded' }; }
        const when = context ? context.currentTime + 0.02 : null;
        this.playCycle = this.drawnPlayCycle = 0; this.lastPlayOrdinal = ordinal;
        this.anchor = { media, context: when, perf: this.env.now() + 20, rate: this.playbackRate, loop }; this.waitingSince = null;
        if (this.segmentAudio) this.segmentAudio.start(media, when, this.playbackRate, loop);
        if (context && this.audioBuffer) {
          let buffer = this.audioBuffer, loopBudget = null, plan;
          try {
            if (loop) {
              const audioStart = this.info.audio.start, audioEnd = audioStart + buffer.duration;
              const from = Math.max(loop.start, audioStart), to = Math.min(loop.end, audioEnd);
              if (to > from) {
                let offsetOrigin = audioStart;
                if (loop.start < audioStart || loop.end > audioEnd) {
                  const sr = buffer.sampleRate, channels = buffer.numberOfChannels, length = Math.ceil((loop.end - loop.start) * sr), bytes = length * channels * 4;
                  loopBudget = this.budget.reserve(bytes * 2, 'loop-audio-loading', () => this._evict());
                  const copied = context.createBuffer(channels, length, sr);
                  const input = Math.max(0, Math.round((from - audioStart) * sr)), output = Math.max(0, Math.round((from - loop.start) * sr));
                  const count = Math.min(length - output, buffer.length - input, Math.round((to - from) * sr));
                  for (let channel = 0; channel < channels; channel++) copied.copyToChannel(buffer.getChannelData(channel).subarray(input, input + count), channel, output);
                  buffer = copied; offsetOrigin = loop.start; this.budget.shrink(loopBudget, bytes, 'loop-audio');
                }
                plan = { when, offset: media - offsetOrigin, loopStart: loop.start - offsetOrigin, loopEnd: loop.end - offsetOrigin };
              }
            } else {
              plan = this.index.audioStartPlan(media, this.info.audio.start, buffer.duration, when);
              if (plan) plan.when = when + (plan.when - when) / this.playbackRate;
            }
            if (plan) {
              const source = context.createBufferSource(), gain = context.createGain(); source.buffer = buffer;
              source.playbackRate.value = this.playbackRate;
              if (loop) { source.loop = true; source.loopStart = plan.loopStart; source.loopEnd = plan.loopEnd; }
              const graph = { source, gain, token, loopBudget }; this.graph = graph; loopBudget = null;
              source.connect(gain); gain.connect(context.destination); gain.gain.setValueAtTime(1, context.currentTime);
              source.onended = () => {
                if (this.graph !== graph || !this._playValid(epoch, token)) return;
                this._emit('clock', { epoch, phase: 'audio-ended-video-clock-continues', mediaTime: this._clockTime() });
              };
              source.start(plan.when, plan.offset);
            }
          } finally { this.budget.release(loopBudget); }
        }
        const audioStart = this.info.audio ? this.info.audio.start : null;
        this._change('playing');
        if (!this._playValid(epoch, token)) return { status: 'superseded' };
        this._emit('clock', { epoch, phase: 'start', mediaTime: media, audioContextStart: when,
          audioStart, clock: context ? 'audio-output-estimate' : 'monotonic' });
        return { status: 'playing' };
      } catch (error) {
        if (!this._playValid(epoch, token)) return { status: 'superseded' };
        this._fail(error); throw error;
      }
    }
    _clockTime() {
      if (!this.anchor || !this.info) return this.time;
      let elapsed;
      if (this.audioContext) {
        const context = this.audioContext; let output = context.currentTime, estimated = false;
        try {
          if (typeof context.getOutputTimestamp === 'function') {
            const stamp = context.getOutputTimestamp();
            if (Number.isFinite(stamp.contextTime) && Number.isFinite(stamp.performanceTime) && (stamp.contextTime > 0 || stamp.performanceTime > 0)) {
              output = Math.min(context.currentTime, stamp.contextTime + Math.max(0, this.env.now() - stamp.performanceTime) / 1000); estimated = true;
            }
          }
        } catch (_) { /* output estimate is optional; fallback is explicitly reported */ }
        this.clockMethod = estimated ? 'getOutputTimestamp-estimate' : 'AudioContext.currentTime-fallback-unmeasured-output-latency';
        elapsed = output - this.anchor.context;
      } else { elapsed = (this.env.now() - this.anchor.perf) / 1000; this.clockMethod = 'performance-monotonic'; }
      const raw = this.anchor.media + Math.max(0, elapsed) * this.anchor.rate, loop = this.anchor.loop;
      return loop ? raw < loop.end ? raw : loop.start + (raw - loop.end) % (loop.end - loop.start) : Math.min(this.info.duration, raw);
    }
    _halt(capture) {
      if (this.segmentAudio) this.segmentAudio.stop();
      const media = capture && this.state === 'playing' ? this._clockTime() : this.time;
      this.recovery = null; ++this.playToken; const graph = this.graph; this.graph = null;
      if (graph) {
        graph.source.onended = null;
        try { graph.gain.gain.setValueAtTime(0, this.audioContext.currentTime); } catch (_) { /* closed output */ }
        try { graph.source.stop(); } catch (_) { /* already ended */ }
        try { graph.source.disconnect(); graph.gain.disconnect(); } catch (_) { /* already detached */ }
        this.budget.release(graph.loopBudget);
      }
      this.anchor = null; this.waitingSince = null; return media;
    }
    pause() {
      const wasPlaying = this.state === 'playing', buffering = !!this.recovery, media = this._halt(true);
      if (this.disposed || !this.info || this.state === 'loading' || this.state === 'error') return Promise.resolve({ status: 'ignored', reason: 'not-ready' });
      if (wasPlaying || buffering) return this._request(buffering ? this.time : media, { final: true, kind: 'pause', inputAt: this.env.now() });
      if (this.state === 'seeking' && !(this.target && this.target.resolve)) this._change('paused');
      return Promise.resolve({ status: 'paused' });
    }
    _closeEntry(entry) {
      try { entry.bitmap.close(); } catch (error) { this.telemetryIssue = error.message; }
      this.budget.release(entry.budget);
    }
    _evict() {
      let victim = null, farthest = -1;
      const center = this.target ? this.target.index : this.currentIndex;
      for (const entry of this.cache.values()) {
        if (entry.index === this.currentIndex || (this.target && entry.index === this.target.index)) continue;
        if (this.state === 'seeking' && this.loopEnabled && entry.index === this.loopStart) continue;
        const distance = this.forwardPredecode && this.info && center !== null ? Math.abs(this.info.frames[entry.index].time - this.info.frames[center].time) : 0;
        if (!victim || distance > farthest || distance === farthest && entry.usedAt < victim.usedAt) { victim = entry; farthest = distance; }
      }
      if (!victim) {
        const compressed = this.compressed.entries().next(); if (compressed.done) return false;
        this._dropCompressed(compressed.value[0]); return true;
      }
      return this._dropDecoded(victim);
    }
    _dropDecoded(victim) {
      this.cache.delete(victim.index); ++this.coverageVersion; this._closeEntry(victim);
      this._emit('cache', { phase: 'evict', frameId: victim.id, budgetBytes: this.budget.used }); return true;
    }
    _evictOutsideWindow(plan) {
      let victim = null, farthest = -1;
      const loop = this.loopEnabled ? this._loopRange() : null;
      for (const entry of this.cache.values()) {
        if (entry.index >= plan.start && entry.index <= plan.end || entry.index === this.currentIndex || this.target && entry.index === this.target.index) continue;
        const delta = this.info.frames[entry.index].time - this.info.frames[plan.center].time;
        const ahead = loop && entry.index < plan.center ? delta + loop.end - loop.start : delta;
        if (this.state === 'playing' && ahead > 0 && ahead <= .3 * this.playbackRate) continue;
        if (Math.abs(delta) > farthest) { victim = entry; farthest = Math.abs(delta); }
      }
      return victim ? this._dropDecoded(victim) : false;
    }
    _clearCache() { for(const lease of this.thumbnailLeases)lease.release();for (const entry of this.cache.values()) this._closeEntry(entry); this.cache.clear(); ++this.coverageVersion; }
    _dropCompressed(ordinal) {
      const entry = this.compressed.get(ordinal); if (!entry) return;
      this.compressed.delete(ordinal); this.compressedBytes -= entry.bytes.byteLength; this.budget.release(entry.budget);
      this.compressedStats.evictions++;
    }
    _clearCompressed() {
      for (const entry of this.compressed.values()) this.budget.release(entry.budget);
      this.compressed.clear(); this.compressedBytes = 0; this.compressedCapacity = 0;
    }
    _rememberCompressed(ordinal, bytes) {
      if (this.experimentMode !== 'compressed-ram' || this.compressed.has(ordinal) || bytes.byteLength > this.compressedCapacity) return;
      while (this.compressedBytes + bytes.byteLength > this.compressedCapacity) {
        const oldest = this.compressed.keys().next(); if (oldest.done) return;
        this._dropCompressed(oldest.value);
      }
      // The completed read's reservation was released, or the finished
      // decoder's reservation shrank. Retain one JPEG in that same ledger.
      const token = this.budget.reserve(bytes.byteLength, 'compressed-jpeg');
      this.compressed.set(ordinal, { bytes, budget: token }); this.compressedBytes += bytes.byteLength;
      this.compressedStats.admittedFrames++;
    }
    _planCompressed(info) {
      const rgba = info.width * info.height * 4;
      const largest = info.frames.reduce((maximum, frame) => Math.max(maximum, frame.bytes), 0);
      // Leave room for two real image tasks and the transient copies of the
      // two warm reads. This pool competes with RGBA inside the same ledger.
      const ledger = this.budget.snapshot();
      const batching = !!(info.framePack && this.readFrameBatch), batchBytes = 1024 ** 2;
      const transient = batching ? Math.max(largest * 2, batchBytes * 2) : largest * 2;
      const cap = Math.max(0, Math.min(this.compressedLimit, ledger.limit - ledger.used - 2 * (rgba + largest * 2) - transient));
      this.compressedCapacity = cap;
      const ordinals = []; let planned = 0;
      const total = info.frames.reduce((sum, frame) => sum + frame.bytes, 0);
      const include = ordinal => {
        if (planned + info.frames[ordinal].bytes <= cap) { ordinals.push(ordinal); planned += info.frames[ordinal].bytes; }
      };
      if (total <= cap) {
        for (let n = 0; n < info.frames.length; n++) include(n);
      } else {
        // Partial coverage must not leave one long cold tail. Select both
        // endpoints, then subdivide the remaining ranges breadth-first under
        // the same exact byte cap. Oversized images remain normal disk reads.
        include(0); if (info.frames.length > 1) include(info.frames.length - 1);
        const ranges = [[1, info.frames.length - 2]];
        for (let next = 0; next < ranges.length; next++) {
          const [left, right] = ranges[next]; if (left > right) continue;
          const middle = Math.ceil((left + right) / 2); include(middle);
          if (left < middle) ranges.push([left, middle - 1]);
          if (middle < right) ranges.push([middle + 1, right]);
        }
        // Fetch the selected set in source order; selection and byte accounting
        // stay distributed while avoiding unnecessary scattered disk access.
        ordinals.sort((a, b) => a - b);
      }
      return { ordinals, batching, batchBytes, transient, largest };
    }
    async _warmCompressed(info, epoch) {
      const began = this.env.now(), plan = this._planCompressed(info);
      this.warmPlan = plan; // Re-enabling idle fill must not shrink a pool already charged to the ledger.
      const { ordinals, batching, batchBytes } = plan;
      for (let n = 0; n < ordinals.length && this._valid(epoch);) {
        if (!batching) {
          const results = await Promise.allSettled(ordinals.slice(n, n + 2).map(ordinal => this._readCompressed(info, epoch, ordinal))); n += 2;
          const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
        } else {
          const group = []; let size = 0, end = null;
          while (n < ordinals.length && group.length < 2048) {
            const frame = info.frames[ordinals[n]];
            if (size + frame.bytes > batchBytes || end !== null && frame.offset !== end) break;
            group.push(ordinals[n++]); size += frame.bytes; end = frame.offset + frame.bytes;
          }
          if (group.length) await this._readCompressedBatch(info, epoch, group);
          else await this._readCompressed(info, epoch, ordinals[n++]); // Large JPEG stays a bounded individual read.
        }
      }
      if (!this._valid(epoch)) return;
      this.compressedStats.warmMs = this.env.now() - began;
      this._emit('cache', { phase: 'compressed-warm-complete', ...this.compressedStats, sourceFrames: info.frames.length,
        completeSource: this.compressed.size === info.frames.length, budgetBytes: this.budget.used });
    }
    _readCompressedBatch(info, epoch, ordinals) {
      const key = epoch + ':compressed-batch:' + ordinals[0];
      if (this.tasks.size >= 2) throw new Error('压缩预载超过两个在途槽。');
      const holder = { epoch, index: ordinals[0], role: 'compressed-warm-batch', promise: null }; this.tasks.set(key, holder);
      holder.promise = Promise.resolve().then(async () => {
        const reservations = [], transferred = new Set();
        try {
          if (!this._valid(epoch)) return;
          for (const ordinal of ordinals) reservations.push(this.budget.reserve(info.frames[ordinal].bytes * 2, 'compressed-loading'));
          const buffers = await this.readFrameBatch(info, ordinals.map(n => info.frames[n].file));
          if (!this._valid(epoch)) return;
          if (!Array.isArray(buffers) || buffers.length !== ordinals.length || buffers.some((b, i) => !b || b.byteLength !== info.frames[ordinals[i]].bytes))
            throw new Error('图片包预载批次与清单不符。');
          for (let i = 0; i < ordinals.length; i++) {
            const ordinal = ordinals[i], bytes = buffers[i], token = reservations[i];
            if (this.compressed.has(ordinal) || this.compressedBytes + bytes.byteLength > this.compressedCapacity) continue;
            // Foreground reads may have occupied the pool while this batch was pending.
            this.budget.shrink(token, bytes.byteLength, 'compressed-jpeg');
            this.compressed.set(ordinal, { bytes, budget: token }); this.compressedBytes += bytes.byteLength; transferred.add(token);
            this.compressedStats.warmedBytes += bytes.byteLength; this.compressedStats.warmedFrames++;
          }
        } finally {
          for (const token of reservations) if (!transferred.has(token)) this.budget.release(token);
          if (this.tasks.get(key) === holder) this.tasks.delete(key);
          this._emit('cache', { epoch, phase: 'image-work-ended', frameId: info.frames[ordinals[0]].id, activeImageTasks: this.tasks.size, budgetBytes: this.budget.used });
        }
      });
      this._emit('cache', { epoch, phase: 'image-work-start', frameId: info.frames[ordinals[0]].id, role: holder.role, activeImageTasks: this.tasks.size });
      return holder.promise;
    }
    _readCompressed(info, epoch, ordinal) {
      const key = epoch + ':compressed:' + ordinal, frame = info.frames[ordinal];
      if (this.tasks.size >= 2) throw new Error('压缩读取超过两个在途槽。');
      const holder = { epoch, index: ordinal, role: 'compressed-warm', promise: null }; this.tasks.set(key, holder);
      holder.promise = Promise.resolve().then(async () => {
        let reservation = null, transferred = false;
        try {
          if (!this._valid(epoch)) return;
          reservation = this.budget.reserve(frame.bytes * 2, 'compressed-loading');
          const bytes = await this.readAsset(info, frame.file);
          if (!this._valid(epoch)) return;
          if (!bytes || bytes.byteLength !== frame.bytes) throw new Error('压缩预读长度与清单不符。');
          if (this.compressed.has(ordinal) || this.compressedBytes + frame.bytes > this.compressedCapacity) return;
          this.budget.shrink(reservation, frame.bytes, 'compressed-jpeg');
          this.compressed.set(ordinal, { bytes, budget: reservation }); this.compressedBytes += bytes.byteLength; transferred = true;
          this.compressedStats.warmedBytes += frame.bytes; this.compressedStats.warmedFrames++;
        } finally {
          if (!transferred) this.budget.release(reservation);
          if (this.tasks.get(key) === holder) this.tasks.delete(key);
          this._emit('cache', { epoch, phase: 'image-work-ended', frameId: frame.id, activeImageTasks: this.tasks.size, budgetBytes: this.budget.used });
        }
      });
      this._emit('cache', { epoch, phase: 'image-work-start', frameId: frame.id, role: holder.role, activeImageTasks: this.tasks.size });
      return holder.promise;
    }
    _tryReadySubmit() {
      if (this.experimentMode !== 'ready-submit' || this.inRaf || this.state === 'loading' || this.state === 'playing' || this.state === 'error') return;
      const target = this.target, entry = target && this.cache.get(target.index);
      if (target && target.resolve && entry) { try { this._draw(target, entry, 'ready'); } catch (error) { this._fail(error); } }
    }
    _startTargetWork() {
      const target = this.target;
      if (!this.info || !target || !target.resolve || !this._valid(target.epoch) || this.state === 'error') return;
      if (this.cache.has(target.index) || this.tasks.has(target.epoch + ':' + target.index) || this.tasks.size >= 2) return;
      // Finish an already started fast-play read even if its exact display
      // deadline moves on; otherwise slow I/O can discard every image forever.
      try { this._decode(target.index, target.kind === 'play' && this.state === 'playing' && this.playbackRate > 1 ? 'play-ahead' : 'target', target); } catch (error) { this._fail(error); }
    }
    _startDragAheadWork() {
      const target = this.target, ordinal = target && target.predictedIndex;
      if (!this.info || !target || !this._valid(target.epoch) || this.state === 'error' || !Number.isInteger(ordinal) ||
        this.tasks.size >= 2 || this.cache.has(ordinal) || this.tasks.has(target.epoch + ':' + ordinal) || this.prefetchFailed.has(ordinal)) return;
      // Speculation must not hold the spare slot in disk I/O while a later
      // real target is already in RAM. Missing JPEGs remain demand reads;
      // bounded RAM predictions and ordinary playback prefetch stay enabled.
      if (this.experimentMode === 'compressed-ram' && !this.compressed.has(ordinal)) return;
      // Latest real target owns the first slot. A prediction is cache work only;
      // it never becomes a seek target or gets permission to draw.
      if (!this.cache.has(target.index) && !this.tasks.has(target.epoch + ':' + target.index)) return;
      try { this._decode(ordinal, 'drag-ahead', null); } catch (error) { this._fail(error); }
    }
    _decode(ordinal, role, request) {
      const epoch = this.epoch, info = this.info, key = epoch + ':' + ordinal;
      const existing = this.tasks.get(key); if (existing) return existing.promise;
      if (this.tasks.size >= 2) throw new Error('图像任务超过两个在途槽。');
      const frame = info.frames[ordinal], holder = { epoch, index: ordinal, role, forwardToken: this.forwardToken, playToken: this.playToken, fastPlayback: this.state === 'playing' && this.playbackRate > 1, promise: null };
      this.tasks.set(key, holder);
      const task = Promise.resolve().then(async () => {
        let reservation = null, bitmap = null, transferred = false;
        try {
          if (!this._valid(epoch)) return null;
          if (role === 'forward-fill' && (!this.forwardPredecode || holder.forwardToken !== this.forwardToken) && (!this.target || this.target.index !== ordinal)) return null;
          if (role === 'target' && (!this.target || this.target.index !== ordinal)) return null;
          if (role === 'drag-ahead' && (!this.target || this.target.index !== ordinal && this.target.predictedIndex !== ordinal)) return null;
          const rgba = info.width * info.height * 4;
          reservation = this.budget.reserve(rgba + frame.bytes * 2, 'frame-inflight', ['forward-fill','thumbnail'].includes(role) ? undefined : () => this._evict());
          const readStartedAt = this.env.now();
          const compressed = this.compressed.get(ordinal);
          if (compressed) { this.compressed.delete(ordinal); this.compressed.set(ordinal, compressed); }
          const bytes = compressed ? compressed.bytes : await this.readAsset(info, frame.file);
          const readEndedAt = this.env.now();
          if (!bytes || (info.streaming ? bytes.byteLength <= 0 || bytes.byteLength > frame.bytes : bytes.byteLength !== frame.bytes)) throw new Error('JPEG资源长度与清单不符。');
          if (!this._valid(epoch)) return null;
          if (this.experimentMode === 'compressed-ram') this.compressedStats[compressed ? 'hits' : 'misses']++;
          // A fast drag may supersede a completed disk read before decoding.
          // Keep its verified JPEG for the next visit instead of repeatedly
          // paying I/O. No decoder has started; transfer the finished read's
          // reservation to the bounded pool synchronously, without an await.
          const obsoleteRead = role === 'target' && (!this.target || this.target.index !== ordinal) ||
            role === 'drag-ahead' && (!this.target || this.target.index !== ordinal && this.target.predictedIndex !== ordinal);
          if (obsoleteRead) {
            if (!compressed && this.experimentMode === 'compressed-ram') {
              this.budget.release(reservation); reservation = null;
              this._rememberCompressed(ordinal, bytes);
            }
            return null;
          }
          if (role === 'forward-fill' && (!this.forwardPredecode || holder.forwardToken !== this.forwardToken) && (!this.target || this.target.index !== ordinal)) return null;
          const delay = this.decodeDelayMs, decodeStartedAt = this.env.now();
          bitmap = this.frameDecoder ? await this.frameDecoder.decode(bytes, frame) : await this.env.decodeImage(bytes);
          const decodeEndedAt = this.env.now();
          // Test delay models service that has already entered the non-cancellable decoder.
          // An obsolete result can populate this material's bounded LRU, never its canvas.
          if (delay) await this.env.sleep(delay);
          if (!this._valid(epoch)) return null;
          if (role === 'forward-fill' && (!this.forwardPredecode || holder.forwardToken !== this.forwardToken) && (!this.target || this.target.index !== ordinal)) return null;
          if (!bitmap || bitmap.width !== info.width || bitmap.height !== info.height) throw new Error('JPEG解码尺寸与索引不符。');
          this.budget.shrink(reservation, rgba, 'decoded-frame');
          if (!compressed) this._rememberCompressed(ordinal, bytes);
          const entry = { index: ordinal, id: frame.id, bitmap, budget: reservation, readyAt: this.env.now(), usedAt: this.env.now() };
          this.cache.set(ordinal, entry); ++this.coverageVersion; transferred = true;
          this._emit('ready', { epoch, phase: 'read-and-image-decode-complete', requestId: request ? request.requestId : null,
            kind: request ? request.kind : role, frameId: frame.id, readyAt: entry.readyAt, inputAt: request ? request.inputAt : null,
            readStartedAt, readEndedAt, readMs: readEndedAt - readStartedAt,
            assetSource: compressed ? 'compressed-ram' : 'disk',
            decodeStartedAt, decodeEndedAt, decodeMs: decodeEndedAt - decodeStartedAt,
            injectedDelayMs: delay, decoderServiceMs: entry.readyAt - decodeStartedAt,
            delayModel: 'non-cancellable-service-after-decode-entry-v2',
            cacheStateAtInput: request ? request.cacheStateAtInput : null,
            stillTarget: !!this.target && this.target.epoch === epoch && this.target.index === ordinal, budgetBytes: this.budget.used });
          return entry;
        } finally {
          if (!transferred) { if (bitmap) { try { bitmap.close(); } catch (_) { /* best effort */ } } this.budget.release(reservation); }
          if (this.tasks.get(key) === holder) this.tasks.delete(key);
          this._emit('cache', { epoch, phase: 'image-work-ended', frameId: frame.id, activeImageTasks: this.tasks.size, budgetBytes: this.budget.used });
        }
      });
      holder.promise = task;
      this._emit('cache', { epoch, phase: 'image-work-start', frameId: frame.id, role, activeImageTasks: this.tasks.size });
      task.then(() => { this._startTargetWork(); this._startDragAheadWork(); this._tryReadySubmit(); }, error => {
        if (this._valid(epoch)) {
          if (info.streaming && error.code === 'MEDIA_CANCELLED' && (!this.target || this.target.index !== ordinal)) {
            this._startTargetWork(); return; // Seeking intentionally cancelled this obsolete segment.
          }
          if (this.target && this.target.resolve && this.target.index === ordinal || holder.fastPlayback && this.state === 'playing' && holder.playToken === this.playToken) this._fail(error);
          else { this.prefetchFailed.add(ordinal); if (role === 'forward-fill') this.forwardIssue = error.message;
            this._emit('error', { epoch, phase: 'background-image', frameId: frame.id, error: error.message }); }
        }
        this._startTargetWork(); this._startDragAheadWork();
      });
      return task;
    }
    _draw(target, entry, commitSource = 'raf') {
      if (!target.readyEmitted) {
        target.readyEmitted = true;
        this._emit('ready', { epoch: target.epoch, phase: 'effective-target-available', requestId: target.requestId,
          kind: target.kind, frameId: target.frameId, inputAt: target.inputAt, readyAt: this.env.now(),
          cachedDecodeReadyAt: entry.readyAt, cacheHit: entry.readyAt <= target.inputAt });
      }
      // No await or user callback between the final guard and the native draw.
      if (!this._valid(target.epoch) || this.target !== target || !target.resolve || target.index !== entry.index || this.cache.get(entry.index) !== entry) return;
      if (this.currentIndex === target.index) {
        // A new input can legitimately request the already displayed source frame.
        // Settle it explicitly without a canvas submission or fabricated draw sample.
        entry.usedAt = this.env.now(); this.waitingSince = null; if (this.state === 'playing') this.drawnPlayCycle = this.playCycle;
        if (this.state !== 'playing') this.state = 'paused';
        this._settle(target, 'reused', { time: this.time, settledAt: this.env.now(), targetTime: target.targetTime,
          responseMs: this.env.now() - target.inputAt, repeatedFrame: true, drawAt: null });
        if (this._valid(target.epoch) && this.target === target) this._change();
        return;
      }
      if (this.experimentMode === 'ready-submit' && this.lastSubmissionRaf === this.rafCount) return;
      this.ctx.drawImage(entry.bitmap, 0, 0, this.info.width, this.info.height);
      const drawAt = this.env.now(), info = this.info, frame = info.frames[target.index], repeated = this.currentIndex === target.index;
      const gap = this.lastDrawAt === null ? null : drawAt - this.lastDrawAt;
      if (gap !== null) this.maxDrawGapMs = Math.max(this.maxDrawGapMs, gap);
      this.lastDrawAt = drawAt; this.waitingSince = null; this.currentIndex = target.index; this.time = frame.time;
      if (this.state === 'playing') this.drawnPlayCycle = this.playCycle;
      entry.usedAt = drawAt; ++this.drawCount; if (this.state !== 'playing') this.state = 'paused';
      this.lastSubmissionRaf = this.rafCount;
      this.lastSubmission = { serial: ++this.submissionSerial, epoch: target.epoch, frameId: frame.id,
        requestId: target.requestId, inputAt: target.inputAt, drawAt, commitSource };
      let barcode = null;
      if (this.verifyMarkers && info.expected) {
        try { barcode = readBarcode(this.ctx, info.expected, target.index); }
        catch (error) { barcode = { actual: null, expected: null, ok: null, uncertain: true, error: error.message }; }
      }
      const event = { epoch: target.epoch, requestId: target.requestId, kind: target.kind, frameId: frame.id, frameOrdinal: target.index,
        cacheStateAtInput: target.cacheStateAtInput, readyToSubmitMs: Math.max(0, drawAt - Math.max(target.inputAt, entry.readyAt)),
        time: frame.time, targetTime: target.targetTime, mediaTime: this.state === 'playing' ? this._clockTime() : frame.time,
        inputAt: target.inputAt, readyAt: entry.readyAt, drawAt, responseMs: drawAt - target.inputAt,
        budgetBytes: this.budget.used, cachePeakBytes: this.budget.peak, rafOpportunity: this.rafCount, repeatedFrame: repeated,
        commitSource,
        sincePreviousDrawMs: gap, barcode, markerVerificationEnabled: this.verifyMarkers, markerReadbackCostIncludedAfterDraw: true,
        physicalDisplayTime: null, note: 'canvas submission; no physical-screen measurement' };
      this._settle(target, 'drawn', { time: frame.time, drawAt }); this._emit('draw', event);
      if (this._valid(target.epoch) && this.target === target) this._change();
    }
    _startBackground() {
      if (this.info && this.info.streaming) {
        if (this.forwardPredecode && !this.tasks.size && ['paused', 'playing'].includes(this.state) && this.currentIndex !== null) {
          const center = this.currentIndex, range = this.loopEnabled ? this._loopRange() : null;
          const first = range ? range.first : 0, last = range ? range.last : this.info.frames.length - 1;
          const direction = this.target && (this.target.stepDirection || Math.sign(this.target.dragDelta || 0)) || 1;
          const candidates = [];
          for (let offset = 1; offset <= Math.min(48, last - first); offset++) {
            const ordinal = center + offset * direction;
            const wrapped = range ? first + ((ordinal - first) % (last - first + 1) + last - first + 1) % (last - first + 1) : ordinal;
            if (wrapped >= first && wrapped <= last) candidates.push(wrapped);
          }
          const next = candidates.find(n => !this.cache.has(n) && !this.prefetchFailed.has(n));
          const needed = this.info.width * this.info.height * 4 + 2 * this.info.frames[center].bytes;
          if (next !== undefined && this.budget.limit - this.budget.used > needed) this._decode(next, 'forward-fill', null);
        }
        return;
      }
      if (!this.forwardPredecode || this.forwardIssue || !this.info || this.disposed || !['paused', 'playing'].includes(this.state) || this.tasks.size ||
          this.target && (this.target.resolve || !this.target.final && ['drag', 'rapid'].includes(this.target.kind) && this.env.now() - this.target.inputAt < 80)) return;
      const info = this.info;
      if (!this.warmPlan) this.warmPlan = this.experimentMode === 'compressed-ram' ? this._planCompressed(info) :
        { ordinals: [], batching: false, batchBytes: 1024 ** 2, transient: 0, largest: info.frames.reduce((n, f) => Math.max(n, f.bytes), 0) };
      const plan = this.warmPlan, rgba = info.width * info.height * 4;
      const headroom = 2 * (rgba + plan.largest * 2) + plan.transient;
      const unfilledCompressed = Math.max(0, this.compressedCapacity - this.compressedBytes);
      const center = this.target ? this.target.index : this.currentIndex;
      if (center === null) return;
      const fixed = this.budget.used - this.cache.size * rgba;
      const capacity = Math.max(1, Math.min(info.frames.length, Math.floor((this.budget.limit - fixed - headroom - unfilledCompressed - plan.largest * 2) / rgba)));
      if (!this.preparePlan || this.preparePlan.center !== center || this.preparePlan.capacity !== capacity)
        this.preparePlan = preparationWindow(info.frames, center, capacity);
      const window = this.preparePlan;
      const ordinal = window.order.find(n => !this.cache.has(n) && !this.prefetchFailed.has(n)), next = info.frames[ordinal];
      if (next) {
        const needed = rgba + next.bytes * 2 + headroom + unfilledCompressed;
        // Move only one remote frame per idle boundary, never a frame belonging
        // to this same window. A stationary cursor converges instead of churning.
        if (this.budget.limit - this.budget.used < needed) this._evictOutsideWindow(window);
        if (this.budget.limit - this.budget.used >= needed) {
          this.forwardStatus = 'preparing'; this._decode(ordinal, 'forward-fill', null); return;
        }
      } else this._evictOutsideWindow(window);
      this.forwardStatus = this.cache.size === info.frames.length ? 'complete' : 'budget';
      // Fill the reserved JPEG space only at idle boundaries, one bounded read
      // at a time. Foreground reads may race it; publication deduplicates tokens.
      const group = []; let size = 0, end = null;
      while (this.warmCursor < plan.ordinals.length) {
        const ordinal = plan.ordinals[this.warmCursor], frame = info.frames[ordinal];
        if (this.compressed.has(ordinal)) { ++this.warmCursor; continue; }
        if (group.length && (!plan.batching || size + frame.bytes > plan.batchBytes || frame.offset !== end)) break;
        if (this.budget.limit - this.budget.used < (size + frame.bytes) * 2 + 2 * (rgba + plan.largest * 2)) break;
        group.push(ordinal); size += frame.bytes; end = frame.offset + frame.bytes; ++this.warmCursor;
        if (!plan.batching || frame.bytes > plan.batchBytes) break;
      }
      if (!group.length) return;
      const epoch = this.epoch;
      const work = plan.batching && size <= plan.batchBytes ? this._readCompressedBatch(info, epoch, group) : this._readCompressed(info, epoch, group[0]);
      work.catch(error => {
        if (this._valid(epoch)) { this.forwardIssue = error.message; this._emit('error', { epoch, phase: 'background-jpeg-read', error: error.message }); }
      });
    }
    _pump() {
      const target = this.target;
      if (this.info && target && target.resolve && this.state !== 'error') {
        if (!target.effectiveEmitted) {
          target.effectiveEmitted = true; this._emit('request', { epoch: target.epoch, phase: 'effective-frame', requestId: target.requestId,
            kind: target.kind, frameId: target.frameId, targetTime: target.targetTime, inputAt: target.inputAt });
        }
        if (this.target !== target || !this._valid(target.epoch)) return;
        const entry = this.cache.get(target.index);
        if (entry) this._draw(target, entry);
        else this._startTargetWork();
      }
      if (!this.info || this.state === 'loading' || this.state === 'error' || this.disposed) return;
      // Busy dragging reserves slots for the latest target and its prediction;
      // surrounding fill resumes after the quiet threshold, even while held.
      if (this.target && this.target.resolve) return;
      if (this.state !== 'playing' && this.target && !this.target.final && ['drag', 'rapid'].includes(this.target.kind)) { this._startBackground(); return; }
      const base = this.currentIndex, playing = this.state === 'playing';
      if (playing && this.info.streaming && this.prefetchMedia) this.prefetchMedia(this._clockTime(), this.loopEnabled ? this._loopRange() : null);
      if (this.forwardPredecode && !playing) { this._startBackground(); return; }
      const maximumTasks = playing ? 2 : 1, direction = this.target && this.target.stepDirection || 1;
      // Reserve the spare task slot for new input. Paused inspection prepares
      // both sides, prioritising the most recent stepping direction.
      const offsets = playing ? this._playAheadOrdinals(this._clockTime(), base) : [direction, -direction, direction * 2, -direction * 2, direction * 3, -direction * 3];
      for (const offset of offsets) {
        if (base === null || this.tasks.size >= maximumTasks) break;
        const loop = playing && this.loopEnabled ? this._loopRange() : null;
        const ordinal = playing ? offset : base + offset;
        if (ordinal < 0 || ordinal >= this.info.frames.length) continue;
        const delta = this.info.frames[ordinal].time - this.info.frames[base].time + (loop && ordinal < base ? loop.end - loop.start : 0);
        if (playing && delta < 0 && !loop) continue;
        if (!this.cache.has(ordinal) && !this.tasks.has(this.epoch + ':' + ordinal) && !this.prefetchFailed.has(ordinal)) this._decode(ordinal, playing ? 'play-ahead' : 'neighbour', null);
      }
      this._startBackground();
    }
    _schedule() { if (!this.disposed) this.rafId = this.env.raf(() => this._tick()); }
    _observeCanvas() {
      const last = this.lastSubmission;
      if (!this.observeCanvas || !last || !this._valid(last.epoch) || last.serial === this.observedSerial) return;
      const distinctChanged = last.frameId !== this.observedFrame, submissionsSinceLastObservation = last.serial - this.observedSerial;
      this.observedSerial = last.serial; this.observedFrame = last.frameId;
      this._emit('observation', { ...last, observedAt: this.env.now(), distinctChanged, submissionsSinceLastObservation,
        rafOpportunity: this.rafCount, latestAtObservation: !!this.target && last.requestId === this.target.requestId,
        measurement: 'final canvas identity at rAF callback; not physical presentation' });
    }
    _tick() {
      this.rafId = null; if (this.disposed) return; ++this.rafCount;
      const tickAt = this.env.now(), interval = this.lastTickAt === null ? 0 : tickAt - this.lastTickAt;
      if (interval >= 8 && interval <= 100) this.displayInterval = this.displayInterval * .75 + interval * .25;
      this.lastTickAt = tickAt;
      this.inRaf = true;
      try {
        if (this.info && this.state === 'playing') {
          const epoch = this.epoch, media = this._clockTime(), range = this.loopEnabled ? this._loopRange() : null;
          const raw = this.index.frameAt(this.info.frames, media), ordinal = range ? Math.max(range.first, Math.min(range.last, raw)) : raw;
          if (this.segmentAudio && !this.segmentAudio.update()) { this._recoverSupply(media, ordinal); this._schedule(); return; }
          const fast = this.playbackRate > 1;
          if (fast && range && ordinal < this.lastPlayOrdinal) ++this.playCycle;
          this.lastPlayOrdinal = ordinal;
          const ready = fast ? this._readyPlayOrdinal(ordinal) : null;
          const display = ready === null || ready === this.currentIndex ? ordinal : ready;
          if (media >= this.info.duration) {
            this._halt(false); this._request(this.info.duration, { kind: 'ended', final: true, inputAt: this.env.now() });
          } else if ((display !== this.currentIndex || fast && this.drawnPlayCycle !== this.playCycle) && (!this.target || this.target.index !== display || !this.target.resolve)) {
            this._request(fast ? this.info.frames[display].time : media, { kind: 'play', index: display, inputAt: this.env.now() });
          }
          if (fast && this.state === 'playing' && !this.cache.has(ordinal) && !this.tasks.has(epoch + ':' + ordinal) && this.tasks.size < 2) {
            this._decode(ordinal, 'play-ahead', null);
          }
          if (this._valid(epoch) && this.state === 'playing') {
            // Count missing supply only after a *new source frame* becomes due. A low-fps hold is not an underrun.
            if (!fast && ordinal !== this.currentIndex && !this.cache.has(ordinal)) {
              if (this.waitingSince === null) this.waitingSince = this.env.now();
              if (this.env.now() - this.waitingSince > this.playbackGuardMs) {
                this._recoverSupply(media, ordinal);
              }
            } else this.waitingSince = null;
            if (this.env.now() - this.lastClockEmit >= 250) {
              this.lastClockEmit = this.env.now(); this._emit('clock', { epoch, phase: 'sample', mediaTime: media, method: this.clockMethod, rafOpportunity: this.rafCount });
            }
          }
        }
        this._pump();
        this._observeCanvas();
      } catch (error) { this._fail(error); }
      finally { this.inRaf = false; }
      this._schedule();
    }
    _fail(error) {
      this._halt(false); this.lastIssue = error.message; this.lastErrorCode = error.code || null;
      const target = this.target; this.state = 'error'; this._settle(target, 'error', { error: error.message, code: error.code || null });
      this._emit('error', { error: error.message, code: error.code || null }); this._change();
    }
    async _closeContext(context) {
      try { if (context && context.state !== 'closed') await context.close(); } catch (error) { this.telemetryIssue = error.message; }
      this.contexts.delete(context);
    }
    async dispose() {
      if (this.disposePromise) return this.disposePromise;
      this.disposed = true; ++this.epoch; this._halt(false); if (this.rafId !== null) this.env.caf(this.rafId);
      if (this.cancelMediaReads) this.cancelMediaReads();
      this._clearTarget('disposed'); this._clearCache(); this._clearCompressed(); this.audioBuffer = null; this.budget.release(this.audioBudget); this.audioBudget = null;
      this._change('disposed');
      this.disposePromise = (async () => {
        if (this.frameDecoder) { await this.frameDecoder.close(); this.frameDecoder = null; }
        if (this.segmentAudio) { await this.segmentAudio.close(); this.segmentAudio = null; }
        await Promise.allSettled(Array.from(this.contexts).map(context => this._closeContext(context)));
        await Promise.allSettled(Array.from(this.loads).concat(Array.from(this.tasks.values()).map(task => task.promise)));
        this.audioContext = null; this.info = null; this._emit('cache', { phase: 'disposed', budgetBytes: this.budget.used });
      })();
      return this.disposePromise;
    }
  }
  return { Player, Budget, ManagedBudget: Budget, readBarcode, decodedRanges, preparationWindow, validRate, steppedRate, RATE_STEPS, RATE_PRESETS };
});
