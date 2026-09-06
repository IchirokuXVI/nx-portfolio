import { normalizeListPage, normalizeProduct, normalizeStorePage } from './normalize';
import {
  extractNuxtData,
  extractNuxtFlat,
  readProductState,
} from './nuxt-payload';
import {
  LIDL_BASE_URL,
  LIDL_PUBLIC_STORES_API_KEY,
  LIDL_STORES_URL,
  type LidlClientOptions,
  type LidlListRow,
  type LidlProduct,
  type LidlStore,
} from './types';

/**
 * LIDL Spain's three services, grouped behind one boundary so that **nothing
 * else in Luna Shopper ever learns what LIDL's JSON looks like** (plan 0089,
 * section 6). That is this class's entire reason to exist.
 *
 * No TypeORM entity, no Nest decorator, no `Item`, no database. It answers with
 * plain records; the harvester maps them to rows.
 *
 * HTTP is Node's global `fetch` and this library adds no HTTP dependency.
 * Politeness lives here too: an honest User-Agent, one gate every request
 * awaits, backoff with jitter on 429 and 5xx, and an `AbortSignal` threaded
 * through every call.
 *
 * ## Four parameters, and none of them is guessable
 *
 * The index is undocumented and names one missing thing at a time (section 3):
 *
 * - **`Accept: application/json` is refused with 406.** It must be the
 *   wildcard accept header a browser sends, which this client sets.
 * - `assortment`, `locale` and `version` are all required. The locale is
 *   underscored, and `es`, `es-ES` and `ES` are each rejected by name.
 * - An empty `q` with `store=1` returns the in-store assortment, which is the
 *   walk. There is no browse endpoint and no category listing.
 * - `fetchsize` and `offset` page it, up to the `maxfetchsize` of 1,000 the
 *   response reports for itself.
 */

/** Thrown when the source answers something a retry cannot fix. */
export class LidlHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`LIDL answered ${status} for ${url}`);
    this.name = 'LidlHttpError';
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** What the index is asked for beyond the paging. Each one was probed. */
const SEARCH_PARAMS: ReadonlyArray<readonly [string, string]> = [
  ['assortment', 'ES'],
  ['locale', 'es_ES'],
  ['version', '2.0.0'],
];

/** 100 keeps a failed page cheap to retry; the endpoint would allow 1,000. */
const DEFAULT_PAGE_SIZE = 100;

