'use strict';
// Real helper and files; process/flat probe output are controlled doubles.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {EventEmitter}=require('events'),{PassThrough}=require('stream'),{test}=require('node:test');
const {scratch}=require('./support/annotation-scratch.cjs'),{createAudioTrack,MAX_AUDIO_BYTES}=require('../plugin/native-audio.cjs');
const turn=()=>new Promise(r=>setImmediate(r));
function metadata({duration=true,offset=0,payload='a',skip=0,video=false,extra='',codec='opus',extradata='b',end=1920,size=100}={}){
 const rows=[];for(let n=0;n<2;n++){const key='packets.packet.'+n+'.';for(const [k,v]of Object.entries({pts:String(n*960+offset),dts:String(n*960+offset),...(duration?{duration:'960'}:{}),size:String(size),data_hash:'SHA256:'+payload.repeat(64)}))rows.push(key+k+'='+JSON.stringify(v));if(n===0&&skip)for(const [k,v]of Object.entries({side_data_type:'Skip Samples',skip_samples:String(skip),discard_padding:'0',skip_reason:'0',discard_reason:'0'}))rows.push(key+'side_data_list.side_data.0.'+k+'='+JSON.stringify(v));}
 for(const [k,v]of Object.entries({codec_name:codec,codec_type:'audio',sample_rate:'48000',channels:'2',channel_layout:'stereo',time_base:'1/48000',start_pts:String(offset),duration_ts:String(end),extradata_hash:'SHA256:'+extradata.repeat(64)}))rows.push('streams.stream.0.'+k+'='+JSON.stringify(v));
 if(video)rows.push('streams.stream.1.codec_type="video"');if(extra)rows.push(extra);return Buffer.from(rows.join('\n')+'\n');
}
function harness(responses){let next=100,kills=0;const calls=[];
 const spawn=(exe,args,options)=>{const entry=responses[calls.length];if(!entry)throw Error('Unexpected process');const c=new EventEmitter();c.pid=++next;c.stdin=new PassThrough();c.stdout=new PassThrough();c.stderr=new PassThrough();let closed=false;const record={exe,args,options,child:c,input:[]};calls.push(record);
  const finish=code=>{if(closed)return;closed=true;c.stdout.end();c.stderr.end();c.emit('close',code);};c.kill=()=>{kills++;setImmediate(()=>finish(-1));return true;};c.stdin.on('data',b=>record.input.push(b));
  c.stdin.on('finish',()=>setImmediate(()=>{if(closed||entry.hold)return;entry.before?.();const body=entry.data||Buffer.alloc(0);for(let i=0;i<body.length;i+=entry.chunk||body.length||1)c.stdout.write(body.subarray(i,i+(entry.chunk||body.length||1)));if(entry.stderr)c.stderr.write(entry.stderr);setImmediate(()=>finish(entry.code||0));}));return c;};
 return{spawn,calls,kills:()=>kills};
}
function fixture(responses=[{data:metadata()},{data:Buffer.from('compressed audio only')},{data:metadata({duration:false})}],maxBytes=4096){const temp=scratch('native-audio'),file=path.join(temp.root,'source.mp4');fs.writeFileSync(file,'synthetic source; never processed by real media tools');const s=fs.statSync(file),expectedStamp=[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');const h=harness(responses),options={source:{filePath:file},expectedStamp,tools:{ffmpeg:path.join(temp.root,'ffmpeg.exe'),ffprobe:path.join(temp.root,'ffprobe.exe')},maxBytes,spawn:h.spawn};return{...h,options,file,clean:()=>temp.clean()};}
test('audio-only copy verifies packets while deriving omitted fragmented durations without changing compressed data',async()=>{
 const h=fixture();try{const task=createAudioTrack(h.options),r=await task.promise;assert.equal(r.method,'audio-only-copy');assert.equal(r.mime,'audio/mp4');assert.equal(r.bytes.toString(),'compressed audio only');assert.equal(r.verification.packetCount,2);assert.deepEqual(task.pids(),[]);
  const copy=h.calls[1].args;assert.deepEqual(copy.slice(copy.indexOf('-map'),copy.indexOf('-map')+2),['-map','0:a:0']);assert(copy.includes('-vn'));assert.equal(copy[copy.indexOf('-c:a')+1],'copy');assert(!copy.includes('-c:v'));assert.equal(copy.at(-1),'pipe:1');assert(copy[copy.indexOf('-movflags')+1].includes('delay_moov'));assert(h.calls[0].args.includes('-select_streams'));assert(!h.calls[2].args.includes('-select_streams'));assert.equal(Buffer.concat(h.calls[2].input).toString(),r.bytes.toString());for(const call of h.calls){assert.equal(call.options.windowsHide,true);assert.equal(call.options.shell,false);}
 }finally{h.clean();}
});
test('flat metadata split across arbitrary tiny chunks still verifies complete packet and stream identities',async()=>{
 const h=fixture([{data:metadata({skip:312}),chunk:3},{data:Buffer.from('audio')},{data:metadata({duration:false,skip:312}),chunk:7}]);try{assert.equal((await createAudioTrack(h.options).promise).verification.packetCount,2);}finally{h.clean();}
});
for(const [name,changes]of [['payload hash',{payload:'c'}],['time mapping',{offset:1}],['codec initialization',{extradata:'c'}],['Opus preskip',{skip:312}],['extra video stream',{video:true}],['last packet boundary',{end:1919}]])test('rejects changed '+name+' instead of publishing an unconfirmed audio source',async()=>{
 const h=fixture([{data:metadata()},{data:Buffer.from('audio')},{data:metadata({duration:false,...changes})}]);try{await assert.rejects(createAudioTrack(h.options).promise,/音轨|音频/);}finally{h.clean();}
});
test('a changed source stamp invalidates an otherwise matching remux',async()=>{
 let file;const h=fixture([{data:metadata()},{data:Buffer.from('audio'),before:()=>fs.appendFileSync(file,'changed')},{data:metadata({duration:false})}]);file=h.file;try{await assert.rejects(createAudioTrack(h.options).promise,{code:'AUDIO_SOURCE_CHANGED'});}finally{h.clean();}
});
test('source mutation takes priority over a packet mismatch, so fallback cannot use the changed source',async()=>{
 let file;const h=fixture([{data:metadata()},{data:Buffer.from('audio'),before:()=>fs.appendFileSync(file,'changed')},{data:metadata({duration:false,payload:'c'})}]);file=h.file;try{await assert.rejects(createAudioTrack(h.options).promise,{code:'AUDIO_SOURCE_CHANGED'});}finally{h.clean();}
});
test('source mutation remains fatal even when the active media tool also fails',async()=>{
 let file;const h=fixture([{code:3,stderr:'source changed during probe',before:()=>fs.appendFileSync(file,'changed')}]);file=h.file;try{await assert.rejects(createAudioTrack(h.options).promise,{code:'AUDIO_SOURCE_CHANGED'});assert.equal(h.calls.length,1);}finally{h.clean();}
});
test('a vanished source cannot be treated as a recoverable remux failure',async()=>{
 let file;const h=fixture([{data:metadata()},{data:Buffer.from('audio'),before:()=>fs.renameSync(file,file+'.moved')},{data:metadata({duration:false})}]);file=h.file;try{await assert.rejects(createAudioTrack(h.options).promise,{code:'AUDIO_SOURCE_CHANGED'});}finally{h.clean();}
});
test('a source already unavailable at preparation start fails before launching a process',async()=>{
 const h=fixture();try{fs.renameSync(h.file,h.file+'.moved');await assert.rejects(createAudioTrack(h.options).promise,{code:'AUDIO_SOURCE_CHANGED'});assert.equal(h.calls.length,0);}finally{h.clean();}
});
test('stable source replacement before task start cannot attach new audio to an already indexed video',async()=>{
 const h=fixture();try{fs.writeFileSync(h.file,'stable replacement made before audio preparation begins');await assert.rejects(createAudioTrack(h.options).promise,{code:'AUDIO_SOURCE_CHANGED'});assert.equal(h.calls.length,0);}finally{h.clean();}
});
test('missing expected source identity is fatal rather than a recoverable audio-copy failure',async()=>{
 const h=fixture();try{await assert.rejects(createAudioTrack({...h.options,expectedStamp:undefined}).promise,{code:'AUDIO_SOURCE_CHANGED'});assert.equal(h.calls.length,0);}finally{h.clean();}
});
test('bounded audio stdout kills its owned process and cannot return truncated success',async()=>{
 const h=fixture([{data:metadata({size:10})},{data:Buffer.alloc(65)}],64);try{const task=createAudioTrack(h.options);await assert.rejects(task.promise,{code:'AUDIO_BUDGET'});assert.equal(h.kills(),1);assert.deepEqual(task.pids(),[]);assert.equal(h.calls.length,2);}finally{h.clean();}
});
test('source probe stops before copying once compressed packet payload alone exceeds the audio allowance',async()=>{
 const h=fixture([{data:metadata(),chunk:7}],199);try{const task=createAudioTrack(h.options);await assert.rejects(task.promise,{code:'AUDIO_BUDGET'});assert.equal(h.calls.length,1);assert.equal(h.kills(),1);assert.deepEqual(task.pids(),[]);}finally{h.clean();}
});
test('source payload exactly at its allowance still completes full content and timeline verification',async()=>{
 const h=fixture(undefined,200);try{assert.equal((await createAudioTrack(h.options).promise).verification.packetCount,2);assert.equal(h.calls.length,3);}finally{h.clean();}
});
test('metadata total/pending-line safety rejects unbounded probe output and kills only its owner',async()=>{
 const h=fixture([{data:Buffer.alloc(65537,97)}]);try{await assert.rejects(createAudioTrack(h.options).promise,{code:'AUDIO_METADATA'});assert.equal(h.kills(),1);}finally{h.clean();}
});
test('cancel kills a pending owned preparation immediately and waits for its close receipt',async()=>{
 const h=fixture([{hold:true}]);try{const task=createAudioTrack(h.options);assert.equal(task.pids().length,1);const closed=task.cancel();assert.equal(h.kills(),1);await assert.rejects(task.promise,{code:'AUDIO_CANCELLED'});await closed;assert.deepEqual(task.pids(),[]);assert.equal(h.calls.length,1);}finally{h.clean();}
});
test('abort during copying prevents validation/publication and closes the audio child',async()=>{
 const h=fixture([{data:metadata()},{hold:true}]),controller=new AbortController();try{const task=createAudioTrack({...h.options,signal:controller.signal});while(h.calls.length<2)await turn();controller.abort();assert.equal(h.kills(),1);await assert.rejects(task.promise,{code:'AUDIO_CANCELLED'});assert.deepEqual(task.pids(),[]);assert.equal(h.calls.length,2);}finally{h.clean();}
});
test('already aborted and impossible RAM budgets do not launch processes',async()=>{
 const h=fixture(),controller=new AbortController();controller.abort();try{await assert.rejects(createAudioTrack({...h.options,signal:controller.signal}).promise,{code:'AUDIO_CANCELLED'});await assert.rejects(createAudioTrack({...h.options,maxBytes:MAX_AUDIO_BYTES+1}).promise,{code:'AUDIO_OPTIONS'});assert.equal(h.calls.length,0);}finally{h.clean();}
});
test('a tool failure never proceeds to copying and preserves its bounded diagnostic',async()=>{
 const h=fixture([{code:3,stderr:'injected source probe failure'}]);try{await assert.rejects(createAudioTrack(h.options).promise,e=>e.code==='AUDIO_TOOL'&&e.message.includes('source probe failure'));assert.equal(h.calls.length,1);}finally{h.clean();}
});
test('identical but invalid skip metadata cannot pass as a verified original audio timeline',async()=>{
 const invalid=metadata({skip:-1}),h=fixture([{data:invalid}]);try{await assert.rejects(createAudioTrack(h.options).promise,{code:'AUDIO_TIMING'});assert.equal(h.calls.length,1);}finally{h.clean();}
});
