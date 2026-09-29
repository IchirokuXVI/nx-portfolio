import fs from 'node:fs'; import zlib from 'node:zlib';
const cur=JSON.parse(fs.readFileSync('menu_es.json','utf8'));
const curIds=new Map(); cur.categories.forEach(c=>{curIds.set(c.id,c.name);c.children.forEach(x=>curIds.set(x.id,x.name))});
for(const f of ['wb_2024-12','wb_2025-10']){
  const b=fs.readFileSync(f+'.html'); let t; try{t=zlib.gunzipSync(b).toString()}catch{try{t=zlib.brotliDecompressSync(b).toString()}catch{t=b.toString()}}
  fs.writeFileSync(f+'.txt',t);
  const re=/"id":"(L\d+)","level":\d+,"link":"([^"]*)","name":"([^"]*)"/g; const m=new Map(); let x; while((x=re.exec(t))) m.set(x[1],[x[2],x[3]]);
  const re2=/\/c\/(L\d+)/g; const s=new Set(); while((x=re2.exec(t))) s.add(x[1]);
  console.log(f,'len',t.length,'menu nodes',m.size,'c/L links',s.size);
  const ids=m.size?m:new Map([...s].map(i=>[i,['','']]));
  console.log(' gone since:',[...ids].filter(([i])=>!curIds.has(i)).map(([i,v])=>i+' '+v.join(' ')).join(' | '));
  console.log(' new since:',[...curIds].filter(([i])=>!ids.has(i)).map(([i,n])=>i+' '+n).join(' | '));
  const renamed=[...ids].filter(([i,v])=>curIds.has(i)&&v[1]&&v[1]!==curIds.get(i)).map(([i,v])=>i+' '+v[1]+' -> '+curIds.get(i)); console.log(' renamed:',renamed.join(' | '));
}
