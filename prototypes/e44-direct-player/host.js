/* Test-only Eagle entry. Fixed read-only source; bounded new evidence only. */
(function () {
  'use strict';
  if (typeof require !== 'function') return;
  const fs = require('fs'), path = require('path'), crypto = require('crypto'), { pathToFileURL, fileURLToPath } = require('url');
  let here, out;
  if (location.protocol === 'file:') { here = path.dirname(fileURLToPath(location.href.split('?')[0])); out = path.resolve(here, '../../verification-runs/e44'); }
  const status = document.getElementById('status'); let running = false;
  async function run() {
    if (running) return; running = true; document.getElementById('run').disabled = true;
    let file;
    try {
      if (!out) throw Error('Waiting for Eagle plugin path');
      const profile = JSON.parse(fs.readFileSync(path.join(out, 'profile.json'))), indexFile = path.join(out, 'source-index.json'), indexRaw = fs.readFileSync(indexFile);
      if (crypto.createHash('sha256').update(indexRaw).digest('hex') !== profile.indexHash) throw Error('Index identity changed');
      const index = JSON.parse(indexRaw), name = 'eagle-gate-' + Date.now() + '.json', result = path.join(out, name);
      if (fs.statSync(profile.source).size !== profile.sourceSize) throw Error('Source size changed');
      file = await fs.promises.open(profile.source, 'r');
      const read = async (a, b) => {
        if (a < 0 || b > index.packets.length || b - a > 32) throw Error('Read bound');
        const parts = index.packets.slice(a, b), first = parts[0].pos, last = parts[parts.length - 1], length = last.pos + last.size - first;
        if (length > 32 * 1024 ** 2 || length < 1) throw Error('Packet layout unsupported');
        const buf = Buffer.alloc(length), r = await file.read(buf, 0, length, first); if (r.bytesRead !== length) throw Error('Source truncated');
        return Buffer.concat(parts.map(p => buf.subarray(p.pos - first, p.pos - first + p.size)));
      };
      const codeHashes = Object.fromEntries(['direct.js','worker.js','worker-client.js','gate.js','host.js'].map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(here,f))).digest('hex')]));
      await E44Gate.run({ index, url: pathToFileURL(profile.source).href, read, label: name, rounds: 1, preferences: ['prefer-hardware'], host: { kind: 'real-Eagle-isolated-prototype', purpose: 'strict two-packet queue diagnostic; not acceptance', versions: process.versions, pid: process.pid, codeHashes }, save: async r => { const body = JSON.stringify(r, null, 2); if (body.length > 4 * 1024 ** 2) throw Error('Evidence bound'); await fs.promises.writeFile(result + '.next', body); await fs.promises.rename(result + '.next', result); }, onStatus: s => { status.textContent = s; } });
      status.textContent = '完成 · ' + name;
    } catch (e) { status.textContent = '未通过 · ' + e.message; }
    finally { if (file) await file.close(); running = false; document.getElementById('run').disabled = false; }
  }
  document.getElementById('run').onclick = run;
  if (globalThis.eagle?.onPluginCreate) eagle.onPluginCreate(plugin => { here = plugin.path; out = path.resolve(here, '../../verification-runs/e44'); status.textContent = '已就绪 · 只读固定测试视频'; });
})();
