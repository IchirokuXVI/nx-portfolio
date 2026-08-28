/**
 * Per-chain price adapters for the Luna Shopper feasibility spike.
 *
 * Each adapter exposes:
 *   id            stable chain key
 *   priceScope    the granularity at which this chain's price actually varies
 *   status        'live' | 'browser-required' | 'unavailable'
 *   search(term, scope) -> Promise<PriceRow[]>
 *
 * PriceRow: { chain, scope, sku, name, brand, packaging, price, unitPrice, unit, currency, url }
 *
 * NOTE: none of these are official APIs. Mercadona is the only chain whose
 * endpoints are stable and callable without a browser; the others are
 * documented here with what it would actually take. See ../../plans/backlog/0007.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

async function getJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/* ------------------------------------------------------------------ *
 * Mercadona — unauthenticated JSON REST, scoped by warehouse (`wh`).
 * Two strategies:
 *   'catalog' walks the category tree (slow, ~120 requests, zero secrets)
 *   'algolia' uses the SPA's public search credentials (fast, key rotates)
 * ------------------------------------------------------------------ */

const MERCADONA_API = 'https://tienda.mercadona.es/api';

/** Warehouse codes seen in the wild. Resolve properly with resolveWarehouse(). */
export const MERCADONA_WAREHOUSES = ['mad1', 'bcn1', 'vlc1', 'svq1', 'alc1'];

/** Ask Mercadona which warehouse serves a postal code (read from a response header). */
export async function resolveWarehouse(postalCode) {
  const res = await fetch(`${MERCADONA_API}/postal-codes/actions/change-pc/`, {
    method: 'PUT',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_postal_code: String(postalCode) }),
  });
  return res.headers.get('x-customer-wh');
}

function mercadonaRow(p, wh) {
  const pi = p.price_instructions ?? {};
  return {
    chain: 'mercadona',
    scope: wh,
    sku: String(p.id),
    name: p.display_name ?? p.name ?? null,
    brand: p.brand ?? null,
    packaging: pi.size_format ? `${pi.unit_size ?? ''} ${pi.size_format}`.trim() : null,
    price: num(pi.unit_price),
    unitPrice: num(pi.bulk_price),
    unit: pi.reference_format ?? null,
    currency: 'EUR',
    url: p.share_url ?? `https://tienda.mercadona.es/product/${p.id}/`,
  };
}

/** Walk the whole category tree for one warehouse and filter locally. Reliable, slow. */
async function mercadonaViaCatalog(term, wh) {
  const needle = term.toLowerCase();
  const tree = await getJson(`${MERCADONA_API}/categories/?lang=es&wh=${wh}`);
  const leaves = [];
  for (const top of tree.results ?? []) {
    for (const child of top.categories ?? []) leaves.push(child.id);
  }

  const rows = [];
  // Sequential on purpose: Mercadona sits behind Akamai and dislikes bursts.
  for (const id of leaves) {
    let page;
    try {
      page = await getJson(`${MERCADONA_API}/categories/${id}/?lang=es&wh=${wh}`);
    } catch {
      continue;
    }
    for (const sub of page.categories ?? [{ products: page.products ?? [] }]) {
      for (const p of sub.products ?? []) {
        const hay = `${p.display_name ?? ''} ${p.brand ?? ''}`.toLowerCase();
        if (needle.split(/\s+/).every((w) => hay.includes(w))) rows.push(mercadonaRow(p, wh));
      }
    }
  }
  return rows;
}

