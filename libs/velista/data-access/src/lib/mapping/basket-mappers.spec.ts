import { isOpenBasket } from '@portfolio/velista/models';
import {
  restrictRowToServedLists,
  toBasket,
  toBasketMergeRequired,
  toBasketRenameResult,
  toBasketRow,
  toBasketRowResult,
} from './basket-mappers';

/**
 * The boundary, on the rules that cost a screen when they are broken (velista
 * `0090`, section 16).
 *
 * Rule D4's usual assertions, that every parameter is `unknown` and a row that will
 * not map is dropped, are covered by the mappers this file joins. What is asserted
 * here is what plan 0090 changed:
 *
 * - **Nothing here counts.** A basket without `progress` is refused rather than
 *   recounted, because recounting is what the plan removed.
 * - **One gate for "may I name this list"**, applied once per row, so the filter,
 *   the grouping and the entries pane cannot answer it three ways.
 * - **A row with no entry is refused unless it is `REMOVED`**, which is the one
 *   state that means every entry left the coverage.
 */

/** The smallest wire entry these mappers accept, for adding a field to. */
const ENTRY = {
  lineId: 'zl-1',
  listId: 'l-1',
  left: 2,
  bought: 1,
  state: 'PARTLY',
  approvalStatus: 'APPROVED',
  demandEditable: true,
};

/** The smallest wire row these mappers accept. */
const ROW = {
  rowKey: 'zl-1',
  content: 'Milk',
  left: 2,
  bought: 1,
  asked: 3,
  state: 'PARTLY',
  note: null,
  noteAt: null,
  mark: null,
  awaitingApproval: false,
  optionIds: ['i-milk'],
  touchedBy: null,
  touchedAt: null,
  entries: [ENTRY],
};

/** The smallest wire basket, which every read here adds to. */
const BASKET = {
  id: 'b-1',
  kind: 'GENERATED',
  name: 'Saturday big shop',
  status: 'OPEN',
  createdAt: '2026-09-01T08:00:00.000Z',
  rows: [ROW],
  lists: [
    { listId: 'l-1', name: 'Weekly shop', zoneId: 'z-1', zoneName: 'Flat 3B' },
  ],
  participants: [],
  me: { id: 'p-1', kind: 'OWNER' },
  products: [],
  progress: { done: 1, unavailable: 0, total: 3, pending: 2 },
};

describe('toBasket: what it refuses, and why', () => {
  it('reads a whole basket', () => {
    const basket = toBasket(BASKET);

    expect(basket?.id).toBe('b-1');
    expect(basket?.kind).toBe('GENERATED');
    expect(basket?.status).toBe('OPEN');
    expect(basket?.rows).toHaveLength(1);
    expect(basket?.progress).toEqual({ done: 1, unavailable: 0, total: 3 });
  });

  /**
   * The refusal the whole plan rests on. The only other way to answer "how much of
   * this basket is done" is to count the rows, and a second count is what velista
   * `0090` exists to remove: the server knows about skips, closes and purchases
   * another shopper made, and this side knows what it was told.
   */
  it('refuses a basket with no progress rather than recounting', () => {
    const { progress: _progress, ...without } = BASKET;

    expect(toBasket(without)).toBeNull();
  });

  it('refuses a basket with no reader, who every attribution resolves against', () => {
    expect(toBasket({ ...BASKET, me: null })).toBeNull();
  });

  /**
   * It arrives inside `progress` on the wire and is lifted out, because the finish
   * sheet and the home card read it on its own and the alternative is for one of
   * them to subtract three numbers the server already subtracted.
   */
  it('lifts pending out of the wire’s progress', () => {
    expect(toBasket(BASKET)?.pending).toBe(2);
  });

  it('reads the kind and the status, and an unknown one as UNKNOWN', () => {
    // The safe direction on both: a kind this build has never heard of must not
    // read as the permanent basket, and a status it does not know must not read as
    // open, because that would put a finished trip back on the dashboard.
    expect(toBasket({ ...BASKET, kind: 'SOMETHING_NEW' })?.kind).toBe(
      'UNKNOWN'
    );
    expect(toBasket({ ...BASKET, status: 'SOMETHING_NEW' })?.status).toBe(
      'UNKNOWN'
    );
    expect(isOpenBasket('UNKNOWN')).toBe(false);
  });

  it('reads the served lists, and a guest’s empty array', () => {
    expect(toBasket(BASKET)?.lists).toEqual([
      {
        listId: 'l-1',
        name: 'Weekly shop',
        zoneId: 'z-1',
        zoneName: 'Flat 3B',
      },
    ]);
    expect(toBasket({ ...BASKET, lists: [] })?.lists).toEqual([]);
  });

  /**
   * The whole of this scope's redaction, applied once as the refs are read. A guest
   * is served no refs, so every entry they hold names no list; and an id the basket
   * served no ref for is dropped to the same null, so the rest of the client has
   * one test for "served" and cannot disagree with itself.
   */
  it('drops an entry’s list id the basket served no ref for', () => {
    const basket = toBasket({
      ...BASKET,
      rows: [
        {
          ...ROW,
          entries: [ENTRY, { ...ENTRY, lineId: 'zl-2', listId: 'l-other' }],
        },
      ],
    });

    expect(basket?.rows[0].entries.map((entry) => entry.listId)).toEqual([
      'l-1',
      null,
    ]);
  });

  it('drops every list id for a reader served no ref at all', () => {
    const basket = toBasket({ ...BASKET, lists: [] });

    expect(basket?.rows[0].entries[0].listId).toBeNull();
  });
});

