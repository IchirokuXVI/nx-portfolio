import listingPage from './__fixtures__/listing-page.json';
import productPage from './__fixtures__/product-page.json';
import {
  CarrefourClient,
  dropCloudflareCookies,
  isCloudflareCookie,
  type CarrefourCookieJar,
} from './carrefour.client';
import {
  CarrefourBlockedError,
  CarrefourBrowserError,
  CarrefourHttpError,
} from './errors';
import {
  CARREFOUR_MIN_DELAY_MS,
  type CarrefourCategory,
  type CarrefourSession,
} from './types';

/** A jar that records what was done to it, standing in for a browser context. */
class FakeJar implements CarrefourCookieJar {
  cleared = 0;
  restored: Array<{ name: string }> | null = null;

  constructor(private jar: Array<{ name: string }>) {}

  async cookies(): Promise<Array<{ name: string }>> {
    return this.jar;
  }

  async clearCookies(): Promise<void> {
    this.cleared += 1;
    this.jar = [];
  }

  async addCookies(cookies: Array<{ name: string }>): Promise<void> {
    this.restored = cookies;
    this.jar = cookies;
  }
}

describe('the Cloudflare cookie rule', () => {
  it('knows the two cookies the edge blocks a repeat visitor on', () => {
    expect(isCloudflareCookie('__cf_bm')).toBe(true);
    expect(isCloudflareCookie('cf_clearance')).toBe(true);
    expect(isCloudflareCookie('salepoint')).toBe(false);
  });

  it('removes them before a navigation and keeps the store cookie', async () => {
    // This is a test and not a comment because it inverts the usual advice: a
    // later reader who "fixes" the client by keeping its session breaks it in a
    // way that looks exactly like a rate limit (plan 0090, section 4).
    const jar = new FakeJar([
      { name: '__cf_bm' },
      { name: 'cf_clearance' },
      { name: 'salepoint' },
      { name: 'session_id' },
    ]);
    await dropCloudflareCookies(jar);

    expect(jar.cleared).toBe(1);
    expect(jar.restored?.map((cookie) => cookie.name)).toEqual([
      'salepoint',
      'session_id',
    ]);
  });

  it('leaves a jar with no Cloudflare cookie alone', async () => {
    const jar = new FakeJar([{ name: 'salepoint' }]);
    await dropCloudflareCookies(jar);
    expect(jar.cleared).toBe(0);
    expect(jar.restored).toBeNull();
  });
});

/** One answer the fake session gives for one URL. */
type Answer = { status: number; state?: unknown } | { throws: Error };

/**
 * A session that answers what a test states, and counts how often it was
 * opened and closed.
 *
 * The seam is here rather than above the client's own loading, so every test
 * below exercises the real pacing, the real refusal counting and the real
 * session handling. Only Chromium is missing.
 */
class FakeBrowser {
  opened = 0;
  closed = 0;
  readonly asked: string[] = [];

  constructor(private readonly answer: (url: string) => Answer) {}

  open = async (): Promise<CarrefourSession> => {
    this.opened += 1;
    return {
      goto: async (url: string) => {
        this.asked.push(url);
        const answer = this.answer(url);
        if ('throws' in answer) {
          throw answer.throws;
        }
        return {
          status: answer.status,
          state: (answer.state ?? null) as Record<string, unknown> | null,
        };
      },
      close: async () => {
        this.closed += 1;
      },
    };
  };
}

