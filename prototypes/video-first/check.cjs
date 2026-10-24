'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const root=__dirname;
function run(args){const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:15000});if(result.status!==0)throw Error(result.stderr||result.error?.message||'Check failed');return result.stdout;}
const sources=fs.readdirSync(root).filter(name=>/\.(js|cjs)$/.test(name));
for(const file of sources)run(['--check',path.join(root,file)]);
for(const name of ['index.html','lab.html','baseline.html']){
  const html=fs.readFileSync(path.join(root,name),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,'Duplicate IDs in '+name);
  for(const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)){assert(!/^(?:https?:|\/\/)/.test(m[1]),'External asset');assert(fs.existsSync(path.join(root,m[1])),'Missing asset: '+m[1]);}
}
for(const name of ['app.js','model.js','scene.js','lab.js'])assert(!/\b(?:fetch|XMLHttpRequest|sendBeacon|eagle)\s*[.(]/.test(fs.readFileSync(path.join(root,name),'utf8')),'Host or network API in prototype: '+name);
process.stdout.write(run([path.join(root,'model.test.cjs')]));process.stdout.write(run([path.join(root,'lab.test.cjs')]));
console.log('Prototype syntax: '+sources.length+' scripts; 3 HTML entries, local assets and no-host/no-network frontend boundaries passed. Browser verification is separate.');
