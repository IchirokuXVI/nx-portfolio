import { DEZA_CEILING_PAGES, parseProductPage } from './rows';
import { parseSectionTree } from './sections';
import type {
  DezaClientOptions,
  DezaPage,
  DezaProductRow,
  DezaQuery,
  DezaSection,
} from './types';

/**
 * DEZA's product listing, grouped behind one boundary so that **nothing else in
 * Luna Shopper ever learns what its markup looks like** (plan 0085, section 5).
 *
 * No TypeORM entity, no Nest decorator, no `Item`, no database. It takes a
 * section code and returns plain records; the harvester maps them to rows and
 * owns `normalizeName`, which is not copied here.
 *
 * **One client is one query.** The chain holds the selected section in a PHP
 * session cookie, so `?wpdz-pagination=1&paged=N` follows whatever the last POST
 * on that cookie selected. Two workers sharing a jar would move each other's
 * section between pages, which is why each in flight query gets its own client
 * and the only thing shared between workers is the token bucket passed as
 * `acquire` (section 2).
 */
export const DEZA_BASE_URL = 'https://www.dezacalidad.es';

/** Where the listing lives. `robots.txt` allows it; only `/wp-admin/` is out. */
export const DEZA_PRODUCTS_PATH = '/productos/';

/** Thrown when the source answers something a retry cannot fix. */
export class DezaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`DEZA answered ${status} for ${url}`);
    this.name = 'DezaHttpError';
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The form the listing posts to itself.
 *
 * `wpdz-input-name` matches anywhere in the description and the source **ANDs**
 * the words in it, which is what makes a second term a genuine narrowing of the
 * first rather than a different query (plan 0085, section 3).
 */
function queryBody(query: DezaQuery): URLSearchParams {
  const body = new URLSearchParams({ wpdzSeccProd: query.section });
  const terms = (query.terms ?? []).filter((term) => term.trim() !== '');
  if (terms.length > 0) {
    body.set('wpdz-input-name', terms.join(' '));
  }
  return body;
}

