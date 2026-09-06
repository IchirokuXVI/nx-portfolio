/**
 * Shared client and parsing helpers for the Carrefour probe scripts.
 *
 * These are research scripts, not library code. They exist so that the numbers in
 * `apps/luna-shopper-backend/plans/0090-a-catalog-behind-a-browser.md` can be
 * reproduced. Nothing here is wired into the harvester.
 *
 * ## Why this uses a browser and not `fetch`
 *
 * carrefour.es sits behind Cloudflare, and Cloudflare here rejects a client on its
 * TLS fingerprint rather than on its headers. Measured on 2026-09-06, interleaved
 * against the same URLs, ten seconds apart, with an identical `User-Agent`:
 *
 * | Client                             | Result   |
 * | ---------------------------------- | -------- |
 * | Windows `curl` (Schannel)          | 200, 3/3 |
 * | Linux `curl` (OpenSSL, in Docker)  | 403      |
 * | node `https` / `fetch` (OpenSSL)   | 403, 3/3 |
 * | node `http2`                       | 403      |
 * | node with Chrome cipher list       | 403      |
 * | headless Chromium (Playwright)     | 200      |
 *
 * Tuning node's ciphers and curves does not help, because the fingerprint covers
 * extension order and GREASE values that OpenSSL does not emit. The only clients
 * that pass are the ones with a browser TLS stack. Windows `curl` passes only
 * because Schannel is the operating system stack a browser would use, so it is a
 * local accident and not a route to production, which runs Linux.
 *
 * That is why every script here drives Chromium.
 *
 * ## Where the data is
 *
 * The storefront renders its listing state into `window.__INITIAL_STATE__`. Reading
 * it through `page.evaluate` is more reliable than parsing the served HTML, because
 * after hydration the serialized document no longer contains the literal blob.
 */

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';

export const ORIGIN = 'https://www.carrefour.es';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Milliseconds to wait between page loads.
 *
 * Measured on 2026-09-06: 30 consecutive loads at this spacing, with the Cloudflare
 * cookies dropped each time, produced 30 successes and no block. A page load itself
 * costs about 2.3 seconds, so the achieved rate is near 0.23 pages per second, or
 * about 5.5 product cards per second.
 */
export const DEFAULT_DELAY_MS = 2000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A Chromium session that drops its Cloudflare cookies before every navigation.
 *
 * ## Why, because this is the opposite of the usual advice
 *
 * Keeping a session normally helps. Here it is what causes the block. Measured on
 * 2026-09-06, five listing pages, seven seconds apart, one variant per row:
 *
 * | Cookie handling                    | Result of five loads      |
 * | ---------------------------------- | ------------------------- |
 * | keep everything (a normal session) | `200 403 403 403 403`     |
 * | clear every cookie before each load| `200 200 200 200 200`     |
 * | clear only `__cf*` and `cf_*`      | `200 200 200 200 200`     |
 * | a fresh context for each load      | `200 200 200 200 200`     |
 *
 * The first load of any context succeeds and returns `__cf_bm` and `cf_clearance`.
 * Presenting those on the next request is what draws the 403, and the 403 is a hard
 * block ("Attention Required"), not a challenge a browser can solve by waiting.
 *
 * Dropping only the Cloudflare cookies is the choice here rather than clearing the
 * jar, because it keeps `session_id` and `salepoint`, and the store cookie is what
 * decides which shop's assortment and prices the listing shows.
 */
export class CarrefourBrowser {
  private browser!: Browser;
  private context!: BrowserContext;
  private page!: Page;

  /** Requests made and throttles seen, so a script can report its own cost. */
  requests = 0;
  throttles = 0;

  constructor(
    private readonly delayMs: number = DEFAULT_DELAY_MS,
    /**
     * Whether to refuse images, fonts and media.
     *
     * Refusing them saves several megabytes per page and none of it is read. It is
     * also a behaviour a bot filter can notice, because a real browser fetches what a
     * page references. `measure-rate-limit.ts --assets` exists to test whether that
     * matters here, so this is an option rather than a fixed choice.
     */
    private readonly blockAssets: boolean = true
  ) {}

  static async open(
    delayMs?: number,
    blockAssets = true
  ): Promise<CarrefourBrowser> {
    const it = new CarrefourBrowser(delayMs, blockAssets);
    await it.start();
    return it;
  }