describe('CarrefourClient', () => {
  const clientOn = (browser: FakeBrowser): CarrefourClient =>
    new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0 (+https://velista.app)',
      openSession: browser.open,
      // The interval the storefront needs is not an interval a test spends.
      sleepImpl: async () => undefined,
    });

  const ok = (state: unknown) => () => ({ status: 200, state });
  const refused = () => ({ status: 403 });

  it('reads a listing page through the session it was given', async () => {
    const listing = await clientOn(
      new FakeBrowser(ok(listingPage))
    ).readListing('/x');
    expect(listing?.cards.length).toBe(24);
  });

  it('reads a product page for its EAN', async () => {
    const detail = await clientOn(new FakeBrowser(ok(productPage))).readDetail(
      '/x'
    );
    expect(detail?.ean).toMatch(/^\d{13}$/);
  });

  it('resolves a path against the storefront origin', async () => {
    const browser = new FakeBrowser(ok(listingPage));
    await clientOn(browser).readListing('/supermercado/x/cat1/c');
    expect(browser.asked).toEqual([
      'https://www.carrefour.es/supermercado/x/cat1/c',
    ]);
  });

  it('pages a category to its end and deduplicates within it', async () => {
    const category: CarrefourCategory = {
      id: 'cat20003',
      name: 'Bebidas',
      url: '/supermercado/x/cat20003/c',
      path: ['Bebidas'],
      totalResults: 30,
    };
    // The same page twice: 30 products is two pages, and the second repeats the
    // first, which is what a product filed twice looks like.
    const browser = new FakeBrowser(ok(listingPage));
    const products = [];
    for await (const product of clientOn(browser).walkCategory(category)) {
      products.push(product);
    }

    expect(browser.asked).toEqual([
      'https://www.carrefour.es/supermercado/x/cat20003/c?offset=0',
      'https://www.carrefour.es/supermercado/x/cat20003/c?offset=24',
    ]);
    expect(products).toHaveLength(24);
    expect(products[0].categoryPath).toEqual(['Bebidas']);
  });

  it('stops a category at a page that came back empty', async () => {
    // Paging past the result set answers an empty item list rather than an
    // error, so an empty page is where the category stopped.
    const category: CarrefourCategory = {
      id: 'cat1',
      name: 'A category',
      url: '/x',
      path: [],
      totalResults: 1000,
    };
    const empty = {
      productCardList: { results: { items: [], total_results: 1000 } },
      pagination: { page_size: 24, total_pages: 42 },
    };
    let calls = 0;
    const browser = new FakeBrowser(() => {
      calls += 1;
      return { status: 200, state: calls === 1 ? listingPage : empty };
    });

    const products = [];
    for await (const product of clientOn(browser).walkCategory(category)) {
      products.push(product);
    }
    expect(products).toHaveLength(24);
    expect(calls).toBe(2);
  });

  describe('a refusal', () => {
    it('is never retried, and costs the page rather than the run', async () => {
      // A retry is what turns a refusal into a deeper block (plan 0090,
      // section 5), so the page is raised straight to the caller.
      const browser = new FakeBrowser(refused);
      const client = clientOn(browser);
      await expect(client.readListing('/x')).rejects.toBeInstanceOf(
        CarrefourHttpError
      );
      expect(browser.asked).toHaveLength(1);
    });

    it('ends the run once the refusals stop being isolated', async () => {
      // Consecutive refusals are the escalation signature of section 4: only
      // the first load of a fresh session succeeds. A crawl that fetched on
      // through that would deepen the block.
      const client = clientOn(new FakeBrowser(refused));
      await expect(client.readListing('/1')).rejects.not.toBeInstanceOf(
        CarrefourBlockedError
      );
      await expect(client.readListing('/2')).rejects.not.toBeInstanceOf(
        CarrefourBlockedError
      );
      await expect(client.readListing('/3')).rejects.toBeInstanceOf(
        CarrefourBlockedError
      );
    });

    it('starts counting again after a page that answered', async () => {
      // Two refusals three minutes apart with hundreds of clean loads between
      // them is what the live storefront actually did, and it is not a block.
      let n = 0;
      const client = clientOn(
        new FakeBrowser(() =>
          ++n === 2 ? { status: 200, state: listingPage } : { status: 403 }
        )
      );
      await expect(client.readListing('/1')).rejects.toBeInstanceOf(
        CarrefourHttpError
      );
      await expect(client.readListing('/2')).resolves.not.toBeNull();
      await expect(client.readListing('/3')).rejects.toBeInstanceOf(
        CarrefourHttpError
      );
      await expect(client.readListing('/4')).rejects.not.toBeInstanceOf(
        CarrefourBlockedError
      );
    });
  });

  describe('a browser that stops answering', () => {
    it('is dropped, and the next page gets a fresh one', async () => {
      // The first full crawl stalled with the Chromium process gone and the
      // run neither working nor failing. A page load that cannot fail is worse
      // than one that fails, so the session is discarded and relaunched.
      let n = 0;
      const browser = new FakeBrowser(() =>
        ++n === 1
          ? { throws: new CarrefourBrowserError('loading') }
          : { status: 200, state: listingPage }
      );
      const client = clientOn(browser);

      await expect(client.readListing('/1')).rejects.toBeInstanceOf(
        CarrefourBrowserError
      );
      await expect(client.readListing('/2')).resolves.not.toBeNull();
      expect(browser.opened).toBe(2);
      // Asked to close, but never awaited: the thing that stopped answering is
      // the thing a close would ask.
      expect(browser.closed).toBe(1);
    });

    it('does not keep launching one browser per page when it works', async () => {
      const browser = new FakeBrowser(ok(listingPage));
      const client = clientOn(browser);
      await client.readListing('/1');
      await client.readListing('/2');
      expect(browser.opened).toBe(1);
    });
  });

  it('never paces faster than the interval that was measured', () => {
    const fast = new CarrefourClient({ userAgent: 'x', delayMs: 10 });
    // Clamped up and never down: the block escalates and does not clear at
    // once, so this is not a number to tune by trial against the live site.
    expect((fast as unknown as { delayMs: number }).delayMs).toBe(
      CARREFOUR_MIN_DELAY_MS
    );
  });

  it('gives back nothing when it never opened a browser', async () => {
    // The runner closes from a `finally` that also runs when the run failed
    // before its first page.
    await expect(
      new CarrefourClient({ userAgent: 'x' }).close()
    ).resolves.toBeUndefined();
  });

  it('closes the browser it opened', async () => {
    const browser = new FakeBrowser(ok(listingPage));
    const client = clientOn(browser);
    await client.readListing('/1');
    await client.close();
    expect(browser.closed).toBe(1);
  });
});
