import {get} from './f.mjs'; import fs from 'node:fs';
const html=fs.readFileSync('cat.html','utf8');
const paths=[...new Set(html.match(/\/plp-front\/assets\/[^"']+\.js/g))];
for(const p of paths){ const r=await get(p,{accept:'*/*'}); fs.writeFileSync('js/'+p.split('/').pop(), r.body); }
