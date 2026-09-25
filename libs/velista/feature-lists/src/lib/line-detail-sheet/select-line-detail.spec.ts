import type {
  CatalogItem,
  Line,
  LineDetailVm,
  LineSettlement,
} from '@portfolio/velista/models';
import { selectLineDetail, type LineDetailInput } from './select-line-detail';

/**
 * What the detail sheet says, asserted against the function that decides it.
 *
 * `0043` built this selector pure and exported and then left it untested, which velista
 * plan `0047` section 7 calls out: between this and the line page's it holds the median
 * interval estimate, the three purchase floor and the preselect rule, and every one of
 * them is the kind of thing that breaks silently. None of them needs a component, a
 * fixture or a clock to state.
 */

const ME = 'user-me';
const DAY = 86_400_000;

/** A fixed "now", so an estimate is a property of the gaps and not of the wall clock. */
const NOW = new Date('2026-09-01T10:00:00.000Z').getTime();

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'ln-1',
    listId: 'list-1',
    content: 'Milk',
    quantity: 2,
    itemIds: [],
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

/**
 * One purchase, `daysAgo` before {@link NOW}.
 *
 * Days rather than dates, because every rule under test is about the **gaps** and
 * writing them as intervals is writing down what the test is actually about.
 */
function bought(
  daysAgo: number,
  overrides: Partial<LineSettlement> = {}
): LineSettlement {
  return {
    id: `st-${daysAgo}`,
    lineId: 'ln-1',
    listId: 'list-1',
    outcome: 'BOUGHT',
    quantity: 1,
    itemId: null,
    settledByUserId: ME,
    settledAt: new Date(NOW - daysAgo * DAY),
    ...overrides,
  };
}

function item(
  id: string,
  en: string,
  brand: string | null = null
): CatalogItem {
  return {
    id,
    name: { es: en, en },
    brand,
    size: 1,
    unit: 'LITER',
    productGroupId: null,
  };
}

const CATALOG: readonly CatalogItem[] = [
  item('item-milk-a', 'Whole milk', 'Hacendado'),
  item('item-milk-b', 'Semi-skimmed milk', 'Pascual'),
  item('item-oat', 'Oat drink', 'Oatly'),
];

function select(overrides: Partial<LineDetailInput> = {}): LineDetailVm | null {
  return selectLineDetail({
    line: line(),
    settlements: [],
    itemNameOf: (itemId) => CATALOG.find((row) => row.id === itemId) ?? null,
    namesUnavailable: false,
    nameOf: () => null,
    claimedBy: null,
    callerUserId: ME,
    locale: 'en',
    canSettle: true,
    indicators: [],
    busy: false,
    ...overrides,
  });
}

