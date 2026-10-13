import {
  BasketRowMark,
  BasketRowState,
  BUY_CHANGE_KINDS,
  LineApprovalStatus,
  LineChangeKind,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { BasketLineKeys } from '../basket-line-keys';
import type { BasketSettlementRow } from '../basket-read.sql';
import type { ChangeLineRow, ChangeRow } from './basket-changes.sql';
import { foldMarks, foldRemoved, type LineKeyOf } from './basket-marks.reader';
import { removedRows } from './basket-removed-rows';

/**
 * How changes become a mark per row, and a row per removal (plan 0138, section
 * 7; plan 0203, sections 6 and 7).
 *
 * The two folds are pure, so the table of section 7 is stated here as a table.
 * What needs a database is which changes are still **marked** for one viewer,
 * and which change removed a line inside the window. Both are comparisons of
 * database times and are proven against Postgres.
 */

let seq = 0;

function line(over: Partial<ChangeLineRow> = {}): ChangeLineRow {
  seq += 1;
  return {
    id: `ll-${seq}`,
    listId: 'list-a',
    content: 'Milk',
    quantity: 2,
    version: 1,
    itemSetHash: null,
    favoriteItemId: null,
    approvalStatus: LineApprovalStatus.APPROVED,
    createdAt: new Date(2026, 0, seq),
    ...over,
  };
}

/**
 * The key of a line that holds no product, which is its normalized name.
 *
 * A caller hands the folds its own keys since plan 0201, because the key is
 * the product a line counts as and only the caller read the products. A line
 * these keys were never handed falls to its text, which is every line of the
 * cases that are not about a product.
 */
const textKey: LineKeyOf = new BasketLineKeys().keyOf;

/** The keys of lines that hold products, as a read with no picks keys them. */
function keysWith(products: Record<string, string[]>, lines: ChangeLineRow[]) {
  return new BasketLineKeys().add(
    lines.map((row) => ({
      lineId: row.id,
      content: row.content,
      itemIds: products[row.id] ?? [],
      favoriteItemId: row.favoriteItemId,
      tripItemId: null,
    }))
  ).keyOf;
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

/**
 * Both folds over one set of changes, newest first, as the reads answer them.
 *
 * The removals are the changes that the statement would select: not a merge and
 * not a buy. Each is marked when it is unseen, which is the case of a viewer
 * who acknowledged nothing.
 */
function fold(
  marked: ChangeRow[],
  covered: ChangeLineRow[],
  extra: ChangeLineRow[] = [],
  keyOf: LineKeyOf = textKey
) {
  const lines = new Map([...covered, ...extra].map((row) => [row.id, row]));
  const newestFirst = [...marked].reverse();
  const removing = newestFirst
    .filter(
      (row) =>
        row.kind !== LineChangeKind.MERGED &&
        !BUY_CHANGE_KINDS.includes(row.kind)
    )
    .map(({ unseen, ...row }) => ({ ...row, marked: unseen }));
  return {
    byKey: foldMarks(newestFirst, covered, lines, keyOf).byKey,
    removed: foldRemoved(removing, covered, lines, keyOf),
  };
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

    expect(byKey.get(textKey(milk))).toBe(BasketRowMark.CHANGED);
  });

  it('is ADDED when it was put on the list', () => {
    const milk = line();

    const { byKey } = fold(
      [change({ lineId: milk.id, kind: LineChangeKind.ADDED })],
      [milk]
    );

    expect(byKey.get(textKey(milk))).toBe(BasketRowMark.ADDED);
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

    expect(byKey.get(textKey(milk))).toBe(BasketRowMark.ADDED);
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

    expect(byKey.get(textKey(milk))).toBe(BasketRowMark.ADDED);
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

    expect(byKey.get(textKey(milk))).toBe(BasketRowMark.ADDED);
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

    expect(byKey.get(textKey(flat))).toBe(BasketRowMark.CHANGED);
    expect(byKey.size).toBe(1);
  });
});

