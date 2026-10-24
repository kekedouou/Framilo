(function () {
  'use strict';
  const canvas = document.getElementById('baselineScene');
  const comments = document.getElementById('baselineComments');
  const markers = document.getElementById('baselineMarkers');
  const state = VFModel.createModel().state;
  const frame = 56;
  const objects = state.records.find(record => record.frame === frame)?.objects || [];

  for (const record of state.records) {
    const marker = document.createElement('span');
    marker.className = 'marker';
    marker.style.left = record.frame / (state.count - 1) * 100 + '%';
    markers.appendChild(marker);
    const entries = record.entries.length ? record.entries : [{ text: '圈画标注' }];
    for (const entry of entries) {
      const item = document.createElement('button');
      const seconds = record.frame / 24;
      item.type = 'button';
      item.disabled = true;
      item.className = 'comment-item';
      item.textContent = '0:' + seconds.toFixed(3).padStart(6, '0') + '  ' + entry.text;
      comments.appendChild(item);
    }
  }

  function draw() {
    VFScene.draw(canvas, { frame, count: state.count, aspect: 'wide', objects });
  }
  draw();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  } else {
    window.addEventListener('resize', draw);
  }
})();
