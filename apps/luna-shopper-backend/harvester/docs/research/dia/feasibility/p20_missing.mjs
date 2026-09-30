// pdp for sitemap ids absent from both walks
import {get} from './f.mjs'; import fs from 'node:fs';
const miss=JSON.parse(fs.readFileSync('sitemap_missing.json')); const urls=fs.readFileSync('../urls.txt','utf8').split(/\s+/);
const step=Math.floor(miss.length/12); const out=[];
for(let i=0;i<12;i++){const id=miss[i*step]; const u=urls.find(x=>x.endsWith('/p/'+id)).replace('https://www.dia.es','');
 const r=await get(`/api/v1/pdp-back/${id}?path=${encodeURIComponent(u)}`,{redirect:'manual'}); let j={}; try{j=JSON.parse(r.body)}catch{}
 out.push({id,status:r.status,loc:r.headers.get('location'),stock:j.product?.units_in_stock,price:j.product?.prices?.price,name:j.product?.primary_info?.title}); console.log(JSON.stringify(out.at(-1)));}
