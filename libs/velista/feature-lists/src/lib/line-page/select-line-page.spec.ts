import type {
  CatalogItem,
  Line,
  LinePageVm,
  LineSettlement,
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
];

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
