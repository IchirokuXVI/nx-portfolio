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
  CarrefourShortCategoryError,
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

  /**
   * The recorded listing page with its total restated. The recording states
   * 1,726 results, and a walk now pages to the total a page states (owner
   * decision 104b), so a test of a smaller category states its own.
   */
  const stating = (total: number): Record<string, unknown> => {
    const state = JSON.parse(JSON.stringify(listingPage));
    state.productCardList.results.total_results = total;
    return state;
  };

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
    const browser = new FakeBrowser(ok(stating(30)));
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

  describe('a category cut short (owner decision 90b)', () => {
    /** Three pages, of which the recorded listing page is the first. */
    const category: CarrefourCategory = {
      id: 'cat20003',
      name: 'Bebidas',
      url: '/supermercado/x/cat20003/c',
      path: ['Bebidas'],
      totalResults: 72,
    };
    const second =
      'https://www.carrefour.es/supermercado/x/cat20003/c?offset=24';

    /** The recorded page with its cards removed and its total restated. */
    const emptied = (total: unknown): Record<string, unknown> => {
      const state = JSON.parse(JSON.stringify(listingPage));
      state.productCardList.results.items = [];
      if (total === undefined) {
        delete state.productCardList.results.total_results;
      } else {
        state.productCardList.results.total_results = total;
      }
      return state;
    };

    /** The first page from the fixture, and the second as a test states. */
    const secondAnswers = (answer: Answer) =>
      new FakeBrowser((url) =>
        url === second ? answer : { status: 200, state: listingPage }
      );

    async function walk(
      browser: FakeBrowser,
      options: { fromPage?: number } = {}
    ) {
      const products = [];
      const pages: number[] = [];
      let error: unknown = null;
      try {
        for await (const product of clientOn(browser).walkCategory(
          category,
          (_listing, page) => pages.push(page),
          options
        )) {
          products.push(product);
        }
      } catch (caught) {
        error = caught;
      }
      return { products, pages, error };
    }

    it.each([503, 500, 404])(
      'raises after the products it read when a page answers %i',
      async (status) => {
        const browser = secondAnswers({ status });
        const { products, pages, error } = await walk(browser);

        // What the first page held is still handed over.
        expect(products).toHaveLength(24);
        expect(pages).toEqual([0]);
        expect(error).toBeInstanceOf(CarrefourShortCategoryError);
        expect(error).toMatchObject({
          categoryId: 'cat20003',
          page: 1,
          cost: `Carrefour answered ${status}`,
          url: second,
          status,
          // Only a 5xx is worth one more ask at the end (owner decision
          // 103b); a 404 is an answer about the page.
          transient: status >= 500,
        });
        // A gap is not a refusal: the guard is not told of a block, and the
        // walk may step over it like any other page that failed.
        expect(error).not.toBeInstanceOf(CarrefourHttpError);
        expect(isSkippable(error)).toBe(true);
        // No page after the gap is asked for.
        expect(browser.asked).toHaveLength(2);
      }
    );

    it('raises when a page answers 200 with no page state', async () => {
      const { error } = await walk(secondAnswers({ status: 200 }));
      expect(error).toMatchObject({
        page: 1,
        cost: 'Carrefour answered a page with no page state',
        status: null,
        transient: false,
      });
    });

    it('raises when an empty page still states rows at its offset', async () => {
      // The recorded page states 1,726 results, so offset 24 is inside the
      // set and an empty card list there is a gap and not the end.
      const { products, error } = await walk(
        secondAnswers({ status: 200, state: emptied(1726) })
      );
      expect(products).toHaveLength(24);
      expect(error).toBeInstanceOf(CarrefourShortCategoryError);
      expect(error).toMatchObject({
        page: 1,
        cost: 'Carrefour answered an empty page that states 1726 results',
      });
    });

    it('raises when an empty page states no total at all', async () => {
      const { error } = await walk(
        secondAnswers({ status: 200, state: emptied(undefined) })
      );
      expect(error).toMatchObject({
        page: 1,
        cost: 'Carrefour answered an empty page that states no total',
      });
    });

    it('ends without error at an empty page that states the set ended before it', async () => {
      // The category shrank to 24 since the tree was walked, and the page
      // itself says so. Paging past the end answers an empty list.
      const browser = secondAnswers({ status: 200, state: emptied(24) });
      const { products, error } = await walk(browser);
      expect(error).toBeNull();
      expect(products).toHaveLength(24);
      expect(browser.asked).toHaveLength(2);
    });

    it('ends without error at its last page', async () => {
      const browser = new FakeBrowser(ok(stating(72)));
      const { products, pages, error } = await walk(browser);
      expect(error).toBeNull();
      // The same page three times, deduplicated within the category.
      expect(products).toHaveLength(24);
      expect(pages).toEqual([0, 1, 2]);
      expect(browser.asked).toHaveLength(3);
    });

    it('loads nothing for a category that is truly empty', async () => {
      const browser = new FakeBrowser(ok(listingPage));
      const products = [];
      for await (const product of clientOn(browser).walkCategory({
        ...category,
        totalResults: 0,
      })) {
        products.push(product);
      }
      expect(products).toEqual([]);
      expect(browser.asked).toEqual([]);
    });

    it('starts from a later page when asked to', async () => {
      const browser = new FakeBrowser(ok(stating(72)));
      const { pages } = await walk(browser, { fromPage: 1 });
      expect(pages).toEqual([1, 2]);
      expect(browser.asked).toEqual([
        second,
        'https://www.carrefour.es/supermercado/x/cat20003/c?offset=48',
      ]);
    });

    it('reads the rest from the page a 503 cut, when asked from it later (owner decision 103b)', async () => {
      // The walk the end pass makes: the first ask met a 503 on the second
      // page, and the second ask starts there and reaches the last page.
      let blips = 1;
      const browser = new FakeBrowser((url) => {
        if (url === second && blips > 0) {
          blips -= 1;
          return { status: 503 };
        }
        return { status: 200, state: stating(72) };
      });
      const first = await walk(browser);
      expect(first.error).toMatchObject({ page: 1, status: 503 });

      const again = await walk(browser, {
        fromPage: (first.error as CarrefourShortCategoryError).page,
      });
      expect(again.error).toBeNull();
      expect(again.pages).toEqual([1, 2]);
    });
  });

  describe('a category that grew since the frontier (owner decision 104b)', () => {
    /** The frontier saw two pages. */
    const category: CarrefourCategory = {
      id: 'cat20003',
      name: 'Bebidas',
      url: '/supermercado/x/cat20003/c',
      path: ['Bebidas'],
      totalResults: 48,
    };
    const at = (offset: number) =>
      `https://www.carrefour.es/supermercado/x/cat20003/c?offset=${offset}`;

    /** A browser whose page at an offset states the total a test names. */
    const totals = (byOffset: (offset: number) => number) =>
      new FakeBrowser((url) => {
        const offset = Number(new URL(url).searchParams.get('offset'));
        return { status: 200, state: stating(byOffset(offset)) };
      });

    async function walk(
      browser: FakeBrowser,
      over: CarrefourCategory = category,
      options: { fromPage?: number } = {}
    ) {
      const pages: number[] = [];
      for await (const _product of clientOn(browser).walkCategory(
        over,
        (_listing, page) => pages.push(page),
        options
      )) {
        // Only the pages matter here.
      }
      return pages;
    }

    it('pages to the total the page states when it is larger', async () => {
      // 48 when the tree was walked, 60 when paged: three pages, not two.
      const browser = totals(() => 60);
      expect(await walk(browser)).toEqual([0, 1, 2]);
      expect(browser.asked).toEqual([at(0), at(24), at(48)]);
    });

    it('pages further when a later page states a still larger total', async () => {
      // The first page agrees with the frontier, the second states 72.
      const browser = totals((offset) => (offset === 0 ? 48 : 72));
      expect(await walk(browser)).toEqual([0, 1, 2]);
    });

    it('removes no page when a page states a smaller total', async () => {
      const browser = totals(() => 30);
      expect(await walk(browser)).toEqual([0, 1]);
    });

    it('stops at the ceiling however large the stated total grows', async () => {
      // 1,000 fits under the ceiling of 1,008, so the frontier paged it; it
      // now states 5,000, and the walk still asks no page past offset 984.
      const browser = totals(() => 5000);
      const pages = await walk(browser, { ...category, totalResults: 1000 });
      expect(pages).toHaveLength(42);
      expect(browser.asked.at(-1)).toBe(at(984));
    });

    it('hands over a stated total past the ceiling, uncapped, and ends with no error (owner decision 116b)', async () => {
      // 900 at the frontier, 1,100 stated from the second page on. The walk
      // pages to the ceiling and ends clean, so only the stated total tells
      // the caller that rows were left unserved.
      const browser = totals((offset) => (offset === 0 ? 900 : 1100));
      const stated: Array<number | null> = [];
      const totalsSeen: number[] = [];
      for await (const _product of clientOn(browser).walkCategory(
        { ...category, totalResults: 900 },
        (_listing, _page, total, largest) => {
          totalsSeen.push(total);
          stated.push(largest);
        }
      )) {
        // Only what onPage was handed matters here.
      }
      expect(browser.asked).toHaveLength(42);
      expect(stated[0]).toBe(900);
      expect(stated.slice(1).every((value) => value === 1100)).toBe(true);
      expect(totalsSeen.at(-1)).toBe(1008);
    });

    it('hands over null as the stated total while no page states one', async () => {
      const browser = new FakeBrowser(() => {
        const state = stating(48);
        delete (
          (state['productCardList'] as Record<string, unknown>)[
            'results'
          ] as Record<string, unknown>
        )['total_results'];
        return { status: 200, state };
      });
      const stated: Array<number | null> = [];
      for await (const _product of clientOn(browser).walkCategory(
        category,
        (_listing, _page, _total, largest) => stated.push(largest)
      )) {
        // Only what onPage was handed matters here.
      }
      expect(stated).toEqual([null, null]);
    });

    /** A page stating `total` results and `servedPages` pages of 24. */
    const serving = (total: number, servedPages: number) => {
      const state = stating(total);
      (state['pagination'] as Record<string, unknown>)['total_pages'] =
        servedPages;
      return state;
    };

    /** {@link serving} with its cards removed. */
    const servingEmpty = (total: number, servedPages: number) => {
      const state = serving(total, servedPages);
      (
        (state['productCardList'] as Record<string, unknown>)[
          'results'
        ] as Record<string, unknown>
      )['items'] = [];
      return state;
    };

    /** {@link servingEmpty} with its pagination zeroed. */
    const zeroedEmpty = (total: number) => {
      const state = servingEmpty(total, 0);
      (state['pagination'] as Record<string, unknown>)['page_size'] = 0;
      return state;
    };

    /** The pages that held cards, the totals `onPage` was handed, the error. */
    async function walkWithTotals(
      browser: FakeBrowser,
      over: CarrefourCategory = category,
      options: { fromPage?: number; knownTotal?: number } = {}
    ) {
      const pages: number[] = [];
      const totals: number[] = [];
      let error: unknown = null;
      try {
        for await (const _product of clientOn(browser).walkCategory(
          over,
          (_listing, page, total) => {
            pages.push(page);
            totals.push(total);
          },
          options
        )) {
          // Only the pages matter here.
        }
      } catch (caught) {
        error = caught;
      }
      return { pages, totals, error };
    }

    it('cuts a category whose third page is empty while it still states 49', async () => {
      // 49 stated and 48 served. The stated total grows the walk to a third
      // page, which answers empty and still states 49. The paging figure is
      // never read, so that is a cut and not an end: the safe direction.
      const browser = new FakeBrowser((url) => ({
        status: 200,
        state: url === at(48) ? servingEmpty(49, 2) : serving(49, 2),
      }));
      const { pages, totals, error } = await walkWithTotals(browser);
      expect(pages).toEqual([0, 1]);
      expect(browser.asked).toEqual([at(0), at(24), at(48)]);
      expect(totals).toEqual([49, 49]);
      expect(error).toBeInstanceOf(CarrefourShortCategoryError);
      expect(error).toMatchObject({
        page: 2,
        cost: 'Carrefour answered an empty page that states 49 results',
      });
    });

    it.each([0, 2, 3])(
      'reads pages stating 72 through page three when total_pages is %i',
      async (servedPages) => {
        const browser = new FakeBrowser(() => ({
          status: 200,
          state: serving(72, servedPages),
        }));
        const { pages, totals, error } = await walkWithTotals(browser);
        expect(error).toBeNull();
        expect(pages).toEqual([0, 1, 2]);
        expect(browser.asked).toEqual([at(0), at(24), at(48)]);
        expect(totals).toEqual([72, 72, 72]);
      }
    );

    it('keeps the stated total as the bound when the page states no pages', async () => {
      const browser = new FakeBrowser(() => {
        const state = stating(60);
        delete (state['pagination'] as Record<string, unknown>)['total_pages'];
        return { status: 200, state };
      });
      expect(await walk(browser)).toEqual([0, 1, 2]);
    });

    it.each([0, 48])(
      'cuts at an empty page with zeroed pagination that states 72 at offset %i',
      async (emptyAt) => {
        const browser = new FakeBrowser((url) => ({
          status: 200,
          state: url === at(emptyAt) ? zeroedEmpty(72) : serving(72, 3),
        }));
        const { error } = await walkWithTotals(browser);
        expect(error).toBeInstanceOf(CarrefourShortCategoryError);
        expect(error).toMatchObject({
          page: emptyAt / 24,
          cost: 'Carrefour answered an empty page that states 72 results',
        });
      }
    );

    it.each([48, 30])(
      'ends clean at an empty third page that states %i, at or below its offset',
      async (stated) => {
        // The second page grew the walk to 49; the third answers empty and
        // states a total that ends at or before offset 48.
        const browser = new FakeBrowser((url) => ({
          status: 200,
          state:
            url === at(48)
              ? zeroedEmpty(stated)
              : serving(url === at(0) ? 48 : 49, 2),
        }));
        const { pages, error } = await walkWithTotals(browser);
        expect(error).toBeNull();
        expect(pages).toEqual([0, 1]);
        expect(browser.asked).toEqual([at(0), at(24), at(48)]);
      }
    );

    it('ends clean at a first page that states the category is now empty', async () => {
      const browser = new FakeBrowser(() => ({
        status: 200,
        state: zeroedEmpty(0),
      }));
      const { pages, error } = await walkWithTotals(browser);
      expect(error).toBeNull();
      expect(pages).toEqual([]);
      expect(browser.asked).toEqual([at(0)]);
    });

    it('stays bounded by a known total when the pages it reads state none', async () => {
      // The end pass: the frontier saw 48, the first walk learned 96 and was
      // cut at page 2. The pages from 2 on serve cards but state no total, so
      // only the known total makes the walk ask page 3.
      const browser = new FakeBrowser(() => {
        const state = stating(96);
        delete (
          (state['productCardList'] as Record<string, unknown>)[
            'results'
          ] as Record<string, unknown>
        )['total_results'];
        return { status: 200, state };
      });
      const { pages, totals, error } = await walkWithTotals(browser, category, {
        fromPage: 2,
        knownTotal: 96,
      });
      expect(error).toBeNull();
      expect(pages).toEqual([2, 3]);
      expect(browser.asked).toEqual([at(48), at(72)]);
      expect(totals).toEqual([96, 96]);
    });

    it('follows the same rule from a later page', async () => {
      // The end pass asks from page 2, which only a stated total added: the
      // frontier's two pages end before it, and the pages state 96.
      const browser = totals(() => 96);
      expect(await walk(browser, category, { fromPage: 2 })).toEqual([2, 3]);
      expect(browser.asked).toEqual([at(48), at(72)]);
    });
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
