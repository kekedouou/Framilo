'use strict';
// Read-only, loopback-only development host. Never loads app.js, Eagle or media services.
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..'), plugin = path.join(root, 'plugin');
const output = path.join(root, 'verification-runs/e52/frontend');
const modules = ['session.cjs','drawing-session.cjs','drawing-model.js','drawing-erase.js','preview-profile.cjs','proxy-encoding.cjs','preferences.cjs','load-decisions.cjs','frame-index.cjs'];
function bundle() {
  return `window.PreviewModules=(()=>{const factories={${modules.map(name => `${JSON.stringify(name)}:(require,module,exports)=>{\n${fs.readFileSync(path.join(plugin,name),'utf8')}\n}`).join(',')}};const cache={};
    const deny=new Proxy({}, {get:()=>()=>{throw Error('预览禁止文件访问')}});
    const normalize=p=>'/'+p.split('/').filter(Boolean).reduce((a,x)=>{if(x==='..')a.pop();else if(x!=='.')a.push(x);return a;},[]).join('/');
    const equal=(a,b)=>a===b||!!a&&!!b&&typeof a==='object'&&typeof b==='object'&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
    const builtins={fs:deny,os:{totalmem:()=>8*1024**3},path:{resolve:(...p)=>normalize(p.join('/')),join:(...p)=>normalize(p.join('/'))},crypto:{randomUUID:()=>crypto.randomUUID()},util:{isDeepStrictEqual:equal}};
    function load(name){if(builtins[name])return builtins[name];name=name.replace(/^\.\\//,'');if(!factories[name])throw Error('预览模块不允许：'+name);if(!cache[name]){const m=cache[name]={exports:{}};factories[name](load,m,m.exports);}return cache[name].exports;}return {load};})();`;
}
async function start({sampleBytes=null,writeReceipt=true}={}) {
  fs.mkdirSync(output,{recursive:true});
  const sample=path.join(output,'sample.mp4');
  if(!sampleBytes&&!fs.existsSync(sample)) {
    const made=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','12','-an','-c:v','libx264','-preset','fast','-crf','24','-pix_fmt','yuv420p','-movflags','+faststart',sample],{timeout:60000,windowsHide:true});
    if(made.status!==0)throw Error('预览样本未生成：'+(made.stderr?.toString()||made.error));
  }
  if(sampleBytes?(!Buffer.isBuffer(sampleBytes)||sampleBytes.length>16*1024**2):(fs.lstatSync(sample).isSymbolicLink()||fs.statSync(sample).size>16*1024**2))throw Error('预览样本身份/体积不符');
  const token=crypto.randomBytes(18).toString('hex'),base='/'+token+'/';
  const html=fs.readFileSync(path.join(plugin,'index.html'),'utf8');
  const names=new Set([...html.matchAll(/(?:src|href)="([^"/]+\.(?:js|css))"/g)].map(m=>m[1]));names.delete('app.js');
  const server=http.createServer((req,res)=>{
    const origin='http://127.0.0.1:'+server.address().port;
    if(req.headers.host!==new URL(origin).host||req.headers.origin&&req.headers.origin!==origin||!['GET','HEAD'].includes(req.method)||!req.url.startsWith(base)){res.writeHead(403).end();return;}
    const name=req.url.slice(base.length).split('?')[0]||'index.html';
    let content,type='text/javascript; charset=utf-8';
    try {
      if(name==='index.html'){type='text/html; charset=utf-8';content=fs.readFileSync(path.join(plugin,'index.html'),'utf8').replace('<script src="app.js"></script>','<script src="preview-bundle.js"></script><script src="preview-player.js"></script><script src="preview-host.js"></script>');}
      else if(name==='preview-bundle.js')content=bundle();
      else if(['preview-player.js','preview-host.js'].includes(name))content=fs.readFileSync(path.join(__dirname,'preview',name));
      else if(name==='sample.mp4') {type='video/mp4';content=(sampleBytes||fs.readFileSync(sample));}
      else if(names.has(name)){type=name.endsWith('.css')?'text/css; charset=utf-8':type;content=fs.readFileSync(path.join(plugin,name));}
      else {res.writeHead(404).end();return;}
      res.setHeader('Content-Type',type);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'");
      if(type==='video/mp4'&&req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416).end();return;}const start=Number(m[1]),end=Math.min(m[2]?Number(m[2]):content.length-1,content.length-1);if(start>end){res.writeHead(416).end();return;}res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${content.length}`);content=content.subarray(start,end+1);}
      res.setHeader('Content-Length',Buffer.byteLength(content));res.end(req.method==='HEAD'?undefined:content);
    }catch(error){res.writeHead(500).end('预览资源读取失败');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const receipt={pid:process.pid,url:`http://127.0.0.1:${server.address().port}${base}`,startedAt:new Date().toISOString(),source:'production plugin/index.html + JS/CSS, browser-only media adapter',sampleSha256:crypto.createHash('sha256').update((sampleBytes||fs.readFileSync(sample))).digest('hex')};
  server.previewUrl=receipt.url;if(writeReceipt){fs.writeFileSync(path.join(output,'server.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
  return server;
}
if(require.main===module)start().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={start,bundle};
