import {
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  RealtimeEvent,
  SettlementOutcome,
  ZoneRole,
  type LineSettlementResult,
} from '@portfolio/luna-shopper/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import type { ListAccess, ListLine, ShoppingList } from '../entities';
import { LineSettlement, ListLineItem } from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeLineItems } from './line-items.fake';
import { fakeLineSettlements } from './line-settlements.fake';
import { ListAccessService } from './list-access.service';
import { SettlementService } from './settlement.service';

/**
 * Settling a line (plan 0047, section 4).
 *
 * The table the plan states is the shape of this file: `BOUGHT` writes a
 * settlement and decrements, `NOT_AVAILABLE` writes one and moves nothing, and
 * skipping is not a call. What is asserted most often is the pair of numbers
 * that make the model work, what was recorded and what is still wanted, because
 * they come apart in exactly the cases a naive implementation gets wrong: a
 * partial settle, and buying more than was asked for.
 *
 * The reads are not here. They are cursors over a table, and a mocked repository
 * has no rows to order; `line-settlement.integration.spec.ts` runs them against
 * real Postgres, which is also the only thing that can prove the access filter on
 * the cross list history.
 */

const LIST_ID = 'l1';
const ZONE_ID = 'z1';
const SHOPPER = 'u-shopper';
const AUTHOR = 'u-author';
const MILK_ITEM = '3f1a0c5e-2b7d-4a6f-8c91-0d2e4b6a8c13';
const BREAD_ITEM = '7c2b9d41-5e6a-4f38-9b02-1a4c7e8d5f62';

interface Harness {
  service: SettlementService;
  saved: Partial<ListLine>[];
  written: Partial<LineSettlement>[];
  events: { event: RealtimeEvent; payload: LineSettlementResult }[];
  line: ListLine;
}

