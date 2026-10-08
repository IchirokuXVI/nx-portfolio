import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { CatalogBrowseQuery } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { CatalogBrowseApi } from './catalog-browse-api';
import { CatalogBrowseMemory } from './catalog-browse-memory';

const GATEWAY = 'https://gateway.test';

/** An `ItemView` carrying every field the wire has, including the ones not drawn. */
const ITEM_VIEW = {
  id: 'item-1',
  name: { es: 'Leche entera', en: 'Whole milk' },
  brand: 'Hacendado',
  imageUrl: null,
  sku: '1234',
  ean: '8480000000000',
  unitSize: 1,
  categories: [
    {
      id: 'cat-milk',
      parentId: 'cat-eggs-milk-and-butter',
      slug: 'milk',
      name: { en: 'Milk', es: 'Leche' },
    },
  ],
  defaultUnit: 'LITER',
  productGroupId: 'group-milk',
  bestOffer: {
    itemId: 'item-1',
    priceScopeId: 'scope-m',
    price: 0.89,
    currency: 'EUR',
    unitPrice: 0.89,
    unitPriceLabel: 'EUR/L',
    unitBasis: 'LITER',
    observedAt: '2026-09-20T10:00:00.000Z',
    sourceKind: 'OFFICIAL_API',
    priceCopiedFromScopeId: null,
    stale: false,
  },
  offers: [],
};

function query(
  overrides: Partial<CatalogBrowseQuery> = {}
): CatalogBrowseQuery {
  return {
    query: '',
    order: 'category',
    soldBy: null,
    categoryId: null,
    priceScopeIds: [],
    locationId: null,
    cursor: null,
    limit: 30,
    ...overrides,
  };
}

