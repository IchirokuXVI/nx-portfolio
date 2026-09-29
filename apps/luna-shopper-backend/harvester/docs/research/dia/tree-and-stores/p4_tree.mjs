// per node listing page 1 in es and en sessions: counts, canonical urls, names. writes nodes_<lang>.json
import {get} from './f.mjs'; import fs from 'node:fs';
const lang=process.argv[2];
const jar={}; const upd=r=>{for(const c of r.setCookies){const [kv]=c.split(';');const i=kv.indexOf('=');jar[kv.slice(0,i).trim()]=kv.slice(i+1);}};
let r=await get('/api/v1/common-aggregator/header-data',{jar}); upd(r);
if(lang==='en'){ r=await get('/api/v1/common-aggregator/current/locale',{jar,method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({locale:'en'})}); upd(r); console.log('patch',r.status); }
r=await get('/api/v1/common-aggregator/menu-data',{jar}); upd(r); fs.writeFileSync(`menu_${lang}_run.json`,r.body);
const menu=JSON.parse(r.body); const es=JSON.parse(fs.readFileSync('menu_es.json','utf8'));
const out={tops:{},leaves:{}};
for(const c of menu.categories){ r=await get(`/api/v1/plp-back/l1/all/${c.id}/reduced`,{jar}); upd(r);
  let j={}; try{j=JSON.parse(r.body)}catch{} out.tops[c.id]={status:r.status,menuName:c.name,menuLink:c.link,total:j.total_items,seo:j.seo&&j.seo.h1,locale:j.locale}; console.log(lang,c.id,r.status,j.total_items,j.seo&&j.seo.h1); }
// leaves: menu leaves (non Todo) plus hidden sitemap leaves (Spanish links)
const todo=[]; for(const c of menu.categories) for(const x of c.children) if(x.id!==c.id) todo.push({id:x.id,parent:c.id,name:x.name,link:x.link,hidden:false});
const seen=new Set(todo.map(t=>t.id));
for(const l of fs.readFileSync('../dia/leaves.txt','utf8').trim().split('\n').map(s=>s.trim())){ const id=l.split('/c/')[1]; if(!seen.has(id)){seen.add(id); todo.push({id,parent:null,name:null,link:l,hidden:true});} }
for(const t of todo){ let path=t.link, hops=[];
  for(let k=0;k<3;k++){ r=await get('/api/v1/plp-back/reduced'+path+'?page=1',{jar}); upd(r); if(r.status===301||r.status===302){ path=r.headers.get('location'); hops.push(path); continue;} break; }
  let j={}; try{j=JSON.parse(r.body)}catch{}
  out.leaves[t.id]={...t,status:r.status,hops,canonical:j.current_category_url,selected:j.selected_category_id,total:j.total_items,seoName:j.seo&&j.seo.current_category_name,h1:j.seo&&j.seo.h1,locale:j.locale,firstSkus:(j.plp_items||[]).map(i=>i.sku_id).slice(0,5)};
  console.log(lang,t.id,r.status,hops.length,j.total_items,j.current_category_url);
}
fs.writeFileSync(`nodes_${lang}.json`,JSON.stringify(out,null,1));
