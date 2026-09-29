// compare two full walks: assortment and prices
import fs from 'node:fs';
const [A,B]=process.argv.slice(2).map(f=>JSON.parse(fs.readFileSync(f)));
for(const w of [A,B]) console.log(w.pc,'req',w.req,'secs',w.secs,'errs',w.errs.length,'sumTotals',Object.values(w.cats).reduce((a,b)=>a+b.total,0),'unique',Object.keys(w.items).length);
let common=0,diff=0,ppu=0,strike=0,promo=0; const ex=[];
for(const [k,a] of Object.entries(A.items)){const b=B.items[k]; if(!b)continue; common++; if(a.prices.price!==b.prices.price){diff++; if(ex.length<8)ex.push(`${k} ${a.prices.price}/${b.prices.price} ${a.display_name}`);} if(a.prices.price_per_unit!==b.prices.price_per_unit)ppu++; if(a.prices.strikethrough_price!==b.prices.strikethrough_price)strike++; if(a.prices.is_promo_price!==b.prices.is_promo_price)promo++;}
console.log({common,priceDiff:diff,ppuDiff:ppu,strikeDiff:strike,promoFlagDiff:promo,onlyA:Object.keys(A.items).filter(k=>!B.items[k]).length,onlyB:Object.keys(B.items).filter(k=>!A.items[k]).length,union:new Set([...Object.keys(A.items),...Object.keys(B.items)]).size});
console.log(ex.join('\n'));
const sm=new Set(fs.readFileSync('../urls.txt','utf8').split(/\s+/).map(u=>(u.match(/\/p\/(\d+)/)||[])[1]).filter(Boolean));
const u=new Set([...Object.keys(A.items),...Object.keys(B.items)]); console.log('sitemap',sm.size,'covered by union',[...sm].filter(i=>u.has(i)).length);
fs.writeFileSync('sitemap_missing.json',JSON.stringify([...sm].filter(i=>!u.has(i))));
