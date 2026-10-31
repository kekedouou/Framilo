'use strict';
// Local reference measurement, not a claim about the active model's billing tokenizer.
// Vocabulary: https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken
// Algorithm/pattern: https://github.com/openai/tiktoken (MIT), openai_public.py and _educational.py.
/* Upstream notice for the adapted pattern and algorithm:
MIT License
Copyright (c) 2022 OpenAI, Shantanu Jain
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const { execFileSync } = require('child_process');
const VOCAB_SHA = '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/\r\n/g, '\n');
// Expand Python's local case-insensitive contractions; retain case-sensitive Unicode letter classes.
const contraction = "(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?";
const pattern = new RegExp([
  String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]*[\p{Ll}\p{Lm}\p{Lo}\p{M}]+` + contraction,
  String.raw`[^\r\n\p{L}\p{N}]?[\p{Lu}\p{Lt}\p{Lm}\p{Lo}\p{M}]+[\p{Ll}\p{Lm}\p{Lo}\p{M}]*` + contraction,
  String.raw`\p{N}{1,3}`, String.raw` ?[^\s\p{L}\p{N}]+[\r\n/]*`,
  String.raw`\s*[\r\n]+`, String.raw`\s+(?!\S)`, String.raw`\s+`
].join('|'), 'gu');
function encoder(vocabulary) {
  if (sha(vocabulary) !== VOCAB_SHA) throw Error('unexpected o200k_base vocabulary hash');
  const ranks = new Map(vocabulary.toString('utf8').trim().split('\n').map(line => {
    const [encoded, rank] = line.split(' ');
    return [Buffer.from(encoded, 'base64').toString('hex'), Number(rank)];
  }));
  return text => {
    if (/<\|[^\n]*?\|>/.test(text)) throw Error('special-token syntax requires a separate audit');
    // JS and Python differ on a few Unicode whitespace characters. Reject them rather than miscount.
    if (/[\u001c-\u001f\u0085\ufeff]/u.test(text)) throw Error('unsupported whitespace');
    const pieces = [...text.matchAll(pattern)].map(m => m[0]);
    if (pieces.join('') !== text) throw Error('pre-tokenization lost text');
    const ids = [], decoded = [];
    for (const piece of pieces) {
      const bytes = Buffer.from(piece), direct = ranks.get(bytes.toString('hex'));
      if (direct !== undefined) { ids.push(direct); decoded.push(bytes); continue; }
      const parts = [...bytes].map(byte => Buffer.from([byte]));
      while (parts.length > 1) {
        let best = Infinity, at = -1;
        for (let i = 0; i < parts.length - 1; i++) {
          const rank = ranks.get(Buffer.concat([parts[i], parts[i + 1]]).toString('hex'));
          if (rank !== undefined && rank < best) { best = rank; at = i; }
        }
        if (at < 0) break;
        parts.splice(at, 2, Buffer.concat([parts[at], parts[at + 1]]));
      }
      for (const part of parts) {
        const id = ranks.get(part.toString('hex'));
        if (id === undefined) throw Error('unencoded bytes');
        ids.push(id); decoded.push(part);
      }
    }
    if (!Buffer.concat(decoded).equals(Buffer.from(text))) throw Error('round-trip mismatch');
    return ids;
  };
}
function selfTest(encode) {
  const fixtures = [
    ['hello world', [24912, 2375]],
    ['antidisestablishmentarianism', [493, 129901, 376, 160388, 21203, 2367]],
    ['2 + 2 = 4', [17, 659, 220, 17, 314, 220, 19]],
    ['お誕生日おめでとう', [8930, 9697, 243, 128225, 8930, 17693, 4344, 48669]]
  ];
  for (const [text, expected] of fixtures) {
    if (JSON.stringify(encode(text)) !== JSON.stringify(expected)) throw Error('reference fixture failed: ' + text);
  }
  return fixtures.length;
}
function measure(encode, value) {
  const text = normalize(value);
  return { sha256: sha(text), characters: text.length, tokens: encode(text).length };
}
if (require.main === module) {
  try {
    const [vocabularyPath, baseline, ...files] = process.argv.slice(2);
    if (!vocabularyPath || !/^[a-f0-9]{7,40}$/.test(baseline || '') || !files.length) throw Error('usage: node scripts/count-doc-tokens.cjs <vocabulary> <baseline-commit> <files...>');
    if (fs.statSync(vocabularyPath).size > 5 * 1024 * 1024) throw Error('vocabulary exceeds 5 MiB');
    const encode = encoder(fs.readFileSync(vocabularyPath)), fixtures = selfTest(encode);
    const root = path.resolve(__dirname, '..'), { inside } = require('./check-docs.cjs');
    const result = { encoding: 'o200k_base', vocabularySha256: VOCAB_SHA, baseline, fixtures, normalization: 'CRLF to LF', files: {} };
    for (const file of files) {
      const current = fs.readFileSync(inside(root, file), 'utf8');
      const before = execFileSync('git', ['show', baseline + ':' + file], { cwd: root, encoding: 'utf8', windowsHide: true });
      const a = measure(encode, before), b = measure(encode, current);
      result.files[file] = { before: a, after: b, reductionPercent: Number(((1 - b.tokens / a.tokens) * 100).toFixed(2)) };
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { encoder, selfTest, measure, VOCAB_SHA };
