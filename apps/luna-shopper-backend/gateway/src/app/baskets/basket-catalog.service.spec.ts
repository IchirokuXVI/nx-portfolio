import {
  ITEM_PATTERNS,
  PriceSourceKind,
  SUPERMARKET_LOCATION_PATTERNS,
  SUPERMARKET_PATTERNS,
  UnitOfMeasure,
  type BasketView,
  type CatalogScopeView,
  type ItemOfferView,
  type ItemView,
  type ResolvedScopeView,
  type SearchShopsRequest,
  type ShopView,
} from '@portfolio/luna-shopper/contracts';
import { CatalogSuggestService } from '../catalog/catalog-suggest.service';
import type { ShopperSelection } from '../catalog/scope-resolution.service';
import { BasketCatalogService } from './basket-catalog.service';

/**
 * The scopes of a basket read are the profile's, not the products' (plan
 * 0213).
 *
 * The shop picker reads `scopes` alone, so a chain that quotes nothing on
 * this basket must still be in it, flagged, and the shops of each scope are
 * the ones in the profile's postal codes, so two reads of one basket give one
 * count whatever its rows hold.
 */

const OWNER = 'u-owner';
const PROFILE = 'prof-home';
const MERCADONA = 'scope-mercadona';
/** A Lidl shop's own scope, which quotes nothing on this basket. */
const LIDL_STORE = 'scope-lidl-store';
/** The Lidl region above it, not quoted for the shop. */
const LIDL_REGION = 'scope-lidl-region';

const offer = (itemId: string, priceScopeId: string): ItemOfferView => ({
  itemId,
  priceScopeId,
  price: 1,
  currency: 'EUR',
  unitPrice: 1,
  unitPriceLabel: 'L',
  unitBasis: 'LITER',
  observedAt: '2026-10-16T10:00:00.000Z',
  sourceKind: PriceSourceKind.OFFICIAL_WEB,
  priceCopiedFromScopeId: null,
  stale: false,
});

const item = (id: string, scopes: string[]): ItemView => ({
  id,
  name: { en: id, es: id },
  brand: null,
  imageUrl: null,
  imageSource: null,
  imageSupermarketId: null,
  ownImageUrl: null,
  images: [],
  sku: null,
  ean: null,
  eans: [],
  unitSize: 1,
  categories: [],
  defaultUnit: UnitOfMeasure.LITER,
  productGroupId: null,
  bestOffer: scopes.length > 0 ? offer(id, scopes[0]) : null,
  offers: scopes.map((scope) => offer(id, scope)),
});

const resolved = (
  priceScopeId: string,
  supermarketId: string,
  quoted: boolean
): ResolvedScopeView => ({
  priceScopeId,
  supermarketId,
  postalCode: '14008',
  origin: 'POSTAL_CODE',
  approximate: false,
  supermarketLocationId: null,
  priority: 0,
  quoted,
  priced: quoted,
});

/** Mercadona, and a Lidl shop's stack: its empty STORE scope over a region. */
const resolution = (): CatalogScopeView => ({
  priceScopeIds: [MERCADONA, LIDL_STORE],
  scopes: [
    resolved(MERCADONA, 'mercadona', true),
    resolved(LIDL_STORE, 'lidl', true),
    resolved(LIDL_REGION, 'lidl', false),
  ],
  coverage: [{ postalCode: '14008', served: true }],
  approximate: false,
  profileId: PROFILE,
  explicit: false,
});

const selection = (): ShopperSelection => ({
  profileId: PROFILE,
  postalCodes: ['14008'],
  excludedSupermarketIds: [],
  excludedSupermarketLocationIds: [],
});

const shop = (
  id: string,
  supermarketId: string,
  postalCode: string,
  priceScopeIds: string[]
): ShopView =>
  ({
    location: {
      id,
      supermarketId,
      priceScopeId: priceScopeIds[0],
      priceScopeIds,
      label: null,
      address: `${id} street`,
      city: 'Córdoba',
      country: 'ES',
      postalCode,
      postalCodeSource: null,
      latitude: null,
      longitude: null,
      externalRef: null,
      externalProvider: null,
      footprintM2: null,
      sections: [],
      hasMap: false,
    },
    supermarket: { id: supermarketId, name: { en: supermarketId } },
    excluded: false,
    excludedChain: false,
  }) as unknown as ShopView;

