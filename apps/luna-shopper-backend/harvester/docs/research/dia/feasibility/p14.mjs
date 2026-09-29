import {get} from './f.mjs'; import fs from 'node:fs';
const r=await get('/',{accept:'text/html,*/*'}); fs.writeFileSync('home.html',r.body); console.log(r.status,r.body.length);
