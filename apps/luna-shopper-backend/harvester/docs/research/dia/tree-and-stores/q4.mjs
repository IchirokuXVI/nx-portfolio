import fs from 'node:fs';
const w=JSON.parse(fs.readFileSync('../dia/walk_none.json','utf8'));
const items=Object.values(w.items); console.log('skus',items.length);
const combo={}; const ex={};
for(const it of items){ const p=it.prices||{}; const promos=it.promotions||[];
  const k=`club=${p.is_club_price} promo=${p.is_promo_price} strike=${p.strikethrough_price==null?'null':(p.strikethrough_price===p.price?'eq':(p.strikethrough_price>p.price?'gt':'lt'))} disc=${p.discount_percentage>0?'>0':p.discount_percentage} promos=${promos.length?promos.map(x=>x.only_club_dia?'C':'G').sort().join(''):'-'}`;
  combo[k]=(combo[k]||0)+1; (ex[k] ||= []).length<3 && ex[k].push({sku:it.sku_id,name:it.display_name,prices:p,promotions:promos,weight:it.weight});
}
for(const [k,v] of Object.entries(combo).sort((a,b)=>b[1]-a[1])) console.log(v,k);
fs.writeFileSync('q4_examples.json',JSON.stringify(ex,null,1));
// keys of prices and promotions
const pk=new Set(), prk=new Set(); items.forEach(i=>{Object.keys(i.prices||{}).forEach(k=>pk.add(k));(i.promotions||[]).forEach(p=>Object.keys(p).forEach(k=>prk.add(k)))}); console.log([...pk],[...prk]);
console.log('item keys',w.keys);
// promo descriptions
const d={}; items.forEach(i=>(i.promotions||[]).forEach(p=>{const kk=(p.only_club_dia?'C ':'G ')+p.description.replace(/[\d,.]+/g,'#'); d[kk]=(d[kk]||0)+1})); console.log(Object.entries(d).sort((a,b)=>b[1]-a[1]).slice(0,40));
// discount check
let ok=0,bad=[]; items.filter(i=>i.prices.strikethrough_price>i.prices.price).forEach(i=>{const p=i.prices;const dd=Math.round((1-p.price/p.strikethrough_price)*100); if(Math.abs(dd-p.discount_percentage)<=1)ok++; else bad.push([i.sku_id,p])}); console.log('discount matches strike',ok,'mismatch',bad.length,JSON.stringify(bad.slice(0,3)));
// unit price basis: ratio ppu/price vs ppu/strike
const r=items.filter(i=>i.prices.is_club_price||i.prices.is_promo_price).slice(0,4000).map(i=>{const p=i.prices;return {sku:i.sku_id,name:i.display_name,price:p.price,strike:p.strikethrough_price,ppu:p.price_per_unit,mu:p.measure_unit,club:p.is_club_price,promo:p.is_promo_price}});
fs.writeFileSync('q4_promo_rows.json',JSON.stringify(r,null,0));
