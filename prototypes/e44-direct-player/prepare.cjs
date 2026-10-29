'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../..'), out = path.join(root, 'verification-runs/e44');
const profile = JSON.parse(fs.readFileSync(path.join(root, 'verification-runs/e42/profile.json')));
async function sha(file) { const h = crypto.createHash('sha256'); for await (const b of fs.createReadStream(file)) h.update(b); return h.digest('hex'); }
async function main() {
  if (fs.existsSync(path.join(out, 'source-index.json'))) throw Error('E44 index already exists; do not overwrite evidence');
  for (const [file, expected] of [[profile.source, profile.sourceHash], [profile.tools.ffprobe, profile.toolHashes.ffprobe]])
    if (await sha(file) !== expected) throw Error('Input/tool identity changed: ' + file);
  fs.mkdirSync(out, { recursive: true });
  const at = performance.now();
  const raw = JSON.parse(execFileSync(profile.tools.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_packets', '-show_streams', '-show_data', '-show_entries', 'stream=index,codec_name,codec_tag_string,width,height,time_base,extradata:packet=pts,dts,duration,size,pos,flags', '-of', 'json', profile.source], { windowsHide: true, maxBuffer: 8 * 1024 ** 2, timeout: 30000 }));
  const s = raw.streams[0]; if (s.codec_name !== 'h264' || s.codec_tag_string !== 'avc1') throw Error('A gate supports locked AVC source only');
  const desc = Buffer.from(s.extradata.split('\n').filter(l => l.includes(':')).map(l => l.split(':')[1].split('  ')[0].replace(/\s/g, '')).join(''), 'hex');
  if (desc[0] !== 1) throw Error('Bad avcC');
  const [num, den] = s.time_base.split('/').map(Number), size = fs.statSync(profile.source).size; let key = -1;
  const packets = raw.packets.map((p, n) => {
    if (p.flags.startsWith('K')) key = n;
    const row = { pts: Math.round(p.pts * num / den * 1e6), sourcePts: p.pts, dts: p.dts, pos: Number(p.pos), size: Number(p.size), key, isKey: p.flags.startsWith('K') };
    if (key < 0 || !Number.isSafeInteger(row.pos) || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > 16 * 1024 ** 2 || row.pos + row.size > size) throw Error('Invalid packet range');
    return row;
  });
  const sorted = packets.map((p, n) => ({ pts: p.pts, n })).sort((a, b) => a.pts - b.pts);
  if (new Set(sorted.map(p => p.pts)).size !== sorted.length) throw Error('Ambiguous source timestamps');
  const index = { schema: 1, sourceHash: profile.sourceHash, codec: 'avc1.' + desc.subarray(1, 4).toString('hex'), description: [...desc], width: s.width, height: s.height, timeBase: s.time_base, packets, sorted };
  fs.writeFileSync(path.join(out, 'source-index.json'), JSON.stringify(index), { flag: 'wx' });
  fs.writeFileSync(path.join(out, 'profile.json'), JSON.stringify({ ...profile, protocol: 'e44-direct-gate-v1', ramBytes: 256 * 1024 ** 2, rounds: 3, sourceSize: size, probeMs: performance.now() - at, indexHash: await sha(path.join(out, 'source-index.json')), created: new Date().toISOString() }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ frames: packets.length, probeMs: performance.now() - at, sourceHash: profile.sourceHash }));
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
