// full walk of every current menu leaf plus hidden sitemap leaves, using canonical paths from nodes_es.json; plus the offers listing
import {get} from './f.mjs'; import fs from 'node:fs';
const nodes=JSON.parse(fs.readFileSync('nodes_es.json','utf8'));
const jar={}; const upd=r=>{for(const c of r.setCookies){const [kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i).trim()]=kv.slice(i+1);}};
let r=await get('/api/v1/common-aggregator/header-data',{jar}); upd(r);
const items={}, cats={}, errs=[]; let req=0; const t0=Date.now();
const add=(it,c)=>{ const e=(items[it.sku_id] ||= {sku:it.sku_id,name:it.display_name,url:it.url,prices:it.prices,promotions:it.promotions||[],weight:it.weight,avg:it.average_weight,wig:it.weight_in_grams,cats:[]}); if(!e.cats.includes(c)) e.cats.push(c); };
for(const [id,n] of Object.entries(nodes.leaves)){ if(!n.canonical){errs.push([id,'nocanon',n.status]);continue;}
  let page=1,tp=1;
  do{ r=await get('/api/v1/plp-back/reduced'+n.canonical+'?page='+page,{jar}); upd(r); req++;
    if(r.status!==200||r.body[0]!=='{'){errs.push([id,page,r.status,r.headers.get('location')]);break;}
    const j=JSON.parse(r.body); tp=j.pagination.total_pages; cats[id]={total:j.total_items,pages:tp,hidden:n.hidden};
    for(const it of j.plp_items) add(it,id); page++; } while(page<=tp);
  if(req%40===0) console.log(req,Object.keys(items).length,((Date.now()-t0)/1000|0)+'s');
}
// offers
let page=1,tp=1; const offers=[]; let first=null;
do{ r=await get('/api/v1/plp-back/offers/reduced?page='+page,{jar}); upd(r); req++; if(r.status!==200||r.body[0]!=='{'){errs.push(['offers',page,r.status,r.body.slice(0,100)]);break;}
  const j=JSON.parse(r.body); if(!first){first=Object.keys(j); fs.writeFileSync('offers_p1.json',r.body);} const list=j.plp_items||j.items||[]; tp=(j.pagination&&j.pagination.total_pages)||1;
  for(const it of list){offers.push(it.sku_id); add(it,'OFFERS');} page++; } while(page<=tp && page<60);
console.log('offers keys',first,'offers',offers.length);
fs.writeFileSync('walk2.json',JSON.stringify({req,secs:(Date.now()-t0)/1000,errs,cats,offers,items}));
console.log({req,secs:(Date.now()-t0)/1000,errs,leaves:Object.keys(cats).length,unique:Object.keys(items).length});
