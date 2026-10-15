import {
  applyBasketMarks,
  applyBasketPatch,
  BASKET_PATCH_READ,
  type BasketEntryPatch,
} from './basket-patch';
import { basketProgressOf } from './basket-row-fold';
import type { Basket, BasketRow, BasketRowEntry } from './basket-view';

const ME = {
  id: 'p-me',
  kind: 'OWNER',
  displayName: 'Me',
  userId: 'u-me',
  device: null,
} as unknown as Basket['me'];

const BUY = {
  participantId: 'p-other',
  at: '2026-10-15T10:00:00.000Z',
  outcome: 'BOUGHT',
};

function entry(
  lineId: string,
  overrides: Partial<BasketRowEntry> = {}
): BasketRowEntry {
  const left = overrides.left ?? 2;
  const bought = overrides.bought ?? 0;
  return {
    lineId,
    listId: 'l-weekly',
    content: 'Leche',
    itemIds: ['p-milk'],
    favoriteItemId: null,
    canWrite: true,
    tripItemId: null,
    skipped: false,
    closed: false,
    act: null,
    version: 3,
    left,
    bought,
    asked: left + bought,
    boughtElsewhere: 0,
    state: 'WANTED',
    awaitingApproval: false,
    demandEditable: true,
    ...overrides,
  };
}

function row(
  rowKey: string,
  entries: readonly BasketRowEntry[],
  overrides: Partial<BasketRow> = {}
): BasketRow {
  const left = entries.reduce((sum, held) => sum + held.left, 0);
  const bought = entries.reduce((sum, held) => sum + held.bought, 0);
  return {
    rowKey,
    content: entries[0]?.content ?? 'Leche',
    productId: 'p-milk',
    left,
    bought,
    asked: left + bought,
    boughtElsewhere: entries.reduce(
      (sum, held) => sum + held.boughtElsewhere,
      0
    ),
    state: 'WANTED',
    note: null,
    noteAt: null,
    mark: null,
    awaitingApproval: false,
    touchedBy: null,
    touchedAt: null,
    entries,
    usual: { state: 'HERE', bought: 3, of: 6 },
    ...overrides,
  };
}

function basket(rows: readonly BasketRow[]): Basket {
  const { progress, pending } = basketProgressOf(rows);
  return {
    id: 'b-1',
    kind: 'GENERATED',
    name: 'Saturday',
    status: 'OPEN',
    createdAt: null,
    rows,
    lists: [],
    participants: [ME],
    me: ME,
    products: new Map(),
    scopes: new Map(),
    shop: null,
    lockedShopId: null,
    readAt: null,
    progress,
    pending,
    unseenChangeCount: 0,
    newestUnseenChangeId: null,
  };
}

/** The patch that states this entry as it is, with the overrides on top. */
function patch(
  held: BasketRowEntry,
  overrides: Partial<BasketEntryPatch> = {}
): BasketEntryPatch {
  return {
    lineId: held.lineId,
    version: held.version,
    left: held.left,
    bought: held.bought,
    boughtElsewhere: held.boughtElsewhere,
    state: held.state,
    awaitingApproval: held.awaitingApproval,
    skipped: held.skipped,
    closed: held.closed,
    act: held.act,
    tripItemId: held.tripItemId,
    ...overrides,
  };
}

function applied(result: Basket | 'read'): Basket {
  if (result === BASKET_PATCH_READ) {
    throw new Error('expected a basket, got a read');
  }
  return result;
}

