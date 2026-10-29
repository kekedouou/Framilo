/* Isolated Eagle test adapter for actual, compiled FilmCraft crates. */
(function(){
  'use strict'; if(typeof require!=='function')return;
  const fs=require('fs'),path=require('path'),crypto=require('crypto'),{fileURLToPath,pathToFileURL}=require('url');
  let here=location.protocol==='file:'?path.dirname(fileURLToPath(location.href.split('?')[0])):null;
  if(globalThis.eagle?.onPluginCreate)eagle.onPluginCreate(plugin=>{here=plugin.path;});
  const button=document.getElementById('filmcraft'),status=document.getElementById('status');
  const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  button.onclick=async()=>{
    if(!here)return;button.disabled=true;document.getElementById('run').disabled=true;
    const old=globalThis.E44Worker;
    try{
      const root=path.resolve(here,'../../verification-runs/e44'),profile=JSON.parse(fs.readFileSync(path.join(root,'profile.json'))),indexFile=path.join(root,'source-index.json');
      if(hash(profile.source)!==profile.sourceHash||hash(indexFile)!==profile.indexHash)throw Error('Source/index identity changed');
      const index=JSON.parse(fs.readFileSync(indexFile)),exe=path.join(root,'filmcraft-tools/target/release/examples/e44_bridge.exe');
      const {FilmcraftClient}=require(path.resolve(here,'../e44-filmcraft/client.cjs'));
      const canvas=document.createElement('canvas');let context=canvas.getContext('2d',{alpha:false});
      globalThis.E44Worker={async create({draw,blank,hardware}){
        return FilmcraftClient.create({exe,source:profile.source,index,software:hardware==='prefer-software',blank,
          draw(bytes,h){if(canvas.width!==h.width||canvas.height!==h.height){canvas.width=h.width;canvas.height=h.height;}
            context.putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer,bytes.byteOffset,bytes.length),h.width,h.height),0,0);draw(canvas,h.ptsTicks/254016);}});
      }};
      const name='eagle-filmcraft-'+Date.now()+'.json',output=path.join(root,'filmcraft-test',name);
      await E44Gate.run({index,url:pathToFileURL(profile.source).href,label:name,rounds:3,preferences:['prefer-hardware'],
        host:{kind:'real-Eagle-isolated-filmcraft',upstream:'176e6a9c585fd29e4b18d691663fe88a936c5b37',exeHash:hash(exe),versions:process.versions,pid:process.pid,
          scope:'upstream native demux/decode/GOP cache; test-only stdio adapter; 384MiB upstream cache; box decimation to 720p; CPU image submission'},
        save:async result=>{const data=JSON.stringify(result,null,2);if(data.length>4*1024**2)throw Error('Evidence bound');await fs.promises.writeFile(output+'.next',data);await fs.promises.rename(output+'.next',output);},
        onStatus:text=>{status.textContent='FilmCraft · '+text;}});
      status.textContent='FilmCraft测试完成 · '+name;
    }catch(e){status.textContent='FilmCraft未通过 · '+e.message;}
    finally{globalThis.E44Worker=old;button.disabled=false;document.getElementById('run').disabled=false;}
  };
})();
