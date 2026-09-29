import {get} from './f.mjs'; import fs from 'node:fs';
const r=await get('/tiendas/buscador-tiendas-folletos',{accept:'text/html,*/*'}); fs.writeFileSync('stores.html',r.body); console.log(r.status,r.body.length, r.headers.get('location'));
