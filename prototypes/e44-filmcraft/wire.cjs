'use strict';
// Bounded incremental framing: each incoming pixel byte is copied once.
class PacketReader {
  constructor(receive){this.receive=receive;this.reset();}
  reset(){this.prefix=Buffer.alloc(8);this.offset=0;this.body=null;this.headerBytes=0;}
  push(chunk){
    let at=0;
    while(at<chunk.length){
      const dest=this.body||this.prefix,n=Math.min(dest.length-this.offset,chunk.length-at);
      chunk.copy(dest,this.offset,at,at+n);this.offset+=n;at+=n;
      if(this.offset!==dest.length)continue;
      if(!this.body){
        const h=this.prefix.readUInt32LE(0),p=this.prefix.readUInt32LE(4);
        if(h<2||h>8192||p>64*1024*1024)throw Error('Invalid native packet');
        this.headerBytes=h;this.body=Buffer.allocUnsafe(h+p);this.offset=0;
      }else{
        const body=this.body,h=this.headerBytes,header=JSON.parse(body.subarray(0,h).toString());
        this.reset();this.receive(header,body.subarray(h));
      }
    }
  }
}
module.exports={PacketReader};
