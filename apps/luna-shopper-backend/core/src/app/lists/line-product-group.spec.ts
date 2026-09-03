import {
  LINE_ITEM_SET_MAX,
  LineApprovalStatus,
  LineItemSource,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  ZoneRole,
  type LineView,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { DataSource, EntityManager } from 'typeorm';
import {
  LineSettlement,
  ListLineGroupRemoval,
  ListLineItem,
  type ListAccess,
  type ListLine,
  type ShoppingList,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { fakeLineClaims } from '../generated-lists/line-claims.fake';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { fakeLineSettlements } from './line-settlements.fake';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * What a **person** may do to a subscribed line (plan 0070, sections 3, 7 and 9).
 *
 * The other half of the feature lives in `product-group-sync.service.spec.ts`,
 * which is the catalog's side of it. This file is the side somebody's thumb
 * reaches: picking a group in the composer, adopting a product the group put on
 * the line, taking one off, and the cap that has to let an over cap line shrink
 * without letting it grow.
 *
 * The invariant tying the two together is stated once and asserted from both
 * sides: **provenance moves one way.** A product's source may go from `GROUP` to
 * `USER` and never back, so the app never takes ownership of something a person
 * touched.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const ACTOR = 'u-actor';
const LINE_ID = 'li1';
const MILK = '7c2b4d1a-8e35-4f90-b6a2-1d4c7e9b0f52';

/** Deterministic UUIDs, because the service checks the shape of every id. */
function itemId(n: number): string {
  return `3f1a0c5e-2b7d-4a6f-8c91-${String(n).padStart(12, '0')}`;
}

interface Options {
  productGroupId?: string | null;
  items?: { itemId: string; source?: LineItemSource }[];
  removed?: string[];
  /** For the one case that is about who may edit rather than what an edit does. */
  approvalStatus?: LineApprovalStatus;
  permissions?: ListPermission[];
}

function build(options: Options = {}) {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: ACTOR,
    autoApproveLines: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ShoppingList;

  const seeded = options.items ?? [];
  const line = {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    quantity: 1,
    itemSetHash: null,
    productGroupId: options.productGroupId ?? null,
    position: 10,
    approvalStatus: options.approvalStatus ?? LineApprovalStatus.PENDING,
    createdByUserId: ACTOR,
    approvedByUserId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
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
        id: row.id ?? 'li-new',
      };
      saved.push(stored);
      return stored;
    },
    createQueryBuilder: () => {
      const qb = {
        select: () => qb,
        where: () => qb,
        andWhere: () => qb,
        getRawOne: async () => ({ max: 10 }),
      };
      return qb;
    },
  };

  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    {
      findOne: async () =>
        ({
          id: 'a1',
          listId: LIST_ID,
          membershipId: 'm1',
          // Everything, so nothing here is about who may edit: that is
          // `list-permissions.spec.ts`, and this file is about what an edit does.
          // The set is stated in full rather than relying on one implying
          // another, because none of them does (plan 0036, section 2).
          permissions: options.permissions ?? [
            ListPermission.READ,
            ListPermission.WRITE,
            ListPermission.DECIDE,
            ListPermission.MANAGE,
          ],
        }) as ListAccess,
    } as never,
    lineRepo as never,
    new ZoneAuthzService({
      findOne: async () =>
        ({
          id: 'm1',
          zoneId: ZONE_ID,
          userId: ACTOR,
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        }) as never,
    } as never)
  );

  const lineItems = fakeLineItems(
    seeded.map((item, position) => ({
      lineId: LINE_ID,
      itemId: item.itemId,
      position,
      source: item.source ?? LineItemSource.GROUP,
    }))
  );
  const groupRemovals = fakeGroupRemovals(
    (options.removed ?? []).map((id) => ({ lineId: LINE_ID, itemId: id }))
  );
  const settlements = fakeLineSettlements();

  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run({
        getRepository: (entity: unknown) => {
          if (entity === ListLineItem) {
            return lineItems.repo;
          }
          if (entity === ListLineGroupRemoval) {
            return groupRemovals.repo;
          }
          if (entity === LineSettlement) {
            return settlements.repo;
          }
          return lineRepo;
        },
      } as unknown as EntityManager),
  } as unknown as DataSource;

  const service = new LineService(
    dataSource,
    lineRepo as never,
    lineItems.repo as never,
    groupRemovals.repo as never,
    settlements.repo as never,
    listAccess,
    fakeLineClaims().service,
    {
      emit: (event: RealtimeEvent, _zoneId: string, payload: LineView) =>
        events.push({ event, line: payload }),
    } as unknown as CoreEventsPublisher
  );

  return { service, lineItems, groupRemovals, saved, events, line };
}

