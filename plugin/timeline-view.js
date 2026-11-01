/* Display coordinates only. No media, files, SDK calls or persistent state. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window === 'object' && window) window.EVATimelineView = api;
  else if (root && root.document) root.EVATimelineView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = value => Math.max(0, Math.min(1, value));
  function visibleRange(duration, loop, editing = false) {
    const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const full = { start: 0, end, focused: false };
    if (editing || !end || !loop || !loop.enabled || !loop.valid ||
        !Number.isFinite(loop.startTime) || !Number.isFinite(loop.endTime)) return full;
    const start = Math.max(0, loop.startTime);
    // endTime is the selected frame's PTS; endBoundary includes its duration.
    // Older in-memory callers may omit the boundary. Never invent an FPS.
    const finish = Math.min(end, Number.isFinite(loop.endBoundary) && loop.endBoundary > loop.endTime ? loop.endBoundary : loop.endTime);
    if (!(finish > start)) return full;
    const padding = (finish - start) * .05;
    return { start: Math.max(0, start - padding), end: Math.min(end, finish + padding), focused: true };
  }
  function ratio(time, range) {
    return range && range.end > range.start && Number.isFinite(time) ? clamp((time - range.start) / (range.end - range.start)) : 0;
  }
  function timeAt(x, rect, range) {
    if (typeof range === 'number') range = { start: 0, end: range };
    if (!Number.isFinite(x) || !rect || !(rect.width > 0) || !range || !(range.end > range.start)) return null;
    return range.start + clamp((x - rect.left) / rect.width) * (range.end - range.start);
  }
  function contains(time, range) {
    return !!range && Number.isFinite(time) && range.end > range.start && time >= range.start && time <= range.end;
  }
  function clip(start, end, range) {
    if (!range || !Number.isFinite(start) || !Number.isFinite(end)) return null;
    const first = Math.max(start, range.start), last = Math.min(end, range.end);
    return last > first ? { start: ratio(first, range), end: ratio(last, range) } : null;
  }
  function niceStep(value) {
    const unit = 10 ** Math.floor(Math.log10(value));
    const fraction = value / unit;
    return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * unit;
  }
  function tickLabel(time, step) {
    const digits = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)));
    if (time < 60) return time.toFixed(digits) + 's';
    return Math.floor(time / 60) + ':' + (time % 60).toFixed(digits).padStart(digits ? digits + 3 : 2, '0');
  }
  function ticks(range, width) {
    if (!range || !(range.end > range.start) || !Number.isFinite(width) || width < 32) return [];
    const span = range.end - range.start, minimum = range.focused || span < 1 ? .001 : 1;
    let step = niceStep(Math.max(minimum, span * 64 / width));
    const labelSpace = Math.max(64, tickLabel(range.end, step).length * 9 + 18);
    step = niceStep(Math.max(step, span * labelSpace / width));
    const result = [];
    let labelEnd = -10;
    const first = Math.ceil(range.start / step - 1e-9), last = Math.floor(range.end / step + 1e-9);
    for (let index = first; index <= last && result.length < 256; index++) {
      const time = Number((index * step).toFixed(9));
      if (time < range.start - 1e-9 || time > range.end + 1e-9) continue;
      const position = ratio(time, range), label = tickLabel(time, step), labelWidth = label.length * 7 + 4;
      const left = Math.max(0, Math.min(width - labelWidth, position * width - labelWidth / 2));
      const showLabel = left >= labelEnd + 10 && labelWidth <= width;
      if (showLabel) labelEnd = left + labelWidth;
      result.push({ time, position, label: showLabel ? label : '', labelOffset: left - position * width });
    }
    return result;
  }
  // Non-overlapping hit cells. Dense neighbours retain their original times;
  // the UI asks which record instead of relying on DOM stacking order.
  function markerCells(times, range, width) {
    if (!(width > 0)) return [];
    const points = times.map((time,index)=>({time,index,x:ratio(time,range)*width})).filter(p=>contains(p.time,range)).sort((a,b)=>a.time-b.time||a.index-b.index);
    let group=[];
    for(let i=0;i<points.length;i++) {
      const p=points[i],prev=points[i-1],next=points[i+1];
      if(!prev||p.x-prev.x>=12)group=[];
      p.group=group;group.push(p.index);
      p.left=Math.max(0,p.x-10,prev?(p.x+prev.x)/2:0);
      p.right=Math.min(width,p.x+10,next?(p.x+next.x)/2:width);
    }
    return points;
  }
  return { visibleRange, ratio, timeAt, contains, clip, ticks, markerCells };
});
