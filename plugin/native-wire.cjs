'use strict';
// Bounded incremental framing: each incoming pixel byte is copied once.
class PacketReader {
  constructor(receive,accept=()=>true){this.receive=receive;this.accept=accept;this.reset();}
  reset(){this.prefix=Buffer.alloc(8);this.offset=0;this.header=null;this.pixels=null;this.stage='prefix';this.skipped=false;this.pixelBytes=0;}
  push(chunk){
    let at=0;
    while(at<chunk.length){
      if(this.stage==='pixels'){
        // Cancellation may arrive midway through a large 4K packet. Drain its
        // bytes without retaining/copying an obsolete image or breaking framing.
        if(!this.skipped&&!this.accept(this.header)){this.skipped=true;this.pixels=null;}
        const n=Math.min(this.pixelBytes-this.offset,chunk.length-at);if(this.pixels)chunk.copy(this.pixels,this.offset,at,at+n);this.offset+=n;at+=n;
        if(this.offset===this.pixelBytes)this.deliver();continue;
      }
      const dest=this.prefix,n=Math.min(dest.length-this.offset,chunk.length-at);
      chunk.copy(dest,this.offset,at,at+n);this.offset+=n;at+=n;if(this.offset!==dest.length)continue;
      if(this.stage==='prefix'){
        const h=this.prefix.readUInt32LE(0),p=this.prefix.readUInt32LE(4);
        if(h<2||h>8192||p>64*1024*1024)throw Error('Invalid native packet');
        this.pixelBytes=p;this.prefix=Buffer.allocUnsafe(h);this.offset=0;this.stage='header';
      }else{
        this.header=JSON.parse(this.prefix.toString());this.prefix=null;this.offset=0;this.stage='pixels';this.skipped=!this.accept(this.header);
        if(!this.skipped)this.pixels=Buffer.allocUnsafe(this.pixelBytes);if(this.pixelBytes===0)this.deliver();
      }
    }
  }
  deliver(){const header=this.header,pixels=this.pixels||Buffer.alloc(0);this.reset();this.receive(header,pixels);}
}
module.exports={PacketReader};
