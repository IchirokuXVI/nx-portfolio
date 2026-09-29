import fs from 'node:fs';
const cur=JSON.parse(fs.readFileSync('menu_es.json','utf8'));
const par=new Map(), link=new Map(); cur.categories.forEach(c=>{par.set(c.id,null);link.set(c.id,c.link);c.children.forEach(x=>{if(x.id!==c.id){par.set(x.id,c.id);link.set(x.id,x.link)}})});
const leafCount=[...par.values()].filter(v=>v).length;
for(const f of ['wb_2024-12','wb_2025-10']){
  const L=fs.readFileSync(f+'.links','utf8').trim().split('\n').map(l=>{const m=l.match(/^(.*)\/c\/(L\d+)$/);return {path:m[1],id:m[2]}}).filter(x=>x.path.split('/').length<=3);
  const byId=new Map(); L.forEach(x=>byId.set(x.id,x.path));
  const oldLeaves=[...byId].filter(([i,p])=>p.split('/').length===3);
  const oldTops=[...byId].filter(([i,p])=>p.split('/').length===2);
  const surv=oldLeaves.filter(([i])=>par.has(i)&&par.get(i));
  let sameSlug=0, topMoved=0; const moved=[];
  for(const [i,p] of surv){ if(link.get(i)===p+'/c/'+i) sameSlug++; const oldTop=p.split('/')[1]; const newTop=link.get(i).split('/')[1]; if(oldTop!==newTop){topMoved++; moved.push(i+' '+p+' -> '+link.get(i));} }
  console.log(f,'old tops',oldTops.length,'old leaves',oldLeaves.length,'surviving ids',surv.length,'same full slug',sameSlug,'top slug changed',topMoved,'current leaves',leafCount,'current leaves absent then',[...par].filter(([i,p])=>p&&!byId.has(i)).length);
  console.log(' old tops:',oldTops.map(([i,p])=>i+p).join(' '));
  console.log(' sample moved:',moved.slice(0,8).join(' | '));
}
