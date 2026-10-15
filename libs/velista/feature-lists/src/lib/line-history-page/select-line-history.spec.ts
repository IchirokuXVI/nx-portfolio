import type {
  CatalogItem,
  Line,
  LineSettlement,
} from '@portfolio/velista/models';
import {
  selectLineHistory,
  type LineHistoryInput,
} from './select-line-history';

/**
 * What the history page of a line says (velista `0135`, section 5), asserted
 * against the function that decides it.
 */

const ME = 'user-me';
const NOW = new Date(2026, 9, 11, 10);
const DAY = 86_400_000;

function line(overrides: Partial<Line> = {}): Line {
  return {
    id: 'ln-1',
    listId: 'list-1',
    content: 'Shampoo',
    quantity: 3,
    itemIds: ['normal'],
    productGroupId: null,
    groupItemIds: [],
    favoriteItemId: null,
    preferredSupermarketId: null,
    position: 1,
    approvalStatus: 'APPROVED',
    boughtCount: 0,
    lastSettlementOutcome: null,
    claimed: false,
    named: true,
    claimedByUserId: null,
    createdByUserId: ME,
    approvedByUserId: ME,
    version: 1,
    ...overrides,
  };
}

function bought(
  daysAgo: number,
  overrides: Partial<LineSettlement> = {}
): LineSettlement {
  return {
    id: `st-${daysAgo}`,
    lineId: 'ln-1',
    listId: 'list-1',
    itemId: 'normal',
    outcome: 'BOUGHT',
    quantity: 2,
    settledByUserId: ME,
    settledAt: new Date(NOW.getTime() - daysAgo * DAY),
    revertedAt: null,
    unitPriceCents: 215,
    currency: 'EUR',
    ...overrides,
  } as LineSettlement;
}

const NORMAL = {
  id: 'normal',
  name: { en: 'Shampoo for normal hair', es: '' },
  brand: 'Deliplus',
} as unknown as CatalogItem;

function input(overrides: Partial<LineHistoryInput> = {}): LineHistoryInput {
  return {
    line: line(),
    listName: 'Weekly shop',
    scope: 'thisList',
    settlements: [],
    hasMore: false,
    itemNameOf: (itemId) => (itemId === 'normal' ? NORMAL : null),
    nameOf: (userId) => (userId === 'user-marta' ? 'Marta' : null),
    listNameOf: (listId) => (listId === 'list-2' ? 'Party list' : null),
    callerUserId: ME,
    locale: 'en',
    now: NOW,
    ...overrides,
  };
}

describe('selectLineHistory', () => {
  it('answers null with no line', () => {
    expect(selectLineHistory(input({ line: undefined }))).toBeNull();
  });

  describe('the scopes', () => {
    it('offers both on a line with products', () => {
      expect(selectLineHistory(input())?.scopes).toEqual([
        'thisList',
        'everywhere',
      ]);
    });

    it('offers one on a line of free text, and falls back to it', () => {
      const view = selectLineHistory(
        input({ line: line({ itemIds: [] }), scope: 'everywhere' })
      );

      expect(view?.scopes).toEqual(['thisList']);
      expect(view?.scope).toBe('thisList');
    });
  });

  it('is loading, with no figures, while the rows were not read', () => {
    const view = selectLineHistory(input({ settlements: undefined }));

    expect(view?.loading).toBe(true);
    expect(view?.facts).toBeNull();
    expect(view?.months).toEqual([]);
  });

  it('has no figures and no months with nothing bought', () => {
    const view = selectLineHistory(input());

    expect(view?.loading).toBe(false);
    expect(view?.facts).toBeNull();
    expect(view?.months).toEqual([]);
  });

  describe('a row', () => {
    it('names the product that was bought, and the day', () => {
      const view = selectLineHistory(input({ settlements: [bought(13)] }));
      const row = view?.months[0].rows[0];

      expect(row).toMatchObject({
        product: 'Shampoo for normal hair · Deliplus',
        day: '28',
        mine: true,
        quantity: 2,
        listName: null,
      });
      expect(row?.price).toContain('4.30');
    });

    it('has no product on a purchase of free text, and on a "found none"', () => {
      const view = selectLineHistory(
        input({
          settlements: [
            bought(1, { itemId: null }),
            bought(2, { outcome: 'NOT_AVAILABLE', quantity: 0 }),
          ],
        })
      );

      expect(view?.months[0].rows.map((row) => row.product)).toEqual([
        null,
        null,
      ]);
    });

    it('names the list of a purchase in the "everywhere" scope only', () => {
      const settlements = [bought(1, { listId: 'list-2' })];

      const everywhere = selectLineHistory(
        input({ scope: 'everywhere', settlements })
      );
      const thisList = selectLineHistory(input({ settlements }));

      expect(everywhere?.months[0].rows[0].listName).toBe('Party list');
      expect(thisList?.months[0].rows[0].listName).toBeNull();
    });
  });

  it('groups the rows under their months, newest first', () => {
    const view = selectLineHistory(
      input({ settlements: [bought(13), bought(40), bought(49)] })
    );

    expect(view?.months.map((month) => month.label)).toEqual([
      'September',
      'August',
    ]);
    expect(view?.months.map((month) => month.rows.length)).toEqual([2, 1]);
  });

  describe('the figures', () => {
    it('counts this list by the line and says where it starts', () => {
      const view = selectLineHistory(
        input({
          line: line({ boughtCount: 12 }),
          settlements: [bought(13), bought(40)],
        })
      );

      expect(view?.facts?.times).toEqual({ count: 12, more: false });
      expect(view?.facts?.since).toBe('September');
      expect(view?.facts?.lastPaid).toContain('2.15');
    });

    it('counts "everywhere" by what was read, and says there is more', () => {
      const view = selectLineHistory(
        input({
          scope: 'everywhere',
          settlements: [bought(13), bought(40)],
          hasMore: true,
        })
      );

      expect(view?.facts?.times).toEqual({ count: 2, more: true });
      // Only a history read to its end knows where it starts.
      expect(view?.facts?.since).toBeNull();
    });

    it('says how often only from three purchases', () => {
      const two = selectLineHistory(
        input({ settlements: [bought(1), bought(10)] })
      );
      const three = selectLineHistory(
        input({ settlements: [bought(1), bought(10), bought(19)] })
      );

      expect(two?.facts?.everyDays).toBeNull();
      expect(three?.facts?.everyDays).toEqual({ days: 9, rough: true });
    });

    it('leaves out a purchase that was taken back', () => {
      const view = selectLineHistory(
        input({
          settlements: [bought(1, { revertedAt: new Date(NOW) }), bought(40)],
        })
      );

      expect(view?.facts?.times?.count).toBe(1);
      // The row stays in the history, marked.
      expect(view?.months[0].rows[0].reverted).toBe(true);
    });

    it('has no last price when no purchase carries one', () => {
      const view = selectLineHistory(
        input({ settlements: [bought(1, { unitPriceCents: null })] })
      );

      expect(view?.facts?.lastPaid).toBeNull();
    });
  });
});