describe('applyBasketPatch', () => {
  const milkA = entry('a');
  const milkB = entry('b', { listId: 'l-basics', left: 1 });
  const bread = entry('c', { content: 'Pan', itemIds: [], left: 1 });
  const milk = row('a', [milkA, milkB]);
  const breadRow = row('c', [bread], { content: 'Pan', productId: null });
  const held = basket([milk, breadRow]);

  describe('the table of section 2', () => {
    it('a line with a patch that an entry holds takes the fields of the patch', () => {
      const next = applied(
        applyBasketPatch(
          held,
          ['a'],
          [
            patch(milkA, {
              version: 4,
              left: 0,
              bought: 2,
              state: 'DONE',
              act: BUY,
            }),
          ]
        )
      );

      const [first, second] = next.rows;
      expect(first.entries[0]).toEqual({
        ...milkA,
        version: 4,
        left: 0,
        bought: 2,
        asked: 2,
        state: 'DONE',
        act: BUY,
      });
      // The fields a patch does not carry are the entry's.
      expect(first.entries[0].listId).toBe('l-weekly');
      expect(first.entries[0].canWrite).toBe(true);
      expect(first.entries[0].demandEditable).toBe(true);
      expect(first.entries[1]).toBe(milkB);
      expect(first).toMatchObject({
        left: 1,
        bought: 2,
        asked: 3,
        state: 'PARTLY',
        touchedBy: 'p-other',
        touchedAt: new Date(BUY.at),
        productId: 'p-milk',
        usual: milk.usual,
      });
      // A row the patch did not touch is the same object.
      expect(second).toBe(breadRow);
    });

    it('a line with a patch that no row holds answers read', () => {
      expect(
        applyBasketPatch(held, ['z'], [patch(entry('z'), { version: 1 })])
      ).toBe(BASKET_PATCH_READ);
    });

    it('a line with no patch that an entry holds loses its entry', () => {
      const next = applied(applyBasketPatch(held, ['b'], []));
      expect(next.rows[0].entries).toEqual([milkA]);
      expect(next.rows[0]).toMatchObject({ left: 2, asked: 2 });
    });

    it('a row that loses its last entry goes', () => {
      const next = applied(applyBasketPatch(held, ['c'], []));
      expect(next.rows.map((held) => held.rowKey)).toEqual(['a']);
      expect(next.progress).toEqual({ done: 0, unavailable: 0, total: 1 });
      expect(next.pending).toBe(1);
    });

    it('a line with no patch that no row holds changes nothing', () => {
      expect(applyBasketPatch(held, ['z'], [])).toBe(held);
    });

    it('no line at all is the coverage moving, which only a read answers', () => {
      expect(applyBasketPatch(held, [], [])).toBe(BASKET_PATCH_READ);
    });
  });

  describe('the order of two states of one entry', () => {
    it('drops a patch older than the entry', () => {
      expect(
        applyBasketPatch(
          held,
          ['a'],
          [patch(milkA, { version: 2, left: 0, bought: 2, state: 'DONE' })]
        )
      ).toBe(held);
    });

    it('applies a patch of an equal version that agrees on skipped and closed', () => {
      const next = applied(
        applyBasketPatch(held, ['a'], [patch(milkA, { act: BUY })])
      );
      expect(next.rows[0].entries[0].act).toEqual(BUY);
    });

    it('changes nothing for a patch that states the entry as it is', () => {
      expect(applyBasketPatch(held, ['a'], [patch(milkA)])).toBe(held);
    });

    it('reads at an equal version when skipped differs', () => {
      expect(
        applyBasketPatch(held, ['a'], [patch(milkA, { skipped: true })])
      ).toBe(BASKET_PATCH_READ);
    });

    it('reads at an equal version when closed differs', () => {
      expect(
        applyBasketPatch(
          held,
          ['a'],
          [patch(milkA, { closed: true, state: 'NOT_AVAILABLE' })]
        )
      ).toBe(BASKET_PATCH_READ);
    });

    it('applies a newer close', () => {
      const close = { ...BUY, outcome: 'NOT_AVAILABLE' };
      const next = applied(
        applyBasketPatch(
          held,
          ['a'],
          [
            patch(milkA, {
              version: 4,
              closed: true,
              state: 'NOT_AVAILABLE',
              act: close,
            }),
          ]
        )
      );
      expect(next.rows[0].state).toBe('NOT_AVAILABLE');
      expect(next.progress).toEqual({ done: 0, unavailable: 1, total: 2 });
    });
  });

  it('rebuilds a row of two lists where one entry goes to zero', () => {
    const next = applied(
      applyBasketPatch(
        held,
        ['b'],
        [
          patch(milkB, {
            version: 4,
            left: 0,
            bought: 1,
            state: 'DONE',
            act: BUY,
          }),
        ]
      )
    );
    expect(next.rows[0]).toMatchObject({
      rowKey: 'a',
      left: 2,
      bought: 1,
      asked: 3,
      state: 'PARTLY',
    });
    expect(next.rows[0].entries.map((held) => held.left)).toEqual([2, 0]);
  });

  it('counts the progress over the rows, as the server does', () => {
    const next = applied(
      applyBasketPatch(
        held,
        ['a', 'b'],
        [
          patch(milkA, {
            version: 4,
            left: 0,
            bought: 2,
            state: 'DONE',
            act: BUY,
          }),
          patch(milkB, {
            version: 4,
            left: 0,
            bought: 1,
            state: 'DONE',
            act: BUY,
          }),
        ]
      )
    );
    expect(next.rows[0].state).toBe('DONE');
    expect(next.progress).toEqual({ done: 1, unavailable: 0, total: 2 });
    expect(next.pending).toBe(1);
  });

  describe('the product of a line (backend 0201)', () => {
    it('applies a buy that names the product of the row', () => {
      const next = applied(
        applyBasketPatch(
          held,
          ['a'],
          [
            patch(milkA, {
              version: 4,
              bought: 1,
              left: 1,
              tripItemId: 'p-milk',
            }),
          ]
        )
      );
      expect(next.rows[0].entries[0].tripItemId).toBe('p-milk');
    });

    it('reads for a buy that names another product', () => {
      expect(
        applyBasketPatch(
          held,
          ['a'],
          [
            patch(milkA, {
              version: 4,
              bought: 1,
              left: 1,
              tripItemId: 'p-oat',
            }),
          ]
        )
      ).toBe(BASKET_PATCH_READ);
    });

    it('applies a buy taken back when the line falls back to the row product', () => {
      const bought = entry('a', { tripItemId: 'p-milk', bought: 1, left: 1 });
      const start = basket([row('a', [bought])]);
      const next = applied(
        applyBasketPatch(
          start,
          ['a'],
          [patch(bought, { version: 4, bought: 0, left: 2, tripItemId: null })]
        )
      );
      expect(next.rows[0].entries[0].tripItemId).toBeNull();
    });

    it('reads for a buy taken back when the line then counts by price', () => {
      const bought = entry('a', {
        itemIds: ['p-milk', 'p-oat'],
        tripItemId: 'p-milk',
        bought: 1,
        left: 1,
      });
      const start = basket([row('a', [bought])]);
      expect(
        applyBasketPatch(
          start,
          ['a'],
          [patch(bought, { version: 4, bought: 0, left: 2, tripItemId: null })]
        )
      ).toBe(BASKET_PATCH_READ);
    });
  });

  describe('the note of a row (section 3)', () => {
    const skip = {
      participantId: 'p-me',
      at: '2026-10-15T09:00:00.000Z',
      outcome: 'SKIPPED',
    };

    it('reads for a patch that changes skipped', () => {
      expect(
        applyBasketPatch(
          held,
          ['a'],
          [
            patch(milkA, {
              version: 4,
              skipped: true,
              state: 'SKIPPED',
              act: skip,
            }),
          ]
        )
      ).toBe(BASKET_PATCH_READ);
    });

    it('drops a skip note once a buy ends the skip', () => {
      const earlier = entry('a', { act: skip });
      const start = basket([
        row('a', [earlier], {
          note: 'SKIPPED_EARLIER',
          noteAt: new Date(skip.at),
        }),
      ]);
      const next = applied(
        applyBasketPatch(
          start,
          ['a'],
          [
            patch(earlier, {
              version: 4,
              left: 1,
              bought: 1,
              state: 'PARTLY',
              act: BUY,
            }),
          ]
        )
      );
      expect(next.rows[0]).toMatchObject({ note: null, noteAt: null });
    });

    it('keeps a skip note while the skip still stands', () => {
      const earlier = entry('a', { act: skip });
      const start = basket([
        row('a', [earlier], {
          note: 'SKIPPED_EARLIER',
          noteAt: new Date(skip.at),
        }),
      ]);
      const next = applied(
        applyBasketPatch(
          start,
          ['a'],
          [patch(earlier, { version: 4, left: 5 })]
        )
      );
      expect(next.rows[0]).toMatchObject({
        left: 5,
        note: 'SKIPPED_EARLIER',
        noteAt: new Date(skip.at),
      });
    });

    it('reads when a skip note that hid a buy made elsewhere goes', () => {
      const earlier = entry('a', { act: skip, boughtElsewhere: 1 });
      const start = basket([
        row('a', [earlier], {
          note: 'SKIPPED_EARLIER',
          noteAt: new Date(skip.at),
        }),
      ]);
      expect(
        applyBasketPatch(
          start,
          ['a'],
          [
            patch(earlier, {
              version: 4,
              left: 1,
              bought: 1,
              state: 'PARTLY',
              act: BUY,
            }),
          ]
        )
      ).toBe(BASKET_PATCH_READ);
    });

    it('reads when what was bought elsewhere moves', () => {
      expect(
        applyBasketPatch(
          held,
          ['a'],
          [patch(milkA, { version: 4, left: 1, boughtElsewhere: 1 })]
        )
      ).toBe(BASKET_PATCH_READ);
    });
  });

  describe('a row bought elsewhere (velista 0142)', () => {
    const at = new Date('2026-10-15T08:00:00.000Z');
    const elsewhere = entry('a', { left: 1, boughtElsewhere: 1 });
    const start = basket([
      row('a', [elsewhere], {
        note: 'BOUGHT_ON_ANOTHER_BASKET',
        noteAt: at,
      }),
      breadRow,
    ]);

    it('crosses a row out when its demand goes to zero, and counts it for nothing', () => {
      const next = applied(
        applyBasketPatch(
          start,
          ['a'],
          [patch(elsewhere, { version: 4, left: 0, state: 'BOUGHT_ELSEWHERE' })]
        )
      );
      expect(next.rows[0]).toMatchObject({
        state: 'BOUGHT_ELSEWHERE',
        note: 'BOUGHT_ON_ANOTHER_BASKET',
        noteAt: at,
      });
      expect(next.progress).toEqual({ done: 0, unavailable: 0, total: 1 });
      expect(next.pending).toBe(1);
    });

    it('brings a crossed out row back when its list asks again', () => {
      const crossed = entry('a', {
        left: 0,
        boughtElsewhere: 1,
        state: 'BOUGHT_ELSEWHERE',
      });
      const from = basket([
        row('a', [crossed], {
          state: 'BOUGHT_ELSEWHERE',
          note: 'BOUGHT_ON_ANOTHER_BASKET',
          noteAt: at,
        }),
      ]);
      const next = applied(
        applyBasketPatch(
          from,
          ['a'],
          [patch(crossed, { version: 4, left: 2, state: 'WANTED' })]
        )
      );
      expect(next.rows[0]).toMatchObject({
        state: 'WANTED',
        note: 'BOUGHT_ON_ANOTHER_BASKET',
      });
      expect(next.progress).toEqual({ done: 0, unavailable: 0, total: 1 });
    });
  });

  it('never touches a REMOVED row', () => {
    const removed = row('r', [], {
      state: 'REMOVED',
      productId: null,
      mark: 'REMOVED',
    });
    const start = basket([milk, removed]);
    const next = applied(
      applyBasketPatch(start, ['a'], [patch(milkA, { version: 4, left: 1 })])
    );
    expect(next.rows[1]).toBe(removed);
  });
});

