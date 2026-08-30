import {
  LineApprovalStatus,
  LineStatus,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import type { ListAccess, ListLine, ShoppingList } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * Adding units to a line without reading it first (plan 0040, section 3).
 *
 * The claim the whole route rests on is that **it introduces no new permission,
 * no new transition and no new event**: the delta is arithmetic in front of the
 * edit that already exists. So most of what is asserted here is that a delta
 * reaches exactly what an absolute edit of the same field reaches, and several
 * cases are written as "the delta and the `PATCH` produce the same thing" rather
 * than as an independent expectation, because that identity is the design.
 *
 * The one thing this file cannot prove is the lock, which is the reason the
 * endpoint exists at all. That is `line-quantity-delta.integration.spec.ts`,
 * against real Postgres, because a mocked repository has no rows to lock.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const SHOPPER = 'u-shopper';
const AUTHOR = 'u-author';
const APPROVER = 'u-approver';

interface Harness {
  service: LineService;
  saved: Partial<ListLine>[];
  events: { event: RealtimeEvent; line: LineView }[];
}

function build(options: {
  permissions: ListPermission[];
  role?: ZoneRole;
  quantity?: number;
  approvalStatus?: LineApprovalStatus;
  autoApproveLines?: boolean;
  /** The position of the next line down, or null when the target is last. */
  nextPosition?: number | null;
  /** Highest position on the list, for the batch's one MAX(position) query. */
  maxPosition?: number;
  /** Make the nth save (1 based) throw, for the batch that fails partway. */
  failAtSave?: number;
}): Harness {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: AUTHOR,
    autoApproveLines: options.autoApproveLines ?? false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ShoppingList;

  const line = {
    id: 'li1',
    listId: LIST_ID,
    content: 'Tinned tomatoes',
    quantity: options.quantity ?? 3,
    itemId: 'item-1',
    position: 10,
    approvalStatus: options.approvalStatus ?? LineApprovalStatus.APPROVED,
    status: LineStatus.PENDING,
    createdByUserId: AUTHOR,
    approvedByUserId: APPROVER,
    version: 4,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ListLine;

  const saved: Partial<ListLine>[] = [];
  const events: { event: RealtimeEvent; line: LineView }[] = [];

  const lineRepo = {
    findOne: async () => line,
    create: (data: Partial<ListLine>) => ({ ...data }),
    save: async (row: Partial<ListLine>) => {
      if (
        options.failAtSave !== undefined &&
        saved.length + 1 === options.failAtSave
      ) {
        throw new Error('the database said no');
      }
      const stored = {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        ...row,
        id: row.id ?? `li-new-${saved.length}`,
      };
      saved.push(stored);
      return stored;
    },
    // One stand in for both aggregate queries this service runs: `MAX(position)`
    // for a new line and `MIN(position) > mine` for a remainder's place.
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getRawOne: async () => ({
          max: options.maxPosition ?? 10,
          next: options.nextPosition ?? null,
        }),
      };
      return qb;
    },
  };

  const memberships = {
    findOne: async () =>
      ({
        id: 'm1',
        zoneId: ZONE_ID,
        userId: SHOPPER,
        role: options.role ?? ZoneRole.MEMBER,
        status: MembershipStatus.APPROVED,
      }) as never,
  };

  const accessRepo = {
    findOne: async () =>
      ({
        id: 'a1',
        listId: LIST_ID,
        membershipId: 'm1',
        permissions: options.permissions,
      }) as ListAccess,
  };

  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    accessRepo as never,
    lineRepo as never,
    new ZoneAuthzService(memberships as never)
  );

  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run({ getRepository: () => lineRepo } as unknown as EntityManager),
  } as unknown as DataSource;

  const publisher = {
    emit: (event: RealtimeEvent, _zoneId: string, payload: LineView) =>
      events.push({ event, line: payload }),
  } as unknown as CoreEventsPublisher;

  const service = new LineService(
    dataSource,
    lineRepo as never,
    listAccess,
    publisher
  );

  return { service, saved, events };
}

