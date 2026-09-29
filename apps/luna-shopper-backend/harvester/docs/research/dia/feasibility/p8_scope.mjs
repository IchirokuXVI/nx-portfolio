// price scope: fresh session per postal code, set postal code, walk 4 leaf categories
import {get,cookies} from './f.mjs'; import fs from 'node:fs';
const cats=['/carnes/cerdo/c/L2014','/huevos-leche-y-mantequilla/leche/c/L2051','/aceites-salsas-y-especias/aceites/c/L2046','/frutas/frutas-de-temporada/c/L2040'];
const pcs=(process.argv[2]||'none 28001 08001 41001 46001 15001 48001 35001 07001 29001 50001 06800 30800 10600 44200').split(' ');
const base=cookies(); const akamai={}; for(const k of ['AKA_A2','h163j1mz','ak_bmsc','bm_sz','_abck','bm_sv']) if(base[k]) akamai[k]=base[k];
const res=fs.existsSync('scope.json')?JSON.parse(fs.readFileSync('scope.json')):{};
for(const pc of pcs){
  const jar={...akamai};
  const upd=r=>{for(const c of r.setCookies){const [kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i)]=kv.slice(i+1);}};
  let r=await get('/api/v1/common-aggregator/header-data',{jar}); upd(r);
  const info={session:jar.session_id};
  if(pc!=='none'){ r=await get('/api/v1/common-aggregator/save-shipping-address?new_postal_code='+pc,{jar,method:'PUT',headers:{'content-type':'application/json'},body:'null'}); upd(r); info.put=r.status; info.putBody=r.body.slice(0,300);
    r=await get('/api/v1/common-aggregator/header-data',{jar}); upd(r); try{info.cart=JSON.parse(r.body).cart}catch{} }
  else { try{info.cart=JSON.parse(r.body).cart}catch{} }
  const items={}; const totals={};
  for(const c of cats){ let page=1,tp=1; do{ r=await get('/api/v1/plp-back/reduced'+c+'?page='+page,{jar}); upd(r);
      if(r.status!==200){info['err_'+c]=r.status;break;} const j=JSON.parse(r.body); tp=j.pagination.total_pages; totals[c]=j.total_items;
      for(const it of j.plp_items) items[it.sku_id]={p:it.prices.price,ppu:it.prices.price_per_unit,st:it.prices.strikethrough_price,promo:it.prices.is_promo_price,club:it.prices.is_club_price,stock:it.units_in_stock,name:it.display_name};
      page++; } while(page<=tp); }
  res[pc]={info,totals,items}; console.log(pc,JSON.stringify(info.cart),info.put,JSON.stringify(totals),Object.keys(items).length);
  fs.writeFileSync('scope.json',JSON.stringify(res));
}
