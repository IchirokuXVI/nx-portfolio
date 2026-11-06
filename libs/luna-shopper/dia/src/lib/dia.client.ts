import {
  SourceGuard,
  type RefusalPolicy,
} from '@portfolio/luna-shopper/source-guard';
import { parseListing } from './listing';
import { parseMenu } from './menu';
import { parseStoreDetail, parseStoreFile, parseStoreFileUrl } from './stores';
import type {
  DiaClientOptions,
  DiaListingPage,
  DiaMenu,
  DiaStoreDetail,
  DiaStoreFile,
} from './types';

/**
 * DIA's online shop and store finder, grouped behind one boundary so that
 * nothing else in Luna Shopper learns what their JSON looks like (plan 0174,
 * section 8).
 *
 * **One client holds one session at a time.** A price belongs to a fulfilment
 * store, the session is set to one by postal code, and the session is server
 * state, so scopes are walked one after another and never in parallel (section
 * 6.3).
 */
export const DIA_BASE_URL = 'https://www.dia.es';

/**
 * **Decision D1 (plan 0174, section 2). Read that section before changing
 * this.**
 *
 * Akamai refuses every request whose User-Agent names us, even a Chrome string
 * with our name appended, and refuses `node:https` whatever it sends. Node's
 * global `fetch` with these three headers answers 200. So this is the one
 * adapter that sends an unmodified browser User-Agent, by the owner's decision,
 * and this constant is the one place to review it and the one place to remove
 * it. It is not an option of the client on purpose.
 *
 * Everything else stays polite: at most 2 requests per second, `robots.txt`
 * respected, and no request the public site does not make itself (section 10).
 */
export const DIA_BROWSER_HEADERS: Readonly<Record<string, string>> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'es-ES,es;q=0.9',
};

const API = '/api/v1';
const LISTING = `${API}/plp-back/reduced`;

/** Thrown when the source answers something a retry cannot fix. */
export class DiaHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`DIA answered ${status} for ${url}`);
    this.name = 'DiaHttpError';
  }
}

/**
 * Thrown when a session will not hold a postal code (section 3.4).
 *
 * An unserved code answers 206 and **the session keeps the code it had**, so a
 * walk that went on would read another store's prices. `reason` says which of
 * the three checks failed.
 */
export class DiaSessionError extends Error {
  constructor(
    readonly postalCode: string,
    readonly reason: 'refused' | 'postal-code-not-kept' | 'store-mismatch',
    detail: string
  ) {
    super(`DIA session for postal code ${postalCode}: ${detail}`);
    this.name = 'DiaSessionError';
  }
}

/**
 * When the client stops (plan 0174, section 10; plan 0215, section 3): five
 * failed requests in a row, and no pause.
 *
 * **Every failure counts**, a request with no answer included, because the
 * one block measured was refused connections and not a status. A request is
 * counted only after its own retries: 60 s on a 403, and 30, 60 and 120 s on
 * anything else. That wait is why the run does not pause on top of it.
 *
 * The stop is the guard's {@link SourceBlockedError}, thrown by the request
 * that stops the client and by every call after it. A blocked edge refuses
 * connections for minutes, and a walk that went on would fail every remaining
 * page at full speed.
 */
export const DIA_REFUSAL_POLICY: Readonly<RefusalPolicy> = {
  consecutive: 5,
  window: null,
  coolDowns: 0,
  coolDownMs: 0,
  probes: 0,
};