function build(options: {
  permissions?: ListPermission[];
  quantity?: number;
  approvalStatus?: LineApprovalStatus;
  /** The line's product set, in the order it was attached. */
  itemIds?: string[];
}): Harness {
  const list = {
    id: LIST_ID,
    zoneId: ZONE_ID,
    name: 'Groceries',
    createdByUserId: AUTHOR,
    autoApproveLines: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ShoppingList;

  const line = {
    id: 'li1',
    listId: LIST_ID,
    content: 'Milk',
    quantity: options.quantity ?? 2,
    itemSetHash: null,
    position: 10,
    approvalStatus: options.approvalStatus ?? LineApprovalStatus.APPROVED,
    createdByUserId: AUTHOR,
    approvedByUserId: AUTHOR,
    version: 4,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ListLine;

  const saved: Partial<ListLine>[] = [];
  const events: { event: RealtimeEvent; payload: LineSettlementResult }[] = [];

  const lineRepo = {
    findOne: async () => line,
    save: async (row: Partial<ListLine>) => {
      const stored = {
        ...row,
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      };
      saved.push(stored);
      return stored;
    },
  };

  // The shared fake rather than a save-only stub: the settle reads the table
  // back after the insert, to count what the line has now been bought (plan
  // 0047, section 5). Its own row list is what the assertions read, so what is
  // asserted is what the service could have gone on to read.
  const settlements = fakeLineSettlements();
  const settlementRepo = settlements.repo;
  const written = settlements.rows;

  const memberships = {
    findOne: async () =>
      ({
        id: 'm1',
        zoneId: ZONE_ID,
        userId: SHOPPER,
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
          ListPermission.DECIDE,
        ],
      }) as ListAccess,
  };

  const listAccess = new ListAccessService(
    { findOne: async () => list } as never,
    accessRepo as never,
    lineRepo as never,
    new ZoneAuthzService(memberships as never)
  );

  const lineItems = fakeLineItems(
    (options.itemIds ?? []).map((itemId, position) => ({
      lineId: line.id,
      itemId,
      position,
    }))
  );

  const dataSource = {
    transaction: async <T>(run: (m: EntityManager) => Promise<T>) =>
      run({
        getRepository: (entity: unknown) => {
          if (entity === ListLineItem) {
            return lineItems.repo;
          }
          return entity === LineSettlement ? settlementRepo : lineRepo;
        },
      } as unknown as EntityManager),
  } as unknown as DataSource;

  const publisher = {
    emit: (
      event: RealtimeEvent,
      _zoneId: string,
      payload: LineSettlementResult
    ) => events.push({ event, payload }),
  } as unknown as CoreEventsPublisher;

  const service = new SettlementService(
    dataSource,
    settlementRepo as never,
    listAccess,
    publisher
  );

  return { service, saved, written, events, line };
}

describe('line.settle (plan 0047, section 4)', () => {
  it('records the purchase, decrements the line, and leaves it in place', async () => {
    const w = build({ quantity: 2 });

    const { line, settlement } = await w.service.settle({
      userId: SHOPPER,
      lineId: 'li1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 2,
    });

    expect(settlement.outcome).toBe(SettlementOutcome.BOUGHT);
    expect(settlement.quantity).toBe(2);
    expect(settlement.settledByUserId).toBe(SHOPPER);
    // Zero is stocked, not deleted: the line is still there, holding everything
    // it knows about itself (section 2.2).
    expect(line.quantity).toBe(0);
    expect(w.saved).toHaveLength(1);
    expect(w.written).toHaveLength(1);
  });

  /**
   * The two indicators the list page draws every row from (section 5).
   *
   * They are on the answer rather than left to a second read because the client
   * cannot compute either: `quantity = 0` alone cannot tell a thing that has just
   * been bought from a thing somebody typed and has never needed, and "they did
   * not have it" is a fact about the last trip that expires the moment somebody
   * does buy it.
   */
  describe('the two indicators it carries back', () => {
    it('counts the purchase it has just written, not the one before it', async () => {
      const w = build({ quantity: 2 });

      const { line } = await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
      });

      // One, and not zero: the count is read after the insert, inside the same
      // transaction, so a line that is at zero because it was just bought is
      // distinguishable from one that has never been wanted.
      expect(line.boughtCount).toBe(1);
      expect(line.lastSettlementOutcome).toBe(SettlementOutcome.BOUGHT);
    });

    it('accumulates across settles', async () => {
      const w = build({ quantity: 3 });

      await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
      });
      const second = await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
      });

      expect(second.line.boughtCount).toBe(2);
    });

    it('reports a missing product without counting it as a purchase', async () => {
      const w = build({ quantity: 1 });

      const { line } = await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });

      // Nothing was bought, so nothing is counted, and the line still wants one.
      // What changed is only the most recent outcome, which is what draws "not in
      // the shop last time" on a line that is emphatically still wanted.
      expect(line.boughtCount).toBe(0);
      expect(line.lastSettlementOutcome).toBe(SettlementOutcome.NOT_AVAILABLE);
      expect(line.quantity).toBe(1);
    });

    it('lets a purchase clear a previous not available', async () => {
      const w = build({ quantity: 1 });

      await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.NOT_AVAILABLE,
      });
      const bought = await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
      });

      // The most recent one wins, which is the whole reason it is read off the
      // top of the history rather than stored as a flag somebody has to clear.
      expect(bought.line.lastSettlementOutcome).toBe(SettlementOutcome.BOUGHT);
      expect(bought.line.boughtCount).toBe(1);
    });
  });

  it('leaves the remainder wanted, and a second settle finishes it', async () => {
    // Nothing about settling is terminal (section 4.1), which is the property a
    // basket worked through two shops in one afternoon depends on.
    const w = build({ quantity: 3 });

    const first = await w.service.settle({
      userId: SHOPPER,
      lineId: 'li1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 2,
    });
    expect(first.line.quantity).toBe(1);

    const second = await w.service.settle({
      userId: SHOPPER,
      lineId: 'li1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
    });
    expect(second.line.quantity).toBe(0);
    expect(w.written.map((row) => row.quantity)).toEqual([2, 1]);
  });

  it('floors the quantity at zero and records what was really bought', async () => {
    // Section 4.2. The extra unit is real and belongs in the consumption
    // history even though it has no demand to satisfy, and a settlement clamped
    // to the outstanding demand would under report what the household gets
    // through.
    const w = build({ quantity: 2 });

    const { line, settlement } = await w.service.settle({
      userId: SHOPPER,
      lineId: 'li1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 3,
    });

    expect(line.quantity).toBe(0);
    expect(settlement.quantity).toBe(3);
  });

  it('buys one when the caller named no number', async () => {
    const w = build({ quantity: 2 });

    const { line, settlement } = await w.service.settle({
      userId: SHOPPER,
      lineId: 'li1',
      outcome: SettlementOutcome.BOUGHT,
    });

    expect(settlement.quantity).toBe(1);
    expect(line.quantity).toBe(1);
  });

  it('records that the shop did not have it, and moves nothing', async () => {
    const w = build({ quantity: 2 });

    const { line, settlement } = await w.service.settle({
      userId: SHOPPER,
      lineId: 'li1',
      outcome: SettlementOutcome.NOT_AVAILABLE,
    });

    expect(settlement.outcome).toBe(SettlementOutcome.NOT_AVAILABLE);
    expect(settlement.quantity).toBe(0);
    expect(line.quantity).toBe(2);
    // The line was not written at all, so its version did not move either: a
    // report that nothing was obtained is not an edit of the line.
    expect(w.saved).toHaveLength(0);
    expect(w.written).toHaveLength(1);
  });

  it('refuses a quantity on a line the shop did not have', async () => {
    // Rather than ignoring one. A caller sending "they had none, quantity 3" has
    // misunderstood the call badly enough that writing a zero over it would hide
    // the mistake.
    const w = build({ quantity: 2 });

    await expect(
      w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.NOT_AVAILABLE,
        quantity: 3,
      })
    ).rejects.toThrow(/no quantity/);
    expect(w.written).toHaveLength(0);
  });

  it('refuses a quantity that is not a whole number of units', async () => {
    const w = build({ quantity: 2 });

    await expect(
      w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
        quantity: 0,
      })
    ).rejects.toThrow(/whole number/);
    expect(w.written).toHaveLength(0);
  });

  it('never reopens an approval', async () => {
    // Section 7: approval answers whether the thing belongs on the list, and
    // buying it is not an opinion about that. An edit would put a rejected line
    // back to PENDING; this is not an edit.
    const w = build({
      quantity: 2,
      approvalStatus: LineApprovalStatus.REJECTED,
    });

    const { line } = await w.service.settle({
      userId: SHOPPER,
      lineId: 'li1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
    });

    expect(line.approvalStatus).toBe(LineApprovalStatus.REJECTED);
  });

  it('announces the line and the settlement together, after the write', async () => {
    // Section 8: a phone in the shop and a phone at home agree from this without
    // a refetch, which a bare line update could not give them.
    const w = build({ quantity: 2 });

    await w.service.settle({
      userId: SHOPPER,
      lineId: 'li1',
      outcome: SettlementOutcome.BOUGHT,
      quantity: 1,
    });

    expect(w.events).toHaveLength(1);
    expect(w.events[0].event).toBe(RealtimeEvent.LineSettled);
    expect(w.events[0].payload.line.quantity).toBe(1);
    expect(w.events[0].payload.settlement.quantity).toBe(1);
  });

  describe('the product it records (section 3.2)', () => {
    it('copies the only product of a line that carries one', async () => {
      // No argument needed: there is one answer, and asking every caller to
      // repeat it would make the ordinary settle two round trips.
      const w = build({ quantity: 1, itemIds: [MILK_ITEM] });

      const { settlement } = await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
      });

      expect(settlement.itemId).toBe(MILK_ITEM);
    });

    it('records the one the caller named, out of a set', async () => {
      const w = build({ quantity: 1, itemIds: [MILK_ITEM, BREAD_ITEM] });

      const { settlement } = await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
        itemId: BREAD_ITEM,
      });

      expect(settlement.itemId).toBe(BREAD_ITEM);
    });

    it('records nothing when a line carries several and nobody said which', async () => {
      // Honest rather than a guess: something was bought and the record does not
      // claim to know which of them it was.
      const w = build({ quantity: 1, itemIds: [MILK_ITEM, BREAD_ITEM] });

      const { settlement } = await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
      });

      expect(settlement.itemId).toBeNull();
    });

    it('records nothing for a free text line', async () => {
      const w = build({ quantity: 1 });

      const { settlement } = await w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
      });

      expect(settlement.itemId).toBeNull();
    });

    it('refuses a product the line does not stand for', async () => {
      // It would otherwise put a purchase into the cross list history of
      // something nobody bought.
      const w = build({ quantity: 1, itemIds: [MILK_ITEM] });

      await expect(
        w.service.settle({
          userId: SHOPPER,
          lineId: 'li1',
          outcome: SettlementOutcome.BOUGHT,
          itemId: BREAD_ITEM,
        })
      ).rejects.toThrow(/not one this line stands for/);
      expect(w.written).toHaveLength(0);
    });

    it('refuses a product reference that is not one', async () => {
      const w = build({ quantity: 1, itemIds: [MILK_ITEM] });

      await expect(
        w.service.settle({
          userId: SHOPPER,
          lineId: 'li1',
          outcome: SettlementOutcome.BOUGHT,
          itemId: 'the milk',
        })
      ).rejects.toThrow(/valid item reference/);
    });
  });

  it('is refused for a caller who may only read the list', async () => {
    const w = build({ permissions: [ListPermission.READ] });

    await expect(
      w.service.settle({
        userId: SHOPPER,
        lineId: 'li1',
        outcome: SettlementOutcome.BOUGHT,
      })
    ).rejects.toThrow();
    expect(w.written).toHaveLength(0);
    expect(w.events).toHaveLength(0);
  });
});
