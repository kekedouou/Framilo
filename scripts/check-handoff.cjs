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
  if (!Array.isArray(manifest.inheritedDetails)) fail('workspace registry needs inheritedDetails array');
  const inherited = new Set();
  for (const row of manifest.inheritedDetails) {
    inside(root, row.path);
    if (inherited.has(row.path) || typeof row.sha256 !== 'string' || typeof row.index !== 'string') fail('invalid/duplicate registry identity');
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
function validateCandidate(candidate, resolve) {
  if (!/^[a-f0-9]{7,40}$/.test(candidate)) fail('invalid candidate commit');
  try { return resolve(candidate + '^{commit}'); }
  catch { fail('candidate commit does not resolve: ' + candidate); }
}
function validateCompletion(changed, scope, record) {
  if (!scope.length) return;
  if (!scope.includes('docs/progress.md') || !changed.has('docs/progress.md')) fail('changes lack scoped updated current handoff');
  if (!scope.includes(record) || !changed.has(record)) fail('changes lack updated scoped completion record: ' + record);
}
function check() {
  if (fs.realpathSync(git(['rev-parse', '--show-toplevel'])).toLowerCase() !== fs.realpathSync(root).toLowerCase()) fail('Git root does not match project');
  const { task, completion, registry, candidate } = governance(read, f => fs.existsSync(inside(root, f)));
  validateCandidate(candidate, revision => git(['rev-parse', '--verify', revision]));
  const args = process.argv.slice(2), arg = name => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail(name + ' requires a value');
    return args[i + 1];
  };
  const manifest = JSON.parse(read(registry));
  const inherited = validateInherited(manifest, file => {
      const filename = inside(root, file);
      if (!fs.existsSync(filename)) return null;
      return { sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), index: git(['ls-files', '--stage', '--', file]) };
    });
  const base = arg('--base');
  if (base) {
    const revision = git(['rev-parse', '--verify', base + '^{commit}']);
    const changed = new Set([...git(['diff', '--name-only', revision, '--']).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')].filter(Boolean));
    const scopeName = arg('--scope-file');
    const parsed = scopeName ? JSON.parse(read(scopeName)) : null;
    const scope = selectScope(changed, inherited, parsed && (Array.isArray(parsed) ? parsed : parsed.changeScope));
    validateCompletion(changed, scope, completion.target);
  }
  const dirty = git(['status', '--porcelain=v1', '-uall']).split('\n').filter(Boolean);
  if (args.includes('--require-clean') && dirty.length) fail(dirty.length + ' uncommitted files remain; registered other-task paths: ' + inherited.size + '. Do not claim clean.');
  console.log('handoff: ' + task + '; candidate commit and workspace registry checked; registered other-task paths: ' + inherited.size + '; uncommitted: ' + dirty.length + '. Not a host acceptance or semantic guarantee.');
}
if (require.main === module) { try { check(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
module.exports = { validateInherited, selectScope, validateCandidate, validateCompletion };
