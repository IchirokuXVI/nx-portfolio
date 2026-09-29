import {get} from './f.mjs'; import fs from 'node:fs';
const out={};
for(const id of ['1003554','1003553','1003687','1001008']){const r=await get('/tiendas/buscadorTiendas.html?action=buscarInformacionTienda&id='+id); out[id]={s:r.status,b:r.body}; let j={};try{j=JSON.parse(r.body)}catch{}; console.log(id,r.status,j.tipoTiendaDescripcion,j.tipoTiendaId,j.localidad,j.codigoPostal,j.direccionPostal,JSON.stringify(j.horariosTienda),j.validezFolleto2,j.folletoId);}
fs.writeFileSync('store_details2.json',JSON.stringify(out,null,1));
const f=await get('/tiendas/folletos?t=50025',{accept:'text/html,*/*'}); fs.writeFileSync('folleto.html',f.body); console.log('folleto',f.status,f.body.length);
