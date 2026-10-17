'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const { REPO, sha, store } = require('./workspace.cjs');
const { decode } = require('../../tests/support/long-trace.cjs');
const { createAggregation } = require('../../tests/support/mvp-resource.cjs');
function receipt(slot) {
  const file = path.join(REPO, 'verification-runs/t4/slot-' + slot + '/record.json'), bytes = fs.readFileSync(file), x = JSON.parse(bytes);
  if (bytes.length > 256 * 1024 || x.encoding !== 'gzip-base64') throw Error('Old receipt envelope invalid');
  const raw = zlib.gunzipSync(Buffer.from(x.data, 'base64'), { maxOutputLength: 2 * 1024 ** 2 });
  if (raw.length !== x.rawBytes || sha(raw) !== x.payloadSha256) throw Error('Old receipt digest mismatch');
  return { payload: JSON.parse(raw), receipt: { slot, bytes: bytes.length, sha256: sha(bytes) } };
}
function median(xs) { const a = xs.slice().sort((a, b) => a - b); return a.length ? a[Math.floor(a.length / 2)] : null; }
function audit() {
  const previous = receipt(235), agg = createAggregation(), windows = new Map(), receipts = [], gaps = [];
  let total = 0, native = 0, renderer = 0, prior = null, firstCross = null, managedPeak = 0;
  for (let n = 228; n <= 233; n++) {
    const x = receipt(n); receipts.push(x.receipt);
    for (const event of decode(x.payload)) {
      total++;
      if (event.kind === 'native') {
        native++; const measured = agg.add(event.native);
        if (measured.stopRequested && !firstCross) firstCross = { atMs: event.native.atMs, pluginRssBytes: measured.pluginRssBytes,
          roles: Object.fromEntries(event.native.processes.filter(p => ['renderer', 'task-guard', 'task-worker'].includes(p.role)).map(p => [p.role, p.rssBytes])) };
        const c = event.context;
        if (c && c.phase && ((c.elapsedMs >= 600000 && c.elapsedMs < 900000) || (c.elapsedMs >= 1500000 && c.elapsedMs < 1800000))) {
          const period = c.elapsedMs < 900000 ? '10-15' : '25-30', key = period + ':' + c.sample + ':' + c.phase;
          if (!windows.has(key)) windows.set(key, []); windows.get(key).push(measured.pluginRssBytes);
        }
      } else if (event.kind === 'renderer') {
        renderer++; const r = event.row;
        if (!Array.isArray(r) || r.length !== 12 || !Number.isFinite(r[0])) throw Error('Invalid historical renderer row');
        if (prior !== null) gaps.push(r[0] - prior); prior = r[0];
        managedPeak = Math.max(managedPeak, r[4] || 0);
      }
    }
  }
  assert.deepStrictEqual(agg.summary(), previous.payload.recomputedNativeSummary);
  assert.strictEqual(total, previous.payload.totalEvents);
  assert.strictEqual(managedPeak,previous.payload.managedPeakBytes);
  const results = { schema: 'evolution-old-resource-audit-v1', previousAudit: previous.receipt, receipts, total, native, renderer,
    peaks: agg.summary().peaks, firstCross, managedPeak,rendererMaxGapMs:Math.max(...gaps),phaseMedians: [...windows].map(([key, xs]) => ({ key, samples: xs.length, medianBytes: median(xs) })),
    oldStatisticsMatchedExactly: true, productLeakEstablished: false, longTermPassed: false,
    conclusion: 'True RSS threshold crossing; bounded cache and old test-encoding transient overhead remain distinct. New natural-use evidence is required.' };
  const saved = store().save('old-resource-audit', results); console.log(JSON.stringify({ saved, total, native, renderer, peaks: results.peaks, firstCross, productLeakEstablished: false }));
  return results;
}
if (require.main === module) audit();
module.exports = { audit, receipt, median };
