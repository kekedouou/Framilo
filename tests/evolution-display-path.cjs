'use strict';
const assert=require('assert');
const {draw,render}=require('../prototypes/preview-quality/native-reference.cjs');

function fixture(width=1920,height=1080){
  const calls=[],resets=[],pixels=new Uint8ClampedArray([7,13,29,255]);
  const ctx={fillStyle:null,
    fillRect(...args){calls.push({kind:'fill',args,fillStyle:this.fillStyle});},
    drawImage(...args){calls.push({kind:'draw',args});},
    getImageData(...args){calls.push({kind:'read',args});return {data:pixels};}};
  const canvas={getContext(type,options){calls.push({kind:'context',type,options});return ctx;}};
  Object.defineProperties(canvas,{
    width:{get:()=>width,set:value=>{resets.push(['width',value]);width=value;}},
    height:{get:()=>height,set:value=>{resets.push(['height',value]);height=value;}}
  });
  return {canvas,ctx,calls,resets,pixels};
}
function approximately(actual,expected){assert(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);}
function checkGeometry(video,width,height,expected){
  const h=fixture(width,height);draw(video,h.canvas,width,height);
  assert.deepStrictEqual(h.calls.map(x=>x.kind),['context','fill','draw']);
  assert.deepStrictEqual(h.calls[0],{kind:'context',type:'2d',options:{alpha:false,colorSpace:'srgb'}});
  assert.deepStrictEqual(h.calls[1],{kind:'fill',args:[0,0,width,height],fillStyle:'black'});
  const args=h.calls[2].args;assert.strictEqual(args[0],video);assert.strictEqual(args.length,5);
  args.slice(1).forEach((x,i)=>approximately(x,expected[i]));
  approximately(args[3]/args[4],video.videoWidth/video.videoHeight);
  assert.deepStrictEqual(h.resets,[],'same dimensions must not reset the displayed canvas');
  return h;
}
function readableError(error){return error instanceof Error&&!(error instanceof TypeError)&&error.message.length>3;}

checkGeometry({videoWidth:3840,videoHeight:2160},1920,1080,[0,0,1920,1080]);
checkGeometry({videoWidth:1440,videoHeight:1080},1920,1080,[240,0,1440,1080]);
checkGeometry({videoWidth:1080,videoHeight:1920},1920,1080,[656.25,0,607.5,1080]);
checkGeometry({videoWidth:1920,videoHeight:1080},1200,900,[0,112.5,1200,675]);

{
  const h=fixture(1,1);draw({videoWidth:1920,videoHeight:1080},h.canvas,1920,1080);
  assert.deepStrictEqual(h.resets,[['width',1920],['height',1080]]);
  assert.strictEqual(h.calls.filter(x=>x.kind==='read').length,0,'display-only draw must not read pixels');
}
{
  const h=fixture(1920,1);draw({videoWidth:1920,videoHeight:1080},h.canvas,1920,1080);
  assert.deepStrictEqual(h.resets,[['height',1080]],'only changed dimensions may reset the canvas');
}
{
  const video={videoWidth:1440,videoHeight:1080},h=fixture();
  assert.strictEqual(render(video,h.canvas,1920,1080),h.pixels);
  assert.deepStrictEqual(h.calls.map(x=>x.kind),['context','fill','draw','read']);
  assert.deepStrictEqual(h.calls[2].args,[video,240,0,1440,1080]);
  assert.deepStrictEqual(h.calls[3].args,[0,0,1920,1080]);
  assert.deepStrictEqual(h.resets,[]);
}
{
  const h=fixture();h.canvas.getContext=()=>null;
  assert.throws(()=>draw({videoWidth:1920,videoHeight:1080},h.canvas,1920,1080),readableError);
  assert.deepStrictEqual(h.calls,[]);
}
for(const dimensions of [{videoWidth:0,videoHeight:1080},{videoWidth:1920,videoHeight:0},
  {videoWidth:NaN,videoHeight:1080},{videoWidth:1920,videoHeight:undefined},
  {videoWidth:-1,videoHeight:1080},{videoWidth:1920,videoHeight:Infinity}]){
  const h=fixture();assert.throws(()=>draw(dimensions,h.canvas,1920,1080),readableError);
  assert.strictEqual(h.calls.filter(x=>x.kind==='draw'||x.kind==='read').length,0);
}
for(const [width,height] of [[0,1080],[1920,0],[1.5,1080],[1920,Infinity]]){
  const h=fixture();assert.throws(()=>draw({videoWidth:1920,videoHeight:1080},h.canvas,width,height),readableError);
  assert.strictEqual(h.calls.filter(x=>x.kind==='draw'||x.kind==='read').length,0);
}
console.log('display path: display-only draw, sRGB context, no redundant canvas reset, aspect-fit black padding and render readback checked with simulated canvas; not browser color acceptance');
