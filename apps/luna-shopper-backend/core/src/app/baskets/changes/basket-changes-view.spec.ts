import {
  BASKET_CHANGE_LIMITS,
  BasketChangeOriginKind,
  LineApprovalStatus,
  LineChangeKind,
} from '@portfolio/luna-shopper/contracts';
import { BasketLineKeys } from '../basket-line-keys';
import {
  anchorsOf,
  clampChangePage,
  toChangeView,
} from './basket-changes.service';
import type { ChangeLineRow, ChangePageRow } from './basket-changes.sql';

/**
 * What a reader of the changes view is served (plan 0138, section 8).
 *
 * Three rules, all of them pure: which row a change points at, who the reader is
 * allowed to know made it, and whether the list is named at all. The redaction is
 * stated as a table here for the reason `basket-redaction.spec.ts` states its own:
 * a rule about what somebody may not see has to be readable in one place.
 */

const BASKET = 'b-1';

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

function row(
  over: Partial<ChangePageRow> & Pick<ChangePageRow, 'lineId'>
): ChangePageRow {
  return {
    id: 'ch-1',
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    listId: 'list-a',
    kind: LineChangeKind.QUANTITY_CHANGED,
    contentBefore: null,
    contentAfter: null,
    quantityBefore: 2,
    quantityAfter: 3,
    approvalBefore: null,
    approvalAfter: null,
    mergedIntoLineId: null,
    actorUserId: null,
    actorParticipantId: null,
    basketId: null,
    originOwnerUserId: null,
    unseen: true,
    ...over,
  };
}

/**
 * One change as a reader is served it.
 *
 * `covered` is the lines the basket draws, oldest first. `departed` is the
 * lines the page names that the basket no longer draws: deleted, absorbed by a
 * merge, or at zero. `products` gives a line its products, and a line with
 * none is keyed by its name, as a read with no picks keys it (plan 0201).
 */
function view(
  change: ChangePageRow,
  covered: ChangeLineRow[],
  served: string[] = ['list-a'],
  departed: ChangeLineRow[] = [],
  products: Record<string, string[]> = {}
) {
  const all = [...covered, ...departed];
  const keys = new BasketLineKeys().add(
    all.map((entry) => ({
      lineId: entry.id,
      content: entry.content,
      itemIds: products[entry.id] ?? [],
      favoriteItemId: entry.favoriteItemId,
      tripItemId: null,
    }))
  );
  return toChangeView(change, {
    anchors: anchorsOf(covered, keys.keyOf),
    coveredIds: new Set(covered.map((entry) => entry.id)),
    keyOf: keys.keyOf,
    lines: new Map(all.map((entry) => [entry.id, entry])),
    basketId: BASKET,
    servedListIds: new Set(served),
  });
}

describe('the row a change points at', () => {
  it('is the line itself when the basket draws it', () => {
    const anchor = line({ createdAt: new Date(2026, 0, 1) });
    const later = line({ createdAt: new Date(2026, 0, 9), listId: 'list-b' });

    // Before plan 0201 this was the anchor of the row. A read with picks can
    // group the lines in another way, so the change names its own line and a
    // client finds the row that holds it among its entries.
    expect(view(row({ lineId: later.id }), [anchor, later]).rowKey).toBe(
      later.id
    );
    expect(view(row({ lineId: anchor.id }), [anchor, later]).rowKey).toBe(
      anchor.id
    );
  });

  it('is the oldest covered line of the same name for a line that left', () => {
    const anchor = line({ createdAt: new Date(2026, 0, 1) });
    const later = line({ createdAt: new Date(2026, 0, 9), listId: 'list-b' });
    const gone = line({ id: 'll-gone', listId: 'list-c' });

    // The row the mark was passed to.
    expect(
      view(
        row({ lineId: gone.id, kind: LineChangeKind.DELETED }),
        [anchor, later],
        ['list-a'],
        [gone]
      ).rowKey
    ).toBe(anchor.id);
  });

  it('is a covered line of the same product for a line that left (plan 0201)', () => {
    const milk = line({ content: 'Milk' });
    const leche = line({ content: 'Leche', listId: 'list-b' });
    const gone = line({ id: 'll-gone', content: 'Leche', listId: 'list-c' });

    // The line that went was called as one covered line and counted as the
    // product of the other. The product decides.
    expect(
      view(
        row({ lineId: gone.id, kind: LineChangeKind.DELETED }),
        [milk, leche],
        ['list-a'],
        [gone],
        { [milk.id]: ['i1'], [leche.id]: ['i2'], [gone.id]: ['i1', 'i3'] }
      ).rowKey
    ).toBe(milk.id);
  });

  it('is null for a line that left when only its name is still covered', () => {
    const milk = line({ content: 'Milk' });
    const gone = line({ id: 'll-gone', content: 'Milk', listId: 'list-c' });

    expect(
      view(
        row({ lineId: gone.id, kind: LineChangeKind.DELETED }),
        [milk],
        ['list-a'],
        [gone],
        { [milk.id]: ['i1'], [gone.id]: ['i2'] }
      ).rowKey
    ).toBeNull();
  });

  it('resolves a merge through the line that stayed', () => {
    const survivor = line();
    const gone = line({ id: 'll-gone', content: 'Leche' });

    const drawn = view(
      row({
        lineId: gone.id,
        kind: LineChangeKind.MERGED,
        mergedIntoLineId: survivor.id,
      }),
      [survivor],
      ['list-a'],
      [gone]
    );

    // The absorbed line names no row. What a client can act on is the survivor's.
    expect(drawn.rowKey).toBe(survivor.id);
  });

  it('is null for a line in no covered row', () => {
    // The disabled row the basket read draws lasts as long as the mark, and this
    // history outlives it, so there is nothing to point at.
    const gone = line({ id: 'll-gone' });

    expect(view(row({ lineId: gone.id }), [], ['list-a']).rowKey).toBeNull();
  });

  it('never serves the line ids themselves', () => {
    const only = line();
    const drawn = view(row({ lineId: only.id, mergedIntoLineId: null }), [
      only,
    ]);

    expect(Object.keys(drawn)).not.toContain('lineId');
    expect(Object.keys(drawn)).not.toContain('mergedIntoLineId');
  });
});

