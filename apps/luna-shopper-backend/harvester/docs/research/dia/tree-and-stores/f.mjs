// polite fetch helper: shells out to curl with browser headers, pinned edge IP (EDGE env), logs to log.tsv
import fs from 'node:fs'; import {execFile} from 'node:child_process'; import os from 'node:os'; import path from 'node:path';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const EDGE=process.env.EDGE||'96.16.86.23'; const GAP=+(process.env.GAP||700);
let last=0; const jarF='jar.json';
let jar = fs.existsSync(jarF)? JSON.parse(fs.readFileSync(jarF,'utf8')):{};
export function cookies(){return jar;}
let n=0;
function curl(u,opts,cookie){return new Promise((res,rej)=>{
  const hf=path.join(os.tmpdir(),`dia_h_${process.pid}_${n++}.txt`);
  const args=['-s','--compressed','--max-time','25','--resolve','www.dia.es:443:'+EDGE,'-D',hf,'-A',UA,
   '-H','Accept: '+(opts.accept||'application/json, text/plain, */*'),'-H','Accept-Language: '+((opts.headers||{})['Accept-Language']||'es-ES,es;q=0.9'),
   '-H','sec-ch-ua: "Chromium";v="129"','-H','sec-ch-ua-platform: "Windows"','-H','sec-ch-ua-mobile: ?0',
   '-H','Sec-Fetch-Site: same-origin','-H','Sec-Fetch-Mode: cors','-H','Sec-Fetch-Dest: empty'];
  if(cookie) args.push('-H','Cookie: '+cookie);
  for(const [k,v] of Object.entries(opts.headers||{})) if(k!=='Accept-Language') args.push('-H',`${k}: ${v}`);
  if(opts.method) args.push('-X',opts.method); if(opts.body) args.push('--data-raw',opts.body);
  args.push(u);
  execFile('curl',args,{maxBuffer:64*1024*1024,encoding:'utf8'},(err,stdout)=>{
    let h=''; try{h=fs.readFileSync(hf,'utf8');fs.unlinkSync(hf);}catch{}
    const blocks=h.trim().split(/\r?\n\r?\n/); const lastB=blocks[blocks.length-1]||''; const lines=lastB.split(/\r?\n/);
    const status=+((lines[0]||'').split(' ')[1]||0); const hd={}; const sc=[];
    for(const l of lines.slice(1)){const i=l.indexOf(':'); if(i<0)continue; const k=l.slice(0,i).toLowerCase(), v=l.slice(i+1).trim(); if(k==='set-cookie')sc.push(v); else hd[k]=v;}
    if(err && !status) return rej(err);
    res({status,body:stdout,headers:{get:k=>hd[k.toLowerCase()]},setCookies:sc});
  });});}
export async function get(url, opts={}){
  const wait = last+GAP-Date.now(); if(wait>0) await new Promise(r=>setTimeout(r,wait)); last=Date.now();
  const u = url.startsWith('http')?url:'https://www.dia.es'+url;
  const ck = Object.entries(opts.jar||jar).map(([k,v])=>k+'='+v).join('; ');
  let r, t0=Date.now();
  try { r = await curl(u,opts,ck); }
  catch(e){ fs.appendFileSync('log.tsv',`${new Date().toISOString()}\tERR\t${u}\t${e.message.slice(0,80)}\t${EDGE}\n`); throw e; }
  if(!opts.jar){ for(const c of r.setCookies){ const [kv]=c.split(';'); const i=kv.indexOf('='); jar[kv.slice(0,i).trim()]=kv.slice(i+1);} fs.writeFileSync(jarF,JSON.stringify(jar)); }
  fs.appendFileSync('log.tsv',`${new Date().toISOString()}\t${r.status}\t${u}\t${r.body.length}\t${Date.now()-t0}ms\t${EDGE}\n`);
  return r;
}
