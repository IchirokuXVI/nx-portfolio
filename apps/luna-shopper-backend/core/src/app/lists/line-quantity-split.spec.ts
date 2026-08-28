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
 * The remainder line (plan 0037, section 4).
 *
 * The invariant, restated: **the quantity a list asked for is not lost when a
 * shopper comes back with less.** Somebody in the aisle holding `DECIDE` finds
 * one tin where the list says three, sets the quantity to 1, and the two they did
 * not get must not vanish with no record that they were ever wanted.
 *
 * Every row of the table in section 4.4 is a case here, and so is the remainder's
 * position relative to the next line, which section 6 singles out as the part a
 * naive implementation gets wrong by appending to the end.
 *
 * The doubles record what was written and in what order, in the style of
 * `list-create-sharing.spec.ts`, because the assertions are about two rows and
 * two events rather than about which methods a mock saw.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const SHOPPER = 'u-shopper';
const AUTHOR = 'u-author';
const APPROVER = 'u-approver';

interface Split {
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
  position?: number;
  /** The position of the next line down, or null when the original is last. */
  nextPosition?: number | null;
}): Split {
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
    position: options.position ?? 10,
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
      const stored = {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        ...row,
        id: row.id ?? 'li-remainder',
      };
      saved.push(stored);
      return stored;
    },
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getRawOne: async () => ({ next: options.nextPosition ?? null }),
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

const DECIDER = [ListPermission.READ, ListPermission.DECIDE];
const LIST_ADMIN = [
  ListPermission.READ,
  ListPermission.WRITE,
  ListPermission.DECIDE,
  ListPermission.MANAGE,
];

describe('the cases of plan 0037, section 4.4', () => {
  it('APPROVED, 3 to 1, list does not auto approve: a remainder of 2 below it', async () => {
    const w = build({ permissions: DECIDER });

    const view = await w.service.update({
      userId: SHOPPER,
      lineId: 'li1',
      quantity: 1,
    });

    expect(view.quantity).toBe(1);
    expect(w.saved).toHaveLength(2);
    const remainder = w.saved[1];
    expect(remainder.quantity).toBe(2);
    expect(remainder.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(remainder.status).toBe(LineStatus.NOT_AVAILABLE);
    expect(remainder.version).toBe(1);
  });

  it('APPROVED, 3 to 1, list auto approves: no remainder (section 4.5)', async () => {
    // A list that auto approves has decided approval carries no information on
    // it, so there is nothing for a remainder to preserve, and the split would
    // leave unavailable rows on precisely the lists whose owners chose the
    // setting to reduce ceremony.
    const w = build({ permissions: DECIDER, autoApproveLines: true });

    const view = await w.service.update({
      userId: SHOPPER,
      lineId: 'li1',
      quantity: 1,
    });

    expect(view.quantity).toBe(1);
    expect(w.saved).toHaveLength(1);
  });

  it('APPROVED, 1 to 3: no remainder, because nothing was lost', async () => {
    const w = build({ permissions: DECIDER, quantity: 1 });

    const view = await w.service.update({
      userId: SHOPPER,
      lineId: 'li1',
      quantity: 3,
    });

    expect(view.quantity).toBe(3);
    expect(w.saved).toHaveLength(1);
  });

  it('APPROVED, 3 to 0: refused, because quantity has a floor of 1', async () => {
    // "None of it was there" is NOT_AVAILABLE on the whole line, which is a
    // control the same caller already has.
    const w = build({ permissions: DECIDER });

    await expect(
      w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 0 })
    ).rejects.toThrow();
    expect(w.saved).toHaveLength(0);
  });

  it('APPROVED, 5 to 3 then 3 to 1: two remainders of 2, unmerged', async () => {
    // Two trips found two shortfalls, and one row of 4 would say something that
    // never happened.
    const first = build({ permissions: DECIDER, quantity: 5 });
    await first.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 3 });

    const second = build({ permissions: DECIDER, quantity: 3 });
    await second.service.update({
      userId: SHOPPER,
      lineId: 'li1',
      quantity: 1,
    });

    expect(first.saved[1].quantity).toBe(2);
    expect(second.saved[1].quantity).toBe(2);
  });

  it('PENDING, any quantity change: an ordinary edit with no remainder', async () => {
    // Nothing was agreed to yet, so there is nothing to preserve.
    const w = build({
      permissions: [ListPermission.READ, ListPermission.WRITE],
      approvalStatus: LineApprovalStatus.PENDING,
    });

    const view = await w.service.update({
      userId: SHOPPER,
      lineId: 'li1',
      quantity: 1,
    });

    expect(view.quantity).toBe(1);
    expect(w.saved).toHaveLength(1);
  });

  it('REJECTED, any quantity change: no remainder either', async () => {
    const w = build({
      permissions: [ListPermission.READ, ListPermission.WRITE],
      approvalStatus: LineApprovalStatus.REJECTED,
    });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved).toHaveLength(1);
  });
});

describe('where the remainder goes (section 4.3)', () => {
  it('takes the midpoint to the next line, not the end of the list', async () => {
    // The part a naive implementation gets wrong. `position` is double precision
    // for exactly this, and no other row is renumbered, so nothing else in the
    // list moves and a concurrent reorder is not invalidated.
    const w = build({ permissions: DECIDER, position: 10, nextPosition: 11 });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved[1].position).toBe(10.5);
  });

  it('splits an already tight gap without touching its neighbours', async () => {
    const w = build({
      permissions: DECIDER,
      position: 10.5,
      nextPosition: 10.75,
    });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved[1].position).toBe(10.625);
  });

  it('goes one past the original when the original is last', async () => {
    const w = build({ permissions: DECIDER, position: 10, nextPosition: null });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved[1].position).toBe(11);
  });
});

