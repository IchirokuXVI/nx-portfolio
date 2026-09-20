import {
  BasketKind,
  BasketRowNote,
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
  noteOf,
  NO_BASKET_SKIPS,
  NO_ROW_MARKS,
  optionIdsOf,
  progressOf,
  stateOf,
  toRowView,
  type BasketEntry,
  type BasketFacts,
  type BasketSettlementFact,
  type BasketSkipFact,
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

function bought(
  quantity: number,
  over: Partial<BasketSettlementFact> = {}
): BasketSettlementFact {
  seq += 1;
  return {
    id: `s-${seq}`,
    outcome: SettlementOutcome.BOUGHT,
    quantity,
    settledAt: new Date(2026, 0, 1, 10, 0, seq),
    settledByParticipantId: 'p1',
    // The database answered it (plan 0137, section 4). These rules receive
    // booleans and never a clock, which is what lets a spec state "the window
    // ran out" without moving anybody's time.
    fresh: true,
    ...over,
  };
}

/** One line's standing skip, as the read hands it to these rules. */
function skip(over: Partial<BasketSkipFact> = {}): BasketSkipFact {
  seq += 1;
  return {
    skippedAt: new Date(2026, 0, 1, 11, 0, seq),
    skippedByParticipantId: 'p2',
    fresh: true,
    ...over,
  };
}

/** A `GENERATED` basket with these lines skipped and nothing else. */
function facts(
  skips: Record<string, BasketSkipFact> = {},
  kind: BasketKind = BasketKind.GENERATED
): BasketFacts {
  return { skips: new Map(Object.entries(skips)), kind };
}

/** Nothing skipped, on a trip. The state of a basket before plan 0137. */
const NO_FACTS: BasketFacts = {
  skips: NO_BASKET_SKIPS,
  kind: BasketKind.GENERATED,
};

function closed(over: Partial<BasketSettlementFact> = {}) {
  return bought(0, { outcome: SettlementOutcome.NOT_AVAILABLE, ...over });
}

/** Every list served, and the owner may move any demand. */
const OPEN_CONTEXT = {
  servedListIds: new Set(['list-a', 'list-b']),
  demandEditable: (row: BasketEntry) =>
    canChangeDemand(new Set([ListPermission.MANAGE]), row.approvalStatus),
  facts: NO_FACTS,
  // Nothing has changed since this reader looked (plan 0138). The marks have
  // their own file, where the fold that fills this map is stated as a table.
  marks: NO_ROW_MARKS,
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

describe('the states of a row (plan 0130, section 4)', () => {
  it('is WANTED with nothing bought', () => {
    expect(stateOf([entry({ quantity: 2 })], 2, 0, null, NO_FACTS)).toBe(
      BasketRowState.WANTED
    );
  });

  it('is PARTLY with both above zero', () => {
    expect(
      stateOf([entry({ quantity: 1 })], 1, 1, bought(1), NO_FACTS)
    ).toBe(BasketRowState.PARTLY);
  });

  it('is DONE at zero left with something bought', () => {
    expect(stateOf([entry({ quantity: 0 })], 0, 2, bought(2), NO_FACTS)).toBe(
      BasketRowState.DONE
    );
  });

  it('is NOT_AVAILABLE when the newest act says so and units remain', () => {
    expect(stateOf([entry({ quantity: 2 })], 2, 0, closed(), NO_FACTS)).toBe(
      BasketRowState.NOT_AVAILABLE
    );
  });

  it('is DONE rather than NOT_AVAILABLE once nothing is left', () => {
    // The guard plan 0136 section 3.1 step 7 adds to the table's order. A
    // demand taken to zero after a close would otherwise leave the row claiming
    // the shop had none of something nobody is asking for.
    expect(stateOf([entry({ quantity: 0 })], 0, 1, closed(), NO_FACTS)).toBe(
      BasketRowState.DONE
    );
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
      facts: NO_FACTS,
      marks: NO_ROW_MARKS,
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
      facts: NO_FACTS,
      marks: NO_ROW_MARKS,
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
    // A row nobody skipped carries no note, and `mark` arrives with plan 0138.
    expect(row.note).toBeNull();
    expect(row.noteAt).toBeNull();
    expect(row.mark).toBeNull();
  });
});


describe('a line skipped for now (plan 0137, section 10)', () => {
  /** A row of one entry, skipped or not, as the read would hand it over. */
  function rowOf(
    over: Partial<BasketEntry>,
    skips: Record<string, BasketSkipFact> = {},
    kind: BasketKind = BasketKind.GENERATED
  ) {
    const only = entry(over);
    const group = groupEntries([only])[0];
    const keyed = Object.fromEntries(
      Object.entries(skips).map(([, value]) => [only.lineId, value])
    );
    return {
      only,
      view: toRowView(group, { ...OPEN_CONTEXT, facts: facts(keyed, kind) }),
    };
  }

  // --- 1. every entry with something left has to be skipped ----------------

  it('is SKIPPED when the one entry asking for something is freshly skipped', () => {
    const { view } = rowOf({ quantity: 2 }, { it: skip() });
    expect(view.state).toBe(BasketRowState.SKIPPED);
    // The state already says it, so the note would say it twice.
    expect(view.note).toBeNull();
  });

  it('is WANTED with the note when one entry of two has no skip', () => {
    // A row of two lists' milk is skipped as one gesture. When a third
    // household asks for milk an hour later that entry carries no skip, and new
    // demand is a reason to look at the row again.
    const skipped = entry({ listId: 'list-a', content: 'Milk', quantity: 1 });
    const asking = entry({ listId: 'list-b', content: 'Milk', quantity: 1 });
    const group = groupEntries([skipped, asking])[0];

    const view = toRowView(group, {
      ...OPEN_CONTEXT,
      facts: facts({ [skipped.lineId]: skip() }),
    });

    expect(view.state).toBe(BasketRowState.WANTED);
    expect(view.note).toBe(BasketRowNote.SKIPPED_EARLIER);
    // The entry that was skipped still says so on its own.
    expect(view.entries[0].state).toBe(BasketRowState.SKIPPED);
    expect(view.entries[1].state).toBe(BasketRowState.WANTED);
  });

  // --- 2. the window, and the note it leaves behind -------------------------

  it('is WANTED with the note once the window has run out', () => {
    const at = new Date(2026, 0, 1, 7, 0, 0);
    const { view } = rowOf(
      { quantity: 2 },
      { it: skip({ fresh: false, skippedAt: at }) }
    );

    expect(view.state).toBe(BasketRowState.WANTED);
    expect(view.note).toBe(BasketRowNote.SKIPPED_EARLIER);
    expect(view.noteAt).toBe(at.toISOString());
  });

  it('carries no note when no skip stands', () => {
    const { view } = rowOf({ quantity: 2 });
    expect(view.note).toBeNull();
    expect(view.noteAt).toBeNull();
  });

  // --- 3. the five sequences of section 3.2 --------------------------------

  it('answers the five sequences of a skip beside a settlement', () => {
    // The read hands over what still stands, so each sequence is stated as the
    // facts it leaves behind rather than as a series of writes.
    const only = entry({ quantity: 2 });
    const state = (
      standing: BasketSkipFact | null,
      newest: BasketSettlementFact | null,
      bought = 0
    ) =>
      stateOf(
        [{ ...only, quantity: 2 - bought }],
        2 - bought,
        bought,
        newest,
        facts(standing ? { [only.lineId]: standing } : {})
      );

    // skip
    expect(state(skip(), null)).toBe(BasketRowState.SKIPPED);
    // skip, then the shop had none: the close ended the skip
    expect(state(null, closed())).toBe(BasketRowState.NOT_AVAILABLE);
    // the shop had none, then skip: the skip is the newer act
    expect(state(skip(), closed())).toBe(BasketRowState.SKIPPED);
    // skip, then bought in part: the purchase ended the skip
    expect(state(null, bought(1), 1)).toBe(BasketRowState.PARTLY);
    // skip, bought, purchase taken back: the skip stands again
    expect(state(skip(), null)).toBe(BasketRowState.SKIPPED);
  });

  // --- 4. the counts -------------------------------------------------------

  it('counts a skipped row in total and in pending and nowhere else', () => {
    const { view } = rowOf({ quantity: 2 }, { it: skip() });
    expect(progressOf([view])).toEqual({
      done: 0,
      unavailable: 0,
      total: 1,
      pending: 1,
    });
  });

  // --- 5. the close runs out on a LIVE basket alone ------------------------

  it('lets a LIVE basket close run out, and holds a GENERATED one', () => {
    const only = entry({ quantity: 2 });
    const stale = closed({ fresh: false });

    expect(
      stateOf([only], 2, 0, stale, { skips: NO_BASKET_SKIPS, kind: BasketKind.LIVE })
    ).toBe(BasketRowState.WANTED);
    // A trip's close holds until the trip is finished (plan 0130, section 4).
    expect(stateOf([only], 2, 0, stale, NO_FACTS)).toBe(
      BasketRowState.NOT_AVAILABLE
    );
  });

  it('leaves a run out LIVE close with no note', () => {
    // Plan 0137 section 9: plan 0130 defines one note, and `touchedBy` already
    // says who looked and when.
    const only = entry({ quantity: 2, settlements: [closed({ fresh: false })] });
    const view = toRowView(groupEntries([only])[0], {
      ...OPEN_CONTEXT,
      facts: { skips: NO_BASKET_SKIPS, kind: BasketKind.LIVE },
    });

    expect(view.state).toBe(BasketRowState.WANTED);
    expect(view.note).toBeNull();
    expect(view.touchedBy).toBe('p1');
  });

  // --- who touched it ------------------------------------------------------

  it('names the skipper when the skip is the newest act on the row', () => {
    const at = new Date(2026, 0, 1, 20, 0, 0);
    const only = entry({
      quantity: 2,
      settlements: [
        bought(0, {
          outcome: SettlementOutcome.NOT_AVAILABLE,
          settledByParticipantId: 'earlier',
          settledAt: new Date(2026, 0, 1, 9),
        }),
      ],
    });
    const view = toRowView(groupEntries([only])[0], {
      ...OPEN_CONTEXT,
      facts: facts({
        [only.lineId]: skip({ skippedAt: at, skippedByParticipantId: 'marta' }),
      }),
    });

    // A skip is an act on the row, and "Marta, 20:00" under a skipped row is
    // the same answer to the same question a purchase gets.
    expect(view.touchedBy).toBe('marta');
    expect(view.touchedAt).toBe(at.toISOString());
  });

  it('leaves noteOf silent on a row that is done', () => {
    const only = entry({ quantity: 0 });
    expect(
      noteOf([only], BasketRowState.DONE, facts({ [only.lineId]: skip() }))
    ).toBeNull();
  });
});
