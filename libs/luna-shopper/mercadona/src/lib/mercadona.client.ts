import type { CategoryPathNode } from './categories';
import type { Json } from './json';
import {
  normalizeCategories,
  normalizeCategoryProducts,
  normalizeProduct,
  type NormalizeProductOptions,
} from './normalize';
import {
  MERCADONA_STORES_TOTAL_URL,
  MERCADONA_STORES_URL,
  parseStoreDocument,
  parseStoreTotals,
  type MercadonaStoreList,
} from './stores';
import type {
  MercadonaCategory,
  MercadonaClientOptions,
  MercadonaLang,
  MercadonaListProduct,
  MercadonaProduct,
} from './types';

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

/**
 * What one postal code lookup needs.
 *
 * A store discovery asks this 1,213 times, once per distinct postal code the
 * chain's own shop list names (plan 0106, section 3), so it takes the same
 * politeness the walk does: the run's shared token bucket through `acquire`,
 * and backoff on the statuses a retry can fix.
 */
export interface ResolveWarehouseOptions {
  baseUrl?: string;
  userAgent: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Awaited before the request, which is where the run's rate limit lives. */
  acquire?: () => Promise<void>;
  retries?: number;
  backoffBaseMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

/** What reading the whole store list needs. One request, plus one for the counts. */
export interface ListStoresOptions {
  userAgent: string;
  /** Overridden from the source row, never from the environment (plan 0083). */
  storesUrl?: string;
  totalsUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  acquire?: () => Promise<void>;
  retries?: number;
  backoffBaseMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request, gated, retried and abortable.
 *
 * It exists beside the instance `getJson` because the two calls a store
 * discovery makes have no warehouse to be scoped to: the shop list is one
 * static document, and the postal code lookup is the request that finds a
 * warehouse in the first place. **Null on 404**, which both callers treat as a
 * value rather than as a failure.
 *
 * The response is handed back unread, because the two callers want different
 * halves of it: the postal code lookup wants one header and never the body.
 */
async function request(
  url: string,
  init: RequestInit,
  options: {
    fetchImpl?: typeof fetch;
    acquire?: () => Promise<void>;
    sleepImpl?: (ms: number) => Promise<void>;
    retries?: number;
    backoffBaseMs?: number;
    signal?: AbortSignal;
  }
): Promise<Response | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleepImpl ?? defaultSleep;
  const retries = options.retries ?? 3;
  const backoffBaseMs = options.backoffBaseMs ?? 500;

  let attempt = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    await options.acquire?.();

    const response = await fetchImpl(url, { ...init, signal: options.signal });
    if (response.status === 404) {
      return null;
    }
    if (response.ok) {
      return response;
    }
    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= retries) {
      throw new MercadonaHttpError(response.status, url);
    }
    const backoff = backoffBaseMs * 2 ** attempt;
    await sleep(backoff + Math.floor(Math.random() * backoff));
    attempt += 1;
  }
}

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
   *
   * **Null is a value, and it means the chain sells online to nobody there**
   * (plan 0106, D5). 150 of the 1,137 postal codes a Spanish shop sits on answer
   * 404 with "This zip code is outside of our working area", and every
   * Portuguese code answers the same way, because this is the Spanish
   * storefront. A shop on one of them has no warehouse to be priced by and
   * takes the `STORE` scope every location with no named scope already takes.
   */
  static async resolveWarehouse(
    postalCode: string,
    options: ResolveWarehouseOptions
  ): Promise<string | null> {
    const base = (options.baseUrl ?? MERCADONA_BASE_URL).replace(/\/+$/, '');
    const url = `${base}/postal-codes/actions/change-pc/`;
    const response = await request(
      url,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': options.userAgent,
        },
        body: JSON.stringify({ new_postal_code: postalCode }),
      },
      options
    );
    if (response === null) {
      return null;
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

  /**
   * Every shop the chain publishes, and a count to check it against (plan 0106).
   *
   * Static, because the store finder's document is not part of the storefront
   * API and needs no warehouse: reading the shops is what a run does **before**
   * it knows any warehouse at all.
   *
   * Two requests. The second one asks the companion document what the chain
   * believes it published, so a run can say it read the whole file rather than
   * assume it. A companion that is missing or unreadable leaves `declared`
   * empty, because a check that could not be made is not a check that failed.
   */
  static async listStores(
    options: ListStoresOptions
  ): Promise<MercadonaStoreList> {
    const headers = {
      accept: '*/*',
      'user-agent': options.userAgent,
    };
    const document = await request(
      options.storesUrl ?? MERCADONA_STORES_URL,
      { headers },
      options
    );
    if (document === null) {
      throw new Error(
        "Mercadona's store list answered 404. The store finder loads one " +
          'static document and a run cannot name a shop without it.'
      );
    }
    const { publishedOn, stores } = parseStoreDocument(await document.text());

    let declared: Record<string, number> = {};
    try {
      const totals = await request(
        options.totalsUrl ?? MERCADONA_STORES_TOTAL_URL,
        { headers },
        options
      );
      declared = totals === null ? {} : parseStoreTotals(await totals.text());
    } catch {
      // The count is what a run checks itself against, so failing to read it
      // costs the check and never the 1,675 shops that were read.
      declared = {};
    }

    return { publishedOn, stores, declared };
  }

  /** The category tree, two levels (26 roots holding 151 children). */
  async listCategories(
    lang: MercadonaLang = 'es'
  ): Promise<MercadonaCategory[]> {
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
    lang: MercadonaLang = 'es',
    ancestors: CategoryPathNode[] = []
  ): Promise<MercadonaListProduct[]> {
    const payload = await this.getJson(
      this.url(`/categories/${categoryId}/`, lang)
    );
    return payload === null
      ? []
      : normalizeCategoryProducts(payload, ancestors);
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
          ? (((english as Record<string, unknown>)['display_name'] as
              | string
              | undefined) ?? null)
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
      // The root is passed down as the ancestor because the response for a level
      // 2 category does not contain it, and the category map in section 5.6 is
      // keyed on the 26 level 1 names. Without it every product arrives with a
      // path starting at level 2, nothing matches, and the whole assortment
      // resolves to OTHER.
      const rootNode: CategoryPathNode = { id: root.id, name: root.name };
      for (const child of root.children) {
        for (const product of await this.listCategoryProducts(child.id, lang, [
          rootNode,
        ])) {
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
