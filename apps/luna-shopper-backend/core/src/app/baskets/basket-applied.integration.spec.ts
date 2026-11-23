import {
  BasketKind,
  BasketStatus,
  LINE_QUANTITY_MAX,
  LineApprovalStatus,
  MembershipStatus,
  ParticipantKind,
  PURCHASE_SESSION_GAP_MS,
  SettlementOutcome,
  TripKind,
  TripRowOutcome,
  ZoneRole,
  ZoneStatus,
  type BasketRowView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
import { CoreAuditService } from '../audit/core-audit.service';
import {
  Basket,
  BasketParticipant,
  BasketSource,
  BasketTripRow,
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
} from '../entities';
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { LineMergeService } from '../lists/line-merge.service';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { toTripRowView } from '../lists/trips/trips.mappers';
import {
  BASKET_TRIP_ROWS_SQL,
  ENDED_TRIPS_SQL,
  LIVE_TRIPS_SQL,
  type TripLineRow,
  type TripRow,
} from '../lists/trips/trips.sql';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeBasketAnnouncer } from './basket-announcer.fake';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketDemandService } from './basket-demand.service';
import { BasketPatchReader } from './basket-patch.reader';
import { BasketReadService } from './basket-read.service';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BASKET_TRIP_ROWS_FREEZE_SQL } from './basket-trip-rows.sql';
import { BasketWriteContext } from './basket-write.context';
import { BasketMarksReader } from './changes/basket-marks.reader';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A buy records how much of the ask it met (plan 0274, section 1).
 *
 * Against Postgres, because every number here is a sum the database computes:
 * the ask of the basket read, of the trips read and of the freeze are three
 * statements over `applied`, and a mocked repository can only agree with
 * itself about them.
 *
 * Each test builds a zone of its own with one list and one `GENERATED` basket
 * that names that list, so no test reads another's lines.
 */
