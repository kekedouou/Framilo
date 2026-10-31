'use strict';
// Read-only document structure, navigation and preservation checks; no media or host calls.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const roles = {
  'AGENTS.md': '通用规则', 'README.md': '使用入口',
  'docs/project-profile.md': '任务地图', 'docs/progress.md': '当前交接',
  'docs/product.md': '产品行为', 'docs/architecture.md': '模块边界',
  'docs/development-plan.md': '维护流程', 'docs/verification.md': '验证协议',
  'docs/roadmap.md': '未来路线'
};
const fail = message => { throw Error('documents: ' + message); };
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function inside(root, name) {
  if (typeof name !== 'string' || !name || path.isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.includes('\\') || name.split('/').some(x => x === '..' || x === '.')) fail('invalid project path: ' + name);
  const absolute = path.resolve(root, name);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) fail('path outside project: ' + name);
  return absolute;
}
function slug(text) { return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-'); }
function links(body) {
  return [...body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1].replace(/^<|>$/g, ''));
}
function linkTarget(file, raw) {
  if (/^(https?:|app:|codex:|mailto:|[A-Za-z]:)/.test(raw)) return null;
  const [name, anchor] = raw.split('#');
  return { target: name ? path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(name))) : file, anchor: anchor ? decodeURIComponent(anchor) : null };
}
function markdownFiles(root) {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) return [];
    const f = path.join(dir, e.name);
    return e.isDirectory() ? walk(f) : f.endsWith('.md') ? [path.relative(root, f).split(path.sep).join('/')] : [];
  });
  return ['AGENTS.md', 'README.md', 'CHANGELOG.md', ...walk(path.join(root, 'docs'))];
}
function governance(read, exists) {
  const rawRead = read; read = f => rawRead(f).replace(/\r\n/g, '\n');
  for (const file of Object.keys(roles)) {
    if (!exists(file)) fail('missing role entry: ' + file);
    const body = read(file);
    if (file !== 'docs/progress.md' && /^(?:当前(?:阶段[：:]|[：:]E-?\d+)|候选(?:提交|状态)[：:]|current (?:stage|phase)\s*[:：]|candidate (?:commit|status)\s*[:：])/im.test(body)) fail('duplicate current state in ' + file);
    if (/^#{1,6}\s+(?:当前[：:]|E-?\d+\b)/m.test(body)) fail('stage patch heading in role entry: ' + file);
    if (/第二阶段(?:尚未开始|及未来范围仍未启动)/.test(body)) fail('stale stage status in ' + file);
  }
  const limits = { 'AGENTS.md': [60, 6000], 'docs/project-profile.md': [80, 4000], 'docs/progress.md': [100, 4000] };
  let total = 0;
  for (const [file, [maxLines, maxChars]] of Object.entries(limits)) {
    const s = read(file); total += s.length;
    if (s.split('\n').length > maxLines || s.length > maxChars) fail('entry budget exceeded; merge/archive before adding: ' + file);
  }
  if (total > 10000) fail('default reading exceeds 10000 characters');
  // English uses more characters per token. Keep the total character guard and
  // require a fresh local measurement within the pre-translation token budget.
  const budgetPath = 'docs/document-token-budget.json';
  if (!exists(budgetPath)) fail('missing token measurement');
  const budget = JSON.parse(read(budgetPath));
  const measured = budget.files?.['AGENTS.md']?.after;
  if (budget.encoding !== 'o200k_base' || budget.vocabularySha256 !== require('./count-doc-tokens.cjs').VOCAB_SHA ||
      !measured || measured.sha256 !== sha(read('AGENTS.md')) || measured.characters !== read('AGENTS.md').length)
    fail('stale/invalid AGENTS token measurement; rerun local count');
  if (!Number.isSafeInteger(measured.tokens) || measured.tokens <= 0 || measured.tokens > 1160)
    fail('AGENTS token budget exceeded (1160); merge/archive before adding');
  const progress = read('docs/progress.md');
  const stages = [...progress.matchAll(/^当前阶段：E-(\d+)$/gm)];
  if (stages.length !== 1) fail('progress needs exactly one current stage');
  const stage = 'E' + stages[0][1];
  for (const name of ['plan.md', 'report.md']) {
    const f = 'docs/experiments/' + stage + '/' + name;
    if (!exists(f) || !links(progress).includes('experiments/' + stage + '/' + name)) fail('missing current stage navigation: ' + f);
  }
  const map = new Set(links(read('docs/project-profile.md')).map(u => linkTarget('docs/project-profile.md', u)?.target));
  for (const f of [...Object.keys(roles).filter(f => f.startsWith('docs/') && f !== 'docs/project-profile.md'), 'docs/experiments/README.md', 'docs/performance/WORKFLOW.md']) {
    if (!map.has(f)) fail('task map lacks ' + f);
  }
  const modules = read('docs/architecture.md').split('## 现行模块地图\n')[1]?.split(/^## /m)[0];
  if (!modules) fail('architecture lacks current module map');
  if (/performance-(?:dashboard|explainer|inbox|protocol|report|runner)|run-standard-performance|E39增加代理淡蓝条/.test(modules)) fail('retired module in current map');
  return { stage, defaultChars: total };
}
function checkLinks(root, read = f => fs.readFileSync(inside(root, f), 'utf8')) {
  const files = markdownFiles(root), set = new Set(files), edges = new Map();
  let count = 0;
  for (const f of files) {
    const outgoing = [];
    for (const raw of links(read(f))) {
      const resolved = linkTarget(f, raw); if (!resolved) continue;
      const absolute = inside(root, resolved.target);
      if (!fs.existsSync(absolute)) fail('broken link: ' + f + ' -> ' + raw);
      if (resolved.anchor && resolved.target.endsWith('.md')) {
        const headings = [...read(resolved.target).matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => slug(m[1]));
        if (!headings.includes(resolved.anchor)) fail('missing heading: ' + f + ' -> ' + raw);
      }
      if (set.has(resolved.target)) outgoing.push(resolved.target);
      count++;
    }
    edges.set(f, outgoing);
  }
  const seen = new Set(), queue = ['AGENTS.md', 'README.md'];
  while (queue.length) { const f = queue.shift(); if (seen.has(f)) continue; seen.add(f); queue.push(...edges.get(f) || []); }
  const lost = files.filter(f => !seen.has(f));
  if (lost.length) fail('no clickable route from entry: ' + lost.join(', '));
  const index = read('docs/experiments/README.md');
  for (const f of files.filter(f => /^docs\/experiments\/[^/]+\/[^/]+\.md$/.test(f))) {
    if (!links(index).includes(f.slice('docs/experiments/'.length))) fail('experiment index lacks ' + f);
  }
  return { files: files.length, links: count };
}
function preservation(root) {
  const manifestPath = path.join(root, 'docs/history/2026-10-31/source-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const source = f => execFileSync('git', ['show', manifest.baseline + ':' + f], { cwd: root, windowsHide: true });
  // Moving a document may change link destinations and terminal whitespace only.
  const content = data => data.toString('utf8').replace(/\r\n/g, '\n').replace(/^<!-- archived-source: [^\n]+ -->\n>[^\n]+\n\n/, '').replace(/(\[[^\]]*\]\()([^)]+)(\))/g, '$1<destination>$3').trim();
  for (const row of manifest.sources) {
    const before = source(row.source), after = fs.readFileSync(inside(root, row.archive));
    if (sha(before) !== row.baselineBlobSha256 || sha(Buffer.from(after.toString('utf8').replace(/\r\n/g, '\n'))) !== row.archiveSha256 || content(before) !== content(after)) fail('archive preservation mismatch: ' + row.source);
  }
  for (const row of manifest.navigationOnlyEdits) {
    const before = source(row.path), after = fs.readFileSync(inside(root, row.path));
    if (content(before) !== content(after)) fail('historical text changed beyond navigation: ' + row.path);
  }
  if (fs.existsSync(path.join(root, 'docs/performance/STATUS.md'))) fail('obsolete STATUS entry restored; use history');
  return manifest.sources.length;
}
function retiredPreservation(root = ROOT, read = f => fs.readFileSync(inside(root, f)), exists = f => fs.existsSync(inside(root, f))) {
  const prefix = 'docs/history/retired-performance-2026-10-31/';
  const prior = JSON.parse(read('docs/history/2026-10-31/source-manifest.json'));
  const manifest = JSON.parse(read(prefix + 'manifest.json'));
  const expected = new Map(prior.inheritedDetails.filter(r => !r.index).map(r => [r.path, r.sha256]));
  if (manifest.files.length !== expected.size || new Set(manifest.files.map(r => r.source)).size !== expected.size || typeof manifest.originalsRemoved !== 'boolean') fail('retired archive inventory mismatch');
  let bytes = 0;
  for (const row of manifest.files) {
    if (row.archive !== prefix + row.source || row.sha256 !== expected.get(row.source)) fail('retired archive identity mismatch: ' + row.source);
    const data = read(row.archive); bytes += data.length;
    if (sha(data) !== row.sha256 || data.length !== row.bytes) fail('retired archive content mismatch: ' + row.source);
    if (manifest.originalsRemoved && exists(row.source)) fail('retired source restored in active tree: ' + row.source);
  }
  if (bytes !== manifest.totalBytes) fail('retired archive byte count mismatch');
  return manifest.files.length;
}
function check(root = ROOT) {
  const read = f => fs.readFileSync(inside(root, f), 'utf8'), exists = f => fs.existsSync(inside(root, f));
  const current = governance(read, exists), navigation = checkLinks(root, read), archives = preservation(root);
  return { ...current, ...navigation, archives, retiredSources: retiredPreservation(root) };
}
if (require.main === module) {
  try { console.log('documents: ' + JSON.stringify(check())); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { check, governance, checkLinks, preservation, retiredPreservation, inside, roles };
