'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{EventEmitter}=require('events');
const api=require('../plugin/temporary-media.cjs'),space=require('../plugin/media-space.cjs');
const identity=pid=>({pid,parentPid:0,startTicks:'638975000000000000',image:'C:\\test\\node.exe'});
async function fixture(t){const root=path.resolve(__dirname,'../verification-runs/e52/unit');await fs.promises.mkdir(root,{recursive:true});const dir=await fs.promises.mkdtemp(path.join(root,'temporary-'));t.after(async()=>{assert.equal(path.dirname(dir),root);await fs.promises.rm(dir,{recursive:true,force:true});});return dir;}
test('normal close erases complete/partial media while preserving source, annotations and preferences',async t=>{
 const dir=await fixture(t);for(const n of ['source.mp4','memory-settings.json','annotation-data'])fs.writeFileSync(path.join(dir,n),'keep');
 const m=api.createTemporaryMedia({pluginRoot:dir,query:async()=>[identity(process.pid)]});await m.ready;
 for(const leaf of ['a'.repeat(64),'.pending-'+'b'.repeat(32)]){const d=path.join(m.directory,'whole-v1',leaf);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'video.mp4'),'derived');fs.writeFileSync(path.join(d,'owner.json'),JSON.stringify({schema:'e44-whole-proxy-v1',token:'b'.repeat(32),pid:process.pid,sourceHash:'c'.repeat(64)}));}
 assert.equal((await m.close()).status,'cleared');assert(!fs.existsSync(m.directory));for(const n of ['source.mp4','memory-settings.json','annotation-data'])assert.equal(fs.readFileSync(path.join(dir,n),'utf8'),'keep');
});
test('an unclosed writer prevents deletion; its close event permits a later retry',async t=>{
 const dir=await fixture(t);let child;const m=api.createTemporaryMedia({pluginRoot:dir,query:async()=>[identity(process.pid)],spawn:()=>{child=new EventEmitter();child.pid=424242;return child;}});await m.ready;m.spawn('C:\\test\\ffmpeg.exe',[],{});
 await assert.rejects(m.close(),/仍在运行/);assert(fs.existsSync(m.directory));child.emit('close',0);await m.close();assert(!fs.existsSync(m.directory));
});
test('unknown files stop cleanup without partially deleting known media',async t=>{
 const dir=await fixture(t),m=api.createTemporaryMedia({pluginRoot:dir,query:async()=>[identity(process.pid)]});await m.ready;fs.writeFileSync(path.join(m.directory,'unrelated.txt'),'keep');await assert.rejects(m.close(),/未知文件/);assert(fs.existsSync(path.join(m.directory,'session.json')));assert.equal(fs.readFileSync(path.join(m.directory,'unrelated.txt'),'utf8'),'keep');
});
test('startup reclaims a proved-dead session, preserving live, unknown and surviving child owners',async t=>{
 const dir=await fixture(t),parent=path.join(dir,'cache/sessions-v1');fs.mkdirSync(parent,{recursive:true});
 const specs=[['a',identity(80001),[],true],['b',identity(process.pid),[],false],['c',null,[],false],['d',identity(80004),[{state:'running',identity:identity(80005)}],false]];
 for(const [n,owner,children] of specs){const d=path.join(parent,n.repeat(32));fs.mkdirSync(d);fs.writeFileSync(path.join(d,'session.json'),JSON.stringify({owner:api._test.OWNER,id:n.repeat(32),processIdentity:owner,children}));}
 const m=api.createTemporaryMedia({pluginRoot:dir,query:async()=>[identity(process.pid),identity(80005)]});const r=await m.ready;assert.equal(r.recovery.filter(x=>x.status==='removed').length,1);for(const [n,,,gone] of specs)assert.equal(fs.existsSync(path.join(parent,n.repeat(32))),!gone);await m.close();
});
test('a crash after directory claim resumes cleanup from retiring namespace',async t=>{
 const dir=await fixture(t),id='f'.repeat(32),d=path.join(dir,'cache/sessions-v1','retiring-'+id);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'session.json'),JSON.stringify({owner:api._test.OWNER,id,processIdentity:identity(80001),children:[]}));
 const m=api.createTemporaryMedia({pluginRoot:dir,query:async()=>[identity(process.pid)]});await m.ready;assert(!fs.existsSync(d));await m.close();
});
test('1 GB is cumulative decimal consent, with physical reserve and internal upper bound',()=>{
 assert.equal(space.allowance({used:600000000,free:10*1024**3}),400000000);
 assert.equal(space.allowance({used:1000000000,free:10*1024**3}),0);
 assert.equal(space.allowance({used:1000000000,free:10*1024**3,consented:true}),8*1024**3);
 assert.equal(space.allowance({used:0,free:space.PHYSICAL_RESERVE-1,consented:true}),0);
 assert.equal(space.allowance({used:0,free:1000*1024**3,consented:true}),space.MAX_BYTES);
});
test('concurrent windows reserve against each other before writing and release their allowance',async t=>{
 const dir=await fixture(t),query=async()=>[identity(process.pid)];const a=api.createTemporaryMedia({pluginRoot:dir,query}),b=api.createTemporaryMedia({pluginRoot:dir,query});await Promise.all([a.ready,b.ready]);
 const readFree=async()=>3*1024**3;
 const [ra,rb]=await Promise.all([a.reserve({used:0,readFree}),b.reserve({used:0,readFree})]);assert(ra.bytes+rb.bytes<=1024**3);assert(ra.bytes>0&&rb.bytes>0);
 await Promise.all([ra.release(),rb.release()]);await Promise.all([a.close(),b.close()]);assert(!fs.existsSync(path.join(dir,'cache/sessions-v1/capacity.lock')));
});
