import type {
  CatalogItem,
  Line,
  LinePageVm,
  LineSettlement,
  ProductGroup,
  ShoppingListSummary,
} from '@portfolio/velista/models';
import { selectLinePage, type LinePageInput } from './select-line-page';

/**
 * What the line page says, asserted against the function that decides it.
 *
 * The other half of velista plan `0047` section 7. Three of the things this holds are
 * absences, and an absence is exactly what a refactor removes without noticing: the
 * cross list section is **null** rather than empty on a line with no products, `alsoOn`
 * is **null** rather than empty when nobody has asked, and `hasMore` is false because
 * there is no further page rather than because nobody wired it.
 */

const ME = 'user-me';
const LIST_ID = 'list-1';
const DAY = 86_400_000;
const NOW = new Date('2026-09-01T10:00:00.000Z').getTime();

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'ln-1',
    listId: LIST_ID,
    content: 'Milk',
    quantity: 2,
    itemIds: ['item-milk-a'],
    productGroupId: null,
    groupItemIds: [],
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    createdByUserId: ME,
    approvedByUserId: ME,
    version: 1,
    ...overrides,
  };
}

function list(): ShoppingListSummary {
  return {
    id: LIST_ID,
    zoneId: 'zone-1',
    name: 'Weekly shop',
    createdByUserId: ME,
    autoApproveLines: false,
    lineCount: 12,
    wantedCount: 7,
    myPermissions: ['READ', 'WRITE', 'DECIDE', 'MANAGE'],
  };
}

function bought(
  daysAgo: number,
  overrides: Partial<LineSettlement> = {}
): LineSettlement {
  return {
    id: `st-${daysAgo}`,
    lineId: 'ln-1',
    listId: LIST_ID,
    outcome: 'BOUGHT',
    quantity: 1,
    itemId: null,
    settledByUserId: ME,
    settledAt: new Date(NOW - daysAgo * DAY),
    ...overrides,
  };
}

const CATALOG: readonly CatalogItem[] = [
  {
    id: 'item-milk-a',
    name: { es: 'Leche entera', en: 'Whole milk' },
    brand: 'Hacendado',
    size: 1,
    unit: 'LITER',
    productGroupId: null,
  },
  {
    id: 'item-milk-b',
    name: { es: 'Leche Pascual', en: 'Pascual milk' },
    brand: 'Pascual',
    size: 1,
    unit: 'LITER',
    productGroupId: null,
  },
];

const MILK_GROUP: ProductGroup = {
  id: 'group-milk',
  name: { es: 'Leche', en: 'Milk' },
};

/** As many product ids as asked for, for the counter's numbers. */
function items(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `item-${index}`);
}

function select(overrides: Partial<LinePageInput> = {}): LinePageVm | null {
  return selectLinePage({
    line: line(),
    list: list(),
    zoneName: 'Flat 3B',
    settlements: [],
    itemSettlements: [],
    itemNameOf: (itemId) => CATALOG.find((row) => row.id === itemId) ?? null,
    namesUnavailable: false,
    nameOf: () => null,
    listNameOf: () => null,
    callerUserId: ME,
    locale: 'en',
    alsoOn: null,
    hasMoreSettlements: false,
    hasMoreItemSettlements: false,
    canEdit: true,
    canDelete: true,
    busy: false,
    groupNameOf: (groupId) => (groupId === MILK_GROUP.id ? MILK_GROUP : null),
    ...overrides,
  });
}

