'use strict';
// Explicit local release packaging. Never installs/loads Eagle or modifies user data.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { spawnSync } = require('child_process'), { builtinModules } = require('module');
const VERSION = '0.1.0-beta.2', NAME = 'eagle-video-analysis-' + VERSION + '-win-x64';
const ID = 'EVAVIDEOANALYSISBETA20261014', ROOT = path.resolve(__dirname, '..'), LIMIT = 2 * 1024 ** 2;
const RUNTIME = Object.freeze(['manifest.json', 'index.html', 'styles.css', 'graphite.css', 'interface-icons.js', 'settings-view.js','graphite-shell.js', 'timeline-strip.js', 'logo.png', 'app.js', 'window-drag.cjs', 'window-fit.cjs', 'ui.js', 'loop-selection.js', 'timeline-view.js', 'screen-gestures.js', 'screen-gesture-ui.js', 'context-wheel.js', 'player.js',
  'session.cjs', 'load-decisions.cjs', 'media-policy.cjs', 'eagle.cjs', 'drawing-erase.js', 'drawing-model.js', 'drawing-ui.js', 'drawing-session.cjs', 'drawing-store.cjs', 'export.cjs', 'media.cjs', 'cache.cjs', 'process-identity.cjs', 'frame-index.cjs', 'frame-pack.cjs',
  'diagnostics.cjs', 'live-resources.cjs', 'proxy-storage.cjs', 'performance-core.cjs', 'performance-stages.cjs', 'performance-window.html', 'performance-window.js', 'performance-runtime.cjs', 'performance-view.js', 'performance.css', 'preferences.cjs', 'preview-profile.cjs', 'task-client.cjs', 'task-worker.cjs', 'cache-read-client.cjs', 'cache-read-worker.cjs', 'long-media.cjs', 'segment-reader.cjs', 'segment-audio.cjs', 'proxy-decoder.js', 'proxy-encoding.cjs', 'quick-preview.js', 'scrub-preview.js', 'scrub-background.cjs', 'scrub-producer.cjs', 'record-previews.js', 'avc-access-units.cjs', 'media-wire.cjs', 'proxy-background.cjs',
  'native/task-host.cs', 'native/task-host.local.exe', 'native/task-host.local.json']);
const NAMES = [...RUNTIME, 'README.md', 'CHANGELOG.md', 'BUILD-INFO.json'].sort();
// This profile only validates the registered local development directory. It is
// deliberately separate from the frozen Beta distribution recipe and its 2MiB cap.
const NATIVE_LIMIT = 64 * 1024 ** 2, NATIVE_ID = 'EVAVIDEOANALYSIS20261011';
const NATIVE_RUNTIME = Object.freeze([...RUNTIME, 'temporary-media.cjs', 'media-space.cjs', 'legacy-media-cleanup.cjs', 'native-backend.cjs', 'native-audio.cjs', 'native-reader.cjs', 'native-wire.cjs',
  'native-player.js', 'native-renderer.js', 'whole-proxy.cjs', 'bin/filmcraft-media.exe',
  'bin/filmcraft-media.build.json', 'bin/FilmCraft-LICENSE-MIT', 'bin/FilmCraft-LICENSE-APACHE',
  'bin/FilmCraft-NOTICE', 'bin/filmcraft-third-party.json', 'bin/filmcraft-third-party.txt']);
