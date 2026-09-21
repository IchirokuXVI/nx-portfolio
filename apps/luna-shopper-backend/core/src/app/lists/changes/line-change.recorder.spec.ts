import {
  LineApprovalStatus,
  LineChangeKind,
} from '@portfolio/luna-shopper/contracts';
import type { EntityManager } from 'typeorm';
import { ListLineChange, type ListLine } from '../../entities';
import {
  actorOf,
  LineChangeRecorder,
  movedBetween,
  operatorActor,
  snapshotOf,
  type LineSnapshot,
} from './line-change.recorder';

/**
 * What a change row says, stated rather than mocked (plan 0138, section 3).
 *
 * The derivation is pure, so it is asserted directly: the kind is decided by what
 * moved, in one order, and every caller of the eleven record sites gets the same
 * answer. What is **not** here is the insert reaching a table, which is an
 * integration spec's job, and the `createdAt` two rows of one act share, which is
 * a fact about a transaction.
 */

const LIST = { id: 'l-1', zoneId: 'z-1' };
const ACTOR = { userId: 'u-1', participantId: null, basketId: null };

function snapshot(over: Partial<LineSnapshot> = {}): LineSnapshot {
  return {
    content: 'Milk',
    quantity: 2,
    approvalStatus: LineApprovalStatus.APPROVED,
    ...over,
  };
}

/** A manager that keeps the rows it was asked to insert. */
function managerOver(rows: Record<string, unknown>[]): EntityManager {
  return {
    insert: async (entity: unknown, row: Record<string, unknown>) => {
      expect(entity).toBe(ListLineChange);
      rows.push(row);
      return { identifiers: [], generatedMaps: [], raw: [] };
    },
  } as unknown as EntityManager;
}

function lineFor(over: Partial<ListLine> = {}): ListLine {
  return {
    id: 'll-1',
    content: 'Milk',
    quantity: 2,
    approvalStatus: LineApprovalStatus.APPROVED,
    ...over,
  } as ListLine;
}

describe('the kind a change is (section 2)', () => {
  it('writes nothing at all when the three values are as they were', () => {
    expect(movedBetween(snapshot(), snapshot())).toBeNull();
  });

  it('is RENAMED when the text moved, whatever else moved with it', () => {
    const moved = movedBetween(
      snapshot(),
      snapshot({
        content: 'Whole milk',
        quantity: 3,
        approvalStatus: LineApprovalStatus.PENDING,
      })
    );

    // The kind names the most significant thing, and the columns carry
    // everything: one row for an edit that did three things.
    expect(moved).toEqual({
      kind: LineChangeKind.RENAMED,
      contentBefore: 'Milk',
      contentAfter: 'Whole milk',
      quantityBefore: 2,
      quantityAfter: 3,
      approvalBefore: LineApprovalStatus.APPROVED,
      approvalAfter: LineApprovalStatus.PENDING,
    });
  });

  it('is QUANTITY_CHANGED when the text did not move and the number did', () => {
    expect(movedBetween(snapshot(), snapshot({ quantity: 5 }))).toEqual({
      kind: LineChangeKind.QUANTITY_CHANGED,
      quantityBefore: 2,
      quantityAfter: 5,
    });
  });

  it('is APPROVAL_CHANGED when only the decision moved', () => {
    expect(
      movedBetween(
        snapshot(),
        snapshot({ approvalStatus: LineApprovalStatus.REJECTED })
      )
    ).toEqual({
      kind: LineChangeKind.APPROVAL_CHANGED,
      approvalBefore: LineApprovalStatus.APPROVED,
      approvalAfter: LineApprovalStatus.REJECTED,
    });
  });

  it('counts a respelling as a rename, because a row draws the text', () => {
    // The list's own fold calls "jamon" and "Jamón" one name (plan 0091), and a
    // basket row draws the anchor's own text, so the screen does change.
    expect(
      movedBetween(
        snapshot({ content: 'jamon' }),
        snapshot({ content: 'Jamón' })
      )
    ).toMatchObject({ kind: LineChangeKind.RENAMED });
  });
});

