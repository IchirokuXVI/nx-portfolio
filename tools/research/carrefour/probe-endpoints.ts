/**
 * Probe the Carrefour API surface and report which parts the internet can reach.
 *
 * Run: npx tsx tools/research/carrefour/probe-endpoints.ts
 *
 * The storefront renders its own service map into every page, under
 * `__INITIAL_STATE__.config.endpoints`. Each entry names a `client` path, which the
 * browser calls, and usually a `server` path, which is an in cluster hostname. This
 * script reads that map from a live page and then calls every `client` path from
 * inside the same browser context, to find out which ones the edge actually routes.
 *
 * The calls run inside the page through `fetch`, not from node, for the reason the
 * plan explains: a request from node is refused on its TLS fingerprint, so a probe
 * from node would report every route as blocked and prove nothing.
 *
 * How to read the output:
 *
 * - `503` with the body `Service Unavailable` means the edge has no public upstream
 *   for that path. The service exists, but only server side.
 * - `403` with an HTML body is the Cloudflare challenge. The route exists and is
 *   defended.
 * - A JSON body, including a JSON 404, means the backend itself answered, so the
 *   route is reachable.
 */

import { CarrefourBrowser, ORIGIN } from './carrefour-browser';

/** A listing page carries a fuller endpoint map than the section landing page. */
const SEED = '/supermercado/la-despensa/cat20001/c';

/**
 * Paths worth trying that the map does not name directly, because the map gives a
 * service root while the useful routes hang below it.
 */
const EXTRA_PATHS = [
  '/cloud-api/salepoints/v1',
  '/cloud-api/salepoints/v1/stores-location/es',
  '/cloud-api/salepoints/v1/drives',
  '/cloud-api/categories-api/v1/categories/cat20001',
  '/cloud-api/plp-food-papi/v1/cat20001',
  '/cloud-api/plp-food-papi/v1/products?navigation_id=cat20001&navigation_type=category',
  '/search-api/query/v1/search?query=leche&rows=24&start=0',
];

type Verdict = 'reachable' | 'not-routed' | 'challenged' | 'other';

function verdict(status: number, contentType: string, body: string): Verdict {
  if (status === 503 && body.trim().startsWith('Service Unavailable'))
    return 'not-routed';
  if ((status === 403 || status === 429) && contentType.includes('text/html'))
    return 'challenged';
  if (contentType.includes('application/json')) return 'reachable';
  return 'other';
}

interface ProbeResult {
  status: number;
  contentType: string;
  body: string;
}

async function main(): Promise<void> {
  console.log(`# Carrefour endpoint probe  (${new Date().toISOString()})`);
  console.log(`# seed page: ${ORIGIN}${SEED}\n`);

  const browser = await CarrefourBrowser.open();
  try {
    const state = await browser.state(SEED);
    if (!state)
      throw new Error(
        'the seed page did not answer; cannot read the endpoint map'
      );

    const config = (state['config'] ?? {}) as Record<string, unknown>;
    const endpoints = (config['endpoints'] ?? {}) as Record<
      string,
      { client?: string; server?: string }
    >;

    console.log('## The map the page ships\n');
    const clientPaths: string[] = [];
    for (const name of Object.keys(endpoints).sort()) {
      const entry = endpoints[name] ?? {};
      console.log(`${name.padEnd(24)} client=${entry.client ?? '-'}`);
      if (entry.client?.startsWith('/') && entry.client !== '/')
        clientPaths.push(entry.client);
    }

    console.log('\n## The search configuration\n');
    console.log(JSON.stringify(config['search'] ?? {}, null, 1));

    console.log('\n## The store context the page was rendered for\n');
    console.log(JSON.stringify(config['ssrHeaders'] ?? {}, null, 1));

    const targets = [...new Set([...clientPaths, ...EXTRA_PATHS])].sort();
    console.log(`\n## Calling ${targets.length} routes from inside the page\n`);

    const tally: Record<Verdict, string[]> = {
      reachable: [],
      'not-routed': [],
      challenged: [],
      other: [],
    };

    for (const path of targets) {
      const result: ProbeResult = await browser.fetchInPage(path);
      const v = verdict(result.status, result.contentType, result.body);
      tally[v].push(path);

      console.log(`${String(result.status).padEnd(4)} ${v.padEnd(11)} ${path}`);
      console.log(`     ${result.body.replace(/\s+/g, ' ').slice(0, 110)}`);
      await new Promise((r) => setTimeout(r, 1200));
    }

    console.log('\n## Summary\n');
    for (const v of [
      'reachable',
      'not-routed',
      'challenged',
      'other',
    ] as Verdict[]) {
      console.log(`${v} (${tally[v].length}):`);
      for (const p of tally[v]) console.log(`  ${p}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
