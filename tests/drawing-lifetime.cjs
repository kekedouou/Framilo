'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { scratch } = require('./support/annotation-scratch.cjs');
const { createAnnotationStore } = require('../plugin/drawing-store.cjs');
const { createDrawingLifetime } = require('../plugin/drawing-lifetime.cjs');
const { createEagleAdapter } = require('../plugin/eagle.cjs');
const record = id => ({ id, sourceSha256:'a'.repeat(64), nativeId:null, nativeTime:null, frameOrdinal:0, frameId:0, time:0,
  objects:[{id:'box',kind:'rect',color:'#ffffff',width:.004,a:{x:.1,y:.1},b:{x:.3,y:.3}}] });
async function main() {
  const s = scratch('lifetime');
  try {
    const plugin = path.join(s.root,'plugin'), library = path.join(s.root,'test.library'), images = path.join(library,'images');
    fs.mkdirSync(plugin); fs.mkdirSync(images,{recursive:true}); fs.writeFileSync(path.join(library,'metadata.json'),'{}');
    const api = {library:{path:library},item:{getById:async()=>null}}, adapter = createEagleAdapter(api);
    const store = createAnnotationStore({pluginRoot:plugin});
    const scope = itemId => ({libraryPath:library,itemId});
    const seed = id => store.save(scope(id),[record(id)],null);
    let active=null, yielded=0, scheduled=0, cancelled=0;
    const controller = extra => createDrawingLifetime({store,adapter,protectedItem:()=>active,
      yieldWork:async()=>{yielded++;},schedule:()=>++scheduled,cancel:()=>cancelled++,...extra});
    const life = controller();
    seed('TRASH');fs.mkdirSync(path.join(images,'TRASH.info'));
    assert.equal(await adapter.drawingDeletion(scope('TRASH')),null,'trash folder must protect API-hidden item');
    seed('LIVE');api.item.getById=async id=>id==='LIVE'?{id}:null;
    seed('GONE');seed('ACTIVE');active={itemId:'ACTIVE'};
    const visibility=store.saveVisibility(false,null), styles=store.readStyles();
    const result=await life.run();assert.equal(result.removed,1);assert.equal(store.read(scope('GONE')).token,null);
    for(const id of ['TRASH','LIVE','ACTIVE'])assert.equal(store.read(scope(id)).records[0].id,id);
    assert.equal(store.readVisibility().token,visibility.token);assert.deepEqual(store.readStyles(),styles);assert(yielded>0);await life.stop();assert.equal(cancelled,1);
    assert.equal(createAnnotationStore({pluginRoot:plugin}).read(scope('GONE')).token,null,'normal reopening');
    console.log('drawing lifetime: permanent delete, trash/API/live/active protection, settings and reopen');

    seed('ERROR');api.item.getById=async()=>{throw Error('offline');};const err=controller();assert.equal((await err.run()).removed,0);await err.stop();
    api.item.getById=async()=>false;assert.equal(await adapter.drawingDeletion(scope('ERROR')),null,'malformed response');
    api.item.getById=async()=>null;
    fs.renameSync(path.join(library,'metadata.json'),path.join(library,'metadata-held.json'));
    assert.equal(await adapter.drawingDeletion(scope('ERROR')),null,'offline/incomplete library');
    fs.renameSync(path.join(library,'metadata-held.json'),path.join(library,'metadata.json'));
    assert.equal(await adapter.drawingDeletion(scope('../escape')),null);
    console.log('drawing lifetime: read errors, malformed responses, missing library metadata, invalid IDs retain');

    const old=seed('CHANGED'), candidate={scope:scope('CHANGED'),token:old.token};
    const newer=store.save(scope('CHANGED'),[record('new')],old.token);
    assert.equal(store.removeDeleted(candidate,()=>true),false);assert.equal(store.read(scope('CHANGED')).token,newer.token);
    const dir=path.join(store.root,newer.key), unknown=path.join(dir,'unknown.txt');fs.writeFileSync(unknown,'keep');
    assert.throws(()=>store.removeDeleted({scope:scope('CHANGED'),token:newer.token},()=>true),/未知文件/);fs.unlinkSync(unknown);
    const held=path.join(store.root,'maintenance-'+newer.key+'.lock');fs.writeFileSync(held,'interrupted');
    assert.throws(()=>store.removeDeleted({scope:scope('CHANGED'),token:newer.token},()=>true),/另一个窗口/);
    assert.throws(()=>store.save(scope('CHANGED'),[],newer.token),/另一个窗口/);fs.unlinkSync(held);
    assert.equal(store.read(scope('CHANGED')).token,newer.token);
    const exitedPid=Number(require('child_process').execFileSync(process.execPath,['-e','process.stdout.write(String(process.pid))'],{windowsHide:true,encoding:'utf8'}));
    fs.writeFileSync(held,JSON.stringify({owner:require('../plugin/drawing-store.cjs').OWNER,pid:exitedPid,nonce:'crash-fixture'}));
    const recovered=store.save(scope('CHANGED'),[record('recovered')],newer.token);
    assert.equal(recovered.records[0].id,'recovered');assert(!fs.existsSync(held));
    console.log('drawing lifetime: stale revision, unknown files and interrupted lease preserve data');

    const moved=dir+'-held';fs.renameSync(dir,moved);fs.symlinkSync(moved,dir,'junction');
    try {assert.throws(()=>store.removeDeleted({scope:scope('CHANGED'),token:recovered.token},()=>true),/身份异常/);assert(fs.existsSync(moved));}
    finally {fs.rmdirSync(dir);fs.renameSync(moved,dir);}
    const itemLink=path.join(images,'ERROR.info');fs.symlinkSync(path.join(images,'TRASH.info'),itemLink,'junction');
    try {assert.equal(await adapter.drawingDeletion(scope('ERROR')),null);}finally{fs.rmdirSync(itemLink);}
    const denied=Object.create(fs.promises);denied.lstat=async()=>{throw Object.assign(Error('denied'),{code:'EACCES'});};
    assert.equal(await createEagleAdapter(api,{fs:{promises:denied}}).drawingDeletion(scope('ERROR')),null);
    const savedLibrary=api.library.path;api.library.path=library+'-switched';assert.equal(await adapter.drawingDeletion(scope('ERROR')),null);api.library.path=savedLibrary;
    console.log('drawing lifetime: directory junctions, permissions and changed library preserve data');

    let writesBlocked=false;
    const reentrant=Object.create(fs);reentrant.unlinkSync=file=>{
      if(path.dirname(file)===dir){assert.throws(()=>store.save(scope('CHANGED'),[],recovered.token),/另一个窗口/);writesBlocked=true;}
      return fs.unlinkSync(file);
    };
    assert(createAnnotationStore({pluginRoot:plugin,io:reentrant}).removeDeleted({scope:scope('CHANGED'),token:recovered.token},()=>true));assert(writesBlocked);
    console.log('drawing lifetime: cleanup lease excludes concurrent writes');

    const first=seed('INTERRUPT'), latest=store.save(scope('INTERRUPT'),[record('last')],first.token);
    const interrupted=Object.create(fs);let unlinks=0;
    interrupted.unlinkSync=file=>{if(path.dirname(file)===path.join(store.root,latest.key)&&++unlinks===2)throw Error('interrupt');return fs.unlinkSync(file);};
    assert.throws(()=>createAnnotationStore({pluginRoot:plugin,io:interrupted}).removeDeleted({scope:scope('INTERRUPT'),token:latest.token},()=>true),/interrupt/);
    assert.equal(createAnnotationStore({pluginRoot:plugin}).read(scope('INTERRUPT')).token,latest.token);
    assert(store.removeDeleted({scope:scope('INTERRUPT'),token:latest.token},()=>true));
    console.log('drawing lifetime: interrupted purge preserves latest revision and retry completes');

    let resolve, calls=0;
    const gate=new Promise(r=>resolve=r), late=controller({adapter:{drawingLibrary:()=>library,drawingDeletion:()=>{calls++;return gate;}}});
    const pending=late.run();assert.strictEqual(late.run(),pending);
    while(!calls)await new Promise(r=>setTimeout(r,1));const stopped=late.stop();resolve('proof');await stopped;
    assert(store.read(scope('ERROR')).token);assert.equal(calls,1,'late result cannot trigger second probe/delete');
    const changed=controller({adapter:{drawingLibrary:()=>library,drawingDeletion:async()=>String(++calls)}});
    assert.equal((await changed.run()).removed,0);await changed.stop();
    console.log('drawing lifetime: coalescing, stop, stale library evidence and late callbacks');

    // Async enumeration wraps a bounded batch across libraries/unknown records.
    for(let i=0;i<20;i++)store.save({libraryPath:library+'-other',itemId:'FOREIGN'+i},[record('foreign')],null);
    let cursor='', visited=new Set();for(let i=0;i<4;i++)for await(const c of store.maintenanceCandidates(library,cursor)){cursor=c.key;if(c.scope)visited.add(c.scope.itemId);}
    assert(visited.has('ERROR'));assert(visited.has('TRASH'));
    assert.equal(fs.readFileSync(path.join(library,'metadata.json'),'utf8'),'{}');assert(fs.existsSync(path.join(images,'TRASH.info')));
    console.log('drawing lifetime: bounded fair batches, other-library retention, no library writes');
  } finally {s.clean();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
