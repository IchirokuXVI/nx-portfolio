import fs from 'node:fs';
const w=JSON.parse(fs.readFileSync('../dia/walk_none.json','utf8'));
const items=Object.values(w.items);
const qty=n=>{ // parse size in base unit (kg or L), handles "pack 6 x 1,5 L"
  const s=n.toLowerCase().replace(/,/g,'.'); let m=s.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/); let mult=1,v,u;
  if(m){mult=+m[1];v=+m[2];u=m[3];} else { m=s.match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|cl|l)\b/); if(!m) return null; v=+m[1];u=m[2]; }
  const f={kg:1,g:0.001,l:1,ml:0.001,cl:0.01}[u]; return mult*v*f; };
const res={club:{price:0,strike:0,neither:0,noSize:0},generalPromo:{price:0,strike:0,neither:0,noSize:0},regular:{price:0,neither:0,noSize:0}}; const odd=[];
for(const it of items){ const p=it.prices; if(!['KILO','LITRO'].includes(p.measure_unit)) continue; const q=qty(it.display_name);
  const grp=p.is_club_price?'club':p.is_promo_price?'generalPromo':'regular';
  if(!q){res[grp].noSize++;continue;}
  const tol=x=>Math.abs(x-p.price_per_unit)<=0.011+0.002*p.price_per_unit;
  if(tol(p.price/q)) res[grp].price++; else if(grp!=='regular'&&tol(p.strikethrough_price/q)) res[grp].strike++; else {res[grp].neither++; if(grp!=='regular'&&odd.length<10) odd.push([it.display_name,q,p]);}
}
console.log(JSON.stringify(res,null,1)); odd.forEach(o=>console.log(JSON.stringify(o)));
const mu={}; items.forEach(i=>mu[i.prices.measure_unit]=(mu[i.prices.measure_unit]||0)+1); console.log(mu);