describe('selectLinePage', () => {
  it('is null for a line the store does not hold', () => {
    expect(select({ line: undefined })).toBeNull();
  });

  describe('the two histories', () => {
    it('is loading, not empty, while a section has never been read', () => {
      // Undefined and empty are different answers and the section draws them
      // differently: one is a skeleton, one is a sentence. Collapsing them would make
      // every line look freshly loaded forever.
      const page = select({ settlements: undefined, itemSettlements: undefined });

      expect(page?.thisList.loading).toBe(true);
      expect(page?.everywhere?.loading).toBe(true);
    });

    it('has no cross list section at all on a line with no products', () => {
      // **Absent, not empty.** The section is keyed on the product set, so a free text
      // line cannot have one, and drawing it empty would tell the reader they have
      // never bought this anywhere when nobody has said what "this" is.
      const page = select({ line: line({ itemIds: [] }) });

      expect(page?.everywhere).toBeNull();
    });

    it('names the list on a cross list row and never on its own', () => {
      const page = select({
        settlements: [bought(1)],
        itemSettlements: [bought(3, { id: 'st-other', listId: 'list-2' })],
        listNameOf: (listId) => (listId === 'list-2' ? 'Cabin' : null),
      });

      expect(page?.thisList.rows[0].listName).toBeNull();
      expect(page?.everywhere?.rows[0].listName).toBe('Cabin');
    });
  });

  describe('paging', () => {
    it('offers no further page when the store holds the whole history', () => {
      const page = select({ settlements: [bought(1)] });

      expect(page?.thisList.hasMore).toBe(false);
      expect(page?.everywhere?.hasMore).toBe(false);
    });

    it('offers one when the store has a cursor, on each section independently', () => {
      // Independently, because they are two reads with two cursors: a line whose own
      // history fits on one page can still have more to show from its products.
      const page = select({
        settlements: [bought(1)],
        hasMoreSettlements: false,
        hasMoreItemSettlements: true,
      });

      expect(page?.thisList.hasMore).toBe(false);
      expect(page?.everywhere?.hasMore).toBe(true);
    });
  });

  describe('alsoOn', () => {
    it('is null while nobody has asked', () => {
      // Null rather than empty (plan 0047, section 5), so the page omits the section
      // rather than saying "no other list has this" on behalf of a query nobody made.
      expect(select()?.alsoOn).toBeNull();
    });

    it('keeps an empty answer distinct from no answer', () => {
      // The distinction backend plan 0053 section 3 exists to make possible: this one
      // means "asked, and nothing else wants it", which the page draws as nothing but
      // is not the same fact as null.
      expect(select({ alsoOn: { places: [], hasMore: false } })?.alsoOn).toEqual({
        places: [],
        hasMore: false,
      });
    });

    it('carries the places and the capped flag through', () => {
      const alsoOn = {
        places: [{ listId: 'list-2', listName: 'Cabin', zoneName: 'Flat 3B' }],
        hasMore: true,
      };

      expect(select({ alsoOn })?.alsoOn).toEqual(alsoOn);
    });
  });

  describe('the products', () => {
    it('names them from the service', () => {
      expect(select()?.products).toEqual([
        {
          itemId: 'item-milk-a',
          name: 'Whole milk',
          brand: 'Hacendado',
          removable: true,
          // Nobody's group put it there, so it is the person's and there is nothing
          // to adopt.
          source: 'user',
          adoptable: false,
        },
      ]);
    });

    it('reports a failed lookup, and never as the line having no products', () => {
      const page = select({ itemNameOf: () => null, namesUnavailable: true });

      expect(page?.namesUnavailable).toBe(true);
      expect(page?.products).toHaveLength(1);
      expect(page?.products[0].name).toBeNull();
    });

    it('reports nothing on a line that genuinely has no products', () => {
      const page = select({ line: line({ itemIds: [] }), namesUnavailable: true });

      expect(page?.namesUnavailable).toBe(false);
    });

    it('is not removable while a write is in flight', () => {
      expect(select({ busy: true })?.products[0].removable).toBe(false);
      expect(select({ canEdit: false })?.products[0].removable).toBe(false);
    });
  });

  /**
   * Who put each product on the line (velista plan 0065, section 2).
   *
   * The absence is the case to hold on to: a line following no group draws **no
   * headings at all**, which is every line backend `0048` created. The headings
   * appear exactly when there is something for them to tell apart.
   */
  describe('the clusters', () => {
    it('draws none at all on a line that follows no group', () => {
      const page = select({
        line: line({ itemIds: ['item-milk-a', 'item-milk-b'] }),
      });

      expect(page?.clusters).toBeNull();
      expect(page?.products).toHaveLength(2);
      expect(page?.products.every((product) => product.source === 'user')).toBe(
        true
      );
    });

    it('draws one, headed by the group, when every product is the catalog’s', () => {
      // The most common case in the product: immediately after somebody picks Milk
      // every product is the catalog's. One heading reads as a statement about the
      // line, where a mark on all of them would distinguish nothing.
      const page = select({
        line: line({
          itemIds: ['item-milk-a', 'item-milk-b'],
          productGroupId: MILK_GROUP.id,
          groupItemIds: ['item-milk-a', 'item-milk-b'],
        }),
      });

      expect(page?.clusters).toHaveLength(1);
      expect(page?.clusters?.[0].headingKey).toBe('list.page.fromGroup');
      expect(page?.clusters?.[0].headingArgs).toEqual({ name: 'Milk' });
      expect(page?.clusters?.[0].products).toHaveLength(2);
    });

    it('splits a mixed line, with each product in exactly one cluster', () => {
      const page = select({
        line: line({
          itemIds: ['item-milk-a', 'item-milk-b'],
          productGroupId: MILK_GROUP.id,
          groupItemIds: ['item-milk-a'],
        }),
      });

      expect(page?.clusters?.map((cluster) => cluster.headingKey)).toEqual([
        'list.page.fromGroup',
        'list.page.addedByYou',
      ]);

      const drawn = page?.clusters?.flatMap((cluster) =>
        cluster.products.map((product) => product.itemId)
      );
      expect(drawn).toEqual(['item-milk-a', 'item-milk-b']);
      expect(new Set(drawn).size).toBe(2);
    });

    it('names the unnamed heading when the group did not resolve', () => {
      // Never a named key with an empty name: `From ` is the sentence the unnamed
      // product chip already refuses to draw, and the reader is owed the same words
      // whether the lookup failed or the group is gone.
      const page = select({
        line: line({
          itemIds: ['item-milk-a'],
          productGroupId: 'group-gone',
          groupItemIds: ['item-milk-a'],
        }),
        groupNameOf: () => null,
      });

      expect(page?.clusters?.[0].headingKey).toBe('list.page.fromGroupUnnamed');
      expect(page?.clusters?.[0].headingArgs).toEqual({});
    });

    it('offers Keep only on what the catalog put there, and only to an editor', () => {
      const mixed = line({
        itemIds: ['item-milk-a', 'item-milk-b'],
        productGroupId: MILK_GROUP.id,
        groupItemIds: ['item-milk-a'],
      });

      const page = select({ line: mixed });
      expect(page?.products[0].adoptable).toBe(true);
      // A product the person already owns has nothing to adopt, so the control is
      // absent rather than inert: either the gesture is offered or it is not.
      expect(page?.products[1].adoptable).toBe(false);

      expect(
        select({ line: mixed, canEdit: false })?.products[0].adoptable
      ).toBe(false);
      expect(select({ line: mixed, busy: true })?.products[0].adoptable).toBe(
        false
      );
    });
  });

  describe('the counter', () => {
    it('counts the whole set against the cap, on any line with products', () => {
      // Always, never only once the line is close to full: a counter that appears at
      // 90 teaches somebody that a limit exists at the exact moment the news is bad.
      const page = select({ line: line({ itemIds: items(98) }) });

      expect(page?.counter).toEqual({ count: 98, cap: 100, overCap: false });
    });

    it('clamps neither number over the cap', () => {
      // `0070` section 7.2 makes this a legitimate state: the catalog's sync ignores
      // the cap so a subscription does not silently stop working at a number nobody
      // can see. `100/100` would claim the line is exactly full when it is not.
      const page = select({
        line: line({
          itemIds: items(104),
          productGroupId: MILK_GROUP.id,
          groupItemIds: items(104),
        }),
      });

      expect(page?.counter).toEqual({ count: 104, cap: 100, overCap: true });
    });

    it('has none on a line with no products', () => {
      // A number with nothing to count, over a sentence that already says the line
      // has no products.
      expect(select({ line: line({ itemIds: [] }) })?.counter).toBeNull();
    });
  });

  it('agrees with the sheet about the estimate, because it is the same function', () => {
    const page = select({
      settlements: [bought(0), bought(14), bought(30)],
    });

    expect(page?.estimate).toEqual({
      medianDays: 15,
      fromPurchases: 3,
      rough: true,
    });
  });
});