  private async start(): Promise<void> {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      locale: 'es-ES',
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
    });
    this.page = await this.context.newPage();

    if (this.blockAssets) {
      // The listing state is in the document, so the bytes that carry pictures are
      // never read. Refusing them is the difference between about 250 KB and several
      // megabytes per page.
      await this.page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (type === 'image' || type === 'font' || type === 'media')
          return route.abort();
        return route.continue();
      });
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  /**
   * Remove the Cloudflare cookies and keep everything else.
   *
   * See the note on this class: presenting `__cf_bm` or `cf_clearance` on a second
   * navigation is what draws a hard 403. `session_id` and `salepoint` are kept,
   * because the store cookie decides which assortment the listing shows.
   */
  private async dropCloudflareCookies(): Promise<void> {
    const cookies = await this.context.cookies();
    const keep = cookies.filter(
      (c) => !c.name.startsWith('cf_') && !c.name.startsWith('__cf')
    );
    if (keep.length === cookies.length) return;
    await this.context.clearCookies();
    if (keep.length > 0) await this.context.addCookies(keep);
  }

  /**
   * Load a path and return its page state, retrying a throttle with a backoff.
   *
   * Returns null when the page is still throttled after the retries, so that a walk
   * can record the gap and carry on rather than dying on one page.
   */
  async state(
    path: string,
    retries = 3
  ): Promise<Record<string, unknown> | null> {
    const url = path.startsWith('http') ? path : ORIGIN + path;
    let backoff = 20000;

    for (let attempt = 0; ; attempt++) {
      await sleep(this.delayMs);
      await this.dropCloudflareCookies();
      this.requests++;

      const response = await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      const status = response?.status() ?? 0;

      if (status === 200) {
        const state = await this.page.evaluate(
          () =>
            (window as unknown as { __INITIAL_STATE__?: unknown })
              .__INITIAL_STATE__ ?? null
        );
        if (state) return state as Record<string, unknown>;
        return null;
      }

      if ((status === 403 || status === 429) && attempt < retries) {
        this.throttles++;
        await sleep(backoff);
        backoff *= 2;
        continue;
      }

      return null;
    }
  }

  /** Load a path and read it as a listing page. Null when the page did not answer. */
  async listing(path: string): Promise<ListingPage | null> {
    const state = await this.state(path);
    return state ? readListingPage(state) : null;
  }

  /**
   * Call a same origin path with `fetch` from inside the loaded page.
   *
   * An API probe has to run here rather than from node. A request made by node is
   * refused on its TLS fingerprint, so probing from node would report every route as
   * blocked and would say nothing about which routes exist. Inside the page the call
   * carries the browser's own connection and cookies, which is what the storefront's
   * own scripts use.
   */
  async fetchInPage(
    path: string
  ): Promise<{ status: number; contentType: string; body: string }> {
    return this.page.evaluate(async (p: string) => {
      try {
        const res = await fetch(p, { headers: { Accept: 'application/json' } });
        const text = await res.text();
        return {
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          body: text.slice(0, 400),
        };
      } catch (e) {
        return {
          status: 0,
          contentType: '',
          body: `fetch failed: ${(e as Error).message}`,
        };
      }
    }, path);
  }
}

/** One product exactly as the storefront renders it into the page state. */
export interface RawProductCard {
  product_id: string;
  sku_id: string;
  name: string;
  brand?: string;
  /** Formatted for display, Spanish conventions, for example `"7,65 €"`. */
  price: string;
  price_per_unit: string;
  app_price?: string;
  app_price_per_unit?: string;
  measure_unit?: string;
  sell_pack_unit?: number;
  catalog?: string;
  images?: { desktop?: string; mobile?: string };
  url?: string;
}

export interface CategoryLink {
  id: string;
  display_name: string;
  url: string;
}

export interface ListingPage {
  items: RawProductCard[];
  /** What the result set actually holds. Can far exceed what paging will hand over. */
  totalResults: number;
  /** What paging is willing to walk. Capped, see the plan. */
  pageableResults: number;
  pageSize: number;
  totalPages: number;
  offset: number;
  displayName: string;
  firstLevelCategories: CategoryLink[];
  secondLevelCategories: CategoryLink[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function linkItems(node: unknown): CategoryLink[] {
  const items = asRecord(node)['items'];
  if (!Array.isArray(items)) return [];
  return items
    .map((it) => asRecord(it))
    .filter(
      (it) => typeof it['id'] === 'string' && typeof it['url'] === 'string'
    )
    .map((it) => ({
      id: it['id'] as string,
      display_name: (it['display_name'] as string) ?? '',
      url: it['url'] as string,
    }));
}

/** Read the parts of a listing page state that a harvester adapter would care about. */
export function readListingPage(state: Record<string, unknown>): ListingPage {
  const results = asRecord(asRecord(state['productCardList'])['results']);
  const pagination = asRecord(state['pagination']);
  const category = asRecord(state['category']);
  const nav = asRecord(state['horizontalNavigation']);

  const items = Array.isArray(results['items'])
    ? (results['items'] as RawProductCard[])
    : [];

  return {
    items,
    totalResults: Number(results['total_results'] ?? 0),
    pageableResults: Number(pagination['total_results'] ?? 0),
    pageSize: Number(pagination['page_size'] ?? 0),
    totalPages: Number(pagination['total_pages'] ?? 0),
    offset: Number(pagination['offset'] ?? 0),
    displayName: (category['display_name'] as string) ?? '',
    firstLevelCategories: linkItems(nav['firstLevelCategories']),
    secondLevelCategories: linkItems(nav['secondLevelCategories']),
  };
}

/**
 * Turn a displayed Spanish price into cents.
 *
 * `"7,65 €"` becomes 765. Returns null for anything that carries no number, which the
 * storefront does render: some cards priced by weight print no figure.
 */
export function priceToCents(display: string | undefined): number | null {
  if (!display) return null;
  const match = display.replace(/\s/g, '').match(/(\d+(?:\.\d{3})*),(\d{2})/);
  if (!match) return null;
  const whole = match[1].replace(/\./g, '');
  return Number(whole) * 100 + Number(match[2]);
}

/** `/supermercado/<seo>/<id>/c` is the shape of every category listing URL. */
export function categoryIdFromUrl(url: string): string | null {
  const match = url.match(/\/(cat\d+)\/c(?:$|[?#])/);
  return match ? match[1] : null;
}
