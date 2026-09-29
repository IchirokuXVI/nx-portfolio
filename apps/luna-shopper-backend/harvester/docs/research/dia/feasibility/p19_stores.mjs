// sample store details across provinces and both tipoTienda values
import {get} from './f.mjs'; import fs from 'node:fs';
const a=JSON.parse(fs.readFileSync('tiendas.json'));
const pick=[]; const seen=new Set();
for(const s of a){const k=s.codigoProvincia+'_'+s.tipoTienda; if(!seen.has(k)){seen.add(k);pick.push(s);} }
const sample=pick.filter((_,i)=>i%2===0).slice(0,45);
const out=[];
for(const s of sample){const r=await get('/tiendas/buscadorTiendas.html?action=buscarInformacionTienda&id='+s.idTienda); let j={}; try{j=JSON.parse(r.body)}catch{}
  out.push({id:s.idTienda,code:s.codigoTienda,prov:s.codigoProvincia,tipo:s.tipoTienda,folleto:s.tieneFolleto,status:r.status,desc:j.tipoTiendaDescripcion,tipoId:j.tipoTiendaId,doc:j.documentoFolletoId,folletoId:j.folletoId,valid:j.validezFolleto2,cp:j.codigoPostal,loc:j.localidad});
  console.log(JSON.stringify(out.at(-1)));}
fs.writeFileSync('store_sample.json',JSON.stringify(out,null,1));
