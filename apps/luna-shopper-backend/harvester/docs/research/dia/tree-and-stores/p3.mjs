import {get} from './f.mjs'; import fs from 'node:fs';
const jar=JSON.parse(fs.readFileSync('jar_en.json','utf8'));
const upd=r=>{for(const c of r.setCookies){const [kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i).trim()]=kv.slice(i+1);}};
for(const u of ['/api/v1/plp-back/reduced/en/meats/pork/c/L2014?page=1','/api/v1/plp-back/reduced/en/butchery/chicken/c/L2202?page=1','/api/v1/plp-back/reduced/en/meats/chicken/c/L2202?page=1']){
 const r=await get(u,{jar}); upd(r); console.log(u,r.status,r.headers.get('location'),r.body.slice(0,400));
 if(r.status===200) fs.writeFileSync('plp_en_'+u.split('/c/')[1].slice(0,5)+'.json',r.body);
}
fs.writeFileSync('jar_en.json',JSON.stringify(jar));