describe('the list behind a change (plan 0130, section 6)', () => {
  it('is named for a reader who writes it', () => {
    const only = line();

    expect(view(row({ lineId: only.id }), [only], ['list-a']).listId).toBe(
      'list-a'
    );
  });

  it('is absent rather than null for a reader who does not', () => {
    // Redaction by absence, so a reader cannot tell "a list you may not see" from
    // "no list", and a guest receives this for every change.
    const only = line();
    const drawn = view(row({ lineId: only.id }), [only], []);

    expect('listId' in drawn).toBe(false);
  });
});

describe('who made a change', () => {
  it('is a participant when the change came through this basket', () => {
    const only = line();
    const drawn = view(
      row({
        lineId: only.id,
        actorParticipantId: 'p-1',
        actorUserId: 'u-1',
        basketId: BASKET,
      }),
      [only],
      []
    );

    // Everybody on a basket already sees its people, so this reaches a guest.
    expect(drawn.actor).toEqual({ participantId: 'p-1' });
  });

  it('is an account only beside a served list', () => {
    const only = line();

    expect(
      view(row({ lineId: only.id, actorUserId: 'u-1' }), [only], ['list-a'])
        .actor
    ).toEqual({ userId: 'u-1' });
    expect(
      view(row({ lineId: only.id, actorUserId: 'u-1' }), [only], []).actor
    ).toBeNull();
  });

  it('is null for a change made through another basket', () => {
    const only = line();
    const drawn = view(
      row({ lineId: only.id, actorParticipantId: 'p-9', basketId: 'b-other' }),
      [only],
      []
    );

    // That participant is on another basket, so this reader does not know them,
    // and the change carries no account of its own to fall back to.
    expect(drawn.actor).toBeNull();
  });
});

describe('where a buy came from (plan 0203, section 5)', () => {
  const buy = (over: Partial<ChangePageRow> & Pick<ChangePageRow, 'lineId'>) =>
    row({
      kind: LineChangeKind.BOUGHT,
      quantityBefore: 2,
      quantityAfter: 0,
      ...over,
    });

  it('is null for a change that is not a buy', () => {
    const only = line();

    expect(
      view(row({ lineId: only.id, basketId: 'b-other' }), [only]).origin
    ).toBeNull();
    expect(view(row({ lineId: only.id }), [only]).origin).toBeNull();
  });

  it('is null for a buy of this basket, which names its participant', () => {
    const only = line();
    const drawn = view(
      buy({ lineId: only.id, basketId: BASKET, actorParticipantId: 'p-1' }),
      [only]
    );

    expect(drawn.origin).toBeNull();
    expect(drawn.actor).toEqual({ participantId: 'p-1' });
  });

  it('is LIST for a buy with no basket, with the buyer as the actor', () => {
    const only = line();
    const drawn = view(buy({ lineId: only.id, actorUserId: 'u-buyer' }), [
      only,
    ]);

    expect(drawn.origin).toEqual({ kind: BasketChangeOriginKind.LIST });
    expect(drawn.actor).toEqual({ userId: 'u-buyer' });
  });

  it('is ANOTHER_BASKET with the owner the statement loaded', () => {
    const only = line();
    const drawn = view(
      buy({
        lineId: only.id,
        basketId: 'b-other',
        actorParticipantId: 'p-9',
        actorUserId: 'u-buyer',
        originOwnerUserId: 'u-owner',
      }),
      [only]
    );

    expect(drawn.origin).toEqual({
      kind: BasketChangeOriginKind.ANOTHER_BASKET,
      owner: { userId: 'u-owner' },
    });
    // The buyer is somebody on that basket. The owner is whose basket it is.
    expect(drawn.actor).toEqual({ userId: 'u-buyer' });
  });

  it('names nobody when the statement loaded no owner', () => {
    // A guest, a reader who cannot write the list, or a basket deleted since.
    const only = line();
    const drawn = view(
      buy({ lineId: only.id, basketId: 'b-other', actorParticipantId: 'p-9' }),
      [only],
      []
    );

    expect(drawn.origin).toEqual({
      kind: BasketChangeOriginKind.ANOTHER_BASKET,
      owner: null,
    });
    expect(drawn.actor).toBeNull();
    expect(Object.keys(drawn)).not.toContain('listId');
  });

  it('serves no basket id, in any field', () => {
    const only = line();
    const drawn = view(
      buy({
        lineId: only.id,
        kind: LineChangeKind.BUY_REVERTED,
        basketId: 'b-other',
        originOwnerUserId: 'u-owner',
      }),
      [only]
    );

    expect(JSON.stringify(drawn)).not.toContain('b-other');
    expect(Object.keys(drawn)).not.toContain('basketId');
  });
});

describe('the page size', () => {
  it('defaults and caps to the numbers the contract states', () => {
    expect(clampChangePage(undefined)).toBe(BASKET_CHANGE_LIMITS.pageSize);
    expect(clampChangePage(0)).toBe(BASKET_CHANGE_LIMITS.pageSize);
    expect(clampChangePage(5)).toBe(5);
    expect(clampChangePage(9999)).toBe(BASKET_CHANGE_LIMITS.maxPageSize);
  });
});
