import listingPage from './__fixtures__/listing-page.json';
import productPage from './__fixtures__/product-page.json';
import {
  CarrefourClient,
  dropCloudflareCookies,
  isCloudflareCookie,
  type CarrefourCookieJar,
} from './carrefour.client';
import { CARREFOUR_MIN_DELAY_MS, type CarrefourCategory } from './types';

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

describe('CarrefourClient', () => {
  const client = (
    loader: (path: string) => Promise<unknown>
  ): CarrefourClient =>
    new CarrefourClient({
      userAgent: 'LunaShopperBot/1.0 (+https://velista.app)',
      loader: async (path) =>
        (await loader(path)) as Record<string, unknown> | null,
    });

  it('reads a listing page through the loader it was given', async () => {
    const listing = await client(async () => listingPage).readListing('/x');
    expect(listing?.cards.length).toBe(24);
  });

  it('reads a product page for its EAN', async () => {
    const detail = await client(async () => productPage).readDetail('/x');
    expect(detail?.ean).toMatch(/^\d{13}$/);
  });

  it('pages a category to its end and deduplicates within it', async () => {
    const category: CarrefourCategory = {
      id: 'cat20003',
      name: 'Bebidas',
      url: '/supermercado/x/cat20003/c',
      path: ['Bebidas'],
      totalResults: 30,
    };
    const asked: string[] = [];
    // The same page twice: 30 products is two pages, and the second repeats the
    // first, which is what a product filed twice looks like.
    const walker = client(async (path) => {
      asked.push(path);
      return listingPage;
    });

    const products = [];
    for await (const product of walker.walkCategory(category)) {
      products.push(product);
    }

    expect(asked).toEqual([
      '/supermercado/x/cat20003/c?offset=0',
      '/supermercado/x/cat20003/c?offset=24',
    ]);
    expect(products).toHaveLength(24);
    expect(products[0].categoryPath).toEqual(['Bebidas']);
  });

  it('stops a category at the first page that answers nothing', async () => {
    const category: CarrefourCategory = {
      id: 'cat1',
      name: 'A category',
      url: '/x',
      path: [],
      totalResults: 1000,
    };
    let calls = 0;
    const walker = client(async () => {
      calls += 1;
      return calls === 1 ? listingPage : null;
    });

    const products = [];
    for await (const product of walker.walkCategory(category)) {
      products.push(product);
    }
    // The products it held are lost for this run and found by the next. Paging
    // on into a refusal is what escalates the block.
    expect(products).toHaveLength(24);
    expect(calls).toBe(2);
  });

  it('never paces faster than the interval that was measured', () => {
    const fast = new CarrefourClient({
      userAgent: 'x',
      delayMs: 10,
      loader: async () => null,
    });
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
      new CarrefourClient({ userAgent: 'x', loader: async () => null }).close()
    ).resolves.toBeUndefined();
  });
});
