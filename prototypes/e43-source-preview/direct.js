/* E43 isolated feasibility gate. Not loaded by the formal player. */
(function(root){
  'use strict';
  root.createSourceExperiment=async function({index,read,hardware='no-preference',draw=()=>{}}){
    const description=Uint8Array.from(index.description),packets=index.packets;
    const config={codec:index.codec,description,codedWidth:index.width,codedHeight:index.height,hardwareAcceleration:hardware};
    if(!(await VideoDecoder.isConfigSupported(config)).supported)throw Error('Source configuration unsupported');
    let decoder,latest=null,serial=0,generation=0,next=0,group=-1,lastTarget=-1,dead=false,pumping=false,decoderError=null;
    const cache=new Map(),stats={resets:0,decoded:0,bytes:0,peakQueue:0,cacheHits:0};
    const pause=()=>new Promise(r=>setTimeout(r,0));
    const sorted=packets.map((p,n)=>({pts:p.pts,n})).sort((a,b)=>a.pts-b.pts);
    function targetAt(t){let l=0,h=sorted.length;while(l<h){const m=(l+h)>>>1;if(sorted[m].pts<=t*1e6)l=m+1;else h=m;}return sorted[Math.max(0,l-1)];}
    function resolve(request,status,extra={}){request.resolve({status,target:request.target.pts/1e6,ms:performance.now()-request.at,...extra});}
    function output(frame,g){
      if(dead||g!==generation){frame.close();return;}
      stats.decoded++;
      // Reference frames must be decoded, but do not download/draw every 4K
      // intermediate surface just to obtain a small target preview.
      if(!latest||frame.timestamp!==latest.target.pts){frame.close();return;}
      // Retain small previews only, never native 4K reference surfaces.
      const picture=new OffscreenCanvas(240,135);picture.getContext('2d').drawImage(frame,0,0,240,135);
      const pts=frame.timestamp;frame.close();cache.delete(pts);cache.set(pts,picture);
      while(cache.size>64){const key=cache.keys().next().value,old=cache.get(key);old.width=old.height=1;cache.delete(key);}
      const request=latest;
      if(request&&pts===request.target.pts){draw(picture,pts);latest=null;resolve(request,'exact',{pts});}
    }
    function reset(key){
      generation++;if(decoder&&decoder.state!=='closed')decoder.close();
      const g=generation;decoderError=null;
      decoder=new VideoDecoder({output:f=>output(f,g),error:e=>{if(g===generation){decoderError=e;if(latest){resolve(latest,'error',{error:e.message});latest=null;}}}});
      decoder.configure(config);next=key;group=key;stats.resets++;
    }
    async function pump(){
      if(pumping||dead)return;pumping=true;
      try{
        while(latest&&!dead){
          const request=latest,p=packets[request.target.n];
          const existing=cache.get(request.target.pts);
          if(existing){stats.cacheHits++;draw(existing,request.target.pts);latest=null;resolve(request,'exact',{pts:request.target.pts,cache:true});continue;}
          if(performance.now()-request.at>8000){latest=null;resolve(request,'timeout');continue;}
          if(!decoder||decoderError||group!==p.key||request.target.n<lastTarget)reset(p.key);
          lastTarget=request.target.n;
          const g=generation,end=Math.min(packets.length,request.target.n+17);
          if(next>=end){await pause();continue;}
          if(decoder.decodeQueueSize>=32){await pause();continue;}
          const start=next,stop=Math.min(end,start+32),items=packets.slice(start,stop);
          const bytes=await read(start,stop);stats.bytes+=bytes.byteLength;
          if(dead||g!==generation)continue;
          // If intent moved to a different GOP, don't queue obsolete packets.
          if(latest&&packets[latest.target.n].key!==group)continue;
          let offset=0;
          for(const item of items){decoder.decode(new EncodedVideoChunk({type:item.isKey?'key':'delta',timestamp:item.pts,data:bytes.subarray(offset,offset+item.size)}));offset+=item.size;next++;}
          stats.peakQueue=Math.max(stats.peakQueue,decoder.decodeQueueSize);
          if(next===packets.length)await decoder.flush();
        }
      }catch(error){if(latest){resolve(latest,'error',{error:error.message});latest=null;}}
      finally{pumping=false;if(latest&&!dead)pump();}
    }
    return {
      seek(t){if(dead)return Promise.resolve({status:'closed'});if(latest)resolve(latest,'superseded');return new Promise(resolve=>{latest={target:targetAt(t),resolve,at:performance.now(),id:++serial};pump();});},
      snapshot(){return {...stats,cacheFrames:cache.size,cacheBytes:cache.size*240*135*4,pending:!!latest};},
      close(){dead=true;generation++;if(latest){resolve(latest,'closed');latest=null;}if(decoder&&decoder.state!=='closed')decoder.close();for(const picture of cache.values())picture.width=picture.height=1;cache.clear();}
    };
  };
})(globalThis);
