'use strict';
// Read-only artifact, dependency and license closure checks. Never executes an
// EXE, builds an archive, starts media/Eagle or writes the registered runtime.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const pack = require('../scripts/package-release.cjs'), root = path.resolve(__dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const files = Object.fromEntries(pack.NATIVE_RUNTIME.map(name => [name, fs.readFileSync(path.join(root, 'plugin', name))]));
let count = 0;
function test(name, run) { run(); count++; console.log('ok native experience package: ' + name); }
test('actual registered runtime includes native EXE, scripts and complete license closure within64MiB', () => {
  const r = pack.validateRuntime(files, { profile: 'native-experience' });
  assert(r.dependenciesChecked && r.guardVerified && r.nativeBinaryVerified && r.licenseClosureVerified && r.localOnly);
  assert(r.dependencyLicensePackages > 1 && r.dependencyLicenseTexts > 1 && r.runtimeBytes <= 64 * 1024 ** 2);
  assert.equal(r.archiveGenerated, false);
});
test('native build metadata matches the actual local bridge and patch sources', () => {
  const meta = JSON.parse(files['bin/filmcraft-media.build.json']);
  assert.equal(meta.bridgeSha256, sha(fs.readFileSync(path.join(root, 'native/filmcraft/bridge.rs'))));
  assert.equal(meta.patchSha256, sha(fs.readFileSync(path.join(root, 'native/filmcraft/patch-upstream.cjs'))));
});
test('legacy Beta recipe rejects the current native source before creating any archive', () => assert.throws(() => pack.assertLegacyBuildSource(), /frozen Beta2 2MiB/));
// Mutations use tiny binary model bytes; the actual native image is checked above.
files['bin/filmcraft-media.exe'] = Buffer.from('MZ native artifact model');
const metadata = JSON.parse(files['bin/filmcraft-media.build.json']);
metadata.binaryBytes = files['bin/filmcraft-media.exe'].length; metadata.binarySha256 = sha(files['bin/filmcraft-media.exe']);
files['bin/filmcraft-media.build.json'] = Buffer.from(JSON.stringify(metadata));
const copy = () => Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, Buffer.from(bytes)]));
const validate = f => pack.validateRuntime(f, { profile: 'native-experience' });
test('model native artifact closes all relative and HTML dependencies', () => assert(validate(copy()).dependenciesChecked));
for (const name of ['native-backend.cjs', 'native-player.js', 'native-reader.cjs', 'native-renderer.js', 'native-wire.cjs', 'whole-proxy.cjs',
  'bin/filmcraft-media.exe', 'bin/filmcraft-media.build.json', 'bin/FilmCraft-LICENSE-MIT', 'bin/FilmCraft-LICENSE-APACHE',
  'bin/FilmCraft-NOTICE', 'bin/filmcraft-third-party.json', 'bin/filmcraft-third-party.txt']) {
  test('missing ' + name + ' is refused', () => { const f = copy(); delete f[name]; assert.throws(() => validate(f)); });
}
test('substituted executable bytes fail the native build hash', () => { const f = copy(); f['bin/filmcraft-media.exe'][3] ^= 1; assert.throws(() => validate(f), /Native binary differs/); });
test('unexpected build manifest schema fields and protocol are refused', () => {
  for (const mutate of [m => { m.schema = 2; }, m => { m.protocol = 3; }, m => { m.output = 'unreviewed'; }, m => { m.bridgeSha256 = 'invalid'; }]) {
    const f = copy(), m = JSON.parse(f['bin/filmcraft-media.build.json']); mutate(m); f['bin/filmcraft-media.build.json'] = Buffer.from(JSON.stringify(m)); assert.throws(() => validate(f));
  }
});
test('altered upstream license or NOTICE bytes are refused', () => {
  for (const name of ['bin/FilmCraft-LICENSE-MIT', 'bin/FilmCraft-LICENSE-APACHE', 'bin/FilmCraft-NOTICE']) {
    const f = copy(); f[name] = Buffer.concat([f[name], Buffer.from('altered')]); assert.throws(() => validate(f), /Upstream license or NOTICE/);
  }
});
test('altered dependency notices fail even when file names remain present', () => { const f = copy(); f['bin/filmcraft-third-party.txt'][7] ^= 1; assert.throws(() => validate(f), /Dependency notices differ/); });
test('license index cannot silently drop or substitute a dependency license', () => {
  for (const mutate of [i => { i.packages.splice(1, 1); }, i => { i.packages[0].license = 'unknown'; }, i => { i.packages[0].licenseTexts = ['0'.repeat(64)]; }, i => { i.upstreamCommit = '0'.repeat(40); }]) {
    const f = copy(), i = JSON.parse(f['bin/filmcraft-third-party.json']); mutate(i); f['bin/filmcraft-third-party.json'] = Buffer.from(JSON.stringify(i)); assert.throws(() => validate(f));
  }
});
test('rehashing changed full license text does not bypass content-addressed license IDs', () => {
  const f = copy(), text = f['bin/filmcraft-third-party.txt'].toString();
  f['bin/filmcraft-third-party.txt'] = Buffer.from(text.replace(/(===== LICENSE TEXT [0-9a-f]{64} =====\n)/, '$1changed'));
  const m = JSON.parse(f['bin/filmcraft-media.build.json']); m.dependencyNoticesSha256 = sha(f['bin/filmcraft-third-party.txt']); f['bin/filmcraft-media.build.json'] = Buffer.from(JSON.stringify(m));
  assert.throws(() => validate(f), /License text hash/);
});
test('native profile cannot accidentally use Beta distribution identity or admit cache files', () => {
  const f = copy(); f['manifest.json'] = pack.packageManifest(f['manifest.json']); assert.throws(() => validate(f));
  const extra = copy(); extra['cache/asset.mp4'] = Buffer.alloc(1); assert.throws(() => validate(extra));
});
test('native and Beta byte budgets remain distinct and enforced', () => {
  assert.equal(pack.NATIVE_LIMIT, 64 * 1024 ** 2);
  const f = copy(); f['app.js'] = Buffer.alloc(pack.NATIVE_LIMIT); assert.throws(() => validate(f), /Runtime exceeds profile byte limit/);
  assert(!pack.RUNTIME.includes('bin/filmcraft-media.exe')); assert(pack.NATIVE_RUNTIME.includes('bin/filmcraft-media.exe'));
  assert(!pack.NATIVE_RUNTIME.filter(name => /\.(?:js|cjs)$/.test(name)).includes('bin/filmcraft-media.exe'), 'Binary must never enter JS syntax input list.');
});
console.log('Native experience package: ' + count + ' artifact/model checks; no archive, native/media/Eagle execution.');
