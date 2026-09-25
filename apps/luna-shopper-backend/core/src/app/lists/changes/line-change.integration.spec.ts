import {
  LineApprovalStatus,
  LineChangeKind,
  ListPermission,
  MembershipStatus,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CoreAuditService } from '../../audit/core-audit.service';
import { fakeBasketAnnouncer } from '../../baskets/basket-announcer.fake';
import {
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineChange,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../../entities';
import { fakeLineClaims } from '../../baskets/line-claims.fake';
import { ZoneAuthzService } from '../../zones/zone-authz.service';
import { LineMergeService } from '../line-merge.service';
import { LineService } from '../line.service';
import { ListAccessService } from '../list-access.service';
import { SettlementService } from '../settlement.service';
import { LineChangeRecorder } from './line-change.recorder';

/**
 * Plan 0139 gave this service a basket announcer. Every write here is asserted
 * through the events it publishes, and the announcement is not one of them: it
 * is a nudge the basket rooms hear, tested in `basket-announcer.spec.ts`.
 */
const announcer = fakeBasketAnnouncer();

/**
 * Every record site, against real Postgres (plan 0138, section 13, tests 1 to 4).
 *
 * Each assertion here needs a database, and for one reason: what is under test is
 * **that a row exists** and that it exists in the same transaction as the write
 * that caused it. A fake manager would agree with a recorder that was never
 * called, with one that was called twice, and with one whose insert was committed
 * on its own.
 *
 * The `createdAt` a rename over three lists shares is the other thing only a
 * database can answer: it is the transaction's start time, written by `now()`.
 */
describeIntegration('what every write records (real Postgres)', () => {
  let dataSource: DataSource;
  let lines: LineService;
  let settlements: SettlementService;
  let recorder: LineChangeRecorder;

  const ids = {
    zone: '',
    owner: randomUUID(),
    writer: randomUUID(),
  };
  let position = 0;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const memberships = dataSource.getRepository(ZoneMembership);
    const listAccess = new ListAccessService(
      dataSource.getRepository(ShoppingList),
      dataSource.getRepository(ListAccess),
      dataSource.getRepository(ListLine),
      new ZoneAuthzService(memberships)
    );
    recorder = new LineChangeRecorder();
    lines = new LineService(
      dataSource,
      dataSource.getRepository(ListLine),
      dataSource.getRepository(ListLineItem),
      dataSource.getRepository(ListLineGroupRemoval),
      dataSource.getRepository(LineSettlement),
      listAccess,
      fakeLineClaims().service,
      { emit: jest.fn() } as never,
      new CoreAuditService(dataSource),
      new LineMergeService(recorder),
      recorder,
      announcer
    );
    settlements = new SettlementService(
      dataSource,
      dataSource.getRepository(LineSettlement),
      listAccess,
      fakeLineClaims().service,
      { emit: jest.fn() } as never,
      announcer
    );

    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Changes',
        joinCode: `CHG${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.owner,
        config: {},
      })
    );
    ids.zone = zone.id;
    await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: ids.owner,
        username: 'Owner',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
  });

  afterAll(async () => {
    if (ids.zone) {
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  // --- fixtures -------------------------------------------------------------

  async function list(name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    const saved = await repo.save(
      repo.create({ zoneId: ids.zone, name, createdByUserId: ids.owner })
    );
    return saved.id;
  }

  async function line(
    listId: string,
    content: string,
    quantity = 2,
    approvalStatus = LineApprovalStatus.APPROVED
  ): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    return repo.save(
      repo.create({
        listId,
        content,
        quantity,
        position,
        createdByUserId: ids.owner,
        approvalStatus,
      })
    );
  }

  /** Every change of a list, oldest first. */
  function changesOf(listId: string): Promise<ListLineChange[]> {
    return dataSource.getRepository(ListLineChange).find({
      where: { listId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  // --- 1. one row per write, of the right kind ------------------------------

  describe('one row per write (test 1)', () => {
    it('records an add, with the zone copied onto the row', async () => {
      const listId = await list('Adds');

      const added = await lines.add({
        userId: ids.owner,
        listId,
        content: 'Milk',
        quantity: 3,
      });

      const written = await changesOf(listId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        kind: LineChangeKind.ADDED,
        lineId: added.line.id,
        zoneId: ids.zone,
        contentAfter: 'Milk',
        quantityAfter: 3,
        contentBefore: null,
        quantityBefore: null,
        actorUserId: ids.owner,
        actorParticipantId: null,
        basketId: null,
      });
    });

    it('records an add that landed on a line the list held as a raise', async () => {
      // Plan 0091 made this a raise rather than an add, and the record says so:
      // the line was already there, and its quantity moved.
      const listId = await list('Raises');
      const milk = await line(listId, 'Milk', 2);

      await lines.add({ userId: ids.owner, listId, content: 'milk' });

      const [written] = await changesOf(listId);
      expect(written).toMatchObject({
        kind: LineChangeKind.QUANTITY_CHANGED,
        lineId: milk.id,
        quantityBefore: 2,
        quantityAfter: 3,
        contentBefore: null,
      });
    });

    it('records one row per written line of a batch', async () => {
      const listId = await list('Batch');

      await lines.addMany({
        userId: ids.owner,
        listId,
        items: [{ content: 'Bread' }, { content: 'Olives' }],
      });

      const written = await changesOf(listId);
      expect(written.map((row) => row.kind)).toEqual([
        LineChangeKind.ADDED,
        LineChangeKind.ADDED,
      ]);
      // One transaction, so one `createdAt`: a paste is one act.
      expect(written[0].createdAt.getTime()).toBe(
        written[1].createdAt.getTime()
      );
    });

    it('records an edit that touches no product, which now runs in a transaction', async () => {
      const listId = await list('Plain edits');
      const milk = await line(listId, 'Milk', 2);

      await lines.update({
        userId: ids.owner,
        lineId: milk.id,
        quantity: 5,
      });

      const [written] = await changesOf(listId);
      expect(written).toMatchObject({
        kind: LineChangeKind.QUANTITY_CHANGED,
        quantityBefore: 2,
        quantityAfter: 5,
      });
    });

    it('records an edit that renames, with every pair that moved', async () => {
      const listId = await list('Renames');
      const milk = await line(listId, 'Milk', 2);

      await lines.update({
        userId: ids.owner,
        lineId: milk.id,
        content: 'Whole milk',
        quantity: 4,
      });

      const [written] = await changesOf(listId);
      expect(written).toMatchObject({
        kind: LineChangeKind.RENAMED,
        contentBefore: 'Milk',
        contentAfter: 'Whole milk',
        quantityBefore: 2,
        quantityAfter: 4,
      });
    });

    it('records a delta', async () => {
      const listId = await list('Deltas');
      const milk = await line(listId, 'Milk', 2);

      await lines.addQuantity({
        userId: ids.owner,
        lineId: milk.id,
        delta: -1,
      });

      const [written] = await changesOf(listId);
      expect(written).toMatchObject({
        kind: LineChangeKind.QUANTITY_CHANGED,
        quantityBefore: 2,
        quantityAfter: 1,
      });
    });

    it('records a decision, on the member path that had no transaction', async () => {
      const listId = await list('Decisions');
      const milk = await line(listId, 'Milk', 2, LineApprovalStatus.PENDING);

      await lines.setApproval({
        userId: ids.owner,
        lineId: milk.id,
        approvalStatus: LineApprovalStatus.APPROVED,
      });

      const [written] = await changesOf(listId);
      expect(written).toMatchObject({
        kind: LineChangeKind.APPROVAL_CHANGED,
        approvalBefore: LineApprovalStatus.PENDING,
        approvalAfter: LineApprovalStatus.APPROVED,
        quantityBefore: null,
      });
    });

    it('records a delete, with what the line was asking for', async () => {
      const listId = await list('Deletes');
      const milk = await line(listId, 'Milk', 2, LineApprovalStatus.PENDING);

      await lines.delete({ userId: ids.owner, lineId: milk.id });

      const [written] = await changesOf(listId);
      expect(written).toMatchObject({
        kind: LineChangeKind.DELETED,
        lineId: milk.id,
        contentBefore: 'Milk',
        quantityBefore: 2,
        contentAfter: null,
        quantityAfter: null,
      });
    });

    it('records the basket a write came through, and the guest who made it', async () => {
      const listId = await list('Via a basket');
      const milk = await line(listId, 'Milk', 2);
      const basketId = randomUUID();
      const participantId = randomUUID();

      await lines.addQuantity({
        // The owner's account, which is what the write was authorized against.
        userId: ids.owner,
        lineId: milk.id,
        delta: 1,
        via: { participantId, basketId, userId: null },
      });

      const [written] = await changesOf(listId);
      // The actor is the guest who moved it, and **not** the owner whose
      // permission allowed it (plan 0138, section 4).
      expect(written).toMatchObject({
        actorUserId: null,
        actorParticipantId: participantId,
        basketId,
      });
    });

    it('records nothing for a settle or a reorder', async () => {
      // A purchase is not a change of what the household asks for (plan 0130,
      // section 11, decision 12), and a reorder moves `position`, which a basket
      // computes for itself. The revert and the skip are the basket's own writes
      // and are proven in `basket-changes.integration.spec.ts`.
      const listId = await list('Purchases');
      const milk = await line(listId, 'Milk', 2);
      const bread = await line(listId, 'Bread', 1);

      await settlements.settle({
        userId: ids.owner,
        lineId: milk.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
      });
      await lines.reorder({
        userId: ids.owner,
        listId,
        orderedLineIds: [bread.id, milk.id],
      });

      expect(await changesOf(listId)).toEqual([]);
    });

    it('records nothing for an edit that names the values the line already had', async () => {
      const listId = await list('No-ops');
      const milk = await line(listId, 'Milk', 2);

      await lines.update({
        userId: ids.owner,
        lineId: milk.id,
        content: 'Milk',
        quantity: 2,
      });

      expect(await changesOf(listId)).toEqual([]);
    });

    it('records nothing for a product only edit', async () => {
      // It moves a row's options rather than what the list asks for.
      const listId = await list('Products');
      const milk = await line(listId, 'Milk', 2);

      await lines.update({
        userId: ids.owner,
        lineId: milk.id,
        itemIds: [randomUUID()],
      });

      expect(await changesOf(listId)).toEqual([]);
    });
  });

  // --- 2 and 3. a refused write, and a rollback -----------------------------

  describe('nothing is recorded unless the write happened', () => {
    it('leaves no row when the rename is refused for a merge (test 2)', async () => {
      const listId = await list('Refused renames');
      const milk = await line(listId, 'Milk', 2);
      await line(listId, 'Bread', 1);

      await expect(
        lines.update({ userId: ids.owner, lineId: milk.id, content: 'Bread' })
      ).rejects.toThrow();

      // Every refusal comes before any write (plan 0112), and the change is a
      // write.
      expect(await changesOf(listId)).toEqual([]);
    });

    it('leaves no row when the edit is refused by the permission check', async () => {
      const listId = await list('Refused edits');
      const milk = await line(listId, 'Milk', 2);

      await expect(
        lines.update({ userId: ids.writer, lineId: milk.id, quantity: 9 })
      ).rejects.toThrow();

      expect(await changesOf(listId)).toEqual([]);
    });

    it('rolls the change back with the write that threw after it (test 3)', async () => {
      const listId = await list('Rollbacks');
      const milk = await line(listId, 'Milk', 2);

      await expect(
        dataSource.transaction(async (manager) => {
          await recorder.added(
            manager,
            { id: listId, zoneId: ids.zone },
            milk,
            { userId: ids.owner, participantId: null, basketId: null }
          );
          throw new Error('the write failed after recording');
        })
      ).rejects.toThrow('the write failed after recording');

      // The whole point of the recorder holding no repository: it cannot commit
      // apart from its caller.
      expect(await changesOf(listId)).toEqual([]);
    });
  });

  // --- 4. merges ------------------------------------------------------------

  describe('a merge (test 4)', () => {
    it('writes one row naming the survivor, and none for the survivor', async () => {
      const listId = await list('Merges');
      const milk = await line(listId, 'Milk', 2);
      const leche = await line(listId, 'Leche', 1);

      await lines.update({
        userId: ids.owner,
        lineId: leche.id,
        content: 'Milk',
        confirmMerge: true,
      });

      const written = await changesOf(listId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        kind: LineChangeKind.MERGED,
        // The line that went, and the one it went into.
        lineId: leche.id,
        mergedIntoLineId: milk.id,
        contentBefore: 'Leche',
        contentAfter: 'Milk',
        quantityBefore: 1,
        quantityAfter: 3,
      });
    });

    it('carries the renamed line’s new name when it is the survivor', async () => {
      // The renamed line is earlier, so it survives, and its rename rides in this
      // row's `contentAfter` rather than in a second row.
      const listId = await list('Merges the other way');
      const leche = await line(listId, 'Leche', 1);
      const milk = await line(listId, 'Milk', 2);

      await lines.update({
        userId: ids.owner,
        lineId: leche.id,
        content: 'Milk',
        confirmMerge: true,
      });

      const written = await changesOf(listId);
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        kind: LineChangeKind.MERGED,
        lineId: milk.id,
        mergedIntoLineId: leche.id,
        contentAfter: 'Milk',
      });
    });

    it('writes one row per list of a rename over three lists, sharing one createdAt', async () => {
      const listIds = [
        await list('Flat'),
        await list('Parents'),
        await list('Office'),
      ];
      const seeded: ListLine[] = [];
      for (const listId of listIds) {
        seeded.push(await line(listId, 'Olives', 1));
      }

      await dataSource.transaction(async (manager) => {
        const locked = await lines.lockListsForRename(manager, listIds);
        for (const [listId, shoppingList] of locked) {
          const plan = await lines.planListRename(
            manager,
            shoppingList,
            seeded.filter((row) => row.listId === listId).map((row) => row.id),
            'Green olives',
            new Set([ListPermission.MANAGE]),
            { userId: ids.owner, participantId: null, basketId: null }
          );
          await lines.writeListRename(manager, plan);
        }
      });

      const written = (
        await dataSource.getRepository(ListLineChange).find({
          where: listIds.map((listId) => ({ listId })),
        })
      ).sort((a, b) => a.listId.localeCompare(b.listId));
      expect(written).toHaveLength(3);
      expect(new Set(written.map((row) => row.kind))).toEqual(
        new Set([LineChangeKind.RENAMED])
      );
      // One act, one `createdAt`, because the database stamps the transaction's
      // start: acknowledging any one of these acknowledges all three.
      const stamps = new Set(written.map((row) => row.createdAt.getTime()));
      expect(stamps.size).toBe(1);
    });
  });
});
