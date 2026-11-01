'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('vm'),fs=require('fs'),path=require('path');
const {start,bundle}=require('../scripts/frontend-preview.cjs');
test('preview serves shared production UI but rejects filesystem, host APIs and external origins',async t=>{
 const server=await start({sampleBytes:Buffer.from('synthetic-test-only'),writeReceipt:false});t.after(()=>new Promise(r=>server.close(r)));const url=server.previewUrl;
 const html=await (await fetch(url)).text();assert(html.includes('preview-host.js'));assert(!html.includes('src="app.js"'));assert(html.includes('graphite-shell.js'));
 assert(!/id="(?:playbackBackend|proxyDiskGiB)"|shortcut-help/.test(html));
 for(const resource of ['../memory-settings.json','app.js','native-backend.cjs','cache/owner.json','file:///C:/secret'])assert([403,404].includes((await fetch(url+resource)).status));
 assert.equal((await fetch(url,{method:'POST',body:'x'})).status,403);
 assert.equal((await fetch(url,{headers:{Origin:'https://example.invalid'}})).status,403);
 assert.equal((await fetch(url+'sample.mp4',{headers:{Range:'bytes=0-3'}})).status,206);
 const css=await(await fetch(url+'graphite.css')).text();assert.equal(css,fs.readFileSync(path.resolve(__dirname,'../plugin/graphite.css'),'utf8'));
});
test('preview bundles real Session and drawing modules with filesystem denied',()=>{
 const context={window:{},console,crypto:require('crypto').webcrypto};vm.runInNewContext(bundle(),context);const load=context.window.PreviewModules.load;assert.equal(typeof load('session.cjs').createSession,'function');assert.equal(typeof load('drawing-model.js').defaultStyles,'function');assert.throws(()=>load('fs').readFileSync('x'),/禁止文件/);assert.throws(()=>load('native-backend.cjs'),/不允许/);
});
