// Does the postal code change the price? (plan 0169, section 2)
//
// Starts one session per postal code, reads page 1 of two categories under
// each, and compares the prices and the printed article counts. Then asks for
// a Madrid postal code, which the shop does not serve. About 25 requests, one
// every 750 ms.
//
//   NODE_EXTRA_CA_CERTS=apps/luna-shopper-backend/harvester/docs/research/eljamon/sectigo-ev-r36.pem \
//     node apps/luna-shopper-backend/harvester/docs/research/eljamon/probe-postal-codes.mjs

const BASE = 'https://www.supermercadoseljamon.com';
const UA =
  'LunaShopper/0.1 (+https://velista.app; personal price comparison; contact@velista.app)';
const CODES = ['21440', '41010', '14013', '11205', '18140'];
const CATEGORIES = ['/categorias/bebes/07', '/categorias/mascotas/10'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function session() {
  const cookies = new Map();
  return async function get(path) {
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
  };
}

function prices(html) {
  const rows = [
    ...html.matchAll(
      /_articulo_(\d+)" class="articulo">([\s\S]*?)(?=_articulo_\d+" class="articulo">|$)/g
    ),
  ];
  return rows.map((row) => {
    const block = /<p class="precio">([\s\S]*?)<\/p>/.exec(row[2])?.[1] ?? '';
    const spans = [...block.matchAll(/<span>([^<]*)<\/span>/g)];
    return `${row[1]}=${spans.at(-1)?.[1]?.trim() ?? '?'}`;
  });
}

const seen = new Map();
for (const code of CODES) {
  const get = session();
  await get('/');
  const answer = await get(
    `/delegate/seleccionarCodPostalAjaxServletFood?accion=enviarCodPostal&cp=${code}&locale=es`
  );
  const summary = [];
  for (const path of CATEGORIES) {
    const page = await get(path);
    const count = /(\d[\d.]*)\s*Artículos/.exec(page)?.[1];
    summary.push(`${count} articles; ${prices(page).join(' ')}`);
  }
  seen.set(code, summary.join(' | '));
  console.log(`${code} (answer ${JSON.stringify(answer.trim())})`);
}
const distinct = new Set(seen.values());
console.log(
  distinct.size === 1
    ? `All ${CODES.length} postal codes saw the same prices and counts.`
    : `${distinct.size} different answers:\n${[...seen].join('\n')}`
);

const get = session();
await get('/');
console.log(
  '28001:',
  await get(
    '/delegate/seleccionarCodPostalAjaxServletFood?accion=enviarCodPostal&cp=28001&locale=es'
  )
);
