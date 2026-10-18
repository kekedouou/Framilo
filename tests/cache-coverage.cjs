'use strict';
const assert = require('assert');
const { decodedRanges } = require('../plugin/player.js');
const { harness, sample } = require('./player.cjs');
async function main() {
  const rows = [{time:0,end:.04},{time:.04,end:.12},{time:.12,end:.12},{time:.12,end:.3},{time:.3,end:.5}];
  const range = decodedRanges(rows, [4, 1, 0, 2], .8);
  assert.deepEqual(range, [{start:0,end:.12},{start:.3,end:.8}]);
  assert(Object.isFrozen(range) && Object.isFrozen(range[0]));
  assert.deepEqual(decodedRanges(rows,[0,1,3,4],.8),[{start:0,end:.8}]);
  assert.deepEqual(decodedRanges(rows,[],.8),[]);
  const h = harness({forwardPredecode:true,experimentMode:'compressed-ram',compressedRamBytes:1000,ramBytes:2000000});
  await h.load(sample('coverage',null,80));for(let i=0;i<100;i++)await h.frame();
  const first=h.player.cacheCoverageSnapshot(),again=h.player.cacheCoverageSnapshot();
  assert.strictEqual(first.ranges,again.ranges);assert.equal(first.decodedFrames,h.player.cache.size);
  assert(first.decodedFrames>7 && first.decodedFrames<first.totalFrames);
  assert([...h.player.compressed.keys()].some(i=>!h.player.cache.has(i)),'Compressed-only frames must not be green.');
  const before=first.revision;assert(h.player._evict());const after=h.player.cacheCoverageSnapshot();
  assert(after.revision>before);assert.equal(after.decodedFrames,first.decodedFrames-1);assert.notStrictEqual(after.ranges,first.ranges);
  h.player.setForwardPredecode(false);assert.deepEqual(h.player.cacheCoverageSnapshot().ranges,after.ranges);
  await h.load(sample('different',null,8));const next=h.player.cacheCoverageSnapshot();
  assert(next.epoch>first.epoch);assert.equal(next.totalFrames,8);assert(next.ranges.every(r=>r.end<=.8));
  await h.close();assert.equal(h.player.cacheCoverageSnapshot(),null);
  console.log('E05 coverage: actual decoded residency, VFR intervals/holes/zero duration/audio tail, memoization, eviction, off/switch/dispose passed; models only.');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
