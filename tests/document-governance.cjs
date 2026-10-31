'use strict';
// Meaningful regression cases for previously missed document governance errors.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { governance, inside, roles } = require('../scripts/check-docs.cjs');
const root = path.resolve(__dirname, '..');
const originals = new Map(Object.keys(roles).map(f => [f, fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n')]));
const currentStage = originals.get('docs/progress.md').match(/^当前阶段：E-(\d+)$/m)[1];
const { validateInherited, selectScope } = require('../scripts/check-handoff.cjs');
let cases = 0;
function exercise(change, pattern) {
  const docs = new Map(originals); change(docs);
  const run = () => governance(f => docs.get(f), f => docs.has(f) || fs.existsSync(path.join(root, f)));
  if (pattern) assert.throws(run, pattern); else assert.equal(run().stage, 'E' + currentStage);
  cases++;
}
exercise(() => {});
exercise(d => { for (const [f,s] of d) d.set(f,s.replace(/\n/g,'\r\n')); });
exercise(d => d.set('docs/roadmap.md', d.get('docs/roadmap.md') + '\n当前：E-50 第二阶段尚未开始\n'), /duplicate current state/);
exercise(d => d.set('docs/product.md', d.get('docs/product.md') + '\n## E52 本轮交接\n'), /stage patch heading/);
exercise(d => d.set('docs/progress.md', d.get('docs/progress.md').replace('当前阶段：E-' + currentStage, '当前阶段：E-999')), /missing current stage navigation/);
exercise(d => d.set('docs/progress.md', d.get('docs/progress.md') + '\n当前阶段：E-' + currentStage + '\n'), /exactly one/);
exercise(d => d.set('docs/architecture.md', d.get('docs/architecture.md').replace('## 现行模块地图\n', '## 现行模块地图\n| plugin/performance-dashboard.cjs | old |\n')), /retired module/);
exercise(d => d.set('docs/project-profile.md', d.get('docs/project-profile.md').replace('(verification.md)', '(product.md)')), /task map lacks docs\/verification/);
exercise(d => d.set('AGENTS.md', d.get('AGENTS.md') + '重复补丁'.repeat(1000)), /budget exceeded/);
for (const input of ['../outside', 'D:/outside', 'docs/../outside', '/outside', 'docs\\outside']) { assert.throws(() => inside(root, input), /invalid project path|outside project/); cases++; }

const manifest = { inheritedDetails: [{ path: 'old-probe.txt', sha256: 'unchanged', index: 'staged-original' }] };
assert.equal(validateInherited(manifest, () => ({ sha256:'unchanged', index:'staged-original' })).size, 1);
assert.throws(() => validateInherited(manifest, () => ({ sha256:'changed', index:'staged-original' })), /identity\/index changed/);
assert.throws(() => validateInherited(manifest, () => ({ sha256:'unchanged', index:'restaged' })), /identity\/index changed/);
assert.equal(validateInherited(manifest, () => null).size, 0);
assert.throws(() => validateInherited(manifest, () => null, false), /identity\/index changed/);
const changed = new Set(['docs/product.md','old-probe.txt']), inherited = new Set(['old-probe.txt']);
assert.deepEqual(selectScope(changed, inherited, null), ['docs/product.md']);
assert.deepEqual(selectScope(changed, inherited, ['docs/product.md']), ['docs/product.md']);
assert.throws(() => selectScope(changed, inherited, ['old-probe.txt']), /other-task file included/);
assert.throws(() => selectScope(changed, inherited, ['docs/progress.md']), /unregistered changes outside/);
cases += 9;
console.log('document governance: ' + cases + ' cases passed');
