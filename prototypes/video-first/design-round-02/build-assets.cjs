'use strict';
// Original deterministic vector footage for design-only comparisons. No image API.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, 'assets');
fs.mkdirSync(root, { recursive: true });
function rng(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
for (let phase = 1; phase <= 4; phase++) {
  const r = rng(843 + phase * 31), parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><defs>
  <radialGradient id="air" cx="55%" cy="45%" r="72%"><stop stop-color="#253039"/><stop offset=".55" stop-color="#141c24"/><stop offset="1" stop-color="#080e15"/></radialGradient>
  <radialGradient id="light"><stop stop-color="#fdb84c" stop-opacity=".48"/><stop offset=".45" stop-color="#c67724" stop-opacity=".1"/><stop offset="1" stop-color="#0b121a" stop-opacity="0"/></radialGradient>
  <linearGradient id="fire" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#bb4618" stop-opacity=".1"/><stop offset=".3" stop-color="#e66b26"/><stop offset=".6" stop-color="#f4b95e"/><stop offset=".88" stop-color="#fff3c2"/><stop offset="1" stop-color="#b63c17" stop-opacity=".1"/></linearGradient>
  <linearGradient id="core"><stop stop-color="#c85a20" stop-opacity="0"/><stop offset=".5" stop-color="#fff8ce"/><stop offset="1" stop-color="#fa8a27" stop-opacity=".1"/></linearGradient>
  <radialGradient id="vignette"><stop offset=".35" stop-color="#02070b" stop-opacity="0"/><stop offset="1" stop-color="#02070b" stop-opacity=".75"/></radialGradient>
  <filter id="smoke"><feGaussianBlur stdDeviation="27"/></filter><filter id="glow"><feGaussianBlur stdDeviation="8"/></filter>
  </defs><rect width="1600" height="900" fill="url(#air)"/>
  <path d="M0 619 163 596 304 612 475 588 650 621 876 603 1084 625 1322 602 1600 624V900H0Z" fill="#0c131a"/>
  <ellipse cx="856" cy="655" rx="740" ry="300" fill="url(#light)"/>`);
  for (let i = 0; i < 45; i++) {
    const x = 260 + r() * 1150, y = 220 + r() * 420, rx = 25 + r() * 130;
    parts.push(`<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * .58).toFixed(1)}" fill="${i % 3 ? '#889393' : '#e1b37d'}" opacity="${(.012 + r() * .043).toFixed(3)}" filter="url(#smoke)"/>`);
  }
  for (let i = 0; i < 140; i++) {
    const x = r() * 1600, y = 620 + r() * 280;
    parts.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${(3 + r() * 22).toFixed(1)} ${(-1 - r() * 4).toFixed(1)} ${(-7 - r() * 17).toFixed(1)} ${(-2 - r() * 3).toFixed(1)}Z" fill="${i % 4 ? '#273039' : '#483a2a'}" opacity="${(.05 + r() * .16).toFixed(2)}"/>`);
  }
  const spread = [0, .7, 1, 1.14, 1.27][phase], fade = phase === 4 ? .46 : 1;
  parts.push(`<g transform="translate(805 590) scale(${spread}) translate(-805 -590)" opacity="${fade}">
  <ellipse cx="805" cy="642" rx="296" ry="69" fill="none" stroke="#d18d43" opacity=".18" stroke-width="2"/>
  <path d="M445 655c190-5 355-67 485-176 134-112 140-209 223-248-51 60-77 156-203 267-155 135-329 169-505 157Z" fill="url(#fire)" opacity=".7" filter="url(#glow)"/>
  <path d="M455 648c161 6 354-66 475-169 99-84 129-164 214-240-64 87-88 150-210 258-151 135-321 150-479 151Z" fill="url(#fire)"/>
  <path d="M517 642c181-15 308-77 431-187 65-59 112-140 161-172-53 62-71 107-143 179-137 136-301 165-449 180Z" fill="url(#core)" opacity=".9"/>
  <path d="M753 603c76-31 91-110 52-171 61 48 86 109 64 146 78-52 128-72 210-72-79 19-139 50-194 105Z" fill="url(#fire)" opacity=".76"/>
  <path d="M594 646c136-24 248-12 366 21 46 14 100 8 130-3-83 47-198-7-298-13-94-6-154-4-198-5Z" fill="url(#fire)" opacity=".7"/>
  </g>`);
  for (let i = 0; i < 210; i++) {
    const angle = -Math.PI + r() * Math.PI * 1.35, distance = 45 + Math.pow(r(), .65) * (phase === 4 ? 500 : 340);
    const x = 865 + Math.cos(angle) * distance * 1.1, y = 545 + Math.sin(angle) * distance * .8 + (phase === 4 ? 100 : 0), length = 1 + r() * 7;
    parts.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${(Math.cos(angle) * length).toFixed(1)} ${(Math.sin(angle) * length).toFixed(1)}" stroke="${i % 5 ? '#efaa58' : '#fff0c2'}" stroke-width="${(.5 + r() * 1.3).toFixed(1)}" opacity="${(.14 + r() * .65).toFixed(2)}"/>`);
  }
  parts.push('<rect width="1600" height="900" fill="url(#vignette)"/></svg>');
  fs.writeFileSync(path.join(root, `scene-${phase}.svg`), parts.join('\n'));
}
console.log('4 original SVG design frames written.');
