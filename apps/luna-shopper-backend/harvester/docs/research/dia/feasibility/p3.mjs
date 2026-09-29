import {get} from './f.mjs'; import fs from 'node:fs';
for (const u of ['/api/v1/plp-back/reduced/carnes/cerdo/c/L2014','/api/v1/plp-back/carnes/cerdo/c/L2014','/api/v1/plp-back/reduced/carnes/cerdo/c/L2014?page=2']){
 const r=await get(u); console.log(r.status,u,r.body.length, r.body.slice(0,300).replace(/\s+/g,' '));
 fs.writeFileSync('o_'+u.replace(/[^a-z0-9]/gi,'_')+'.json', r.body);
}
