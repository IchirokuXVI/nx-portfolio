import {get} from './f.mjs'; import fs from 'node:fs';
const r=await get('/agua-y-refrescos/agua/p/85',{accept:'text/html,application/xhtml+xml,*/*;q=0.8'}); console.log(r.status,r.body.length); fs.writeFileSync('pdp.html',r.body);
