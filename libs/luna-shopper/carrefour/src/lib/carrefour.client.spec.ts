import {
  SourceBlockedError,
  SourceGuard,
} from '@portfolio/luna-shopper/source-guard';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import listingPage from './__fixtures__/listing-page.json';
import productPage from './__fixtures__/product-page.json';
import {
  CARREFOUR_REFUSAL_POLICY,
  CarrefourClient,
  dropCloudflareCookies,
  isCloudflareCookie,
  type CarrefourCookieJar,
} from './carrefour.client';
import {
  CarrefourBrowserError,
  CarrefourHttpError,
  isSkippable,
} from './errors';
import {
  CARREFOUR_DRIVES_PATH,
  CARREFOUR_MIN_DELAY_MS,
  CARREFOUR_ORIGIN,
  CARREFOUR_STORE_LOCATOR_PATH,
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
      let n = 0;
      const browser = new FakeBrowser(() =>
        ++n === 1 ? { status: 200, state: listingPage } : { status: 403 }
      );
      const client = clientOn(browser);
      await expect(client.readListing('/0')).resolves.not.toBeNull();
      await expect(client.readListing('/1')).rejects.not.toBeInstanceOf(
        SourceBlockedError
      );
      await expect(client.readListing('/2')).rejects.not.toBeInstanceOf(
        SourceBlockedError
      );
      const blocked = await client.readListing('/3').catch((error) => error);

      // The client's own guard, built from CARREFOUR_REFUSAL_POLICY (plan
      // 0215), and the one failure a walk may not step over.
      expect(blocked).toBeInstanceOf(SourceBlockedError);
      expect(isSkippable(blocked)).toBe(false);
      expect(isSkippable(new CarrefourHttpError(403, '/1'))).toBe(true);
      // Nothing is loaded after the stop.
      await expect(client.readListing('/4')).rejects.toBe(blocked);
      expect(browser.asked).toHaveLength(4);
    });

    it('reports to the run’s guard when one is passed', async () => {
      const guard = new SourceGuard(CARREFOUR_REFUSAL_POLICY);
      const browser = new FakeBrowser(refused);
      const client = new CarrefourClient({
        userAgent: 'LunaShopperBot/1.0 (+https://velista.app)',
        openSession: browser.open,
        sleepImpl: async () => undefined,
        acquire: () => guard.admit(),
        guard,
      });
      // A refusal another client of the run met counts here too.
      guard.refused(403, '/elsewhere');

      await expect(client.readListing('/1')).rejects.toBeInstanceOf(
        CarrefourHttpError
      );
      await expect(client.readListing('/2')).rejects.toBeInstanceOf(
        SourceBlockedError
      );
      expect(guard.stop).toEqual(
        expect.objectContaining({ url: expect.stringContaining('/2') })
      );
    });

    it('leaves the count as it was on a 5xx, and clears it on a 404', async () => {
      const answers = [403, 503, 403, 404, 403, 403];
      const client = clientOn(
        new FakeBrowser(() => ({ status: answers.shift() as number }))
      );
      await expect(client.readListing('/1')).rejects.toBeInstanceOf(
        CarrefourHttpError
      );
      await expect(client.readListing('/2')).resolves.toBeNull();
      await expect(client.readListing('/3')).rejects.toBeInstanceOf(
        CarrefourHttpError
      );
      await expect(client.readListing('/4')).resolves.toBeNull();
      await expect(client.readListing('/5')).rejects.toBeInstanceOf(
        CarrefourHttpError
      );
      await expect(client.readListing('/6')).rejects.not.toBeInstanceOf(
        SourceBlockedError
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
        SourceBlockedError
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

describe('CarrefourClient, the store finder and the drive list (plan 0223)', () => {
  const XML = readFileSync(
    join(__dirname, '__fixtures__', 'store-locator.xml'),
    'utf8'
  );
  const DRIVES = readFileSync(
    join(__dirname, '__fixtures__', 'drives.json'),
    'utf8'
  );

  /** A session that serves documents as text, and records every wait. */
  function documents(
    answer: (url: string) => { status: number; body?: string }
  ) {
    const asked: string[] = [];
    const waits: number[] = [];
    let opened = 0;
    const client = new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0 (+https://velista.app)',
      openSession: async () => {
        opened += 1;
        return {
          goto: async () => {
            throw new Error('a store run reads no page state');
          },
          fetchText: async (url: string) => {
            asked.push(url);
            const { status, body } = answer(url);
            return { status, body: status === 200 ? (body ?? '') : null };
          },
          close: async () => undefined,
        };
      },
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
    });
    return { client, asked, waits, opened: () => opened };
  }

  const serve = (url: string) =>
    url.endsWith(CARREFOUR_STORE_LOCATOR_PATH)
      ? { status: 200, body: XML }
      : { status: 200, body: DRIVES };

  it('reads both documents through one session, paced at the floor', async () => {
    const { client, asked, waits, opened } = documents(serve);

    // A clock that stands still, so the second wait is the whole floor and
    // not the floor less however long the first load took.
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    let list: Awaited<ReturnType<CarrefourClient['readStoreLocator']>>;
    let drives: Awaited<ReturnType<CarrefourClient['readDrives']>>;
    try {
      list = await client.readStoreLocator();
      drives = await client.readDrives();
    } finally {
      now.mockRestore();
    }

    expect(list.recordsRead).toBe(1976);
    expect(drives).toHaveLength(179);
    expect(asked).toEqual([
      CARREFOUR_ORIGIN + CARREFOUR_STORE_LOCATOR_PATH,
      CARREFOUR_ORIGIN + CARREFOUR_DRIVES_PATH,
    ]);
    expect(client.loads).toBe(2);
    expect(opened()).toBe(1);
    // The second load waited for the floor, as every page of the walk does.
    expect(waits).toEqual([CARREFOUR_MIN_DELAY_MS]);
  });

  it('counts a 403 toward the refusal limit, as a page does', async () => {
    const { client, asked } = documents(() => ({ status: 403 }));

    await expect(client.readStoreLocator()).rejects.toBeInstanceOf(
      CarrefourHttpError
    );
    await expect(client.readDrives()).rejects.toBeInstanceOf(
      CarrefourHttpError
    );
    await expect(client.readStoreLocator()).rejects.toBeInstanceOf(
      SourceBlockedError
    );
    // Never retried, and nothing loaded after the stop.
    await expect(client.readDrives()).rejects.toBeInstanceOf(
      SourceBlockedError
    );
    expect(asked).toHaveLength(3);
  });

  it('refuses a 200 whose document holds no marker, naming the path', async () => {
    const { client } = documents(() => ({
      status: 200,
      body: '<html><body>Mantenimiento</body></html>',
    }));
    await expect(client.readStoreLocator()).rejects.toThrow(
      CARREFOUR_STORE_LOCATOR_PATH
    );
  });

  it('refuses a drive list that is not JSON, naming the path', async () => {
    const { client } = documents(() => ({ status: 200, body: '<html>' }));
    await expect(client.readDrives()).rejects.toThrow(CARREFOUR_DRIVES_PATH);
  });

  it('refuses a document that did not answer 200, naming the path', async () => {
    const { client } = documents(() => ({ status: 404 }));
    await expect(client.readStoreLocator()).rejects.toThrow(
      CARREFOUR_STORE_LOCATOR_PATH
    );
  });

  it('hands the capture tool the body verbatim', async () => {
    const { client } = documents(serve);
    await expect(
      client.captureText(CARREFOUR_STORE_LOCATOR_PATH)
    ).resolves.toBe(XML);
  });

  it('refuses a text read on a session that cannot read text, before any cost', async () => {
    const guard = new SourceGuard(CARREFOUR_REFUSAL_POLICY);
    const inconclusive = jest.spyOn(guard, 'inconclusive');
    const waits: number[] = [];
    let acquired = 0;
    let opened = 0;
    let closed = 0;
    const client = new CarrefourClient({
      userAgent: 'x',
      openSession: async () => {
        opened += 1;
        return {
          goto: async () => ({ status: 200, state: null }),
          close: async () => {
            closed += 1;
          },
        };
      },
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
      acquire: async () => {
        acquired += 1;
      },
      guard,
    });

    await expect(client.readDrives()).rejects.toThrow(/cannot read a document/);
    await expect(client.readStoreLocator()).rejects.toThrow(
      /cannot read a document/
    );

    // Not paced, not counted, nothing told to the guard, and the session kept.
    expect(acquired).toBe(0);
    expect(waits).toEqual([]);
    expect(client.loads).toBe(0);
    expect(inconclusive).not.toHaveBeenCalled();
    expect(closed).toBe(0);
    expect(opened).toBe(1);
  });
});
