/**
 * Carrefour's grocery storefront, grouped behind one boundary so nothing else
 * in Luna Shopper learns what its pages look like (plan 0090, section 10).
 *
 * Framework free in every way except one. No TypeORM, no Nest, no database, no
 * `SupermarketItem`. The exception is Playwright, and **the exception is
 * forced**.
 *
 * ## Why a browser
 *
 * carrefour.es sits behind Cloudflare, and Cloudflare here refuses a client on
 * its TLS handshake rather than on its headers or its rate. Measured on
 * 2026-09-06, interleaved against the same URLs, ten seconds apart, with an
 * identical `User-Agent`:
 *
 * | Client                            | TLS stack | Result   |
 * | --------------------------------- | --------- | -------- |
 * | `curl` on Windows                 | Schannel  | 200, 3/3 |
 * | `curl` on Linux, in Docker        | OpenSSL   | 403      |
 * | node `https` / `fetch`            | OpenSSL   | 403, 3/3 |
 * | node `https`, Chrome cipher list  | OpenSSL   | 403      |
 * | node `http2`                      | OpenSSL   | 403      |
 * | headless Chromium                 | BoringSSL | 200      |
 *
 * A rate limit cannot produce that table, because the rows are interleaved and
 * it refused none of the passing ones. Setting node's ciphers and curves to
 * Chrome's changes nothing: the fingerprint also covers extension order and the
 * GREASE values, and node has no API for either. Windows `curl` passes because
 * Schannel is the operating system stack a browser uses, so it is a local
 * accident and not a route to production, which runs Linux.
 *
 * ## Why the session throws its cookies away
 *
 * A browser is necessary and not sufficient. A browser that behaves like a
 * browser is blocked after one page. Five listing pages, seven seconds apart:
 *
 * | Cookie handling                   | Five loads            |
 * | --------------------------------- | --------------------- |
 * | Keep everything, a normal session | `200 403 403 403 403` |
 * | Clear every cookie before a load  | `200 200 200 200 200` |
 * | Clear only `__cf*` and `cf_*`     | `200 200 200 200 200` |
 *
 * The first response sets `__cf_bm` and `cf_clearance`, and presenting them
 * again is what draws the block. This inverts the usual advice, so a later
 * reader who "fixes" the client by keeping its session will break it in a way
 * that looks exactly like a rate limit.
 *
 * **Only the two Cloudflare cookies go.** Clearing the whole jar works equally
 * well today and throws away `salepoint`, which is the cookie that decides
 * which shop's assortment and prices the listing shows.
 */

import {
  listingPath,
  pagesFor,
  walkFrontier,
  type CarrefourFrontier,
} from './categories';
import {
  CarrefourBlockedError,
  CarrefourBrowserError,
  CarrefourHttpError,
} from './errors';
import { readCards } from './listing';
import { readDetail, readListing } from './state';
import {
  CARREFOUR_MIN_DELAY_MS,
  CARREFOUR_ORIGIN,
  CARREFOUR_PAGE_SIZE,
  type CarrefourCategory,
  type CarrefourClientOptions,
  type CarrefourDetail,
  type CarrefourListing,
  type CarrefourProduct,
  type CarrefourSession,
  type CarrefourStateLoader,
} from './types';

/** The smallest part of a Playwright browser context this client needs. */
export interface CarrefourCookieJar {
  cookies(): Promise<Array<{ name: string }>>;
  clearCookies(): Promise<void>;
  addCookies(cookies: Array<{ name: string }>): Promise<void>;
}

/** Whether a cookie is one of the two the edge blocks a repeat visitor on. */
export function isCloudflareCookie(name: string): boolean {
  return name.startsWith('cf_') || name.startsWith('__cf');
}

/**
 * Drop the Cloudflare cookies and keep the rest.
 *
 * Exported and tested directly, because this is the one line the whole client
 * depends on and a browser is not needed to state what it must do (plan 0090,
 * section 15).
 */
