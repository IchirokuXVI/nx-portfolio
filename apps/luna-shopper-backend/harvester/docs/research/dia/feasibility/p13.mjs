import {get} from './f.mjs';
let r=await get('/robots.txt',{accept:'text/html,*/*'}); console.log('robots jar',r.status);
r=await get('/robots.txt',{accept:'text/html,*/*',jar:{}}); console.log('robots nojar',r.status);
r=await get('/api/v1/plp-back/reduced/carnes/cerdo/c/L2014',{jar:{}}); console.log('plp nojar',r.status);
