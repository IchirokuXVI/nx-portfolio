// compare price lists across postal codes in scope.json
import fs from 'node:fs';
const s=JSON.parse(fs.readFileSync(process.argv[2]||'scope.json'));
const pcs=Object.keys(s); const ref=process.argv[3]||'none';
const sig=pc=>JSON.stringify(Object.entries(s[pc].items).sort().map(([k,v])=>[k,v.p]));
const groups={}; for(const pc of pcs){(groups[sig(pc)] ||= []).push(pc);} 
console.log('distinct (sku,price) lists:',Object.keys(groups).length); for(const g of Object.values(groups)) console.log('  ',g.join(' '));
const pricesOnly=pc=>s[pc].items;
for(const pc of pcs){ if(pc===ref) continue; const a=s[ref].items,b=s[pc].items; let common=0,diff=0,up=0,down=0,maxd=0,sumd=0; const ex=[];
  for(const k of Object.keys(a)) if(b[k]){common++; if(a[k].p!==b[k].p){diff++; const d=(b[k].p-a[k].p)/a[k].p; sumd+=d; b[k].p>a[k].p?up++:down++; if(Math.abs(d)>Math.abs(maxd))maxd=d; if(ex.length<3)ex.push(`${k} ${a[k].p}->${b[k].p}${b[k].promo?'(promo)':''}${a[k].promo?'(refpromo)':''}`);}}
  const onlyA=Object.keys(a).filter(k=>!b[k]).length, onlyB=Object.keys(b).filter(k=>!a[k]).length;
  console.log(pc,`n=${Object.keys(b).length} common=${common} priceDiff=${diff} up=${up} down=${down} meanRelDiff=${diff?(sumd/diff*100).toFixed(1):0}% max=${(maxd*100).toFixed(1)}% only_ref=${onlyA} only_here=${onlyB}`, ex.join('; '));
}
