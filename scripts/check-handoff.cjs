'use strict';
// Read-only: never stage, commit, clear changes or invoke media/host tools.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { governance, inside } = require('./check-docs.cjs');
const root = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const read = f => fs.readFileSync(inside(root, f), 'utf8').replace(/\r\n/g, '\n');
const fail = s => { throw Error('handoff: ' + s); };
function validateInherited(manifest, snapshot, allowMissing = true) {
  const inherited = new Set();
  for (const row of manifest.inheritedDetails || []) {
    inside(root, row.path);
    const actual = snapshot(row.path);
    if (!actual && allowMissing) continue; // A clean/new checkout need not contain untracked local leftovers.
    if (!actual || actual.sha256 !== row.sha256 || actual.index !== row.index) fail('registered other-task identity/index changed; review ownership: ' + row.path);
    inherited.add(row.path);
  }
  return inherited;
}
function selectScope(changed, inherited, scope) {
  if (scope == null) return [...changed].filter(f => !inherited.has(f));
  if (!Array.isArray(scope) || !scope.length) fail('scope must be a non-empty path array');
  for (const f of scope) { inside(root, f); if (inherited.has(f)) fail('other-task file included in scope: ' + f); }
  const outside = [...changed].filter(f => !scope.includes(f) && !inherited.has(f));
  if (outside.length) fail('unregistered changes outside scope: ' + outside.join(', '));
  return scope;
}
function check() {
  if (fs.realpathSync(git(['rev-parse', '--show-toplevel'])).toLowerCase() !== fs.realpathSync(root).toLowerCase()) fail('Git root does not match project');
  const { stage } = governance(read, f => fs.existsSync(inside(root, f)));
  const args = process.argv.slice(2), arg = name => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail(name + ' requires a value');
    return args[i + 1];
  };
  const progress = read('docs/progress.md');
  const completion = progress.match(/^维护记录：\[[^\]]+\]\(([^)]+)\)/m)?.[1];
  const completionPath = completion ? path.posix.normalize('docs/' + completion) : null;
  if (completionPath && !fs.existsSync(inside(root, completionPath))) fail('missing maintenance record');
  const registry = progress.match(/^工作区登记：\[[^\]]+\]\(([^)]+)\)/m)?.[1];
  let inherited = new Set();
  if (registry) {
    const manifest = JSON.parse(read(path.posix.normalize('docs/' + registry)));
    inherited = validateInherited(manifest, file => {
      const filename = inside(root, file);
      if (!fs.existsSync(filename)) return null;
      return { sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), index: git(['ls-files', '--stage', '--', file]) };
    });
  }
  const base = arg('--base');
  if (base) {
    const revision = git(['rev-parse', '--verify', base + '^{commit}']);
    const changed = new Set([...git(['diff', '--name-only', revision, '--']).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')].filter(Boolean));
    const scopeName = arg('--scope-file');
    const parsed = scopeName ? JSON.parse(read(scopeName)) : null;
    const scope = selectScope(changed, inherited, parsed && (Array.isArray(parsed) ? parsed : parsed.changeScope));
    if (scope.length) {
      if (!changed.has('docs/progress.md')) fail('changes lack updated current handoff');
      const runtime = scope.some(f => /^(plugin|native)\//.test(f) || /^tests\//.test(f) && f !== 'tests/document-governance.cjs');
      const record = runtime ? 'docs/experiments/' + stage + '/report.md' : completionPath;
      if (!record || !changed.has(record)) fail('changes lack updated scoped completion record: ' + (record || '(none)'));
    }
  }
  const dirty = git(['status', '--porcelain=v1', '-uall']).split('\n').filter(Boolean);
  if (args.includes('--require-clean') && dirty.length) fail(dirty.length + ' uncommitted files remain; registered other-task paths: ' + inherited.size + '. Do not claim clean.');
  console.log('handoff: ' + stage + '; unique current handoff and role entries checked; registered other-task paths: ' + inherited.size + '; uncommitted: ' + dirty.length + '. Not a host acceptance or semantic guarantee.');
}
if (require.main === module) { try { check(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { validateInherited, selectScope };
