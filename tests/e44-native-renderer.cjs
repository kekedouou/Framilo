'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../plugin/native-renderer.js');
function yuv(y,u=128,v=128){return new Uint8Array([y,y,y,y,u,v]);}
function head(matrix='bt709',fullRange=false){return{pixelFormat:'yuv420p',width:2,height:2,colorMatrix:matrix,fullRange};}
function rgb(bytes,h){return Array.from(R.toRGBA(bytes,h).subarray(0,4));}
function environment(options={}){
 const calls=[],canvases=[];let lost=false,ids=0;
 const gl={};for(const [n,k]of ['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ARRAY_BUFFER','STATIC_DRAW','FLOAT','MAX_TEXTURE_SIZE','TEXTURE_2D','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','NEAREST','TEXTURE_WRAP_S','TEXTURE_WRAP_T','CLAMP_TO_EDGE','UNPACK_ALIGNMENT','UNPACK_FLIP_Y_WEBGL','BLEND','DEPTH_TEST','DITHER','LUMINANCE','UNSIGNED_BYTE','TRIANGLE_STRIP'].entries())gl[k]=n+1;gl.TEXTURE0=100;
 for(const name of ['shaderSource','compileShader','attachShader','linkProgram','useProgram','bindBuffer','bufferData','enableVertexAttribArray','vertexAttribPointer','activeTexture','bindTexture','texParameteri','uniform1i','pixelStorei','disable','viewport','uniform2f','uniform3fv','uniformMatrix3fv','drawArrays','deleteTexture','deleteBuffer','deleteProgram','deleteShader'])gl[name]=(...args)=>calls.push([name,...args]);
 for(const name of ['createShader','createProgram','createBuffer','createTexture'])gl[name]=()=>({id:++ids});
 gl.getShaderParameter=()=>options.shader!==false;gl.getShaderInfoLog=()=>'fixture shader failure';gl.getProgramParameter=()=>true;gl.getAttribLocation=(_,name)=>name==='aPosition'?0:1;gl.getUniformLocation=(_,name)=>name;gl.getParameter=()=>options.textureLimit||8192;
 gl.isContextLost=()=>lost;gl.getExtension=()=>({loseContext(){lost=true;calls.push(['loseContext']);}});gl.readPixels=()=>assert.fail('WebGL rendering must never read back to CPU');
 gl.texImage2D=(...args)=>{if(options.failUpload)throw Error('fixture upload failure');calls.push(['texImage2D',...args]);};
 gl.texSubImage2D=(...args)=>calls.push(['texSubImage2D',...args]);
 const doc={createElement(name){assert.equal(name,'canvas');const events=new Map(),canvas={width:0,height:0,events,addEventListener:(n,f)=>events.set(n,f),removeEventListener:(n,f)=>{if(events.get(n)===f)events.delete(n);},getContext(type){
  if(type==='webgl'){calls.push(['getWebGL']);return options.gpu===false?null:gl;}
  assert.equal(type,'2d');return{createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData(image,x,y){canvas.image={width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)};calls.push(['putImageData',x,y]);},getImageData(){assert.fail('must not read canvas pixels');}};
 }};canvases.push(canvas);return canvas;}};
 return{doc,gl,calls,canvases,lose(){lost=true;canvases[0]?.events.get('webglcontextlost')?.({preventDefault(){}});}};
}
test('BT709/BT601 limited and full black/white ranges are exact',()=>{
 for(const matrix of ['bt709','bt601'])for(const full of [false,true]){
  assert.deepEqual(rgb(yuv(full?0:16),head(matrix,full)),[0,0,0,255]);
  assert.deepEqual(rgb(yuv(full?255:235),head(matrix,full)),[255,255,255,255]);
 }
 assert.deepEqual(rgb(yuv(0),head()),[0,0,0,255]);assert.deepEqual(rgb(yuv(255),head()),[255,255,255,255]);
});
test('matrix coefficients produce known red samples and distinguish 601/709',()=>{
 assert.deepEqual(rgb(yuv(81,90,240),head('bt601')),[254,0,0,255]);
 assert.deepEqual(rgb(yuv(81,90,240),head('bt709')),[255,24,0,255]);
 assert.deepEqual(rgb(yuv(63,102,240),head('bt709')),[255,1,0,255]);
});
test('shader coefficients and CPU conversion agree to one output level',()=>{
 for(const matrix of ['bt709','bt601'])for(const full of [true,false])for(const [y,u,v]of [[0,0,0],[16,128,128],[81,90,240],[235,128,128],[54,99,255],[255,255,255]]){
  const t=R.transform(matrix,full),value=[y/255-t.offset[0],u/255-t.offset[1],v/255-t.offset[2]],actual=rgb(yuv(y,u,v),head(matrix,full));
  for(let n=0;n<3;n++){const expected=Math.max(0,Math.min(255,Math.round((t.matrix[n]*value[0]+t.matrix[n+3]*value[1]+t.matrix[n+6]*value[2])*255)));assert(Math.abs(expected-actual[n])<=1);}
 }
});
test('validation rejects unsupported color, overflow, nonbytes and partial planes',()=>{
 assert.throws(()=>R.validate(yuv(16),{...head(),width:0}),/尺寸/);
 assert.throws(()=>R.validate(yuv(16),{...head(),width:8193}),/尺寸/);
 assert.throws(()=>R.validate(yuv(16),{...head(),width:8192,height:8192}),/尺寸/);
 assert.throws(()=>R.validate(yuv(16),{...head(),colorMatrix:'bt2020'}),/色彩矩阵/);
 assert.throws(()=>R.validate(yuv(16),{...head(),fullRange:'false'}),/范围/);
 assert.throws(()=>R.validate(yuv(16).subarray(0,5),head()),/长度/);
 assert.throws(()=>R.validate([16,16,16,16,128,128],head()),/字节/);
 assert.throws(()=>R.validate(new Float32Array(6),head()),/字节/);
 assert.throws(()=>R.validate(yuv(16),{...head(),pixelFormat:'nv12'}),/像素格式/);
});
test('CPU chroma sampling respects odd dimensions and byte offsets',()=>{
 // 3x1: the first two luma pixels share chroma 0; the third uses chroma 1.
 const bytes=new Uint8Array([99,81,81,81,90,128,240,128,99]),header={...head('bt601'),width:3,height:1};
 assert.deepEqual(Array.from(R.toRGBA(bytes.subarray(1,8),header)),[254,0,0,255,254,0,0,255,76,76,76,255]);
});
test('WebGL uploads planar Y/U/V with correct UV direction; reuses textures, no readback',()=>{
 const e=environment(),r=R.create({document:e.doc,width:2,height:2}),bytes=yuv(81,90,240),canvas=r.render(bytes,head('bt601'));
 assert.equal(r.mode,'webgl');assert.equal(canvas,e.canvases[0]);
 const uploads=e.calls.filter(x=>x[0]==='texImage2D');assert.equal(uploads.length,3);
 assert.deepEqual(uploads.map(x=>[x[4],x[5],Array.from(x[9])]),[[2,2,[81,81,81,81]],[1,1,[90]],[1,1,[240]]]);
 const quad=e.calls.find(x=>x[0]==='bufferData')[2];assert.deepEqual(Array.from(quad.slice(8,12)),[-1,1,0,0]);
 assert(e.calls.some(x=>x[0]==='pixelStorei'&&x[1]===e.gl.UNPACK_ALIGNMENT&&x[2]===1));assert(e.calls.some(x=>x[0]==='pixelStorei'&&x[1]===e.gl.UNPACK_FLIP_Y_WEBGL&&x[2]===false));
 r.render(bytes,head());assert.equal(e.calls.filter(x=>x[0]==='texImage2D').length,3);assert.equal(e.calls.filter(x=>x[0]==='texSubImage2D').length,3);assert.equal(e.calls.filter(x=>x[0]==='drawArrays').length,2);assert.equal(r.memoryBytes(),2*2*8+6+64);
 r.dispose();assert.equal(r.memoryBytes(),0);assert.equal(e.calls.filter(x=>x[0]==='deleteTexture').length,3);assert.equal(e.calls.filter(x=>x[0]==='deleteShader').length,2);assert.equal(e.calls.filter(x=>x[0]==='loseContext').length,1);assert.throws(()=>r.render(bytes,head()),/已释放/);
});
test('disabled/unavailable/failed GPU fixes CPU fallback while preserving the same frame',()=>{
 for(const options of [{gpu:false},{shader:false},{failUpload:true},{}]){
  const e=environment(options),enabled=Object.keys(options).length>0,r=R.create({document:e.doc,width:2,height:2,enabled}),canvas=r.render(yuv(81,90,240),head('bt601'));
  assert.equal(r.mode,'cpu');assert.deepEqual(Array.from(canvas.image.data.slice(0,4)),[254,0,0,255]);
  const contexts=e.calls.filter(x=>x[0]==='getWebGL').length;r.render(yuv(235),head());assert.equal(e.calls.filter(x=>x[0]==='getWebGL').length,contexts);assert.equal(canvas.image.data[0],255);
  assert.equal(r.memoryBytes(),2*2*8);r.dispose();assert.equal(r.memoryBytes(),0);
 }
});
test('lost context converts the current frame on CPU; RGBA bytes retain orientation/alpha',()=>{
 const e=environment(),r=R.create({document:e.doc,width:2,height:2});r.render(yuv(16),head());e.lose();const c=r.render(yuv(235),head());assert.equal(r.mode,'cpu');assert.equal(c.image.data[0],255);assert.match(r.snapshot().fallbackReason,/lost/);
 const rgba=new Uint8Array([1,2,3,4,5,6,7,8]),legacy={width:1,height:2};const canvas=r.render(rgba,legacy);assert.deepEqual(Array.from(canvas.image.data),Array.from(rgba));assert.equal(canvas.width,1);assert.equal(canvas.height,2);r.dispose();
});
