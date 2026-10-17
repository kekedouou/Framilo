'use strict';
const fs=require('fs'),path=require('path');const{store,sha}=require('./workspace.cjs');
function summarize(){
  const records=store(),rows=[],receipts=[];
  for(const name of fs.readdirSync(records.root).filter(n=>n.endsWith('.jsonl'))){const bytes=fs.readFileSync(path.join(records.root,name));
    if(!bytes.length||bytes[bytes.length-1]!==10)throw Error('Incomplete evidence retained: '+name);
    const lines=bytes.toString('utf8').trim().split('\n').map(JSON.parse);receipts.push({file:name,bytes:bytes.length,sha256:sha(bytes)});
    for(const x of lines)if(x.format&&x.source)rows.push({...x,block:name});
  }
  const groups=[];
  for(const key of [...new Set(rows.map(x=>x.block+'/'+x.source+'/'+x.height+'/'+x.format))]){
    const entries=rows.filter(x=>x.block+'/'+x.source+'/'+x.height+'/'+x.format===key),first=entries[0];
    const average=field=>entries.reduce((n,x)=>n+x[field],0)/entries.length;
    groups.push({block:first.block,source:first.source,height:first.height,format:first.format,rounds:entries.length,frames:first.count,
      encodedMiB:first.encodedBytes/1024**2,encodeMeanMs:average('encodeMs'),decodeMeanMs:average('decodeMs'),
      exact:entries.every(x=>x.exactFrames===x.count),firstRoundMae:first.differences.map(x=>x.mae)});
  }
  const result={schema:'eva-quality-readback-v1',groups,receipts,limitations:['Short windows and one registered full source are separate blocks; sequential backendRGB comparisons are not randomCanvas latency, full preparation or user acceptance.']};
  return result;
}
if(require.main===module)console.log(JSON.stringify(summarize().groups,null,2));module.exports={summarize};
