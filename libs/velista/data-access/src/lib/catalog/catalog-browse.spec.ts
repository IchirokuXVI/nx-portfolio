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
  category: 'DAIRY',
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
    order: 'name',
    soldBy: null,
    priceScopeIds: [],
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
            category: 'DAIRY',
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

    it('sends no query and no selectors for a blank read, so the profile resolves', async () => {
      const result = api.browse(query({ query: '   ' }));

      const req = httpMock.expectOne(
        (r) => r.url === `${GATEWAY}/v1/catalog/items`
      );
      expect(req.request.params.has('query')).toBe(false);
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
});

describe('CatalogBrowseMemory', () => {
  it('narrows to what one chain sells, and prices from the scopes it was given', async () => {
    const memory = new CatalogBrowseMemory();

    const page = await memory.browse({
      query: '',
      order: 'name',
      soldBy: 'chain-deza',
      priceScopeIds: ['scope-chain-deza'],
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

  it('keeps every product and drops every price when nothing can be priced', async () => {
    const memory = new CatalogBrowseMemory();
    memory.state = 'noPlace';

    const page = await memory.browse({
      query: '',
      order: 'name',
      soldBy: null,
      priceScopeIds: [],
      cursor: null,
      limit: 50,
    });

    expect(page?.items.length).toBeGreaterThan(5);
    expect(page?.items.every((row) => row.offer === null)).toBe(true);
  });
});
