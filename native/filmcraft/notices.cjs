'use strict';
// Collect licenses for the locked, normal Windows platform dependency closure.
// This deliberately includes build/proc-macro packages present in cargo tree as well.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../../verification-runs/e44');
const source=path.resolve(process.argv[2]||path.join(root,'filmcraft-source/filmcraft-176e6a9c585fd29e4b18d691663fe88a936c5b37'));
const output=process.argv[3]||path.resolve(__dirname,'../../plugin/bin');
const treeBytes=fs.readFileSync(path.join(root,'filmcraft-test/native-cargo-tree.txt'));
const tree=(treeBytes[0]===0xff&&treeBytes[1]===0xfe?treeBytes.toString('utf16le'):treeBytes.toString('utf8')).replace(/^\uFEFF/,'');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const cargo=path.join(root,'filmcraft-tools/cargo'),registries=fs.readdirSync(path.join(cargo,'registry/src')).map(x=>path.join(cargo,'registry/src',x));
const git=path.join(cargo,'git/checkouts'),manifests=[];
function findManifests(dir,depth=0){if(depth>7)return;for(const f of fs.readdirSync(dir,{withFileTypes:true})){if(f.name==='.git'||f.name==='target')continue;const p=path.join(dir,f.name);if(f.isDirectory())findManifests(p,depth+1);else if(f.name==='Cargo.toml')manifests.push(p);}}
findManifests(git);findManifests(path.join(source,'crates'));
const byName=new Map();for(const file of manifests){const text=fs.readFileSync(file,'utf8'),section=text.split('[package]')[1]?.split(/^\[/m)[0];const name=section?.match(/^name\s*=\s*"([^"]+)"/m)?.[1];if(name)byName.set(name,path.dirname(file));}
const entries=new Map();for(const line of tree.split(/\r?\n/)){const m=line.match(/^([\w-]+) v([^ |]+).*\|(.+)$/);if(m)entries.set(m[1]+'@'+m[2],{name:m[1],version:m[2],license:m[3].replace(/ \(\*\)$/,'')});}
if(entries.size<2||![...entries.values()].some(p=>p.name==='filmcraft-platform'))throw Error('Dependency tree is empty or malformed');
const texts=new Map(),packages=[];
for(const item of entries.values()){
 let dir=registries.map(r=>path.join(r,item.name+'-'+item.version)).find(p=>fs.existsSync(p));
 dir=dir||byName.get(item.name);if(!dir)throw Error('Dependency source not found: '+item.name);
 const files=[];let cursor=dir;
 for(let depth=0;depth<6&&(cursor.startsWith(root)||cursor.startsWith(source));depth++){
  for(const entry of fs.readdirSync(cursor,{withFileTypes:true})){
   if(!/^(licen[cs]e|copying|notice)(\b|[-_.])/i.test(entry.name))continue;
   const file=path.join(cursor,entry.name);
   if(entry.isDirectory())for(const child of fs.readdirSync(file)){const p=path.join(file,child);if(fs.statSync(p).isFile())files.push(p);}
   else files.push(file);
  }
  if(files.length)break;cursor=path.dirname(cursor);
 }
 // Symphonia's crates.io packages omit the workspace-root LICENSE file. Retain the
 // original MPL text fetched from the exact package VCS revision, never substitute another license.
 if(!files.length&&item.name.startsWith('symphonia'))files.push(path.join(__dirname,'licenses/Symphonia-MPL-2.0.txt'));
 if(!files.length)throw Error('License texts not found: '+item.name);
 const ids=[];for(const file of files){const content=fs.readFileSync(file,'utf8');if(content.length>1024*1024)throw Error('Unexpected license size');const id=sha(content);texts.set(id,content);ids.push(id);}
 const sourceUrl=item.name.startsWith('filmcraft-')?'https://github.com/storytold/filmcraft/tree/176e6a9c585fd29e4b18d691663fe88a936c5b37':
  item.name.startsWith('craft-')?'https://github.com/storytold/craft-libs/tree/92d392cff132eaf53e13afff77f38b5c11b73aa0':'https://crates.io/crates/'+item.name+'/'+item.version;
 packages.push({...item,source:sourceUrl,licenseTexts:ids});
}
const header='Eagle FilmCraft native media bridge — dependency notices\n\nSource packages are unmodified except the two documented FilmCraft bridge hooks.\nThe exact source and full license text for each dependency are identified below.\nFor MPL-2.0 components, the corresponding unmodified source is available at the package source URL (Download at crates.io).\nNo editor branding, fonts or UI assets are bundled by this bridge. Upstream NOTICE is retained separately.\n\n';
const index=packages.map(p=>p.name+' '+p.version+' | '+p.license+'\nSource: '+p.source+'\nLicense texts: '+p.licenseTexts.join(', ')).join('\n\n');
const body=[...texts].map(([id,text])=>'\n\n===== LICENSE TEXT '+id+' =====\n'+text).join('');
fs.writeFileSync(path.join(output,'filmcraft-third-party.txt'),header+index+body);
fs.writeFileSync(path.join(output,'filmcraft-third-party.json'),JSON.stringify({upstreamCommit:'176e6a9c585fd29e4b18d691663fe88a936c5b37',packages},null,2));
console.log(JSON.stringify({packages:packages.length,uniqueTexts:texts.size,bytes:Buffer.byteLength(header+index+body)}));
