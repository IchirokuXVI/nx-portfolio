// check-service over many postal codes: which physical_store_id serves each
import {get} from './f.mjs'; import fs from 'node:fs';
const pcs='28001 28041 08001 41001 46001 15001 48001 35001 07001 29001 50001 38001 51001 52001 07800 01001 02001 03001 04001 05001 06001 09001 10001 11001 12001 13001 14001 16001 17001 18001 19001 20001 21001 22001 23001 24001 25001 26001 27001 30001 31001 32001 33001 34001 36001 37001 39001 40001 42001 43001 44001 45001 47001 49001 08901 28901 44200 42100 24700 49300 27400 10600 30800 22300 06800'.split(' ');
const out={};
for(const pc of pcs){const r=await get('/api/v1/common-aggregator/check-service?postal_code='+pc); out[pc]={status:r.status,body:r.body}; console.log(pc,r.status,r.body);}
fs.writeFileSync('check_service.json',JSON.stringify(out,null,1));
