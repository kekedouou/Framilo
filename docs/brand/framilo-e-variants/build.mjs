import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const ink='#171c22',paper='#f1f2f3',white='#f2f5f7',blue='#98bdd8',black='#080b0e';
const concepts=[
  {
    "id": "E1",
    "file": "e1-balanced",
    "name": "均衡",
    "en": "Balanced",
    "line": "保留原版折角，优化帧宽与间距。",
    "note": "原版细化 / 比例更稳",
    "shape": "<path fill=\"MAIN\" d=\"M20 34L44 24V106L20 116ZM54 20L78 10V82L54 92Z\"/><path fill=\"ACCENT\" d=\"M88 12L108 20V56L88 48Z\"/>"
  },
  {
    "id": "E2",
    "file": "e2-compact",
    "name": "紧凑",
    "en": "Compact",
    "line": "帧片加宽、缩短，适合小图标。",
    "note": "短而有力 / 更紧凑",
    "shape": "<path fill=\"MAIN\" d=\"M14 39L42 29V103L14 113ZM50 26L78 16V85L50 95Z\"/><path fill=\"ACCENT\" d=\"M86 17L114 27V62L86 52Z\"/>"
  },
  {
    "id": "E3",
    "file": "e3-sequence",
    "name": "四帧",
    "en": "Sequence",
    "line": "从三帧变四帧，节奏更细密。",
    "note": "连续性 / 轻盈",
    "shape": "<path fill=\"MAIN\" d=\"M12 46L30 39V112L12 119ZM40 34L58 27V94L40 101ZM68 22L86 15V76L68 83Z\"/><path fill=\"ACCENT\" d=\"M96 13L114 20V56L96 49Z\"/>"
  },
  {
    "id": "E4",
    "file": "e4-forward",
    "name": "前倾",
    "en": "Forward",
    "line": "帧片整体前倾，强化推进感。",
    "note": "速度 / 方向感",
    "shape": "<path fill=\"MAIN\" d=\"M35 30L57 22L39 104L17 112ZM65 19L87 11L72 78L50 86Z\"/><path fill=\"ACCENT\" d=\"M95 13L115 21L107 57L87 49Z\"/>"
  },
  {
    "id": "E5",
    "file": "e5-fold",
    "name": "折带",
    "en": "Fold",
    "line": "把顶部连接起来，形成一条折带。",
    "note": "整体感 / 折叠轮廓",
    "shape": "<path fill=\"MAIN\" d=\"M20 34L44 24V106L20 116ZM54 20L78 10V82L54 92Z\"/><path fill=\"ACCENT\" d=\"M54 20L78 10L108 22V54L84 44V32L78 30L54 40Z\"/>"
  },
  {
    "id": "E6",
    "file": "e6-initial",
    "name": "显形 F",
    "en": "Initial",
    "line": "用两道横向留白，让 F 更明确。",
    "note": "字母识别 / 保留帧切片",
    "shape": "<path fill=\"MAIN\" d=\"M16 30L40 20V108L16 118ZM50 17L74 7V31L50 41ZM50 53L74 43V67L50 77Z\"/><path fill=\"ACCENT\" d=\"M84 10L108 20V44L84 34Z\"/>"
  }
];
function shape(c,main=white,accent=blue,bg=black){return c.shape.replaceAll('MAIN',main).replaceAll('ACCENT',accent).replaceAll(black,bg);}
function asset(c){return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 128 128" role="img"><title>Framilo ${c.en}</title>${shape(c,ink,'#739dbb')}</svg>`;}
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const text=(x,y,t,size=16,fill=ink,weight=400,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${xml(t)}</text>`;
const logo=(c,x,y,size,main=white,accent=blue,bg=black)=>`<g transform="translate(${x} ${y}) scale(${size/128})">${shape(c,main,accent,bg)}</g>`;
const word=(x,y,size=38,color=white)=>text(x,y,'Framilo',size,color,600,'font-family="Bahnschrift, Segoe UI, sans-serif" letter-spacing="-.8"');
let sheet=`<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1410" viewBox="0 0 1536 1410"><rect width="1536" height="1410" fill="${paper}"/><g font-family="Segoe UI, Microsoft YaHei, sans-serif">${word(48,73,48,ink)}${text(48,106,'视频观察与标注播放器',15,'#68727d')}${text(1488,65,'E 系列 / 六款变体',21,ink,500,'text-anchor="end"')}${text(1488,96,'保留连续帧的感觉，比较比例与节奏',14,'#68727d',400,'text-anchor="end"')}`;
const original={shape:"<path fill=\"MAIN\" d=\"M17 28L38 20V104L17 112ZM47 17L68 9V82L47 90Z\"/><path fill=\"ACCENT\" d=\"M77 6L98 14V51L77 43Z\"/>"};
const reference=`<rect width="1440" height="138" fill="#e1e6ea"/>${logo(original,32,12,112,ink,'#739dbb','#e1e6ea')}${text(183,44,'E0 原版 · 对照基准',19,ink,600)}${text(183,78,'三片斜切帧，末片反向折角。保留原稿，不覆盖。',16,'#53616d')}${text(183,108,'下方六款采用同一字标、颜色与展示尺寸。',13,'#68727d')}`;
sheet+=`<g transform="translate(48 136)">${reference}</g>`;
const panels=[];
for(const [i,c]of concepts.entries()){
 const x=48+i%3*488,y=304+Math.floor(i/3)*518;
 let p=`<rect width="464" height="490" fill="white"/>${text(22,35,c.id,17,'#53758f',600)}${text(65,35,c.name,20,ink,600)}${text(440,35,c.en,13,'#68727d',400,'text-anchor="end"')}<rect x="0" y="54" width="464" height="284" fill="${black}"/>${logo(c,168,80,128)}${word(232,270,40,white).replace('font-size','text-anchor="middle" font-size')}${text(232,307,c.note,12,'#a1aeb9',400,'text-anchor="middle"')}`;
 p+=text(22,376,'单色',12,'#68727d');
 for(const [j,size]of [16,24,32].entries())p+=logo(c,70+j*51,370-size/2,size,ink,ink,'white');
 p+=`<rect x="300" y="354" width="36" height="36" fill="${ink}"/>${logo(c,306,360,24,white,white,ink)}<rect x="349" y="354" width="36" height="36" fill="#e4e8ec"/>${logo(c,355,360,24,ink,'#739dbb','#e4e8ec')}`;
 p+=text(440,377,'24px',11,'#68727d',400,'text-anchor="end"')+text(22,429,c.line,16,ink)+text(22,461,'16 / 24 / 32px 实际尺寸 · 无立体与渐变',12,'#7a838d');
 sheet+=`<g transform="translate(${x} ${y})">${p}</g>`;
 panels.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 464 490" role="img" aria-label="${c.id} ${c.name}" font-family="Segoe UI,Microsoft YaHei,sans-serif">${p}</svg>`);
 await fs.writeFile(path.join(root,c.file+'.svg'),asset(c));
}
sheet+=text(48,1375,'Framilo / E 系列细化',13,'#68727d')+text(1488,1375,'概念稿 · 尚未替换正式插件图标',13,'#68727d',400,'text-anchor="end"')+'</g></svg>';
await fs.writeFile(path.join(root,'contact-sheet.svg'),sheet);
await fs.writeFile(path.join(root,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Framilo — E 系列 Logo 变体</title><style>*{box-sizing:border-box}body{margin:0;background:${paper};color:${ink};font-family:"Segoe UI","Microsoft YaHei",sans-serif}main{max-width:1536px;margin:auto;padding:40px 48px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px}h1{font-family:Bahnschrift,"Segoe UI",sans-serif;font-size:48px;margin:0;letter-spacing:-1px}p{color:#68727d;font-size:14px;line-height:1.8}header>div:last-child{text-align:right}h2{font-size:21px;font-weight:500}.reference{margin-bottom:30px}.reference svg{width:100%;display:block}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}article svg{width:100%;display:block}a{display:block;text-decoration:none;color:inherit}a:focus-visible{outline:2px solid #53758f;outline-offset:5px}footer{display:flex;justify-content:space-between;margin-top:24px;font-size:13px;color:#68727d}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:24px}}@media(max-width:620px){.grid{grid-template-columns:1fr}header{display:block}header>div:last-child{text-align:left}h1{font-size:40px}footer{display:block}}@media print{main{padding:0}.grid{grid-template-columns:repeat(3,1fr)}} </style><main><header><div><h1>Framilo</h1><p>视频观察与标注播放器</p></div><div><h2>E 系列 / 六款变体</h2><p>点选任一方案，查看可缩放矢量原图</p></div></header><div class="reference"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 138" font-family="Segoe UI,Microsoft YaHei,sans-serif">${reference}</svg></div><section class="grid">${concepts.map((c,i)=>`<article><a href="${c.file}.svg" aria-label="查看${c.id} ${c.name}矢量原图">${panels[i]}</a></article>`).join('')}</section><footer><span>黑白轮廓 / 淡蓝点缀 / 小尺寸对照</span><span>原版保留，变体待选</span></footer></main></html>`);
console.log({output:root,concepts:concepts.map(c=>c.id+' '+c.name)});