describe('CatalogBrowseApi', () => {
  let api: CatalogBrowseApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideVelistaTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        ApiUrl,
        CatalogBrowseApi,
      ],
    });

    api = TestBed.inject(CatalogBrowseApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('browsing', () => {
    it('maps an ItemView into the app’s own model and nothing more (rule D4)', async () => {
      const result = api.browse(query());

      httpMock
        .expectOne((req) => req.url === `${GATEWAY}/v1/catalog/items`)
        .flush({ items: [ITEM_VIEW], nextCursor: null });

      // `toEqual` and not `toMatchObject`: a field the wire carries and this screen
      // does not draw, like `sku`, `ean` or `offers`, must not ride along.
      await expect(result).resolves.toEqual({
        items: [
          {
            id: 'item-1',
            name: { es: 'Leche entera', en: 'Whole milk' },
            brand: 'Hacendado',
            imageUrl: null,
            size: 1,
            unit: 'LITER',
            categories: [
              {
                id: 'cat-milk',
                parentId: 'cat-eggs-milk-and-butter',
                slug: 'milk',
                name: { en: 'Milk', es: 'Leche' },
              },
            ],
            offer: {
              price: 0.89,
              currency: 'EUR',
              unitPrice: 0.89,
              unitPriceLabel: 'EUR/L',
              observedAt: new Date('2026-09-20T10:00:00.000Z'),
              sourceKind: 'OFFICIAL_API',
              stale: false,
              priceScopeId: 'scope-m',
            },
            unitBasis: 'LITER',
          },
        ],
        nextCursor: null,
      });
    });

    it('draws no price and no basis for a row the read did not price', async () => {
      const result = api.browse(query());

      httpMock
        .expectOne((req) => req.url === `${GATEWAY}/v1/catalog/items`)
        .flush({
          items: [{ ...ITEM_VIEW, bestOffer: null }],
          nextCursor: null,
        });

      const page = await result;
      expect(page?.items[0]?.offer).toBeNull();
      expect(page?.items[0]?.unitBasis).toBeNull();
    });

    it('pages by cursor, passing back exactly what it was given', async () => {
      const first = api.browse(query());
      httpMock
        .expectOne((req) => req.url === `${GATEWAY}/v1/catalog/items`)
        .flush({ items: [ITEM_VIEW], nextCursor: 'opaque-1' });
      const page = await first;
      expect(page?.nextCursor).toBe('opaque-1');

      const second = api.browse(query({ cursor: page?.nextCursor ?? null }));
      const req = httpMock.expectOne(
        (r) => r.url === `${GATEWAY}/v1/catalog/items`
      );
      expect(req.request.params.get('cursor')).toBe('opaque-1');
      req.flush({ items: [], nextCursor: null });
      await expect(second).resolves.toEqual({ items: [], nextCursor: null });
    });

    it('sends a chain as soldBy and its scopes as priceScopeId, never as supermarketId', async () => {
      const result = api.browse(
        query({
          query: '  leche ',
          order: 'relevance',
          soldBy: 'chain-m',
          priceScopeIds: ['scope-m1', 'scope-m2'],
        })
      );

      const req = httpMock.expectOne(
        (r) => r.url === `${GATEWAY}/v1/catalog/items`
      );
      expect(req.request.params.get('query')).toBe('leche');
      expect(req.request.params.get('order')).toBe('relevance');
      expect(req.request.params.getAll('soldBy')).toEqual(['chain-m']);
      expect(req.request.params.getAll('priceScopeId')).toEqual([
        'scope-m1',
        'scope-m2',
      ]);
      expect(req.request.params.has('supermarketId')).toBe(false);
      req.flush({ items: [], nextCursor: null });
      await result;
    });

    it.each(['category', 'price', 'unitPrice'] as const)(
      'sends the %s order by its own name (velista 0134, backend 0196)',
      async (order) => {
        const result = api.browse(query({ order }));

        const req = httpMock.expectOne(
          (r) => r.url === `${GATEWAY}/v1/catalog/items`
        );
        expect(req.request.params.get('order')).toBe(order);
        req.flush({ items: [], nextCursor: null });
        await result;
      }
    );

    it('sends one shop as locationId, alone (velista 0124, backend 0170)', async () => {
      const result = api.browse(query({ locationId: 'loc-mayor' }));

      const req = httpMock.expectOne(
        (r) => r.url === `${GATEWAY}/v1/catalog/items`
      );
      expect(req.request.params.get('locationId')).toBe('loc-mayor');
      expect(req.request.params.has('soldBy')).toBe(false);
      expect(req.request.params.has('priceScopeId')).toBe(false);
      req.flush({ items: [], nextCursor: null });
      await result;
    });

    it('sends a chosen category as categoryId, as it is, root or leaf (velista 0119)', async () => {
      const result = api.browse(
        query({
          categoryId: 'cat-frozen-foods-and-ice-cream',
          soldBy: 'chain-m',
        })
      );

      const req = httpMock.expectOne(
        (r) => r.url === `${GATEWAY}/v1/catalog/items`
      );
      expect(req.request.params.getAll('categoryId')).toEqual([
        'cat-frozen-foods-and-ice-cream',
      ]);
      expect(req.request.params.getAll('soldBy')).toEqual(['chain-m']);
      req.flush({ items: [], nextCursor: null });
      await result;
    });

    it('sends no query and no selectors for a blank read, so the profile resolves', async () => {
      const result = api.browse(query({ query: '   ' }));

      const req = httpMock.expectOne(
        (r) => r.url === `${GATEWAY}/v1/catalog/items`
      );
      expect(req.request.params.has('query')).toBe(false);
      expect(req.request.params.has('categoryId')).toBe(false);
      expect(req.request.params.has('soldBy')).toBe(false);
      expect(req.request.params.has('priceScopeId')).toBe(false);
      req.flush({ items: [], nextCursor: null });
      await result;
    });

    it('answers null, not an empty page, when the read fails', async () => {
      const result = api.browse(query());

      httpMock
        .expectOne((r) => r.url === `${GATEWAY}/v1/catalog/items`)
        .flush(null, { status: 503, statusText: 'Unavailable' });

      await expect(result).resolves.toBeNull();
    });
  });

  describe('the context', () => {
    function answer(scope: unknown, chains: unknown[]): void {
      httpMock.expectOne(`${GATEWAY}/v1/catalog/scope`).flush(scope);
      httpMock
        .expectOne(`${GATEWAY}/v1/catalog/shops/summary`)
        .flush({ chains });
      httpMock
        .expectOne((r) => r.url === `${GATEWAY}/v1/catalog/supermarkets`)
        .flush({
          items: [{ id: 'chain-far', name: { es: 'Lejos', en: 'Far' } }],
          nextCursor: null,
        });
    }

    const MERCADONA = {
      supermarketId: 'chain-m',
      name: { es: 'Mercadona', en: 'Mercadona' },
      logoUrl: null,
      externalBrandKey: 'mercadona',
      locations: 7,
      excluded: 0,
      excludedChain: false,
    };

    it('reads the scopes, the chips and every chain’s name', async () => {
      const result = api.context();
      answer(
        {
          priceScopeIds: ['scope-m'],
          scopes: [
            {
              priceScopeId: 'scope-m',
              supermarketId: 'chain-m',
              postalCode: '14013',
              origin: 'POSTAL_CODE',
              approximate: false,
              supermarketLocationId: null,
              priority: 300,
              quoted: true,
            },
          ],
          coverage: [{ postalCode: '14013', served: true }],
          approximate: false,
          profileId: 'p1',
          explicit: false,
        },
        [MERCADONA]
      );

      const context = await result;
      expect(context?.state).toBe('priced');
      expect(context?.postalCodes).toEqual(['14013']);
      expect(context?.chains).toEqual([
        {
          supermarketId: 'chain-m',
          name: { es: 'Mercadona', en: 'Mercadona' },
          locations: 7,
          logoUrl: null,
        },
      ]);
      expect(context?.scopes).toEqual([
        { priceScopeId: 'scope-m', supermarketId: 'chain-m' },
      ]);
      expect(context?.chainNames.get('chain-far')).toEqual({
        es: 'Lejos',
        en: 'Far',
      });
    });

    it.each([
      ['no postal code', [], [MERCADONA], 'noPlace'],
      [
        'a code nobody serves',
        [{ postalCode: '99999', served: false }],
        [],
        'unserved',
      ],
      [
        'every chain refused',
        [{ postalCode: '14013', served: true }],
        [],
        'refused',
      ],
    ])(
      'says %s rather than reading it as an empty catalog',
      async (_, coverage, chains, state) => {
        const result = api.context();
        answer(
          {
            priceScopeIds: [],
            scopes: [],
            coverage,
            approximate: false,
            profileId: 'p1',
            explicit: false,
          },
          chains
        );

        await expect(result).resolves.toMatchObject({ state });
      }
    );

    it('answers null when the scope read fails, rather than guessing a state', async () => {
      const result = api.context();
      httpMock
        .expectOne(`${GATEWAY}/v1/catalog/scope`)
        .flush(null, { status: 500, statusText: 'Error' });
      httpMock
        .expectOne(`${GATEWAY}/v1/catalog/shops/summary`)
        .flush({ chains: [] });
      httpMock
        .expectOne((r) => r.url === `${GATEWAY}/v1/catalog/supermarkets`)
        .flush({ items: [], nextCursor: null });

      await expect(result).resolves.toBeNull();
    });
  });

  describe('one product’s prices', () => {
    const ROW = {
      id: 'si-1',
      itemId: 'item-1',
      priceScopeId: 'scope-m',
      price: 0.89,
      currency: 'EUR',
      unitPrice: 0.89,
      unitPriceLabel: 'EUR/L',
      unitBasis: 'LITER',
      observedAt: '2026-09-20T10:00:00.000Z',
      sourceKind: 'OFFICIAL_API',
      priceCopiedFromScopeId: null,
      stale: false,
      validUntil: null,
      itemPriceId: null,
      available: true,
    };

    it('follows the cursor and keeps whether each row is available', async () => {
      const result = api.scopeOffers('item-1');

      httpMock
        .expectOne((r) => r.url === `${GATEWAY}/v1/catalog/items/item-1/offers`)
        .flush({ items: [ROW], nextCursor: 'next' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const second = httpMock.expectOne(
        (r) => r.url === `${GATEWAY}/v1/catalog/items/item-1/offers`
      );
      expect(second.request.params.get('cursor')).toBe('next');
      second.flush({
        items: [{ ...ROW, priceScopeId: 'scope-d', available: false }],
        nextCursor: null,
      });

      const rows = await result;
      expect(
        rows?.map((row) => [row.offer.priceScopeId, row.available])
      ).toEqual([
        ['scope-m', true],
        ['scope-d', false],
      ]);
    });
  });

  describe('one product’s price history (velista 0134, backend 0196)', () => {
    const FROM = new Date('2026-07-01T00:00:00.000Z');
    const TO = new Date('2026-09-29T00:00:00.000Z');
    const HISTORY = `${GATEWAY}/v1/catalog/items/item-1/price-history`;

    it('asks for the range and no scope, so the profile resolves', async () => {
      const result = api.priceHistory('item-1', FROM, TO);

      const req = httpMock.expectOne((r) => r.url === HISTORY);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('from')).toBe('2026-07-01T00:00:00.000Z');
      expect(req.request.params.get('to')).toBe('2026-09-29T00:00:00.000Z');
      expect(req.request.params.has('priceScopeId')).toBe(false);
      req.flush({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-09-29T00:00:00.000Z',
        series: [
          {
            priceScopeId: 'scope-m',
            supermarketId: 'chain-m',
            points: [
              { at: '2026-07-01T00:00:00.000Z', price: 0.95, unitPrice: 0.95 },
              { at: '2026-08-10T00:00:00.000Z', price: 0.89, unitPrice: 0.89 },
            ],
          },
        ],
      });

      await expect(result).resolves.toEqual({
        from: FROM,
        to: TO,
        series: [
          {
            priceScopeId: 'scope-m',
            supermarketId: 'chain-m',
            points: [
              { at: FROM, price: 0.95, unitPrice: 0.95 },
              {
                at: new Date('2026-08-10T00:00:00.000Z'),
                price: 0.89,
                unitPrice: 0.89,
              },
            ],
          },
        ],
      });
    });

    it('answers null, not an empty history, when the read fails', async () => {
      const result = api.priceHistory('item-1', FROM, TO);

      httpMock
        .expectOne((r) => r.url === HISTORY)
        .flush(null, { status: 503, statusText: 'Unavailable' });

      await expect(result).resolves.toBeNull();
    });
  });
});

