'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {REPO,identity,sha,store}=require('./workspace.cjs');
function prepare(){
  const original=path.join(REPO,'plugin'),parent=path.join(__dirname,'scratch');if(!fs.existsSync(parent))fs.mkdirSync(parent);identity(parent,true);
  const root=path.join(parent,'host');let old=null;
  if(fs.existsSync(root)){
    identity(root,true);if(fs.existsSync(path.join(root,'cache'))||fs.existsSync(path.join(root,'memory-settings.json')))throw Error('Evolution host already used; retained');
    old=JSON.parse(fs.readFileSync(path.join(root,'owner.json')));
    if(old.schema!=='eva-evolution-host-v1'||old.realEagleLoaded!==false)throw Error('Existing host ownership invalid');
    for(const x of old.files){const f=path.join(root,x.file);identity(f);if(sha(fs.readFileSync(f))!==x.sha256)throw Error('Existing experimental host changed');}
    if(sha(fs.readFileSync(path.join(root,'index.html')))!==old.indexSha256||sha(fs.readFileSync(path.join(root,'manifest.json')))!==old.manifestSha256)throw Error('Existing entry changed');
  }
  const files=['app.js','cache.cjs','diagnostics.cjs','eagle.cjs','frame-index.cjs','frame-pack.cjs','media.cjs','player.js','preferences.cjs','process-identity.cjs',
    'session.cjs','styles.css','task-client.cjs','task-worker.cjs','ui.js','logo.png','native/task-host.cs','native/task-host.local.exe','native/task-host.local.json'];
  require('../../plugin/task-client.cjs').verifyGuard(original);
  const copies=files.map(file=>{const source=path.join(original,file);identity(source);let bytes=fs.readFileSync(source),difference=null;
    if(file==='task-worker.cjs'){const text=bytes.toString('utf8'),needle='processIdentity: identity, packFrames: true';if(text.split(needle).length!==2)throw Error('Worker boundary changed');
      bytes=Buffer.from(text.replace(needle,needle+', diskBytes: 512 * 1024 ** 2'));difference='Experimental disk budget512MiB instead of5GiB';}
    if(file==='app.js'){const text=bytes.toString('utf8'),needle="  if (typeof eagle !== 'undefined' && typeof eagle.onPluginCreate === 'function') {";
      if(text.split(needle).length!==2||text.split('  function close() {').length!==2||text.split('  function run() {').length!==2)throw Error('Lifecycle hook changed');
      const gate="\n    const extra = window.EVAEvolutionBeforeRun && window.EVAEvolutionBeforeRun();\n    if (extra) closeTask = Promise.all([closeTask, extra]).then(values => values[0]);";
      bytes=Buffer.from(text.replace(needle,"  window.EVAEvolutionClose = close;\n"+needle).replace('  function close() {','  function close() {'+gate).replace('  function run() {','  function run() {'+gate));
      difference='Test-only close/run bridge drains the comparison before ordinary reload or window close';}
    return{file,bytes,sourceSha256:sha(fs.readFileSync(source)),sha256:sha(bytes),difference};});
  const browser=fs.readFileSync(path.join(__dirname,'observer-browser.js'));copies.push({file:'observer-browser.js',bytes:browser,sourceSha256:sha(browser),sha256:sha(browser),difference:'Experimental observation/quality controls only'});
  const manifest=JSON.parse(fs.readFileSync(path.join(original,'manifest.json')));manifest.id='EVAEVOLUTION20261017';manifest.name='视频分析 · 演进验证';manifest.version='0.1.0-evolution.1';
  const bar='<script src="observer-browser.js"></script>';
  const html=fs.readFileSync(path.join(original,'index.html'),'utf8').replace('<script src="player.js">',bar+'\n  <script src="player.js">');
  if(!html.includes(bar))throw Error('Host page injection failed');
  const display=JSON.parse(fs.readFileSync(path.join(__dirname,'display.local.json')));identity(display.meta);
  if(sha(fs.readFileSync(display.meta))!==display.sha256)throw Error('Visual data changed');
  if(!old){fs.mkdirSync(root);fs.mkdirSync(path.join(root,'native'));}
  for(const x of copies){const existing=old&&old.files.find(f=>f.file===x.file);if(existing&&existing.sha256===x.sha256)continue;
    fs.writeFileSync(path.join(root,x.file),x.bytes,{flag:existing?'w':'wx'});}
  if(!old)fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
  fs.writeFileSync(path.join(root,'index.html'),html,{flag:old?'w':'wx'});
  const receipt={schema:'eva-evolution-host-v1',root:path.relative(REPO,root),files:copies.map(({bytes,...x})=>({...x,bytes:bytes.length})),
    manifestSha256:sha(fs.readFileSync(path.join(root,'manifest.json'))),indexSha256:sha(fs.readFileSync(path.join(root,'index.html'))),
    realEagleLoaded:false,observationDefault:false,diskBytes:512*1024**2,sourceFrozen:true};
  fs.writeFileSync(path.join(root,'owner.json'),JSON.stringify(receipt),{flag:old?'w':'wx'});const saved=store().save('host-prepared',receipt);
  console.log(JSON.stringify({root,manifest:manifest.name,saved,loaded:false}));return receipt;
}
if(require.main===module)prepare();module.exports={prepare};
