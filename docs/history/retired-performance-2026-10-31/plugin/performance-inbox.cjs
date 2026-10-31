'use strict';
// One pending pointer per kind. Only complete, verified observations are admitted.
const fs=require('fs').promises,path=require('path');
const kinds=['standard','manual'],valid=id=>typeof id==='string'&&/^[\w-]+$/.test(id);
async function eligible(root,id,kind){
 try{if(!valid(id))return false;const dir=path.join(root,'runs',id);await require('./performance-report.cjs').validate(dir);const m=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));return m.mode===kind;}catch(_){return false;}
}
async function read(root){
 const file=path.join(root,'pending.json');
 try{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>16384)throw Error('待分析索引异常');const v=JSON.parse(await fs.readFile(file,'utf8'));if(v.version!==1||!Number.isSafeInteger(v.revision)||!v.slots||kinds.some(k=>v.slots[k]!==null&&!valid(v.slots[k])))throw Error('待分析索引格式无效');for(const k of kinds)if(v.slots[k]&&!await eligible(root,v.slots[k],k))v.slots[k]=null;return v;}
 catch(e){if(e.code!=='ENOENT')throw e;}
 const v={version:1,revision:0,slots:{standard:null,manual:null}};
 const names=(await fs.readdir(path.join(root,'runs')).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).sort().reverse();
 for(const id of names){if(!valid(id))continue;try{const m=JSON.parse(await fs.readFile(path.join(root,'runs',id,'manifest.json'),'utf8'));if(kinds.includes(m.mode)&&!v.slots[m.mode]&&m.reportComplete&&m.analysis!=='complete'&&await eligible(root,id,m.mode))v.slots[m.mode]=id;}catch(_){/* unpublished or invalid runs never become pending */}}
 return v;
}
async function replace(root,kind,id,expected){
 if(!kinds.includes(kind)||(id!==null&&!valid(id)))throw Error('待分析记录身份无效');
 if(id!==null&&!await eligible(root,id,kind))throw Error('记录未完成或无效，不能加入待分析列表');
 await fs.mkdir(root,{recursive:true});const file=path.join(root,'pending.json'),lock=file+'.next';let owned=false;
 try{const handle=await fs.open(lock,'wx');owned=true;await handle.close();const v=await read(root);if(v.slots[kind]!==expected)throw Error('待分析记录已变化，请重新确认覆盖');v.slots[kind]=id;v.revision++;await fs.writeFile(lock,JSON.stringify(v,null,2));await fs.rename(lock,file);owned=false;return v;}
 finally{if(owned)await fs.unlink(lock).catch(()=>{});}
}
async function acknowledge(root,id){const v=await read(root);for(const k of kinds)if(v.slots[k]===id)return replace(root,k,null,id);return v;}
module.exports={read,replace,acknowledge};