describe('applyBasketMarks', () => {
  const removed = row('r', [], {
    state: 'REMOVED',
    productId: null,
    mark: 'REMOVED',
  });
  const start = basket([
    row('a', [entry('a'), entry('b')], { mark: 'CHANGED' }),
    row('c', [entry('c')]),
    row('d', [entry('d')], { mark: 'CHANGED' }),
    removed,
  ]);

  it('marks each row by its lines, ADDED over CHANGED, and replaces the numbers', () => {
    const next = applyBasketMarks(start, {
      unseenChangeCount: 3,
      newestUnseenChangeId: 'ch-9',
      lines: new Map([
        ['a', 'CHANGED'],
        ['b', 'ADDED'],
        ['c', 'CHANGED'],
      ]),
    });
    expect(next.rows.map((held) => held.mark)).toEqual([
      'ADDED',
      'CHANGED',
      null,
      'REMOVED',
    ]);
    expect(next.rows[3]).toBe(removed);
    expect(next.unseenChangeCount).toBe(3);
    expect(next.newestUnseenChangeId).toBe('ch-9');
  });

  it('keeps a row whose mark did not move as the same object', () => {
    const next = applyBasketMarks(start, {
      unseenChangeCount: 1,
      newestUnseenChangeId: 'ch-1',
      lines: new Map([['d', 'CHANGED']]),
    });
    expect(next.rows[2]).toBe(start.rows[2]);
  });
});