export class DezaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retries: number;
  private readonly backoffBaseMs: number;
  private readonly minIntervalMs: number;
  private readonly acquire?: () => Promise<void>;
  /** This client's own session. See the class doc for why it is not shared. */
  private readonly cookies = new Map<string, string>();
  private lastRequestAt = 0;

  constructor(private readonly options: DezaClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEZA_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.retries = options.retries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.acquire = options.acquire;
  }

  /**
   * The section tree, from the search form on the landing page. One request.
   *
   * It is read rather than pinned so that a section the chain adds is crawled
   * without a code change, which is the point section 5 makes about not hard
   * coding it.
   */
  async fetchSectionTree(): Promise<DezaSection[]> {
    return parseSectionTree(await this.get(this.productsUrl()));
  }

  /**
   * Select a section (and optionally narrow it by search terms) and read the
   * first page of the result.
   *
   * This is a POST, and the selection it makes is held in this client's session
   * cookie. Every {@link fetchPage} after it follows that selection.
   */
  async openQuery(query: DezaQuery): Promise<DezaPage> {
    return parseProductPage(
      await this.post(this.productsUrl(), queryBody(query))
    );
  }

  /**
   * Page `n` of whatever {@link openQuery} last selected on this client.
   *
   * A page past the end of the result answers 200 with an empty grid, so it
   * parses as zero rows rather than raising.
   */
  async fetchPage(page: number): Promise<DezaPage> {
    const url = `${this.productsUrl()}?wpdz-pagination=1&paged=${page}`;
    return parseProductPage(await this.get(url));
  }

  /**
   * Every row of one query, page by page, deduplicated by description.
   *
   * **The listing repeats rows**: one product filed under two sections comes
   * back twice in a single result set (section 6). The caller deduplicates again
   * on the identity key, because a repeat across two queries is just as common
   * as a repeat within one.
   *
   * It stops at the source's ceiling and reports whether it hit it, because a
   * query that did is not a complete answer and section 3 has to narrow it.
   */
  async *walkQuery(
    query: DezaQuery,
    onPage?: (page: DezaPage, index: number) => void
  ): AsyncIterable<DezaProductRow> {
    const first = await this.openQuery(query);
    onPage?.(first, 1);
    const seen = new Set<string>();
    for (const row of first.rows) {
      if (!seen.has(row.description)) {
        seen.add(row.description);
        yield row;
      }
    }
    const last = Math.min(first.lastPage, DEZA_CEILING_PAGES);
    for (let page = 2; page <= last; page += 1) {
      this.options.signal?.throwIfAborted();
      const next = await this.fetchPage(page);
      onPage?.(next, page);
      for (const row of next.rows) {
        if (!seen.has(row.description)) {
          seen.add(row.description);
          yield row;
        }
      }
    }
  }

  /**
   * The rendered markup of one page, under this client's session: a path to GET,
   * or a query to select with a POST.
   *
   * Public for exactly one caller: the fixture capture tool, which writes pages
   * **verbatim**. A capture that went through the parser would store what the
   * parser understood rather than what the source sent, which is the one thing a
   * fixture must not do. Nothing in the runtime calls it.
   */
  fetchDocument(
    target: DezaQuery | string = DEZA_PRODUCTS_PATH
  ): Promise<string> {
    return typeof target === 'string'
      ? this.get(`${this.baseUrl}${target}`)
      : this.post(this.productsUrl(), queryBody(target));
  }

  private productsUrl(): string {
    return `${this.baseUrl}${DEZA_PRODUCTS_PATH}`;
  }

  private get(url: string): Promise<string> {
    return this.request(url, undefined);
  }

  private post(url: string, body: URLSearchParams): Promise<string> {
    return this.request(url, body);
  }

  /**
   * One request, gated, retried and abortable. Everything that is not 2xx either
   * retries (429, 5xx) or throws.
   *
   * A 404 is **not** a value here, unlike Mercadona's product detail: this source
   * answers 200 with an empty grid for a page past the end, so a 404 would mean
   * the listing itself moved.
   */
  private async request(
    url: string,
    body: URLSearchParams | undefined
  ): Promise<string> {
    let attempt = 0;
    for (;;) {
      this.options.signal?.throwIfAborted();
      await this.gate();

      const headers: Record<string, string> = {
        accept: 'text/html',
        'user-agent': this.options.userAgent,
      };
      const cookie = this.cookieHeader();
      if (cookie) {
        headers['cookie'] = cookie;
      }
      if (body) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
      }

      const response = await this.fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body?.toString(),
        signal: this.options.signal,
      });
      this.rememberCookies(response);

      if (response.ok) {
        return await response.text();
      }
      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= this.retries) {
        throw new DezaHttpError(response.status, url);
      }

      // Exponential backoff with jitter. Jitter matters at concurrency: without
      // it every worker that hit the same 429 retries in the same millisecond.
      const backoff = this.backoffBaseMs * 2 ** attempt;
      await this.sleep(backoff + Math.floor(Math.random() * backoff));
      attempt += 1;
    }
  }

  /**
   * The session, kept by hand.
   *
   * `fetch` has no cookie jar and this library adds no HTTP dependency, so the
   * three or four cookies WordPress sets are stored as name/value pairs and sent
   * back. Nothing here reads an attribute: the jar lives as long as the client
   * does, which is one query, so expiry and path never come up.
   */
  private rememberCookies(response: Response): void {
    const raw =
      typeof (response.headers as { getSetCookie?: () => string[] })
        .getSetCookie === 'function'
        ? (
            response.headers as unknown as { getSetCookie: () => string[] }
          ).getSetCookie()
        : [response.headers.get('set-cookie') ?? ''];
    for (const line of raw) {
      const pair = line.split(';', 1)[0];
      const equals = pair.indexOf('=');
      if (equals <= 0) {
        continue;
      }
      this.cookies.set(pair.slice(0, equals).trim(), pair.slice(equals + 1));
    }
  }

  private cookieHeader(): string {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /**
   * What every request waits on.
   *
   * With an `acquire` (the harvester's per run token bucket) this is the shared
   * limiter of plan 0038 section 6.3, so the configured rate is the rate the
   * source sees no matter how many workers run. Without one it falls back to a
   * per client minimum interval, which is only the same thing at concurrency
   * one, and that is exactly why the harvester passes a bucket rather than a
   * delay.
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
