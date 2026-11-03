import { SourceGuard } from '@portfolio/luna-shopper/source-guard';
import categoriesTree from './__fixtures__/categories-tree.json';
import categoryExpanded from './__fixtures__/category-expanded.json';
import oliveOilEn from './__fixtures__/product-detail-en.json';
import oliveOilEs from './__fixtures__/product-detail-es.json';
import {
  MERCADONA_REFUSAL_POLICY,
  MercadonaClient,
  MercadonaHttpError,
} from './mercadona.client';

/**
 * Client tests inject `fetchImpl` and assert delay, backoff, abort and 404 to
 * null (plan 0038, section 9). Nothing here touches the network.
 */

const UA = 'LunaShopper/0.1 (+https://velista.app; contact@velista.app)';

interface StubResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function jsonResponse({ status = 200, body, headers = {} }: StubResponse) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
  } as unknown as Response;
}

/** A fetch stub that records every URL and replays a queue of answers. */
function stubFetch(answers: StubResponse[]) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    const next = answers.shift();
    if (!next) {
      throw new Error(`No stub response left for ${String(url)}`);
    }
    return jsonResponse(next);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function client(
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof MercadonaClient>[0]> = {}
) {
  return new MercadonaClient({
    warehouse: '4661',
    userAgent: UA,
    fetchImpl,
    // Backoff must not actually sleep in a unit test.
    sleepImpl: async () => undefined,
    now: () => new Date('2026-08-30T09:00:00.000Z'),
    ...overrides,
  });
}

describe('MercadonaClient.resolveWarehouse', () => {
  it('reads the warehouse out of the x-customer-wh header', async () => {
    const { fetchImpl, calls } = stubFetch([
      { headers: { 'x-customer-wh': '4661' } },
    ]);
    await expect(
      MercadonaClient.resolveWarehouse('14013', { userAgent: UA, fetchImpl })
    ).resolves.toBe('4661');
    expect(calls[0]).toContain('/postal-codes/actions/change-pc/');
  });

  it('accepts a city slug, which is why the scope key is a string', async () => {
    const { fetchImpl } = stubFetch([{ headers: { 'x-customer-wh': 'mad3' } }]);
    await expect(
      MercadonaClient.resolveWarehouse('28001', { userAgent: UA, fetchImpl })
    ).resolves.toBe('mad3');
  });

  it('refuses to guess when the header is missing', async () => {
    const { fetchImpl } = stubFetch([{}]);
    await expect(
      MercadonaClient.resolveWarehouse('14013', { userAgent: UA, fetchImpl })
    ).rejects.toThrow(/no\s+x-customer-wh/i);
  });
});

describe('MercadonaClient requests', () => {
  it('scopes every request to the warehouse and asks for a language', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: categoriesTree }]);
    await client(fetchImpl).listCategories('es');
    expect(calls[0]).toBe(
      'https://tienda.mercadona.es/api/categories/?lang=es&wh=4661'
    );
  });

  it('sends the honest User-Agent, not a browser impersonation', async () => {
    const seen: RequestInit[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return jsonResponse({ body: categoriesTree });
    }) as unknown as typeof fetch;
    await client(fetchImpl).listCategories();
    const headers = seen[0].headers as Record<string, string>;
    expect(headers['user-agent']).toBe(UA);
    expect(headers['user-agent']).not.toMatch(/chrome|mozilla/i);
  });

  it('answers null on 404 rather than throwing (section 2.6)', async () => {
    const { fetchImpl } = stubFetch([{ status: 404 }]);
    await expect(client(fetchImpl).getProduct('4241')).resolves.toBeNull();
  });

  it('answers null from fetchProduct on 404, so a run records unavailable', async () => {
    const { fetchImpl } = stubFetch([{ status: 404 }]);
    await expect(client(fetchImpl).fetchProduct('4241')).resolves.toBeNull();
  });

  it('fetches Spanish only unless English is asked for (section 6.2)', async () => {
    const { fetchImpl, calls } = stubFetch([{ body: oliveOilEs }]);
    const product = await client(fetchImpl).fetchProduct('4241', ['es']);
    expect(calls).toHaveLength(1);
    expect(product?.name.en).toBeUndefined();
  });

  it('pays one extra request for the English name when asked', async () => {
    const { fetchImpl, calls } = stubFetch([
      { body: oliveOilEs },
      { body: oliveOilEn },
    ]);
    const product = await client(fetchImpl).fetchProduct('4241', ['es', 'en']);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('lang=en');
    expect(product?.name).toEqual({
      es: 'Aceite de oliva 0,4º Hacendado',
      en: 'Light olive oil Hacendado',
    });
  });
});

describe('MercadonaClient backoff', () => {
  it('retries a 429 and succeeds, sleeping between attempts', async () => {
    const slept: number[] = [];
    const { fetchImpl } = stubFetch([
      { status: 429 },
      { status: 503 },
      { body: categoriesTree },
    ]);
    const categories = await client(fetchImpl, {
      retries: 3,
      backoffBaseMs: 100,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    }).listCategories();

    expect(categories).toHaveLength(2);
    expect(slept).toHaveLength(2);
    // Exponential: the second wait is drawn from a window twice as wide as the
    // first. Jitter makes the exact numbers random, so assert the bounds.
    expect(slept[0]).toBeGreaterThanOrEqual(100);
    expect(slept[0]).toBeLessThan(200);
    expect(slept[1]).toBeGreaterThanOrEqual(200);
    expect(slept[1]).toBeLessThan(400);
  });

  it('gives up once the retries are exhausted, so repeated 429s end a run', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 429 },
      { status: 429 },
      { status: 429 },
    ]);
    await expect(
      client(fetchImpl, { retries: 2 }).listCategories()
    ).rejects.toBeInstanceOf(MercadonaHttpError);
    expect(calls).toHaveLength(3);
  });

  it('does not retry a 400: no amount of waiting fixes a bad request', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 400 }]);
    await expect(client(fetchImpl).listCategories()).rejects.toBeInstanceOf(
      MercadonaHttpError
    );
    expect(calls).toHaveLength(1);
  });
});