/** Every shop catalog holds, in and out of the profile's codes. */
const SHOPS: ShopView[] = [
  shop('loc-mercadona', 'mercadona', '14008', [MERCADONA]),
  shop('loc-lidl-1', 'lidl', '14008', [LIDL_STORE, LIDL_REGION]),
  shop('loc-lidl-2', 'lidl', '14008', ['scope-lidl-store-2', LIDL_REGION]),
  // The same region, in a code the profile does not hold.
  shop('loc-lidl-far', 'lidl', '28001', ['scope-lidl-far', LIDL_REGION]),
];

interface World {
  /** The products of the basket's rows, as catalog prices them. */
  readonly items: ItemView[];
  /** Which question throws. */
  readonly throws?: 'chains' | 'shops' | 'resolution';
  /**
   * How many pages the shop search answers before its last, each with a
   * cursor to the next. Absent for one page holding every shop.
   */
  readonly shopPages?: number;
}

function build(world: World) {
  const calls: { subject: string; payload: unknown }[] = [];
  const send = jest.fn(async (subject: string, payload: unknown) => {
    calls.push({ subject, payload });
    switch (subject) {
      case ITEM_PATTERNS.getMany:
        return {
          items: world.items.filter((found) =>
            (payload as { ids: string[] }).ids.includes(found.id)
          ),
        };
      case SUPERMARKET_PATTERNS.list:
        if (world.throws === 'chains') {
          throw new Error('catalog slow');
        }
        return {
          items: ['mercadona', 'lidl'].map((id) => ({
            id,
            name: { en: id, es: id },
            logoUrl: null,
          })),
          nextCursor: null,
        };
      case SUPERMARKET_LOCATION_PATTERNS.search: {
        if (world.throws === 'shops') {
          throw new Error('catalog slow');
        }
        // Catalog narrows by postal code, as `summarizeByChain` does.
        const req = payload as SearchShopsRequest;
        const found = SHOPS.filter((each) =>
          req.postalCodes.includes(each.location.postalCode ?? '')
        );
        if (world.shopPages === undefined) {
          return { items: found, nextCursor: null };
        }
        // One shop a page, and a cursor on each of the first `shopPages`.
        const page = req.cursor ? Number(req.cursor) : 0;
        return {
          items: [found[page % found.length]],
          nextCursor: page + 1 < world.shopPages ? String(page + 1) : null,
        };
      }
      default:
        throw new Error(`unexpected subject ${subject}`);
    }
  });
  const scopes = {
    describe: jest.fn(async () => {
      if (world.throws === 'resolution') {
        throw new Error('core slow');
      }
      return resolution();
    }),
    forShops: jest.fn(async () => selection()),
  };
  const catalog = new BasketCatalogService(
    { send } as never,
    scopes as never,
    new CatalogSuggestService({ send } as never)
  );
  return { catalog, calls };
}

/** A basket whose rows name these products, read by its owner. */
const basket = (productIds: string[]): BasketView =>
  ({
    id: 'b-1',
    supermarketLocationId: null,
    servesLocations: true,
    rows: productIds.map((productId) => ({ productId })),
  }) as unknown as BasketView;

const SEARCH_SCOPE = {
  ownerUserId: OWNER,
  profileId: PROFILE,
  servesLocations: true,
  supermarketLocationId: null,
};

async function read(
  world: World,
  productIds: string[],
  /** What core answered `basket.searchScope` with, null when it failed. */
  searchScope: object | null = SEARCH_SCOPE
) {
  const { catalog, calls } = build(world);
  const answer = await catalog.compose(
    basket(productIds),
    'p-owner',
    undefined,
    searchScope as never
  );
  return { answer, calls };
}

const shopIds = (scope: { locations: { supermarketLocationId: string }[] }) =>
  scope.locations.map((location) => location.supermarketLocationId);

