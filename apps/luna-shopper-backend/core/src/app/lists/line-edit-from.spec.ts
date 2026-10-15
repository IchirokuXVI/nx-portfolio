import {
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  ZoneRole,
} from '@portfolio/luna-shopper/contracts';
import { StaleQuantityException } from '@portfolio/luna-shopper/platform';
import type { DataSource, EntityManager } from 'typeorm';
import { fakeBasketAnnouncer } from '../baskets/basket-announcer.fake';
import { fakeLineClaims } from '../baskets/line-claims.fake';
import {
  LineSettlement,
  ListLineGroupRemoval,
  ListLineItem,
  type ListAccess,
  type ListLine,
  type ShoppingList,
} from '../entities';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeLineChanges } from './changes/line-change.fake';
import { fakeGroupRemovals, fakeLineItems } from './line-items.fake';
import { LineMergeService } from './line-merge.service';
import { fakeLineSettlements } from './line-settlements.fake';
import { LineService } from './line.service';
import { ListAccessService } from './list-access.service';

/**
 * The plain edit of a line reads it again under the lock, and may say what it
 * saw (plan 0209, sections 2.1 and 2.2).
 *
 * The line the access check reads and the line the lock reads are two rows
 * here, so a settle that landed between them is visible: the pre-read says 3
 * and the locked read says 1. Two transactions on real Postgres are in
 * `baskets/basket-frozen.integration.spec.ts`.
 */

const LIST_ID = 'l1';
const LINE_ID = 'li1';
const ACTOR = 'u-actor';

function lineAt(quantity: number, version: number): ListLine {
  return {
    id: LINE_ID,
    listId: LIST_ID,
    content: 'Milk',
    quantity,
    itemSetHash: null,
    productGroupId: null,
    favoriteItemId: null,
    preferredSupermarketId: null,
    named: true,
    position: 1,
    approvalStatus: LineApprovalStatus.PENDING,
    createdByUserId: ACTOR,
    approvedByUserId: null,
    version,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ListLine;
}

function build() {
  // What the access check reads, before the transaction.
  const seen = lineAt(3, 1);
  // What the lock reads: a settle bought two in between.
  const locked = lineAt(1, 2);
  const locks: unknown[] = [];
  const saved: ListLine[] = [];

  const outside = {
    findOne: async () => ({ ...seen }),
  };
  const inside = {
    findOne: async (options: { lock?: unknown }) => {
      locks.push(options.lock);
      return { ...locked };
    },
    save: async (row: ListLine) => {
      saved.push({ ...row });
      return row;
    },
  };

  const list = {
    id: LIST_ID,
    zoneId: 'z1',
    name: 'Groceries',
    createdByUserId: ACTOR,
    autoApproveLines: false,
  } as ShoppingList;
  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    {
      findOne: async () =>
        ({
          id: 'a1',
          listId: LIST_ID,
          membershipId: 'm1',
          permissions: [
            ListPermission.READ,
            ListPermission.WRITE,
            ListPermission.DECIDE,
          ],
        }) as ListAccess,
    } as never,
    outside as never,
    new ZoneAuthzService({
      findOne: async () =>
        ({
          id: 'm1',
          zoneId: 'z1',
          userId: ACTOR,
          role: ZoneRole.MEMBER,
          status: MembershipStatus.APPROVED,
        }) as never,
    } as never)
  );

  const lineItems = fakeLineItems([]);
  const groupRemovals = fakeGroupRemovals();
  const settlements = fakeLineSettlements();
  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run({
        getRepository: (entity: unknown) => {
          if (entity === ListLineItem) return lineItems.repo;
          if (entity === ListLineGroupRemoval) return groupRemovals.repo;
          if (entity === LineSettlement) return settlements.repo;
          return inside;
        },
      } as unknown as EntityManager),
  } as unknown as DataSource;

  const changes = fakeLineChanges();
  const service = new LineService(
    dataSource,
    outside as never,
    lineItems.repo as never,
    groupRemovals.repo as never,
    settlements.repo as never,
    listAccess,
    fakeLineClaims().service,
    { emit: () => undefined } as never,
    {} as never,
    new LineMergeService(changes.recorder),
    changes.recorder,
    fakeBasketAnnouncer()
  );
  const update = (fields: { quantity?: number; from?: number }) =>
    service.update({ userId: ACTOR, lineId: LINE_ID, ...fields });
  return { update, locks, saved };
}

describe('the plain edit of a line (plan 0209, section 2)', () => {
  it('reads the line under a pessimistic lock and edits that row', async () => {
    const w = build();
    await w.update({ quantity: 5 });

    expect(w.locks).toEqual([{ mode: 'pessimistic_write' }]);
    // The version the settle left, moved once more: the save is of the locked
    // row and not of the one read before the transaction.
    expect(w.saved).toHaveLength(1);
    expect(w.saved[0]).toMatchObject({ quantity: 5, version: 3 });
  });

  it('writes what it was given when from is absent', async () => {
    const w = build();
    await w.update({ quantity: 4 });
    expect(w.saved[0].quantity).toBe(4);
  });

  it('writes when from equals the locked quantity', async () => {
    const w = build();
    await w.update({ quantity: 4, from: 1 });
    expect(w.saved[0].quantity).toBe(4);
  });

  it('refuses a stale from with stale_quantity and writes nothing', async () => {
    const w = build();
    const refused = w.update({ quantity: 4, from: 3 });
    await expect(refused).rejects.toBeInstanceOf(StaleQuantityException);
    await expect(refused).rejects.toMatchObject({
      messageArgs: { current: 1 },
    });
    expect(w.saved).toEqual([]);
  });
});
