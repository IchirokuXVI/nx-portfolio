import { pageCountOf, parseListingPage, parseTopCategories } from './listing';
import { parseProductPage } from './product';
import { parseLocations } from './stores';
import { createElJamonFetch } from './transport';
import type {
  ElJamonCategory,
  ElJamonClientOptions,
  ElJamonListingPage,
  ElJamonListingRow,
  ElJamonProduct,
  ElJamonStoreList,
} from './types';

/**
 * El Jamón's online shop and store locator, grouped behind one boundary so that
 * **nothing else in Luna Shopper ever learns what their markup looks like**
 * (plan 0169, section 6).
 *
 * **One client is one session.** Prices appear only in a session that holds a
 * postal code (section 4), and a listing page N is a POST of the filters the
 * session's previous page carried (section 5.1), so the listing walk is serial
 * per client. What the harvester shares between clients is the token bucket
 * passed as `acquire`.
 */
export const ELJAMON_BASE_URL = 'https://www.supermercadoseljamon.com';

export const ELJAMON_LOCATOR_URL =
  'https://portal.supermercadoseljamon.com/Localizador/wp-admin/admin-ajax.php';

/** Lepe, where the chain started. 1000 km from here reaches every shop (section 3). */
export const ELJAMON_LOCATOR_ORIGIN = {
  latitude: 37.2547,
  longitude: -7.2044,
  label: 'Lepe',
};

export const ELJAMON_LOCATOR_RADIUS_KM = 1000;

/** Lepe's postal code. Any served code sees the same prices (section 2). */
export const ELJAMON_DEFAULT_POSTAL_CODE = '21440';

const PORTLET = 'ProductosFoodPortlet_WAR_comerzziaportletsfood';

/** Thrown when the source answers something a retry cannot fix. */
export class ElJamonHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`El Jamón answered ${status} for ${url}`);
    this.name = 'ElJamonHttpError';
  }
}

