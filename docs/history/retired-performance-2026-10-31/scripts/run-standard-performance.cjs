'use strict';
// A reusable, explicitly invoked fixed profile. Does not accept a baseline or optimize.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),file=path.join(root,'artifacts/performance/standard-profile.json');
const digest=p=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256'),s=fs.createReadStream(p);s.on('data',b=>h.update(b));s.on('error',reject);s.on('end',()=>resolve(h.digest('hex')));});
async function main(args=process.argv.slice(2)){
 const value=k=>args[args.indexOf(k)+1];
 if(args.includes('--init')){
  if(!args.includes('--source')||!args.includes('--tools'))throw Error('建组须显式指定已有视频与工具配置');
  const source=path.resolve(value('--source')),tools=path.resolve(value('--tools')),quality=args.includes('--quality')?value('--quality'):'720p',ramBytes=512*1024**2;
  if(!['720p','1080p','1440p'].includes(quality))throw Error('画质无效');
  const profile={version:1,source,sourceHash:await digest(source),tools,toolsHash:await digest(tools),quality,ramBytes,backend:'proxy',
    protocol:'isolated-ready-v2',limits:{seconds:600,generatedBytes:512*1024**2},note:'先完成独立代理，再按固定顺序准备同一组位置。OS缓存及全机负载不能声称固定。'};
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(profile,null,2),{flag:'wx'});console.log('固定测试配置已登记，尚未运行：'+file);return;
 }
 if(!args.includes('--run'))throw Error('用法：--init --source <已有视频> --tools <配置> [--quality 720p]；或 --run');
 const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.size>65536)throw Error('测试配置身份异常');
 const profile=JSON.parse(fs.readFileSync(file,'utf8'));
 if(profile.version!==1||profile.protocol!=='isolated-ready-v2'||profile.sourceHash!==await digest(profile.source)||profile.toolsHash!==await digest(profile.tools))throw Error('视频或工具配置与固定测试组不一致，未运行');
 await require('./run-performance.cjs').main(['--fixed-v2','--source',profile.source,'--tools',profile.tools,'--quality',profile.quality,'--ram-bytes',String(profile.ramBytes)]);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