const WRITER = [ListPermission.READ, ListPermission.WRITE];
const DECIDER = [ListPermission.READ, ListPermission.DECIDE];

describe('line.addQuantity (plan 0040, section 3)', () => {
  it('adds, and the answer carries the count the row now holds', async () => {
    const w = build({ permissions: DECIDER, quantity: 3 });

    const view = await w.service.addQuantity({
      userId: SHOPPER,
      lineId: 'li1',
      delta: 2,
    });

    // Five because the server says five, which is the difference between this and
    // the read-compute-write it replaces (section 2).
    expect(view.quantity).toBe(5);
    expect(w.saved).toHaveLength(1);
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineUpdated]);
  });

  it('bumps the version, exactly as an edit does', async () => {
    const w = build({ permissions: DECIDER, quantity: 3 });

    const view = await w.service.addQuantity({
      userId: SHOPPER,
      lineId: 'li1',
      delta: 1,
    });

    expect(view.version).toBe(5);
  });

  it('refuses a delta that would take the quantity below one', async () => {
    // The floor is the resulting quantity's, not the delta's: "none of it was
    // there" is NOT_AVAILABLE on the whole line, which is a control the same
    // caller already has.
    const w = build({ permissions: DECIDER, quantity: 3 });

    await expect(
      w.service.addQuantity({ userId: SHOPPER, lineId: 'li1', delta: -3 })
    ).rejects.toThrow(/at least 1/);
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('refuses a resulting quantity past the ceiling, in core', async () => {
    // Section 3.5. The ceiling used to live only in the gateway DTO, which was
    // survivable while every write carried an absolute value the gateway had
    // already checked. The delta is computed here, so here is the only place that
    // can check the result, and core's callers are NATS messages rather than one
    // gateway acting as a wall.
    const w = build({ permissions: DECIDER, quantity: 99999 });

    await expect(
      w.service.addQuantity({ userId: SHOPPER, lineId: 'li1', delta: 100 })
    ).rejects.toThrow(/at most 100000/);
    expect(w.saved).toHaveLength(0);
  });

  it('refuses a delta of zero, which is a request that means nothing', async () => {
    const w = build({ permissions: DECIDER });

    await expect(
      w.service.addQuantity({ userId: SHOPPER, lineId: 'li1', delta: 0 })
    ).rejects.toThrow(/non zero/);
    expect(w.saved).toHaveLength(0);
  });

  it('refuses a delta bigger than the largest quantity a line may hold', async () => {
    const w = build({ permissions: DECIDER });

    await expect(
      w.service.addQuantity({ userId: SHOPPER, lineId: 'li1', delta: 100001 })
    ).rejects.toThrow(/delta must be between/);
  });

  it('refuses a caller without DECIDE on an approved line, in the same words as an edit', async () => {
    // Adding units is an edit, and the endpoint does not get to be a softer edit
    // (section 3.2). The bot asking to add two gets the same 403 the app gets.
    const delta = build({ permissions: WRITER });
    const patch = build({ permissions: WRITER });

    const fromDelta = await delta.service
      .addQuantity({ userId: SHOPPER, lineId: 'li1', delta: 2 })
      .catch((error: Error) => error);
    const fromPatch = await patch.service
      .update({ userId: SHOPPER, lineId: 'li1', quantity: 5 })
      .catch((error: Error) => error);

    expect(fromDelta).toBeInstanceOf(Error);
    expect((fromDelta as Error).message).toBe((fromPatch as Error).message);
    expect(delta.saved).toHaveLength(0);
  });

  it('puts a rejected line back to PENDING and clears its approver', async () => {
    // Plan 0036, section 4.2: an edit reopens a rejection into a conversation,
    // and a delta is an edit.
    const w = build({
      permissions: WRITER,
      approvalStatus: LineApprovalStatus.REJECTED,
      quantity: 1,
    });

    const view = await w.service.addQuantity({
      userId: SHOPPER,
      lineId: 'li1',
      delta: 2,
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
    expect(view.approvedByUserId).toBeNull();
    expect(view.quantity).toBe(3);
  });

  describe('a negative delta on an approved line splits, exactly as a lowering does', () => {
    it('writes the same two rows an absolute lowering writes', async () => {
      const delta = build({ permissions: DECIDER, quantity: 3 });
      const patch = build({ permissions: DECIDER, quantity: 3 });

      const fromDelta = await delta.service.addQuantity({
        userId: SHOPPER,
        lineId: 'li1',
        delta: -2,
      });
      const fromPatch = await patch.service.update({
        userId: SHOPPER,
        lineId: 'li1',
        quantity: 1,
      });

      expect(fromDelta.quantity).toBe(1);
      expect(fromDelta.quantity).toBe(fromPatch.quantity);
      expect(delta.saved).toHaveLength(2);

      const remainder = delta.saved[1];
      expect(remainder.quantity).toBe(2);
      expect(remainder.approvalStatus).toBe(LineApprovalStatus.APPROVED);
      expect(remainder.status).toBe(LineStatus.NOT_AVAILABLE);
      // Attributed to the original line's author, not to the shopper: the
      // remainder is the unfilled part of that person's request.
      expect(remainder.createdByUserId).toBe(AUTHOR);
      expect(remainder.approvedByUserId).toBe(APPROVER);
      expect(patch.saved.map((row) => row.quantity)).toEqual(
        delta.saved.map((row) => row.quantity)
      );
    });

    it('emits LineUpdated then LineAdded, in that order', async () => {
      // The order is load bearing (plan 0037, section 5): a client rendering
      // optimistically that saw the add first would draw a list momentarily
      // summing to more than was ever asked for.
      const w = build({ permissions: DECIDER, quantity: 3 });

      await w.service.addQuantity({
        userId: SHOPPER,
        lineId: 'li1',
        delta: -2,
      });

      expect(w.events.map((e) => e.event)).toEqual([
        RealtimeEvent.LineUpdated,
        RealtimeEvent.LineAdded,
      ]);
    });

    it('puts the remainder between the line and the next one down', async () => {
      const w = build({
        permissions: DECIDER,
        quantity: 3,
        nextPosition: 20,
      });

      await w.service.addQuantity({
        userId: SHOPPER,
        lineId: 'li1',
        delta: -2,
      });

      // The midpoint, so no other row is renumbered and a concurrent reorder is
      // not invalidated (plan 0037, section 4.3).
      expect(w.saved[1].position).toBe(15);
    });

    it('does not split on a list that auto approves', async () => {
      const w = build({
        permissions: DECIDER,
        quantity: 3,
        autoApproveLines: true,
      });

      const view = await w.service.addQuantity({
        userId: SHOPPER,
        lineId: 'li1',
        delta: -2,
      });

      expect(view.quantity).toBe(1);
      expect(w.saved).toHaveLength(1);
    });
  });
});

describe('line.addMany (plan 0040, section 6)', () => {
  const ten = Array.from({ length: 10 }, (_, index) => ({
    content: `item ${index}`,
  }));

  it('writes every line in request order, on consecutive positions', async () => {
    const w = build({ permissions: WRITER, maxPosition: 4 });

    const views = await w.service.addMany({
      userId: SHOPPER,
      listId: LIST_ID,
      items: ten,
    });

    expect(views.map((view) => view.content)).toEqual(
      ten.map((item) => item.content)
    );
    // One MAX(position) for the whole batch, then an increment per item, so they
    // land in the order they were given (section 6.2).
    expect(w.saved.map((row) => row.position)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });

  it('emits ten LineAdded events in request order, and no batch event', async () => {
    // Not one batch event: a new event type is a type every client has to learn,
    // and velista, the realtime service and the list rooms all already handle
    // `line.added` correctly (section 6.2).
    const w = build({ permissions: WRITER });

    await w.service.addMany({ userId: SHOPPER, listId: LIST_ID, items: ten });

    expect(w.events).toHaveLength(10);
    expect(new Set(w.events.map((e) => e.event))).toEqual(
      new Set([RealtimeEvent.LineAdded])
    );
    expect(w.events.map((e) => e.line.content)).toEqual(
      ten.map((item) => item.content)
    );
  });

  it('adds two lines for the same thing named twice, and does not merge', async () => {
    // Section 6.3: merging is a decision about a person's intention, and somebody
    // pasting a list may well have meant two entries. The upsert rule belongs to
    // the assistant, which is where it lives.
    const w = build({ permissions: WRITER });

    const views = await w.service.addMany({
      userId: SHOPPER,
      listId: LIST_ID,
      items: [{ content: 'leche' }, { content: 'leche' }],
    });

    expect(views).toHaveLength(2);
  });

  it('refuses a caller who cannot write the list, and writes nothing', async () => {
    const w = build({ permissions: [ListPermission.READ] });

    await expect(
      w.service.addMany({ userId: SHOPPER, listId: LIST_ID, items: ten })
    ).rejects.toThrow(/write access/);
    expect(w.saved).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });

  it('announces nothing when a write fails partway', async () => {
    // All or nothing. The rows are Postgres's to roll back, which the integration
    // spec proves; what can be proved here is the half that is this service's,
    // namely that a failed batch announces none of what it had written.
    const w = build({ permissions: WRITER, failAtSave: 5 });

    await expect(
      w.service.addMany({ userId: SHOPPER, listId: LIST_ID, items: ten })
    ).rejects.toThrow('the database said no');
    expect(w.events).toHaveLength(0);
  });

  it('refuses an empty batch and one over the cap', async () => {
    const w = build({ permissions: WRITER });

    await expect(
      w.service.addMany({ userId: SHOPPER, listId: LIST_ID, items: [] })
    ).rejects.toThrow(/at least one line/);
    await expect(
      w.service.addMany({
        userId: SHOPPER,
        listId: LIST_ID,
        items: Array.from({ length: 51 }, () => ({ content: 'x' })),
      })
    ).rejects.toThrow(/at most 50/);
    expect(w.saved).toHaveLength(0);
  });

  it('refuses an item whose quantity is outside the bounds', async () => {
    const w = build({ permissions: WRITER });

    await expect(
      w.service.addMany({
        userId: SHOPPER,
        listId: LIST_ID,
        items: [{ content: 'leche' }, { content: 'pan', quantity: 0 }],
      })
    ).rejects.toThrow(/at least 1/);
  });

  describe('the approval rules are the ones a single add runs (section 6.2)', () => {
    it('approves and attributes every line to an adder holding DECIDE', async () => {
      const w = build({
        permissions: [ListPermission.WRITE, ListPermission.DECIDE],
      });

      const views = await w.service.addMany({
        userId: SHOPPER,
        listId: LIST_ID,
        items: [{ content: 'leche' }, { content: 'pan' }],
      });

      for (const view of views) {
        expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
        expect(view.approvedByUserId).toBe(SHOPPER);
        // The two state machines stay independent: agreeing to buy a thing says
        // nothing about whether it is in the trolley.
        expect(view.status).toBe(LineStatus.PENDING);
      }
    });

    it('leaves them pending for a writer on a list that does not auto approve', async () => {
      const w = build({ permissions: WRITER });

      const views = await w.service.addMany({
        userId: SHOPPER,
        listId: LIST_ID,
        items: [{ content: 'leche' }, { content: 'pan' }],
      });

      for (const view of views) {
        expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
        expect(view.approvedByUserId).toBeNull();
      }
    });

    it('approves with a null approver when the list auto approves', async () => {
      // Nobody decided, the list is configured not to ask, and a null approver is
      // the honest record of that.
      const w = build({ permissions: WRITER, autoApproveLines: true });

      const views = await w.service.addMany({
        userId: SHOPPER,
        listId: LIST_ID,
        items: [{ content: 'leche' }],
      });

      expect(views[0].approvalStatus).toBe(LineApprovalStatus.APPROVED);
      expect(views[0].approvedByUserId).toBeNull();
    });
  });
});
