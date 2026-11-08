'use strict';
// In-memory host contracts only: no Eagle, files, timers or media preparation.
const assert = require('assert'), path = require('path');
const { captureSelected, createEagleAdapter, discoverTools } = require('../plugin/eagle.cjs');
const source = { id: 'compat', filePath: path.resolve('compatibility/video.mp4'), ext: 'mp4' };
const minimum = /Eagle 4\.0 Build 22/;
let count = 0;
async function test(name, body) { await body(); count++; console.log('ok ' + name); }
async function main() {
  await test('Known unsupported versions stop before reading the selection', async () => {
    for (const app of [{version:'3.0',build:99},{version:'4.0',build:21},{version:'4.0.0',build:'21'},{version:'4.0',build:0}]) {
      let calls=0;
      await assert.rejects(captureSelected({app,item:{getSelected(){calls++;return [source];}}}), e =>
        e.code === 'EAGLE_VERSION_UNSUPPORTED' && minimum.test(e.message) && e.diagnostics.attempts === 0);
      assert.strictEqual(calls,0);
    }
  });
  await test('Minimum, newer and unknown versions retain immediate single selection capture', async () => {
    for (const app of [{version:'4.0',build:22},{version:'4.0.0',build:'22'},{version:'4.0',build:27},
      {version:'4.1',build:1},{version:'5.0',build:1},undefined,{},
      {version:'4.0',build:null},{version:'4.0',build:''},{version:'4.0',build:NaN},
      {version:'4.0',build:-1},{version:'4.0',build:21.5},{version:'invalid',build:1},
      {get version(){throw Error('unavailable');}}]) {
      let calls=0; const item={getSelected(){assert.strictEqual(this,item);calls++;return [source];}};
      const pending=captureSelected({app,item});assert.strictEqual(calls,1);
      assert.strictEqual((await pending).id,source.id);assert.strictEqual(calls,1);
    }
  });
  await test('Missing selection and FFmpeg APIs include the supported version and recovery', async () => {
    for (const pending of [captureSelected({}),discoverTools({})])
      await assert.rejects(pending,e=>minimum.test(e.message)&&/重启 Eagle/.test(e.message));
  });
  await test('Real app/session display unsupported version without starting media and still close normally', async () => {
    const {harness,bounded}=require('./t1-app.cjs');
    const h=harness({realSession:true,capture:()=>captureSelected({app:{version:'4.0',build:21}})});
    await bounded(h.hooks.onPluginCreate({path:h.root}));
    const state=h.updates.at(-1);assert.strictEqual(state.state,'error');assert.match(state.error.message,minimum);
    assert.strictEqual(h.counts().prepared,0);assert.strictEqual(h.counts().discovered,0);
    await bounded(h.hooks.onPluginBeforeExit());assert.strictEqual(h.counts().destroyed,1);
  });
  const api={library:{path:path.resolve('compatibility/library')},item:{}};
  const adapter=createEagleAdapter(api); let item={...source};
  await test('Missing item lookup and comments explain missing capability', async () => {
    await assert.rejects(adapter.readComments(source),e=>e.code==='COMMENTS_API_UNAVAILABLE'&&minimum.test(e.message));
    api.item.getById=async()=>item;
    await assert.rejects(adapter.readComments(source),e=>e.code==='COMMENTS_API_UNAVAILABLE'&&minimum.test(e.message));
  });
  await test('Malformed comments stay data errors, while valid empty comments remain readable', async () => {
    for (const comments of [null,{},[{}]]) {
      item={...source,comments};await assert.rejects(adapter.readComments(source),e=>e.code==='COMMENTS_INVALID'&&!minimum.test(e.message));
    }
    item={...source,comments:[]};assert.deepStrictEqual((await adapter.readComments(source)).items,[]);
  });
  await test('Missing add/edit/delete methods do not dispatch and retain failed rather than unknown status', async () => {
    for(const kind of ['add','edit','delete']) {
      item={...source,comments:[{id:'note',duration:1,annotation:'original'}]};
      let issued=0;
      const result=await adapter.saveComment({kind,source,time:1,text:'new',original:{id:'note',time:1,text:'original'}},
        {onIssued(){issued++;}});
      assert.strictEqual(result.status,'failed');assert.strictEqual(result.attempt,null);assert.strictEqual(issued,0);
      assert.match(result.message,minimum);assert.match(result.message,/重启 Eagle/);
      assert.strictEqual(item.comments[0].annotation,'original');
    }
  });
  console.log('Eagle compatibility: '+count+' groups passed (in-memory only).');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
