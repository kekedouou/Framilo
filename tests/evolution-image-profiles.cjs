'use strict';
const assert=require('assert'),{profile,encoding}=require('../prototypes/preview-quality/image-profiles.cjs');
for(const id of ['jpeg','jpeg-quality','jpeg-fine']){const p=profile(id),args=encoding(id);assert.strictEqual(p.mime,'image/jpeg');assert(p.lossy);assert.strictEqual(p.codec,'mjpeg');assert(args.includes('-q:v'));assert(args.includes('scale=in_range=pc:out_range=pc:out_color_matrix=bt601:flags=bilinear+accurate_rnd+full_chroma_int'));}
assert.strictEqual(profile('jpeg').q,3);assert.strictEqual(profile('jpeg-quality').q,1);assert.strictEqual(profile('jpeg-fine').pixelFormat,'yuvj444p');
assert.strictEqual(profile('png').lossy,false);assert.strictEqual(profile('png').mime,'image/png');assert(!encoding('png').includes('-q:v'));
for(const id of ['__proto__','../jpeg','jpeg-q0',''])assert.throws(()=>profile(id),/Unapproved/);
assert(Object.isFrozen(profile('jpeg-fine')));
console.log('image candidates: separate codec/MIME/quantizer/chroma IDs; PNG reference remains lossless; invalid profiles refused; no media');