/** Read the public Algolia app id / search key out of the live SPA bundle. */
async function discoverAlgoliaCredentials() {
  const html = await (await fetch('https://tienda.mercadona.es/', { headers: { 'User-Agent': UA } })).text();
  const bundles = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  for (const src of bundles.reverse()) {
    const url = src.startsWith('http') ? src : `https://tienda.mercadona.es${src}`;
    const js = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    const appId = js.match(/["']([A-Z0-9]{10})["']\s*[,:]\s*["']([a-f0-9]{32})["']/);
    if (appId) return { appId: appId[1], apiKey: appId[2] };
  }
  throw new Error('could not discover Algolia credentials from the SPA bundle');
}

async function mercadonaViaAlgolia(term, wh, creds) {
  const { appId, apiKey } = creds ?? (await discoverAlgoliaCredentials());
  const body = await getJson(
    `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/products_prod_${wh}_es/query`,
    {
      method: 'POST',
      headers: {
        'X-Algolia-Application-Id': appId,
        'X-Algolia-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ params: `query=${encodeURIComponent(term)}&hitsPerPage=40` }),
    }
  );
  return (body.hits ?? []).map((h) => mercadonaRow(h, wh));
}

export const mercadona = {
  id: 'mercadona',
  label: 'Mercadona',
  priceScope: 'warehouse',
  status: 'live',
  async search(term, wh, opts = {}) {
    if (opts.strategy === 'catalog') return mercadonaViaCatalog(term, wh);
    try {
      return await mercadonaViaAlgolia(term, wh, opts.algolia);
    } catch (err) {
      if (opts.noFallback) throw err;
      return mercadonaViaCatalog(term, wh);
    }
  },
};

/* ------------------------------------------------------------------ *
 * DIA — real online shop, JSON under the hood, but fronted by bot
 * protection: every working open-source scraper drives undetected
 * Chrome rather than calling fetch(). Left as an explicit stub so the
 * spike reports it honestly instead of silently returning nothing.
 * ------------------------------------------------------------------ */
export const dia = {
  id: 'dia',
  label: 'DIA',
  priceScope: 'store',
  status: 'browser-required',
  reason:
    'Online shop is JSON-backed but behind anti-bot protection; needs Playwright with a real ' +
    'browser context, plus a postal code to pin the store. Franchised stores price independently ' +
    '(DIA sets a maximum, franchisees may undercut it), so the online price is its own price list.',
  async search() {
    throw new Error('dia: browser automation required — see reason');
  },
};

/* ------------------------------------------------------------------ *
 * Lidl — lidl.es sells the non-food bazaar online; the grocery
 * assortment is not published as a catalog. The unofficial Lidl Plus
 * API is per-user OAuth and returns receipts/coupons, not prices.
 * ------------------------------------------------------------------ */
export const lidl = {
  id: 'lidl',
  label: 'Lidl',
  priceScope: 'national',
  status: 'unavailable',
  reason:
    'No public grocery catalog. lidl.es lists bazaar/non-food only. Lidl Plus has an unofficial ' +
    'API (Andre0512/lidl-plus) but it is authenticated per user and exposes receipts and coupons, ' +
    'not a product catalog. Weekly PDF folleto is the only public price source.',
  async search() {
    throw new Error('lidl: no catalog source — see reason');
  },
};

/* ------------------------------------------------------------------ *
 * El Jamón — has a real online store (~7k refs) but no known API.
 * Scrapable with a custom HTML adapter; endpoint left unset until
 * confirmed from DevTools rather than guessed.
 * ------------------------------------------------------------------ */
export const elJamon = {
  id: 'el-jamon',
  label: 'Supermercados El Jamón',
  priceScope: 'store',
  status: 'browser-required',
  reason:
    'supermercadoseljamon.com is a working online store with roughly 7,000 references, but no ' +
    'documented API. Needs an HTML/XHR adapter written against the live site; regional chain, so ' +
    'expect the online list to be its own price list separate from the shelf.',
  async search() {
    throw new Error('el-jamon: adapter not written — see reason');
  },
};

/* ------------------------------------------------------------------ *
 * Deza — corporate site only. No online shop, no prices on the web
 * beyond weekly PDF leaflets.
 * ------------------------------------------------------------------ */
export const deza = {
  id: 'deza',
  label: 'Supermercados Deza',
  priceScope: 'store',
  status: 'unavailable',
  reason:
    'dezacalidad.es is a corporate site: store locations, no e-commerce, no prices. The only ' +
    'public price data is the weekly PDF folleto, which covers promotions rather than the full ' +
    'assortment. Realistically this chain is manual entry or OCR of the leaflet.',
  async search() {
    throw new Error('deza: no public price source — see reason');
  },
};

export const ADAPTERS = [mercadona, dia, lidl, elJamon, deza];
