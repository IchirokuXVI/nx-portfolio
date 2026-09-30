import {get} from './f.mjs'; import fs from 'node:fs';
const r = await get('/carnes/cerdo/c/L2014',{accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'});
console.log(r.status, r.body.length, r.setCookies.map(c=>c.split(';')[0].slice(0,40)));
fs.writeFileSync('cat.html', r.body);
