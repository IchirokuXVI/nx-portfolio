import {
  BasketKind,
  BasketStatus,
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import { StaleQuantityException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import {
  Basket,
  BasketParticipant,
  BasketSource,
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { itemSetHash } from '../lists/item-set-hash';
import { LineMergeService } from '../lists/line-merge.service';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeBasketAnnouncer } from './basket-announcer.fake';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import {
  BASKET_TRIP_ROWS_FREEZE_SQL,
  BASKET_TRIP_ROWS_THAW_SQL,
} from './basket-trip-rows.sql';
import { BasketService } from './basket.service';
import { fakeBasketMarks } from './changes/basket-marks.fake';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A finished basket holds still, and a quantity typed on the list page waits
 * for the purchase (plan 0209, sections 1, 2 and 7), against real Postgres.
 *
 * The finish and the reopen run the statements `BasketService.update` runs in
 * the transaction of the status change, so the frozen rows here are the rows a
 * real finish writes.
 *
 * The gateway's two rows routes ask core the same `basket.get` that the full
 * read asks, which is `BasketReadService.view`, so one read here answers for
 * all three.
 */
describeIntegration('a finished basket holds still (real Postgres)', () => {
  let dataSource: DataSource;
  let read: BasketReadService;
  let history: BasketService;
  let lines: LineService;

  const owner = randomUUID();
  const ids = { home: '', away: '', flat: '', parents: '', away1: '' };
  let position = 0;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const baskets = dataSource.getRepository(Basket);
    const coverage = new BasketCoverageService(baskets);
    read = new BasketReadService(
      baskets,
      coverage,
      // The reader is the owner, who writes exactly the lists the coverage
      // holds. The participants are the owner alone.
      {
        writableAmong: async (_userId: string, listIds: readonly string[]) =>
          new Set(listIds),
        listParticipants: async (req: { asParticipantId: string }) => ({
          participants: [
            {
              id: req.asParticipantId,
              kind: ParticipantKind.OWNER,
              displayName: null,
            },
          ],
        }),
      } as never,
      {
        permissionsAmong: async (_userId: string, listIds: readonly string[]) =>
          new Map(
            listIds.map((listId) => [
              listId,
              new Set([
                ListPermission.READ,
                ListPermission.WRITE,
                ListPermission.DECIDE,
                ListPermission.MANAGE,
              ]),
            ])
          ),
      } as never,
      { order: async <T>(_userId: string, rows: T[]) => rows } as never,
      fakeBasketMarks(),
      fakeCoreConfig()
    );
    history = new BasketService(
      dataSource,
      baskets,
      {} as never,
      fakeLineClaims({}).service,
      { emitToUsers: jest.fn() } as never,
      {} as never,
      dataSource.getRepository(BasketSource),
      {} as never,
      read
    );

    const memberships = dataSource.getRepository(ZoneMembership);
    lines = new LineService(
      dataSource,
      dataSource.getRepository(ListLine),
      dataSource.getRepository(ListLineItem),
      dataSource.getRepository(ListLineGroupRemoval),
      dataSource.getRepository(LineSettlement),
      new ListAccessService(
        dataSource.getRepository(ShoppingList),
        dataSource.getRepository(ListAccess),
        dataSource.getRepository(ListLine),
        new ZoneAuthzService(memberships)
      ),
      fakeLineClaims().service,
      { emit: jest.fn(), emitTo: jest.fn() } as never,
      new CoreAuditService(dataSource),
      new LineMergeService(new LineChangeRecorder()),
      new LineChangeRecorder(),
      fakeBasketAnnouncer()
    );

    // Two zones, both the owner's. Losing the second one takes its list out
    // of the coverage and leaves the first alone.
    const zones = dataSource.getRepository(Zone);
    for (const key of ['home', 'away'] as const) {
      const zone = await zones.save(
        zones.create({
          name: `Frozen ${key}`,
          joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: owner,
          config: {},
        })
      );
      ids[key] = zone.id;
      await memberships.save(
        memberships.create({
          zoneId: zone.id,
          userId: owner,
          username: 'Owner',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        })
      );
    }
    ids.flat = await list(ids.home, 'Flat');
    ids.parents = await list(ids.home, 'Parents');
    ids.away1 = await list(ids.away, 'Cabin');
  });

  afterAll(async () => {
    await dataSource?.getRepository(Basket).delete({ ownerUserId: owner });
    for (const zoneId of [ids.home, ids.away]) {
      if (zoneId) {
        await dataSource.getRepository(Zone).delete({ id: zoneId });
      }
    }
    await dataSource?.destroy();
  });

  // --- fixtures ------------------------------------------------------------

  async function list(zoneId: string, name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    return (
      await repo.save(repo.create({ zoneId, name, createdByUserId: owner }))
    ).id;
  }

  async function line(
    listId: string,
    content: string,
    quantity: number,
    itemIds: string[] = []
  ): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content,
        quantity,
        position,
        createdByUserId: owner,
        approvalStatus: LineApprovalStatus.APPROVED,
        itemSetHash: itemSetHash(itemIds),
      })
    );
    const items = dataSource.getRepository(ListLineItem);
    for (const [index, itemId] of itemIds.entries()) {
      await items.save(
        items.create({ lineId: saved.id, itemId, position: index })
      );
    }
    return saved;
  }

  async function basket(...listIds: string[]): Promise<Basket> {
    const repo = dataSource.getRepository(Basket);
    const saved = await repo.save(
      repo.create({
        ownerUserId: owner,
        kind: BasketKind.GENERATED,
        name: 'Saturday',
        status: BasketStatus.OPEN,
        generatedAt: new Date(),
        idempotencyKey: null,
      })
    );
    const sources = dataSource.getRepository(BasketSource);
    const lists = dataSource.getRepository(ShoppingList);
    for (const listId of listIds) {
      const { zoneId } = await lists.findOneByOrFail({ id: listId });
      await sources.save(
        sources.create({ basketId: saved.id, zoneId, listId })
      );
    }
    return saved;
  }

  async function buy(
    held: Basket,
    bought: ListLine,
    quantity: number
  ): Promise<void> {
    const repo = dataSource.getRepository(LineSettlement);
    await repo.save(
      repo.create({
        lineId: bought.id,
        listId: bought.listId,
        itemId: null,
        outcome: SettlementOutcome.BOUGHT,
        quantity,
        settledByUserId: null,
        settledByParticipantId: randomUUID(),
        settledAt: new Date(),
        revertedAt: null,
        revertedByParticipantId: null,
        basketId: held.id,
        pricePaidCents: null,
        supermarketLocationId: null,
      })
    );
    // What a settle does to the line: the list asks that much less.
    await dataSource
      .getRepository(ListLine)
      .decrement({ id: bought.id }, 'quantity', quantity);
  }

  /** What `BasketService.update` does on the way to `FINISHED`. */
  async function finish(held: Basket): Promise<Basket> {
    await dataSource.transaction(async (manager) => {
      await manager.update(Basket, held.id, { status: BasketStatus.FINISHED });
      await manager.query(BASKET_TRIP_ROWS_FREEZE_SQL, [held.id]);
    });
    return dataSource.getRepository(Basket).findOneByOrFail({ id: held.id });
  }

  /** And on the way back to `OPEN`. */
  async function reopen(held: Basket): Promise<Basket> {
    await dataSource.transaction(async (manager) => {
      await manager.update(Basket, held.id, { status: BasketStatus.OPEN });
      await manager.query(BASKET_TRIP_ROWS_THAW_SQL, [held.id]);
    });
    return dataSource.getRepository(Basket).findOneByOrFail({ id: held.id });
  }

  function viewOf(held: Basket) {
    return read.view(held, {
      id: randomUUID(),
      basketId: held.id,
      userId: owner,
      kind: ParticipantKind.OWNER,
    } as BasketParticipant);
  }

  async function setAway(status: MembershipStatus): Promise<void> {
    await dataSource
      .getRepository(ZoneMembership)
      .update({ zoneId: ids.away, userId: owner }, { status });
  }

  // --- 1.1 the read --------------------------------------------------------

  describe('the read (section 1.1)', () => {
    it('answers what the trip asked when it finished, whatever the lists did since', async () => {
      const milk = await line(ids.flat, 'Milk frozen', 3);
      const bread = await line(ids.flat, 'Bread frozen', 1);
      const eggs = await line(ids.parents, 'Eggs frozen', 2);
      const rice = await line(ids.away1, 'Rice frozen', 4);
      const held = await basket(ids.flat, ids.parents, ids.away1);
      await buy(held, milk, 1);

      const finished = await finish(held);
      const before = await viewOf(finished);

      // After the finish: one line changes, one is deleted, and the owner
      // loses the zone of the third list.
      await dataSource.getRepository(ListLine).update(milk.id, { quantity: 9 });
      await dataSource.getRepository(ListLine).softDelete({ id: bread.id });
      await setAway(MembershipStatus.PENDING);
      try {
        const after = await viewOf(finished);
        const byName = new Map(after.rows.map((row) => [row.content, row]));

        expect(byName.get('Milk frozen')).toMatchObject({
          asked: 3,
          bought: 1,
          left: 2,
        });
        expect(byName.get('Bread frozen')).toMatchObject({
          asked: 1,
          left: 1,
        });
        expect(byName.get('Eggs frozen')).toMatchObject({ asked: 2, left: 2 });
        // The list the reader lost is still drawn, and redacted as an open
        // basket redacts it: the entry names no list.
        const lost = byName.get('Rice frozen');
        expect(lost).toMatchObject({ asked: 4, left: 4 });
        expect(lost?.entries[0]).not.toHaveProperty('listId');
        expect(after.lists.map((ref) => ref.listId)).not.toContain(ids.away1);
        expect(eggs.id).toBeDefined();
        expect(rice.id).toBeDefined();

        // The numbers did not move.
        expect(after.progress).toEqual(before.progress);
        expect(
          after.rows.map((row) => [row.rowKey, row.asked, row.left, row.bought])
        ).toEqual(
          before.rows.map((row) => [
            row.rowKey,
            row.asked,
            row.left,
            row.bought,
          ])
        );

        // The same basket reopened reads the live lists again.
        const open = await reopen(finished);
        const live = new Map(
          (await viewOf(open)).rows.map((row) => [row.content, row])
        );
        expect(live.get('Milk frozen')).toMatchObject({
          asked: 10,
          bought: 1,
          left: 9,
        });
        expect(live.has('Bread frozen')).toBe(false);
        expect(live.has('Rice frozen')).toBe(false);
        expect(live.get('Eggs frozen')).toMatchObject({ asked: 2 });
      } finally {
        await setAway(MembershipStatus.APPROVED);
      }
    });
  });

  // --- 1.2 the count -------------------------------------------------------

  describe('the count (section 1.2)', () => {
    it('counts products on the history card, as the screen does', async () => {
      const product = randomUUID();
      // Lists of their own, so the lines of the other tests are not frozen.
      const flat = await list(ids.home, 'Flat count');
      const parents = await list(ids.home, 'Parents count');
      // Two lines of one product on two lists, one line of its own.
      const flatMilk = await line(flat, 'Milk count flat', 2, [product]);
      await line(parents, 'Milk count parents', 1, [product]);
      await line(flat, 'Soap count', 1);
      const held = await basket(flat, parents);
      await buy(held, flatMilk, 2);

      const finished = await finish(held);
      const screen = await viewOf(finished);
      const counts = (await history.countsFor([finished])).get(finished.id);

      expect(screen.progress.total).toBe(2);
      expect(counts).toEqual({
        lineCount: screen.progress.total,
        settledLineCount: screen.progress.done + screen.progress.unavailable,
        boughtLineCount: screen.progress.done,
        notAvailableLineCount: screen.progress.unavailable,
      });
    });
  });

  // --- 2 the edit waits for the purchase -----------------------------------

  describe('a quantity typed on the list page (section 2)', () => {
    /**
     * Holds the line the way a settle does: locked, lowered and bought in one
     * transaction, committed after the edit has started.
     */
    async function whileASettleHoldsTheLine<T>(
      held: ListLine,
      run: () => Promise<T>
    ): Promise<T> {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT id FROM list_lines WHERE id = $1 FOR UPDATE', [
        held.id,
      ]);
      await runner.query(
        'UPDATE list_lines SET quantity = quantity - 2, version = version + 1 WHERE id = $1',
        [held.id]
      );
      const running = run();
      running.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
      await runner.commitTransaction();
      await runner.release();
      return running;
    }

    it('refuses an edit whose from a settle made stale, and keeps the settle', async () => {
      const held = await line(ids.flat, 'Oil race', 3);

      await expect(
        whileASettleHoldsTheLine(held, () =>
          lines.update({
            userId: owner,
            lineId: held.id,
            quantity: 5,
            from: 3,
          })
        )
      ).rejects.toBeInstanceOf(StaleQuantityException);

      const after = await dataSource
        .getRepository(ListLine)
        .findOneByOrFail({ id: held.id });
      expect(after.quantity).toBe(1);
    });

    it('writes an edit with no from after the settle, from the row the lock read', async () => {
      const held = await line(ids.flat, 'Salt race', 3);

      await whileASettleHoldsTheLine(held, () =>
        lines.update({ userId: owner, lineId: held.id, quantity: 5 })
      );

      const after = await dataSource
        .getRepository(ListLine)
        .findOneByOrFail({ id: held.id });
      expect(after.quantity).toBe(5);
      // The settle moved the version once and the edit once more: the edit
      // read the row the settle left, not the one it read before the lock.
      expect(after.version).toBe(held.version + 2);
    });

    it('writes an edit whose from still holds', async () => {
      const held = await line(ids.flat, 'Rice edit', 3);
      await lines.update({
        userId: owner,
        lineId: held.id,
        quantity: 4,
        from: 3,
      });
      const after = await dataSource
        .getRepository(ListLine)
        .findOneByOrFail({ id: held.id });
      expect(after.quantity).toBe(4);
    });
  });
});