/** What the line holds, and who each product belongs to. */
function setOf(w: ReturnType<typeof build>, lineId: string = LINE_ID) {
  return w.lineItems.rows
    .filter((row) => row.lineId === lineId)
    .sort((a, b) => a.position - b.position)
    .map((row) => ({ itemId: row.itemId, source: row.source }));
}

describe('picking a group in the composer (plan 0070, section 9)', () => {
  it('subscribes the line and marks the set as the group’s', async () => {
    const w = build();

    const view = await w.service.add({
      userId: ACTOR,
      listId: LIST_ID,
      content: 'Milk',
      itemIds: [itemId(1), itemId(2)],
      productGroupId: MILK,
    });

    expect(view.productGroupId).toBe(MILK);
    // Everything the composer sent came from the group at this moment, so the
    // group stays responsible for all of it until somebody adopts one.
    expect(view.groupItemIds).toEqual([itemId(1), itemId(2)]);
    expect(setOf(w, 'li-new').map((row) => row.source)).toEqual([
      LineItemSource.GROUP,
      LineItemSource.GROUP,
    ]);
  });

  it('leaves a hand assembled set owned by the person who assembled it', async () => {
    const w = build();

    const view = await w.service.add({
      userId: ACTOR,
      listId: LIST_ID,
      content: 'Milk',
      itemIds: [itemId(1)],
    });

    expect(view.productGroupId).toBeNull();
    expect(view.groupItemIds).toEqual([]);
    expect(setOf(w, 'li-new')).toEqual([
      { itemId: itemId(1), source: LineItemSource.USER },
    ]);
  });

  it('does not subscribe a batched line, whatever it holds', async () => {
    // A batch is a paste, an import or the assistant, and none of those is
    // somebody picking a group. `AddLinesItem` carries no group to say so.
    const w = build();

    const views = await w.service.addMany({
      userId: ACTOR,
      listId: LIST_ID,
      items: [{ content: 'Milk', itemIds: [itemId(1)] }],
    });

    expect(views[0].productGroupId).toBeNull();
    expect(views[0].groupItemIds).toEqual([]);
  });
});

describe('adopting a product the group put there (plan 0070, section 3)', () => {
  it('moves it to the person, and the group can no longer take it away', async () => {
    const w = build({
      productGroupId: MILK,
      items: [{ itemId: itemId(1) }, { itemId: itemId(2) }],
    });

    const view = await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      adoptItemIds: [itemId(2)],
    });

    // The set does not move; who owns it does. That is the whole gesture.
    expect(view.itemIds).toEqual([itemId(1), itemId(2)]);
    expect(view.groupItemIds).toEqual([itemId(1)]);
    expect(setOf(w)).toEqual([
      { itemId: itemId(1), source: LineItemSource.GROUP },
      { itemId: itemId(2), source: LineItemSource.USER },
    ]);
    // An edit, so it announces itself like every other edit.
    expect(w.events.map((e) => e.event)).toEqual([RealtimeEvent.LineUpdated]);
  });

  it('is within a DECIDE holder’s reach on an approved line, and does not un-approve it', async () => {
    // Until plan 0076 this was refused, on plan 0036 section 4.1's rule that an
    // approved line yielded nothing but its quantity to a decider. That branch
    // is gone: adoption still decides whether the catalog may go on correcting a
    // set somebody agreed to, and the person deciding it is the person who
    // approves the line, who could reach the same end state by un-approving,
    // adopting and approving again.
    const w = build({
      productGroupId: MILK,
      items: [{ itemId: itemId(1) }],
      approvalStatus: LineApprovalStatus.APPROVED,
      permissions: [ListPermission.READ, ListPermission.DECIDE],
    });

    const view = await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      adoptItemIds: [itemId(1)],
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.APPROVED);
    expect(setOf(w)).toEqual([
      { itemId: itemId(1), source: LineItemSource.USER },
    ]);
  });

  it('puts the line back to PENDING when a writer adopts on an approved line', async () => {
    // Plan 0076, section 2: a writer may now change the set an approved line
    // holds, and the change asks the group again.
    const w = build({
      productGroupId: MILK,
      items: [{ itemId: itemId(1) }],
      approvalStatus: LineApprovalStatus.APPROVED,
      permissions: [ListPermission.READ, ListPermission.WRITE],
    });

    const view = await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      adoptItemIds: [itemId(1)],
    });

    expect(view.approvalStatus).toBe(LineApprovalStatus.PENDING);
    expect(setOf(w)).toEqual([
      { itemId: itemId(1), source: LineItemSource.USER },
    ]);
  });

  it('is not read out of a set replacement that happens to keep a product', async () => {
    // Removing one product is not a statement about who owns the others, and
    // inferring adoption from `itemIds` would adopt the whole line every time.
    const w = build({
      productGroupId: MILK,
      items: [{ itemId: itemId(1) }, { itemId: itemId(2) }],
    });

    const view = await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      itemIds: [itemId(1)],
    });

    expect(view.groupItemIds).toEqual([itemId(1)]);
  });
});

