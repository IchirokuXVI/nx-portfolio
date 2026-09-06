/**
 * Research script. Not production code.
 *
 * The /q/api/search endpoint answers a keyword query. A harvest run needs the
 * whole in-store assortment, not one keyword, so this probe tries every way of
 * asking the endpoint for "everything" and prints how many products each way
 * reaches. The store=1 filter is the in-store (supermarket) half.
 *
 * Usage:
 *   node tools/research/lidl/probe-enumeration.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const BASE = 'https://www.lidl.es/q/api/search';
const FIXED = { assortment: 'ES', locale: 'es_ES', version: '2.0.0' };
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function search(params) {
  const url = `${BASE}?${new URLSearchParams({ ...FIXED, ...params })}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': UA,
      accept: '*/*',
      'accept-language': 'es-ES,es;q=0.9',
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* an error page, not JSON */
  }
  return { url, status: response.status, body, raw: text.slice(0, 160) };
}

const ATTEMPTS = [
  { label: 'empty q', params: { q: '' } },
  { label: 'empty q + store=1', params: { q: '', store: '1' } },
  { label: 'q=*', params: { q: '*' } },
  { label: 'q=* + store=1', params: { q: '*', store: '1' } },
  { label: 'no q at all', params: {} },
  { label: 'no q + store=1', params: { store: '1' } },
  { label: 'q=a + store=1', params: { q: 'a', store: '1' } },
  { label: 'q=leche + store=1', params: { q: 'leche', store: '1' } },
  { label: 'fetchsize=1000', params: { q: 'leche', fetchsize: '1000' } },
  {
    label: 'fetchsize=2000 (over max)',
    params: { q: 'leche', fetchsize: '2000' },
  },
  {
    label: 'deep offset=900',
    params: { q: 'leche', fetchsize: '24', offset: '900' },
  },
  { label: 'category browse (Food)', params: { q: '', category: 'Food' } },
  { label: 'type=category id', params: { category: '10097705' } },
];

const results = [];
for (const attempt of ATTEMPTS) {
  const r = await search(attempt.params);
  const numFound = r.body?.numFound ?? null;
  const items = r.body?.items?.length ?? null;
  results.push({
    ...attempt,
    status: r.status,
    numFound,
    items,
    url: r.url,
    raw: r.body ? null : r.raw,
  });
  console.log(
    `${String(r.status).padEnd(4)} numFound=${String(numFound).padStart(6)} items=${String(items).padStart(5)}  ${attempt.label}`
  );
  if (!r.body) console.log(`      ${r.raw}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

writeFileSync(
  join(outDir, 'enumeration.json'),
  JSON.stringify(results, null, 2)
);