describe('toBasketRow', () => {
  it('refuses a row with no key, no content and no entries array', () => {
    expect(toBasketRow({ ...ROW, rowKey: null })).toBeNull();
    expect(toBasketRow({ ...ROW, content: null })).toBeNull();
    expect(toBasketRow({ ...ROW, entries: null })).toBeNull();
  });

  /**
   * Every entry of such a row left the coverage, which is exactly what the state
   * means, so an empty `entries` there is the truth rather than a failure to read
   * one. Anywhere else it is a row the screen cannot draw.
   */
  it('refuses a row with no entry unless it is REMOVED', () => {
    expect(toBasketRow({ ...ROW, entries: [] })).toBeNull();
    expect(toBasketRow({ ...ROW, state: 'REMOVED', entries: [] })?.state).toBe(
      'REMOVED'
    );
  });

  it('reads an unknown state as WANTED, which hides nothing', () => {
    // A row this build cannot classify is still a thing to buy. The other way
    // round would take it off somebody's screen.
    expect(toBasketRow({ ...ROW, state: 'SOMETHING_NEW' })?.state).toBe(
      'WANTED'
    );
  });

  /**
   * A state every row has must resolve to something; a note and a mark are
   * captions some rows carry, so an unknown one draws nothing rather than putting
   * a sentence under a row that has no claim to it.
   */
  it('reads an unknown note and an unknown mark as null', () => {
    expect(toBasketRow({ ...ROW, note: 'SOMETHING_NEW' })?.note).toBeNull();
    expect(toBasketRow({ ...ROW, mark: 'SOMETHING_NEW' })?.mark).toBeNull();
    expect(toBasketRow({ ...ROW, note: 'SKIPPED_EARLIER' })?.note).toBe(
      'SKIPPED_EARLIER'
    );
  });

  /** Null exactly when the note is: a time with no fact behind it says nothing. */
  it('drops noteAt when there is no note', () => {
    expect(
      toBasketRow({ ...ROW, note: null, noteAt: '2026-09-01T08:00:00.000Z' })
        ?.noteAt
    ).toBeNull();
  });

  /** A negative `left` is a server defect this client does not draw. */
  it('clamps every count at zero', () => {
    const row = toBasketRow({ ...ROW, left: -3, bought: -1 });

    expect(row?.left).toBe(0);
    expect(row?.bought).toBe(0);
  });

  it('reads an entry’s approval as a boolean, and anything unknown as agreed', () => {
    const pending = toBasketRow({
      ...ROW,
      entries: [{ ...ENTRY, approvalStatus: 'PENDING' }],
    });
    const unknown = toBasketRow({
      ...ROW,
      entries: [{ ...ENTRY, approvalStatus: 'SOMETHING_NEW' }],
    });

    expect(pending?.entries[0].awaitingApproval).toBe(true);
    // The quiet direction: an unreadable value costs a caption rather than putting
    // one under a row the household already agreed to.
    expect(unknown?.entries[0].awaitingApproval).toBe(false);
  });

  /**
   * The server owns this rule and asks it of the basket's **owner**, so a value
   * this client cannot read means it has not been told the control is allowed.
   */
  it('reads demandEditable as false on anything but an explicit true', () => {
    expect(
      toBasketRow({ ...ROW, entries: [{ ...ENTRY, demandEditable: 'yes' }] })
        ?.entries[0].demandEditable
    ).toBe(false);
  });

  /** `bought + left`, which is how backend `0130` section 4 defines it. */
  it('sums an entry’s asked out of what it bought and what is left', () => {
    const row = toBasketRow({
      ...ROW,
      entries: [{ ...ENTRY, left: 4, bought: 2 }],
    });

    expect(row?.entries[0].asked).toBe(6);
  });
});