describe('a buy and a taken back buy (plan 0203, section 7)', () => {
  it('is CHANGED on the row that holds the line', () => {
    const milk = line({ quantity: 0 });

    const { byKey, removed } = fold(
      [
        change({
          lineId: milk.id,
          kind: LineChangeKind.BOUGHT,
          quantityBefore: 2,
          quantityAfter: 0,
        }),
      ],
      [milk]
    );

    expect(byKey.get(textKey(milk))).toBe(BasketRowMark.CHANGED);
    expect(removed).toEqual([]);
  });

  it('is CHANGED when the units came back off zero, and not ADDED', () => {
    // A quantity raised off zero by an edit is a new thing to buy. A buy taken
    // back is the same row with its units again.
    const milk = line();

    const { byKey } = fold(
      [
        change({
          lineId: milk.id,
          kind: LineChangeKind.BUY_REVERTED,
          quantityBefore: 0,
          quantityAfter: 2,
        }),
      ],
      [milk]
    );

    expect(byKey.get(textKey(milk))).toBe(BasketRowMark.CHANGED);
  });

  it('leaves ADDED on a row that was added and then bought', () => {
    const milk = line();

    const { byKey } = fold(
      [
        change({
          lineId: milk.id,
          kind: LineChangeKind.BOUGHT,
          quantityBefore: 2,
          quantityAfter: 1,
        }),
        change({ lineId: milk.id, kind: LineChangeKind.ADDED }),
      ],
      [milk]
    );

    expect(byKey.get(textKey(milk))).toBe(BasketRowMark.ADDED);
  });

  it('says nothing about a line that is no row any more', () => {
    // The outside buy left its window, so the line is not covered. A buy never
    // removes a row, and it marks no neighbour either.
    const flat = line({ listId: 'list-a', content: 'Milk' });
    const parents = line({
      id: 'll-bought',
      listId: 'list-b',
      content: 'Milk',
      quantity: 0,
    });

    const { byKey, removed } = fold(
      [
        change({
          lineId: parents.id,
          listId: 'list-b',
          kind: LineChangeKind.BOUGHT,
          quantityBefore: 1,
          quantityAfter: 0,
        }),
      ],
      [flat],
      [parents]
    );

    expect(byKey.size).toBe(0);
    expect(removed).toEqual([]);
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

    expect(byKey.get(textKey(survivor))).toBe(BasketRowMark.CHANGED);
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
        key: textKey(gone),
        rowKey: gone.id,
        content: 'Olives',
        lineIds: [gone.id],
        marked: true,
      },
    ]);
    expect(byKey.size).toBe(0);
  });

  it('is still a row after its mark is gone', () => {
    // Six hours from the change, whatever the viewer acknowledged (plan 0203,
    // section 6). The fold is handed a removal that is no longer marked.
    const gone = line({ id: 'll-gone', content: 'Olives' });

    const { removed } = fold(
      [
        change({
          lineId: gone.id,
          kind: LineChangeKind.DELETED,
          contentBefore: 'Olives',
          unseen: false,
        }),
      ],
      [],
      [gone]
    );

    expect(removed).toHaveLength(1);
    expect(removed[0].marked).toBe(false);
  });

  it('is no removed row when the line is covered again', () => {
    // Taken to zero and raised since: an ordinary row.
    const back = line({ content: 'Olives', quantity: 1 });

    const { removed } = fold(
      [
        change({
          lineId: back.id,
          kind: LineChangeKind.QUANTITY_CHANGED,
          quantityBefore: 2,
          quantityAfter: 0,
        }),
      ],
      [back]
    );

    expect(removed).toEqual([]);
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
    expect(byKey.get(textKey(flat))).toBe(BasketRowMark.CHANGED);
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

describe('a mark belongs to the product a line counts as (plan 0201)', () => {
  it('marks the one row of two lines that count as one product', () => {
    // Two households, two names and two sets, one carton. A change to either
    // marks the one row.
    const flat = line({ listId: 'list-a', content: 'Milk' });
    const parents = line({ listId: 'list-b', content: 'Leche' });
    const keyOf = keysWith({ [flat.id]: ['i1'], [parents.id]: ['i1', 'i2'] }, [
      flat,
      parents,
    ]);

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
      [flat, parents],
      [],
      keyOf
    );

    expect([...byKey]).toEqual([['item:i1', BasketRowMark.CHANGED]]);
  });

  it('does not mark a row of the same name that counts as another product', () => {
    const pascual = line({ listId: 'list-a', content: 'Milk' });
    const puleva = line({ listId: 'list-b', content: 'Milk' });
    const keyOf = keysWith({ [pascual.id]: ['i1'], [puleva.id]: ['i2'] }, [
      pascual,
      puleva,
    ]);

    const { byKey } = fold(
      [change({ lineId: puleva.id, kind: LineChangeKind.ADDED })],
      [pascual, puleva],
      [],
      keyOf
    );

    expect([...byKey]).toEqual([['item:i2', BasketRowMark.ADDED]]);
  });

  it('passes the mark of a line that left to the row its product is still on', () => {
    // The names differ, so before plan 0201 this was a disabled row.
    const flat = line({ listId: 'list-a', content: 'Milk' });
    const gone = line({ id: 'll-gone', listId: 'list-b', content: 'Leche' });
    const keyOf = keysWith({ [flat.id]: ['i1'], [gone.id]: ['i1'] }, [
      flat,
      gone,
    ]);

    const { byKey, removed } = fold(
      [
        change({
          lineId: gone.id,
          listId: 'list-b',
          kind: LineChangeKind.DELETED,
          contentBefore: 'Leche',
        }),
      ],
      [flat],
      [gone],
      keyOf
    );

    expect(removed).toEqual([]);
    expect(byKey.get('item:i1')).toBe(BasketRowMark.CHANGED);
  });

  it('draws a disabled row for a line that left when only its name is still covered', () => {
    // The covered "Milk" counts as another product, so the thing that went is
    // no longer in the basket.
    const flat = line({ listId: 'list-a', content: 'Milk' });
    const gone = line({ id: 'll-gone', listId: 'list-b', content: 'Milk' });
    const keyOf = keysWith({ [flat.id]: ['i1'], [gone.id]: ['i2'] }, [
      flat,
      gone,
    ]);

    const { byKey, removed } = fold(
      [
        change({
          lineId: gone.id,
          listId: 'list-b',
          kind: LineChangeKind.DELETED,
          contentBefore: 'Milk',
        }),
      ],
      [flat],
      [gone],
      keyOf
    );

    expect(byKey.size).toBe(0);
    expect(removed).toEqual([
      {
        key: 'item:i2',
        rowKey: gone.id,
        content: 'Milk',
        lineIds: [gone.id],
        marked: true,
      },
    ]);
  });
});

describe('the disabled row itself', () => {
  const removed = [
    {
      key: 'text:olives',
      rowKey: 'll-1',
      content: 'Olives',
      lineIds: ['ll-1'],
      marked: true,
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
      itemId: null,
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
      // A removed row holds no entries, so it counts as no product.
      productId: null,
    });
    expect(row).not.toHaveProperty('optionIds');
  });

  it('keeps its state and loses its mark when the removal is not marked', () => {
    const [row] = removedRows([{ ...removed[0], marked: false }], []);

    expect(row.state).toBe(BasketRowState.REMOVED);
    expect(row.mark).toBeNull();
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