describe('a basket read names every scope of the profile (plan 0213)', () => {
  it('names a Lidl scope that quotes no product of the basket, with quotesBasket false', async () => {
    const { answer } = await read({ items: [item('i-milk', [MERCADONA])] }, [
      'i-milk',
    ]);

    const lidl = answer.scopes.find((s) => s.priceScopeId === LIDL_STORE);
    expect(lidl).toEqual(
      expect.objectContaining({ supermarketId: 'lidl', quotesBasket: false })
    );
    expect(answer.scopes.map((s) => s.supermarketId)).toContain('lidl');
    expect(answer.scopesIncomplete).toBe(false);
  });

  it('flags a scope that quotes one product with quotesBasket true', async () => {
    const { answer } = await read({ items: [item('i-milk', [MERCADONA])] }, [
      'i-milk',
    ]);

    const mercadona = answer.scopes.find((s) => s.priceScopeId === MERCADONA);
    expect(mercadona?.quotesBasket).toBe(true);
  });

  it('lists the shops of a scope inside the profile’s postal codes, whatever the rows hold', async () => {
    const first = await read({ items: [item('i-milk', [MERCADONA])] }, [
      'i-milk',
    ]);
    // The same basket after its rows changed: a product nothing quotes.
    const second = await read({ items: [item('i-salt', [])] }, ['i-salt']);

    for (const { answer } of [first, second]) {
      const region = answer.scopes.find((s) => s.priceScopeId === LIDL_REGION);
      // Both Lidl shops in 14008, and not the one in Madrid.
      expect(region && shopIds(region)).toEqual(['loc-lidl-1', 'loc-lidl-2']);
      const store = answer.scopes.find((s) => s.priceScopeId === LIDL_STORE);
      expect(store && shopIds(store)).toEqual(['loc-lidl-1']);
    }
    expect(
      first.answer.scopes.map((s) => [s.priceScopeId, shopIds(s)])
    ).toEqual(
      expect.arrayContaining(
        second.answer.scopes.map((s) => [s.priceScopeId, shopIds(s)])
      )
    );
    expect(first.answer.scopes).toHaveLength(second.answer.scopes.length);
    // Asked by the profile's codes, the source the supermarkets page counts.
    const searches = first.calls.filter(
      (call) => call.subject === SUPERMARKET_LOCATION_PATTERNS.search
    );
    expect(searches).toHaveLength(1);
    expect(searches[0].payload).toEqual(
      expect.objectContaining({ userId: OWNER, postalCodes: ['14008'] })
    );
  });

  it.each(['chains', 'shops'] as const)(
    'answers scopes [] and scopesIncomplete true when the %s lookup throws',
    async (throws) => {
      const { answer } = await read(
        { items: [item('i-milk', [MERCADONA])], throws },
        ['i-milk']
      );

      expect(answer.scopes).toEqual([]);
      expect(answer.scopesIncomplete).toBe(true);
      // The products and their prices are still the answer.
      expect(answer.products.map((p) => p.id)).toEqual(['i-milk']);
    }
  );

  it('keeps the shops it listed and says scopesIncomplete when a cursor is left after the last page', async () => {
    // Six pages: the read asks for five and is still handed a cursor.
    const { answer, calls } = await read(
      { items: [item('i-milk', [MERCADONA])], shopPages: 6 },
      ['i-milk']
    );

    expect(
      calls.filter(
        (call) => call.subject === SUPERMARKET_LOCATION_PATTERNS.search
      )
    ).toHaveLength(5);
    expect(answer.scopesIncomplete).toBe(true);
    // The scopes and the shops of the pages read are kept.
    expect(answer.scopes.map((s) => s.priceScopeId)).toEqual(
      expect.arrayContaining([MERCADONA, LIDL_STORE])
    );
    const mercadona = answer.scopes.find((s) => s.priceScopeId === MERCADONA);
    expect(mercadona && shopIds(mercadona)).toContain('loc-mercadona');
  });

  it('says scopesIncomplete false when the last page carries no cursor', async () => {
    const { answer } = await read(
      { items: [item('i-milk', [MERCADONA])], shopPages: 5 },
      ['i-milk']
    );

    expect(answer.scopesIncomplete).toBe(false);
  });

  it('says scopesIncomplete true when the resolution of the profile throws', async () => {
    const { answer } = await read(
      { items: [item('i-milk', [MERCADONA])], throws: 'resolution' },
      ['i-milk']
    );

    expect(answer.scopes).toEqual([]);
    expect(answer.scopesIncomplete).toBe(true);
  });

  it('says scopesIncomplete true when core could not answer basket.searchScope', async () => {
    const { answer } = await read(
      { items: [item('i-milk', [MERCADONA])] },
      ['i-milk'],
      null
    );

    expect(answer.scopes).toEqual([]);
    expect(answer.scopesIncomplete).toBe(true);
  });

  it('says scopesIncomplete false for a basket with no profile', async () => {
    const { answer, calls } = await read(
      { items: [item('i-milk', [MERCADONA])] },
      ['i-milk'],
      { ...SEARCH_SCOPE, profileId: null }
    );

    expect(answer.scopes).toEqual([]);
    expect(answer.scopesIncomplete).toBe(false);
    expect(
      calls.some(
        (call) => call.subject === SUPERMARKET_LOCATION_PATTERNS.search
      )
    ).toBe(false);
  });
});
