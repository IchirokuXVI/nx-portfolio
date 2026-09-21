import {
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { fakeAudit, type RecordedChange } from '../audit/core-audit.testing';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import type { ListAccess } from '../entities';
import {
  LineComment,
  LineSettlement,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeLineChanges } from './changes/line-change.fake';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { LineMergeService } from './line-merge.service';
import { fakeLineSettlements } from './line-settlements.fake';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * Plan 0139 gave this service a basket announcer. Every write here is asserted
 * through the events it publishes, and the announcement is not one of them: it
 * is a nudge the basket rooms hear, tested in `basket-announcer.spec.ts`.
 */
const announcer = fakeBasketAnnouncer();

/**
 * An operator's edit of a line, and the two questions a caller with no
 * membership leaves unanswered (plan 0077, section 5.2).
 *
 * `LineService.update` reads the caller's permissions twice, once to decide
 * whether the edit is allowed and once to decide what it does to the line's
 * approval. An operator resolves to no membership and therefore to no
 * permissions, so both need an answer rather than a default, and the answer is
 * `MANAGE`. The assertions that matter here are the second half: an approved
 * line stays approved, because a correction that silently un-approved it is a
 * second change nobody asked for, and a rejected line still reopens, because
 * that rule is about the group's decision rather than about who is editing.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const MEMBER = 'u-member';
const AUTHOR = 'u-author';
const APPROVER = 'u-approver';

/** The verified admin id the gate hands every operator write (plan 0077, 2). */
const ACTOR = 'admin-1';

const AT = new Date('2026-01-01T00:00:00.000Z');

interface Harness {
  service: LineService;
  saved: Partial<ListLine>[];
  deleted: unknown[];
  softDeleted: unknown[];
  commentDeletes: unknown[];
  updated: { criteria: unknown; values: Partial<ListLine> }[];
  events: { event: RealtimeEvent; line: LineView }[];
  recorded: RecordedChange[];
  items: ReturnType<typeof fakeLineItems>;
}

function build(
  options: {
    approvalStatus?: LineApprovalStatus;
    autoApproveLines?: boolean;
    /** What the member facing comparison caller holds on the list. */
    permissions?: ListPermission[];
  } = {}
): Harness {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: AUTHOR,
    autoApproveLines: options.autoApproveLines ?? false,
    sharedWithZone: false,
    createdAt: AT,
    updatedAt: AT,
  } as ShoppingList;

  const line = {
    id: 'li1',
    listId: LIST_ID,
    content: 'Tinned tomatoes',
    quantity: 3,
    itemSetHash: null,
    productGroupId: null,
    position: 10,
    approvalStatus: options.approvalStatus ?? LineApprovalStatus.APPROVED,
    createdByUserId: AUTHOR,
    approvedByUserId: APPROVER,
    version: 4,
    createdAt: AT,
    updatedAt: AT,
  } as ListLine;

  const saved: Partial<ListLine>[] = [];
  const deleted: unknown[] = [];
  const softDeleted: unknown[] = [];
  const commentDeletes: unknown[] = [];
  const updated: { criteria: unknown; values: Partial<ListLine> }[] = [];
  const events: { event: RealtimeEvent; line: LineView }[] = [];

  const lineRepo = {
    findOne: async () => line,
    // What a rename reads to learn whether the new name is taken (plan 0112).
    // A copy, so the fold cannot hand the edit a row it has already assigned to.
    find: async () => [{ ...line }],
    create: (data: Partial<ListLine>) => ({ ...data }),
    save: async (row: Partial<ListLine>) => {
      const stored = { ...row, updatedAt: AT };
      saved.push({ ...stored });
      return stored;
    },
    delete: async (criteria: unknown) => {
      deleted.push(criteria);
      return { affected: 1 };
    },
    // The two halves of plan 0132's delete: what the row is left saying, and the
    // one call that marks it. Kept apart here exactly as the service keeps them
    // apart, so a spec can assert that `deletedAt` was written by `softDelete`
    // and by nothing else.
    update: async (criteria: unknown, values: Partial<ListLine>) => {
      updated.push({ criteria, values });
      return { affected: 1 };
    },
    softDelete: async (criteria: unknown) => {
      softDeleted.push(criteria);
      return { affected: 1 };
    },
  };

  /** A deleted line's conversation goes with it (plan 0132, section 2). */
  const commentRepo = {
    delete: async (criteria: unknown) => {
      commentDeletes.push(criteria);
      return { affected: 1 };
    },
  };

  const memberships = {
    findOne: async () =>
      ({
        id: 'm1',
        zoneId: ZONE_ID,
        userId: MEMBER,
        role: ZoneRole.MEMBER,
        status: MembershipStatus.APPROVED,
      }) as never,
  };
  const accessRepo = {
    findOne: async () =>
      ({
        id: 'a1',
        listId: LIST_ID,
        membershipId: 'm1',
        permissions: options.permissions ?? [
          ListPermission.READ,
          ListPermission.WRITE,
          ListPermission.DECIDE,
          ListPermission.MANAGE,
        ],
      }) as ListAccess,
  };

  const listRepo = {
    findOne: async ({ where }: { where: { id: string } }) =>
      where.id === LIST_ID ? list : null,
  };

  const listAccess = new ListAccessService(
    listRepo as never,
    accessRepo as never,
    lineRepo as never,
    new ZoneAuthzService(memberships as never)
  );

  const items = fakeLineItems();
  const groupRemovals = fakeGroupRemovals();
  const settlements = fakeLineSettlements();

  const repositoryFor = (entity: unknown) => {
    if (entity === LineComment) {
      return commentRepo;
    }
    if (entity === ListLineGroupRemoval) {
      return groupRemovals.repo;
    }
    if (entity === ListLineItem) {
      return items.repo;
    }
    if (entity === LineSettlement) {
      return settlements.repo;
    }
    // A rename locks the list's own row (plan 0112).
    if (entity === ShoppingList) {
      return listRepo;
    }
    return lineRepo;
  };

  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run({ getRepository: repositoryFor } as unknown as EntityManager),
  } as unknown as DataSource;

  const publisher = {
    emit: (event: RealtimeEvent, _zoneId: string, payload: LineView) =>
      events.push({ event, line: payload }),
  } as unknown as CoreEventsPublisher;

  // Bound to the same repositories the member facing paths write through, so an
  // operator edit saves the row a list admin's edit saves.
  const audit = fakeAudit([
    [ListLine, { name: 'list_lines', repository: lineRepo as never }],
    [
      ListLineItem,
      { name: 'list_line_items', repository: items.repo as never },
    ],
    [
      ListLineGroupRemoval,
      {
        name: 'list_line_group_removals',
        repository: groupRemovals.repo as never,
      },
    ],
    [
      LineSettlement,
      { name: 'line_settlements', repository: settlements.repo as never },
    ],
    // Read, never written: a rename locks the list's row (plan 0112).
    [ShoppingList, { name: 'shopping_lists', repository: listRepo as never }],
    // A deleted line's comments go in the same transaction (plan 0132).
    [LineComment, { name: 'line_comments', repository: commentRepo as never }],
  ]);

  const changes = fakeLineChanges();
  return {
    service: new LineService(
      dataSource,
      lineRepo as never,
      items.repo as never,
      groupRemovals.repo as never,
      settlements.repo as never,
      listAccess,
      fakeLineClaims().service,
      publisher,
      audit.service,
      new LineMergeService(changes.recorder),
      // An operator's write records a change as well as its audit row (plan
      // 0138, section 9). A stand in here, so the assertions below stay about the
      // trail; that both rows are written is proven against Postgres.
      changes.recorder,
      announcer
    ),
    recorded: changes.recorded,
    saved,
    deleted,
    softDeleted,
    commentDeletes,
    updated,
    events,
    recorded: audit.recorded,
    items,
  };
}

