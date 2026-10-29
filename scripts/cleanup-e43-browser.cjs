'use strict';
// Named, closed E43 scratch profiles only. Preserve raw results and media proof.
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const base=path.resolve(__dirname,'../verification-runs/e43'),receipt=path.join(base,'browser-cleanup.json');
const names=['browser-batching','browser-corrected','browser-initial','browser-light-cpu-canvas','browser-light-cpu-repeat','browser-light-first','browser-light-formal','browser-light-formal-final','browser-light-formal-verified','browser-light-load-observed','browser-target-only'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');assert(!fs.existsSync(receipt),'Existing receipt is not overwritten');
const files=[],dirs=[];
for(const name of names){const target=path.resolve(base,name);assert(path.dirname(target)===base);if(!fs.existsSync(target))continue;
 function walk(dir){assert(dir===target||dir.startsWith(target+path.sep));assert(!fs.lstatSync(dir).isSymbolicLink());for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name),st=fs.lstatSync(f);assert(!st.isSymbolicLink());if(st.isDirectory())walk(f);else files.push({file:f,bytes:st.size,ino:st.ino,dev:st.dev,sha256:hash(fs.readFileSync(f))});}dirs.push(dir);}walk(target);
}
const record={status:'verified',at:new Date().toISOString(),scope:'E43 owned closed browser profiles; source/results retained',bytes:files.reduce((n,f)=>n+f.bytes,0),files:files.map(f=>({...f,file:path.relative(base,f.file)}))};fs.writeFileSync(receipt,JSON.stringify(record,null,2),{flag:'wx'});
for(const f of files){const st=fs.lstatSync(f.file);assert(!st.isSymbolicLink()&&st.ino===f.ino&&st.dev===f.dev&&st.size===f.bytes&&hash(fs.readFileSync(f.file))===f.sha256);fs.unlinkSync(f.file);}for(const dir of dirs)fs.rmdirSync(dir);
record.status='completed';fs.writeFileSync(receipt,JSON.stringify(record,null,2));console.log(JSON.stringify({status:record.status,bytes:record.bytes,files:files.length}));