/** Thrown when the shop will not hold a postal code for this session. */
export class ElJamonSessionError extends Error {
  constructor(
    readonly postalCode: string,
    readonly answer: string
  ) {
    super(
      `El Jamón refused postal code ${postalCode} for this session: ${answer}`
    );
    this.name = 'ElJamonSessionError';
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class ElJamonClient {
  /** Every request this client sent, retries included. On the run's report. */
  requests = 0;

  private readonly baseUrl: string;
  private readonly locatorUrl: string;
  private readonly postalCode: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly retries: number;
  private readonly backoffBaseMs: number;
  private readonly minIntervalMs: number;
  private readonly acquire?: () => Promise<void>;
  /** `JSESSIONID`, and `GCLB`, which keeps the session on one backend. */
  private readonly cookies = new Map<string, string>();
  /** The home page of the current session, which also lists the categories. */
  private home: string | null = null;
  private lastRequestAt = 0;

  constructor(private readonly options: ElJamonClientOptions) {
    this.baseUrl = (options.baseUrl ?? ELJAMON_BASE_URL).replace(/\/+$/, '');
    this.locatorUrl = options.locatorUrl ?? ELJAMON_LOCATOR_URL;
    this.postalCode = options.postalCode ?? ELJAMON_DEFAULT_POSTAL_CODE;
    this.fetchImpl = options.fetchImpl ?? createElJamonFetch();
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.retries = options.retries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 500;
    this.minIntervalMs = options.minIntervalMs ?? 0;
    this.acquire = options.acquire;
  }

  /**
   * Every shop the locator names, in one request (section 3). No session: the
   * locator is a separate WordPress site.
   */
  async listStores(): Promise<ElJamonStoreList> {
    return parseLocations(await this.fetchLocator());
  }

  /** The eleven top level categories, from the session's home page. */
  async topCategories(): Promise<ElJamonCategory[]> {
    await this.ensureSession();
    return parseTopCategories(this.home ?? '');
  }

  /**
   * Every row of one top level category, page by page, in order.
   *
   * Page 1 is a GET and prints the article count; page N is a POST of the
   * listing form carrying the previous page's `filters` with only `page`
   * changed (section 5.1). The same URL as a bare GET answers the home page's
   * carousel instead, which is why the filters are never left out.
   *
   * **A page whose rows repeat a code already seen in this category ends it**,
   * as a guard against a page number the server clamps. So does a page with no
   * rows.
   */
  async *walkCategory(
    category: ElJamonCategory,
    onPage?: (page: ElJamonListingPage, index: number) => void
  ): AsyncIterable<ElJamonListingRow> {
    await this.ensureSession();
    const url = `${this.baseUrl}${category.path}`;
    const first = parseListingPage(await this.get(url));
    onPage?.(first, 1);

    const seen = new Set<string>();
    for (const row of first.rows) {
      seen.add(row.code);
      yield row;
    }

    const pages = pageCountOf(first.articleCount);
    let filters = first.filters;
    for (let index = 2; index <= pages; index += 1) {
      this.options.signal?.throwIfAborted();
      if (!filters) {
        throw new Error(
          `The first page of ${category.path} carried no filters, so page ` +
            `${index} cannot be asked for.`
        );
      }
      const page = parseListingPage(
        await this.post(pageUrl(url, index), pageBody(filters, index))
      );
      onPage?.(page, index);
      if (
        page.rows.length === 0 ||
        page.rows.some((row) => seen.has(row.code))
      ) {
        return;
      }
      for (const row of page.rows) {
        seen.add(row.code);
        yield row;
      }
      filters = page.filters ?? filters;
    }
  }

  /**
   * One product page, by its absolute URL or its path, or null when the page
   * carries no product JSON-LD.
   */
  async getProduct(urlOrPath: string): Promise<ElJamonProduct | null> {
    await this.ensureSession();
    return parseProductPage(await this.get(this.absolute(urlOrPath)));
  }

  /**
   * The rendered markup of one page under this client's session: a path to
   * GET, a category page N to POST, or the locator's answer.
   *
   * Public for exactly one caller: the fixture capture tool, which writes pages
   * **verbatim**. Nothing in the runtime calls it.
   */
  async fetchDocument(
    target:
      | { path: string }
      | { category: ElJamonCategory; page: number; filters: string }
      | 'locator'
  ): Promise<string> {
    if (target === 'locator') {
      return this.fetchLocator();
    }
    await this.ensureSession();
    if ('path' in target) {
      return this.get(this.absolute(target.path));
    }
    const url = `${this.baseUrl}${target.category.path}`;
    return this.post(
      pageUrl(url, target.page),
      pageBody(target.filters, target.page)
    );
  }

  /**
   * Start a shop session with a postal code (section 4).
   *
   * 1. `GET /` starts a `JSESSIONID`. It must be `/`: a session whose first page
   *    was the locator page answers `sessionko` to step 2 every time.
   * 2. The postal code servlet. An empty body is success, and a JSON body is a
   *    refusal.
   *
   * On `sessionko` the session is started once more from nothing, and a second
   * refusal throws, which fails the run.
   */
  private async ensureSession(): Promise<void> {
    if (this.home !== null) {
      return;
    }
    for (let attempt = 0; ; attempt += 1) {
      this.cookies.clear();
      const home = await this.get(`${this.baseUrl}/`);
      const answer = (
        await this.get(
          `${this.baseUrl}/delegate/seleccionarCodPostalAjaxServletFood` +
            `?accion=enviarCodPostal&cp=${encodeURIComponent(this.postalCode)}` +
            '&locale=es'
        )
      ).trim();
      if (answer === '') {
        this.home = home;
        return;
      }
      if (attempt === 0 && /sessionko/.test(answer)) {
        continue;
      }
      throw new ElJamonSessionError(this.postalCode, answer);
    }
  }

  private fetchLocator(): Promise<string> {
    const origin = this.options.locatorOrigin ?? ELJAMON_LOCATOR_ORIGIN;
    const latitude = String(origin.latitude);
    const longitude = String(origin.longitude);
    return this.request(
      this.locatorUrl,
      new URLSearchParams({
        action: 'make_search_request',
        store_locatore_search_input: origin.label,
        store_locatore_search_lat: latitude,
        store_locatore_search_lng: longitude,
        lat: latitude,
        lng: longitude,
        store_locatore_search_radius: String(
          this.options.locatorRadiusKm ?? ELJAMON_LOCATOR_RADIUS_KM
        ),
        store_locator_category: '',
      }),
      false
    );
  }

  private absolute(urlOrPath: string): string {
    return /^https?:\/\//.test(urlOrPath)
      ? urlOrPath
      : `${this.baseUrl}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
  }

  private get(url: string): Promise<string> {
    return this.request(url, undefined, true);
  }

  private post(url: string, body: URLSearchParams): Promise<string> {
    return this.request(url, body, true);
  }

  /**
   * One request, gated, retried and abortable. Everything that is not 2xx either
   * retries (429, 5xx) or throws.
   */
  private async request(
    url: string,
    body: URLSearchParams | undefined,
    session: boolean
  ): Promise<string> {
    let attempt = 0;
    for (;;) {
      this.options.signal?.throwIfAborted();
      await this.gate();

      const headers: Record<string, string> = {
        accept: 'text/html,application/json',
        'user-agent': this.options.userAgent,
      };
      const cookie = session ? this.cookieHeader() : '';
      if (cookie) {
        headers['cookie'] = cookie;
      }
      if (body) {
        headers['content-type'] = 'application/x-www-form-urlencoded';
      }

      this.requests += 1;
      const response = await this.fetchImpl(url, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body?.toString(),
        signal: this.options.signal,
      });
      if (session) {
        this.rememberCookies(response);
      }

      if (response.ok) {
        return await response.text();
      }
      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= this.retries) {
        throw new ElJamonHttpError(response.status, url);
      }

      // Exponential backoff with jitter. Jitter matters at concurrency: without
      // it every worker that hit the same 429 retries in the same millisecond.
      const backoff = this.backoffBaseMs * 2 ** attempt;
      await this.sleep(backoff + Math.floor(Math.random() * backoff));
      attempt += 1;
    }
  }

  /**
   * The session, kept by hand. `fetch` has no cookie jar and this library adds
   * no HTTP dependency, so the cookies are stored as name/value pairs and sent
   * back. The jar lives as long as the client does, which is one session.
   */
  private rememberCookies(response: Response): void {
    const headers = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    const raw =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie') ?? ''];
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
   * What every request waits on: the run's shared token bucket when there is
   * one, else a per client minimum interval, which is only the same thing at
   * concurrency one.
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

/** The listing form's own action, as the page's pager writes it. */
function pageUrl(categoryUrl: string, page: number): string {
  const query = new URLSearchParams({
    p_p_id: PORTLET,
    p_p_lifecycle: '1',
    p_p_state: 'normal',
    p_p_mode: 'view',
    p_p_col_id: 'column-2',
    p_p_col_count: '1',
    [`_${PORTLET}_accion`]: 'buscar',
    [`_${PORTLET}_operacion`]: 'paginar',
    [`_${PORTLET}_pagina`]: String(page),
  });
  return `${categoryUrl}?${query.toString()}`;
}

/** The previous page's filters with only `page` changed (section 5.1). */
function pageBody(filters: string, page: number): URLSearchParams {
  const parsed = JSON.parse(filters) as Record<string, unknown>;
  parsed['page'] = page;
  return new URLSearchParams({
    filters: JSON.stringify(parsed),
    modoCuadricula: 'cuadriculaP',
    idPortlet: '',
  });
}
