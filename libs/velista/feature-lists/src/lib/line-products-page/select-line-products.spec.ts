import {
  LINE_ITEM_SET_MAX,
  type CatalogItem,
  type Line,
  type ProductGroup,
} from '@portfolio/velista/models';
import {
  PRODUCTS_COUNTER_FROM,
  selectLineProducts,
  type LineProductsInput,
} from './select-line-products';

/**
 * What the products page of a line says (velista `0135`, section 3), asserted
 * against the function that decides it.
 */

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'ln-1',
    listId: 'list-1',
    content: 'Shampoo',
    quantity: 3,
    itemIds: ['normal', 'classic', 'dandruff'],
    productGroupId: null,
    groupItemIds: [],
    favoriteItemId: null,
    preferredSupermarketId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    claimed: false,
    claimedByUserId: null,
    createdByUserId: 'user-me',
    approvedByUserId: null,
    version: 1,
    ...overrides,
  };
}

function item(id: string, en: string): CatalogItem {
  return {
    id,
    name: { en, es: '' },
    brand: 'Deliplus',
    size: 400,
    unit: 'MILLILITER',
    imageUrl: null,
  } as unknown as CatalogItem;
}

const CATALOG: Record<string, CatalogItem> = {
  normal: item('normal', 'Shampoo for normal hair'),
  classic: item('classic', 'Classic care shampoo'),
  dandruff: item('dandruff', 'Anti dandruff shampoo'),
};

const SHAMPOOS: ProductGroup = {
  id: 'group-shampoo',
  name: { en: 'Shampoos', es: 'Champús' },
} as ProductGroup;

function input(overrides: Partial<LineProductsInput> = {}): LineProductsInput {
  return {
    line: line(),
    itemNameOf: (itemId) => CATALOG[itemId] ?? null,
    namesUnavailable: false,
    groupNameOf: (groupId) => (groupId === SHAMPOOS.id ? SHAMPOOS : null),
    locale: 'en',
    canEdit: true,
    translate: (key, args) =>
      args === undefined ? key : `${key} ${JSON.stringify(args)}`,
    ...overrides,
  };
}

describe('selectLineProducts', () => {
  it('answers null with no line', () => {
    expect(selectLineProducts(input({ line: undefined }))).toBeNull();
  });

  it('draws one run with no heading on a line that follows no group', () => {
    const view = selectLineProducts(input());

    expect(view?.groups).toHaveLength(1);
    expect(view?.groups[0].headingKey).toBeNull();
    expect(view?.groups[0].rows.map((row) => row.itemId)).toEqual([
      'normal',
      'classic',
      'dandruff',
    ]);
    expect(view?.groups[0].rows.every((row) => !row.adoptable)).toBe(true);
  });

  it('splits a line that follows a group, the catalog side first', () => {
    const view = selectLineProducts(
      input({
        line: line({
          productGroupId: SHAMPOOS.id,
          groupItemIds: ['dandruff'],
        }),
      })
    );

    expect(view?.groups.map((group) => group.headingKey)).toEqual([
      'list.products.fromGroup',
      'list.products.addedByYou',
    ]);
    expect(view?.groups[0].headingArgs).toEqual({ name: 'Shampoos' });
    expect(view?.groups[0].rows).toMatchObject([
      { itemId: 'dandruff', source: 'group', adoptable: true },
    ]);
    expect(view?.groups[1].rows.map((row) => row.itemId)).toEqual([
      'normal',
      'classic',
    ]);
  });

  it('says "From a group" for a group nobody can name, never "From "', () => {
    const view = selectLineProducts(
      input({
        line: line({ productGroupId: 'group-gone', groupItemIds: ['normal'] }),
      })
    );

    expect(view?.groups[0].headingKey).toBe('list.products.fromGroupUnnamed');
    expect(view?.groups[0].headingArgs).toEqual({});
  });

  it('leaves out an empty cluster', () => {
    const view = selectLineProducts(
      input({
        line: line({
          productGroupId: SHAMPOOS.id,
          groupItemIds: ['normal', 'classic', 'dandruff'],
        }),
      })
    );

    expect(view?.groups.map((group) => group.source)).toEqual(['group']);
  });

  it('marks the favourite, and only it', () => {
    const view = selectLineProducts(
      input({ line: line({ favoriteItemId: 'classic' }) })
    );

    expect(view?.groups[0].rows.map((row) => row.favorite)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('offers Keep to nobody who may not edit', () => {
    const view = selectLineProducts(
      input({
        canEdit: false,
        line: line({ productGroupId: SHAMPOOS.id, groupItemIds: ['normal'] }),
      })
    );

    expect(view?.canEdit).toBe(false);
    expect(view?.groups[0].rows[0].adoptable).toBe(false);
  });

  it('is empty, with no run, on a line of free text', () => {
    const view = selectLineProducts(input({ line: line({ itemIds: [] }) }));

    expect(view?.empty).toBe(true);
    expect(view?.groups).toEqual([]);
    expect(view?.namesUnavailable).toBe(false);
  });

  describe('the counter', () => {
    const ids = (count: number): string[] =>
      Array.from({ length: count }, (_, index) => `item-${index}`);

    it('is absent on a line far from the cap', () => {
      expect(selectLineProducts(input())?.counter).toBeNull();
    });

    it('is drawn from ninety products up, with neither number clamped', () => {
      const near = selectLineProducts(
        input({ line: line({ itemIds: ids(PRODUCTS_COUNTER_FROM) }) })
      );
      const over = selectLineProducts(
        input({ line: line({ itemIds: ids(LINE_ITEM_SET_MAX + 4) }) })
      );

      expect(near?.counter).toEqual({
        count: PRODUCTS_COUNTER_FROM,
        cap: LINE_ITEM_SET_MAX,
        overCap: false,
      });
      expect(over?.counter).toEqual({
        count: LINE_ITEM_SET_MAX + 4,
        cap: LINE_ITEM_SET_MAX,
        overCap: true,
      });
    });
  });
});
