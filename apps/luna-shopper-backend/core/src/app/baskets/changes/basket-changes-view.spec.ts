import {
  BASKET_CHANGE_LIMITS,
  LineApprovalStatus,
  LineChangeKind,
} from '@portfolio/luna-shopper/contracts';
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
    itemSetHash: null,
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
    unseen: true,
    ...over,
  };
}

function view(
  change: ChangePageRow,
  lines: ChangeLineRow[],
  served: string[] = ['list-a']
) {
  return toChangeView(change, {
    anchors: anchorsOf(lines),
    lines: new Map(lines.map((entry) => [entry.id, entry])),
    basketId: BASKET,
    servedListIds: new Set(served),
  });
}

describe('the row a change points at', () => {
  it('is the anchor of the row its line is in', () => {
    const anchor = line({ createdAt: new Date(2026, 0, 1) });
    const later = line({ createdAt: new Date(2026, 0, 9), listId: 'list-b' });

    // Any entry's change names the row, and the row is named by its oldest ask.
    expect(view(row({ lineId: later.id }), [anchor, later]).rowKey).toBe(
      anchor.id
    );
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
      [survivor, gone]
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

describe('the page size', () => {
  it('defaults and caps to the numbers the contract states', () => {
    expect(clampChangePage(undefined)).toBe(BASKET_CHANGE_LIMITS.pageSize);
    expect(clampChangePage(0)).toBe(BASKET_CHANGE_LIMITS.pageSize);
    expect(clampChangePage(5)).toBe(5);
    expect(clampChangePage(9999)).toBe(BASKET_CHANGE_LIMITS.maxPageSize);
  });
});
