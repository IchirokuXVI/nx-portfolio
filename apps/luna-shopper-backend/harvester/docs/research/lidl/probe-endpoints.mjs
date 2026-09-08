/**
 * Research script. Not production code.
 *
 * robots.txt on www.lidl.es disallows four query parameters that the site never
 * links: offset, idsOnly, productsOnly and sort. This probe calls the storefront
 * with each of them and reports what comes back, so we know whether lidl.es has
 * a machine readable surface behind the rendered pages.
 *
 * Usage:
 *   node tools/research/lidl/probe-endpoints.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'out');
mkdirSync(outDir, { recursive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CANDIDATES = [
  // The storefront search, with and without the undocumented parameters.
  'https://www.lidl.es/q/search?q=leche',
  'https://www.lidl.es/q/search?q=leche&productsOnly=true',
  'https://www.lidl.es/q/search?q=leche&idsOnly=true',
  'https://www.lidl.es/q/search?q=leche&offset=24',
  'https://www.lidl.es/q/search?q=leche&sort=price',
  // An online shop category, same treatment.
  'https://www.lidl.es/h/cocina-y-comedor/h10067556',
  'https://www.lidl.es/h/cocina-y-comedor/h10067556?productsOnly=true',
  'https://www.lidl.es/h/cocina-y-comedor/h10067556?idsOnly=true',
  'https://www.lidl.es/h/cocina-y-comedor/h10067556?offset=48',
  // Endpoint shapes other Lidl country sites are known to expose.
  'https://www.lidl.es/q/api/search?q=leche',
  'https://www.lidl.es/p/api/gridboxes/ES/es/100408539',
  'https://www.lidl.es/q/api/product/100408539',
  'https://www.lidl.es/user-api/search?q=leche',
  // The flyer/leaflet service, for completeness of the survey.
  'https://www.lidl.es/w/api/flyers',
  'https://endpoints.leaflets.schwarz/v3/ES/flyers',
  // Store search.
  'https://www.lidl.es/s/api/stores?q=madrid',
  'https://www.lidl.es/s/es-ES/tiendas/madrid/',
];

const results = [];
for (const url of CANDIDATES) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': UA,
        'accept-language': 'es-ES,es;q=0.9',
        accept: '*/*',
      },
      redirect: 'follow',
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    results.push({
      url,
      status: response.status,
      finalUrl: response.url,
      contentType: contentType.split(';')[0],
      bytes: body.length,
      ms: Date.now() - started,
      isJson: contentType.includes('json'),
      head: body.slice(0, 200).replace(/\s+/g, ' '),
    });
  } catch (error) {
    results.push({ url, error: String(error) });
  }
  await new Promise((r) => setTimeout(r, 400));
}

writeFileSync(join(outDir, 'endpoints.json'), JSON.stringify(results, null, 2));
for (const r of results) {
  if (r.error) {
    console.log(`ERR   ${r.url}\n      ${r.error}`);
    continue;
  }
  console.log(
    `${String(r.status).padEnd(4)} ${r.contentType.padEnd(24)} ${String(r.bytes).padStart(8)}B  ${r.url}`
  );
  if (r.isJson) console.log(`      ${r.head}`);
}