/** One answer, undecoded. Public for the fixture capture tool alone. */
export interface DiaRawResponse {
  status: number;
  bytes: Uint8Array;
  location: string | null;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class DiaClient {
  /** Every request this client sent, retries included. On the run's report. */
  requests = 0;

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly retries: number;
  private readonly backoffBaseMs: number;
  private readonly forbiddenRetryMs: number;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  /**
   * The run's guard, or one of this client's own from
   * {@link DIA_REFUSAL_POLICY} when none was passed, so a client used alone
   * (the capture tool, a spec) still stops on the fifth failure in a row.
   */
  private readonly guard: SourceGuard;
  /** Whether this client admits through the guard itself. */
  private readonly admitsGuard: boolean;
  /** `session_id` and Akamai's own. `fetch` keeps none, so they are kept here. */
  private readonly cookies = new Map<string, string>();
  private lastRequestAt = 0;

  constructor(private readonly options: DiaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DIA_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
    this.now = options.nowImpl ?? (() => Date.now());
    this.retries = options.retries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 30_000;
    this.forbiddenRetryMs = options.forbiddenRetryMs ?? 60_000;
    this.minIntervalMs = options.minIntervalMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.guard =
      options.guard ??
      new SourceGuard(
        {
          ...DIA_REFUSAL_POLICY,
          consecutive:
            options.maxConsecutiveFailures ?? DIA_REFUSAL_POLICY.consecutive,
        },
        { now: this.now, sleep: this.sleep }
      );
    // A passed guard is admitted by the caller's `acquire`, as the run's is.
    // This client's own guard is admitted here, since nothing else knows it.
    this.admitsGuard = !options.guard || !options.acquire;
  }

  /** The category menu: roots and leaves, in Spanish. */
  async menu(): Promise<DiaMenu> {
    return parseMenu(await this.json(`${API}/common-aggregator/menu-data`));
  }

  /**
   * One page of a leaf's listing, under the current session.
   *
   * `path` is the leaf's own link, `/agua-y-refrescos/cola/c/L2108`. Pages are
   * asked for with `?page=N` on the API, never the `/pag-N` path that
   * `robots.txt` disallows (section 10).
   *
   * **A leaf that answers 301 has moved**: `Location` is followed once and the
   * answer names where it went, so the run can report it (section 6.4).
   */
  async listing(path: string, page = 1): Promise<DiaListingPage> {
    const query = page > 1 ? `?page=${page}` : '';
    let response = await this.request(`${LISTING}${path}${query}`);
    let movedTo: string | null = null;
    if (isRedirect(response.status)) {
      movedTo = webPath(response.location);
      if (!movedTo) {
        throw new DiaHttpError(response.status, `${LISTING}${path}${query}`);
      }
      response = await this.request(`${LISTING}${movedTo}${query}`);
    }
    if (response.status !== 200) {
      throw new DiaHttpError(
        response.status,
        `${LISTING}${movedTo ?? path}${query}`
      );
    }
    return { ...parseListing(decode(response)), movedTo };
  }

  /**
   * The fulfilment store that serves a postal code, or null when the code has
   * no online service (section 3.1): 200 with `physical_store_id`, or 206 with
   * an empty body.
   */
  async checkService(postalCode: string): Promise<string | null> {
    const url =
      `${API}/common-aggregator/check-service` +
      `?postal_code=${encodeURIComponent(postalCode)}`;
    const response = await this.request(url);
    if (response.status === 206) {
      return null;
    }
    if (response.status !== 200) {
      throw new DiaHttpError(response.status, url);
    }
    const store = asRecord(decode(response))['physical_store_id'];
    return typeof store === 'string' && store.trim() !== ''
      ? store.trim()
      : typeof store === 'number'
        ? String(store)
        : null;
  }

  /**
   * Start a fresh session set to a postal code, and confirm it (sections 3.4
   * and 6.3).
   *
   * 1. `header-data` starts the session.
   * 2. `PUT save-shipping-address`, expecting 204.
   * 3. `header-data` must now show the code as `cart.postal_code`.
   * 4. `check-service` on the code must answer `expectedStore`, when one is
   *    given.
   *
   * Any mismatch throws {@link DiaSessionError}. The session is never walked
   * under a postal code it did not confirm. Answers the store that serves it.
   */
  async startSession(
    postalCode: string,
    expectedStore?: string
  ): Promise<string> {
    this.cookies.clear();
    await this.headerPostalCode();
    const url =
      `${API}/common-aggregator/save-shipping-address` +
      `?new_postal_code=${encodeURIComponent(postalCode)}`;
    const saved = await this.request(url, { method: 'PUT', body: 'null' });
    if (saved.status !== 204) {
      throw new DiaSessionError(
        postalCode,
        'refused',
        `the site answered ${saved.status} and kept the code it had`
      );
    }
    const kept = await this.headerPostalCode();
    if (kept !== postalCode) {
      throw new DiaSessionError(
        postalCode,
        'postal-code-not-kept',
        `the session holds ${kept ?? 'no postal code'}`
      );
    }
    const store = await this.checkService(postalCode);
    if (store === null || (expectedStore && store !== expectedStore)) {
      throw new DiaSessionError(
        postalCode,
        'store-mismatch',
        `the code is served by ${store ?? 'no store'}` +
          (expectedStore ? `, not by ${expectedStore}` : '')
      );
    }
    return store;
  }

  /**
   * The store a visitor who gave no postal code is priced by (section 3.2): a
   * fresh session's `cart.postal_code`, then `check-service` on it.
   */
  async anonymousStore(): Promise<{
    postalCode: string | null;
    storeCode: string | null;
  }> {
    this.cookies.clear();
    const postalCode = await this.headerPostalCode();
    return {
      postalCode,
      storeCode: postalCode ? await this.checkService(postalCode) : null,
    };
  }

  /**
   * Every shop, in two requests (section 5.1): the store finder page names the
   * current file in its hidden `#gz` input, then the file itself.
   */
  async storeFile(): Promise<DiaStoreFile> {
    const page = '/tiendas/buscador-tiendas-folletos';
    const html = await this.request(page);
    if (html.status !== 200) {
      throw new DiaHttpError(html.status, page);
    }
    const url = parseStoreFileUrl(
      Buffer.from(html.bytes).toString('utf8'),
      this.baseUrl
    );
    if (!url) {
      throw new Error('The DIA store finder page names no shop file.');
    }
    const file = await this.request(url);
    if (file.status !== 200) {
      throw new DiaHttpError(file.status, url);
    }
    return parseStoreFile(file.bytes);
  }

  /** One shop's detail by `idTienda`, or null when it names no shop. */
  async storeDetail(idTienda: string): Promise<DiaStoreDetail | null> {
    const url =
      '/tiendas/buscadorTiendas.html?action=buscarInformacionTienda' +
      `&id=${encodeURIComponent(idTienda)}`;
    const response = await this.request(url);
    if (response.status !== 200) {
      throw new DiaHttpError(response.status, url);
    }
    return parseStoreDetail(decode(response));
  }

  /**
   * One answer, verbatim, under this client's session.
   *
   * Public for exactly one caller: the fixture capture tool, which writes
   * answers byte for byte. Nothing in the runtime calls it.
   */
  fetchRaw(
    urlOrPath: string,
    init: { method?: string; body?: string } = {}
  ): Promise<DiaRawResponse> {
    return this.request(urlOrPath, init);
  }

  private async headerPostalCode(): Promise<string | null> {
    const body = asRecord(
      await this.json(`${API}/common-aggregator/header-data`)
    );
    const code = asRecord(body['cart'])['postal_code'];
    return typeof code === 'string' && code.trim() !== '' ? code.trim() : null;
  }

  private async json(path: string): Promise<unknown> {
    const response = await this.request(path);
    if (response.status !== 200) {
      throw new DiaHttpError(response.status, path);
    }
    return decode(response);
  }

  /**
   * One request, gated, retried and abortable. Any 2xx or 3xx is an answer the
   * caller reads: a 204, a 206 and a 301 all mean something here.
   *
   * - A 429, a 5xx, a connection error or a timeout is retried with backoff of
   *   30, 60 and 120 seconds, because the one block seen was a refused
   *   connection and not a status.
   * - A 403 is retried once after 60 seconds, then fails. With
   *   `retryForbidden: false`, as a probe passes, it fails at once.
   * - A failed request is a refusal to the guard (plan 0215, section 2), and
   *   the fifth in a row stops the client with `SourceBlockedError`.
   */
  private async request(
    urlOrPath: string,
    init: { method?: string; body?: string } = {}
  ): Promise<DiaRawResponse> {
    const url = /^https?:\/\//i.test(urlOrPath)
      ? urlOrPath
      : `${this.baseUrl}${urlOrPath}`;
    let attempt = 0;
    let forbiddenRetried = false;
    let retriedAfterPause = false;
    for (;;) {
      this.options.signal?.throwIfAborted();
      await this.gate();

      const headers: Record<string, string> = { ...DIA_BROWSER_HEADERS };
      const cookie = this.cookieHeader();
      if (cookie) {
        headers['cookie'] = cookie;
      }
      if (init.body !== undefined) {
        headers['content-type'] = 'application/json';
      }

      this.requests += 1;
      let response: Response;
      let bytes: Uint8Array;
      try {
        response = await this.fetchImpl(url, {
          method: init.method ?? 'GET',
          headers,
          body: init.body,
          // A moved leaf is a fact the run reports, so a 301 is read and not
          // followed behind the caller's back.
          redirect: 'manual',
          signal: this.requestSignal(),
        });
        this.rememberCookies(response);
        // Read inside the try: a connection can drop halfway through a body.
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        if (this.options.signal?.aborted) {
          this.guard.inconclusive();
          throw error;
        }
        if (attempt >= this.retries) {
          // No answer after every retry is a failure here, status 0, because
          // the one DIA block measured was refused connections.
          if (this.failed(0, url) && !retriedAfterPause) {
            retriedAfterPause = true;
            continue;
          }
          throw error;
        }
        this.guard.inconclusive();
        await this.sleep(this.backoffBaseMs * 2 ** attempt);
        attempt += 1;
        continue;
      }

      if (response.status >= 200 && response.status < 400) {
        this.guard.answered();
        return {
          status: response.status,
          bytes,
          location: response.headers.get('location'),
        };
      }
      if (
        response.status === 403 &&
        !forbiddenRetried &&
        this.options.retryForbidden !== false
      ) {
        forbiddenRetried = true;
        this.guard.inconclusive();
        await this.sleep(this.forbiddenRetryMs);
        continue;
      }
      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.retries) {
        this.guard.inconclusive();
        await this.sleep(this.backoffBaseMs * 2 ** attempt);
        attempt += 1;
        continue;
      }
      if (this.failed(response.status, url) && !retriedAfterPause) {
        retriedAfterPause = true;
        continue;
      }
      throw new DiaHttpError(response.status, url);
    }
  }

