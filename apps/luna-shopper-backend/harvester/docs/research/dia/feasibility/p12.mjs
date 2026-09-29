import {get} from './f.mjs'; import fs from 'node:fs';
for(const [id,path] of [['85','/agua-y-refrescos/agua/p/85'],['166223','/carnes/cerdo/p/166223']]){
 const r=await get(`/api/v1/pdp-back/${id}?path=${encodeURIComponent(path)}`); console.log(r.status,r.body.length); fs.writeFileSync(`pdp_${id}.json`,r.body);}
const r2=await get(`/api/v1/pdp-back/85`); console.log('nopath',r2.status,r2.body.length);
