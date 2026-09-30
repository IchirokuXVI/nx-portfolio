// store finder probes: gz version, guessed search actions, check-service, detail samples of both tipoTienda values
import {get} from './f.mjs'; import fs from 'node:fs';
const log=[]; const L=(...a)=>{console.log(...a); log.push(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '));};
let r=await get('/tiendas/buscador-tiendas-folletos',{accept:'text/html'}); const gz=(r.body.match(/id="gz"[^>]*value="([^"]+)"/)||[])[1]; L('folletos page',r.status,'gz',gz);
fs.writeFileSync('stores_folletos.html',r.body);
r=await get('/tiendas/buscador-tiendas',{accept:'text/html'}); L('buscador-tiendas page',r.status,r.body.length,(r.body.match(/negocioCheckBox[\s\S]{0,300}/g)||[]).join(' || ').replace(/\s+/g,' ').slice(0,800)); fs.writeFileSync('stores_buscador.html',r.body);
const guesses=['/tiendas/buscadorTiendas.html?action=buscarTiendas&codigoPostal=28041','/tiendas/buscadorTiendas.html?action=buscarTiendasCP&cp=28041','/tiendas/buscadorTiendas.html?action=buscarTiendasCercanas&lat=40.37&lon=-3.69','/api/v1/common-aggregator/stores?postal_code=28041'];
for(const u of guesses){ r=await get(u); L('guess',u,r.status,r.body.slice(0,160).replace(/\s+/g,' ')); }
for(const pc of ['28041','08001','41001','21730','29380','44559','50001']){ r=await get('/api/v1/common-aggregator/check-service?postal_code='+pc); L('check-service',pc,r.status,r.body.trim()); }
const t=JSON.parse(fs.readFileSync('../dia/tiendas.json','utf8'));
const pick=[]; const want={'0':8,'1':8}; const shuffled=t.map((s,i)=>[((i*2654435761)%4294967296),s]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
for(const s of shuffled){ if(want[s.tipoTienda]>0){want[s.tipoTienda]--; pick.push(s);} }
pick.push(...t.filter(s=>[1003554,1003553,1003560].includes(s.idTienda)));
pick.push(...t.filter(s=>s.tipoTienda===0&&!s.tieneFolleto).slice(0,3));
const out=[];
for(const s of pick){ r=await get('/tiendas/buscadorTiendas.html?action=buscarInformacionTienda&id='+s.idTienda); let j=null; try{j=JSON.parse(r.body)}catch{}
  out.push({file:s,status:r.status,detail:j}); L('detail',s.idTienda,s.codigoTienda,'tipo',s.tipoTienda,'prov',s.codigoProvincia,r.status,j&&[j.tipoTienda,j.tipoTiendaId,j.tipoTiendaDescripcion,j.codigoPostal,j.localidad,j.tiendaCodigo].join('|')); }
fs.writeFileSync('store_details_sample.json',JSON.stringify(out,null,1)); fs.writeFileSync('p6.log',log.join('\n'));
