import {get,cookies} from './f.mjs'; import fs from 'node:fs';
const jar={}; const upd=r=>{for(const c of r.setCookies){console.log('  set-cookie',c.slice(0,160));const [kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i).trim()]=kv.slice(i+1);}};
let r=await get('/api/v1/common-aggregator/header-data',{jar}); upd(r); console.log('header',r.status);
r=await get('/api/v1/common-aggregator/current/locale',{jar,method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({locale:'en'})}); upd(r); console.log('patch',r.status,r.body.slice(0,300));
r=await get('/api/v1/common-aggregator/menu-data',{jar}); upd(r); console.log('menu',r.status,r.body.length,r.body.slice(0,300)); fs.writeFileSync('menu_en.json',r.body);
r=await get('/api/v1/plp-back/reduced/carnes/cerdo/c/L2014?page=1',{jar,headers:{'Accept-Language':'en-GB,en;q=0.9'}}); upd(r); console.log('plp',r.status,r.body.slice(0,300)); fs.writeFileSync('plp_en_L2014.json',r.body);
fs.writeFileSync('jar_en.json',JSON.stringify(jar));