/** What one store request asks for. Three requests cover the whole country. */
const STORE_PAGE_SIZE = 250;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class LidlClient {
  private readonly baseUrl: string;
  private readonly storesUrl: string;
  private readonly storesApiKey: string;
  private readonly pageSize: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly retries: number;
  private readonly backoffBaseMs: number;
  private readonly minIntervalMs: number;
  private readonly acquire?: () => Promise<void>;
  private lastRequestAt = 0;

  /** How many requests this client has made, for the run's own report. */
  requests = 0;

  constructor(private readonly options: LidlClientOptions) {
    this.baseUrl = (options.baseUrl ?? LIDL_BASE_URL).replace(/\/+$/, '');
    this.storesUrl = options.storesUrl ?? LIDL_STORES_URL;
    this.storesApiKey = options.storesApiKey ?? LIDL_PUBLIC_STORES_API_KEY;
    this.pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
    this.retries = options.retries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.acquire = options.acquire;
  }

  /**
   * Every row of the in-store assortment, one page at a time.
   *
   * **It is a snapshot and not a census** (section 2). The site publishes what
   * is on offer this week and next, so this yields the window rather than the
   * chain's permanent assortment, and no caller may report it as a total.
   *
   * Rows are deduplicated by product id as they are yielded: paging a listing
   * that changes under the walk can otherwise repeat one.
   */
  async *walkInStore(): AsyncIterable<LidlListRow> {
    const seen = new Set<string>();
    let total: number | null = null;
    for (let offset = 0; total === null || offset < total; ) {
      const page = normalizeListPage(await this.getJson(this.searchUrl(offset)));
      total ??= page.total;
      if (page.rows.length === 0) {
        // The page reported rows and answered none, so paging further would
        // loop against a total the source no longer stands behind.
        break;
      }
      for (const row of page.rows) {
        if (!seen.has(row.externalId)) {
          seen.add(row.externalId);
          yield row;
        }
      }
      offset += this.pageSize;
    }
  }

  /**
   * One product, from its own page.
   *
   * **Null is a value, not an error** (section 8). A page that answers 404, or
   * carries no payload for the id asked for, costs one product: the run warns,
   * names the `externalId` and carries on, because 152 products written is
   * worth more than a run that failed on one.
   */
  async getProduct(row: LidlListRow): Promise<LidlProduct | null> {
    if (!row.path) {
      return null;
    }
    const html = await this.getText(`${this.baseUrl}${row.path}`);
    if (html === null) {
      return null;
    }
    const state = readProductState(extractNuxtData(html), row.externalId);
    return normalizeProduct(state, {
      row,
      observedAt: this.now(),
      baseUrl: this.baseUrl,
    });
  }

  /**
   * Every Spanish shop, with the price region each one names.
   *
   * Three requests, and the region is read rather than derived: a postal code
   * cannot give it, since 12 of the 52 provinces hold shops in more than one
   * region (section 4.1).
   */
  async listStores(country = 'ES'): Promise<LidlStore[]> {
    const stores: LidlStore[] = [];
    let total: number | null = null;
    for (let offset = 0; total === null || stores.length < total; ) {
      const url = `${this.storesUrl}?${new URLSearchParams({
        limit: String(STORE_PAGE_SIZE),
        offset: String(offset),
        country_code: country,
      }).toString()}`;
      const page = normalizeStorePage(
        await this.getJson(url, { 'x-apikey': this.storesApiKey })
      );
      total ??= page.total;
      if (page.stores.length === 0) {
        break;
      }
      stores.push(...page.stores);
      offset += STORE_PAGE_SIZE;
    }
    return stores;
  }

  /**
   * One page of the index, raw, and one product page's payload, raw.
   *
   * **For the capture tool and nothing else** (section 12). A fixture has to be
   * what the source sent, so these two hand back the response before any of
   * this library has read it; every other caller asks for the normalized form.
   */
  captureSearchPage(offset = 0): Promise<unknown> {
    return this.getJson(this.searchUrl(offset));
  }

  async captureProductPayload(path: string): Promise<unknown | null> {
    const html = await this.getText(`${this.baseUrl}${path}`);
    return html === null ? null : extractNuxtFlat(html);
  }

  captureStorePage(limit: number, country = 'ES'): Promise<unknown> {
    const url = `${this.storesUrl}?${new URLSearchParams({
      limit: String(limit),
      offset: '0',
      country_code: country,
    }).toString()}`;
    return this.getJson(url, { 'x-apikey': this.storesApiKey });
  }

  /** One page of the index. Public so a caller can page it itself. */
  searchUrl(offset: number): string {
    const query = new URLSearchParams(SEARCH_PARAMS.map(([k, v]) => [k, v]));
    query.set('q', '');
    // The filter that turns the online catalog into the in-store assortment.
    query.set('store', '1');
    query.set('fetchsize', String(this.pageSize));
    query.set('offset', String(offset));
    return `${this.baseUrl}/q/api/search?${query.toString()}`;
  }

  private async getJson(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<unknown> {
    const response = await this.request(url, headers);
    return response === null ? null : ((await response.json()) as unknown);
  }

  private async getText(url: string): Promise<string | null> {
    const response = await this.request(url, {});
    return response === null ? null : await response.text();
  }

  /**
   * One GET, gated, retried and abortable. Null on 404; everything else that is
   * not 2xx either retries (429, 5xx) or throws.
   */
  private async request(
    url: string,
    headers: Record<string, string>
  ): Promise<Response | null> {
    let attempt = 0;
    for (;;) {
      this.options.signal?.throwIfAborted();
      await this.gate();
      this.requests += 1;

      const response = await this.fetchImpl(url, {
        headers: {
          // **Not `application/json`.** The index answers 406 to it, and the
          // header a browser sends is what it accepts.
          accept: '*/*',
          'accept-language': 'es-ES,es;q=0.9',
          'user-agent': this.options.userAgent,
          ...headers,
        },
        signal: this.options.signal,
      });

      if (response.status === 404) {
        return null;
      }
      if (response.ok) {
        return response;
      }
      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= this.retries) {
        throw new LidlHttpError(response.status, url);
      }

      // Exponential backoff with jitter. Jitter matters at concurrency: without
      // it every worker that hit the same 429 retries in the same millisecond.
      const backoff = this.backoffBaseMs * 2 ** attempt;
      await this.sleep(backoff + Math.floor(Math.random() * backoff));
      attempt += 1;
    }
  }

  /**
   * What every request waits on.
   *
   * With an `acquire` (the harvester's per run token bucket) this is the shared
   * limiter, so the rate the owner set on the source row is the rate the source
   * sees no matter how many workers run. Without one it falls back to a per
   * client minimum interval, which is only the same thing at concurrency one.
   */
  private async gate(): Promise<void> {
    if (this.acquire) {
      await this.acquire();
      return;
    }
    if (this.minIntervalMs <= 0) {
      return;
    }
    const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    this.lastRequestAt = Date.now();
  }
}