describe('an operator edit and a list admin’s are one write', () => {
  it('writes the same content and emits the same event', async () => {
    const viaAdmin = build();
    const viaOperator = build();

    const fromAdmin = await viaAdmin.service.update({
      userId: MEMBER,
      lineId: 'li1',
      content: 'Chopped tomatoes',
    });
    const fromOperator = await viaOperator.service.updateAsOperator(
      LIST_ID,
      'li1',
      { content: 'Chopped tomatoes' },
      ACTOR
    );

    expect(fromOperator).toEqual(fromAdmin);
    expect(viaOperator.saved[0].content).toBe('Chopped tomatoes');
    expect(viaOperator.saved[0].version).toBe(5);
    expect(viaOperator.events.map((e) => e.event)).toEqual([
      RealtimeEvent.LineUpdated,
    ]);
  });

  it('leaves an approved line approved', async () => {
    // `MANAGE` is one of the reversion's exemptions, and that is the half of the
    // answer this plan chose it for: the household would otherwise have to
    // approve their own line again because somebody fixed a typo in it.
    const { service, saved } = build({
      approvalStatus: LineApprovalStatus.APPROVED,
    });

    const view = await service.updateAsOperator(
      LIST_ID,
      'li1',
      { content: 'Chopped tomatoes' },
      ACTOR
    );

    expect(saved[0].approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(saved[0].approvedByUserId).toBe(APPROVER);
    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
  });

  it('reopens a rejected line, as any edit does', async () => {
    // The rule that applies to everyone: a rejection is a conversation rather
    // than a dead end, and an edit is the answer to it.
    const { service, saved } = build({
      approvalStatus: LineApprovalStatus.REJECTED,
    });

    await service.updateAsOperator(
      LIST_ID,
      'li1',
      { content: 'Chopped tomatoes' },
      ACTOR
    );

    expect(saved[0].approvalStatus).toBe(LineApprovalStatus.PENDING);
    expect(saved[0].approvedByUserId).toBeNull();
  });

  it('reaches an approved line’s quantity, which a plain writer cannot', async () => {
    const { service, saved } = build();

    await service.updateAsOperator(LIST_ID, 'li1', { quantity: 5 }, ACTOR);

    expect(saved[0].quantity).toBe(5);
    expect(saved[0].approvalStatus).toBe(LineApprovalStatus.APPROVED);
  });

  it('holds the quantity to the same bounds a member’s edit is held to', async () => {
    const { service } = build();

    await expect(
      service.updateAsOperator(LIST_ID, 'li1', { quantity: -1 }, ACTOR)
    ).rejects.toThrow('quantity must be at least');
  });

  it('rewrites the product set in one transaction', async () => {
    const { service, items } = build();
    const itemId = '11111111-1111-4111-8111-111111111111';

    await service.updateAsOperator(
      LIST_ID,
      'li1',
      { itemIds: [itemId] },
      ACTOR
    );

    expect(items.rows.map((row) => row.itemId)).toEqual([itemId]);
  });

  it('answers 404 for a line addressed under the wrong list', async () => {
    const { service } = build();

    await expect(
      service.updateAsOperator('l-other', 'li1', { quantity: 2 }, ACTOR)
    ).rejects.toThrow('Line not found in this list');
  });

  it('records the fields that moved, against the operator', async () => {
    const { service, recorded } = build();

    await service.updateAsOperator(
      LIST_ID,
      'li1',
      { content: 'Chopped tomatoes' },
      ACTOR
    );

    expect(recorded).toEqual([
      {
        actorId: ACTOR,
        action: 'UPDATE',
        entity: 'list_lines',
        entityId: 'li1',
        before: { content: 'Tinned tomatoes' },
        after: { content: 'Chopped tomatoes' },
      },
    ]);
  });

  it('records the set rewrite too, on the transactional path', async () => {
    const { service, recorded } = build();
    const itemId = '11111111-1111-4111-8111-111111111111';

    await service.updateAsOperator(
      LIST_ID,
      'li1',
      { itemIds: [itemId] },
      ACTOR
    );

    // The hash moved, so the line moved, and the trail says so even though the
    // products themselves live in a table of their own.
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorId: ACTOR,
      action: 'UPDATE',
      entity: 'list_lines',
      entityId: 'li1',
    });
    expect(recorded[0].before).toMatchObject({ itemSetHash: null });
  });

  it('records nothing for a write that changes nothing', async () => {
    // `version` is bookkeeping the trail leaves out, so an edit that reassigns
    // the same content is a write nobody needs to read past.
    const { service, recorded } = build();

    await service.updateAsOperator(
      LIST_ID,
      'li1',
      { content: 'Tinned tomatoes' },
      ACTOR
    );

    expect(recorded).toEqual([]);
  });

  it('records nothing on the list admin’s own path', async () => {
    const { service, recorded } = build();

    await service.update({
      userId: MEMBER,
      lineId: 'li1',
      content: 'Chopped tomatoes',
    });

    expect(recorded).toEqual([]);
  });
});

