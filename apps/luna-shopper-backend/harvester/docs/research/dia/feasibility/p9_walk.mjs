// full listing walk over every leaf category; argv[2]=postal code or none; writes walk_<pc>.json
import {get,cookies} from './f.mjs'; import fs from 'node:fs';
const pc=process.argv[2]||'none'; const leaves=fs.readFileSync('leaves.txt','utf8').trim().split('\n');
const base=cookies(); const jar={}; for(const k of ['AKA_A2','h163j1mz','ak_bmsc','bm_sz','_abck','bm_sv']) if(base[k]) jar[k]=base[k];
const upd=r=>{for(const c of r.setCookies){const [kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i)]=kv.slice(i+1);}};
let r=await get('/api/v1/common-aggregator/header-data',{jar}); upd(r);
if(pc!=='none'){ r=await get('/api/v1/common-aggregator/save-shipping-address?new_postal_code='+pc,{jar,method:'PUT',headers:{'content-type':'application/json'},body:'null'}); upd(r); console.log('put',r.status); }
const items={}, cats={}, errs=[]; let req=0; const t0=Date.now(); const keys=new Set();
for(const c of leaves){ let page=1,tp=1;
  do{ r=await get('/api/v1/plp-back/reduced'+c+'?page='+page,{jar,redirect:'manual'}); upd(r); req++; if(r.status===200 && r.body[0]!=='{'){errs.push([c,page,'html']);break;}
    if(r.status!==200){errs.push([c,page,r.status,r.headers.get('location')]); break;}
    const j=JSON.parse(r.body); tp=j.pagination.total_pages; cats[c]={total:j.total_items,pages:tp,selected:j.selected_category_id};
    for(const it of j.plp_items){ Object.keys(it).forEach(k=>keys.add(k)); Object.keys(it.prices||{}).forEach(k=>keys.add('prices.'+k)); (items[it.sku_id] ||= {...it,cats:[]}).cats.push(c); }
    page++; } while(page<=tp);
  if(req%50<2) console.log(req,Object.keys(items).length,((Date.now()-t0)/1000).toFixed(0)+'s');
}
fs.writeFileSync(`walk_${pc}.json`,JSON.stringify({pc,req,secs:(Date.now()-t0)/1000,errs,cats,keys:[...keys],items}));
const sum=Object.values(cats).reduce((a,b)=>a+b.total,0);
console.log({pc,req,secs:(Date.now()-t0)/1000,errs:errs.length,leaves:Object.keys(cats).length,sumTotals:sum,unique:Object.keys(items).length}); console.log(errs.slice(0,10));
