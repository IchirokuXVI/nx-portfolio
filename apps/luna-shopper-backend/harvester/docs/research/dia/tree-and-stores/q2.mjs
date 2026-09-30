import fs from 'node:fs';
const w=JSON.parse(fs.readFileSync('walk2.json','utf8')); const mes=JSON.parse(fs.readFileSync('menu_es.json','utf8')); const nes=JSON.parse(fs.readFileSync('nodes_es.json','utf8'));
const name=new Map(); const par=new Map(); mes.categories.forEach(c=>{name.set(c.id,c.name);c.children.forEach(x=>{if(x.id!==c.id){name.set(x.id,x.name);par.set(x.id,c.id)}})});
for(const [id,l] of Object.entries(nes.leaves)) if(l.hidden) name.set(id,'(hidden) '+l.canonical);
name.set('OFFERS','Ofertas listing (L150)');
const menuLeaves=[...par.keys()]; const hidden=Object.entries(nes.leaves).filter(([i,l])=>l.hidden).map(([i])=>i);
const CLEAR=['L2302','L2352','L2328','L2350','L2351','L2303','L2040',...hidden];
const BORDER=['L2200','L2274','L2323','L2267','L2119','L2340','L2286','L2292','L2293','L2268','L2106','L2139','L2314','L2315','L2316','L2229','L2322','L2261','L2262'];
const items=Object.values(w.items); const skusOf=c=>items.filter(i=>i.cats.includes(c));
const clearSet=new Set(CLEAR);
const report=(c,excl)=>{ const s=skusOf(c); const kept=s.filter(i=>i.cats.some(k=>k!==c&&!excl.has(k))); const where={}; kept.forEach(i=>i.cats.filter(k=>k!==c&&!excl.has(k)).forEach(k=>where[k]=(where[k]||0)+1));
  const top=Object.entries(where).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>`${k} ${name.get(k)} ${v}`);
  const orph=s.filter(i=>!i.cats.some(k=>k!==c&&!excl.has(k)));
  return {id:c,name:name.get(c),skus:s.length,alsoInKept:kept.length,pct:s.length?+(100*kept.length/s.length).toFixed(1):null,orphans:orph.length,orphanEx:orph.slice(0,4).map(i=>i.sku+' '+i.name),top}; };
const out={clear:[],border:[],orphansClear:null,orphansAll:null,highOverlapKept:[]};
for(const c of CLEAR) out.clear.push(report(c,clearSet));
for(const c of BORDER) out.border.push(report(c,clearSet));
const orph=items.filter(i=>i.cats.every(k=>clearSet.has(k)));
const byCat={}; orph.forEach(i=>i.cats.forEach(k=>byCat[k]=(byCat[k]||0)+1));
out.orphansClear={count:orph.length,of:items.length,byCat,examples:orph.slice(0,25).map(i=>({sku:i.sku,name:i.name,url:i.url,cats:i.cats}))};
const allSet=new Set([...CLEAR,...BORDER]); const orph2=items.filter(i=>i.cats.every(k=>allSet.has(k)));
out.orphansAll={count:orph2.length,examples:orph2.slice(0,10).map(i=>i.sku+' '+i.name+' '+i.cats.join(','))};
// any kept menu leaf whose SKUs are mostly duplicated in other kept leaves
for(const c of menuLeaves){ if(clearSet.has(c)) continue; const r=report(c,clearSet); if(r.skus>=3&&r.pct>=50) out.highOverlapKept.push(r); }
out.highOverlapKept.sort((a,b)=>b.pct-a.pct);
// distribution of how many leaves an sku sits in (menu leaves only)
const d={}; items.forEach(i=>{const n=i.cats.filter(k=>par.has(k)).length; d[n]=(d[n]||0)+1}); out.leavesPerSku=d;
out.menuLeavesEmpty=menuLeaves.filter(c=>!w.cats[c]||w.cats[c].total===0);
fs.writeFileSync('drop-analysis.json',JSON.stringify(out,null,1));
const p=r=>console.log(`${r.id} ${r.name}: ${r.skus} skus, ${r.alsoInKept} (${r.pct}%) also in a kept leaf, orphans ${r.orphans}${r.orphans?' e.g. '+r.orphanEx.join('; '):''}\n     top: ${r.top.join(' | ')}`);
console.log('== CLEAR'); out.clear.forEach(p); console.log('== BORDER'); out.border.forEach(p);
console.log('orphans clear',out.orphansClear.count,'of',items.length,JSON.stringify(byCat)); out.orphansClear.examples.forEach(e=>console.log('  ',e.sku,e.name,e.cats.join(',')));
console.log('orphans clear+border',out.orphansAll.count); console.log('leaves per sku',d,'empty menu leaves',out.menuLeavesEmpty);
console.log('== kept leaves with >=50% overlap'); out.highOverlapKept.forEach(p);