describe('an operator decision on a line', () => {
  it('approves it and writes a null approver', async () => {
    // An operator is not a member of the zone, and every other reader treats
    // that column as a `users.id`, so an admin id there resolves to nothing.
    const { service, saved, events } = build({
      approvalStatus: LineApprovalStatus.PENDING,
    });

    const view = await service.setApprovalAsOperator(
      LIST_ID,
      'li1',
      LineApprovalStatus.APPROVED,
      ACTOR
    );

    expect(saved[0].approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(saved[0].approvedByUserId).toBeNull();
    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(events.map((e) => e.event)).toEqual([RealtimeEvent.LineUpdated]);
  });

  it('clears the approver when it goes back to pending', async () => {
    const { service, saved } = build();

    await service.setApprovalAsOperator(
      LIST_ID,
      'li1',
      LineApprovalStatus.PENDING,
      ACTOR
    );

    expect(saved[0].approvedByUserId).toBeNull();
  });

  it('emits what the member facing decision emits', async () => {
    const viaMember = build({ approvalStatus: LineApprovalStatus.PENDING });
    const viaOperator = build({ approvalStatus: LineApprovalStatus.PENDING });

    await viaMember.service.setApproval({
      userId: MEMBER,
      lineId: 'li1',
      approvalStatus: LineApprovalStatus.APPROVED,
    });
    await viaOperator.service.setApprovalAsOperator(
      LIST_ID,
      'li1',
      LineApprovalStatus.APPROVED,
      ACTOR
    );

    expect(viaOperator.events.map((e) => e.event)).toEqual(
      viaMember.events.map((e) => e.event)
    );
    expect(viaOperator.saved[0].approvalStatus).toBe(
      viaMember.saved[0].approvalStatus
    );
  });

  it('records the decision', async () => {
    const { service, recorded } = build({
      approvalStatus: LineApprovalStatus.PENDING,
    });

    await service.setApprovalAsOperator(
      LIST_ID,
      'li1',
      LineApprovalStatus.APPROVED,
      ACTOR
    );

    expect(recorded).toHaveLength(1);
    expect(recorded[0].after).toMatchObject({
      approvalStatus: LineApprovalStatus.APPROVED,
      approvedByUserId: null,
    });
  });
});

describe('an operator delete of a line', () => {
  it('removes an approved line and announces it', async () => {
    // No approval branch: an operator edits with `MANAGE`, which is exactly the
    // permission the member facing asymmetry exists to admit here.
    const { service, deleted, softDeleted, events } = build();

    await expect(
      service.deleteAsOperator(LIST_ID, 'li1', ACTOR)
    ).resolves.toEqual({ id: 'li1' });

    // Soft since plan 0132, so the row is marked rather than removed, and the
    // event a client acts on says exactly what it always said.
    expect(softDeleted).toEqual([{ id: 'li1' }]);
    expect(deleted).toEqual([]);
    expect(events).toEqual([
      {
        event: RealtimeEvent.LineDeleted,
        line: { id: 'li1', listId: LIST_ID },
      },
    ]);
  });

  it('empties what the line owned, and never writes deletedByUserId', async () => {
    const { service, commentDeletes, updated, items } = build();
    items.rows.push({
      lineId: 'li1',
      itemId: 'item-1',
      position: 0,
      source: LineItemSource.USER,
    });

    await service.deleteAsOperator(LIST_ID, 'li1', ACTOR);

    expect(commentDeletes).toEqual([{ lineId: 'li1' }]);
    expect(items.rows).toEqual([]);
    // Null on this path, and not merely absent: the column names a member, and
    // an operator's name belongs in the trail (plan 0132, section 6).
    expect(updated).toEqual([
      {
        criteria: { id: 'li1' },
        values: {
          itemSetHash: null,
          productGroupId: null,
          deletedByUserId: null,
        },
      },
    ]);
  });

  it('records what the line said, rather than only its id', async () => {
    const { service, recorded } = build();

    await service.deleteAsOperator(LIST_ID, 'li1', ACTOR);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorId: ACTOR,
      action: 'DELETE',
      entity: 'list_lines',
      entityId: 'li1',
      after: null,
    });
    expect(recorded[0].before).toMatchObject({ content: 'Tinned tomatoes' });
  });
});