describe('CatalogBrowseMemory', () => {
  /** A read of the whole double, priced at one chain's scope or at all three. */
  function read(
    memory: CatalogBrowseMemory,
    overrides: Partial<CatalogBrowseQuery> = {}
  ) {
    return memory.browse(query({ limit: 50, ...overrides }));
  }

  it('narrows to what one chain sells, and prices from the scopes it was given', async () => {
    const memory = new CatalogBrowseMemory();

    const page = await memory.browse({
      query: '',
      order: 'category',
      soldBy: 'chain-deza',
      categoryId: null,
      priceScopeIds: ['scope-chain-deza'],
      locationId: null,
      cursor: null,
      limit: 50,
    });

    expect(page?.items.map((row) => row.id)).not.toContain('item-eggs');
    for (const row of page?.items ?? []) {
      expect([null, 'scope-chain-deza']).toContain(
        row.offer?.priceScopeId ?? null
      );
    }
  });

  it('narrows to a leaf, and to every leaf under a root, as the server does', async () => {
    const memory = new CatalogBrowseMemory();
    const read = (categoryId: string) =>
      memory.browse({
        query: '',
        order: 'category',
        soldBy: null,
        categoryId,
        priceScopeIds: [],
        locationId: null,
        cursor: null,
        limit: 50,
      });

    const milk = await read('cat-milk');
    const dairy = await read('cat-eggs-milk-and-butter');

    expect(milk?.items.map((row) => row.id).sort()).toEqual([
      'item-milk',
      'item-milk-six',
    ]);
    expect(dairy?.items.map((row) => row.id)).toEqual(
      expect.arrayContaining(['item-milk', 'item-eggs', 'item-milk-lactose'])
    );
    expect(dairy?.items).toHaveLength(4);
  });

  it('keeps every product and drops every price when nothing can be priced', async () => {
    const memory = new CatalogBrowseMemory();
    memory.state = 'noPlace';

    const page = await memory.browse({
      query: '',
      order: 'category',
      soldBy: null,
      categoryId: null,
      priceScopeIds: [],
      locationId: null,
      cursor: null,
      limit: 50,
    });

    expect(page?.items.length).toBeGreaterThan(5);
    expect(page?.items.every((row) => row.offer === null)).toBe(true);
  });

  describe('the orders (velista 0134, section 3)', () => {
    // Priced at Mercadona alone, which leaves five of the twelve with no price:
    // three it does not sell, one it sells with none, and one sold nowhere.
    const MERCADONA = { priceScopeIds: ['scope-chain-mercadona'] };

    it('orders by the lowest price, and puts the products with no price last', async () => {
      const page = await read(new CatalogBrowseMemory(), {
        order: 'price',
        ...MERCADONA,
      });

      const rows = page?.items ?? [];
      expect(rows.slice(0, 7).map((row) => [row.id, row.offer?.price])).toEqual(
        [
          ['item-milk', 0.89],
          ['item-sugar', 1.05],
          ['item-yogurt', 1.1],
          ['item-rice', 1.35],
          ['item-eggs', 2.2],
          ['item-tuna', 2.79],
          ['item-oil', 8.45],
        ]
      );
      expect(
        rows
          .slice(7)
          .map((row) => row.id)
          .sort()
      ).toEqual([
        'item-bread',
        'item-coffee',
        'item-gazpacho',
        'item-milk-lactose',
        'item-milk-six',
      ]);
      expect(rows.slice(7).every((row) => row.offer === null)).toBe(true);
    });

    it('takes the lowest price of the scopes it was given', async () => {
      const page = await read(new CatalogBrowseMemory(), { order: 'price' });

      const rice = page?.items.find((row) => row.id === 'item-rice');
      expect(rice?.offer).toMatchObject({
        price: 1.29,
        priceScopeId: 'scope-chain-deza',
      });
      // Only the product no chain sells is left with no price, and it is last.
      expect(page?.items[page.items.length - 1]?.id).toBe('item-gazpacho');
      expect(page?.items.filter((row) => row.offer === null)).toHaveLength(1);
    });

    it('orders by the lowest unit price, and puts the products with none last', async () => {
      const page = await read(new CatalogBrowseMemory(), {
        order: 'unitPrice',
        ...MERCADONA,
      });

      const rows = page?.items ?? [];
      // Not the order of the prices: the tuna is cheap by the tin and dear by
      // the kilo. The eggs and the yogurt cost the same and fall to the name.
      expect(rows.slice(0, 7).map((row) => row.id)).toEqual([
        'item-milk',
        'item-sugar',
        'item-rice',
        'item-eggs',
        'item-yogurt',
        'item-oil',
        'item-tuna',
      ]);
      const unitPrices = rows.slice(0, 7).map((row) => row.offer?.unitPrice);
      expect(unitPrices).toEqual(
        [...unitPrices].sort((a, b) => (a ?? 0) - (b ?? 0))
      );
      expect(
        rows.slice(7).every((row) => (row.offer?.unitPrice ?? null) === null)
      ).toBe(true);
      expect(rows).toHaveLength(12);
    });

    it('orders by category, then by name', async () => {
      const page = await read(new CatalogBrowseMemory(), { order: 'category' });

      expect(
        page?.items.map((row) => [row.categories[0]?.slug, row.id])
      ).toEqual([
        ['eggs', 'item-eggs'],
        ['gazpachos-and-salmorejos', 'item-gazpacho'],
        ['ground-coffee', 'item-coffee'],
        ['lactose-free-and-fortified-milk', 'item-milk-lactose'],
        ['milk', 'item-milk'],
        ['milk', 'item-milk-six'],
        ['natural-and-skimmed-yogurts', 'item-yogurt'],
        ['oils', 'item-oil'],
        ['rice', 'item-rice'],
        ['sliced-and-specialty-breads', 'item-bread'],
        ['sugar-honey-and-sweeteners', 'item-sugar'],
        ['tuna-and-bonito', 'item-tuna'],
      ]);
    });
  });

  describe('the price history', () => {
    const FROM = new Date('2026-07-01T00:00:00.000Z');
    const TO = new Date('2026-09-29T00:00:00.000Z');

    it('answers one series for each chain that prices the product, oldest point first', async () => {
      const history = await new CatalogBrowseMemory().priceHistory(
        'item-milk',
        FROM,
        TO
      );

      expect(history?.from).toEqual(FROM);
      expect(history?.to).toEqual(TO);
      expect(
        history?.series.map((series) => [
          series.priceScopeId,
          series.supermarketId,
        ])
      ).toEqual([
        ['scope-chain-mercadona', 'chain-mercadona'],
        ['scope-chain-deza', 'chain-deza'],
      ]);
      for (const series of history?.series ?? []) {
        const times = series.points.map((point) => point.at.getTime());
        expect(times[0]).toBe(FROM.getTime());
        expect(times).toEqual([...times].sort((a, b) => a - b));
        expect(times.every((at) => at <= TO.getTime())).toBe(true);
      }
    });

    it('ends each series on the price the chain shows today', async () => {
      const history = await new CatalogBrowseMemory().priceHistory(
        'item-milk',
        FROM,
        TO
      );

      expect(
        history?.series.map((series) =>
          series.points.map((point) => point.price)
        )
      ).toEqual([
        [0.94, 0.86, 0.89],
        [1.01, 0.92, 0.95],
      ]);
    });

    it('moves the chains on different days, so the lines do not step together', async () => {
      const history = await new CatalogBrowseMemory().priceHistory(
        'item-milk',
        FROM,
        TO
      );

      const [mercadona, deza] = history?.series ?? [];
      expect(mercadona?.points[1]?.at).not.toEqual(deza?.points[1]?.at);
      expect(mercadona?.points[2]?.at).not.toEqual(deza?.points[2]?.at);
    });

    it('answers one point with no price for a chain that stocks it with none', async () => {
      const history = await new CatalogBrowseMemory().priceHistory(
        'item-bread',
        FROM,
        TO
      );

      const mercadona = history?.series.find(
        (series) => series.supermarketId === 'chain-mercadona'
      );
      expect(mercadona?.points).toEqual([
        { at: FROM, price: null, unitPrice: null },
      ]);
    });

    it('answers the range and no series for a product it does not hold', async () => {
      await expect(
        new CatalogBrowseMemory().priceHistory('item-nowhere', FROM, TO)
      ).resolves.toEqual({ from: FROM, to: TO, series: [] });
    });

    it('answers no series when nothing can be priced', async () => {
      const memory = new CatalogBrowseMemory();
      memory.state = 'noPlace';

      await expect(memory.priceHistory('item-milk', FROM, TO)).resolves.toEqual(
        { from: FROM, to: TO, series: [] }
      );
    });
  });
});
