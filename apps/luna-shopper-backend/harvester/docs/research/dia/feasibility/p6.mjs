import {get,cookies} from './f.mjs'; import fs from 'node:fs';
const show=(t,r)=>console.log(t,r.status,r.body.slice(0,700).replace(/\s+/g,' '),r.setCookies.map(c=>c.split(';')[0].slice(0,60)));
show('hdr',await get('/api/v1/common-aggregator/header-data'));
show('check',await get('/api/v1/common-aggregator/check-service?postal_code=28001'));
show('check35',await get('/api/v1/common-aggregator/check-service?postal_code=35001'));
show('put',await get('/api/v1/common-aggregator/save-shipping-address?new_postal_code=28001',{method:'PUT',headers:{'content-type':'application/json'},body:'null'}));
show('hdr2',await get('/api/v1/common-aggregator/header-data'));
console.log(Object.keys(cookies()));