describe('taking a product off a subscribed line (plan 0070, section 2)', () => {
  it('records the refusal, so the group re-adding it is a no op', async () => {
    const w = build({
      productGroupId: MILK,
      items: [{ itemId: itemId(1) }, { itemId: itemId(2) }],
    });

    await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      itemIds: [itemId(1)],
    });

    // A user deletion has to be a record and not an absence: with the row simply
    // gone, the next sync could not tell this from a product that had just
    // joined the group, and it would put it back forever.
    expect(w.groupRemovals.rows).toEqual([
      { lineId: LINE_ID, itemId: itemId(2) },
    ]);
  });

  it('records nothing for a product the group never owned', async () => {
    const w = build({
      productGroupId: MILK,
      items: [
        { itemId: itemId(1) },
        { itemId: itemId(2), source: LineItemSource.USER },
      ],
    });

    await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      itemIds: [itemId(1)],
    });

    // Section 2's table says "which of the **group's** products a person took
    // off". One they typed, or adopted, was never the group's to put back.
    expect(w.groupRemovals.rows).toEqual([]);
  });

  it('records nothing on a line that is not subscribed', async () => {
    // Nothing reads a tombstone on a hand made line, and one sitting there could
    // only become misleading if the line were later bound to a group.
    const w = build({
      productGroupId: null,
      items: [
        { itemId: itemId(1), source: LineItemSource.USER },
        { itemId: itemId(2), source: LineItemSource.USER },
      ],
    });

    await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      itemIds: [itemId(1)],
    });

    expect(w.groupRemovals.rows).toEqual([]);
  });

  it('clears the refusal when the person puts it back by hand', async () => {
    const w = build({
      productGroupId: MILK,
      items: [{ itemId: itemId(1) }],
      removed: [itemId(2)],
    });

    const view = await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      itemIds: [itemId(1), itemId(2)],
    });

    // The same person answering the same question a second time, and the later
    // answer is the one that stands.
    expect(w.groupRemovals.rows).toEqual([]);
    // And it comes back as **theirs**, not the group's: a person put it there.
    expect(view.groupItemIds).toEqual([itemId(1)]);
    expect(setOf(w)).toEqual([
      { itemId: itemId(1), source: LineItemSource.GROUP },
      { itemId: itemId(2), source: LineItemSource.USER },
    ]);
  });
});

describe('the cap is what a person may grow a line to (plan 0070, section 7)', () => {
  /** A subscribed line already holding `n` of the group's products. */
  function held(n: number) {
    return build({
      productGroupId: MILK,
      items: Array.from({ length: n }, (_, i) => ({ itemId: itemId(i + 1) })),
    });
  }

  const ids = (n: number) => Array.from({ length: n }, (_, i) => itemId(i + 1));

  it('refuses a request past the cap whole, rather than filling what fits', async () => {
    const w = held(98);

    // 98 plus a group of 10 asks for 108, and **nothing** is added. A partial
    // fill would be the server choosing which 2 of a group's 10 products land on
    // somebody's shopping list, in an order that means nothing to them.
    await expect(
      w.service.update({ userId: ACTOR, lineId: LINE_ID, itemIds: ids(108) })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(setOf(w)).toHaveLength(98);
  });

  it('lets an over cap line shrink', async () => {
    // 104, which a growing group is allowed to produce (section 7.2). Refusing
    // 103 here would leave the line unable to come back under the cap, by the
    // rule that exists to keep it under the cap.
    const w = held(104);

    const view = await w.service.update({
      userId: ACTOR,
      lineId: LINE_ID,
      itemIds: ids(103),
    });

    expect(view.itemIds).toHaveLength(103);
  });

  it('refuses to let an over cap line grow', async () => {
    const w = held(104);

    await expect(
      w.service.update({ userId: ACTOR, lineId: LINE_ID, itemIds: ids(105) })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(setOf(w)).toHaveLength(104);
  });

  it('names the cap, what this line is allowed and what was offered', async () => {
    const w = held(104);

    // A client keys on `itemIds`, and a person looking at a line of 104 needs
    // more than "at most 100" to make sense of the refusal.
    await expect(
      w.service.update({ userId: ACTOR, lineId: LINE_ID, itemIds: ids(105) })
    ).rejects.toMatchObject({
      details: {
        itemIds: { cap: LINE_ITEM_SET_MAX, allowed: 104, offered: 105 },
      },
    });
  });
});
