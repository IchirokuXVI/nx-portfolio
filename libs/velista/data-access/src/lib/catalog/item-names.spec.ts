import { TestBed } from '@angular/core/testing';
import {
  ITEM_LOOKUP_MAX_IDS,
  type CatalogItem,
  type ProductOffer,
} from '@portfolio/velista/models';
import {
  CATALOG_SERVICE,
  type CatalogServiceI,
  type ItemLookupOptions,
} from './catalog-service';
import { ItemNames } from './item-names';

function product(id: string): CatalogItem {
  return {
    id,
    name: { es: id, en: id },
    brand: null,
    size: null,
    unit: 'UNIT',
    productGroupId: null,
    categories: [
      {
        id: 'cat-milk',
        parentId: 'cat-eggs-milk-and-butter',
        slug: 'milk',
        name: { en: 'Milk', es: 'Leche' },
      },
    ],
    offer: null,
    unitBasis: null,
    chainPrices: [
      {
        chain: {
          id: 'chain-mercadona',
          name: { en: 'Mercadona', es: 'Mercadona' },
        },
        offer: {
          price: 1.5,
          currency: 'EUR',
          unitPrice: null,
          unitPriceLabel: null,
          observedAt: null,
          sourceKind: 'CATALOG',
          stale: false,
          priceScopeId: 'scope-1',
        } as unknown as ProductOffer,
      },
    ],
    imageUrl: null,
    packCount: null,
  } as CatalogItem;
}

/** A catalog that records every request and answers each id it was asked for. */
function setup(
  fail: (ids: readonly string[]) => boolean = () => false,
  known: (id: string) => boolean = () => true
) {
  const requests: string[][] = [];
  const options: (ItemLookupOptions | undefined)[] = [];
  const catalog: Partial<CatalogServiceI> = {
    itemsByIds: async (ids, asked) => {
      requests.push([...ids]);
      options.push(asked);
      return fail(ids) ? null : ids.filter(known).map(product);
    },
  };

  TestBed.configureTestingModule({
    providers: [ItemNames, { provide: CATALOG_SERVICE, useValue: catalog }],
  });

  return { names: TestBed.inject(ItemNames), requests, options };
}

function ids(count: number, prefix = 'item'): string[] {
  return Array.from({ length: count }, (_, at) => `${prefix}-${at}`);
}

describe('ItemNames.ensure', () => {
  /**
   * Velista `0082`, section 3: the zone list page asks for every line's products at
   * once, and the gateway refuses a lookup naming more than its cap.
   */
  it('splits a set larger than the lookup cap into requests the gateway accepts', async () => {
    const { names, requests } = setup();
    const wanted = ids(ITEM_LOOKUP_MAX_IDS * 2 + 1);

    await names.ensure(wanted);

    expect(requests.map((request) => request.length)).toEqual([
      ITEM_LOOKUP_MAX_IDS,
      ITEM_LOOKUP_MAX_IDS,
      1,
    ]);
    expect(requests.flat()).toEqual(wanted);
    expect(
      names.nameOf(wanted[wanted.length - 1])?.categories.map((one) => one.slug)
    ).toEqual(['milk']);
  });

  it('asks one request for a set at the cap', async () => {
    const { names, requests } = setup();

    await names.ensure(ids(ITEM_LOOKUP_MAX_IDS));

    expect(requests).toHaveLength(1);
  });

  it('asks only for ids nothing is known about', async () => {
    const { names, requests } = setup();

    await names.ensure(['a', 'b']);
    await names.ensure(['a', 'b', 'c']);

    expect(requests).toEqual([['a', 'b'], ['c']]);
  });

  it('marks only the chunk that failed, and resolves the rest', async () => {
    const wanted = ids(ITEM_LOOKUP_MAX_IDS + 2);
    const { names } = setup((request) => request.includes(wanted[0]));

    await names.ensure(wanted);

    expect(names.anyFailed([wanted[0]])).toBe(true);
    expect(names.anyFailed(wanted.slice(ITEM_LOOKUP_MAX_IDS))).toBe(false);
    expect(names.nameOf(wanted[ITEM_LOOKUP_MAX_IDS])).not.toBeNull();
  });
});

describe('ItemNames prices (velista 0145, section 7)', () => {
  it('asks the lookup for the prices, in every chunk', async () => {
    const { names, options } = setup();

    await names.ensure(ids(ITEM_LOOKUP_MAX_IDS + 1));

    expect(options).toEqual([{ prices: true }, { prices: true }]);
  });

  it('answers the price of each chain, nothing while out, and none for a gone product', async () => {
    const { names } = setup(undefined, (id) => id !== 'gone');

    expect(names.pricesOf('a')).toBeUndefined();
    expect(names.settled('a')).toBe(false);

    await names.ensure(['a', 'gone']);

    expect(names.pricesOf('a')).toEqual([
      expect.objectContaining({
        supermarketId: 'chain-mercadona',
        kind: 'priced',
      }),
    ]);
    expect(names.pricesOf('gone')).toEqual([]);
    expect(names.settled('a')).toBe(true);
    expect(names.settled('gone')).toBe(true);
  });

  it('answers null for a product whose read failed', async () => {
    const { names } = setup(() => true);

    await names.ensure(['a']);

    expect(names.pricesOf('a')).toBeNull();
    expect(names.settled('a')).toBe(true);
  });

  it('reads a product again on refresh, though it was read before', async () => {
    const { names, requests } = setup();

    await names.ensure(['a', 'b']);
    await names.refresh(['a', 'b']);

    expect(requests).toEqual([
      ['a', 'b'],
      ['a', 'b'],
    ]);
  });

  it('keeps what an earlier read answered when a refresh fails', async () => {
    let failing = false;
    const { names } = setup(() => failing);

    await names.ensure(['a']);
    failing = true;
    await names.refresh(['a', 'b']);

    expect(names.nameOf('a')).not.toBeNull();
    expect(names.anyFailed(['a'])).toBe(false);
    expect(names.anyFailed(['b'])).toBe(true);
  });
});
