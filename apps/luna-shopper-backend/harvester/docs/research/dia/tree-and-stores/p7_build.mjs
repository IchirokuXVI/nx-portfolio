import fs from 'node:fs';
const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const mes=rd('menu_es.json'), men=rd('menu_en.json'), nes=rd('nodes_es.json'), nen=rd('nodes_en.json');
const walk=fs.existsSync('walk2.json')?rd('walk2.json'):null;
const seg=l=>l?l.replace(/\/c\/L\d+$/,'').split('/').filter(Boolean).pop():null;
const enById=new Map(); men.categories.forEach(c=>{enById.set(c.id,{name:c.name,link:c.link});c.children.forEach(x=>{if(x.id!==c.id)enById.set(x.id,{name:x.name,link:x.link})})});
const out=[]; let ordTop=0;
for(const c of mes.categories){
  const e=enById.get(c.id); let cnt=nes.tops[c.id]&&nes.tops[c.id].total;
  let note;
  if(cnt==null&&walk){ const kids=new Set(c.children.filter(x=>x.id!==c.id).map(x=>x.id)); cnt=Object.values(walk.items).filter(i=>i.cats.some(k=>kids.has(k))).length; note='count is the union of its leaves from the walk; the L1 endpoint answers 301 for this id'; }
  const todo=c.children.find(x=>x.id===c.id);
  out.push({id:c.id,parentId:null,level:1,es:c.name,en:e.name,slugEs:seg(c.link),slugEn:seg(e.link),productCount:cnt,pathEs:c.link,pathEn:e.link,todoEntryEs:todo&&todo.name,todoEntryEn:todo&&(men.categories.find(k=>k.id===c.id).children.find(x=>x.id===c.id)||{}).name,menuOrder:ordTop++,...(note?{note}:{})});
  let ord=0;
  for(const x of c.children){ if(x.id===c.id) continue; const en=enById.get(x.id); const ls=nes.leaves[x.id], le=nen.leaves[x.id];
    const row={id:x.id,parentId:c.id,level:2,es:x.name,en:en.name,slugEs:seg(x.link),slugEn:seg(en.link),productCount:ls&&ls.total,pathEs:x.link,pathEn:en.link,menuOrder:ord++};
    if(ls&&ls.canonical&&ls.canonical!==x.link) row.canonicalEs=ls.canonical;
    if(le&&le.canonical&&le.canonical!==en.link) row.canonicalEn=le.canonical;
    if(le&&ls&&le.total!==ls.total) row.productCountEn=le.total;
    out.push(row);
  }
}
const oe=men.offer_category, os=mes.offer_category;
out.push({id:os.id,parentId:null,level:1,es:os.name,en:oe.name,slugEs:'ofertas',slugEn:seg(oe.link),productCount:walk?walk.offers.length:null,pathEs:os.link,pathEn:oe.link,kind:'offers',note:'offer_category of menu-data, a promotions listing (/api/v1/plp-back/offers/reduced), not a branch of the tree'});
for(const [id,ls] of Object.entries(nes.leaves)){ if(!ls.hidden) continue; const le=nen.leaves[id];
  out.push({id,parentId:null,level:2,es:null,en:null,slugEs:seg(ls.canonical),slugEn:le&&seg(le.canonical),productCount:ls.total,pathEs:ls.canonical,pathEn:le&&le.canonical,hidden:true,parentSlugEs:ls.canonical.split('/')[1],parentSlugEn:le&&le.canonical&&le.canonical.split('/')[2],note:'not in menu-data; listed only in sitemap.xml and still answering; names are not served for hidden nodes'}); }
fs.writeFileSync('category-tree.json',JSON.stringify(out,null,1));
let txt='DIA category tree, fetched 2026-09-29 from /api/v1/common-aggregator/menu-data (es and en sessions)\nformat: id  es | en  [slugEs | slugEn]  (products)\n\n';
for(const r of out.filter(r=>!r.hidden)){ txt+=(r.level===1?'':'    ')+`${r.id}  ${r.es} | ${r.en}  [${r.slugEs} | ${r.slugEn}]  (${r.productCount??'?'})${r.canonicalEn?'  canonicalEn='+r.canonicalEn:''}${r.canonicalEs?'  canonicalEs='+r.canonicalEs:''}${r.kind?'  <offers listing, not a tree branch>':''}\n`; }
txt+='\nHidden nodes (sitemap only, not in the menu; parent slug shown, no names served):\n';
for(const r of out.filter(r=>r.hidden)) txt+=`    ${r.id}  ${r.pathEs} | ${r.pathEn}  (${r.productCount})\n`;
fs.writeFileSync('category-tree.txt',txt);
console.log('rows',out.length,'tops',out.filter(r=>r.level===1).length,'leaves',out.filter(r=>r.level===2&&!r.hidden).length,'hidden',out.filter(r=>r.hidden).length);
console.log('slugEn missing',out.filter(r=>!r.slugEn).length,'canonicalEn differs',out.filter(r=>r.canonicalEn).length,'canonicalEs differs',out.filter(r=>r.canonicalEs).length,'count en differs',out.filter(r=>r.productCountEn!=null).length);
out.filter(r=>r.canonicalEn).forEach(r=>console.log(r.id,r.pathEn,'->',r.canonicalEn));
