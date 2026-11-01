import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const ink='#171c22',paper='#f1f2f3',white='#f2f5f7',blue='#98bdd8',black='#080b0e';
const concepts=[
 {id:'A',file:'a-cut',name:'切帧 F',en:'Cut',line:'把逐帧推进，藏进一个字母。',note:'硬朗 / 精确 / 字母标识',shape:`<path fill="MAIN" d="M23 109V19H109L93 39H45V55H87L71 75H45V109Z"/><path fill="ACCENT" d="M23 19H109L93 39H23Z"/>`},
 {id:'B',file:'b-folio',name:'折页',en:'Folio',line:'把画面，变成可以留下笔记的一页。',note:'安静 / 记录 / 负形',shape:`<path fill="MAIN" fill-rule="evenodd" d="M19 20H81L109 48V108H19ZM37 38V90H91V56H73V38Z"/><path fill="ACCENT" d="M81 20L109 48H81Z"/>`},
 {id:'C',file:'c-retrace',name:'回看轨迹',en:'Retrace',line:'沿着运动回看，再看见一次。',note:'流动 / 循环 / 柔和',shape:`<path d="M34 108V43C34 9 96 9 96 42C96 68 34 68 34 84" fill="none" stroke="MAIN" stroke-width="18"/><path d="M34 84C34 68 96 68 96 42" fill="none" stroke="ACCENT" stroke-width="18"/><path d="M16 84H64" fill="none" stroke="MAIN" stroke-width="18"/>`},
 {id:'D',file:'d-pinpoint',name:'画面注点',en:'Pinpoint',line:'留住画面里，值得注意的那一点。',note:'克制 / 聚焦 / 标注',shape:`<path fill="MAIN" fill-rule="evenodd" d="M17 22H111V106H17ZM33 38V90H95V38Z"/><path fill="${black}" d="M78 14H119V55H78Z"/><circle cx="99" cy="33" r="14" fill="ACCENT"/>`},
 {id:'E',file:'e-cadence',name:'连续帧',en:'Cadence',line:'将连续动作，拆成清楚的节奏。',note:'运动 / 节奏 / 抽象 F',shape:`<path fill="MAIN" d="M17 28L38 20V104L17 112ZM47 17L68 9V82L47 90Z"/><path fill="ACCENT" d="M77 6L98 14V51L77 43Z"/>`},
 {id:'F',file:'f-insight',name:'观察之眼',en:'Insight',line:'从观看，到看懂。',note:'观察 / 洞察 / 独立符号',shape:`<path fill="MAIN" fill-rule="evenodd" d="M8 64Q64 -10 120 64Q64 138 8 64ZM31 64Q64 26 97 64Q64 102 31 64Z"/><path fill="ACCENT" d="M56 46H72V82H56Z"/>`}
];
function shape(c,main=white,accent=blue,bg=black){return c.shape.replaceAll('MAIN',main).replaceAll('ACCENT',accent).replaceAll(black,bg);}
// D's corner is a knockout, represented as a mask in standalone transparent assets.
function asset(c){let body=shape(c,ink,'#739dbb','white');if(c.id==='D')body=`<defs><mask id="cut"><rect width="128" height="128" fill="white"/><path d="M78 14H119V55H78Z" fill="black"/></mask></defs><g mask="url(#cut)"><path fill="${ink}" fill-rule="evenodd" d="M17 22H111V106H17ZM33 38V90H95V38Z"/></g><circle cx="99" cy="33" r="14" fill="#739dbb"/>`;return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128" role="img"><title>Framilo ${c.en}</title>${body}</svg>`;}
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const text=(x,y,t,size=16,fill=ink,weight=400,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${xml(t)}</text>`;
const logo=(c,x,y,size,main=white,accent=blue,bg=black)=>`<g transform="translate(${x} ${y}) scale(${size/128})">${shape(c,main,accent,bg)}</g>`;
const word=(x,y,size=38,color=white)=>text(x,y,'Framilo',size,color,600,'font-family="Bahnschrift, Segoe UI, sans-serif" letter-spacing="-.8"');
let sheet=`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1250" viewBox="0 0 1536 1250"><rect width="1536" height="1250" fill="${paper}"/><g font-family="Segoe UI, Microsoft YaHei, sans-serif">${word(48,73,48,ink)}${text(48,106,'视频观察与标注播放器',15,'#68727d')}${text(1488,65,'六款全新构形',21,ink,500,'text-anchor="end"')}${text(1488,96,'先选轮廓，再细化最终图标与字标',14,'#68727d',400,'text-anchor="end"')}`;
const panels=[];
for(const [i,c]of concepts.entries()){
 const x=48+i%3*488,y=144+Math.floor(i/3)*518;
 let p=`<rect width="464" height="490" fill="white"/>${text(22,35,c.id,17,'#53758f',600)}${text(53,35,c.name,20,ink,600)}${text(440,35,c.en,13,'#68727d',400,'text-anchor="end"')}<rect x="0" y="54" width="464" height="284" fill="${black}"/>${logo(c,168,80,128)}${word(232,270,40,white).replace('font-size','text-anchor="middle" font-size')}${text(232,307,c.note,12,'#a1aeb9',400,'text-anchor="middle"')}`;
 p+=text(22,376,'单色',12,'#68727d');
 for(const [j,size]of [16,24,32].entries())p+=logo(c,70+j*51,370-size/2,size,ink,ink,'white');
 p+=`<rect x="300" y="354" width="36" height="36" fill="${ink}"/>${logo(c,306,360,24,white,white,ink)}<rect x="349" y="354" width="36" height="36" fill="#e4e8ec"/>${logo(c,355,360,24,ink,'#739dbb','#e4e8ec')}`;
 p+=text(440,377,'24px',11,'#68727d',400,'text-anchor="end"')+text(22,429,c.line,16,ink)+text(22,461,'16 / 24 / 32px 实际尺寸 · 无立体与渐变',12,'#7a838d');
 sheet+=`<g transform="translate(${x} ${y})">${p}</g>`;
 panels.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 464 490" role="img" aria-label="${c.id} ${c.name}" font-family="Segoe UI,Microsoft YaHei,sans-serif">${p}</svg>`);
 await fs.writeFile(path.join(root,c.file+'.svg'),asset(c));
}
sheet+=text(48,1215,'Framilo / 品牌探索第一轮',13,'#68727d')+text(1488,1215,'概念稿 · 尚未替换正式插件图标',13,'#68727d',400,'text-anchor="end"')+'</g></svg>';
await fs.writeFile(path.join(root,'contact-sheet.svg'),sheet);
await fs.writeFile(path.join(root,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Framilo — 六款 Logo 方向</title><style>*{box-sizing:border-box}body{margin:0;background:${paper};color:${ink};font-family:"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1536px;margin:auto;padding:40px 48px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px}h1{font-family:Bahnschrift,"Segoe UI",sans-serif;font-size:48px;margin:0;letter-spacing:-1px}p{color:#68727d;font-size:14px;line-height:1.8}header>div:last-child{text-align:right}h2{font-size:21px;font-weight:500}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}article svg{width:100%;display:block}a{display:block;text-decoration:none;color:inherit}a:focus-visible{outline:2px solid #53758f;outline-offset:5px}footer{display:flex;justify-content:space-between;margin-top:24px;font-size:13px;color:#68727d}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:24px}}@media(max-width:620px){.grid{grid-template-columns:1fr}header{display:block}header>div:last-child{text-align:left}h1{font-size:40px}footer{display:block}}@media print{main{padding:0}.grid{grid-template-columns:repeat(3,1fr)}} </style><main><header><div><h1>Framilo</h1><p>视频观察与标注播放器</p></div><div><h2>六款全新构形</h2><p>点选任一方案，查看可缩放矢量原图</p></div></header><section class="grid">${concepts.map((c,i)=>`<article><a href="${c.file}.svg" aria-label="查看${c.id} ${c.name}矢量原图">${panels[i]}</a></article>`).join('')}</section><footer><span>黑白轮廓 / 淡蓝点缀 / 小尺寸对照</span><span>概念稿，尚未替换正式图标</span></footer></main></html>`);
console.log({output:root,concepts:concepts.map(c=>c.id+' '+c.name)});