export async function dropCloudflareCookies(
  jar: CarrefourCookieJar
): Promise<void> {
  const cookies = await jar.cookies();
  const kept = cookies.filter((cookie) => !isCloudflareCookie(cookie.name));
  if (kept.length === cookies.length) {
    return;
  }
  await jar.clearCookies();
  if (kept.length > 0) {
    await jar.addCookies(kept);
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The deadline on one call into the browser.
 *
 * Comfortably above the 60 s navigation timeout Playwright is given, because
 * this is the backstop for a call that will never come back at all rather than
 * a tighter budget for a slow page.
 */
const BROWSER_TIMEOUT_MS = 90_000;

/**
 * How many refusals in a row end the run.
 *
 * Plan 0090 section 13 says a refusal aborts the run rather than retrying into
 * a deeper block, and the reason is section 5: the penalty escalates, and its
 * signature is that only the first load of a fresh session succeeds. **That
 * signature is consecutive refusals.** An isolated one is something else: the
 * first crawl met two, three minutes apart, with hundreds of clean loads either
 * side, so failing the whole hour on the first would have failed every run.
 *
 * So neither refusal is ever retried, which is the rule that matters, and a run
 * gives up once they stop being isolated. The category a skipped page belonged
 * to is named in the run report, so nothing claims to have read what it did not.
 */
const CONSECUTIVE_REFUSALS = 3;

/** Run `work`, or raise {@link CarrefourBrowserError} when it does not answer. */
async function withDeadline<T>(what: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new CarrefourBrowserError(what)),
          BROWSER_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The storefront, read one page at a time.
 *
 * **One browser per client and one client per run** (plan 0090, section 11).
 * Launching Chromium costs about a second, and a leaked one is 300 MB of
 * resident memory in a pod sized for a Nest service, so {@link close} is
 * called by the runner's `finally` and not by its happy path.
 *
 * The method names shadow the other adapters': {@link walkCategories} is the
 * enumeration and {@link readListing} is the page read. There is no `search`,
 * because the search API is the one route the edge blocks outright.
 */
export class CarrefourClient {
  private readonly baseUrl: string;
  private readonly delayMs: number;
  private readonly loader: CarrefourStateLoader;
  private readonly sleep: (ms: number) => Promise<void>;
  private session: CarrefourSession | null = null;
  private lastLoadAt = 0;
  /** Refusals since the last page that answered. See {@link CONSECUTIVE_REFUSALS}. */
  private refusals = 0;

  /** Pages loaded by this client, for a run that reports its own cost. */
  loads = 0;

  constructor(private readonly options: CarrefourClientOptions) {
    this.baseUrl = (options.baseUrl ?? CARREFOUR_ORIGIN).replace(/\/+$/, '');
    // Clamped up and never down. The block escalates and does not clear at
    // once, so this is not a number to tune by trial against the live site.
    this.delayMs = Math.max(
      options.delayMs ?? CARREFOUR_MIN_DELAY_MS,
      CARREFOUR_MIN_DELAY_MS
    );
    this.sleep = options.sleepImpl ?? sleep;
    this.loader = (path) => this.load(path);
  }

  /**
   * Give back the browser, if one was ever started.
   *
   * Idempotent, because the runner calls it from a `finally` that also runs
   * when the run never opened a page.
   */
  async close(): Promise<void> {
    const session = this.session;
    this.session = null;
    await session?.close();
  }

  /** One listing page, read. */
  async readListing(path: string): Promise<CarrefourListing | null> {
    const state = await this.loader(path);
    return state ? readListing(state) : null;
  }

  /**
   * The raw page state of one path.
   *
   * Public for exactly one caller: the fixture capture tool, which writes pages
   * **verbatim**. A capture that went through a parser would store what the
   * parser understood rather than what the source sent, which is the one thing
   * a fixture must not do. Nothing in the runtime calls it.
   */
  captureState(path: string): Promise<Record<string, unknown> | null> {
    return this.loader(path);
  }

  /** One product page, read for its EAN (plan 0090, section 12.1). */
  async readDetail(path: string): Promise<CarrefourDetail | null> {
    const state = await this.loader(path);
    return state ? readDetail(state) : null;
  }

  /**
   * The categories this run pages, and the ones the ceiling truncated.
   *
   * About 95 page loads, because a node that already fits under the ceiling is
   * never opened.
   */
  walkCategories(seedPath?: string): Promise<CarrefourFrontier> {
    return walkFrontier(this.loader, seedPath ?? DEFAULT_SEED_PATH, {
      signal: this.options.signal,
    });
  }

  /**
   * Every product of one category, page by page, deduplicated within the
   * category.
   *
   * It pages to the ceiling and no further, because paging past it serves
   * nothing: the frontier is chosen so that the ceiling does not bind, and a
   * category where it still does is reported rather than paged forever.
   */
  async *walkCategory(
    category: CarrefourCategory,
    onPage?: (listing: CarrefourListing, page: number) => void
  ): AsyncIterable<CarrefourProduct> {
    const pages = pagesFor(category.totalResults);
    const seen = new Set<string>();
    for (let page = 0; page < pages; page += 1) {
      this.options.signal?.throwIfAborted();
      const listing = await this.readListing(
        listingPath(category.id, page * CARREFOUR_PAGE_SIZE)
      );
      if (!listing) {
        // A page that did not answer ends this category rather than the run.
        // The products it held are lost for this run and found by the next.
        return;
      }
      onPage?.(listing, page);
      if (listing.cards.length === 0) {
        // Paging past the end answers an empty item list rather than an error,
        // so an empty page is where the result set stopped.
        return;
      }
      for (const product of readCards(listing.cards, category.path)) {
        if (!seen.has(product.externalId)) {
          seen.add(product.externalId);
          yield product;
        }
      }
    }
  }

  /**
   * Load one page and hand back its state, paced and abortable.
   *
   * Everything a run does goes through here, and it is sequential by
   * construction: **do not add concurrency to a source that blocks on burst**
   * (plan 0090, section 13).
   */
  private async load(path: string): Promise<Record<string, unknown> | null> {
    this.options.signal?.throwIfAborted();
    await this.pace();
    const session = await this.open();
    this.loads += 1;
    const url = path.startsWith('http') ? path : this.baseUrl + path;

    let status: number;
    let state: Record<string, unknown> | null;
    try {
      ({ status, state } = await session.goto(url));
    } catch (error) {
      // A browser that hangs or dies costs this page and not the run. The
      // session is dropped **without being awaited**, because the thing that
      // just failed to answer is the thing a close would ask, and the next load
      // launches a fresh one.
      this.discardSession();
      throw error;
    }

    if (status === 200) {
      this.refusals = 0;
      return state;
    }
    if (status === 403 || status === 429) {
      this.refusals += 1;
      // Never retried, whichever branch this takes: a retry is what turns a
      // refusal into a deeper block. What differs is whether the run goes on.
      if (this.refusals >= CONSECUTIVE_REFUSALS) {
        throw new CarrefourBlockedError(status, url, this.refusals);
      }
      throw new CarrefourHttpError(status, url);
    }
    // Anything else, a 404 or a 5xx, is this page and not the storefront. The
    // caller records the gap and carries on.
    this.refusals = 0;
    return null;
  }

  /**
   * Forget the browser without waiting for it.
   *
   * `close()` awaits, which is right when the browser is healthy and wrong when
   * it is the thing that stopped answering: awaiting there is the hang all over
   * again. The close is still asked for, so a live browser is not leaked, and
   * its failure is swallowed because there is nothing left to do about it.
   */
  private discardSession(): void {
    const session = this.session;
    this.session = null;
    void session?.close().catch(() => undefined);
  }

  /** The shared bucket when a run passed one, and the floor either way. */
  private async pace(): Promise<void> {
    if (this.options.acquire) {
      await this.options.acquire();
    }
    const wait = this.lastLoadAt + this.delayMs - Date.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    this.lastLoadAt = Date.now();
  }

  private async open(): Promise<CarrefourSession> {
    if (!this.session) {
      this.session = this.options.openSession
        ? await this.options.openSession()
        : await PlaywrightSession.start(
            this.options.userAgent,
            this.options.blockAssets ?? true
          );
    }
    return this.session;
  }
}

/** Any listing page can seed the walk: every one names the first level. */
const DEFAULT_SEED_PATH = '/supermercado/la-despensa/cat20001/c';

/**
 * The Chromium half, and the only place in this library that launches one.
 *
 * It is a class of its own so that everything above it is testable with a fake
 * loader: nothing in CI reaches this file's `start`.
 */
class PlaywrightSession {
  private constructor(
    private readonly browser: {
      close(): Promise<void>;
    },
    private readonly context: CarrefourCookieJar,
    private readonly page: {
      goto(
        url: string,
        options: Record<string, unknown>
      ): Promise<{ status(): number } | null>;
      evaluate<T>(fn: () => T): Promise<T>;
    }
  ) {}

  static async start(
    userAgent: string,
    blockAssets: boolean
  ): Promise<PlaywrightSession> {
    // Required lazily so that importing this library, which every unit test
    // does, does not load Playwright or look for a browser on disk.
    const { chromium } =
      (await import('playwright')) as typeof import('playwright');
    // Launching is inside the deadline too. A launch that never returns is the
    // same stall as a navigation that never returns, and it looks identical
    // from outside: a run that is somehow neither working nor failing.
    const browser = await withDeadline(
      'launching the browser',
      chromium.launch({ headless: true })
    );
    const context = await browser.newContext({
      locale: 'es-ES',
      userAgent,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    if (blockAssets) {
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        return type === 'image' || type === 'font' || type === 'media'
          ? route.abort()
          : route.continue();
      });
    }
    return new PlaywrightSession(
      browser,
      context as unknown as CarrefourCookieJar,
      page as unknown as PlaywrightSession['page']
    );
  }

  /**
   * One navigation, and every part of it under a deadline.
   *
   * **The cookie call needs one as much as the navigation does.** Playwright's
   * own `timeout` covers `goto` and covers nothing else, so a browser that has
   * stopped answering leaves `cookies()` pending forever, which is where the
   * first full crawl stopped. Each of the three is wrapped separately so the
   * error names the one that failed.
   */
  async goto(
    url: string
  ): Promise<{ status: number; state: Record<string, unknown> | null }> {
    await withDeadline(
      'reading the cookies',
      dropCloudflareCookies(this.context)
    );
    const response = await withDeadline(
      `loading ${url}`,
      this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    );
    const status = response?.status() ?? 0;
    if (status !== 200) {
      return { status, state: null };
    }
    const state = await withDeadline(
      'reading the page state',
      this.page.evaluate(
        () =>
          (window as unknown as { __INITIAL_STATE__?: unknown })
            .__INITIAL_STATE__ ?? null
      )
    );
    return {
      status,
      state: (state as Record<string, unknown> | null) ?? null,
    };
  }

  close(): Promise<void> {
    return this.browser.close();
  }
}
