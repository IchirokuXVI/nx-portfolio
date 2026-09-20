import {
  BasketRowState,
  LineApprovalStatus,
  ListPermission,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import { canChangeDemand } from '../lists/list-acts';
import {
  allocateOldestFirst,
  boughtOf,
  groupEntries,
  newestSettlement,
  optionIdsOf,
  progressOf,
  stateOf,
  toRowView,
  type BasketEntry,
  type BasketSettlementFact,
} from './basket-rows';

/**
 * The rules of a basket row, stated rather than mocked (plan 0136, section 13).
 *
 * Every function under test is pure, which is the whole reason they are free
 * functions: a basket's numbers are recomputed on every request now, so a wrong
 * grouping or a wrong state is a wrong screen for everybody rather than a wrong
 * row in a table somebody can go and look at.
 */

let seq = 0;

function entry(over: Partial<BasketEntry> = {}): BasketEntry {
  seq += 1;
  return {
    lineId: `line-${seq}`,
    listId: 'list-a',
    content: 'Milk',
    quantity: 1,
    itemSetHash: null,
    approvalStatus: LineApprovalStatus.APPROVED,
    // Distinct and increasing, so `(createdAt, id)` has one answer.
    createdAt: new Date(2026, 0, 1, 0, 0, seq),
    itemIds: [],
    settlements: [],
    ...over,
  };
}

function bought(quantity: number, over: Partial<BasketSettlementFact> = {}) {
  seq += 1;
  return {
    id: `s-${seq}`,
    outcome: SettlementOutcome.BOUGHT,
    quantity,
    settledAt: new Date(2026, 0, 1, 10, 0, seq),
    settledByParticipantId: 'p1',
    ...over,
  };
}

function closed(over: Partial<BasketSettlementFact> = {}) {
  return bought(0, { outcome: SettlementOutcome.NOT_AVAILABLE, ...over });
}

/** Every list served, and the owner may move any demand. */
const OPEN_CONTEXT = {
  servedListIds: new Set(['list-a', 'list-b']),
  demandEditable: (row: BasketEntry) =>
    canChangeDemand(new Set([ListPermission.MANAGE]), row.approvalStatus),
};

describe('grouping (section 3.1, step 5)', () => {
  it('folds two lists’ lines that name one product into one row', () => {
    // The point of the feature: "Milk" on the flat's list and on the parents'
    // list is one thing to pick off one shelf. They merge on the **set**, which
    // is an identity rather than a spelling, so "leche" and "Milk" meet here.
    const groups = groupEntries([
      entry({ listId: 'list-a', content: 'Milk', itemSetHash: 'h1' }),
      entry({ listId: 'list-b', content: 'leche', itemSetHash: 'h1' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((row) => row.listId)).toEqual([
      'list-a',
      'list-b',
    ]);
  });

  it('folds a free text pair by normalizeContent', () => {
    // The busiest kind of line in the product, and the reason the text rule
    // exists at all: no product set, so the fold is the normalized name.
    const groups = groupEntries([
      entry({ content: 'Jamón' }),
      entry({ content: 'jamon' }),
    ]);

    expect(groups).toHaveLength(1);
  });

  it('keeps two different product sets apart', () => {
    const groups = groupEntries([
      entry({ content: 'Milk', itemSetHash: 'h1' }),
      entry({ content: 'Milk', itemSetHash: 'h2' }),
    ]);

    // A hash never collides with typed text, which is what the `set:` and
    // `text:` namespaces buy, and two different sets are two different things.
    expect(groups).toHaveLength(2);
  });

  it('anchors a row on its earliest line', () => {
    const older = entry({ content: 'Milk', createdAt: new Date(2026, 0, 1) });
    const newer = entry({ content: 'milk', createdAt: new Date(2026, 0, 2) });

    // `COVERED_LINES_SQL` orders by `(createdAt, id)`, so the oldest ask for a
    // thing is the first entry and therefore names the row.
    const [group] = groupEntries([older, newer]);
    expect(group.anchor).toBe(older);
    expect(toRowView(group, OPEN_CONTEXT).rowKey).toBe(older.lineId);
  });
});

describe('the four states this plan produces (plan 0130, section 4)', () => {
  it('is WANTED with nothing bought', () => {
    expect(stateOf(2, 0, null)).toBe(BasketRowState.WANTED);
  });

  it('is PARTLY with both above zero', () => {
    expect(stateOf(1, 1, bought(1))).toBe(BasketRowState.PARTLY);
  });

  it('is DONE at zero left with something bought', () => {
    expect(stateOf(0, 2, bought(2))).toBe(BasketRowState.DONE);
  });

  it('is NOT_AVAILABLE when the newest act says so and units remain', () => {
    expect(stateOf(2, 0, closed())).toBe(BasketRowState.NOT_AVAILABLE);
  });

  it('is DONE rather than NOT_AVAILABLE once nothing is left', () => {
    // The guard plan 0136 section 3.1 step 7 adds to the table's order. A
    // demand taken to zero after a close would otherwise leave the row claiming
    // the shop had none of something nobody is asking for.
    expect(stateOf(0, 1, closed())).toBe(BasketRowState.DONE);
  });

  it('breaks a tie between two settlements of one act on the id', () => {
    // One `NOT_AVAILABLE` settle writes a row per entry with the same
    // `settledAt`. Without the tie break "what did the last act say" would have
    // no answer on the ordinary two household row.
    const at = new Date(2026, 0, 1, 12, 0, 0);
    const rows = [
      entry({ settlements: [bought(1, { id: 'a', settledAt: at })] }),
      entry({ settlements: [closed({ id: 'b', settledAt: at })] }),
    ];

    expect(newestSettlement(rows)?.id).toBe('b');
  });
});

describe('the arithmetic (plan 0130, section 4)', () => {
  it('sums a row from its entries and never stores asked', () => {
    const group = groupEntries([
      entry({ listId: 'list-a', content: 'Milk', quantity: 2 }),
      entry({
        listId: 'list-b',
        content: 'Milk',
        quantity: 1,
        settlements: [bought(1)],
      }),
    ])[0];

    const row = toRowView(group, OPEN_CONTEXT);
    expect(row.left).toBe(3);
    expect(row.bought).toBe(1);
    // Computed, every time, from the other two.
    expect(row.asked).toBe(row.bought + row.left);
    expect(row.state).toBe(BasketRowState.PARTLY);
  });

  it('counts only BOUGHT units toward bought', () => {
    // A row saying the shop did not have it is an outcome rather than a
    // quantity, so it carries no units to sum.
    expect(boughtOf(entry({ settlements: [closed(), bought(2)] }))).toBe(2);
  });

  it('counts a mixed basket', () => {
    const rows = [
      toRowView(groupEntries([entry({ content: 'a', quantity: 2 })])[0], OPEN_CONTEXT),
      toRowView(
        groupEntries([
          entry({ content: 'b', quantity: 0, settlements: [bought(1)] }),
        ])[0],
        OPEN_CONTEXT
      ),
      toRowView(
        groupEntries([
          entry({ content: 'c', quantity: 1, settlements: [closed()] }),
        ])[0],
        OPEN_CONTEXT
      ),
    ];

    // `pending` is `total - done - unavailable` and means this count alone: a
    // row waiting for the household's approval is `awaitingApproval` instead.
    expect(progressOf(rows)).toEqual({
      done: 1,
      unavailable: 1,
      total: 3,
      pending: 1,
    });
  });

  it('says a row is awaiting approval when any entry is PENDING', () => {
    const group = groupEntries([
      entry({ content: 'Milk', approvalStatus: LineApprovalStatus.APPROVED }),
      entry({ content: 'Milk', approvalStatus: LineApprovalStatus.PENDING }),
    ])[0];

    expect(toRowView(group, OPEN_CONTEXT).awaitingApproval).toBe(true);
  });

  it('unions the entries’ products, anchor first and deduplicated', () => {
    // Two households may each have attached a different carton, and the shopper
    // at the shelf is choosing between all of them. A picker offering the same
    // product twice is a bug the shopper sees.
    const rows = [
      entry({ itemIds: ['i1', 'i2'] }),
      entry({ itemIds: ['i2', 'i3'] }),
    ];

    expect(optionIdsOf(rows)).toEqual(['i1', 'i2', 'i3']);
  });
});

describe('allocateOldestFirst (plan 0051, section 6.2)', () => {
  it('fills the oldest entry first', () => {
    const first = entry({ quantity: 2 });
    const second = entry({ quantity: 1 });

    const plan = allocateOldestFirst([first, second], 2);
    expect(plan.get(first)).toBe(2);
    expect(plan.get(second)).toBe(0);
  });

  it('puts the excess on the last entry', () => {
    // More bought than the row asked for is not an error (plan 0047, section
    // 4.2): the extra unit is real and belongs in the consumption history even
    // though it had no demand to satisfy.
    const first = entry({ quantity: 1 });
    const second = entry({ quantity: 1 });

    const plan = allocateOldestFirst([first, second], 5);
    expect(plan.get(first)).toBe(1);
    expect(plan.get(second)).toBe(4);
  });

  it('is the obvious answer on a row with one entry', () => {
    const only = entry({ quantity: 3 });
    expect(allocateOldestFirst([only], 2).get(only)).toBe(2);
  });
});

describe('redaction, per list (section 3.4)', () => {
  const group = groupEntries([
    entry({ listId: 'list-a', content: 'Milk' }),
    entry({ listId: 'list-b', content: 'Milk' }),
  ])[0];

  function servedBy(listIds: string[]) {
    return toRowView(group, {
      servedListIds: new Set(listIds),
      demandEditable: () => true,
    });
  }

  it('names every list for the owner', () => {
    // The owner writes every covered list by construction: coverage is defined
    // as the lists the owner can write.
    expect(servedBy(['list-a', 'list-b']).entries.map((e) => e.listId)).toEqual(
      ['list-a', 'list-b']
    );
  });

  it('names only the lists a registered reader writes themselves', () => {
    const entries = servedBy(['list-a']).entries;
    expect(entries[0].listId).toBe('list-a');
    // **Absent rather than null**, which is the whole shape of the rule: a
    // reader cannot tell "a list you may not see" from "no list", and nothing
    // downstream is trusted to hide a value it was handed.
    expect('listId' in entries[1]).toBe(false);
  });

  it('names no list for a guest, and still serves the entries', () => {
    const row = servedBy([]);
    expect(row.entries.every((e) => !('listId' in e))).toBe(true);
    // A guest sees that there are two entries and how much each asks for. That
    // a row comes from two households is already visible as a quantity two
    // settles reach, and it names nobody.
    expect(row.entries).toHaveLength(2);
    expect(row.left).toBe(2);
  });
});

describe('demandEditable is the owner’s answer (plan 0131)', () => {
  it('refuses an approved line to a WRITE holder and allows a pending one', () => {
    // The rule is asked of the **owner** and served because no client can
    // compute it: a reader never learns the owner's permissions, and a guest
    // has none of their own to ask about.
    const context = {
      servedListIds: new Set(['list-a']),
      demandEditable: (row: BasketEntry) =>
        canChangeDemand(new Set([ListPermission.WRITE]), row.approvalStatus),
    };
    const group = groupEntries([
      entry({ content: 'Milk', approvalStatus: LineApprovalStatus.APPROVED }),
      entry({ content: 'Milk', approvalStatus: LineApprovalStatus.PENDING }),
    ])[0];

    const entries = toRowView(group, context).entries;
    expect(entries[0].demandEditable).toBe(false);
    expect(entries[1].demandEditable).toBe(true);
  });
});

describe('what the row says about who touched it', () => {
  it('names the newest standing act and when', () => {
    const at = new Date(2026, 0, 1, 18, 30, 0);
    const group = groupEntries([
      entry({
        content: 'Milk',
        settlements: [
          bought(1, { settledByParticipantId: 'old', settledAt: new Date(2026, 0, 1, 9) }),
          bought(1, { settledByParticipantId: 'new', settledAt: at }),
        ],
      }),
    ])[0];

    const row = toRowView(group, OPEN_CONTEXT);
    expect(row.touchedBy).toBe('new');
    expect(row.touchedAt).toBe(at.toISOString());
  });

  it('says nothing about a row nobody has touched', () => {
    const group = groupEntries([entry()])[0];
    const row = toRowView(group, OPEN_CONTEXT);
    expect(row.touchedBy).toBeNull();
    expect(row.touchedAt).toBeNull();
    // Both arrive with plans 0137 and 0138; the fields exist so those plans
    // change a value rather than the wire shape.
    expect(row.note).toBeNull();
    expect(row.noteAt).toBeNull();
    expect(row.mark).toBeNull();
  });
});
