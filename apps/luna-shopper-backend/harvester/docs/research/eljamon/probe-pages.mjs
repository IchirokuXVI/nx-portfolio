// Saves one of every page kind the El Jamón adapter reads, verbatim, so the
// parsers can be written against what the site sends (plan 0169, sections 3
// to 5). About eight requests, one every 750 ms.
//
//   node apps/luna-shopper-backend/harvester/docs/research/eljamon/probe-pages.mjs [outDir]
//
// Writes into `out/` beside this file unless a directory is given.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://www.supermercadoseljamon.com';
const LOCATOR =
  'https://portal.supermercadoseljamon.com/Localizador/wp-admin/admin-ajax.php';
const UA =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';
const POSTAL_CODE = process.env.POSTAL_CODE ?? '21440';

const out =
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });

const cookies = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, { method = 'GET', body } = {}) {
  await sleep(750);
  const headers = { 'user-agent': UA, accept: 'text/html,application/json' };
  if (cookies.size > 0) {
    headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  if (body) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  const response = await fetch(url, { method, headers, body });
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const pair = line.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq > 0) {
      cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
    }
  }
  const text = await response.text();
  console.log(`${response.status} ${method} ${url} -> ${text.length} bytes`);
  return text;
}

function save(name, text) {
  writeFileSync(join(out, name), text);
}

const home = await request(`${BASE}/`);
save('home.html', home);

const cp = await request(
  `${BASE}/delegate/seleccionarCodPostalAjaxServletFood?accion=enviarCodPostal&cp=${POSTAL_CODE}&locale=es`
);
save('postal-code.txt', cp);

const categories = [
  ...new Set(
    [...home.matchAll(/\/categorias\/([^"'/?#]+)\/(\d{2})(?=["'?#])/g)].map(
      (m) => `/categorias/${m[1]}/${m[2]}`
    )
  ),
];
console.log('top level categories', categories);

const first = categories[0];
const page1 = await request(`${BASE}${first}`);
save('category-page-1.html', page1);

const filters = /name=["']filters["'][^>]*value=["']([^"']*)["']/.exec(page1);
console.log('filters input', filters?.[1]?.slice(0, 200));

const product = /\/detalle\/-\/Producto\/[^"'\s]+/.exec(page1)?.[0];
if (product) {
  save('product.html', await request(`${BASE}${product}`));
}

save(
  'stores.html',
  await request(LOCATOR, {
    method: 'POST',
    body: new URLSearchParams({
      action: 'make_search_request',
      store_locatore_search_input: 'Lepe',
      store_locatore_search_lat: '37.2547',
      store_locatore_search_lng: '-7.2044',
      lat: '37.2547',
      lng: '-7.2044',
      store_locatore_search_radius: '1000',
      store_locator_category: '',
    }).toString(),
  })
);
