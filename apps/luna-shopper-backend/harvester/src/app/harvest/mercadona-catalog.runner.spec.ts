import type { ConfigService } from '@nestjs/config';
import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import type { Repository } from 'typeorm';
import type {
  SourceCatalogEntry,
  SourceEntryPrice,
  SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { MercadonaCatalogRunner } from './mercadona-catalog.runner';
import type { RunContext } from './run-context';
import { SourceIngest } from './source-ingest';

/**
 * The walk, end to end, over a stubbed `fetch` and no network (plan 0086,
 * section 5).
 *
 * **No run here fetches anything.** A real catalog discovery is 4,383 requests
 * over eighteen minutes and is never started from a test; the payloads below
 * are the shapes the source answers with, a tree of one category holding two
 * products, so a whole walk is four requests.
 *
 * They are written here rather than imported from
 * `@portfolio/luna-shopper/mercadona`'s recorded fixtures, which is what that
 * library's own spec asserts its parsers against: a spec may not reach into
 * another project's sources by path, and what this file is about is the
 * runner's wiring rather than the parsing.
 *
 * What is pinned is what plan 0086 changed: the walk writes the price it
 * fetched, for the `ACTIVE` rows only, and it says what the warehouse carries.
 * The negative half of that claim is made **only by a walk that finished**.
 */

const CHAIN = '11111111-1111-4111-8111-111111111111';
const SCOPE = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const BASE = 'https://fixtures.test/api';

/** The assortment, which the one level 2 category below lists. */
const WALKED = ['4241', '7012'];

/** `/categories/`: one level 1 category holding one level 2 category. */
const CATEGORY_TREE = {
  next: null,
  previous: null,
  results: [
    {
      id: 12,
      name: 'Aceite, especias y salsas',
      order: 1,
      published: true,
      categories: [
        { id: 112, name: 'Aceite, vinagre y sal', order: 1, published: true },
      ],
    },
  ],
};

/** One product as a category listing states it: no `ean` and no `brand`. */
function listed(id: string) {
  return {
    id,
    slug: `producto-${id}`,
    display_name: `Producto ${id}`,
    published: true,
    share_url: `https://fixtures.test/product/${id}`,
    price_instructions: {
      size_format: 'l',
      unit_price: '8.75',
      bulk_price: '8.75',
      unit_size: 1,
      reference_format: 'L',
    },
  };
}

/** `/categories/:id/`: the level 2 children with their products inline. */
const CATEGORY_PRODUCTS = {
  id: 112,
  name: 'Aceite, vinagre y sal',
  order: 1,
  published: true,
  categories: [
    {
      id: 113,
      name: 'Aceite de oliva',
      order: 1,
      published: true,
      products: WALKED.map(listed),
    },
  ],
};

/** `/products/:id/`: the detail call, the only place `ean` and `brand` exist. */
function detailed(id: string, ean: string | null) {
  return {
    ...listed(id),
    ean,
    brand: 'Hacendado',
    categories: [
      {
        id: 12,
        name: 'Aceite, especias y salsas',
        level: 0,
        categories: [{ id: 112, name: 'Aceite, vinagre y sal', level: 1 }],
      },
    ],
  };
}

interface Fetched {
  urls: string[];
}

/**
 * A `fetch` that answers from the fixtures and records every URL.
 *
 * `onRequest` is how the abort test stops the run: it is called with the number
 * of requests so far, exactly where a real abort would land, between two
 * fetches.
 */
function stubFetch(options: {
  detailFor?: (externalId: string) => unknown | null;
  onRequest?: (count: number, url: string) => void;
}): Fetched & { fetchImpl: typeof fetch } {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    options.onRequest?.(urls.length, url);

    const answer = (status: number, body: unknown): Response =>
      ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => body,
      }) as unknown as Response;

    if (url.startsWith(`${BASE}/categories/?`)) {
      return answer(200, CATEGORY_TREE);
    }
    if (/\/categories\/\d+\//.test(url)) {
      return answer(200, CATEGORY_PRODUCTS);
    }
    const product = /\/products\/([^/]+)\//.exec(url);
    if (product) {
      const detail =
        options.detailFor?.(product[1]) ??
        detailed(product[1], '8480000135636');
      return detail === null ? answer(404, null) : answer(200, detail);
    }
    throw new Error(`No fixture for ${url}`);
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

