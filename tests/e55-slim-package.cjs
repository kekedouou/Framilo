'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const shared=require('../plugin/playback-common.js'),old=require('../plugin/player.js');
const native=require('../scripts/package-release.cjs').NATIVE_RUNTIME;
for(const name of ['validRate','steppedRate','preparationWindow','decodedRanges'])assert.equal(shared[name].toString(),old[name].toString(),'Shared helper behavior changed: '+name);
assert.equal(shared.Budget.toString(),old.Budget.toString());assert.deepEqual(shared.RATE_STEPS,old.RATE_STEPS);assert.deepEqual(shared.RATE_PRESETS,old.RATE_PRESETS);
const ledger=new shared.ManagedBudget(1024),frame=ledger.reserve(100,'frame');assert.equal(ledger.snapshot().used,100);ledger.release(frame);assert.equal(ledger.snapshot().used,0);
const read=n=>fs.readFileSync(path.join(__dirname,'../plugin',n),'utf8'),html=read('index.html'),app=read('app.js');
for(const name of ['player.js','proxy-decoder.js','scrub-preview.js','quick-preview.js','record-previews.js','performance-view.js','performance-runtime.cjs','performance-core.cjs','live-resources.cjs']){
 assert(!native.includes(name),'Retired input in package: '+name);assert(!html.includes('src="'+name+'"'));
}
assert(native.includes('playback-common.js'));assert(html.indexOf('playback-common.js')<html.indexOf('native-player.js'));
assert(!html.includes('id="performanceMonitor"'));assert(!/performanceMonitor|performanceView|EVAPerformanceView/.test(app));
assert(!read('settings-view.js').includes('performanceMonitor'));
assert(native.includes('whole-proxy.cjs')&&native.includes('native-audio.cjs')&&native.includes('cache.cjs'));
for(const name of ['performance-view.js','performance-window.html','performance-window.js','performance.css'])assert(!fs.existsSync(path.join(__dirname,'../plugin',name)));
console.log('E55: unchanged shared playback helpers, RAM lifecycle, native-only frontend/package, monitor removal; no media or Eagle writes');
