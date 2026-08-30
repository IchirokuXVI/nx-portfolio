import {
  normalizeCategories,
  normalizeCategoryProducts,
  normalizeProduct,
  type NormalizeProductOptions,
} from './normalize';
import type {
  MercadonaCategory,
  MercadonaClientOptions,
  MercadonaLang,
  MercadonaListProduct,
  MercadonaProduct,
} from './types';
import type { Json } from './json';

/**
 * Mercadona's storefront API, grouped behind one boundary so that **nothing else
 * in Luna Shopper ever learns what Mercadona's JSON looks like** (plan 0038,
 * section 3.1). That is this class's entire reason to exist.
 *
 * No TypeORM entity, no Nest decorator, no `Item`, no database. It takes a
 * warehouse code and returns plain records; the harvester maps them to rows.
 *
 * The method names deliberately shadow the future `SupermarketSourceAdapter`:
 * `resolveWarehouse` is `resolveScope`, `walkCatalog` is `discover`,
 * `fetchProduct` is `fetch`. There is no `search`, because the API has none.
 *
 * HTTP is Node's global `fetch` and this library adds no HTTP dependency
 * (section 3.4). Politeness lives here too: an honest User-Agent, one gate every
 * request awaits, backoff with jitter on 429 and 5xx, 404 as a value, and an
 * `AbortSignal` threaded through every call.
 */
export const MERCADONA_BASE_URL = 'https://tienda.mercadona.es/api';

/** Thrown when the source answers something a retry cannot fix. */
export class MercadonaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`Mercadona answered ${status} for ${url}`);
    this.name = 'MercadonaHttpError';
  }
}

interface ResolveWarehouseOptions {
  baseUrl?: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class MercadonaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly retries: number;
  private readonly backoffBaseMs: number;
  private readonly minIntervalMs: number;
  private readonly acquire?: () => Promise<void>;
  private lastRequestAt = 0;

  constructor(private readonly options: MercadonaClientOptions) {
    this.baseUrl = (options.baseUrl ?? MERCADONA_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
    this.retries = options.retries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.acquire = options.acquire;
  }

  /**
   * Postal code to warehouse (plan 0038, section 2.2). Stateless: no cookie and
   * no session, the answer is a response header. This is **the chain answering a
   * question about its own pricing**, which is why the postal code decides the
   * price scope while a radius decides the store list (section 2.8).
   *
   * The key comes back in two shapes, a numeric code (`4661`) and a city slug
   * (`mad3`), which is why `PriceScope.externalKey` is varchar.
   */
  static async resolveWarehouse(
    postalCode: string,
    options: ResolveWarehouseOptions
  ): Promise<string> {
    const base = (options.baseUrl ?? MERCADONA_BASE_URL).replace(/\/+$/, '');
    const url = `${base}/postal-codes/actions/change-pc/`;
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': options.userAgent,
      },
      body: JSON.stringify({ new_postal_code: postalCode }),
      signal: options.signal,
    });
    if (!response.ok) {
      throw new MercadonaHttpError(response.status, url);
    }
    const warehouse = response.headers.get('x-customer-wh');
    if (!warehouse) {
      throw new Error(
        `Mercadona accepted postal code ${postalCode} but returned no ` +
          'x-customer-wh header, so there is no warehouse to scope prices to.'
      );
    }
    return warehouse;
  }

  /** The category tree, two levels (26 roots holding 151 children). */
  async listCategories(lang: MercadonaLang = 'es'): Promise<MercadonaCategory[]> {
    const payload = await this.getJson(this.url('/categories/', lang));
    return payload === null ? [] : normalizeCategories(payload);
  }

  /**
   * One level 1 category, expanded to its level 2 children **with their products
   * inline**. This is the cheap half of a discovery run: 151 requests for the
   * whole assortment, but with no `ean` and no `brand` on any of it.
   */
  async listCategoryProducts(
    categoryId: number,
    lang: MercadonaLang = 'es'
  ): Promise<MercadonaListProduct[]> {
    const payload = await this.getJson(
      this.url(`/categories/${categoryId}/`, lang)
    );
    return payload === null ? [] : normalizeCategoryProducts(payload);
  }

  /**
   * Product detail, raw. **Null on 404**, which is a normal state meaning "not
   * stocked in this warehouse" (section 2.6): a value, not an error, and it sets
   * availability rather than failing a run.
   */
  async getProduct(
    externalId: string,
    lang: MercadonaLang = 'es'
  ): Promise<Json | null> {
    return this.getJson(this.url(`/products/${externalId}/`, lang));
  }

  /**
   * Product detail, normalized, in one or both languages.
   *
   * Discovery passes `['es']` only: fetching both doubles a run from 4,232
   * requests to 8,464 (section 6.2). The English name is needed only when an
   * `Item` is actually created, so it is fetched then, for that one product.
   */
  async fetchProduct(
    externalId: string,
    langs: MercadonaLang[] = ['es'],
    options: NormalizeProductOptions = {}
  ): Promise<MercadonaProduct | null> {
    const spanish = await this.getProduct(externalId, 'es');
    if (spanish === null) {
      return null;
    }
    let englishName: string | null = null;
    if (langs.includes('en')) {
      const english = await this.getProduct(externalId, 'en');
      englishName =
        english && typeof english === 'object' && english !== null
          ? ((english as Record<string, unknown>)['display_name'] as
              | string
              | undefined) ?? null
          : null;
    }
    return normalizeProduct(spanish, {
      observedAt: this.now(),
      ...options,
      englishName: englishName ?? options.englishName ?? null,
    });
  }

  /**
   * Walk the whole assortment: the tree, then every level 1 category expanded.
   *
   * Products are deduplicated by external id as they are yielded, because a
   * product filed under several branches appears in several category responses
   * and the caller's work queue must hold it once.
   */
  async *walkCatalog(
    lang: MercadonaLang = 'es'
  ): AsyncIterable<MercadonaListProduct> {
    const seen = new Set<string>();
    for (const root of await this.listCategories(lang)) {
      for (const child of root.children) {
        for (const product of await this.listCategoryProducts(child.id, lang)) {
          if (!product.externalId || seen.has(product.externalId)) {
            continue;
          }
          seen.add(product.externalId);
          yield product;
        }
      }
    }
  }

  private url(path: string, lang: MercadonaLang): string {
    const query = new URLSearchParams({
      lang,
      wh: this.options.warehouse,
    });
    return `${this.baseUrl}${path}?${query.toString()}`;
  }

  /**
   * One GET, gated, retried and abortable. Null on 404; everything else that is
   * not 2xx either retries (429, 5xx) or throws.
   */
  private async getJson(url: string): Promise<Json | null> {
    let attempt = 0;
    for (;;) {
      this.options.signal?.throwIfAborted();
      await this.gate();

      const response = await this.fetchImpl(url, {
        headers: {
          accept: 'application/json',
          'user-agent': this.options.userAgent,
        },
        signal: this.options.signal,
      });

      if (response.status === 404) {
        return null;
      }
      if (response.ok) {
        return (await response.json()) as Json;
      }
      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= this.retries) {
        throw new MercadonaHttpError(response.status, url);
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
   * limiter of section 6.3, so the configured rate is the rate the source sees no
   * matter how many workers run. Without one it falls back to a per client
   * minimum interval, which is only the same thing at concurrency one, and that
   * is exactly why the harvester passes a bucket rather than a delay.
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