describe('toBasketRow: where it is usually bought (velista 0104)', () => {
  it('reads each state and its two numbers as the server sent them', () => {
    for (const state of [
      'NEVER_BOUGHT',
      'NO_SHOP_KNOWN',
      'ELSEWHERE',
      'HERE',
    ] as const) {
      expect(
        toBasketRow({ ...ROW, usual: { state, bought: 2, of: 6 } })?.usual
      ).toEqual({ state, bought: 2, of: 6 });
    }
  });

  it('reads a read with no shop, an absent field and an unknown state as null', () => {
    expect(toBasketRow({ ...ROW, usual: null })?.usual).toBeNull();
    expect(toBasketRow(ROW)?.usual).toBeNull();
    expect(
      toBasketRow({ ...ROW, usual: { state: 'SOMETIMES', bought: 1, of: 2 } })
        ?.usual
    ).toBeNull();
  });

  it('floors a negative count at zero and recounts nothing', () => {
    expect(
      toBasketRow({ ...ROW, usual: { state: 'HERE', bought: -1, of: 7 } })
        ?.usual
    ).toEqual({ state: 'HERE', bought: 0, of: 7 });
  });
});

describe('restrictRowToServedLists', () => {
  it('drops an id the reader was not served, and keeps one they were', () => {
    const row = toBasketRow({
      ...ROW,
      entries: [ENTRY, { ...ENTRY, lineId: 'zl-2', listId: 'l-other' }],
    });

    const gated = restrictRowToServedLists(row!, new Set(['l-1']));

    expect(gated.entries.map((entry) => entry.listId)).toEqual(['l-1', null]);
  });

  /**
   * By identity when nothing is dropped, which is the ordinary case: the server
   * redacts consistently per reader, so a row whose ids all have refs comes back as
   * the same object and nothing above it re-renders.
   */
  it('answers the same object when every id is served', () => {
    const row = toBasketRow(ROW);

    expect(restrictRowToServedLists(row!, new Set(['l-1']))).toBe(row);
  });
});

describe('toBasketRowResult', () => {
  const RESULT = {
    row: ROW,
    progress: { done: 1, unavailable: 0, total: 3, pending: 2 },
  };

  it('reads the row, the counts and the lifted pending', () => {
    const result = toBasketRowResult(RESULT);

    expect(result?.row.rowKey).toBe('zl-1');
    expect(result?.progress).toEqual({ done: 1, unavailable: 0, total: 3 });
    expect(result?.pending).toBe(2);
  });

  /** Absent on the wire when nothing happened, and null and zero here. */
  it('reads an absent replacedRowKey and skippedCount as null and zero', () => {
    const result = toBasketRowResult(RESULT);

    expect(result?.replacedRowKey).toBeNull();
    expect(result?.skippedCount).toBe(0);
    expect(
      toBasketRowResult({ ...RESULT, replacedRowKey: 'zl-9', skippedCount: 2 })
    ).toMatchObject({ replacedRowKey: 'zl-9', skippedCount: 2 });
  });

  /**
   * The store folds the answer whole and patches nothing, so an answer it cannot
   * fold is one it must not half apply: the caller reads the basket again instead.
   */
  it('refuses an answer whose row or counts cannot be read', () => {
    expect(toBasketRowResult({ ...RESULT, row: null })).toBeNull();
    expect(toBasketRowResult({ ...RESULT, progress: null })).toBeNull();
  });
});

