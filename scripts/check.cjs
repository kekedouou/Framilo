'use strict';
// Default checks never prepare media, load Eagle or run historical PoC commands.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
function files(dir, accept, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || ['cache', 'verification-runs', '.git', 'node_modules'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files(file, accept, out);
    else if (accept(file)) out.push(file);
  }
  return out;
}
function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.error || r.status !== 0) throw new Error(`${args.join(' ')}: ${r.error ? r.error.message : r.stderr || r.status}`);
}
function checkDocs() { console.log('documents: ' + JSON.stringify(require('./check-docs.cjs').check(root))); }
const js = ['plugin', 'tests', 'scripts'].flatMap(d => files(path.join(root, d), f => /\.(cjs|js)$/.test(f)));
for (const file of js) {
  run(['--check', file]);
  if (file.startsWith(path.join(root, 'plugin') + path.sep) && /(?:require\s*\([^)]*(?:prototypes|tests)[/\\]|from\s+['"][^'"]*(?:prototypes|tests)[/\\])/.test(fs.readFileSync(file, 'utf8')))
    throw new Error('Formal code depends on prototypes/tests: ' + file);
}
console.log(`syntax and prototype dependency boundary: ${js.length} files`);
// E45 retires user recording/reporting and the proxy strip. Their source cleanup
// is policy-blocked; do not execute the retired product contracts as active tests.
const retiredTests=new Set(['performance-detail.cjs','performance-lifecycle.cjs','performance-monitor.cjs','performance-readable.cjs','proxy-strip-display.cjs']);
for (const file of fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.cjs')&&!retiredTests.has(f)).sort()) run([path.join(root, 'tests', file)]);
console.log('E45 retired recording/report/proxy-strip suites excluded: '+retiredTests.size);
const manifestFile = path.join(root, 'tests/host/t0/manifest.json');
if (fs.existsSync(manifestFile)) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!manifest.main || manifest.main.multiple !== false || manifest.main.url !== 'index.html') throw new Error('T0 manifest entry mismatch');
  const html = fs.readFileSync(path.join(path.dirname(manifestFile), manifest.main.url), 'utf8');
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) if (!fs.existsSync(path.resolve(path.dirname(manifestFile), match[1]))) throw new Error('Missing host script: ' + match[1]);
  console.log('T0 manifest and script wiring checked; real Eagle not executed');
}
const productManifest = path.join(root, 'plugin/manifest.json');
if (fs.existsSync(productManifest)) {
  const manifest = JSON.parse(fs.readFileSync(productManifest, 'utf8'));
  if (!manifest.main || manifest.main.multiple !== false || manifest.main.url !== 'index.html') throw new Error('Product Window entry mismatch');
  const html = fs.readFileSync(path.join(path.dirname(productManifest), manifest.main.url), 'utf8');
  for (const match of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) if (!fs.existsSync(path.resolve(path.dirname(productManifest), match[1]))) throw new Error('Missing product asset: ' + match[1]);
  if (/(?:setDecodeDelay|performanceTest|adoptedGate|id="(?:gate|comparison|save|refresh)")/.test(html)) throw new Error('Experimental controls in product entry');
  if (!fs.existsSync(path.join(path.dirname(productManifest), String(manifest.logo || '').replace(/^\//, '')))) throw new Error('Missing product logo');
  console.log('Product manifest/assets checked; real Eagle not executed');
}
checkDocs();
run([path.join(root, 'scripts/check-handoff.cjs')]);
if (!process.argv.includes('--without-prepared-host') && fs.existsSync(path.join(root, 'tests/host/window/prepared.local.json'))) {
  const prepared = require('./prepare-window-host.cjs').verify(root);
  console.log('Window automatic entry ownership/source hashes checked: ' + prepared.bytes + ' bytes; Eagle not executed');
}
if (fs.existsSync(path.join(root, 'tests/host/t4/prepared.local.json'))) {
  const prepared = require('./prepare-mvp-host.cjs').verify();
  console.log('Current stage-4 entry/source/build fingerprints checked: ' + prepared.bytes + ' bytes; Eagle not executed');
}
console.log('default check passed (no media generation, no historical rerun, no Eagle/library writes)');
