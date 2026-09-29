import {get} from './f.mjs'; import fs from 'node:fs';
const jar={}; const upd=r=>{for(const c of r.setCookies){const [kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i).trim()]=kv.slice(i+1);}};
let r=await get('/api/v1/common-aggregator/header-data',{jar}); upd(r);
const all=[]; let q=''; let total;
for(let k=0;k<30;k++){ r=await get('/api/v1/plp-back/offers/reduced'+q,{jar}); upd(r); const j=JSON.parse(r.body); total=j.total_items;
  for(const g of j.plp_items) for(const it of g.items) all.push({cat:g.category_id,sku:it.sku_id,name:it.display_name,prices:it.prices,promotions:it.promotions||[]});
  console.log(q,j.plp_items.map(g=>g.category_id+':'+g.items.length).join(' '),JSON.stringify(j.pagination));
  if(!j.pagination.next_page) break; q='?categories='+j.pagination.next_page; }
fs.writeFileSync('offers_all.json',JSON.stringify({total,items:all}));
console.log('total',total,'got',all.length,'unique',new Set(all.map(a=>a.sku)).size);