describe('MercadonaClient pacing and abort', () => {
  it('awaits the injected gate before every request', async () => {
    // This is how the harvester shares ONE token bucket across every worker
    // (section 6.3), so the configured rate is the rate the source sees.
    let acquired = 0;
    const { fetchImpl } = stubFetch([
      { body: categoriesTree },
      { body: categoryExpanded },
      { body: categoryExpanded },
      { body: categoryExpanded },
      { body: categoryExpanded },
    ]);
    const c = client(fetchImpl, {
      acquire: async () => {
        acquired += 1;
      },
    });
    const products = [];
    for await (const product of c.walkCatalog()) {
      products.push(product);
    }
    // One tree walk plus the four level 1 categories the two roots hold.
    expect(acquired).toBe(5);
  });

  it('stops before making a request once the signal is aborted', async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = stubFetch([{ body: categoriesTree }]);
    const c = client(fetchImpl, { signal: controller.signal });
    controller.abort();
    await expect(c.listCategories()).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('walkCatalog', () => {
  it('yields each product exactly once even when filed under two branches', async () => {
    // 7012 appears in both level 2 branches of the fixture. A work queue that
    // held it twice would fetch its detail twice, which is the waste the
    // deduplication exists to prevent.
    const { fetchImpl } = stubFetch([
      { body: { results: [categoriesTree.results[1]] } },
      { body: categoryExpanded },
      { body: { id: 55, name: 'Jamón serrano', products: [] } },
    ]);
    const ids: string[] = [];
    for await (const product of client(fetchImpl).walkCatalog()) {
      ids.push(product.externalId);
    }
    expect(ids).toEqual(['7012', '8271']);
  });
});

/**
 * The run's refusal guard (plan 0215, section 4). The 200 answers are the
 * committed fixtures and the 403 is synthesized: the guard reads the status
 * and never the body of a refusal, so no block is provoked to capture one.
 */
describe('MercadonaClient and the refusal guard', () => {
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  /** A guard whose pause ends when the spec says so. */
  function pausingGuard() {
    const sleeps: Array<() => void> = [];
    const guard = new SourceGuard(MERCADONA_REFUSAL_POLICY, {
      sleep: () => new Promise<void>((resolve) => sleeps.push(resolve)),
    });
    const endPause = async (): Promise<void> => {
      for (let tick = 0; tick < 40; tick += 1) {
        await settle();
        sleeps.shift()?.();
      }
    };
    return { guard, endPause };
  }

  it('trips a passed guard on a run of 403, and sends the tripping request again once after the pause', async () => {
    const { guard, endPause } = pausingGuard();
    const { fetchImpl, calls } = stubFetch([
      { status: 403 },
      { status: 403 },
      { status: 403 },
      { status: 403 },
      { status: 403 },
      { body: oliveOilEs },
    ]);
    const c = client(fetchImpl, { guard });

    for (const id of ['1', '2', '3', '4']) {
      await expect(c.getProduct(id)).rejects.toBeInstanceOf(MercadonaHttpError);
    }
    const tripping = c.getProduct('5');
    await settle();
    // The fifth refusal paused the run: nothing more is sent until it ends.
    expect(calls).toHaveLength(5);

    await endPause();

    await expect(tripping).resolves.toEqual(oliveOilEs);
    expect(calls).toHaveLength(6);
    expect(calls[5]).toBe(calls[4]);
    expect(guard.stop).toBeNull();
    expect(guard.summary().paused?.resumedAt).not.toBeNull();
  });

  it('tells a passed guard what resolveWarehouse was answered', async () => {
    const { guard } = pausingGuard();
    const { fetchImpl } = stubFetch([
      { status: 403 },
      { headers: { 'x-customer-wh': '4661' } },
    ]);
    const options = { userAgent: UA, fetchImpl, guard };

    await expect(
      MercadonaClient.resolveWarehouse('14013', options)
    ).rejects.toBeInstanceOf(MercadonaHttpError);
    await expect(
      MercadonaClient.resolveWarehouse('14013', options)
    ).resolves.toBe('4661');

    // The clean answer ended the streak, so the refusal was an isolated one.
    expect(guard.summary()).toEqual(
      expect.objectContaining({ isolated: 1, lastStatus: 403 })
    );
  });

  it('counts a 404 as an answer that clears the count', async () => {
    const { guard } = pausingGuard();
    const { fetchImpl } = stubFetch([
      { status: 403 },
      { status: 403 },
      { status: 403 },
      { status: 403 },
      { status: 404 },
      { status: 403 },
    ]);
    const c = client(fetchImpl, { guard });

    for (const id of ['1', '2', '3', '4']) {
      await expect(c.getProduct(id)).rejects.toBeInstanceOf(MercadonaHttpError);
    }
    await expect(c.getProduct('5')).resolves.toBeNull();
    await expect(c.getProduct('6')).rejects.toBeInstanceOf(MercadonaHttpError);

    expect(guard.summary().paused).toBeNull();
  });

  it('throws MercadonaHttpError on a 403 with no guard, as before', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 403 }]);

    await expect(client(fetchImpl).getProduct('1')).rejects.toBeInstanceOf(
      MercadonaHttpError
    );
    expect(calls).toHaveLength(1);
  });
});
