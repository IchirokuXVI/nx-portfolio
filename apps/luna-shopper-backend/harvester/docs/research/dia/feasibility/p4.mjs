import {get} from './f.mjs'; import fs from 'node:fs';
const base='/api/v1/plp-back/reduced/carnes/cerdo/c/L2014';
for (const q of ['?page_size=100','?pageSize=100','?size=100','?items_per_page=100','?limit=100','?rows=100','/pag-2']){
 const r=await get(base+q); let s=''; try{const j=JSON.parse(r.body); s=JSON.stringify(j.pagination)+' n='+j.plp_items?.length;}catch{s=r.body.slice(0,100)}
 console.log(r.status,q,s);
}
const m=await get('/api/v1/common-aggregator/menu-data'); console.log('menu',m.status,m.body.length); fs.writeFileSync('menu.json',m.body);
