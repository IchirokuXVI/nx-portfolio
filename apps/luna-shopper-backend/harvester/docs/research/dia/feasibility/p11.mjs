import {get} from './f.mjs'; import fs from 'node:fs';
const html=fs.readFileSync('pdp.html','utf8');
for(const p of [...new Set(html.match(/\/pdp-front\/assets\/[^"']+\.js/g))]){ const r=await get(p,{accept:'*/*'}); fs.writeFileSync('jsp/'+p.split('/').pop(), r.body); }
