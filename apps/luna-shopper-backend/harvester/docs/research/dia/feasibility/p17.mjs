import {get} from './f.mjs'; import fs from 'node:fs';
const out={};
for(const id of ['1443','13835','959','2354','50025']){const r=await get('/tiendas/buscadorTiendas.html?action=buscarInformacionTienda&id='+id); out[id]={s:r.status,b:r.body}; console.log(id,r.status,r.body.slice(0,900));}
fs.writeFileSync('store_details.json',JSON.stringify(out,null,1));
