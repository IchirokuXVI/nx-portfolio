import {
  BasketRowMark,
  BasketRowState,
  LineApprovalStatus,
  LineChangeKind,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import type { BasketSettlementRow } from '../basket-read.sql';
import { mergeKey } from '../line-dedup';
import type { ChangeLineRow, ChangeRow } from './basket-changes.sql';
import { foldMarks } from './basket-marks.reader';
import { removedRows } from './basket-removed-rows';

/**
 * How changes become a mark per row, and a row per removal (plan 0138, section
 * 7).
 *
 * The fold is pure, so the table of section 7 is stated here as a table. What it
 * needs a database for is which changes are still **marked** for one viewer, which
 * is a comparison of four database times and is proven against Postgres.
 */

let seq = 0;

function line(over: Partial<ChangeLineRow> = {}): ChangeLineRow {
  seq += 1;
  return {
    id: `ll-${seq}`,
    listId: 'list-a',
    content: 'Milk',
    quantity: 2,
    itemSetHash: null,
    approvalStatus: LineApprovalStatus.APPROVED,
    createdAt: new Date(2026, 0, seq),
    ...over,
  };
}

function change(
  over: Partial<ChangeRow> & Pick<ChangeRow, 'lineId' | 'kind'>
): ChangeRow {
  seq += 1;
  return {
    id: `ch-${seq}`,
    createdAt: new Date(2026, 1, seq),
    listId: 'list-a',
    contentBefore: null,
    contentAfter: null,
    quantityBefore: null,
    quantityAfter: null,
    approvalBefore: null,
    approvalAfter: null,
    mergedIntoLineId: null,
    unseen: true,
    ...over,
  };
}

/** The fold takes the marked changes newest first, as the read answers them. */
function fold(
  marked: ChangeRow[],
  covered: ChangeLineRow[],
  extra: ChangeLineRow[] = []
) {
  const lines = new Map([...covered, ...extra].map((row) => [row.id, row]));
  return foldMarks([...marked].reverse(), covered, lines);
}

describe('a line that is still in the basket', () => {
  it('is CHANGED by a quantity that moved between two positive numbers', () => {
    const milk = line();

    const { byKey } = fold(
      [
        change({
          lineId: milk.id,
          kind: LineChangeKind.QUANTITY_CHANGED,
          quantityBefore: 2,
          quantityAfter: 3,
        }),
      ],
      [milk]
    );

    expect(byKey.get(mergeKey(milk))).toBe(BasketRowMark.CHANGED);
  });

  it('is ADDED when it was put on the list', () => {
    const milk = line();

    const { byKey } = fold(
      [change({ lineId: milk.id, kind: LineChangeKind.ADDED })],
      [milk]
    );

    expect(byKey.get(mergeKey(milk))).toBe(BasketRowMark.ADDED);
  });

  it('is ADDED when a quantity came back off zero', () => {
    // The line entered the coverage, which is a new thing to buy rather than a
    // number that moved: the shopper was never shown it before.
    const milk = line();

    const { byKey } = fold(
      [
        change({
          lineId: milk.id,
          kind: LineChangeKind.QUANTITY_CHANGED,
          quantityBefore: 0,
          quantityAfter: 2,
        }),
      ],
      [milk]
    );

    expect(byKey.get(mergeKey(milk))).toBe(BasketRowMark.ADDED);
  });

  it('is ADDED when a rejection was lifted', () => {
    const milk = line();

    const { byKey } = fold(
      [
        change({
          lineId: milk.id,
          kind: LineChangeKind.APPROVAL_CHANGED,
          approvalBefore: LineApprovalStatus.REJECTED,
          approvalAfter: LineApprovalStatus.PENDING,
        }),
      ],
      [milk]
    );

    expect(byKey.get(mergeKey(milk))).toBe(BasketRowMark.ADDED);
  });

  it('keeps ADDED when the line was added and then raised', () => {
    // One mark per row, and "new" is the more useful of the two things to say.
    const milk = line();

    const { byKey } = fold(
      [
        change({
          lineId: milk.id,
          kind: LineChangeKind.QUANTITY_CHANGED,
          quantityBefore: 1,
          quantityAfter: 4,
        }),
        change({ lineId: milk.id, kind: LineChangeKind.ADDED }),
      ],
      [milk]
    );

    expect(byKey.get(mergeKey(milk))).toBe(BasketRowMark.ADDED);
  });

  it('marks the row of a line another household shares the name with', () => {
    // Two lists' milk is one row, so a change to either marks the one row.
    const flat = line({ listId: 'list-a', content: 'Milk' });
    const parents = line({ listId: 'list-b', content: 'milk' });

    const { byKey } = fold(
      [
        change({
          lineId: parents.id,
          listId: 'list-b',
          kind: LineChangeKind.QUANTITY_CHANGED,
          quantityBefore: 1,
          quantityAfter: 2,
        }),
      ],
      [flat, parents]
    );

    expect(byKey.get(mergeKey(flat))).toBe(BasketRowMark.CHANGED);
    expect(byKey.size).toBe(1);
  });
});

describe('a merge', () => {
  it('marks the survivor and never draws the absorbed line', () => {
    const survivor = line({ content: 'Milk' });
    const gone = line({ id: 'll-gone', content: 'Leche' });

    const { byKey, removed } = fold(
      [
        change({
          lineId: gone.id,
          kind: LineChangeKind.MERGED,
          mergedIntoLineId: survivor.id,
          contentBefore: 'Leche',
          contentAfter: 'Milk',
        }),
      ],
      [survivor],
      [gone]
    );

    expect(byKey.get(mergeKey(survivor))).toBe(BasketRowMark.CHANGED);
    // Its `lineId` names no row, so nothing says a thing left the basket.
    expect(removed).toEqual([]);
  });

  it('says nothing at all when the survivor is not covered either', () => {
    // A chain of merges inside one window marks the last survivor and loses the
    // first hop, which the plan accepts.
    const gone = line({ id: 'll-gone' });
    const alsoGone = line({ id: 'll-also-gone' });

    const { byKey, removed } = fold(
      [
        change({
          lineId: gone.id,
          kind: LineChangeKind.MERGED,
          mergedIntoLineId: alsoGone.id,
        }),
      ],
      [],
      [gone, alsoGone]
    );

    expect(byKey.size).toBe(0);
    expect(removed).toEqual([]);
  });
});

describe('a line that left the basket', () => {
  it('is one disabled row when no covered row carries its name', () => {
    const gone = line({ id: 'll-gone', content: 'Olives' });

    const { byKey, removed } = fold(
      [
        change({
          lineId: gone.id,
          kind: LineChangeKind.DELETED,
          contentBefore: 'Olives',
          quantityBefore: 2,
        }),
      ],
      [],
      [gone]
    );

    expect(removed).toEqual([
      {
        key: mergeKey(gone),
        rowKey: gone.id,
        content: 'Olives',
        lineIds: [gone.id],
      },
    ]);
    expect(byKey.size).toBe(0);
  });

  it('marks the covered row instead when one shares its name', () => {
    // One of the row's entries went and its `left` fell. The thing is still in
    // the basket, because another household still asks for it.
    const flat = line({ listId: 'list-a', content: 'Milk' });
    const parents = line({ id: 'll-gone', listId: 'list-b', content: 'Milk' });

    const { byKey, removed } = fold(
      [
        change({
          lineId: parents.id,
          listId: 'list-b',
          kind: LineChangeKind.DELETED,
          contentBefore: 'Milk',
        }),
      ],
      [flat],
      [parents]
    );

    expect(removed).toEqual([]);
    expect(byKey.get(mergeKey(flat))).toBe(BasketRowMark.CHANGED);
  });

  it('folds two households leaving one thing into one row, the earliest named', () => {
    const first = line({
      id: 'll-first',
      listId: 'list-a',
      content: 'Olives',
      createdAt: new Date(2026, 0, 1),
    });
    const second = line({
      id: 'll-second',
      listId: 'list-b',
      content: 'olives',
      createdAt: new Date(2026, 0, 5),
    });

    const { removed } = fold(
      [
        change({
          lineId: second.id,
          listId: 'list-b',
          kind: LineChangeKind.DELETED,
          contentBefore: 'olives',
        }),
        change({
          lineId: first.id,
          kind: LineChangeKind.DELETED,
          contentBefore: 'Olives',
        }),
      ],
      [],
      [first, second]
    );

    expect(removed).toHaveLength(1);
    expect(removed[0].rowKey).toBe(first.id);
    expect(removed[0].content).toBe('Olives');
    expect(removed[0].lineIds.sort()).toEqual([first.id, second.id]);
  });

  it('takes the text from the line when the change recorded none', () => {
    // A demand taken to zero moves no text, and the row still has to be called
    // something.
    const gone = line({ id: 'll-gone', content: 'Capers' });

    const { removed } = fold(
      [
        change({
          lineId: gone.id,
          kind: LineChangeKind.QUANTITY_CHANGED,
          quantityBefore: 2,
          quantityAfter: 0,
        }),
      ],
      [],
      [gone]
    );

    expect(removed[0].content).toBe('Capers');
  });

  it('is dropped when the line is gone from the database entirely', () => {
    const { byKey, removed } = fold(
      [change({ lineId: 'll-vanished', kind: LineChangeKind.DELETED })],
      []
    );

    expect(byKey.size).toBe(0);
    expect(removed).toEqual([]);
  });
});

describe('the disabled row itself', () => {
  const removed = [
    {
      key: 'text:olives',
      rowKey: 'll-1',
      content: 'Olives',
      lineIds: ['ll-1'],
    },
  ];

  function settlement(over: Partial<BasketSettlementRow>): BasketSettlementRow {
    return {
      id: 's-1',
      lineId: 'll-1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
      settledAt: new Date(2026, 0, 1, 10),
      settledByParticipantId: 'p-1',
      fresh: true,
      ...over,
    };
  }

  it('counts toward nothing and holds no entries', () => {
    const [row] = removedRows(removed, []);

    expect(row).toMatchObject({
      rowKey: 'll-1',
      content: 'Olives',
      left: 0,
      bought: 0,
      asked: 0,
      state: BasketRowState.REMOVED,
      mark: BasketRowMark.REMOVED,
      awaitingApproval: false,
      note: null,
      entries: [],
      optionIds: [],
    });
  });

  it('keeps what the basket bought of the line that went', () => {
    const [row] = removedRows(removed, [
      settlement({ id: 's-1', quantity: 2 }),
      settlement({
        id: 's-2',
        quantity: 5,
        outcome: SettlementOutcome.NOT_AVAILABLE,
      }),
    ]);

    // The close contributes no units, as everywhere else.
    expect(row.bought).toBe(2);
    expect(row.asked).toBe(2);
  });

  it('says who last did something to it', () => {
    const [row] = removedRows(removed, [
      settlement({ id: 's-1', settledAt: new Date(2026, 0, 1, 9) }),
      settlement({
        id: 's-2',
        settledAt: new Date(2026, 0, 1, 11),
        settledByParticipantId: 'marta',
      }),
    ]);

    expect(row.touchedBy).toBe('marta');
    expect(row.touchedAt).toBe(new Date(2026, 0, 1, 11).toISOString());
  });

  it('ignores the purchases of lines it is not about', () => {
    const [row] = removedRows(removed, [
      settlement({ lineId: 'll-other', quantity: 9 }),
    ]);

    expect(row.bought).toBe(0);
    expect(row.touchedBy).toBeNull();
  });
});