describe('toBasketRenameResult', () => {
  /**
   * The same shape every write on a row answers, with the wire's `replacedRowKey`
   * named for what a rename does with it: the earliest line survives a merge, so
   * the row the request addressed can be the one that went away.
   */
  it('names the absorbed row by the key the request used', () => {
    expect(
      toBasketRenameResult({
        row: ROW,
        progress: { done: 0, unavailable: 0, total: 1, pending: 1 },
        replacedRowKey: 'zl-9',
      })
    ).toMatchObject({ absorbedRowKey: 'zl-9', replacedRowKey: 'zl-9' });
  });

  it('answers a null absorbed row when nothing merged', () => {
    expect(
      toBasketRenameResult({
        row: ROW,
        progress: { done: 0, unavailable: 0, total: 1, pending: 1 },
      })?.absorbedRowKey
    ).toBeNull();
  });
});

describe('toBasket: the product’s aisle', () => {
  function productsOf(products: readonly unknown[]) {
    return toBasket({ ...BASKET, products })?.products;
  }

  it('reads the wire category into a one element list', () => {
    expect(
      productsOf([{ id: 'i-1', category: 'DAIRY' }])?.get('i-1')?.categories
    ).toEqual(['DAIRY']);
  });

  /**
   * A thirteenth category is a product this app cannot name, and the honest place
   * for one is the heading that says exactly that. Dropping it would take a row off
   * a screen somebody is shopping from.
   */
  it('reads a category it has never heard of as OTHER, and keeps the product', () => {
    const read = productsOf([
      { id: 'i-1', category: 'BABY_FOOD' },
      { id: 'i-2' },
    ]);

    expect(read?.get('i-1')?.categories).toEqual(['OTHER']);
    expect(read?.get('i-2')?.categories).toEqual(['OTHER']);
  });
});

/**
 * A rename's merge question (velista `0084`, backend `0113`).
 *
 * The question is all or nothing: a row this build cannot read is a merge somebody
 * would confirm without being shown it.
 */
describe('toBasketMergeRequired', () => {
  const WEEKLY = {
    listId: 'l1',
    listName: 'Weekly shop',
    zoneName: 'Flat 3B',
    otherContent: 'Leche entera',
    otherQuantity: 2,
  };
  const OTHER_ROW = {
    otherLineId: 'line-2',
    otherContent: 'leche entera',
    otherQuantity: 3,
  };

  /**
   * The line id the refusal names is the other row's anchor, which is that row's
   * key: the refusal is about a line on a list, and a row is keyed by one.
   */
  it('reads every list and the other row, keyed by its anchor', () => {
    expect(
      toBasketMergeRequired({ lists: [WEEKLY], basket: OTHER_ROW })
    ).toEqual({
      lists: [
        {
          listId: 'l1',
          listName: 'Weekly shop',
          zoneName: 'Flat 3B',
          otherQuantity: 2,
        },
      ],
      basket: { otherRowKey: 'line-2', otherQuantity: 3 },
    });
  });

  it('refuses the whole question when one row cannot be read', () => {
    expect(
      toBasketMergeRequired({
        lists: [WEEKLY, { listId: 'l2', otherQuantity: 1 }],
        basket: null,
      })
    ).toBeNull();
    expect(
      toBasketMergeRequired({ lists: [WEEKLY], basket: { otherQuantity: 1 } })
    ).toBeNull();
  });

  it('asks nothing when no place is named', () => {
    expect(toBasketMergeRequired({ lists: [], basket: null })).toBeNull();
    expect(toBasketMergeRequired({ otherContent: 'milk' })).toBeNull();
  });
});