describe('what the remainder carries', () => {
  it('is attributed to the original line author, not to the shopper', async () => {
    // The remainder is the unfilled part of that person's request, and putting
    // the shopper's name on it would attribute a line nobody asked for to them.
    const w = build({ permissions: DECIDER });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved[1].createdByUserId).toBe(AUTHOR);
  });

  it('copies the approval the original already had', async () => {
    const w = build({ permissions: DECIDER });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved[1].approvedByUserId).toBe(APPROVER);
  });

  it('copies the content and the item reference', async () => {
    const w = build({ permissions: DECIDER });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved[1].content).toBe('Tinned tomatoes');
    expect(w.saved[1].itemId).toBe('item-1');
  });

  it('bumps the original version and starts the remainder at 1', async () => {
    const w = build({ permissions: DECIDER });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved[0].version).toBe(5);
    expect(w.saved[1].version).toBe(1);
  });
});

describe('who the split happens for (section 4.2, acceptance 8)', () => {
  it('happens for a MANAGE holder exactly as it does for a DECIDE holder', async () => {
    // The line's approval is the trigger, and a line's approval is a fact anybody
    // looking at it can see. A rule keyed on the actor would make the same edit
    // to the same line produce different data depending on who is signed in.
    const w = build({ permissions: LIST_ADMIN });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved).toHaveLength(2);
    expect(w.saved[1].quantity).toBe(2);
  });

  it('happens for a group admin who holds no row at all', async () => {
    const w = build({ permissions: [], role: ZoneRole.ADMIN });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.saved).toHaveLength(2);
  });
});

describe('what goes out on the wire (section 5, acceptance 4)', () => {
  it('emits the update before the add', async () => {
    // Load bearing for a client rendering optimistically: one that saw the add
    // first would draw a list momentarily summing to more than was ever asked
    // for. Updating first means every frame it can paint is arithmetically true.
    const w = build({ permissions: DECIDER });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    expect(w.events.map((e) => e.event)).toEqual([
      RealtimeEvent.LineUpdated,
      RealtimeEvent.LineAdded,
    ]);
    expect(w.events[0].line.quantity).toBe(1);
    expect(w.events[1].line.quantity).toBe(2);
  });

  it('uses existing event types, so no client needs a new handler', async () => {
    const w = build({ permissions: DECIDER });

    await w.service.update({ userId: SHOPPER, lineId: 'li1', quantity: 1 });

    for (const emitted of w.events) {
      expect([RealtimeEvent.LineUpdated, RealtimeEvent.LineAdded]).toContain(
        emitted.event
      );
    }
  });
});

describe('approval on add (plan 0037, acceptance 1 to 3)', () => {
  it('arrives APPROVED and attributed when the adder holds DECIDE', async () => {
    // Acceptance 1, which is about a group admin: adding needs WRITE, and the
    // adder holding DECIDE as well is what makes the approval theirs to give.
    // The defect this fixes is a client drawing two decision buttons on a line
    // the adder had just typed, because the server said it awaited their own say.
    const w = build({ permissions: [], role: ZoneRole.ADMIN });

    const view = await w.service.add({
      userId: SHOPPER,
      listId: LIST_ID,
      content: 'Olive oil',
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(view.approvedByUserId).toBe(SHOPPER);
  });

  it('refuses a DECIDE-only caller, who cannot add a line at all', async () => {
    // Which is exactly why the quantity split has to happen server side: the
    // ordinary shopper physically cannot produce the remainder row.
    const w = build({ permissions: DECIDER });

    await expect(
      w.service.add({
        userId: SHOPPER,
        listId: LIST_ID,
        content: 'Olive oil',
      })
    ).rejects.toThrow();
  });

  it('arrives PENDING for a member holding read and write only', async () => {
    const w = build({
      permissions: [ListPermission.READ, ListPermission.WRITE],
    });

    const view = await w.service.add({
      userId: SHOPPER,
      listId: LIST_ID,
      content: 'Olive oil',
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
    expect(view.approvedByUserId).toBeNull();
  });

  it('arrives APPROVED with no approver once the list auto approves', async () => {
    // Nobody decided; the list is configured not to ask, and a null approver is
    // the honest record of that.
    const w = build({
      permissions: [ListPermission.READ, ListPermission.WRITE],
      autoApproveLines: true,
    });

    const view = await w.service.add({
      userId: SHOPPER,
      listId: LIST_ID,
      content: 'Olive oil',
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(view.approvedByUserId).toBeNull();
  });

  it('leaves the item state PENDING in all three cases', async () => {
    // The two state machines stay independent: whether the group agreed to buy a
    // thing and whether it is in the trolley are different questions.
    for (const permissions of [
      LIST_ADMIN,
      [ListPermission.READ, ListPermission.WRITE],
    ]) {
      for (const autoApproveLines of [true, false]) {
        const w = build({ permissions, autoApproveLines });
        const view = await w.service.add({
          userId: SHOPPER,
          listId: LIST_ID,
          content: 'Olive oil',
        });
        expect(view.status).toBe(LineStatus.PENDING);
      }
    }
  });

  it('refuses a quantity below the floor on add too', async () => {
    const w = build({ permissions: LIST_ADMIN });

    await expect(
      w.service.add({
        userId: SHOPPER,
        listId: LIST_ID,
        content: 'Olive oil',
        quantity: 0,
      })
    ).rejects.toThrow();
  });
});