describe('what the recorder inserts (section 3)', () => {
  const recorder = new LineChangeRecorder();

  it('fills the three after columns alone for an add', async () => {
    const rows: Record<string, unknown>[] = [];
    await recorder.added(managerOver(rows), LIST, lineFor(), ACTOR);

    expect(rows).toEqual([
      {
        zoneId: 'z-1',
        listId: 'l-1',
        lineId: 'll-1',
        kind: LineChangeKind.ADDED,
        contentBefore: null,
        contentAfter: 'Milk',
        quantityBefore: null,
        quantityAfter: 2,
        approvalBefore: null,
        approvalAfter: LineApprovalStatus.APPROVED,
        mergedIntoLineId: null,
        actorUserId: 'u-1',
        actorParticipantId: null,
        basketId: null,
      },
    ]);
  });

  it('never names `createdAt`, so the database stamps it', async () => {
    // Every row one act writes shares the transaction's start, which is what lets
    // one acknowledgement cover a rename over three lists (section 2).
    const rows: Record<string, unknown>[] = [];
    await recorder.added(managerOver(rows), LIST, lineFor(), ACTOR);

    expect(Object.keys(rows[0])).not.toContain('createdAt');
  });

  it('inserts nothing for an edit that moved nothing', async () => {
    const rows: Record<string, unknown>[] = [];
    await recorder.edited(
      managerOver(rows),
      LIST,
      'll-1',
      snapshot(),
      snapshot(),
      ACTOR
    );

    expect(rows).toEqual([]);
  });

  it('fills the before columns alone for a delete', async () => {
    const rows: Record<string, unknown>[] = [];
    await recorder.deleted(managerOver(rows), LIST, lineFor(), ACTOR);

    expect(rows[0]).toMatchObject({
      kind: LineChangeKind.DELETED,
      contentBefore: 'Milk',
      contentAfter: null,
      quantityBefore: 2,
      quantityAfter: null,
      approvalBefore: LineApprovalStatus.APPROVED,
      approvalAfter: null,
      mergedIntoLineId: null,
    });
  });

  it('names the line that went and the one that stayed for a merge', async () => {
    const rows: Record<string, unknown>[] = [];
    await recorder.merged(
      managerOver(rows),
      LIST,
      { id: 'll-gone', ...snapshot({ content: 'Leche', quantity: 1 }) },
      lineFor({ id: 'll-stays', content: 'Milk', quantity: 3 }),
      ACTOR
    );

    // The absorbed line is what the change is **about**, and the survivor's
    // content is the name the row carries afterwards: a rename that caused the
    // merge rides here rather than in a second row.
    expect(rows[0]).toMatchObject({
      lineId: 'll-gone',
      mergedIntoLineId: 'll-stays',
      kind: LineChangeKind.MERGED,
      contentBefore: 'Leche',
      contentAfter: 'Milk',
      quantityBefore: 1,
      quantityAfter: 3,
    });
  });
});

describe('who a change is attributed to (section 4)', () => {
  it('is the requesting account when no basket was involved', () => {
    expect(actorOf({ userId: 'u-1' })).toEqual({
      userId: 'u-1',
      participantId: null,
      basketId: null,
    });
  });

  it('is the participant and their own account for a basket write', () => {
    // **Not** `req.userId`, which on a delegated write is the basket's owner: the
    // person moving a household's demand may be somebody else entirely.
    expect(
      actorOf({
        userId: 'u-owner',
        via: { participantId: 'p-1', basketId: 'b-1', userId: 'u-shopper' },
      })
    ).toEqual({
      userId: 'u-shopper',
      participantId: 'p-1',
      basketId: 'b-1',
    });
  });

  it('has a participant and no account for a guest', () => {
    expect(
      actorOf({
        userId: 'u-owner',
        via: { participantId: 'p-2', basketId: 'b-1', userId: null },
      })
    ).toEqual({ userId: null, participantId: 'p-2', basketId: 'b-1' });
  });

  it('is the operator for an operator write', () => {
    // An operator's edit writes a change as well as its audit row (section 9),
    // and the change knows them as an account like anybody else.
    expect(operatorActor('u-admin')).toEqual({
      userId: 'u-admin',
      participantId: null,
      basketId: null,
    });
  });
});

describe('snapshotOf', () => {
  it('reads the three values a change is ever about, and nothing else', () => {
    expect(snapshotOf(lineFor({ content: 'Bread', quantity: 4 }))).toEqual({
      content: 'Bread',
      quantity: 4,
      approvalStatus: LineApprovalStatus.APPROVED,
    });
  });
});
