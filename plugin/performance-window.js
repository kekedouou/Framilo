'use strict';
(function(){
 let token=null,current=null;
 const el=id=>document.getElementById(id),labels={off:'已关闭',observing:'实时'};
 const rows=[['queue','排队 / 准备',['queue','prepare'],'#aa98aa'],['read','读取',['locate','readIO','asset'],'#d4ac72'],['decode','解码 / 转换',['native','decodeNative','decode','convert'],'#829fc9'],['transfer','传输',['transfer'],'#7fabb5'],['render','绘制',['renderWait','submit'],'#66ae99']];
 const cells=rows.map(([id,label,names,color])=>{const row=document.createElement('div');row.className='phase';const span=document.createElement('span');span.textContent=label;const track=document.createElement('div');track.className='track';const bar=document.createElement('i');bar.style.background=color;track.append(bar);const value=document.createElement('b');value.textContent='—';row.append(span,track,value);el('phases').append(row);return{row,bar,value,names};});
 const num=n=>typeof n==='number'?n<1000?n.toFixed(n<10?1:0): (n/1000).toFixed(2):'—';
 function stat(id,n){el(id).textContent=num(n);if(typeof n==='number'){const unit=document.createElement('small');unit.textContent=n<1000?'ms':'s';el(id).append(unit);}}
 function draw(v){
  current=v;el('state').textContent=labels[v.state]||v.state;stat('delay',v.delay);stat('p95',v.p95);el('hit').textContent=typeof v.hit==='number'?Math.round(v.hit*100)+'%':'—';
  el('reason').textContent=v.title||'等待操作';el('reason').title=v.title||'';
  for(const cell of cells){const found=v.stages.filter(p=>cell.names.includes(p.name)&&typeof p.ms==='number'),n=found.length?found.reduce((s,p)=>s+p.ms,0):null;cell.value.textContent=num(n)+(n===null?'':n<1000?' ms':' s');cell.bar.style.width=n===null?'0%':Math.min(100,n/Math.max(1,v.delay||0)*100)+'%';cell.row.title=found.map(p=>p.label+'：'+p.note).join('\n');}
  for(const id of ['ramTotal','ramVideo','diskTotal','diskVideo']){const n=v.resources?.[id];el(id).textContent=Number.isFinite(n)?n>=1024**3?(n/1024**3).toFixed(2)+' GiB':(n/1024**2).toFixed(1)+' MiB':'—';}
  const other=v.stages.find(p=>p.name==='other')?.ms;el('message').textContent=other>10?'未归因 '+num(other)+(other<1000?' ms':' s'):'';

 }
 function send(action){if(token)window.opener?.postMessage({channel:'eva-performance',type:'action',action,token},'*');}
 window.addEventListener('message',e=>{if(e.source!==window.opener||e.data?.channel!=='eva-performance')return;if(e.data.type==='hello'&&!token)token=e.data.token;if(e.data.token!==token)return;if(e.data.type==='view')draw(e.data.value);if(e.data.type==='error'){el('message').textContent=e.data.message;el('message').classList.add('error');}});
 el('close').onclick=()=>send('close');
 window.opener?.postMessage({channel:'eva-performance',type:'ready'},'*');
})();
