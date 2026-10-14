import type {
  BasketListRef,
  BasketPriceScope,
  BasketRow,
  BasketRowEntry,
  CatalogItem,
} from '@portfolio/velista/models';
import {
  basketProductOf,
  chainOfShop,
  changeableLineIds,
  changePriceScopes,
  changeSheetPath,
} from './change-targets';

function entry(
  lineId: string,
  overrides: Partial<BasketRowEntry> = {}
): BasketRowEntry {
  return {
    lineId,
    listId: 'l-home',
    content: 'Milk',
    itemIds: ['item-milk'],
    favoriteItemId: null,
    canWrite: true,
    tripItemId: null,
    skipped: false,
    closed: false,
    act: null,
    left: 1,
    bought: 0,
    asked: 1,
    boughtElsewhere: 0,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    ...overrides,
  };
}

function row(
  entries: readonly BasketRowEntry[],
  overrides: Partial<BasketRow> = {}
): BasketRow {
  return {
    rowKey: entries[0]?.lineId ?? 'zl-1',
    content: 'Milk',
    left: 1,
    bought: 0,
    asked: 1,
    boughtElsewhere: 0,
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    productId: 'item-milk',
    touchedBy: null,
    touchedAt: null,
    usual: null,
    entries,
    ...overrides,
  };
}

const LISTS = new Map<string, BasketListRef>([
  ['l-home', { listId: 'l-home', name: 'Home', zoneId: 'z', zoneName: 'Z' }],
]);
const READER = { guest: false, finished: false, lists: LISTS };

describe('changeableLineIds', () => {
  it('names the entries the reader may edit on a list they were served', () => {
    const held = row([
      entry('zl-1'),
      entry('zl-2', { canWrite: false }),
      entry('zl-3', { listId: null }),
      entry('zl-4', { listId: 'l-unknown' }),
    ]);

    expect(changeableLineIds(held, READER)).toEqual(['zl-1']);
  });

  it('names none for a guest or once the trip is over', () => {
    const held = row([entry('zl-1')]);

    expect(changeableLineIds(held, { ...READER, guest: true })).toEqual([]);
    expect(changeableLineIds(held, { ...READER, finished: true })).toEqual([]);
  });

  it('names none for a row with no product', () => {
    expect(
      changeableLineIds(row([entry('zl-1')], { productId: null }), READER)
    ).toEqual([]);
  });

  it('names none on a crossed out row, and leaves out an entry bought elsewhere', () => {
    expect(
      changeableLineIds(
        row([entry('zl-1')], { state: 'BOUGHT_ELSEWHERE' }),
        READER
      )
    ).toEqual([]);
    expect(
      changeableLineIds(
        row([entry('zl-1'), entry('zl-2', { state: 'BOUGHT_ELSEWHERE' })]),
        READER
      )
    ).toEqual(['zl-1']);
  });
});

describe('changeSheetPath', () => {
  it('addresses one line or all of them under the sheet marker', () => {
    expect(changeSheetPath('en', '', 'live', 'zl-1', 'zl-2')).toBe(
      '/en/shopping-lists/live/sheet/rows/zl-1/change/zl-2'
    );
    expect(changeSheetPath('es', '/velista', 'live', 'zl-1', null)).toBe(
      '/velista/es/shopping-lists/live/sheet/rows/zl-1/change'
    );
  });
});

function scope(
  priceScopeId: string,
  supermarketId: string,
  shopIds: readonly string[]
): BasketPriceScope {
  return {
    priceScopeId,
    supermarketId,
    logoUrl: null,
    supermarketName: { en: supermarketId, es: supermarketId },
    locations: shopIds.map((id) => ({
      id,
      label: null,
      address: null,
      city: null,
      postalCode: null,
      sections: [],
    })),
  } as BasketPriceScope;
}

describe('changePriceScopes and chainOfShop', () => {
  const scopes = new Map([
    ['s-dia', scope('s-dia', 'dia', ['shop-dia'])],
    ['s-merc', scope('s-merc', 'mercadona', ['shop-merc'])],
  ]);

  it('prices at every scope of the basket with no shop', () => {
    expect(changePriceScopes(scopes, null)).toEqual(['s-dia', 's-merc']);
    expect(chainOfShop(scopes, null)).toBeNull();
  });

  it('prices at the scopes of the shop the basket is read at, and names its chain', () => {
    expect(changePriceScopes(scopes, 'shop-merc')).toEqual(['s-merc']);
    expect(chainOfShop(scopes, 'shop-merc')).toBe('mercadona');
  });

  it('prices at every scope for a shop no scope names', () => {
    expect(changePriceScopes(scopes, 'shop-x')).toEqual(['s-dia', 's-merc']);
    expect(chainOfShop(scopes, 'shop-x')).toBeNull();
  });
});

describe('basketProductOf', () => {
  const item = {
    id: 'item-oat',
    name: { en: 'Oat drink', es: 'Bebida de avena' },
    brand: 'Hacendado',
    size: 1,
    unit: 'LITER',
    productGroupId: null,
    categories: [],
    offer: null,
    chainPrices: [],
    imageUrl: null,
    packCount: null,
    unitBasis: null,
  } as CatalogItem;
  const offer = {
    price: 1.1,
    currency: 'EUR',
    unitPrice: 1.1,
    unitPriceLabel: null,
    observedAt: null,
    sourceKind: 'OFFICIAL_WEB' as const,
    stale: false,
    priceScopeId: 's-merc',
  };

  it('draws the price the sheet showed as the basket offer', () => {
    expect(basketProductOf(item, offer, false)).toMatchObject({
      id: 'item-oat',
      brand: 'Hacendado',
      offer,
      offers: [offer],
      atShop: null,
      sectionIds: null,
    });
  });

  it('draws it as the price of the shop when the basket is read at one', () => {
    expect(basketProductOf(item, offer, true).atShop).toEqual({
      priceScopeId: 's-merc',
      price: 1.1,
      currency: 'EUR',
      available: null,
    });
    expect(basketProductOf(item, null, true).atShop?.price).toBeNull();
  });
});
