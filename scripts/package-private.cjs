'use strict';
// Explicit local snapshots and store-review bundles. No installation or publishing.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {spawnSync}=require('child_process'),pack=require('./package-release.cjs');
const ROOT=path.resolve(__dirname,'..'),DIST=path.join(ROOT,'dist'),BUDGET=256*1024**2;
const RUNTIME=pack.NATIVE_RUNTIME,ID='EVAVIDEOANALYSIS20261011';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function git(args){const r=spawnSync('git',args,{cwd:ROOT,windowsHide:true,maxBuffer:64*1024**2});if(r.error||r.status!==0)throw Error('Git source unavailable: '+args.slice(0,2).join(' '));return r.stdout;}
function safe(file,dir=false){const s=fs.lstatSync(file);assert(!s.isSymbolicLink()&&(dir?s.isDirectory():s.isFile())&&fs.realpathSync(file).toLowerCase()===path.resolve(file).toLowerCase()&&(dir||s.nlink===1),'Unsafe package path');return s;}
function read(file){const s=safe(file);assert(s.size<=pack.NATIVE_LIMIT,'Oversize package input');const b=fs.readFileSync(file),after=safe(file);assert.equal(s.ino,after.ino);assert.equal(s.mtimeMs,after.mtimeMs);assert.equal(b.length,s.size);return b;}
function inventory(dir){safe(dir,true);const out=[];for(const n of fs.readdirSync(dir)){const f=path.join(dir,n),s=fs.lstatSync(f);assert(!s.isSymbolicLink(),'Links refused');if(s.isDirectory())out.push(...inventory(f).map(p=>n+'/'+p));else{safe(f);out.push(n);}}return out.sort();}
function manifestCheck(m){assert.equal(m.id,ID);assert.equal(m.platform,'win');assert.equal(m.arch,'x64');assert(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(m.version));}
function packageIdentity(version,commit,profile='private'){
 assert(['private','store-review'].includes(profile),'Unknown package profile');assert(/^[a-f0-9]{40}$/.test(commit));
 const review=profile==='store-review';if(review)assert(/^\d+\.\d+\.\d+$/.test(version),'Review package requires a formal version');
 return {schema:review?'framilo-review-package-v1':'framilo-private-package-v1',basename:'framilo-'+version+(review?'-store-review.1':'')+'-'+commit.slice(0,7)+'-win-x64',...(review?{stage:'store-review',reviewRound:1,storeSubmissionApproved:false}:{})};
}
function checkFiles(files,info){
 assert(['framilo-private-package-v1','framilo-review-package-v1'].includes(info.schema));assert.equal(info.pluginId,ID);assert(/^[a-f0-9]{40}$/.test(info.sourceCommit));
 if(info.schema==='framilo-review-package-v1'){assert.equal(info.stage,'store-review');assert.equal(info.reviewRound,1);assert.equal(info.storeSubmissionApproved,false);assert(/^\d+\.\d+\.\d+$/.test(info.version));}
 assert.equal(info.publicRelease,false);assert.equal(info.longTermAccepted,false);
 assert.deepStrictEqual(Object.keys(files).sort(),[...RUNTIME,'README.md'].sort());
 assert.deepStrictEqual(Object.keys(info.files).sort(),Object.keys(files).sort());
 for(const[n,b]of Object.entries(files)){assert(Buffer.isBuffer(b));assert.equal(info.files[n].bytes,b.length);assert.equal(info.files[n].sha256,sha(b),'Changed file: '+n);if(/\.(?:js|cjs|cs|json|html|css|md|exe)$/.test(n))pack.scanText(b,n);}
 const m=JSON.parse(files['manifest.json']);manifestCheck(m);assert.equal(m.version,info.version);
 return pack.validateRuntime(Object.fromEntries(RUNTIME.map(n=>[n,files[n]])),{profile:'native-experience',version:info.version});
}
function ps(code,env){const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; "+code],{cwd:ROOT,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1024**2,env:{...process.env,...env}});if(r.error||r.status!==0)throw Error('Archive operation failed: '+(r.error?.message||r.stderr));return r.stdout.trim().replace(/^\uFEFF/,'');}
function withinDist(folder){folder=path.resolve(folder);assert(path.dirname(folder)===DIST&&/^framilo-[\w.-]+-win-x64$/.test(path.basename(folder)),'Expected an explicit Framilo snapshot inside dist');safe(DIST,true);safe(folder,true);return folder;}
function verify(folder){
 folder=withinDist(folder);const info=JSON.parse(read(path.join(folder,'BUILD-INFO.json')));
 assert.equal(path.basename(folder),packageIdentity(info.version,info.sourceCommit,info.schema==='framilo-review-package-v1'?'store-review':'private').basename);
 assert.deepStrictEqual(inventory(folder),[...RUNTIME,'README.md','BUILD-INFO.json'].sort());
 const files=Object.fromEntries([...RUNTIME,'README.md'].map(n=>[n,read(path.join(folder,n))])),checked=checkFiles(files,info);
 const zip=folder+'.zip',archive=read(zip);assert.equal(read(zip+'.sha256').toString(),sha(archive)+'  '+path.basename(zip)+'\n');
 const rows=JSON.parse(ps("$z=[IO.Compression.ZipFile]::OpenRead($env:FRAMILO_ZIP);try{$rows=@(foreach($e in $z.Entries){if($e.Length -gt 67108864){throw 'Oversize entry'};$s=$e.Open();$h=[Security.Cryptography.SHA256]::Create();try{[pscustomobject]@{name=$e.FullName;bytes=$e.Length;sha256=[BitConverter]::ToString($h.ComputeHash($s)).Replace('-','').ToLowerInvariant()}}finally{$s.Dispose();$h.Dispose()}});ConvertTo-Json -InputObject $rows -Compress}finally{$z.Dispose()}",{FRAMILO_ZIP:zip}));
 const expected=Object.entries({...files,'BUILD-INFO.json':read(path.join(folder,'BUILD-INFO.json'))}).map(([name,b])=>({name:name.replace(/\\/g,'/'),bytes:b.length,sha256:sha(b)}));
 assert.deepStrictEqual(rows.map(r=>({...r,name:r.name.replace(/\\/g,'/')})).sort((a,b)=>a.name.localeCompare(b.name)),expected.sort((a,b)=>a.name.localeCompare(b.name)),'Archive differs from snapshot');
 return {version:info.version,sourceCommit:info.sourceCommit,...(info.stage?{stage:info.stage,reviewRound:info.reviewRound,storeSubmissionApproved:false}:{}),folder:path.relative(ROOT,folder).replace(/\\/g,'/'),zipSha256:sha(archive),zipBytes:archive.length,...checked,archiveGenerated:true,archiveVerified:true,realEagleAccepted:false,longTermAccepted:false};
}
function build(ref='HEAD',profile='private'){
 assert.equal(process.platform,'win32');assert(!/^c:/i.test(ROOT));safe(ROOT,true);
 assert(!git(['status','--porcelain','--untracked-files=all']).toString().trim(),'Commit the reviewed source bundle first');
 assert(/^(?:HEAD|[a-f0-9]{7,40})$/.test(ref),'Use HEAD or an explicit commit');
 const commit=git(['rev-parse',ref+'^{commit}']).toString().trim(),commitTime=git(['show','-s','--format=%cI',commit]).toString().trim();
 const tracked=new Set(git(['ls-tree','-r','--name-only',commit,'plugin']).toString().trim().split(/\r?\n/));
 const files={};
 for(const n of RUNTIME){const source='plugin/'+n;files[n]=tracked.has(source)?git(['show',commit+':'+source]):read(path.join(ROOT,source));}
 // Only the ignored guard pair may come from the local build, and its exact
 // source/executable hashes are validated by validateRuntime before packaging.
 for(const n of RUNTIME)assert(tracked.has('plugin/'+n)||/^native\/task-host\.local\.(exe|json)$/.test(n),'Unversioned runtime input: '+n);
 const m=JSON.parse(files['manifest.json']);manifestCheck(m);
 const identity=packageIdentity(m.version,commit,profile);
 files['README.md']=Buffer.from('Framilo · 个人使用快照\n版本：'+m.version+'\n来源：'+commit+'\n\n完整解压到独立的非C盘可写目录，再通过Eagle载入本地插件。\n本包不公开发行，实际宿主体验以当前验收记录为准。需要Eagle的FFmpeg模块；无需安装Rust或Node.js。\n升级前关闭播放器。保留原目录的memory-settings.json和annotation-data，不移动或覆盖Eagle素材库。\n回退只恢复本插件程序文件；不要删除用户偏好、标注、未知文件或活动缓存。\n相同插件ID不能同时注册两个入口；不要将回退目录当第二个插件同时运行。\n回退版本不支持的新功能和偏好可能无法使用；Git回退不能撤销Eagle标注写入。\n首次在新目录使用可能需要重新生成缓存；正常关闭清理本窗口临时媒体。\n\n第三方许可在bin目录。项目整体开源许可证未指定，本包不授予新许可。\n');
 if(profile==='store-review')files['README.md']=Buffer.from(files['README.md'].toString().replace('Framilo · 个人使用快照','Framilo '+m.version+' · 首轮上架前审查包').replace('本包不公开发行，实际宿主体验以当前验收记录为准。','本包供整体提交审查；不代表已获准上架或最终以此版本上架，尚未公开发行。\n已通过本轮集中验收；NOTE-02系统候选框残留仍未修复，用户接受本阶段暂缓；重启后候选框恢复不算代码修复。\n本ZIP是本地审查快照，不是Eagle导出的.eagleplugin商店安装包。实际宿主体验以当前验收记录为准。'));
 const {basename,...identityInfo}=identity;
 const info={...identityInfo,version:m.version,sourceCommit:commit,commitTime,pluginId:ID,publicRelease:false,longTermAccepted:false,files:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,{bytes:b.length,sha256:sha(b)}]))};checkFiles(files,info);
 if(!fs.existsSync(DIST))fs.mkdirSync(DIST);safe(DIST,true);
 const used=inventory(DIST).reduce((n,p)=>n+safe(path.join(DIST,p)).size,0),size=Object.values(files).reduce((n,b)=>n+b.length,0);assert(used+size*2+1024**2<=BUDGET,'Private snapshot budget exceeded');
 const folder=path.join(DIST,basename);
 assert(!fs.existsSync(folder)&&!fs.existsSync(folder+'.zip')&&!fs.existsSync(folder+'.zip.sha256'),'Snapshot exists; verify instead of overwriting');
 fs.mkdirSync(folder);for(const[n,b]of Object.entries({...files,'BUILD-INFO.json':Buffer.from(JSON.stringify(info,null,2)+'\n')})){const f=path.join(folder,n);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b,{flag:'wx'});}
 ps('[IO.Compression.ZipFile]::CreateFromDirectory($env:FRAMILO_FOLDER,$env:FRAMILO_ZIP,[IO.Compression.CompressionLevel]::Optimal,$false)',{FRAMILO_FOLDER:folder,FRAMILO_ZIP:folder+'.zip'});
 fs.writeFileSync(folder+'.zip.sha256',sha(read(folder+'.zip'))+'  '+path.basename(folder)+'.zip\n',{flag:'wx'});
 return verify(folder);
}
if(require.main===module){const mode=process.argv[2];assert(['build','build-review','verify'].includes(mode)&&process.argv.length<=4);console.log(JSON.stringify(mode==='verify'?verify(process.argv[3]):build(process.argv[3],mode==='build-review'?'store-review':'private'),null,2));}
module.exports={build,verify,checkFiles,manifestCheck,packageIdentity,RUNTIME};
