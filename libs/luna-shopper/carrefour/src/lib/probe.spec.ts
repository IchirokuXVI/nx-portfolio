import listingPage from './__fixtures__/listing-page.json';
import productPage from './__fixtures__/product-page.json';
import { CarrefourClient } from './carrefour.client';
import { CarrefourBrowserError, CarrefourHttpError } from './errors';
import { probeCarrefour } from './probe';
import { readDetail } from './state';
import type { CarrefourSession } from './types';

/**
 * The Carrefour probe against the committed page states and a fake browser
 * (plan 0219, Tests). No Chromium starts and no page is loaded.
 *
 * The product fixture is one of the listing's cards and not its first, and
 * the probe reads the first. The listing here is the fixture with that card
 * moved to the front, and nothing else changed.
 */

type Answer = { status: number; state?: unknown } | { throws: Error };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Items = Array<Record<string, unknown>>;

function listing(edit: (items: Items) => void = () => undefined): unknown {
  const state = clone(listingPage) as unknown as {
    productCardList: { results: { items: Items } };
  };
  const items = state.productCardList.results.items;
  const id = readDetail(productPage as Record<string, unknown>)?.externalId;
  const at = items.findIndex((item) => item['product_id'] === id);
  items.unshift(...items.splice(at, 1));
  edit(items);
  return state;
}

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

const site =
  (listingState: unknown = listing()) =>
  (url: string): Answer =>
    url.includes('/supermercado/la-despensa/cat20001/c')
      ? { status: 200, state: listingState }
      : { status: 200, state: productPage };

const run = (browser: FakeBrowser) =>
  probeCarrefour({
    userAgent: 'LunaShopperBot/1.0',
    openSession: browser.open,
    sleepImpl: async () => undefined,
  });

describe('probeCarrefour', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes both steps over the fixtures, in two pages, and closes the browser', async () => {
    const browser = new FakeBrowser(site());

    const result = await run(browser);

    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['listing', true],
      ['product', true],
    ]);
    expect(result.requests).toBe(2);
    expect(browser.asked).toHaveLength(2);
    expect(browser.opened).toBe(1);
    expect(browser.closed).toBe(1);
    expect(result.steps[1].sample['ean']).toMatch(/^\d{13}$/);
  });

  it('names a renamed card field and loads no second page', async () => {
    const renamed = listing((items) => {
      for (const item of items) {
        item['link'] = item['url'];
        delete item['url'];
      }
    });
    const browser = new FakeBrowser(site(renamed));

    const result = await run(browser);

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].ok).toBe(false);
    expect(result.steps[0].problems.join(' ')).toContain('path');
    expect(browser.asked).toHaveLength(1);
  });

  it('stops at a 403 on the first page, with no second page', async () => {
    const browser = new FakeBrowser(() => ({ status: 403 }));

    const result = await run(browser);

    expect(result.steps).toEqual([
      expect.objectContaining({ name: 'listing', ok: false, httpStatus: 403 }),
    ]);
    expect(browser.asked).toHaveLength(1);
    expect(browser.closed).toBe(1);
  });

  it('fails the 80 per cent rule when most cards lost their price, and passes when a few did', async () => {
    const losing = (lost: number) =>
      listing((items) => {
        items.slice(1, 1 + lost).forEach((item) => {
          delete item['price'];
          delete item['app_price'];
        });
      });

    const failed = await run(new FakeBrowser(site(losing(20))));
    const passed = await run(new FakeBrowser(site(losing(2))));

    expect(failed.steps[0].ok).toBe(false);
    expect(failed.steps[0].problems.join(' ')).toContain('priceCents');
    expect(passed.steps.every((step) => step.ok)).toBe(true);
  });

  it('closes the client when a step throws, and keeps the browser error for the verdict', async () => {
    const close = jest.spyOn(CarrefourClient.prototype, 'close');
    const browser = new FakeBrowser(() => ({
      throws: new CarrefourBrowserError('loading the page'),
    }));

    const result = await run(browser);

    expect(result.steps[0]).toEqual(
      expect.objectContaining({ ok: false, httpStatus: null })
    );
    expect(result.failure).toBeInstanceOf(CarrefourBrowserError);
    // The client drops a session whose page threw, and the probe's own close
    // still runs on the way out.
    expect(browser.opened).toBe(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes a client that never opened a page', async () => {
    const close = jest.spyOn(CarrefourClient.prototype, 'close');
    const controller = new AbortController();
    controller.abort();
    const browser = new FakeBrowser(site());

    const result = await probeCarrefour({
      userAgent: 'LunaShopperBot/1.0',
      openSession: browser.open,
      sleepImpl: async () => undefined,
      signal: controller.signal,
    });

    expect(result.steps[0].ok).toBe(false);
    expect(browser.opened).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reads a 5xx on the seed listing as its status, with no second page', async () => {
    const browser = new FakeBrowser(() => ({ status: 503 }));

    const result = await run(browser);

    expect(result.steps).toEqual([
      expect.objectContaining({ name: 'listing', ok: false, httpStatus: 503 }),
    ]);
    expect(result.steps[0].problems).toEqual([]);
    expect(result.failure).toBeInstanceOf(CarrefourHttpError);
    expect(browser.asked).toHaveLength(1);
    expect(browser.closed).toBe(1);
  });

  it('reads a 5xx on the product page as its status', async () => {
    const browser = new FakeBrowser((url) =>
      url.includes('/supermercado/la-despensa/cat20001/c')
        ? { status: 200, state: listing() }
        : { status: 502 }
    );

    const result = await run(browser);

    expect(result.steps.map((step) => [step.name, step.ok])).toEqual([
      ['listing', true],
      ['product', false],
    ]);
    expect(result.steps[1]).toEqual(
      expect.objectContaining({ httpStatus: 502, problems: [] })
    );
    expect(result.failure).toBeInstanceOf(CarrefourHttpError);
    expect(browser.asked).toHaveLength(2);
  });

  it('still reads a page that answered 200 with no state as a problem', async () => {
    const browser = new FakeBrowser(() => ({ status: 200 }));

    const result = await run(browser);

    expect(result.steps[0]).toEqual(
      expect.objectContaining({
        ok: false,
        httpStatus: null,
        error: null,
        problems: ['the seed listing answered no page state'],
      })
    );
    expect(result.failure).toBeUndefined();
  });
});
