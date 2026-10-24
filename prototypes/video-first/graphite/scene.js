/* Original synthetic media for UI-01. No media, timers or host APIs are used. */
(function (root) {
  'use strict';

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function number(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function ratio(aspect) {
    if (aspect === 'portrait' || aspect === 'tall') return 9 / 16;
    if (aspect === 'square') return 1;
    if (typeof aspect === 'number' && aspect > 0) return aspect;
    return 16 / 9;
  }

  function noise(seed) {
    var value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function ellipse(ctx, x, y, rx, ry, color, width) {
    if (rx <= 0 || ry <= 0) return;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  const stills=typeof Image==='function'?[1,2,3,4].map(n=>{const img=new Image();img.src='../design-round-02/assets/scene-'+n+'.svg';return img;}):[];
  function media(ctx, width, height, frame, count) {
    const image=stills[Math.min(3,Math.floor(frame/Math.max(1,count)*4))];
    if(image&&image.complete&&image.naturalWidth){ctx.fillStyle='#080e12';ctx.fillRect(0,0,width,height);const scale=Math.min(width/image.naturalWidth,height/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale;ctx.drawImage(image,(width-w)/2,(height-h)/2,w,h);return;}

    var unit = Math.min(width, height);
    var progress = clamp(frame / Math.max(1, count - 1), 0, 1);
    var phase = clamp((progress - 0.035) / 0.88, 0, 1);
    var age = phase * 2.6;
    var burst = Math.sin(Math.min(1, phase * 4.2) * Math.PI / 2);
    var fade = Math.pow(1 - phase, 1.25);
    var cx = width * 0.5;
    var cy = height * 0.72;

    ctx.fillStyle = '#17191b';
    ctx.fillRect(0, 0, width, height);
    var room = ctx.createLinearGradient(0, 0, 0, height);
    room.addColorStop(0, '#111315');
    room.addColorStop(0.48, '#1c1e20');
    room.addColorStop(1, '#252729');
    ctx.fillStyle = room;
    ctx.fillRect(0, 0, width, height);

    // A quiet floor gives the effect scale without adding interface-like marks.
    var horizon = height * 0.43;
    ctx.fillStyle = '#222426';
    ctx.fillRect(0, horizon, width, height - horizon);
    var ground = ctx.createLinearGradient(0, horizon, 0, height);
    ground.addColorStop(0, '#1d1f21');
    ground.addColorStop(1, '#292b2c');
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, width, height - horizon);
    ctx.lineWidth = Math.max(0.5, unit * 0.001);
    ctx.strokeStyle = '#ffffff05';
    for (var grid = -4; grid <= 4; grid += 1) {
      ctx.beginPath();
      ctx.moveTo(cx + grid * width * 0.025, horizon);
      ctx.lineTo(cx + grid * width * 0.34, height);
      ctx.stroke();
    }
    for (var row = 1; row <= 6; row += 1) {
      var gy = horizon + (height - horizon) * Math.pow(row / 6, 2);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }

    // Small stationary fragments remain recognisable at the quiet end frames.
    ctx.fillStyle = '#353739';
    for (var chip = 0; chip < 12; chip += 1) {
      var chipX = cx + (noise(chip + 101) - 0.5) * unit * 0.24;
      var chipY = cy + (noise(chip + 205) - 0.5) * unit * 0.06;
      var chipW = (0.004 + noise(chip + 302) * 0.01) * unit;
      ctx.fillRect(chipX, chipY, chipW, Math.max(1, chipW * 0.18));
    }

    var radius = unit * (0.018 + burst * 0.15 + phase * 0.27);
    var ringAlpha = fade * Math.min(1, phase * 15);
    ellipse(ctx, cx, cy, radius, radius * 0.265,
      'rgba(227,165,91,' + ringAlpha * 0.54 + ')', Math.max(0.7, unit * 0.002));
    ellipse(ctx, cx, cy - unit * 0.003, radius * 0.89, radius * 0.236,
      'rgba(225,231,229,' + ringAlpha * 0.28 + ')', Math.max(0.6, unit * 0.0012));

    // Warm ballistic sparks and a few cool fragments use a fixed seed per particle.
    for (var i = 0; i < 114; i += 1) {
      var seed = i + 1;
      var delay = noise(seed * 3.1) * 0.12;
      var elapsed = age - delay;
      if (elapsed <= 0) continue;
      var life = 0.58 + noise(seed * 4.3) * 1.7;
      var opacity = clamp(1 - elapsed / life, 0, 1);
      if (opacity <= 0) continue;
      var direction = -Math.PI * (0.11 + noise(seed * 5.4) * 0.78);
      var speed = unit * (0.105 + noise(seed * 6.7) * 0.23);
      var vx = Math.cos(direction) * speed;
      var vy = Math.sin(direction) * speed;
      var depth = 0.65 + noise(seed * 8.8) * 0.55;
      var gravity = unit * 0.12;
      var px = cx + vx * elapsed * depth;
      var py = cy + vy * elapsed + gravity * elapsed * elapsed * 0.5;
      var trail = Math.min(0.026, elapsed) * (0.4 + noise(seed * 7.3));
      var oldX = cx + vx * (elapsed - trail) * depth;
      var oldY = cy + vy * (elapsed - trail) + gravity * Math.pow(elapsed - trail, 2) * 0.5;
      if (py > cy + unit * 0.1) continue;
      var cool = i % 9 === 0;
      ctx.strokeStyle = cool
        ? 'rgba(224,235,238,' + opacity * 0.76 + ')'
        : 'rgba(231,174,103,' + opacity * 0.83 + ')';
      ctx.lineWidth = Math.max(0.65, unit * (cool ? 0.0016 : 0.0012));
      ctx.beginPath();
      ctx.moveTo(oldX, oldY);
      ctx.lineTo(px, py);
      ctx.stroke();
      if (i % 8 === 0 && opacity > 0.3) {
        ctx.fillStyle = cool ? '#e5eeee' : '#e9ba7f';
        ctx.globalAlpha = opacity * 0.7;
        ctx.fillRect(px, py, unit * 0.0027, unit * 0.0027);
        ctx.globalAlpha = 1;
      }
    }

    // A narrow white ribbon opens into the warm impact, then dissipates.
    var ribbon = Math.max(0, 1 - phase * 2.5);
    if (ribbon > 0 && phase > 0) {
      ctx.beginPath();
      var ribbonWidth = unit * (0.05 + phase * 0.32);
      for (var step = 0; step <= 40; step += 1) {
        var t = step / 40;
        var x = cx + (t - 0.5) * ribbonWidth;
        var y = cy - Math.sin(t * Math.PI) * unit * (0.012 + phase * 0.1);
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(230,237,237,' + ribbon * 0.75 + ')';
      ctx.lineWidth = Math.max(0.8, unit * 0.003);
      ctx.stroke();
    }

    var core = Math.max(0, 1 - phase * 4.5) * Math.min(1, phase * 25);
    if (core > 0) {
      ctx.fillStyle = 'rgba(242,231,211,' + core * 0.9 + ')';
      ctx.beginPath();
      ctx.ellipse(cx, cy - unit * 0.003, unit * 0.012, unit * 0.004, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawObjects(ctx, width, height, objects) {
    if (!Array.isArray(objects)) return;
    var unit = Math.min(width, height);
    objects.forEach(function (object) {
      if (!object || typeof object !== 'object') return;
      var type = object.type || object.tool || 'pen';
      var x = clamp(number(object.x, 0), 0, 1) * width;
      var y = clamp(number(object.y, 0), 0, 1) * height;
      var x2 = clamp(number(object.x2, object.x), 0, 1) * width;
      var y2 = clamp(number(object.y2, object.y), 0, 1) * height;
      var line = clamp(number(object.width, 0.003), 0.0004, 0.12) * unit;
      ctx.save();
      ctx.strokeStyle = '#ecebe5';
      ctx.fillStyle = '#ecebe5';
      if (typeof object.color === 'string') {
        ctx.strokeStyle = object.color;
        ctx.fillStyle = object.color;
      }
      ctx.lineWidth = Math.max(0.7, line);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (type === 'pen' && Array.isArray(object.points) && object.points.length) {
        var valid = object.points.filter(function (point) {
          return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
        });
        valid.forEach(function (point, index) {
          var px = clamp(Number(point.x), 0, 1) * width;
          var py = clamp(Number(point.y), 0, 1) * height;
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        if (valid.length === 1) {
          ctx.lineTo(clamp(Number(valid[0].x), 0, 1) * width + 0.01,
            clamp(Number(valid[0].y), 0, 1) * height);
        }
        ctx.stroke();
      } else if (type === 'rect') {
        ctx.strokeRect(Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y));
      } else if (type === 'ellipse') {
        ellipse(ctx, (x + x2) / 2, (y + y2) / 2,
          Math.abs(x2 - x) / 2, Math.abs(y2 - y) / 2, ctx.strokeStyle, ctx.lineWidth);
      } else if (type === 'arrow') {
        var angle = Math.atan2(y2 - y, x2 - x);
        var head = Math.max(line * 4, unit * 0.018);
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.moveTo(x2 - Math.cos(angle - 0.45) * head, y2 - Math.sin(angle - 0.45) * head);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x2 - Math.cos(angle + 0.45) * head, y2 - Math.sin(angle + 0.45) * head);
        ctx.stroke();
      } else if (type === 'text' && typeof object.text === 'string') {
        var fontSize = Math.max(unit * 0.022, line * 6);
        ctx.font = fontSize + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textBaseline = 'top';
        object.text.split('\n').slice(0, 12).forEach(function (text, index) {
          ctx.fillText(text, x, y + fontSize * 1.3 * index, Math.max(1, width - x));
        });
      }
      ctx.restore();
    });
  }

  function render(canvas, options) {
    var ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    var width = canvas.width;
    var height = canvas.height;
    var mediaRatio = ratio(options.aspect);
    var mediaWidth = Math.min(width, height * mediaRatio);
    var mediaHeight = mediaWidth / mediaRatio;
    var left = (width - mediaWidth) / 2;
    var top = (height - mediaHeight) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#101113';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(left, top);
    ctx.beginPath();
    ctx.rect(0, 0, mediaWidth, mediaHeight);
    ctx.clip();
    media(ctx, mediaWidth, mediaHeight, number(options.frame, 56), Math.max(2, number(options.count, 240)));
    drawObjects(ctx, mediaWidth, mediaHeight, options.objects || []);
    ctx.restore();
    return canvas;
  }

  function draw(canvas, options) {
    options = options || {};
    if (!canvas || typeof canvas.getContext !== 'function') return canvas;
    var bounds = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var displayWidth = bounds && bounds.width > 0 ? bounds.width : canvas.clientWidth || 960;
    var displayHeight = bounds && bounds.height > 0 ? bounds.height : canvas.clientHeight || displayWidth / ratio(options.aspect);
    var dpr = clamp(number(root.devicePixelRatio, 1), 1, 1.5);
    var scale = Math.min(dpr, 1600 / displayWidth, 1000 / displayHeight);
    var width = Math.max(1, Math.round(displayWidth * scale));
    var height = Math.max(1, Math.round(displayHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return render(canvas, options);
  }

  function thumbnail(frame, objects, aspect) {
    var canvas = root.document.createElement('canvas');
    var mediaRatio = ratio(aspect);
    canvas.width = mediaRatio < 1 ? Math.round(112 * mediaRatio) : 200;
    canvas.height = mediaRatio < 1 ? 112 : Math.round(200 / mediaRatio);
    return render(canvas, { frame: frame, count: 240, objects: objects || [], aspect: aspect || 'wide' });
  }

  root.VFScene = Object.freeze({ draw: draw, drawObjects: drawObjects, thumbnail: thumbnail });
})(typeof window !== 'undefined' ? window : globalThis);
