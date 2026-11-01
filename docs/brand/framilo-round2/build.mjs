import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const P='#edf0f2',W='#f5f7f8',B='#080c10',I='#18212a',A='#9ebfd8';
// One coordinate system, independent silhouettes. No reuse of E's slats.
const concepts=[
 {id:'A',file:'a-flow',name:'流线',desc:'柔和的转弯，开放的轮廓。',shape:`<path fill="MAIN" d="M24 112V49C24 27 40 14 63 14H108V34H65C51 34 44 41 44 53V58H93V78H44V112Z"/><path fill="ACCENT" d="M65 14H108V34H65Z"/>`},
 {id:'B',file:'b-link',name:'相连',desc:'两个独立环，连接画面与观察。',shape:`<path d="M50 79H42C27 79 18 68 18 53V43C18 28 29 18 44 18H57C72 18 82 29 82 44V50" fill="none" stroke="MAIN" stroke-width="16" stroke-linecap="round"/><path d="M78 49H86C101 49 110 60 110 75V85C110 100 99 110 84 110H71C56 110 46 99 46 84V78" fill="none" stroke="ACCENT" stroke-width="16" stroke-linecap="round"/><path d="M48 80L80 48" fill="none" stroke="MAIN" stroke-width="16" stroke-linecap="round"/>`},
 {id:'C',file:'c-echo',name:'回响',desc:'把瞬间放慢，看见运动的余韵。',shape:`<path d="M65 17C39 17 18 38 18 64S39 111 65 111" fill="none" stroke="MAIN" stroke-width="15" stroke-linecap="round"/><path d="M82 35C66 35 53 48 53 64S66 93 82 93" fill="none" stroke="MAIN" stroke-width="15" stroke-linecap="round"/><rect x="96" y="49" width="18" height="30" rx="9" fill="ACCENT"/>`},
 {id:'D',file:'d-ink',name:'落笔',desc:'一个标记，留下自己的理解。',shape:`<path fill="MAIN" fill-rule="evenodd" d="M64 8C83 30 108 52 108 76A44 44 0 0 1 20 76C20 52 45 30 64 8ZM46 62V90H82V62Z"/><path fill="ACCENT" d="M64 8C72 18 82 28 90 39L74 54L53 21Z"/>`},
 {id:'E',file:'e-aperture',name:'留白',desc:'在完整的画面里，留出一个入口。',shape:`<path fill="MAIN" fill-rule="evenodd" d="M40 12H88Q116 12 116 40V88Q116 116 88 116H40Q12 116 12 88V40Q12 12 40 12ZM39 91H57V70H85V53H57V49Q57 37 70 37H89V21H70Q39 21 39 49Z"/><circle cx="87" cy="88" r="11" fill="ACCENT"/>`},
 {id:'F',file:'f-script',name:'连字',desc:'让名字本身成为标识。',shape:`<path d="M28 112L51 34Q60 6 82 17Q101 27 86 43Q72 56 36 59H17" fill="none" stroke="MAIN" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><path d="M61 77L94 77" fill="none" stroke="ACCENT" stroke-width="14" stroke-linecap="round"/>`,word:true}
];
function mark(c,main=W,accent=A){return c.shape.replaceAll('MAIN',main).replaceAll('ACCENT',accent);}
function glyphWord(color){return `<g fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 66L28 18Q32 6 42 10Q54 16 43 25Q35 32 14 32H7M55 61V33M55 42Q65 26 75 34M113 35Q88 23 87 47Q86 67 104 61Q113 59 113 43V33V62M130 62V34M130 43Q141 25 151 36V62M151 43Q163 25 174 37V62M193 34V62M212 12V62M255 33Q235 29 234 47Q233 65 250 63Q267 62 267 46Q267 34 255 33"/></g><circle cx="194" cy="18" r="4.5" fill="${color}"/>`;}
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const txt=(x,y,s,size=16,color=I,w=400,more='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${w}" ${more}>${esc(s)}</text>`;
const icon=(c,x,y,size,main=W,accent=A)=>`<g transform="translate(${x} ${y}) scale(${size/128})">${mark(c,main,accent)}</g>`;
const word=(x,y,color=W)=>txt(x,y,'Framilo',39,color,500,'font-family="Segoe UI, sans-serif" letter-spacing="-1.4" text-anchor="middle"');
let board=`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1152" viewBox="0 0 1536 1152"><rect width="1536" height="1152" fill="${P}"/><g font-family="Segoe UI, Microsoft YaHei, sans-serif">${txt(48,70,'Framilo',44,I,600,'letter-spacing="-1.4"')}${txt(1488,59,'重新探索 · 六个方向',20,I,500,'text-anchor="end"')}${txt(1488,90,'曲线、负形与字标',14,'#667584',400,'text-anchor="end"')}`;
let cards=[];
for(const [i,c]of concepts.entries()){
 const x=48+i%3*488,y=126+Math.floor(i/3)*484,light=i%2===1,bg=light?'#fff':B,fg=light?I:W,accent=light?'#6f99b9':A;
 let p=`<rect width="464" height="458" fill="${bg}"/>${txt(24,37,c.id,15,light?'#6c7e8d':'#8da2b3',600)}${txt(53,37,c.name,17,fg,500)}`;
 if(c.word){p+=`<g transform="translate(60 134) scale(1.25)">${glyphWord(fg)}</g>`+txt(232,263,'手绘连字 / 配套小写 f',12,'#7b8d9b',400,'text-anchor="middle"');}
 else p+=icon(c,168,77,128,fg,accent)+word(232,266,fg);
 p+=`<path d="M24 311H440" stroke="${light?'#e5e9ec':'#26313a'}"/>`;
 for(const [j,size]of [16,24,32].entries())p+=icon(c,28+j*52,349-size/2,size,fg,fg);
 p+=txt(440,354,'16 / 24 / 32px',11,light?'#7a8995':'#8da2b3',400,'text-anchor="end"')+txt(24,409,c.desc,15,fg)+txt(24,438,c.word?'字标为手绘路径，尚未最终光学校正':'单色与小尺寸对照',11,light?'#7a8995':'#8da2b3');
 board+=`<g transform="translate(${x} ${y})">${p}</g>`;
 cards.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 464 458" role="img" aria-label="${c.id} ${c.name}" font-family="Segoe UI,Microsoft YaHei,sans-serif">${p}</svg>`);
 await fs.writeFile(path.join(root,c.file+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128" role="img"><title>Framilo ${c.name}</title>${mark(c,I,'#6f99b9')}</svg>`);
}
board+=txt(48,1118,'独立构形探索 / 本轮不沿用 E 的帧片结构',13,'#667584')+txt(1488,1118,'概念稿，尚未替换正式图标',13,'#667584',400,'text-anchor="end"')+'</g></svg>';
await fs.writeFile(path.join(root,'contact-sheet.svg'),board);
await fs.writeFile(path.join(root,'f-wordmark.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="840" height="240" viewBox="0 0 280 80" role="img"><title>Framilo 连字字标</title>${glyphWord(I)}</svg>`);
// A second plate isolates one-colour silhouettes from wordmark/background choices.
let mono=`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="480" viewBox="0 0 1536 480"><rect width="1536" height="480" fill="white"/><g font-family="Segoe UI,Microsoft YaHei,sans-serif">${txt(48,56,'Framilo / 单色轮廓',25,I,500)}`;
for(const[i,c]of concepts.entries()){let x=48+i*244;mono+=icon(c,x+48,115,128,I,I)+txt(x+112,300,c.id+' '+c.name,17,I,500,'text-anchor="middle"')+icon(c,x+100,344,24,I,I);}
mono+=txt(48,441,'六款统一为单色，比较轮廓本身。',13,'#667584')+'</g></svg>';await fs.writeFile(path.join(root,'silhouettes.svg'),mono);
await fs.writeFile(path.join(root,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Framilo · 新方向</title><style>*{box-sizing:border-box}body{background:${P};color:${I};margin:0;font-family:"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1536px;padding:40px 48px;margin:auto}header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:30px}h1{font-size:44px;margin:0;font-weight:600;letter-spacing:-1.4px}header p{font-size:16px;color:#667584}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}svg{display:block;width:100%}a{color:inherit;text-decoration:none}a:focus-visible{outline:2px solid #6f99b9;outline-offset:5px}footer{margin-top:24px;font-size:13px;color:#667584}.mono{margin-top:32px}h2{font-size:19px;font-weight:500}.mono img{width:100%}@media(max-width:1000px){main{padding:24px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}header{display:block}.mono{overflow:auto}.mono img{min-width:800px}}</style><main><header><h1>Framilo</h1><p>六个新方向 / 曲线、负形与字标</p></header><section class="grid">${concepts.map((c,i)=>`<article><a href="${c.word?'f-wordmark.svg':c.file+'.svg'}" aria-label="查看${c.id} ${c.name}">${cards[i]}</a></article>`).join('')}</section><section class="mono"><h2>统一单色，比较轮廓</h2><img src="silhouettes.svg" alt="六款标识的单色轮廓对照"></section><footer>点选方案查看可缩放原稿。正式插件图标尚未替换。</footer></main></html>`);
console.log({root,concepts:concepts.length});