const FILMCRAFT_COMMIT = '176e6a9c585fd29e4b18d691663fe88a936c5b37';
const UPSTREAM_TEXTS = Object.freeze({
  'bin/FilmCraft-LICENSE-MIT': 'd2d8416f0883694c23b473e26372506e9e11f5f41b55a92b7388dab921d9a207',
  'bin/FilmCraft-LICENSE-APACHE': '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594',
  'bin/FilmCraft-NOTICE': '717a46e0fed6b8381cde394291c51d257db53ab9a0de333fcaa515a7a1ca5eec'
});
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const dist = path.join(ROOT, 'dist'), folder = path.join(dist, NAME), zip = folder + '.zip';
const installParent = path.join(dist, 'install-check-' + VERSION), install = path.join(installParent, NAME);
function node(file, directory = false) {
  const s = fs.lstatSync(file, { bigint: true });
  assert(!s.isSymbolicLink() && (directory ? s.isDirectory() : s.isFile()) &&
    fs.realpathSync(file).toLowerCase() === path.resolve(file).toLowerCase() && (directory || s.nlink === 1n), 'Unsafe package path: ' + file);
  return s;
}
function read(file, limit = LIMIT) {
  const s = node(file); assert(s.size <= BigInt(limit), 'Package file exceeds profile byte limit.');
  const b = fs.readFileSync(file), a = node(file);
  assert(['dev', 'ino', 'size', 'mtimeNs'].every(k => s[k] === a[k]) && b.length === Number(s.size), 'Package input changed.'); return b;
}
function list(directory) {
  node(directory, true); const names = [];
  function walk(at) { for (const name of fs.readdirSync(at)) {
    const f = path.join(at, name), s = fs.lstatSync(f); assert(!s.isSymbolicLink(), 'Package contains link.');
    if (s.isDirectory()) { node(f, true); walk(f); } else { node(f); names.push(path.relative(directory, f).replace(/\\/g, '/')); }
  } } walk(directory); return names.sort();
}
function scanText(bytes, label) {
  const text = bytes.toString('utf8') + '\n' + bytes.toString('utf16le');
  assert(!/(?:[A-Za-z]:[\\/]+Users[\\/]+|[A-Za-z]:[\\/]+documents[\\/]+Codex|[A-Za-z]:[\\/]+Assets[\\/]+Eagle|\.library[\\/]+)/i.test(text), 'Private machine path: ' + label);
  assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}/.test(text), 'Possible credential: ' + label);
}
function packageManifest(bytes) {
  const original = JSON.parse(bytes); assert.equal(original.version, VERSION); assert.equal(original.platform, 'win'); assert.equal(original.arch, 'x64');
  return Buffer.from(JSON.stringify({ ...original, id: ID, name: '视频分析 · MVP Beta', keywords: ['视频', '逐帧', '分析', 'Beta'] }, null, 2) + '\n');
}
function validateRuntime(files, options = {}) {
  const native = options.profile === 'native-experience';
  assert(!options.profile || native, 'Unknown runtime validation profile.');
  const runtime = native ? NATIVE_RUNTIME : RUNTIME;
  assert.deepStrictEqual(Object.keys(files).sort(), [...runtime].sort(), 'Runtime allowlist incomplete or contains extra data.');
  assert(Object.values(files).every(Buffer.isBuffer), 'Runtime inputs must be file bytes.');
  const bytes = Object.values(files).reduce((n, b) => n + b.length, 0);
  assert(bytes <= (native ? NATIVE_LIMIT : LIMIT), 'Runtime exceeds profile byte limit.');
  const manifest = JSON.parse(files['manifest.json']);
  assert.equal(manifest.version, VERSION); assert.equal(manifest.platform, 'win'); assert.equal(manifest.arch, 'x64');
  assert.equal(manifest.id, native ? NATIVE_ID : ID); assert.equal(manifest.main.url, 'index.html'); assert.equal(manifest.main.multiple, false); assert.equal(manifest.devTools, false);
  assert.equal(manifest.logo, '/logo.png');
  const local = (name, from) => {
    const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(from), name));
    assert(!normalized.startsWith('../') && Object.hasOwn(files, normalized), 'Missing runtime dependency: ' + from + ' -> ' + name);
  };
  for (const [name, bytes] of Object.entries(files)) {
    if (/\.(?:js|cjs|cs|json|html|css|exe)$/.test(name)) scanText(bytes, name);
    if (/\.(?:js|cjs)$/.test(name)) {
      const text = bytes.toString();
      for (const m of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        if (m[1].startsWith('.')) local(m[1], name);
        else assert(builtinModules.includes(m[1]), 'Unexpected external runtime dependency: ' + m[1]);
      }
      for (const m of text.matchAll(/require\(path\.join\(root,\s*['"]([^'"]+)['"]\)\)/g)) local(m[1], name);
    }
  }
  for (const m of files['index.html'].toString().matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) local(m[1], 'index.html');
  assert(!/index\.local|bootstrap|tests[\\/]|prototypes[\\/]/.test(files['index.html'].toString()), 'Test entry in package.');
  assert(!/(?:id="(?:performanceTest|gate|comparison|save|refresh)")/.test(files['index.html'].toString()), 'Test control in package.');
  const build = JSON.parse(files['native/task-host.local.json']);
  assert.deepStrictEqual(Object.keys(build).sort(), ['bytes', 'executableSha256', 'schema', 'sourceSha256']);
  assert.equal(build.schema, 'eva-task-guard-build-v1'); assert.equal(build.bytes, files['native/task-host.local.exe'].length);
  assert.equal(build.sourceSha256, sha(files['native/task-host.cs'])); assert.equal(build.executableSha256, sha(files['native/task-host.local.exe']));
  assert(build.bytes <= 256 * 1024); assert.equal(files['native/task-host.local.exe'].subarray(0, 2).toString(), 'MZ');
  const result = { runtimeFiles: runtime.length, runtimeBytes: bytes, dependenciesChecked: true, guardVerified: true };
  if (native) Object.assign(result, validateNativeBinary(files), { profile: 'native-experience', localOnly: true, archiveGenerated: false });
  return result;
}
function validateNativeBinary(files) {
  const meta = JSON.parse(files['bin/filmcraft-media.build.json']);
  assert.deepStrictEqual(Object.keys(meta).sort(), ['schema', 'created', 'upstream', 'upstreamCommit', 'version', 'protocol',
    'bridgeSha256', 'patchSha256', 'binarySha256', 'binaryBytes', 'dependencyNoticesSha256', 'compiler', 'linker', 'buildLog'].sort(), 'Unexpected native build metadata.');
  assert.equal(meta.schema, 1); assert.equal(meta.protocol, 2); assert.equal(meta.version, '0.13.0');
  assert.equal(meta.upstream, 'https://github.com/storytold/filmcraft'); assert.equal(meta.upstreamCommit, FILMCRAFT_COMMIT);
  assert(Number.isFinite(Date.parse(meta.created)), 'Invalid native build time.');
  assert(['bridgeSha256', 'patchSha256', 'binarySha256', 'dependencyNoticesSha256'].every(k => /^[0-9a-f]{64}$/.test(meta[k])), 'Invalid native build hashes.');
  assert(typeof meta.compiler === 'string' && meta.compiler.startsWith('rustc ') && meta.compiler.includes('x86_64-pc-windows-gnu'));
  assert.equal(meta.linker, 'rust-lld / ld.lld / link-self-contained');
  assert(/^native-build-\d+\.log$/.test(meta.buildLog), 'Native build log must be a relative identifier.');
  const binary = files['bin/filmcraft-media.exe'];
  assert.equal(meta.binaryBytes, binary.length); assert(binary.length > 0 && binary.length <= NATIVE_LIMIT);
  assert.equal(binary.subarray(0, 2).toString(), 'MZ'); assert.equal(meta.binarySha256, sha(binary), 'Native binary differs from build manifest.');
  for (const [name, hash] of Object.entries(UPSTREAM_TEXTS)) assert.equal(sha(files[name]), hash, 'Upstream license or NOTICE changed: ' + name);
  const notices = files['bin/filmcraft-third-party.txt'];
  assert.equal(meta.dependencyNoticesSha256, sha(notices), 'Dependency notices differ from build manifest.');
  const index = JSON.parse(files['bin/filmcraft-third-party.json']);
  assert.deepStrictEqual(Object.keys(index).sort(), ['packages', 'upstreamCommit']); assert.equal(index.upstreamCommit, FILMCRAFT_COMMIT);
  assert(Array.isArray(index.packages) && index.packages.length > 1, 'Native dependency index is empty.');
  const body = notices.toString('utf8'), markers = [...body.matchAll(/\n\n===== LICENSE TEXT ([0-9a-f]{64}) =====\n/g)], texts = new Map();
  for (let n = 0; n < markers.length; n++) {
    const m = markers[n], text = body.slice(m.index + m[0].length, markers[n + 1]?.index ?? body.length);
    assert(!texts.has(m[1]) && sha(Buffer.from(text)) === m[1], 'License text hash is invalid.'); texts.set(m[1], text);
  }
  const referenced = new Set(), names = new Set();
  for (const p of index.packages) {
    assert.deepStrictEqual(Object.keys(p).sort(), ['name', 'version', 'license', 'source', 'licenseTexts'].sort());
    assert(/^[\w-]+$/.test(p.name) && typeof p.version === 'string' && p.version.length > 0 && typeof p.license === 'string' && p.license.length > 0);
    assert(/^https:\/\/(?:github\.com\/storytold\/|crates\.io\/crates\/)/.test(p.source), 'Unrecognized dependency source.');
    const key = p.name + '@' + p.version; assert(!names.has(key), 'Duplicate native dependency.'); names.add(key);
    assert(Array.isArray(p.licenseTexts) && p.licenseTexts.length && p.licenseTexts.every(id => texts.has(id)), 'Dependency license text missing.');
    assert(body.includes(p.name + ' ' + p.version + ' | ' + p.license + '\nSource: ' + p.source + '\nLicense texts: ' + p.licenseTexts.join(', ')), 'Dependency index and notice text disagree.');
    p.licenseTexts.forEach(id => referenced.add(id));
  }
  const expectedIndex = index.packages.map(p => p.name + ' ' + p.version + ' | ' + p.license + '\nSource: ' + p.source + '\nLicense texts: ' + p.licenseTexts.join(', ')).join('\n\n');
  const sectionStart = body.indexOf('\n\nfilmcraft-platform ');
  assert(sectionStart >= 0 && markers.length && body.slice(sectionStart + 2, markers[0].index) === expectedIndex, 'Dependency notice package closure differs from index.');
  assert(names.has('filmcraft-platform@0.13.0')); assert.equal(referenced.size, texts.size, 'Unindexed license text.');
  return { nativeBinaryVerified: true, nativeProtocol: meta.protocol, nativeBinaryBytes: binary.length,
    dependencyLicensePackages: names.size, dependencyLicenseTexts: texts.size, licenseClosureVerified: true };
}
function validateNativeExperience(directory = path.join(ROOT, 'plugin')) {
  node(directory, true); const files = Object.fromEntries(NATIVE_RUNTIME.map(name => [name, read(path.join(directory, name), NATIVE_LIMIT)]));
  return validateRuntime(files, { profile: 'native-experience' });
}
function assertLegacyBuildSource(directory = path.join(ROOT, 'plugin')) {
  assert(!fs.existsSync(path.join(directory, 'bin/filmcraft-media.exe')) && !fs.existsSync(path.join(directory, 'native-backend.cjs')),
    'Native experience sources cannot use the frozen Beta2 2MiB packaging recipe. Validate native-experience locally; no release ZIP is authorized.');
}
function ps(source, extra = {}) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; " + source], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 ** 2,
    env: { ...process.env, EVA_RELEASE_FOLDER: folder, EVA_RELEASE_ZIP: zip, EVA_RELEASE_NAME: NAME, EVA_RELEASE_INSTALL: installParent, ...extra }
  });
  if (r.error || r.status !== 0) throw new Error('Archive operation failed: ' + (r.error ? r.error.message : r.stderr));
  return r.stdout.trim().replace(/^\uFEFF/, '');
}
function verify() {
  node(dist, true); assert.deepStrictEqual(list(folder), NAMES, 'Package contains missing or extra files.');
  const info = JSON.parse(read(path.join(folder, 'BUILD-INFO.json'))); assert.equal(info.schema, 'eva-release-snapshot-v1');
  assert.equal(info.version, VERSION); assert(/^[0-9a-f]{40}$/.test(info.sourceCommit)); assert.equal(info.pluginId, ID);
  assert.deepStrictEqual(Object.keys(info.files).sort(), NAMES.filter(n => n !== 'BUILD-INFO.json'));
  const runtime = {}, expected = []; let bytes = 0;
  for (const name of NAMES) {
    const b = read(path.join(folder, name)); bytes += b.length;
    if (info.files[name]) { assert.equal(sha(b), info.files[name].sha256, 'Snapshot changed: ' + name); assert.equal(b.length, info.files[name].bytes); }
    if (/\.(?:js|cjs|cs|json|html|css|md|exe)$/.test(name)) scanText(b, name);
    if (RUNTIME.includes(name)) runtime[name] = b;
    expected.push({ name: NAME + '/' + name, bytes: b.length, sha256: sha(b) });
  }
  assert(bytes <= LIMIT); const wiring = validateRuntime(runtime), archive = read(zip);
  const entries = JSON.parse(ps(`Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $z=[IO.Compression.ZipFile]::OpenRead($env:EVA_RELEASE_ZIP); try {
      $rows=@(foreach($e in $z.Entries){ if($e.Length -gt 2097152){throw 'Archive entry too large'};
        $s=$e.Open(); $h=[Security.Cryptography.SHA256]::Create(); try {
          [pscustomobject]@{name=$e.FullName.Replace('\\','/');bytes=$e.Length;sha256=[BitConverter]::ToString($h.ComputeHash($s)).Replace('-','').ToLowerInvariant()}
        } finally {$s.Dispose();$h.Dispose()} }); ConvertTo-Json -InputObject $rows -Compress
    } finally {$z.Dispose()}`));
  assert.deepStrictEqual(entries.sort((a, b) => a.name.localeCompare(b.name)), expected.sort((a, b) => a.name.localeCompare(b.name)), 'ZIP contents differ from frozen allowlist.');
  const checksum = read(zip + '.sha256').toString(); assert.equal(checksum, sha(archive) + '  ' + path.basename(zip) + '\n');
  return { schema: 'eva-release-package-check-v1', version: VERSION, sourceCommit: info.sourceCommit, pluginId: ID,
    zip: path.relative(ROOT, zip).replace(/\\/g, '/'), zipSha256: sha(archive), files: NAMES.length, unpackedBytes: bytes, zipBytes: archive.length,
    ...wiring, exactZipVerified: true, currentTextPrivacyCheckPassed: true, realEaglePackagedCopyVerified: false,
    limitations: ['Static package checks do not establish real Eagle startup, long-term stability, binary/OCR or full-history privacy clearance.'] };
}
function build() {
  assert(process.platform === 'win32' && !/^c:/i.test(ROOT), 'Build on a non-C Windows drive.'); node(ROOT, true);
  assertLegacyBuildSource();
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert(status.status === 0 && !status.stdout.trim(), 'Commit reviewed sources before freezing package.');
  const revision = spawnSync('git', ['show', '-s', '--format=%H%n%cI', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  assert.equal(revision.status, 0); const [sourceCommit, commitTime] = revision.stdout.trim().split(/\r?\n/);
  if (!fs.existsSync(dist)) fs.mkdirSync(dist); node(dist, true);
  assert(!fs.existsSync(folder) && !fs.existsSync(zip) && !fs.existsSync(zip + '.sha256'), 'Release candidate already exists; verify instead of overwriting.');
  const files = {}, sources = {};
  for (const name of RUNTIME) { const b = read(path.join(ROOT, 'plugin', name)); sources[name] = sha(b); files[name] = b; }
  files['manifest.json'] = packageManifest(files['manifest.json']); validateRuntime(files);
  files['README.md'] = read(path.join(ROOT, 'docs/beta-preview.md')); files['CHANGELOG.md'] = read(path.join(ROOT, 'CHANGELOG.md'));
  const info = { schema: 'eva-release-snapshot-v1', version: VERSION, pluginId: ID, sourceCommit, commitTime,
    sourceRuntimeSha256: sources, files: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, { bytes: b.length, sha256: sha(b) }])),
    changesFromSource: ['manifest.json: distribution plugin ID, display name and keywords only'],
    requirements: ['Windows x64', 'Eagle 4.0 Build 22+', 'Eagle FFmpeg module', 'Writable non-C extraction directory'],
    licenseDecision: 'Project open-source license not designated; no new license granted by this package.',
    realEaglePackagedCopyVerified: false, longTermStabilityVerified: false,
    reproduction: 'Use this source commit and verified native build; ZIP entries use commit time. Fresh compiler outputs are hash-checked but not promised byte-identical.' };
  files['BUILD-INFO.json'] = Buffer.from(JSON.stringify(info, null, 2) + '\n');
  assert(Object.values(files).reduce((n, b) => n + b.length, 0) <= LIMIT);
  for (const [n, b] of Object.entries(files)) if (/\.(?:js|cjs|cs|json|html|css|md|exe)$/.test(n)) scanText(b, n);
  assert.equal(ps('Write-Output ([IO.Compression.ZipArchiveMode]::Create.ToString())'), 'Create', 'Archive support unavailable; no output created.');
  fs.mkdirSync(folder); fs.mkdirSync(path.join(folder, 'native'));
  for (const name of NAMES) fs.writeFileSync(path.join(folder, name), files[name], { flag: 'wx' });
  ps(`Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $z=[IO.Compression.ZipFile]::Open($env:EVA_RELEASE_ZIP,[IO.Compression.ZipArchiveMode]::Create); try {
      $stamp=[DateTimeOffset]::Parse($env:EVA_RELEASE_TIME);
      foreach($name in ($env:EVA_RELEASE_FILES | ConvertFrom-Json)) {
        $entry=$z.CreateEntry($env:EVA_RELEASE_NAME+'/'+$name,[IO.Compression.CompressionLevel]::Optimal); $entry.LastWriteTime=$stamp;
        $inputFile=[IO.File]::OpenRead([IO.Path]::Combine($env:EVA_RELEASE_FOLDER,$name)); $outputFile=$entry.Open();
        try {$inputFile.CopyTo($outputFile)} finally {$outputFile.Dispose();$inputFile.Dispose()}
      }
    } finally {$z.Dispose()}`, { EVA_RELEASE_FILES: JSON.stringify(NAMES), EVA_RELEASE_TIME: commitTime });
  fs.writeFileSync(zip + '.sha256', sha(read(zip)) + '  ' + path.basename(zip) + '\n', { flag: 'wx' }); return verify();
}
function extract() {
  const checked = verify(); assert(!fs.existsSync(installParent), 'Independent test directory already exists; do not overwrite user data.');
  ps(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:EVA_RELEASE_ZIP,$env:EVA_RELEASE_INSTALL)`);
  fs.writeFileSync(path.join(installParent, 'owner.json'), JSON.stringify({ schema: 'eva-release-install-check-v1', version: VERSION,
    sourceCommit: checked.sourceCommit, zipSha256: checked.zipSha256, folder: NAME }, null, 2), { flag: 'wx' });
  assert.deepStrictEqual(list(install), NAMES); return verifyInstall();
}
function verifyInstall() {
  const checked = verify(); node(installParent, true); node(install, true);
  const owner = JSON.parse(read(path.join(installParent, 'owner.json'))); assert.equal(owner.schema, 'eva-release-install-check-v1');
  assert.equal(owner.version, VERSION); assert.equal(owner.folder, NAME); assert.equal(owner.zipSha256, checked.zipSha256);
  for (const name of NAMES) assert.equal(sha(read(path.join(install, name))), sha(read(path.join(folder, name))), 'Installed runtime changed: ' + name);
  assert(fs.readdirSync(install).every(n => NAMES.includes(n) || n === 'native' || n === 'cache' || /^memory-settings(?:\.next)?\.json$/.test(n)), 'Unexpected installation content.');
  const guard = require('../plugin/task-client.cjs').verifyGuard(install); assert.equal(guard, path.join(install, 'native/task-host.local.exe'));
  return { ...checked, independentExtractedFilesVerified: true, independentPluginRoot: install,
    realEaglePackagedCopyVerified: false, note: 'Independent path/native hashes passed; actual Eagle loading still requires host observation.' };
}
if (require.main === module) {
  const mode = process.argv[2] || 'build'; assert(process.argv.length <= 3 && ['build', 'verify', 'extract', 'verify-install', 'native-experience'].includes(mode));
  console.log(JSON.stringify(({ build, verify, extract, 'verify-install': verifyInstall, 'native-experience': validateNativeExperience })[mode](), null, 2));
}
module.exports = { VERSION, NAME, ID, RUNTIME, NATIVE_RUNTIME, NATIVE_LIMIT, packageManifest, validateRuntime, validateNativeExperience,
  assertLegacyBuildSource, scanText, build, verify, extract, verifyInstall };
