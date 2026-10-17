'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { REPO, hashFile, identity } = require('./workspace.cjs');
const PROFILES = Object.freeze({
  sonic: { id: 'MV3FZJJ7AC1CI', sha256: '0823a48f0d7b365163297206e8e8c66591c3aa6cf4c30253b3187d19c9644cba', start: 15 },
  hevc: { id: 'MV6H7OK0MBGX2', sha256: 'd7bbab0b425381c880adacb9f8d95d900aa162c4c5c9308cf9a3f8482ff67658', start: 8 },
  vp9: { id: 'MUXL6QI4AJIAG', sha256: '1482d4d245564789866a00dcd8993a3cd3154df49b92d719962762f67e051931', start: 6 },
  fenshen: { start: 1 }
});
function inspect() {
  const config = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/host/t0/config.local.json')));
  for (const name of ['ffmpeg', 'ffprobe']) identity(config[name]);
  const base = config.sources.find(s => s.key === 'baseline'), images = path.dirname(path.dirname(base.file)); identity(images, true);
  const previousFile=path.join(__dirname,'config.local.json');
  const previous=fs.existsSync(previousFile)?JSON.parse(fs.readFileSync(previousFile)):null;
  const previousSelected=previous&&previous.sources.find(s=>s.key==='fenshen');
  const selectedId=process.argv[2]||(previousSelected&&path.basename(path.dirname(previousSelected.file)).replace(/\.info$/,''));
  if(typeof selectedId!=='string'||!/^[A-Za-z0-9]{8,30}$/.test(selectedId))throw Error('Provide the explicitly approved source ID; no library scan');
  const sources = [];
  for (const [key, spec] of Object.entries(PROFILES)) {
    const dir = path.join(images, (key==='fenshen'?selectedId:spec.id) + '.info'); identity(dir, true);
    const names = key === 'vp9' ? [path.basename(base.file)] : fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.mp4'));
    if (names.length !== 1) throw Error('Explicit source missing or ambiguous: ' + key);
    const file = path.join(dir, names[0]), before = identity(file), hash = hashFile(file);
    if (spec.sha256 && hash !== spec.sha256) throw Error('Registered source changed: ' + key);
    const result = cp.spawnSync(config.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
      { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 ** 2 });
    if (result.error || result.status !== 0) throw Error('Read-only ffprobe failed: ' + key);
    const probe = JSON.parse(result.stdout), v = probe.streams.find(s => s.codec_type === 'video');
    const duration = Number(probe.format.duration);
    if (!v || !Number.isFinite(duration) || duration <= 0 || duration > 30) throw Error('Source outside approved range: ' + key);
    sources.push({ key, file, sha256: hash, identity: before, width: v.width, height: v.height, codec: v.codec_name, pixFmt: v.pix_fmt,
      avgFrameRate: v.avg_frame_rate, timeBase: v.time_base, duration, audio: probe.streams.some(s => s.codec_type === 'audio'), start: Math.min(spec.start, Math.max(0, duration - 1)) });
    if (JSON.stringify(before) !== JSON.stringify(identity(file))) throw Error('Source changed during inspection');
  }
  const local = { schema: 'eva-quality-local-v1', ffmpeg: config.ffmpeg, ffprobe: config.ffprobe, sources };
  const file = path.join(__dirname, 'config.local.json');
  if (fs.existsSync(file)) { if (JSON.stringify(JSON.parse(fs.readFileSync(file))) !== JSON.stringify(local)) throw Error('Existing local source configuration differs; retained'); }
  else fs.writeFileSync(file, JSON.stringify(local, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(sources.map(({ file, identity, ...s }) => s), null, 2)); return local;
}
if (require.main === module) inspect();
module.exports = { inspect, PROFILES };
