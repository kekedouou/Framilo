/* One bounded WebCodecs decoder per proxy session; no file or host access. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'object' && window) window.EVAProxyDecoder = api;
  else if (root && root.document) root.EVAProxyDecoder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const issue = (code, message) => Object.assign(new Error(message), { code });

  // A packet is one Annex-B access unit, independently readable at every IDR.
  // SPS/PPS travel in every packet so a seek never needs an earlier packet.
  function annexB(bytes) {
    let value;
    if (ArrayBuffer.isView(bytes)) value = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    else if (bytes instanceof ArrayBuffer) value = new Uint8Array(bytes);
    else throw issue('PROXY_PACKET_INVALID', '代理画面数据不是字节缓冲。');
    let codec = null, pps = false, idr = false, starts = 0;
    for (let i = 0; i + 3 < value.length; i++) {
      if (value[i] !== 0 || value[i + 1] !== 0) continue;
      const n = value[i + 2] === 1 ? i + 3 : value[i + 2] === 0 && value[i + 3] === 1 ? i + 4 : -1;
      if (n < 0 || n >= value.length) continue;
      if (++starts > 256) throw issue('PROXY_PACKET_INVALID', '代理画面包含过多编码单元。');
      const type = value[n] & 31;
      if (type === 7) {
        if (n + 3 >= value.length) throw issue('PROXY_PACKET_INVALID', '代理SPS不完整。');
        const next = 'avc1.' + [...value.subarray(n + 1, n + 4)].map(b => b.toString(16).padStart(2, '0')).join('');
        if (codec && codec !== next) throw issue('PROXY_PACKET_INVALID', '单帧代理的编码配置不一致。');
        codec = next;
      }
      if (type === 8) pps = true;
      if (type === 5) idr = true;
      // Ordinary dependent pictures must never be labelled independent keys.
      if (type >= 1 && type <= 4) throw issue('PROXY_PACKET_NOT_INTRA', '代理包含依赖其它画面的帧。');
      i = n;
    }
    if (!codec || !pps || !idr) throw issue('PROXY_PACKET_NOT_INTRA', '代理画面缺少独立解码需要的SPS、PPS或IDR。');
    return { bytes: value, codec };
  }

  function createProxyDecoder(options = {}) {
    const { width, height } = options;
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw issue('PROXY_SIZE_INVALID', '代理画面尺寸无效。');
    const NativeDecoder = options.VideoDecoder || globalThis.VideoDecoder;
    const NativeChunk = options.EncodedVideoChunk || globalThis.EncodedVideoChunk;
    const bitmap = options.createImageBitmap || globalThis.createImageBitmap;
    const setTimer = options.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms));
    const clearTimer = options.clearTimeout || (id => globalThis.clearTimeout(id));
    const now = options.now || (() => typeof performance === 'object' ? performance.now() : Date.now());
    const timeoutMs = options.timeoutMs === undefined ? 2000 : options.timeoutMs;
    const flushAfterMs = options.flushAfterMs === undefined ? 8 : options.flushAfterMs;
    const maxChunkBytes = options.maxChunkBytes === undefined ? 8 * 1024 ** 2 : options.maxChunkBytes;
    if (!(timeoutMs > 0 && Number.isFinite(timeoutMs)) ||
        !(flushAfterMs === null || Number.isFinite(flushAfterMs) && flushAfterMs >= 0 && flushAfterMs < timeoutMs) ||
        !Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1)
      throw issue('PROXY_LIMIT_INVALID', '代理解码等待或容量限制无效。');
    if (typeof NativeDecoder !== 'function' || typeof NativeChunk !== 'function' || typeof bitmap !== 'function')
      throw issue('PROXY_DECODER_UNAVAILABLE', '当前宿主不支持此代理解码方式，请使用JPEG模式。');

    const pending = new Map(), work = new Set(), conversions = new Set();
    let decoder = null, initializing = null, codec = null, closed = false, failure = null, closeTask = null;
    let serial = 0, flushWork = null, preference = options.hardwareAcceleration || 'prefer-hardware';
    if (!['prefer-hardware', 'prefer-software', 'no-preference'].includes(preference))
      throw issue('PROXY_CONFIG_INVALID', '代理硬件偏好无效。');
    const counts = { decoded: 0, delivered: 0, cancelled: 0, flushes: 0, closedFrames: 0, discardedBitmaps: 0, peakPending: 0 };
    const safeClose = object => { if (object && typeof object.close === 'function') { try { object.close(); } catch (_) { /* already closed */ } } };
    function settle(entry, error, value) {
      if (entry.settled) return;
      entry.settled = true;
      if (entry.signal) entry.signal.removeEventListener('abort', entry.abort);
      error ? entry.reject(error) : entry.resolve(value);
    }
    function finish(entry) {
      if (entry.finished) return;
      entry.finished = true; clearTimer(entry.timer); clearTimer(entry.flushTimer);
      if (entry.signal) entry.signal.removeEventListener('abort', entry.abort);
      pending.delete(entry.timestamp); work.delete(entry);
    }
    function stop(error) {
      if (!failure && !closed) failure = error;
      if (decoder && decoder.state !== 'closed') { try { decoder.close(); } catch (_) { /* native decoder already failed */ } }
      for (const entry of [...work]) {
        settle(entry, error);
        if (entry.phase !== 'bitmap') finish(entry); // Non-cancellable conversion retains its actual resource until it settles.
      }
    }
    function output(frame) {
      const entry = pending.get(frame.timestamp);
      if (closed || failure || !entry || entry.finished || entry.phase !== 'decode') {
        safeClose(frame); counts.closedFrames++;
        if (!closed && !failure) stop(issue('PROXY_FRAME_UNEXPECTED', '代理解码返回了不属于当前请求的画面。'));
        return;
      }
      pending.delete(entry.timestamp); clearTimer(entry.timer); clearTimer(entry.flushTimer); counts.decoded++;
      if (entry.cancelled) { safeClose(frame); counts.closedFrames++; finish(entry); return; }
      entry.phase = 'bitmap';
      const conversion = Promise.resolve().then(async () => {
        let image = null;
        try {
          if (frame.displayWidth !== width || frame.displayHeight !== height)
            throw issue('PROXY_FRAME_SIZE', '代理解码画面尺寸与清单不符。');
          image = await bitmap(frame);
          if (!image || image.width !== width || image.height !== height)
            throw issue('PROXY_FRAME_SIZE', '代理位图尺寸与清单不符。');
          if (closed || failure || entry.cancelled || entry.settled) {
            safeClose(image); counts.discardedBitmaps++; image = null;
          } else {
            counts.delivered++; settle(entry, null, image); image = null; // Caller owns and must close the delivered bitmap.
          }
        } catch (error) {
          if (image) { safeClose(image); counts.discardedBitmaps++; }
          settle(entry, error); stop(error);
        } finally {
          safeClose(frame); counts.closedFrames++; finish(entry);
        }
      });
      conversions.add(conversion); conversion.then(() => conversions.delete(conversion), () => conversions.delete(conversion));
    }
    async function initialize(requestedCodec) {
      if (codec && codec !== requestedCodec) throw issue('PROXY_CONFIG_CHANGED', '同一代理会话的编码配置改变，请重新打开。');
      if (initializing) return initializing;
      codec = requestedCodec;
      initializing = (async () => {
        let config = { codec, codedWidth: width, codedHeight: height, hardwareAcceleration: preference, optimizeForLatency: true };
        if (typeof NativeDecoder.isConfigSupported === 'function') {
          let support = await NativeDecoder.isConfigSupported(config);
          if (!support.supported && preference === 'prefer-hardware' && options.allowSoftwareFallback !== false) {
            preference = 'no-preference'; config = { ...config, hardwareAcceleration: preference };
            support = await NativeDecoder.isConfigSupported(config);
          }
          if (!support.supported) throw issue('PROXY_DECODER_UNSUPPORTED', '当前宿主无法解码此代理配置，请使用JPEG模式。');
        }
        if (closed || failure) return;
        decoder = new NativeDecoder({ output, error: error => stop(issue('PROXY_DECODE_FAILED', error.message || '代理解码失败。')) });
        decoder.configure(config);
      })();
      return initializing;
    }
    function flush(entry) {
      if (closed || failure || entry.finished || entry.phase !== 'decode' || flushWork || !decoder || decoder.state !== 'configured') return;
      counts.flushes++;
      // Some native H264 decoders retain the first packet. Flush emits pending
      // output without reconstructing the decoder. Every following packet is a key.
      try { flushWork = Promise.resolve(decoder.flush()); }
      catch (error) { stop(error); return; }
      flushWork.then(() => { flushWork = null; }, error => { flushWork = null; if (!closed && !failure) stop(error); });
    }
    function decode(bytes, frame, settings = {}) {
      if (closed || failure) return Promise.reject(failure || issue('PROXY_DECODER_CLOSED', '代理解码已关闭。'));
      if (!frame || !Number.isSafeInteger(frame.id) || frame.id < 0) return Promise.reject(issue('PROXY_FRAME_INVALID', '代理请求缺少源帧身份。'));
      if (settings.signal && settings.signal.aborted) return Promise.reject(issue('MEDIA_CANCELLED', '代理画面请求已取消。'));
      if (work.size >= 2) return Promise.reject(issue('PROXY_DECODE_LIMIT', '代理解码超过两个在途槽。'));
      let packet;
      try {
        if (!bytes || !Number.isSafeInteger(bytes.byteLength) || bytes.byteLength <= 0 || bytes.byteLength > maxChunkBytes)
          throw issue('PROXY_PACKET_LIMIT', '代理画面字节数超出资源限制。');
        packet = annexB(bytes);
      } catch (error) { return Promise.reject(error); }
      if (serial >= Number.MAX_SAFE_INTEGER) return Promise.reject(issue('PROXY_TIMESTAMP_LIMIT', '代理请求编号已达到上限。'));
      const started = now(), timestamp = ++serial;
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const entry = { timestamp, sourceFrameId: frame.id, started, resolve, reject, settled: false, finished: false,
        phase: 'setup', cancelled: false, signal: settings.signal, timer: null, flushTimer: null, abort: null };
      work.add(entry); counts.peakPending = Math.max(counts.peakPending, work.size);
      entry.abort = () => {
        if (entry.finished || entry.cancelled) return;
        entry.cancelled = true; counts.cancelled++; settle(entry, issue('MEDIA_CANCELLED', '代理画面请求已取消。'));
        if (entry.phase === 'setup') finish(entry); // Submitted native work keeps its slot until output/drain.
      };
      if (entry.signal) entry.signal.addEventListener('abort', entry.abort, { once: true });
      entry.timer = setTimer(() => stop(issue('PROXY_DECODE_TIMEOUT', '代理画面解码超时，未显示未经确认的画面。')), timeoutMs);
      Promise.resolve().then(async () => {
        await initialize(packet.codec);
        if (entry.finished || closed || failure) return;
        entry.phase = 'decode'; pending.set(timestamp, entry);
        decoder.decode(new NativeChunk({ type: 'key', timestamp, data: packet.bytes }));
        if (flushAfterMs !== null && !entry.finished && entry.phase === 'decode') entry.flushTimer = setTimer(() => flush(entry), flushAfterMs);
      }).catch(error => { settle(entry, error); finish(entry); if (!closed && !failure) stop(error); });
      return promise;
    }
    function close() {
      if (closeTask) return closeTask;
      closed = true; stop(issue('PROXY_DECODER_CLOSED', '代理解码已关闭。'));
      closeTask = (async () => { await Promise.allSettled([...conversions]); })();
      return closeTask;
    }
    function snapshot() {
      return { state: closed ? 'closed' : failure ? 'error' : decoder ? 'ready' : 'idle', codec, hardwarePreference: preference,
        hardwareVerified: false, pending: work.size, nativePending: pending.size, bitmapConversions: conversions.size,
        maxPending: 2, flushAfterMs, ...counts, lastError: failure ? { code: failure.code || 'PROXY_DECODE_FAILED', message: failure.message } : null };
    }
    return { decode, close, snapshot };
  }
  return { createProxyDecoder, annexB };
});