  /**
   * One request that still failed after its retries, told to the guard. True
   * when it is to be sent again after a pause, which DIA's own policy never
   * asks for. Throws `SourceBlockedError` when it stops the client.
   */
  private failed(status: number, url: string): boolean {
    return this.guard.refused(status, url) === 'retry';
  }

  private requestSignal(): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return this.options.signal
      ? AbortSignal.any([this.options.signal, timeout])
      : timeout;
  }

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
   * one, **and then** this client's own minimum interval. The interval is not
   * a fallback: it holds 2 requests per second whatever rate the source row
   * was given (section 10).
   */
  private async gate(): Promise<void> {
    if (this.options.acquire) {
      await this.options.acquire();
    }
    if (this.admitsGuard) {
      await this.guard.admit(this.options.signal);
    }
    if (this.minIntervalMs > 0) {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) {
        await this.sleep(wait);
      }
    }
    this.lastRequestAt = this.now();
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * A `Location` as a leaf path: no origin, no API prefix and no query, so it can
 * be asked for again the way the first path was.
 */
function webPath(location: string | null): string | null {
  if (!location) {
    return null;
  }
  let path = location.replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
  if (path.startsWith(LISTING)) {
    path = path.slice(LISTING.length);
  }
  return path.startsWith('/') ? path : null;
}

function decode(response: DiaRawResponse): unknown {
  return JSON.parse(Buffer.from(response.bytes).toString('utf8'));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
