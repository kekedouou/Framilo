'use strict';
// Read-only completion checks. Does not commit, stage, rewrite app state or run media.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { throw Error('handoff: ' + message); };
const actual = fs.realpathSync(git(['rev-parse', '--show-toplevel']));
if (actual.toLowerCase() !== fs.realpathSync(root).toLowerCase()) fail('Git root does not match project');
const stage = read('docs/project-profile.md').match(/当前：E-(\d+)/)?.[1];
if (!stage) fail('project-profile lacks current stage');
const id = 'E' + stage, report = 'docs/experiments/' + id + '/report.md';
for (const file of ['plan.md', 'report.md']) if (!fs.existsSync(path.join(root, 'docs/experiments', id, file))) fail(id + ' missing ' + file);
for (const file of ['README.md', 'docs/progress.md', 'docs/development-plan.md', 'docs/roadmap.md']) {
  const intro = read(file).split(/\r?\n/).slice(0, 14).join('\n');
  if (!intro.includes('E-' + stage) && !intro.includes('/' + id + '/')) fail(file + ' current introduction is not ' + id);
}
const args = process.argv.slice(2), baseIndex = args.indexOf('--base');
if (baseIndex >= 0) {
  const base = args[baseIndex + 1];
  if (!base || base.startsWith('-')) fail('--base needs a local revision');
  const revision = git(['rev-parse', '--verify', base + '^{commit}']);
  const changed = new Set([...git(['diff', '--name-only', revision, '--']).split('\n'), ...git(['ls-files', '--others', '--exclude-standard']).split('\n')]);
  if ([...changed].some(f => /^(plugin|tests|scripts)\//.test(f))) {
    for (const file of [report, 'docs/progress.md']) if (!changed.has(file)) fail('Code changed but completion record did not: ' + file);
  }
}
const dirty = git(['status', '--porcelain=v1', '-uall']).split('\n').filter(Boolean);
if (args.includes('--require-clean') && dirty.length) fail(dirty.length + ' uncommitted files remain; commit scoped work or record why before claiming completion');
console.log('handoff: ' + id + ', Git root and current introductions aligned; uncommitted files: ' + dirty.length + '. Content accuracy and real-host acceptance still require review.');