describe('selectLineDetail', () => {
  it('is null for a line the store does not hold', () => {
    expect(select({ line: undefined })).toBeNull();
  });

  describe('the estimate', () => {
    it('is absent below three purchases, because two make one interval', () => {
      expect(
        select({ settlements: [bought(0), bought(14)] })?.estimate
      ).toBeNull();
    });

    it('reads as a phrase from three purchases to six', () => {
      // Three purchases, two intervals, and a median that is a number this refuses to
      // print (plan 0047, section 5).
      const three = select({
        settlements: [bought(0), bought(14), bought(30)],
      })?.estimate;
      expect(three).toEqual({
        medianDays: 15,
        fromPurchases: 3,
        rough: true,
      });

      const six = select({
        settlements: [
          bought(0),
          bought(14),
          bought(28),
          bought(42),
          bought(56),
          bought(70),
        ],
      })?.estimate;
      expect(six?.fromPurchases).toBe(6);
      expect(six?.rough).toBe(true);
    });

    it('gives the number above six', () => {
      const seven = select({
        settlements: [
          bought(0),
          bought(14),
          bought(28),
          bought(42),
          bought(56),
          bought(70),
          bought(84),
        ],
      })?.estimate;

      expect(seven).toEqual({
        medianDays: 14,
        fromPurchases: 7,
        rough: false,
      });
    });

    it('takes the median rather than the mean, so one stock up trip does not move it', () => {
      // Gaps of 7, 7 and 200. A mean would say every 71 days; the median says 7, which
      // is what the household actually does.
      const estimate = select({
        settlements: [bought(0), bought(7), bought(14), bought(214)],
      })?.estimate;

      expect(estimate?.medianDays).toBe(7);
    });

    it('counts only purchases, never a trip that found nothing', () => {
      const estimate = select({
        settlements: [
          bought(0),
          bought(14),
          bought(28, { id: 'st-miss', outcome: 'NOT_AVAILABLE', quantity: 0 }),
        ],
      })?.estimate;

      // Two purchases survive the filter, which is below the floor.
      expect(estimate).toBeNull();
    });

    it('merges settlements of one trip, so three within an hour are one purchase', () => {
      const HOUR = DAY / 24;
      const within = (daysAgo: number, minutes: number) =>
        bought(daysAgo, {
          id: `st-${daysAgo}-${minutes}`,
          settledAt: new Date(NOW - daysAgo * DAY - minutes * (HOUR / 60)),
        });

      // Three rows seconds apart, then two trips a week apart each. Unmerged these give
      // gaps of 0, 0, 7 and 7, a median of 0 and "every day". Merged they are three
      // purchases a week apart.
      const estimate = select({
        settlements: [
          within(0, 0),
          within(0, 10),
          within(0, 40),
          bought(7),
          bought(14),
        ],
      })?.estimate;

      expect(estimate).toEqual({
        medianDays: 7,
        fromPurchases: 3,
        rough: true,
      });
    });

    it('counts the floor after the fold, so a history that folds below it gives null', () => {
      // Four rows, and two purchases once the first three are one trip.
      const estimate = select({
        settlements: [
          bought(0),
          bought(0, { id: 'st-0b', settledAt: new Date(NOW - DAY / 48) }),
          bought(0, { id: 'st-0c', settledAt: new Date(NOW - DAY / 24) }),
          bought(9),
        ],
      })?.estimate;

      expect(estimate).toBeNull();
    });

    it('chains the fold on the previous settlement, as the server does', () => {
      // A slow partial settle: rows 5 hours apart for a day. Each is within the session
      // of the one before it, so the whole run is one purchase.
      const HOUR = DAY / 24;
      const slow = [0, 5, 10, 15, 20, 24].map((hours) =>
        bought(0, {
          id: `st-slow-${hours}`,
          settledAt: new Date(NOW - hours * HOUR),
        })
      );

      const estimate = select({
        // The run keeps its first time, a day ago, so the gaps are 7 and 7.
        settlements: [...slow, bought(8), bought(15)],
      })?.estimate;

      expect(estimate?.fromPurchases).toBe(3);
      expect(estimate?.medianDays).toBe(7);
    });

    it('folds on exactly the session and splits a millisecond past it', () => {
      // The boundary the server draws in `continuesPurchaseSession` (backend plan 0134,
      // section 7). Six hours apart is one purchase, so the gaps are 7 and 7 and the
      // estimate reads three purchases.
      const SESSION = 6 * 60 * 60 * 1000;
      const pair = (gap: number) => [
        bought(0),
        bought(0, {
          id: 'st-0-later',
          settledAt: new Date(NOW - gap),
        }),
      ];

      expect(
        select({ settlements: [...pair(SESSION), bought(7), bought(14)] })
          ?.estimate?.fromPurchases
      ).toBe(3);
      expect(
        select({ settlements: [...pair(SESSION + 1), bought(7), bought(14)] })
          ?.estimate?.fromPurchases
      ).toBe(4);
    });
  });

  describe('the preselected product', () => {
    it('is null on a line with no products', () => {
      expect(select()?.preselectedItemId).toBeNull();
    });

    it('is the last one bought', () => {
      const detail = select({
        line: line({ itemIds: ['item-milk-a', 'item-milk-b'] }),
        settlements: [
          bought(2, { id: 'st-recent', itemId: 'item-milk-b' }),
          bought(30, { id: 'st-old', itemId: 'item-milk-a' }),
        ],
      });

      expect(detail?.preselectedItemId).toBe('item-milk-b');
    });

    it('falls back to the first when the last one bought has left the line', () => {
      // The rule most likely to break silently (plan 0047, section 7): a settlement
      // keeps the product it recorded even after the set it came from has changed, so
      // the preselect is filtered against the line's **current** products. Without the
      // filter this would preselect a product the sheet is not offering.
      const detail = select({
        line: line({ itemIds: ['item-milk-a'] }),
        settlements: [bought(2, { id: 'st-gone', itemId: 'item-oat' })],
      });

      expect(detail?.preselectedItemId).toBe('item-milk-a');
    });
  });

  describe('the choices', () => {
    it('are empty on a free text line and on a line with one product', () => {
      expect(select()?.choices).toEqual([]);
      expect(
        select({ line: line({ itemIds: ['item-milk-a'] }) })?.choices
      ).toEqual([]);
    });

    it('name every product once there is something to ask', () => {
      const detail = select({
        line: line({ itemIds: ['item-milk-a', 'item-milk-b'] }),
      });

      expect(detail?.choices).toEqual([
        {
          itemId: 'item-milk-a',
          name: 'Whole milk',
          brand: 'Hacendado',
          removable: true,
        },
        {
          itemId: 'item-milk-b',
          name: 'Semi-skimmed milk',
          brand: 'Pascual',
          removable: true,
        },
      ]);
    });
  });

  describe('the products phrase', () => {
    it('says the line is linked to nothing when it carries no products', () => {
      expect(select()?.productsKey).toBe('list.detail.products.none');
    });

    it('names the only product', () => {
      const detail = select({ line: line({ itemIds: ['item-milk-a'] }) });

      expect(detail?.productsKey).toBe('list.detail.products.one');
      expect(detail?.productsArgs).toEqual({ name: 'Whole milk' });
    });

    it('gives the count, not an empty name, when the only product cannot be named', () => {
      // The half of the defect that lives in the phrase (section 1.2): a name that did
      // not resolve used to render `products.one` with an empty string, which is a
      // sentence about a product with no product in it.
      const detail = select({
        line: line({ itemIds: ['item-withdrawn'] }),
        itemNameOf: () => null,
      });

      expect(detail?.productsKey).toBe('list.detail.products.unnamed');
      expect(detail?.productsArgs).toEqual({ count: 1 });
    });

    it('counts several, and names the one last bought', () => {
      const detail = select({
        line: line({ itemIds: ['item-milk-a', 'item-milk-b'] }),
        settlements: [bought(2, { itemId: 'item-milk-b' })],
      });

      expect(detail?.productsKey).toBe('list.detail.products.lastBought');
      expect(detail?.productsArgs).toEqual({
        count: 2,
        name: 'Semi-skimmed milk',
      });
    });
  });

  describe('names that could not be read', () => {
    it('is reported, and is not the line being empty', () => {
      const detail = select({
        line: line({ itemIds: ['item-milk-a'] }),
        itemNameOf: () => null,
        namesUnavailable: true,
      });

      expect(detail?.namesUnavailable).toBe(true);
      // And never the "no products" phrase, which is the claim about the line that
      // this whole plan exists to stop being made about a failed request.
      expect(detail?.productsKey).not.toBe('list.detail.products.none');
    });

    it('is never reported on a line that genuinely has no products', () => {
      // Nothing was asked for, so nothing failed. A free text line must not grow a
      // failure line because some other line's lookup went wrong.
      const detail = select({ namesUnavailable: true });

      expect(detail?.namesUnavailable).toBe(false);
      expect(detail?.productsKey).toBe('list.detail.products.none');
    });
  });

  describe('what the header carries through', () => {
    it('draws the indicators the row carries, and who is buying', () => {
      const detail = select({
        indicators: ['bought', 'claimed'],
        claimedBy: 'Ana',
      });

      expect(detail?.indicators).toEqual(['bought', 'claimed']);
      expect(detail?.claimedBy).toBe('Ana');
    });
  });

  describe('the history rows', () => {
    it('marks a settlement the reader made, and does not name them to themselves', () => {
      const detail = select({
        settlements: [
          bought(1),
          bought(3, { id: 'st-theirs', settledByUserId: 'user-ana' }),
        ],
        nameOf: (userId) => (userId === 'user-ana' ? 'Ana' : null),
      });

      expect(detail?.lastPurchase?.mine).toBe(true);
      expect(detail?.lastPurchase?.who).toBeNull();
    });

    it('has no last purchase when nothing has ever been bought', () => {
      const detail = select({
        settlements: [
          bought(1, { id: 'st-miss', outcome: 'NOT_AVAILABLE', quantity: 0 }),
        ],
      });

      expect(detail?.lastPurchase).toBeNull();
    });
  });
});
