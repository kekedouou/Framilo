'use strict';
// Candidate IDs are distinct from codec names; no formal product mode is added.
const PROFILES=Object.freeze({
  jpeg:Object.freeze({id:'jpeg',codec:'mjpeg',mime:'image/jpeg',lossy:true,pixelFormat:'yuvj420p',q:3,label:'原JPEG对照'}),
  'jpeg-quality':Object.freeze({id:'jpeg-quality',codec:'mjpeg',mime:'image/jpeg',lossy:true,pixelFormat:'yuvj420p',q:1,label:'精细JPEG420'}),
  'jpeg-fine':Object.freeze({id:'jpeg-fine',codec:'mjpeg',mime:'image/jpeg',lossy:true,pixelFormat:'yuvj444p',q:1,label:'优化JPEG（候选）'}),
  png:Object.freeze({id:'png',codec:'png',mime:'image/png',lossy:false,pixelFormat:'rgb24',label:'PNG诊断参考'}),
  webp:Object.freeze({id:'webp',codec:'webp',encoder:'libwebp',mime:'image/webp',lossy:false,pixelFormat:'bgra',label:'历史WebP参考'})
});
function profile(id){if(!Object.hasOwn(PROFILES,id))throw Error('Unapproved candidate format');return PROFILES[id];}
function encoding(id){const p=profile(id);return p.lossy?
  ['-vf','scale=in_range=pc:out_range=pc:out_color_matrix=bt601:flags=bilinear+accurate_rnd+full_chroma_int','-c:v',p.codec,'-pix_fmt',p.pixelFormat,'-q:v',String(p.q)]:
  ['-c:v',p.encoder||p.codec,'-pix_fmt',p.pixelFormat,...(id==='png'?['-compression_level','3']:['-lossless','1','-compression_level','0','-quality','75'])];}
module.exports={PROFILES,profile,encoding};