function build(options: {
  rows?: Partial<SourceCatalogEntry>[];
  items?: unknown[];
  controller?: AbortController;
}) {
  const stored = (options.rows ?? []).map(
    (row, index) =>
      ({
        id: `held-${index + 1}`,
        supermarketId: CHAIN,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        status: SourceEntryStatus.UNRESOLVED,
        timesSeen: 1,
        itemId: null,
        candidateEntryId: null,
        matchedBy: null,
        confidence: 0,
        decidedAt: null,
        brand: null,
        ean: null,
        unitSize: null,
        sizeFormat: null,
        categoryPath: [],
        url: null,
        extra: null,
        ...row,
      }) as SourceCatalogEntry
  );
  const saved: SourceCatalogEntry[] = [];
  let created = 0;

  const entries = {
    // The ingest reads every row of the chain; the availability pass reads the
    // ACTIVE ones of this source kind, which is a `where` this fake honours.
    find: jest.fn(
      async (query?: { where?: Partial<SourceCatalogEntry> }) => {
        const all = [...stored, ...saved.filter((row) => !stored.includes(row))];
        const where = query?.where ?? {};
        return all.filter(
          (row) =>
            (where.status === undefined || row.status === where.status) &&
            (where.sourceKind === undefined ||
              row.sourceKind === where.sourceKind)
        );
      }
    ),
    create: jest.fn((row: SourceCatalogEntry) => {
      created += 1;
      return { id: `new-${created}`, ...row };
    }),
    save: jest.fn(async (row: SourceCatalogEntry) => {
      if (!saved.includes(row) && !stored.includes(row)) {
        saved.push(row);
      }
      return row;
    }),
  } as unknown as Repository<SourceCatalogEntry>;

  const priceUpsert = jest.fn(async () => undefined);
  const prices = { upsert: priceUpsert } as unknown as Repository<SourceEntryPrice>;

  const catalog = {
    searchItems: jest.fn(async () => ({
      items: options.items ?? [],
      nextCursor: null,
    })),
    addPrices: jest.fn(async () => ({ inserted: 1, confirmed: 0 })),
    setAvailability: jest.fn(async () => ({ updated: 1 })),
  };

  const controller = options.controller ?? new AbortController();
  const context = {
    runId: RUN,
    signal: controller.signal,
    acquire: async () => undefined,
    setStage: jest.fn(async () => undefined),
    setTotalPlanned: jest.fn(async () => undefined),
    report: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
  } as unknown as RunContext;

  const ingest = new SourceIngest(
    entries,
    prices,
    catalog as unknown as CatalogClient
  );
  const runner = new MercadonaCatalogRunner(
    entries,
    ingest,
    catalog as unknown as CatalogClient,
    {
      getOrThrow: () => ({
        userAgent: 'test',
        mercadonaBaseUrl: BASE,
      }),
    } as unknown as ConfigService
  );

  return { runner, context, catalog, saved, stored, priceUpsert, controller };
}

const source = (): SupermarketSource =>
  ({
    adapterKey: 'mercadona-api',
    workers: 1,
    config: { warehouse: '4661' },
  }) as unknown as SupermarketSource;

/** The stub is installed on the global, because the runner builds its client. */
function withFetch(fetchImpl: typeof fetch): () => void {
  const held = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = held;
  };
}