describeIntegration(
  'a buy records how much of the ask it met (real Postgres)',
  () => {
    let dataSource: DataSource;
    let read: BasketReadService;
    let settleService: BasketSettleService;
    let revertService: BasketRevertService;
    let demandService: BasketDemandService;
    let lines: LineService;

    const announcer = fakeBasketAnnouncer();
    const zoneIds: string[] = [];
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
      const resolver = new BasketRowResolver(baskets, fakeCoreConfig());
      const marks = new BasketMarksReader(
        dataSource.getRepository(ListLineChange),
        fakeCoreConfig()
      );
      const sharing = {
        writableAmong: async (_userId: string, listIds: readonly string[]) =>
          new Set(listIds),
        liveParticipantById: async (participantId: string) =>
          dataSource
            .getRepository(BasketParticipant)
            .findOne({ where: { id: participantId } }),
        listParticipants: async ({ basketId }: { basketId: string }) => ({
          participants: (
            await dataSource
              .getRepository(BasketParticipant)
              .find({ where: { basketId, revokedAt: IsNull() } })
          ).map((row) => ({
            id: row.id,
            kind: row.kind,
            displayName: row.displayName,
            username: row.username,
            guestNumber: row.guestNumber,
            userId: row.userId,
            shareLinkId: row.shareLinkId,
          })),
        }),
      } as never;
      const listAccess = new ListAccessService(
        dataSource.getRepository(ShoppingList),
        dataSource.getRepository(ListAccess),
        dataSource.getRepository(ListLine),
        new ZoneAuthzService(dataSource.getRepository(ZoneMembership))
      );
      read = new BasketReadService(
        baskets,
        coverage,
        sharing,
        listAccess,
        { order: async <T>(_userId: string, rows: T[]) => rows } as never,
        marks,
        fakeCoreConfig()
      );
      const context = new BasketWriteContext(
        baskets,
        coverage,
        sharing,
        resolver,
        read,
        announcer
      );
      const claims = {
        claimsOf: async () => new Map(),
        claimOf: async () => ({ claimed: false, claimedByUserId: null }),
        announceReleased: async () => undefined,
      } as never;
      const events = {
        emit: () => undefined,
        emitTo: () => undefined,
      } as never;
      settleService = new BasketSettleService(
        dataSource,
        baskets,
        context,
        claims,
        events,
        new LineChangeRecorder()
      );
      revertService = new BasketRevertService(
        dataSource,
        context,
        claims,
        events,
        new LineChangeRecorder()
      );
      lines = new LineService(
        dataSource,
        dataSource.getRepository(ListLine),
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ListLineGroupRemoval),
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        events,
        new CoreAuditService(dataSource),
        new LineMergeService(new LineChangeRecorder()),
        new LineChangeRecorder(),
        announcer
      );
      demandService = new BasketDemandService(
        context,
        lines,
        listAccess,
        events,
        dataSource
      );
    });

    afterAll(async () => {
      const zones = dataSource.getRepository(Zone);
      for (const zoneId of zoneIds) {
        // Lists, lines and settlements cascade from the zone.
        await zones.delete({ id: zoneId });
      }
      await dataSource?.destroy();
    });

    // --- fixtures ------------------------------------------------------------

    interface World {
      listId: string;
      userId: string;
      basket: Basket;
      participantId: string;
    }

    async function world(): Promise<World> {
      const userId = randomUUID();
      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Applied',
          joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: userId,
          config: {},
        })
      );
      zoneIds.push(zone.id);
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.save(
        memberships.create({
          zoneId: zone.id,
          userId,
          username: 'Ana',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        })
      );
      const lists = dataSource.getRepository(ShoppingList);
      const list = await lists.save(
        lists.create({
          zoneId: zone.id,
          name: 'Weekly',
          createdByUserId: userId,
        })
      );
      const baskets = dataSource.getRepository(Basket);
      const basket = await baskets.save(
        baskets.create({
          ownerUserId: userId,
          kind: BasketKind.GENERATED,
          name: 'Saturday',
          status: BasketStatus.OPEN,
          generatedAt: new Date(Date.now() - 60 * 60 * 1000),
          idempotencyKey: null,
        })
      );
      const sources = dataSource.getRepository(BasketSource);
      await sources.save(
        sources.create({
          basketId: basket.id,
          zoneId: zone.id,
          listId: list.id,
        })
      );
      const participants = dataSource.getRepository(BasketParticipant);
      const owner = await participants.save(
        participants.create({
          basketId: basket.id,
          shareLinkId: null,
          kind: ParticipantKind.OWNER,
          userId,
          displayName: null,
          username: 'Ana',
          guestNumber: null,
          sessionSecretHash: null,
          userAgent: null,
          joinedAt: new Date(Date.now() - 60 * 60 * 1000),
          lastSeenAt: new Date(),
          revokedAt: null,
          expiresAt: null,
        })
      );
      return { listId: list.id, userId, basket, participantId: owner.id };
    }

    async function line(
      w: World,
      quantity: number,
      itemIds: readonly string[] = []
    ): Promise<ListLine> {
      const repo = dataSource.getRepository(ListLine);
      position += 1;
      const saved = await repo.save(
        repo.create({
          listId: w.listId,
          content: 'Milk',
          quantity,
          position,
          createdByUserId: w.userId,
          approvalStatus: LineApprovalStatus.APPROVED,
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

    const buy = (w: World, lineIds: string[], quantity: number, from: number) =>
      settleService.settle({
        basketId: w.basket.id,
        participantId: w.participantId,
        rowKey: lineIds[0],
        lineIds,
        outcome: SettlementOutcome.BOUGHT,
        unit: 'UNIT',
        quantity,
        from,
      });

    const minus = (w: World, lineIds: string[], units: number, from: number) =>
      revertService.revert({
        basketId: w.basket.id,
        participantId: w.participantId,
        rowKey: lineIds[0],
        lineIds,
        target: 'UNITS',
        units,
        from,
      });

    const ask = (w: World, lineId: string, quantity: number, from: number) =>
      demandService.setDemand({
        basketId: w.basket.id,
        participantId: w.participantId,
        rowKey: lineId,
        lineId,
        quantity,
        unit: 'UNIT',
        from,
      });

    /** The row that holds this line, as the basket read serves it. */
    async function rowOf(w: World, lineId: string): Promise<BasketRowView> {
      const view = await read.read({
        basketId: w.basket.id,
        participantId: w.participantId,
      });
      const row = view.rows.find((candidate) =>
        candidate.entries.some((entry) => entry.lineId === lineId)
      );
      if (!row) {
        throw new Error(`no row holds ${lineId}`);
      }
      return row;
    }

    async function numbersOf(w: World, lineId: string) {
      const row = await rowOf(w, lineId);
      // A row of one entry: the entry's own ask is the row's.
      expect(row.entries.map((entry) => entry.asked)).toEqual([row.asked]);
      return { asked: row.asked, left: row.left, bought: row.bought };
    }

    /** The trips read of this basket, one row per line (plan 0122). */
    async function tripOf(w: World, lineId: string): Promise<TripLineRow> {
      const rows = await dataSource.query<TripLineRow[]>(BASKET_TRIP_ROWS_SQL, [
        w.listId,
        w.basket.id,
        null,
        50,
      ]);
      const row = rows.find((candidate) => candidate.lineId === lineId);
      if (!row) {
        throw new Error(`no trip row for ${lineId}`);
      }
      return row;
    }

    /** The trips read agrees with the basket read about the ask (section 1, 6). */
    async function expectTripAgrees(w: World, lineId: string): Promise<void> {
      const row = await rowOf(w, lineId);
      const trip = toTripRowView(TripKind.BASKET, await tripOf(w, lineId));
      expect(trip.asked).toBe(row.asked);
      expect(trip.bought).toBe(row.bought);
      expect(trip.left).toBe(row.left);
    }

    /** The trip summary of this basket, live or ended (plan 0122). */
    async function tripSummaryOf(w: World): Promise<TripRow> {
      const window = [w.listId, PURCHASE_SESSION_GAP_MS, new Date(0)];
      const live = await dataSource.query<TripRow[]>(LIVE_TRIPS_SQL, window);
      const ended = await dataSource.query<TripRow[]>(ENDED_TRIPS_SQL, [
        ...window,
        null,
        null,
        50,
      ]);
      const trip = [...live, ...ended].find((row) => row.id === w.basket.id);
      if (!trip) {
        throw new Error(`no trip for ${w.basket.id}`);
      }
      return trip;
    }

    /** What `basket.linesChanged` would carry for these lines now (plan 0204). */
    const patchesOf = (w: World, lineIds: string[]) =>
      new BasketPatchReader(
        dataSource.getRepository(Basket),
        fakeCoreConfig()
      ).entriesOf(
        { basketId: w.basket.id, kind: w.basket.kind },
        [w.listId],
        lineIds
      );

    const appliedOf = async (lineId: string) =>
      (
        await dataSource.getRepository(LineSettlement).find({
          where: { lineId, revertedAt: IsNull() },
          order: { settledAt: 'ASC', id: 'ASC' },
        })
      ).map((row) => ({ quantity: row.quantity, applied: row.applied }));

    const quantityOf = async (lineId: string) =>
      (await dataSource.getRepository(ListLine).findOneByOrFail({ id: lineId }))
        .quantity;

    // --- 1. the three cases of the table --------------------------------------

    describe('the table of the plan (spec 1, spec 6)', () => {
      it('a line made at 0 and bought 2 asks 0, and a minus of 1 keeps it at 0', async () => {
        const w = await world();
        const milk = await line(w, 0);
        // What backend 0273's write makes of a buy for a list that did not ask:
        // the line at 0 and a buy that met nothing. The settle route cannot buy
        // a line the basket does not draw, so the row is written as 0273 writes
        // it.
        await dataSource.getRepository(LineSettlement).insert({
          lineId: milk.id,
          listId: w.listId,
          itemId: null,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 2,
          applied: 0,
          settledByUserId: null,
          settledByParticipantId: w.participantId,
          settledAt: new Date(),
          basketId: w.basket.id,
        });

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 0,
          left: 0,
          bought: 2,
        });
        await expectTripAgrees(w, milk.id);

        await minus(w, [milk.id], 1, 2);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 0,
          left: 0,
          bought: 1,
        });
        expect(await quantityOf(milk.id)).toBe(0);
        await expectTripAgrees(w, milk.id);
      });

      it('a line asking 3 and bought 4 asks 3, and a minus of 1 takes the unit above it', async () => {
        const w = await world();
        const milk = await line(w, 3);

        await buy(w, [milk.id], 4, 3);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 3,
          left: 0,
          bought: 4,
        });
        expect(await appliedOf(milk.id)).toEqual([{ quantity: 4, applied: 3 }]);
        await expectTripAgrees(w, milk.id);

        await minus(w, [milk.id], 1, 4);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 3,
          left: 0,
          bought: 3,
        });
        expect(await appliedOf(milk.id)).toEqual([{ quantity: 3, applied: 3 }]);
        await expectTripAgrees(w, milk.id);
      });

      it('a line asking 3 and bought 2 asks 3, and a minus of 1 gives a unit back', async () => {
        const w = await world();
        const milk = await line(w, 3);

        await buy(w, [milk.id], 2, 3);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 3,
          left: 1,
          bought: 2,
        });
        await expectTripAgrees(w, milk.id);

        await minus(w, [milk.id], 1, 2);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 3,
          left: 2,
          bought: 1,
        });
        await expectTripAgrees(w, milk.id);
      });
    });

    // --- 2. a row of two lines ------------------------------------------------

    it('keeps each entry its ask when one entry of a row is bought above it (spec 2)', async () => {
      const w = await world();
      const product = randomUUID();
      const first = await line(w, 3, [product]);
      const second = await line(w, 1, [product]);
      const row = await rowOf(w, first.id);
      expect(row.entries.map((entry) => entry.lineId).sort()).toEqual(
        [first.id, second.id].sort()
      );

      const settled = await buy(w, [first.id], 5, 3);

      // The settle's own answer carries each entry's ask beside the row's.
      expect(
        settled.entries.find((candidate) => candidate.lineId === first.id)
      ).toMatchObject({ left: 0, bought: 5, asked: 3 });

      const after = await rowOf(w, first.id);
      // 3 and 1, so the row asks 4. Each entry's ask is its `left` plus what its
      // buys met: 0 + 3 for the first and 1 + 0 for the second.
      expect(after.asked).toBe(4);
      const entry = (lineId: string) =>
        after.entries.find((candidate) => candidate.lineId === lineId);
      expect(entry(first.id)).toMatchObject({ left: 0, bought: 5, asked: 3 });
      expect(entry(second.id)).toMatchObject({ left: 1, bought: 0, asked: 1 });
      expect(await appliedOf(first.id)).toEqual([{ quantity: 5, applied: 3 }]);

      // The patch of `basket.linesChanged` states the same ask per entry.
      const patches = await patchesOf(w, [first.id, second.id]);
      const patch = (lineId: string) =>
        patches.find((candidate) => candidate.lineId === lineId);
      expect(patch(first.id)).toMatchObject({ left: 0, bought: 5, asked: 3 });
      expect(patch(second.id)).toMatchObject({ left: 1, bought: 0, asked: 1 });

      // Its two units above the ask go first, so the line gets nothing back.
      await minus(w, [first.id], 2, 5);

      expect(await quantityOf(first.id)).toBe(0);
      const taken = await rowOf(w, first.id);
      expect(taken.asked).toBe(4);
      expect(
        taken.entries.find((candidate) => candidate.lineId === first.id)
      ).toMatchObject({ left: 0, bought: 3, asked: 3 });
      expect(
        taken.entries.find((candidate) => candidate.lineId === second.id)
      ).toMatchObject({ left: 1, bought: 0, asked: 1 });
      expect(await appliedOf(first.id)).toEqual([{ quantity: 3, applied: 3 }]);
    });

    // --- 3. a revert across two buys ------------------------------------------

    it('takes the newest buy first, its unit above the ask before its applied one (spec 3)', async () => {
      const w = await world();
      const milk = await line(w, 3);

      await buy(w, [milk.id], 2, 3);
      await buy(w, [milk.id], 2, 1);

      expect(await appliedOf(milk.id)).toEqual([
        { quantity: 2, applied: 2 },
        { quantity: 2, applied: 1 },
      ]);
      expect(await numbersOf(w, milk.id)).toEqual({
        asked: 3,
        left: 0,
        bought: 4,
      });

      await minus(w, [milk.id], 2, 4);

      // The newest buy went whole: its unit above the ask, then its applied one,
      // which is the one unit the line gets back.
      expect(await quantityOf(milk.id)).toBe(1);
      expect(await appliedOf(milk.id)).toEqual([{ quantity: 2, applied: 2 }]);
      expect(await numbersOf(w, milk.id)).toEqual({
        asked: 3,
        left: 1,
        bought: 2,
      });
      await expectTripAgrees(w, milk.id);
    });

    // --- 4. an ask set below what was applied ---------------------------------

    it('lowers what the buys met when the ask goes below it, and gives it back when it rises (spec 4)', async () => {
      const w = await world();
      const milk = await line(w, 3);
      await buy(w, [milk.id], 3, 3);
      expect(await numbersOf(w, milk.id)).toEqual({
        asked: 3,
        left: 0,
        bought: 3,
      });

      await ask(w, milk.id, 2, 0);

      expect(await numbersOf(w, milk.id)).toEqual({
        asked: 2,
        left: 0,
        bought: 3,
      });
      // One unit over: what was bought less what was asked.
      expect(await appliedOf(milk.id)).toEqual([{ quantity: 3, applied: 2 }]);
      await expectTripAgrees(w, milk.id);

      await ask(w, milk.id, 4, 0);

      expect(await numbersOf(w, milk.id)).toEqual({
        asked: 4,
        left: 1,
        bought: 3,
      });
      expect(await quantityOf(milk.id)).toBe(1);
      expect(await appliedOf(milk.id)).toEqual([{ quantity: 3, applied: 3 }]);
      await expectTripAgrees(w, milk.id);
    });

    it('lowers the newest buy first when the ask goes below two buys', async () => {
      const w = await world();
      const milk = await line(w, 4);
      await buy(w, [milk.id], 2, 4);
      await buy(w, [milk.id], 2, 2);

      await ask(w, milk.id, 1, 0);

      expect(await appliedOf(milk.id)).toEqual([
        { quantity: 2, applied: 1 },
        { quantity: 2, applied: 0 },
      ]);
      expect(await numbersOf(w, milk.id)).toEqual({
        asked: 1,
        left: 0,
        bought: 4,
      });
    });

    it('refuses an ask whose `from` is stale, and moves nothing', async () => {
      const w = await world();
      const milk = await line(w, 3);
      await buy(w, [milk.id], 3, 3);

      await expect(ask(w, milk.id, 2, 1)).rejects.toMatchObject({
        code: 'stale_quantity',
      });
      expect(await appliedOf(milk.id)).toEqual([{ quantity: 3, applied: 3 }]);
    });

    it('takes an ask above the line ceiling while the line stays under it, and refuses one past it', async () => {
      // The ask is the line plus what the buys met, so it can pass the ceiling
      // of a line (plan 0262) by what was bought; the line itself cannot.
      const w = await world();
      const milk = await line(w, LINE_QUANTITY_MAX);
      await buy(w, [milk.id], 1, LINE_QUANTITY_MAX);

      await ask(w, milk.id, LINE_QUANTITY_MAX + 1, LINE_QUANTITY_MAX - 1);
      expect(await quantityOf(milk.id)).toBe(LINE_QUANTITY_MAX);
      expect(await numbersOf(w, milk.id)).toEqual({
        asked: LINE_QUANTITY_MAX + 1,
        left: LINE_QUANTITY_MAX,
        bought: 1,
      });

      await expect(
        ask(w, milk.id, LINE_QUANTITY_MAX + 2, LINE_QUANTITY_MAX)
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(await quantityOf(milk.id)).toBe(LINE_QUANTITY_MAX);
    });

    // --- a raise from the list page after a buy above the ask -----------------

    it('reads a raise after a buy above the ask the same in the basket read and the trips read, open and finished', async () => {
      // The owner's ruling (2026-11-22): a raise of the line from the list page
      // takes nothing back from the units bought above the ask. Asks 3, the
      // basket buys 4 (3 met it, the line goes to 0), the household raises the
      // line to 2: asked 5, left 2, bought 4, in every read.
      const w = await world();
      const milk = await line(w, 3);
      await buy(w, [milk.id], 4, 3);
      await lines.addQuantity({
        userId: w.userId,
        lineId: milk.id,
        delta: 2,
        unit: 'UNIT',
        expect: 0,
      });
      expect(await quantityOf(milk.id)).toBe(2);

      const expectEveryRead = async () => {
        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 5,
          left: 2,
          bought: 4,
        });
        expect((await rowOf(w, milk.id)).state).toBe('PARTLY');
        const trip = toTripRowView(TripKind.BASKET, await tripOf(w, milk.id));
        expect(trip).toMatchObject({
          asked: 5,
          left: 2,
          bought: 4,
          outcome: TripRowOutcome.PARTLY,
        });
        // Not counted as a bought line: two are still owed.
        expect(await tripSummaryOf(w)).toMatchObject({
          lineCount: 1,
          boughtLineCount: 0,
        });
      };

      await expectEveryRead();

      // What the finish does: the status, then the freeze in one transaction.
      await dataSource.transaction(async (manager) => {
        await manager
          .getRepository(Basket)
          .update(w.basket.id, { status: BasketStatus.FINISHED });
        await manager.query(BASKET_TRIP_ROWS_FREEZE_SQL, [w.basket.id]);
      });
      const frozen = await dataSource
        .getRepository(BasketTripRow)
        .findOneByOrFail({ basketId: w.basket.id, lineId: milk.id });
      expect(frozen.asked).toBe(5);

      await expectEveryRead();
    });

    // --- 5. the freeze ----------------------------------------------------------

    it('freezes the original ask of a line bought above it (spec 5)', async () => {
      const w = await world();
      // Two products, so two rows: the fixture names every line "Milk".
      const milk = await line(w, 3, [randomUUID()]);
      const bread = await line(w, 2, [randomUUID()]);
      await buy(w, [milk.id], 4, 3);
      await buy(w, [bread.id], 1, 2);

      // What the finish does: the status, then the freeze in one transaction.
      await dataSource.transaction(async (manager) => {
        await manager
          .getRepository(Basket)
          .update(w.basket.id, { status: BasketStatus.FINISHED });
        await manager.query(BASKET_TRIP_ROWS_FREEZE_SQL, [w.basket.id]);
      });

      const frozen = await dataSource
        .getRepository(BasketTripRow)
        .find({ where: { basketId: w.basket.id } });
      const askedOf = (lineId: string) =>
        frozen.find((row) => row.lineId === lineId)?.asked;
      expect(askedOf(milk.id)).toBe(3);
      expect(askedOf(bread.id)).toBe(2);

      // The finished basket reads its frozen rows with the same arithmetic.
      expect(await numbersOf(w, milk.id)).toEqual({
        asked: 3,
        left: 0,
        bought: 4,
      });
      expect(await numbersOf(w, bread.id)).toEqual({
        asked: 2,
        left: 1,
        bought: 1,
      });
      await expectTripAgrees(w, milk.id);
    });

    // --- the remainder of a partial revert keeps its unit ----------------------

    it('keeps the unit of a weighed buy on the half a revert leaves standing', async () => {
      const w = await world();
      const ham = await line(w, 500);
      await dataSource.getRepository(ListLine).update(ham.id, { unit: 'GRAM' });
      await settleService.settle({
        basketId: w.basket.id,
        participantId: w.participantId,
        rowKey: ham.id,
        lineIds: [ham.id],
        outcome: SettlementOutcome.BOUGHT,
        unit: 'GRAM',
        quantity: 300,
        from: 500,
      });
      // An estimate, which the column's default is not: the half that stands
      // must carry the purchase's own value, not fall back to the default.
      await dataSource
        .getRepository(LineSettlement)
        .update({ lineId: ham.id }, { estimated: true });

      await revertService.revert({
        basketId: w.basket.id,
        participantId: w.participantId,
        rowKey: ham.id,
        lineIds: [ham.id],
        target: 'UNITS',
        units: 100,
        from: 300,
      });

      const standing = await dataSource
        .getRepository(LineSettlement)
        .find({ where: { lineId: ham.id, revertedAt: IsNull() } });
      expect(standing).toHaveLength(1);
      expect(standing[0]).toMatchObject({
        quantity: 200,
        applied: 200,
        unit: 'GRAM',
        estimated: true,
      });
      expect(await numbersOf(w, ham.id)).toEqual({
        asked: 500,
        left: 300,
        bought: 200,
      });
    });

    // --- every insert names it ---------------------------------------------------

    it('refuses a settlement that does not say how much of it met the ask', async () => {
      const w = await world();
      const milk = await line(w, 1);

      await expect(
        dataSource.query(
          `INSERT INTO "line_settlements"
           ("lineId", "listId", "outcome", "quantity", "settledByParticipantId",
            "settledAt", "basketId")
         VALUES ($1, $2, 'BOUGHT', 1, $3, now(), $4)`,
          [milk.id, w.listId, w.participantId, w.basket.id]
        )
      ).rejects.toThrow(/applied/);
      await expect(
        dataSource.query(
          `INSERT INTO "line_settlements"
           ("lineId", "listId", "outcome", "quantity", "applied",
            "settledByParticipantId", "settledAt", "basketId")
         VALUES ($1, $2, 'BOUGHT', 1, 2, $3, now(), $4)`,
          [milk.id, w.listId, w.participantId, w.basket.id]
        )
      ).rejects.toThrow(/ck_line_settlements_applied/);
    });
  }
);
