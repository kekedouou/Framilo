/* E44 native frame presentation. One source frame, explicit CPU/WebGL renderer. */
(function(root){
 'use strict';
 const MAX_DIMENSION=8192,MAX_PIXELS=16*1024*1024;
 const MATRICES=Object.freeze({
  bt709:Object.freeze({r:1.5748,gu:-0.1873242729306488,gv:-0.4681242729306488,b:1.8556}),
  bt601:Object.freeze({r:1.402,gu:-0.34413628620102216,gv:-0.7141362862010221,b:1.772})
 });
 function shape(width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>MAX_DIMENSION||height>MAX_DIMENSION||width*height>MAX_PIXELS)throw Error('原生画面尺寸无效或超过绘制上限。');
  return{width,height,pixels:width*height,chromaWidth:Math.ceil(width/2),chromaHeight:Math.ceil(height/2)};
 }
 function validate(pixels,header){
  if(!header||typeof header!=='object')throw Error('原生画面头信息缺失。');
  const dimensions=shape(header.width,header.height),format=header.pixelFormat||'rgba8';
  if(!ArrayBuffer.isView(pixels)||pixels.BYTES_PER_ELEMENT!==1)throw Error('原生画面数据必须是字节数组。');
  const bytes=new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength);
  if(format==='yuv420p'){
   if(!Object.prototype.hasOwnProperty.call(MATRICES,header.colorMatrix)||typeof header.fullRange!=='boolean')throw Error('原生YUV画面色彩矩阵或范围无效。');
   const chromaBytes=dimensions.chromaWidth*dimensions.chromaHeight;
   if(bytes.byteLength!==dimensions.pixels+2*chromaBytes)throw Error('原生YUV画面长度与尺寸不符。');
   return{...dimensions,format,bytes,chromaBytes,matrix:MATRICES[header.colorMatrix],colorMatrix:header.colorMatrix,fullRange:header.fullRange};
  }
  if(format!=='rgba'&&format!=='rgba8')throw Error('不支持的原生画面像素格式。');
  if(bytes.byteLength!==dimensions.pixels*4)throw Error('原生RGBA画面长度与尺寸不符。');
  return{...dimensions,format:'rgba8',bytes};
 }
 function transform(colorMatrix,fullRange){
  const m=MATRICES[colorMatrix];if(!m||typeof fullRange!=='boolean')throw Error('YUV色彩参数无效。');
  const y=fullRange?1:255/219,c=fullRange?1:255/224;
  return{offset:new Float32Array([fullRange?0:16/255,128/255,128/255]),matrix:new Float32Array([y,y,y,0,m.gu*c,m.b*c,m.r*c,m.gv*c,0])};
 }
 const clamp=value=>Math.max(0,Math.min(255,Math.round(value)));
 function convertInto(frame,output){
  if(!output||output.length!==frame.pixels*4)throw Error('RGBA输出缓冲区长度无效。');
  if(frame.format==='rgba8'){output.set(frame.bytes);return output;}
  const {bytes,width,height,pixels,chromaBytes,chromaWidth,matrix:m,fullRange}=frame;
  const ys=fullRange?1:255/219,cs=fullRange?1:255/224,black=fullRange?0:16;
  for(let row=0;row<height;row++){
   const cRow=Math.floor(row/2)*chromaWidth;
   for(let col=0;col<width;col++){
    const p=row*width+col,c=cRow+Math.floor(col/2),y=(bytes[p]-black)*ys,u=(bytes[pixels+c]-128)*cs,v=(bytes[pixels+chromaBytes+c]-128)*cs,at=p*4;
    output[at]=clamp(y+m.r*v);output[at+1]=clamp(y+m.gu*u+m.gv*v);output[at+2]=clamp(y+m.b*u);output[at+3]=255;
   }
  }
  return output;
 }
 function toRGBA(pixels,header){const frame=validate(pixels,header);return convertInto(frame,new Uint8ClampedArray(frame.pixels*4));}
 const VERTEX='attribute vec2 aPosition;attribute vec2 aUV;varying vec2 vUV;void main(){gl_Position=vec4(aPosition,0.0,1.0);vUV=aUV;}';
 const FRAGMENT='precision highp float;varying vec2 vUV;uniform sampler2D uY;uniform sampler2D uU;uniform sampler2D uV;uniform vec2 uSourceSize;uniform vec2 uChromaSize;uniform vec3 uOffset;uniform mat3 uMatrix;void main(){vec2 cUV=(floor(vUV*uSourceSize*0.5)+0.5)/uChromaSize;vec3 yuv=vec3(texture2D(uY,vUV).r,texture2D(uU,cUV).r,texture2D(uV,cUV).r)-uOffset;gl_FragColor=vec4(uMatrix*yuv,1.0);}';
 // Top image row maps to top of the canvas, matching ImageData. No unpack flip/readback.
 const QUAD=new Float32Array([-1,-1,0,1,1,-1,1,1,-1,1,0,0,1,1,1,0]);
 function create({document:doc,width=1,height=1,enabled=true}={}){
  if(!doc||typeof doc.createElement!=='function')throw Error('原生绘制缺少画布环境。');
  shape(width,height);
  let disposed=false,mode=enabled?'webgl':'cpu',fallbackReason=null,lastFormat=null;
  let glCanvas=null,gl=null,program=null,buffer=null,shaders=[],textures=[],locations=null,textureShape=null;
  let cpuCanvas=null,context=null,image=null,cpuShape=null;
  function releaseGL(loseContext){
   if(gl){
    for(const texture of textures)try{gl.deleteTexture(texture);}catch(_){}
    if(buffer)try{gl.deleteBuffer(buffer);}catch(_){}
    if(program)try{gl.deleteProgram(program);}catch(_){}
    for(const shader of shaders)try{gl.deleteShader(shader);}catch(_){}
    if(loseContext)try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch(_){}
   }
   if(glCanvas){glCanvas.removeEventListener?.('webglcontextlost',onContextLost);glCanvas.width=0;glCanvas.height=0;}
   glCanvas=null;gl=null;program=null;buffer=null;shaders=[];textures=[];locations=null;textureShape=null;
  }
  function fallback(reason){fallbackReason=String(reason||'WebGL unavailable');mode='cpu';releaseGL(true);}
  function onContextLost(event){event?.preventDefault?.();if(!disposed)fallback('WebGL context lost');}
  function shader(kind,source){
   const object=gl.createShader(kind);if(!object)throw Error('无法创建视频绘制着色器。');shaders.push(object);gl.shaderSource(object,source);gl.compileShader(object);
   if(!gl.getShaderParameter(object,gl.COMPILE_STATUS))throw Error('视频着色器编译失败：'+String(gl.getShaderInfoLog(object)||'unknown').slice(0,256));
   return object;
  }
  if(enabled){
   try{
    glCanvas=doc.createElement('canvas');glCanvas.width=width;glCanvas.height=height;
    gl=glCanvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:true});
    if(!gl)throw Error('此环境未提供WebGL视频绘制。');
    const vertex=shader(gl.VERTEX_SHADER,VERTEX),fragment=shader(gl.FRAGMENT_SHADER,FRAGMENT);
    program=gl.createProgram();if(!program)throw Error('无法创建视频绘制程序。');gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('视频绘制程序连接失败。');gl.useProgram(program);
    buffer=gl.createBuffer();if(!buffer)throw Error('无法创建视频四边形。');gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,QUAD,gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'aPosition'),uv=gl.getAttribLocation(program,'aUV');
    if(position<0||uv<0)throw Error('视频绘制顶点属性缺失。');
    gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
    locations={source:gl.getUniformLocation(program,'uSourceSize'),chroma:gl.getUniformLocation(program,'uChromaSize'),offset:gl.getUniformLocation(program,'uOffset'),matrix:gl.getUniformLocation(program,'uMatrix'),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)};
    for(let n=0;n<3;n++){
     const texture=gl.createTexture();if(!texture)throw Error('无法创建视频纹理。');textures.push(texture);gl.activeTexture(gl.TEXTURE0+n);gl.bindTexture(gl.TEXTURE_2D,texture);
     gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.uniform1i(gl.getUniformLocation(program,['uY','uU','uV'][n]),n);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.DITHER);
    glCanvas.addEventListener?.('webglcontextlost',onContextLost);
   }catch(e){fallback(e.message);}
  }
  function cpu(frame){
   if(!cpuCanvas){cpuCanvas=doc.createElement('canvas');context=cpuCanvas.getContext('2d',{alpha:false});if(!context)throw Error('此环境未提供CPU视频画布。');}
   if(!image||cpuShape?.width!==frame.width||cpuShape?.height!==frame.height){cpuCanvas.width=frame.width;cpuCanvas.height=frame.height;image=context.createImageData(frame.width,frame.height);cpuShape={width:frame.width,height:frame.height};}
   convertInto(frame,image.data);context.putImageData(image,0,0);return cpuCanvas;
  }
  function render(pixels,header){
   if(disposed)throw Error('原生视频绘制器已释放。');const frame=validate(pixels,header);lastFormat=frame.format;
   if(frame.format==='rgba8'||mode==='cpu')return cpu(frame);
   try{
    if(gl.isContextLost?.())throw Error('WebGL context lost');
    if(frame.width>locations.maxTextureSize||frame.height>locations.maxTextureSize)throw Error('视频尺寸超过当前GPU纹理上限。');
    const changed=!textureShape||textureShape.width!==frame.width||textureShape.height!==frame.height;
    if(changed){glCanvas.width=frame.width;glCanvas.height=frame.height;}
    gl.useProgram(program);gl.viewport(0,0,frame.width,frame.height);
    const views=[frame.bytes.subarray(0,frame.pixels),frame.bytes.subarray(frame.pixels,frame.pixels+frame.chromaBytes),frame.bytes.subarray(frame.pixels+frame.chromaBytes)];
    for(let n=0;n<3;n++){
     const w=n?frame.chromaWidth:frame.width,h=n?frame.chromaHeight:frame.height;
     gl.activeTexture(gl.TEXTURE0+n);gl.bindTexture(gl.TEXTURE_2D,textures[n]);
     if(changed)gl.texImage2D(gl.TEXTURE_2D,0,gl.LUMINANCE,w,h,0,gl.LUMINANCE,gl.UNSIGNED_BYTE,views[n]);
     else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,w,h,gl.LUMINANCE,gl.UNSIGNED_BYTE,views[n]);
    }
    const color=transform(frame.colorMatrix,frame.fullRange);gl.uniform2f(locations.source,frame.width,frame.height);gl.uniform2f(locations.chroma,frame.chromaWidth,frame.chromaHeight);gl.uniform3fv(locations.offset,color.offset);gl.uniformMatrix3fv(locations.matrix,false,color.matrix);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);if(gl.isContextLost?.())throw Error('WebGL context lost');
    textureShape={width:frame.width,height:frame.height,bytes:frame.pixels+2*frame.chromaBytes};return glCanvas;
   }catch(e){fallback(e.message);return cpu(frame);}
  }
  function memoryBytes(){
   if(disposed)return 0;
   // Conservative owned backing estimate: retained WebGL framebuffer + compositor copy,
   // planar textures + vertices; CPU canvas + reusable ImageData. Caller owns input bytes.
   return(glCanvas?glCanvas.width*glCanvas.height*8+QUAD.byteLength:0)+(textureShape?.bytes||0)+(cpuShape?cpuShape.width*cpuShape.height*8:0);
  }
  return{render,memoryBytes,get mode(){return lastFormat==='rgba8'?'cpu':mode;},snapshot(){return{mode:lastFormat==='rgba8'?'cpu':mode,fallbackReason,pixelFormat:lastFormat,memoryBytes:memoryBytes()};},dispose(){if(disposed)return;disposed=true;releaseGL(true);if(cpuCanvas){cpuCanvas.width=0;cpuCanvas.height=0;}image=null;context=null;cpuShape=null;cpuCanvas=null;}};
 }
 const api={create,toRGBA,validate,transform};if(typeof module==='object'&&module.exports)module.exports=api;root.EVANativeRenderer=api;
})(typeof window==='object'?window:globalThis);