describe('MercadonaCatalogRunner (plan 0086)', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('writes a price for the ACTIVE rows it saw and for nothing else', async () => {
    const { fetchImpl } = stubFetch({
      // Only the first product's EAN is one the catalog holds, so only it
      // reaches ACTIVE through rung 2.
      detailFor: (id) =>
        detailed(id, id === WALKED[0] ? '8480000135636' : null),
    });
    restore = withFetch(fetchImpl);
    const { runner, context, catalog, saved } = build({
      items: [
        {
          id: 'item-oil',
          name: { es: 'Nothing alike', en: null },
          brand: null,
          ean: '8480000135636',
          unitSize: null,
        },
      ],
    });

    await runner.run(context, { supermarketId: CHAIN, priceScopeId: SCOPE }, source());

    expect(saved.map((row) => row.externalId).sort()).toEqual(WALKED);
    expect(catalog.addPrices).toHaveBeenCalledTimes(1);
    const sent = catalog.addPrices.mock.calls[0][1] as { itemId: string }[];
    // One price, for the one product an EAN resolved. The other is queued and a
    // fuzzy row is never owed a price.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ itemId: 'item-oil', price: 8.75 });
    expect(catalog.addPrices.mock.calls[0][3]).toBe(PriceSourceKind.OFFICIAL_API);
  });

  it('says a tracked product the walk did not list is not stocked', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context, catalog } = build({
      rows: [
        {
          // A product an earlier walk found and a person accepted, which this
          // walk's tree no longer lists at all.
          externalId: '9999',
          name: 'Discontinuado',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-gone',
        },
      ],
      items: [
        {
          id: 'item-oil',
          name: { es: 'Nothing alike', en: null },
          brand: null,
          ean: '8480000135636',
          unitSize: null,
        },
      ],
    });

    await runner.run(context, { supermarketId: CHAIN, priceScopeId: SCOPE }, source());

    const written = catalog.setAvailability.mock.calls[0][1] as {
      itemId: string;
      available: boolean;
    }[];
    expect(written).toContainEqual({ itemId: 'item-gone', available: false });
    expect(written).toContainEqual({ itemId: 'item-oil', available: true });
  });

  it('an aborted walk keeps what it fetched and asserts no absence', async () => {
    const controller = new AbortController();
    // Abort on the second detail call, so the walk finished, one product was
    // fetched, and the rest of the assortment never was. That is the shape of a
    // real abort: the tree is cheap and the detail phase is the eighteen minutes.
    let details = 0;
    const { fetchImpl } = stubFetch({
      onRequest: (_count, url) => {
        if (url.includes('/products/')) {
          details += 1;
          if (details >= 2) {
            controller.abort();
          }
        }
      },
    });
    restore = withFetch(fetchImpl);
    const { runner, context, catalog, saved } = build({
      controller,
      rows: [
        {
          externalId: '9999',
          name: 'Discontinuado',
          status: SourceEntryStatus.ACTIVE,
          itemId: 'item-gone',
        },
      ],
      items: [
        {
          id: 'item-oil',
          name: { es: 'Nothing alike', en: null },
          brand: null,
          ean: '8480000135636',
          unitSize: null,
        },
      ],
    });

    await runner.run(context, { supermarketId: CHAIN, priceScopeId: SCOPE }, source());

    // What it did fetch is kept: prices already fetched are valid data.
    expect(saved.length).toBeGreaterThan(0);
    const written = (catalog.setAvailability.mock.calls[0]?.[1] ?? []) as {
      itemId: string;
      available: boolean;
    }[];
    // The run did not walk the whole tree, so it says nothing negative about
    // anything, including the row it never observed.
    expect(written.every((entry) => entry.available)).toBe(true);
    expect(written).not.toContainEqual({
      itemId: 'item-gone',
      available: false,
    });
  });

  it('refuses to walk with no price scope to write the prices for', async () => {
    const { fetchImpl } = stubFetch({});
    restore = withFetch(fetchImpl);
    const { runner, context } = build({});

    await expect(
      runner.run(context, { supermarketId: CHAIN }, source())
    ).rejects.toThrow(/price scope/i);
  });
});
