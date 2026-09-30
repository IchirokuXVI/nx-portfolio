import {get} from './f.mjs'; import fs from 'node:fs';
const tries=[
 ['es','/api/v1/common-aggregator/menu-data',{}],
 ['q_locale_en','/api/v1/common-aggregator/menu-data?locale=en',{}],
 ['q_lang_en','/api/v1/common-aggregator/menu-data?lang=en',{}],
 ['al_en','/api/v1/common-aggregator/menu-data',{headers:{'Accept-Language':'en-GB,en;q=0.9'}}],
 ['en_path','/en/api/v1/common-aggregator/menu-data',{}],
];
for(const [n,u,o] of tries){ const r=await get(u,o); fs.writeFileSync('menu_'+n+'.json',r.body); console.log(n,r.status,r.body.length,r.body.slice(0,200)); }
