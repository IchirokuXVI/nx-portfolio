// Counts what the online shop says it holds (plan 0169, section 1): the product
// URLs in `sitemap.xml`, and the `<n> Artículos` each top level category prints
// on its first page. Thirteen requests, one every 750 ms.
//
//   NODE_EXTRA_CA_CERTS=apps/luna-shopper-backend/harvester/docs/research/eljamon/sectigo-ev-r36.pem \
//     node apps/luna-shopper-backend/harvester/docs/research/eljamon/probe-counts.mjs
//
// The certificate is the intermediate the storefront fails to send; see README.

const BASE = 'https://www.supermercadoseljamon.com';
const UA =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';

const cookies = new Map();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path) {
  await sleep(750);
  const headers = { 'user-agent': UA };
  if (cookies.size > 0) {
    headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const response = await fetch(`${BASE}${path}`, { headers });
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const pair = line.split(';', 1)[0];
    const eq = pair.indexOf('=');
    if (eq > 0) cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  return response.text();
}

const sitemap = await get('/sitemap.xml');
const products = new Set(
  [...sitemap.matchAll(/\/detalle\/-\/Producto\/[^<\s]+/g)].map((m) => m[0])
);
console.log(`sitemap.xml: ${products.size} product URLs`);

const home = await get('/');
await get(
  '/delegate/seleccionarCodPostalAjaxServletFood?accion=enviarCodPostal&cp=21440&locale=es'
);
const categories = [
  ...new Set(
    [...home.matchAll(/\/categorias\/([a-z0-9-]+)\/(\d{2})"/g)].map(
      (m) => `/categorias/${m[1]}/${m[2]}`
    )
  ),
];

let sum = 0;
for (const path of categories) {
  const page = await get(path);
  const count = Number(
    /(\d[\d.]*)\s*Artículos/.exec(page)?.[1]?.replace(/\./g, '') ?? NaN
  );
  sum += Number.isFinite(count) ? count : 0;
  console.log(`${path}: ${count}`);
}
console.log(
  `${categories.length} top level categories, printed counts sum to ${sum}`
);
