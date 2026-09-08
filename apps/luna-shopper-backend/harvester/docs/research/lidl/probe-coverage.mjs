/**
 * Research script. Not production code.
 *
 * An empty query with store=1 returns a fixed number of in-store products. This
 * probe asks whether that number is the whole grocery assortment or only the
 * part the index happens to list, by searching a wide set of Spanish food terms
 * and counting how many products those terms reach that the empty query missed.
 *
 * The result is the honest coverage figure a plan must state. It is the same
 * question the DEZA adapter answered with "completeness cannot be proven".
 *
 * Usage:
 *   node tools/research/lidl/probe-coverage.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const BASE = 'https://www.lidl.es/q/api/search';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAUSE_MS = 450;

/** Broad Spanish grocery vocabulary: aisles, staples and Lidl's own food brands. */
const TERMS = [
  'leche',
  'pan',
  'queso',
  'yogur',
  'huevos',
  'aceite',
  'arroz',
  'pasta',
  'harina',
  'azucar',
  'sal',
  'cafe',
  'te',
  'cacao',
  'galletas',
  'chocolate',
  'cereales',
  'mermelada',
  'miel',
  'atun',
  'sardinas',
  'conservas',
  'tomate',
  'legumbres',
  'garbanzos',
  'lentejas',
  'alubias',
  'pollo',
  'cerdo',
  'ternera',
  'jamon',
  'chorizo',
  'salchichas',
  'embutido',
  'pescado',
  'salmon',
  'gambas',
  'congelado',
  'pizza',
  'helado',
  'mantequilla',
  'margarina',
  'nata',
  'fruta',
  'verdura',
  'patatas',
  'cebolla',
  'manzana',
  'platano',
  'naranja',
  'lechuga',
  'agua',
  'zumo',
  'refresco',
  'cerveza',
  'vino',
  'licor',
  'sidra',
  'detergente',
  'suavizante',
  'lejia',
  'papel higienico',
  'servilletas',
  'bolsas',
  'champu',
  'gel',
  'pasta de dientes',
  'desodorante',
  'panales',
  'compresas',
  'snacks',
  'patatas fritas',
  'frutos secos',
  'aceitunas',
  'salsa',
  'vinagre',
  'especias',
  'caldo',
  'sopa',
  'pure',
  'comida perros',
  'comida gatos',
  // Lidl's own food brands.
  'milbona',
  'bellarom',
  'alesto',
  'freeway',
  'realvalle',
  'argus',
  'cien',
  'floralys',
  'combino',
  'dulcesol',
  'pilos',
  'crownfield',
  'vitasia',
  'chef select',
  'deluxe',
  'sondey',
  'baresa',
  'saguaro',
  'solevita',
  'maribel',
  'kania',
  'castello',
  'nixe',
];

/** Categories the site uses for supermarket goods, as opposed to the online shop. */
const GROCERY_CATEGORIES = new Set(['Food', 'NonFood', 'P+F', 'F+V']);

async function search(params) {
  const url = `${BASE}?${new URLSearchParams({ assortment: 'ES', locale: 'es_ES', version: '2.0.0', ...params })}`;
  const response = await fetch(url, {
    // The endpoint answers 406 to Accept: application/json. It must be */*.
    headers: {
      'user-agent': UA,
      accept: '*/*',
      'accept-language': 'es-ES,es;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

function groceryRows(body) {
  return (body.items ?? [])
    .map((i) => i.gridbox?.data)
    .filter(
      (d) => d && GROCERY_CATEGORIES.has(String(d.category).split('/')[0])
    )
    .map((d) => ({
      productId: d.productId ?? d.itemId,
      title: d.fullTitle ?? d.title,
      category: d.category,
      price: d.price?.price ?? null,
      packaging: d.price?.packaging?.text ?? null,
      brand: d.brand?.name ?? null,
      url: d.canonicalPath ?? null,
    }));
}

// The baseline: what the empty query already reached.
const baseline = new Set();
try {
  const walked = JSON.parse(
    readFileSync(join(outDir, 'assortment-instore.json'), 'utf8')
  );
  for (const row of walked) baseline.add(row.productId);
  console.log(`baseline from the empty-query walk: ${baseline.size} products`);
} catch {
  console.log(
    'no baseline walk found; run walk-assortment.mjs first for a comparison'
  );
}

const all = new Map();
const perTerm = [];
let requests = 0;

for (const term of TERMS) {
  let body;
  try {
    body = await search({ q: term, store: '1', fetchsize: '100', offset: '0' });
    requests++;
  } catch (error) {
    console.log(`${term.padEnd(18)} ERROR ${error.message}`);
    continue;
  }
  const rows = groceryRows(body);
  let fresh = 0;
  for (const row of rows) {
    if (!row.productId) continue;
    if (!all.has(row.productId)) {
      all.set(row.productId, row);
      if (!baseline.has(row.productId)) fresh++;
    }
  }
  perTerm.push({
    term,
    numFound: body.numFound,
    grocery: rows.length,
    newBeyondBaseline: fresh,
  });
  console.log(
    `${term.padEnd(18)} numFound=${String(body.numFound).padStart(4)}  grocery=${String(rows.length).padStart(3)}  new-beyond-baseline=${fresh}  running=${all.size}`
  );
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
}

const beyond = [...all.values()].filter((r) => !baseline.has(r.productId));
writeFileSync(
  join(outDir, 'coverage.json'),
  JSON.stringify(
    { terms: perTerm, requests, reached: all.size, beyondBaseline: beyond },
    null,
    2
  )
);

console.log(`\nrequests: ${requests}`);
console.log(`grocery products reached by keyword: ${all.size}`);
console.log(`of those, not in the empty-query walk: ${beyond.length}`);
if (beyond.length) {
  console.log('\nexamples the empty query missed:');
  for (const row of beyond.slice(0, 15))
    console.log(`  ${row.productId}  ${row.title}  (${row.category})`);
}
