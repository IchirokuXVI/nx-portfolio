import {get} from './f.mjs'; import fs from 'node:fs';
for(const p of ['/tiendas/js/shopFinder.js?5.146.0','/tiendas/js/commons.js?5.146.0']){const r=await get(p,{accept:'*/*'}); fs.writeFileSync(p.split('/').pop().split('?')[0],r.body); console.log(p,r.status,r.body.length);}
