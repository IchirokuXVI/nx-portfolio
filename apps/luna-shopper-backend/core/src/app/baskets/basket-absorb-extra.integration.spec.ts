import {
  BasketKind,
  BasketStatus,
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
  type AbsorbedExtra,
  type BasketRowView,
  type LineUnit,
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
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeBasketAnnouncer } from './basket-announcer.fake';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCountExtraService } from './basket-count-extra.service';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketDemandService } from './basket-demand.service';
import { BasketLineAddService } from './basket-line-add.service';
import { BasketReadService } from './basket-read.service';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketWriteContext } from './basket-write.context';
import { BasketMarksReader } from './changes/basket-marks.reader';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A raise takes the extra into the ask, and only an answer lowers it (plan
 * 0276, section 1, specs 3 to 14).
 *
 * Against Postgres, because the absorption is a read of standing buys under
 * the line's lock and every number here is a sum the basket read computes.
 * Each test builds a zone of its own with one list and one `GENERATED` basket
 * that names it (A, Marta's), and a second or a third when the case says so.
 * The case numbers are the plan's table.
 */
describeIntegration(
  'a raise takes the extra into the ask, and only an answer lowers it (real Postgres)',
  () => {
    let dataSource: DataSource;
    let read: BasketReadService;
    let settleService: BasketSettleService;
    let revertService: BasketRevertService;
    let demandService: BasketDemandService;
    let countService: BasketCountExtraService;
    let addService: BasketLineAddService;
    let lines: LineService;
    let listAccess: ListAccessService;

    const announcer = fakeBasketAnnouncer();
    /** Every `events.emit` of the line service, event name first. */
    const emitted: unknown[][] = [];
    const zoneIds: string[] = [];
    let position = 0;

    const claims = {
      claimsOf: async () => new Map(),
      claimOf: async () => ({ claimed: false, claimedByUserId: null }),
      announceReleased: async () => undefined,
    } as never;
    const events = {
      emit: (...args: unknown[]) => {
        emitted.push(args);
      },
      emitTo: () => undefined,
    } as never;

    /** A line service over a data source of its own, for the pool spec. */
    const lineServiceOver = (source: DataSource, access: ListAccessService) =>
      new LineService(
        source,
        source.getRepository(ListLine),
        source.getRepository(ListLineItem),
        source.getRepository(ListLineGroupRemoval),
        source.getRepository(LineSettlement),
        access,
        fakeLineClaims().service,
        events,
        new CoreAuditService(source),
        new LineMergeService(new LineChangeRecorder()),
        new LineChangeRecorder(),
        announcer
      );

    const accessOver = (source: DataSource) =>
      new ListAccessService(
        source.getRepository(ShoppingList),
        source.getRepository(ListAccess),
        source.getRepository(ListLine),
        new ZoneAuthzService(source.getRepository(ZoneMembership))
      );

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
      listAccess = accessOver(dataSource);
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
      lines = lineServiceOver(dataSource, listAccess);
      demandService = new BasketDemandService(
        context,
        lines,
        listAccess,
        events,
        dataSource
      );
      countService = new BasketCountExtraService(context, demandService, lines);
      addService = new BasketLineAddService(
        context,
        lines,
        {} as never,
        events,
        {} as never
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

    interface Shopper {
      userId: string;
      basket: Basket;
      participantId: string;
    }

    interface World extends Shopper {
      zoneId: string;
      listId: string;
    }

    async function member(
      zoneId: string,
      userId: string,
      role: ZoneRole
    ): Promise<ZoneMembership> {
      const memberships = dataSource.getRepository(ZoneMembership);
      return memberships.save(
        memberships.create({
          zoneId,
          userId,
          username: 'Ana',
          role,
          status: MembershipStatus.APPROVED,
        })
      );
    }

    async function participant(
      basket: Basket,
      kind: ParticipantKind,
      userId: string | null
    ): Promise<string> {
      const participants = dataSource.getRepository(BasketParticipant);
      const guest = kind === ParticipantKind.GUEST;
      const saved = await participants.save(
        participants.create({
          basketId: basket.id,
          shareLinkId: null,
          kind,
          userId,
          displayName: guest ? 'Marta' : null,
          username: guest ? null : 'Shopper',
          guestNumber: guest ? 1 : null,
          sessionSecretHash: guest ? randomUUID() : null,
          userAgent: null,
          joinedAt: new Date(Date.now() - 60 * 60 * 1000),
          lastSeenAt: new Date(),
          revokedAt: null,
          expiresAt:
            kind === ParticipantKind.OWNER
              ? null
              : new Date(Date.now() + 12 * 60 * 60 * 1000),
        })
      );
      return saved.id;
    }

    /** A `GENERATED` basket of a member of the zone, naming the list. */
    async function shopper(
      zoneId: string,
      listId: string,
      userId = randomUUID(),
      role = ZoneRole.ADMIN
    ): Promise<Shopper> {
      if (role !== ZoneRole.OWNER) {
        await member(zoneId, userId, role);
      }
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
        sources.create({ basketId: basket.id, zoneId, listId })
      );
      const participantId = await participant(
        basket,
        ParticipantKind.OWNER,
        userId
      );
      return { userId, basket, participantId };
    }

    async function world(): Promise<World> {
      const userId = randomUUID();
      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Absorb the extra',
          joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: userId,
          config: {},
        })
      );
      zoneIds.push(zone.id);
      await member(zone.id, userId, ZoneRole.OWNER);
      const lists = dataSource.getRepository(ShoppingList);
      const list = await lists.save(
        lists.create({
          zoneId: zone.id,
          name: 'Weekly',
          createdByUserId: userId,
        })
      );
      const owner = await shopper(zone.id, list.id, userId, ZoneRole.OWNER);
      return { zoneId: zone.id, listId: list.id, ...owner };
    }

    async function line(
      w: World,
      quantity: number,
      unit: LineUnit = 'UNIT',
      content = 'Milk'
    ): Promise<ListLine> {
      const repo = dataSource.getRepository(ListLine);
      position += 1;
      return repo.save(
        repo.create({
          listId: w.listId,
          content,
          quantity,
          unit,
          position,
          createdByUserId: w.userId,
          approvalStatus: LineApprovalStatus.APPROVED,
        })
      );
    }

    const buy = (
      s: Shopper,
      lineId: string,
      quantity: number,
      from: number,
      unit: LineUnit = 'UNIT',
      participantId = s.participantId
    ) =>
      settleService.settle({
        basketId: s.basket.id,
        participantId,
        rowKey: lineId,
        lineIds: [lineId],
        outcome: SettlementOutcome.BOUGHT,
        unit,
        quantity,
        from,
      });

    /** A settlement written as the write that makes it writes it. */
    let clock = Date.now() - 30 * 60 * 1000;
    async function insertBuy(
      w: World,
      lineId: string,
      fields: Partial<LineSettlement>
    ): Promise<string> {
      clock += 1000;
      const inserted = await dataSource.getRepository(LineSettlement).insert({
        lineId,
        listId: w.listId,
        itemId: null,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
        applied: 0,
        settledByUserId: null,
        settledByParticipantId: w.participantId,
        settledAt: new Date(clock),
        basketId: w.basket.id,
        ...fields,
      });
      return inserted.identifiers[0]['id'] as string;
    }

    const raise = (
      w: { userId: string },
      lineId: string,
      delta: number,
      reportExtra?: boolean,
      unit: LineUnit = 'UNIT'
    ) =>
      lines.addQuantity({
        userId: w.userId,
        lineId,
        delta,
        unit,
        ...(reportExtra === undefined ? {} : { reportExtra }),
      });

    const count = (
      w: { userId: string },
      lineId: string,
      amount: number,
      expect: number,
      unit: LineUnit = 'UNIT'
    ) => lines.countExtra({ userId: w.userId, lineId, unit, amount, expect });

    const demand = (
      s: Shopper,
      lineId: string,
      quantity: number,
      from: number,
      reportExtra?: boolean,
      participantId = s.participantId
    ) =>
      demandService.setDemand({
        basketId: s.basket.id,
        participantId,
        rowKey: lineId,
        lineId,
        quantity,
        unit: 'UNIT',
        from,
        ...(reportExtra === undefined ? {} : { reportExtra }),
      });

    const basketCount = (
      s: Shopper,
      lineId: string,
      amount: number,
      expect: number
    ) =>
      countService.countExtra({
        basketId: s.basket.id,
        participantId: s.participantId,
        rowKey: lineId,
        lineId,
        unit: 'UNIT',
        amount,
        expect,
      });

    async function rowOf(
      s: Shopper,
      lineId: string
    ): Promise<BasketRowView | undefined> {
      const view = await read.read({
        basketId: s.basket.id,
        participantId: s.participantId,
      });
      return view.rows.find((candidate) =>
        candidate.entries.some((entry) => entry.lineId === lineId)
      );
    }

    /**
     * `asked / left / bought` and the units above the ask, as the read serves
     * them. A line that is not a row of the basket reads as zeros.
     */
    async function numbersOf(s: Shopper, lineId: string) {
      const row = await rowOf(s, lineId);
      if (!row) {
        return { asked: 0, left: 0, bought: 0, above: 0 };
      }
      return {
        asked: row.asked,
        left: row.left,
        bought: row.bought,
        above: Math.max(0, row.bought - (row.asked - row.left)),
      };
    }

    const n = (asked: number, left: number, bought: number, above = 0) => ({
      asked,
      left,
      bought,
      above,
    });

    const lineOf = (lineId: string) =>
      dataSource.getRepository(ListLine).findOneByOrFail({ id: lineId });

    const changesOf = (lineId: string) =>
      dataSource.getRepository(ListLineChange).count({ where: { lineId } });

    const appliedOf = async (lineId: string) =>
      (
        await dataSource.getRepository(LineSettlement).find({
          where: { lineId },
          order: { settledAt: 'ASC', id: 'ASC' },
        })
      ).map((row) => row.applied);

    const lineUpdates = (lineId: string) =>
      emitted.filter(
        (args) =>
          args[0] === RealtimeEvent.LineUpdated &&
          (args[2] as { id: string }).id === lineId
      );

    const extraOf = (answer: object): AbsorbedExtra | undefined =>
      (answer as { extra?: AbsorbedExtra }).extra;

    /** Where every case's call starts counting what it wrote. */
    async function mark(lineId: string) {
      announcer.reset();
      emitted.length = 0;
      return {
        line: await lineOf(lineId),
        changes: await changesOf(lineId),
        applied: await appliedOf(lineId),
      };
    }

    beforeEach(() => {
      announcer.reset();
      emitted.length = 0;
    });

    /** Case 1's before: asks 1, Marta bought 4. Line 0; A 1 / 0 / 4, 3 above. */
    async function askedOneBoughtFour() {
      const w = await world();
      const milk = await line(w, 1);
      await buy(w, milk.id, 4, 1);
      expect(await numbersOf(w, milk.id)).toEqual(n(1, 0, 4, 3));
      return { w, milk };
    }

    /** As after case 1: line 4; A 8 / 4 / 4. */
    async function afterCaseOne() {
      const { w, milk } = await askedOneBoughtFour();
      await raise(w, milk.id, 4, true);
      expect(await numbersOf(w, milk.id)).toEqual(n(8, 4, 4));
      return { w, milk };
    }

    /** Case 4's before: asks 3, bought 5. Line 0; A 3 / 0 / 5, 2 above. */
    async function askedThreeBoughtFive() {
      const w = await world();
      const milk = await line(w, 3);
      await buy(w, milk.id, 5, 3);
      expect(await numbersOf(w, milk.id)).toEqual(n(3, 0, 5, 2));
      return { w, milk };
    }

    /** Case 6's before: A (Marta) asks 3 and bought 4; B asks 0. */
    async function anotherShoppingList() {
      const w = await world();
      const milk = await line(w, 3);
      await buy(w, milk.id, 4, 3);
      const b = await shopper(w.zoneId, w.listId);
      expect(await numbersOf(w, milk.id)).toEqual(n(3, 0, 4, 1));
      expect(await numbersOf(b, milk.id)).toEqual(n(0, 0, 0));
      return { w, b, milk };
    }

    /** Case 11's before: A asks 3, bought 4 (older); B bought 2 at 0. */
    async function twoBaskets() {
      const w = await world();
      const milk = await line(w, 3);
      await buy(w, milk.id, 4, 3);
      const b = await shopper(w.zoneId, w.listId);
      await insertBuy(w, milk.id, {
        basketId: b.basket.id,
        settledByParticipantId: b.participantId,
        quantity: 2,
        applied: 0,
        settledAt: new Date(),
      });
      expect(await numbersOf(w, milk.id)).toEqual(n(3, 0, 4, 1));
      expect(await numbersOf(b, milk.id)).toEqual(n(0, 0, 2, 2));
      return { w, b, milk };
    }

    // --- spec 3: the table ---------------------------------------------------

    describe('the table of the plan (spec 3)', () => {
      it('case 1: a list page raise over the same list extra', async () => {
        const { w, milk } = await askedOneBoughtFour();
        const before = await mark(milk.id);

        const answer = await raise(w, milk.id, 4, true);

        expect(await numbersOf(w, milk.id)).toEqual(n(8, 4, 4));
        expect(answer.quantity).toBe(4);
        expect(answer.extra).toEqual({
          above: 3,
          countable: 3,
          buyers: [{ userId: w.userId }],
        });
        // Spec 5: one change row, one version, one line.updated, and the
        // covering baskets told with the numbers.
        expect(await changesOf(milk.id)).toBe(before.changes + 1);
        expect((await lineOf(milk.id)).version).toBe(before.line.version + 1);
        expect(lineUpdates(milk.id)).toHaveLength(1);
        expect(announcer.calls.linesMoved).toEqual([
          expect.objectContaining({
            listId: w.listId,
            lineIds: [milk.id],
            marksMoved: true,
          }),
        ]);
      });

      it('case 2: "Count the extra" after case 1 (spec 7)', async () => {
        const { w, milk } = await afterCaseOne();
        const before = await mark(milk.id);

        const answer = await count(w, milk.id, 3, 4);

        expect(answer.counted).toBe(3);
        expect(answer.quantity).toBe(1);
        expect(await numbersOf(w, milk.id)).toEqual(n(5, 1, 4));
        expect(await appliedOf(milk.id)).toEqual(before.applied);
        expect(await changesOf(milk.id)).toBe(before.changes + 1);
        expect((await lineOf(milk.id)).version).toBe(before.line.version + 1);
        expect(lineUpdates(milk.id)).toHaveLength(1);
        expect(announcer.calls.linesMoved).toEqual([
          expect.objectContaining({ lineIds: [milk.id], marksMoved: true }),
        ]);
      });

      it('case 3: no answer after case 1 leaves the larger ask', async () => {
        const { w, milk } = await afterCaseOne();

        expect((await lineOf(milk.id)).quantity).toBe(4);
        expect(await numbersOf(w, milk.id)).toEqual(n(8, 4, 4));
      });

      it("case 4: the owner's example, a demand in A's Lists and amounts (spec 10)", async () => {
        const { w, milk } = await askedThreeBoughtFive();

        const answer = await demand(w, milk.id, 5, 0, true);

        expect((await lineOf(milk.id)).quantity).toBe(2);
        expect(await numbersOf(w, milk.id)).toEqual(n(7, 2, 5));
        expect(answer.extra).toEqual({
          above: 2,
          countable: 2,
          buyers: [{ userId: w.userId }],
        });
        // The row in the answer carries the entry's new ask.
        expect(answer.entries).toEqual([
          expect.objectContaining({ lineId: milk.id, asked: 7, left: 2 }),
        ]);
      });

      it("case 5: the basket's count after case 4 (spec 10)", async () => {
        const { w, milk } = await askedThreeBoughtFive();
        await demand(w, milk.id, 5, 0, true);
        const before = await mark(milk.id);

        const answer = await basketCount(w, milk.id, 2, 2);

        expect(answer.counted).toBe(2);
        expect((await lineOf(milk.id)).quantity).toBe(0);
        expect(await numbersOf(w, milk.id)).toEqual(n(5, 0, 5));
        expect(await appliedOf(milk.id)).toEqual(before.applied);
        expect(answer.entries).toEqual([
          expect.objectContaining({ lineId: milk.id, asked: 5, left: 0 }),
        ]);
      });

      it("case 6: another shopping list's extra, from B", async () => {
        const { w, b, milk } = await anotherShoppingList();

        const answer = await demand(b, milk.id, 2, 0, true);

        expect((await lineOf(milk.id)).quantity).toBe(2);
        expect(await numbersOf(w, milk.id)).toEqual(n(6, 2, 4));
        expect(await numbersOf(b, milk.id)).toEqual(n(2, 2, 0));
        expect(answer.extra).toEqual({
          above: 1,
          countable: 1,
          buyers: [{ userId: w.userId }],
        });
      });

      it("case 7: B's count after case 6", async () => {
        const { w, b, milk } = await anotherShoppingList();
        await demand(b, milk.id, 2, 0, true);

        const answer = await basketCount(b, milk.id, 1, 2);

        expect(answer.counted).toBe(1);
        expect((await lineOf(milk.id)).quantity).toBe(1);
        expect(await numbersOf(w, milk.id)).toEqual(n(5, 1, 4));
        expect(await numbersOf(b, milk.id)).toEqual(n(1, 1, 0));
      });

      it('case 8: a list page raise smaller than the extra', async () => {
        const { w, milk } = await askedOneBoughtFour();

        const answer = await raise(w, milk.id, 2, true);

        expect(await numbersOf(w, milk.id)).toEqual(n(6, 2, 4));
        expect(answer.extra).toMatchObject({ above: 3, countable: 2 });
      });

      it('case 9: the count after case 8 ends at what was bought', async () => {
        const { w, milk } = await askedOneBoughtFour();
        await raise(w, milk.id, 2, true);

        const answer = await count(w, milk.id, 2, 2);

        expect(answer.counted).toBe(2);
        expect(await numbersOf(w, milk.id)).toEqual(n(4, 0, 4));
      });

      it("case 10: a raise smaller than the extra, in A's Lists and amounts", async () => {
        const { w, milk } = await askedOneBoughtFour();

        const answer = await demand(w, milk.id, 3, 0, true);

        expect((await lineOf(milk.id)).quantity).toBe(2);
        expect(await numbersOf(w, milk.id)).toEqual(n(6, 2, 4));
        expect(answer.extra).toMatchObject({ above: 3, countable: 2 });
      });

      it('case 11: two baskets, the older buy first, every ask told', async () => {
        const { w, b, milk } = await twoBaskets();
        announcer.reset();

        const answer = await raise(w, milk.id, 2, true);

        expect(await numbersOf(w, milk.id)).toEqual(n(6, 2, 4));
        expect(await numbersOf(b, milk.id)).toEqual(n(4, 2, 2));
        expect(answer.extra).toEqual({
          above: 3,
          countable: 2,
          buyers: [{ userId: w.userId }, { userId: b.userId }],
        });
        // One call, which the announcer sends to every covering basket.
        expect(announcer.calls.linesMoved).toEqual([
          expect.objectContaining({ lineIds: [milk.id], marksMoved: true }),
        ]);
      });

      it('case 12: the count after case 11', async () => {
        const { w, b, milk } = await twoBaskets();
        await raise(w, milk.id, 2, true);

        const answer = await count(w, milk.id, 2, 2);

        expect(answer.counted).toBe(2);
        expect(await numbersOf(w, milk.id)).toEqual(n(4, 0, 4));
        expect(await numbersOf(b, milk.id)).toEqual(n(2, 0, 2));
      });

      it('case 13: a stale count writes nothing (spec 6)', async () => {
        const { w, milk } = await afterCaseOne();
        await raise(w, milk.id, -2);
        const before = await mark(milk.id);

        await expect(count(w, milk.id, 3, 4)).rejects.toMatchObject({
          code: 'stale_quantity',
          messageArgs: { current: 2 },
        });

        expect(await changesOf(milk.id)).toBe(before.changes);
        expect((await lineOf(milk.id)).version).toBe(before.line.version);
        expect((await lineOf(milk.id)).quantity).toBe(2);
        expect(emitted).toEqual([]);
        expect(announcer.calls.linesMoved).toEqual([]);
      });

      it('case 14: the extra taken back after the raise refuses the count (spec 12)', async () => {
        const { w, milk } = await afterCaseOne();
        await revertService.revert({
          basketId: w.basket.id,
          participantId: w.participantId,
          rowKey: milk.id,
          lineIds: [milk.id],
          target: 'UNITS',
          units: 3,
          from: 4,
        });
        expect((await lineOf(milk.id)).quantity).toBe(7);
        expect(await numbersOf(w, milk.id)).toEqual(n(8, 7, 1));
        const before = await mark(milk.id);

        await expect(count(w, milk.id, 3, 4)).rejects.toMatchObject({
          code: 'stale_quantity',
          messageArgs: { current: 7 },
        });

        expect(await changesOf(milk.id)).toBe(before.changes);
        expect((await lineOf(milk.id)).version).toBe(before.line.version);
        expect(emitted).toEqual([]);
      });

      it('case 15: a buy that lands before the answer refuses the count (spec 12)', async () => {
        const { w, milk } = await afterCaseOne();
        const luis = randomUUID();
        await member(w.zoneId, luis, ZoneRole.MEMBER);
        const registered = await participant(
          w.basket,
          ParticipantKind.REGISTERED,
          luis
        );
        await buy(w, milk.id, 1, 4, 'UNIT', registered);
        expect(await numbersOf(w, milk.id)).toEqual(n(8, 3, 5));
        const before = await mark(milk.id);

        await expect(count(w, milk.id, 3, 4)).rejects.toMatchObject({
          code: 'stale_quantity',
          messageArgs: { current: 3 },
        });

        expect(await changesOf(milk.id)).toBe(before.changes);
        expect((await lineOf(milk.id)).version).toBe(before.line.version);
        expect(emitted).toEqual([]);
      });

      it('case 16 and 17: a weight, then its count', async () => {
        const w = await world();
        const ham = await line(w, 1000, 'GRAM');
        await buy(w, ham.id, 1500, 1000, 'GRAM');
        expect(await numbersOf(w, ham.id)).toEqual(n(1000, 0, 1500, 500));

        const answer = await raise(w, ham.id, 1500, true, 'GRAM');

        expect(await numbersOf(w, ham.id)).toEqual(n(3000, 1500, 1500));
        expect(answer.extra).toMatchObject({ above: 500, countable: 500 });

        const counted = await count(w, ham.id, 500, 1500, 'GRAM');

        expect(counted.counted).toBe(500);
        expect(await numbersOf(w, ham.id)).toEqual(n(2500, 1000, 1500));
      });

      it('case 18: no extra', async () => {
        const w = await world();
        const milk = await line(w, 3);
        await buy(w, milk.id, 2, 3);
        expect(await numbersOf(w, milk.id)).toEqual(n(3, 1, 2));

        const answer = await raise(w, milk.id, 2, true);

        expect(await numbersOf(w, milk.id)).toEqual(n(5, 3, 2));
        expect(answer.extra).toEqual({ above: 0, countable: 0, buyers: [] });
      });

      it('case 19: a raise after case 3 asks nothing', async () => {
        const { w, milk } = await afterCaseOne();

        const answer = await raise(w, milk.id, 1, true);

        expect(await numbersOf(w, milk.id)).toEqual(n(9, 5, 4));
        expect(answer.extra).toEqual({ above: 0, countable: 0, buyers: [] });
      });

      it('case 20: more bought after case 3 brings the question back', async () => {
        const { w, milk } = await afterCaseOne();
        await buy(w, milk.id, 6, 4);
        expect(await numbersOf(w, milk.id)).toEqual(n(8, 0, 10, 2));

        const answer = await raise(w, milk.id, 1, true);

        expect(await numbersOf(w, milk.id)).toEqual(n(11, 1, 10));
        expect(answer.extra).toMatchObject({ above: 2, countable: 1 });
      });

      it('case 21: a lowering with the flag absorbs nothing and reports nothing', async () => {
        const { w, milk } = await afterCaseOne();
        const before = await appliedOf(milk.id);

        const answer = await raise(w, milk.id, -1, true);

        expect(answer.quantity).toBe(3);
        expect('extra' in answer).toBe(false);
        expect(await appliedOf(milk.id)).toEqual(before);
      });

      it('case 22: no flag absorbs as case 1 and reports nothing', async () => {
        const { w, milk } = await askedOneBoughtFour();

        const answer = await raise(w, milk.id, 4);

        expect(await numbersOf(w, milk.id)).toEqual(n(8, 4, 4));
        expect('extra' in answer).toBe(false);
      });

      it('case 23: the line edit as case 1', async () => {
        const { w, milk } = await askedOneBoughtFour();
        const before = await mark(milk.id);

        const answer = await lines.update({
          userId: w.userId,
          lineId: milk.id,
          quantity: 4,
          reportExtra: true,
        });

        expect(await numbersOf(w, milk.id)).toEqual(n(8, 4, 4));
        expect(answer.extra).toEqual({
          above: 3,
          countable: 3,
          buyers: [{ userId: w.userId }],
        });
        expect(await changesOf(milk.id)).toBe(before.changes + 1);
        expect(lineUpdates(milk.id)).toHaveLength(1);
        expect(announcer.calls.linesMoved).toEqual([
          expect.objectContaining({ lineIds: [milk.id] }),
        ]);
      });

      it("case 24: the list's add meets the line at 0", async () => {
        const { w, milk } = await askedOneBoughtFour();

        const answer = await lines.add({
          userId: w.userId,
          listId: w.listId,
          content: 'Milk',
          quantity: 2,
          reportExtra: true,
        });

        expect(answer.outcome).toBe('RAISED');
        expect(answer.line.quantity).toBe(2);
        expect(await numbersOf(w, milk.id)).toEqual(n(6, 2, 4));
        expect(answer.extra).toMatchObject({ above: 3, countable: 2 });
      });

      it('case 25: a batch add and the operator edit absorb and report nothing', async () => {
        const batched = await askedOneBoughtFour();
        const [result] = await lines.addMany({
          userId: batched.w.userId,
          listId: batched.w.listId,
          items: [{ content: 'Milk', quantity: 2 }],
        });
        expect(result.outcome).toBe('RAISED');
        expect('extra' in result).toBe(false);
        expect(await numbersOf(batched.w, batched.milk.id)).toEqual(n(6, 2, 4));

        const operated = await askedOneBoughtFour();
        const answer = await lines.updateAsOperator(
          operated.w.listId,
          operated.milk.id,
          { quantity: 2 },
          randomUUID()
        );
        expect('extra' in answer).toBe(false);
        expect(await numbersOf(operated.w, operated.milk.id)).toEqual(
          n(6, 2, 4)
        );
      });

      it('case 26: the extra of a finished basket stays where it is (spec 8)', async () => {
        const w = await world();
        const milk = await line(w, 0);
        const c = await shopper(w.zoneId, w.listId);
        await insertBuy(w, milk.id, {
          basketId: c.basket.id,
          settledByParticipantId: c.participantId,
          quantity: 2,
          applied: 0,
        });
        await dataSource
          .getRepository(Basket)
          .update(c.basket.id, { status: BasketStatus.FINISHED });
        const before = await appliedOf(milk.id);

        const answer = await raise(w, milk.id, 2, true);

        expect(answer.quantity).toBe(2);
        expect(answer.extra).toEqual({ above: 0, countable: 0, buyers: [] });
        expect(await appliedOf(milk.id)).toEqual(before);
      });

      it('case 27: a guest raises the demand of a single entry row, as case 6', async () => {
        const { w, b, milk } = await anotherShoppingList();
        const guest = await participant(b.basket, ParticipantKind.GUEST, null);

        const answer = await demand(b, milk.id, 2, 0, true, guest);

        expect((await lineOf(milk.id)).quantity).toBe(2);
        expect(await numbersOf(w, milk.id)).toEqual(n(6, 2, 4));
        expect(answer.extra).toEqual({
          above: 1,
          countable: 1,
          buyers: [{ userId: w.userId }],
        });
        expect(JSON.stringify(answer.extra)).not.toContain(guest);
      });
    });

    // --- spec 4: every raise path absorbs, nothing else does --------------------

    describe('every raise path absorbs, with and without the flag (spec 4)', () => {
      it('the demand without the flag absorbs and reports nothing', async () => {
        const { w, milk } = await askedThreeBoughtFive();

        const answer = await demand(w, milk.id, 5, 0);

        expect(await numbersOf(w, milk.id)).toEqual(n(7, 2, 5));
        expect('extra' in answer).toBe(false);
      });

      it('the edit without the flag absorbs and reports nothing', async () => {
        const { w, milk } = await askedOneBoughtFour();

        const answer = await lines.update({
          userId: w.userId,
          lineId: milk.id,
          quantity: 4,
        });

        expect(await numbersOf(w, milk.id)).toEqual(n(8, 4, 4));
        expect('extra' in answer).toBe(false);
      });

      it("the basket's add on RAISED absorbs, and reports with the flag", async () => {
        const { w, milk } = await askedOneBoughtFour();

        const answer = await addService.add({
          basketId: w.basket.id,
          participantId: w.participantId,
          userId: w.userId,
          targetListId: w.listId,
          content: 'Milk',
          quantity: 2,
          reportExtra: true,
        });

        expect(answer.addOutcome).toBe('RAISED');
        expect(await numbersOf(w, milk.id)).toEqual(n(6, 2, 4));
        expect(answer.extra).toMatchObject({ above: 3, countable: 2 });
        expect(answer.entries).toEqual([
          expect.objectContaining({ lineId: milk.id, asked: 6 }),
        ]);
      });

      it('a rename that raises without merging absorbs and reports', async () => {
        const { w, milk } = await askedOneBoughtFour();

        const answer = await lines.update({
          userId: w.userId,
          lineId: milk.id,
          content: 'Whole milk',
          quantity: 4,
          reportExtra: true,
        });

        expect(answer.extra).toMatchObject({ above: 3, countable: 3 });
        expect(await numbersOf(w, milk.id)).toEqual(n(8, 4, 4));
      });

      it('a lowering at left 0 that moves only the split reports nothing', async () => {
        const { w, milk } = await askedThreeBoughtFive();

        const answer = await demand(w, milk.id, 1, 0, true);

        expect((await lineOf(milk.id)).quantity).toBe(0);
        expect(await numbersOf(w, milk.id)).toEqual(n(1, 0, 5, 4));
        expect('extra' in answer).toBe(false);
      });

      it('ALREADY_ON_LIST, a rename alone, a unit change and a merge absorb nothing', async () => {
        const w = await world();
        const milk = await line(w, 1);
        await buy(w, milk.id, 4, 1);
        // Another line, wanted, which the add meets and leaves alone.
        const bread = await line(w, 2, 'UNIT', 'Bread');
        const before = await appliedOf(milk.id);

        const met = await lines.add({
          userId: w.userId,
          listId: w.listId,
          content: 'Bread',
          reportExtra: true,
        });
        expect(met.outcome).toBe('ALREADY_ON_LIST');
        expect('extra' in met).toBe(false);

        const renamed = await lines.update({
          userId: w.userId,
          lineId: milk.id,
          content: 'Fresh milk',
          reportExtra: true,
        });
        expect('extra' in renamed).toBe(false);

        // A unit change names a quantity in another unit, which is no raise.
        const unit = await lines.update({
          userId: w.userId,
          lineId: milk.id,
          unit: 'GRAM',
          quantity: 500,
          reportExtra: true,
        });
        expect('extra' in unit).toBe(false);
        await lines.update({
          userId: w.userId,
          lineId: milk.id,
          unit: 'UNIT',
          quantity: 0,
        });

        // The bread renamed onto the milk merges the two: not an amount the
        // person set.
        const merged = await lines.update({
          userId: w.userId,
          lineId: bread.id,
          content: 'Fresh milk',
          quantity: 3,
          confirmMerge: true,
          reportExtra: true,
        });
        expect(merged.absorbedLineId).toBeDefined();
        expect('extra' in merged).toBe(false);

        expect(await appliedOf(milk.id)).toEqual(before);
      });
    });

    // --- spec 8: buys that are never taken in -------------------------------------

    it('never takes in a LIVE basket outside its session, a list page buy, a reverted buy or a buy in another unit (spec 8)', async () => {
      const w = await world();
      const milk = await line(w, 3);
      // A buy made on the list page: no basket.
      await insertBuy(w, milk.id, {
        basketId: null,
        settledByParticipantId: null,
        settledByUserId: w.userId,
      });
      // A buy taken back.
      await insertBuy(w, milk.id, {
        revertedAt: new Date(),
        revertedByParticipantId: w.participantId,
      });
      // A buy in another unit than the line's.
      await insertBuy(w, milk.id, { unit: 'GRAM', quantity: 500 });
      // A LIVE basket of another member, whose buy is a month old.
      const live = randomUUID();
      await member(w.zoneId, live, ZoneRole.ADMIN);
      const liveBasket = await dataSource.getRepository(Basket).save(
        dataSource.getRepository(Basket).create({
          ownerUserId: live,
          kind: BasketKind.LIVE,
          name: null,
          status: BasketStatus.OPEN,
          generatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          idempotencyKey: null,
        })
      );
      const liveOwner = await participant(
        liveBasket,
        ParticipantKind.OWNER,
        live
      );
      await insertBuy(w, milk.id, {
        basketId: liveBasket.id,
        settledByParticipantId: liveOwner,
        settledAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      });
      const before = await appliedOf(milk.id);

      const answer = await raise(w, milk.id, 2, true);

      expect(answer.extra).toEqual({ above: 0, countable: 0, buyers: [] });
      expect(answer.quantity).toBe(5);
      expect(await appliedOf(milk.id)).toEqual(before);
    });

    // --- spec 9: who is named -----------------------------------------------------

    describe('who bought the extra (spec 9)', () => {
      it("names the basket's owner for a guest's buy, and no participant", async () => {
        const w = await world();
        const milk = await line(w, 3);
        const guest = await participant(w.basket, ParticipantKind.GUEST, null);
        await buy(w, milk.id, 4, 3, 'UNIT', guest);

        const answer = await raise(w, milk.id, 1, true);

        expect(answer.extra?.buyers).toEqual([{ userId: w.userId }]);
        const wire = JSON.stringify(answer.extra);
        expect(wire).not.toContain(guest);
        expect(wire).not.toContain(w.participantId);
        expect(wire).not.toContain('Marta');
        expect(wire).not.toContain(w.basket.id);
      });

      it("answers one buyer for a guest and the basket's owner on one basket", async () => {
        const w = await world();
        const milk = await line(w, 3);
        const guest = await participant(w.basket, ParticipantKind.GUEST, null);
        await buy(w, milk.id, 4, 3, 'UNIT', guest);
        await insertBuy(w, milk.id, { settledAt: new Date() });

        const answer = await raise(w, milk.id, 1, true);

        expect(answer.extra).toEqual({
          above: 3,
          countable: 1,
          buyers: [{ userId: w.userId }],
        });
      });

      it('answers two people in the order of their oldest buy', async () => {
        const w = await world();
        const milk = await line(w, 3);
        const luis = randomUUID();
        await member(w.zoneId, luis, ZoneRole.MEMBER);
        const registered = await participant(
          w.basket,
          ParticipantKind.REGISTERED,
          luis
        );
        await buy(w, milk.id, 4, 3, 'UNIT', registered);
        await insertBuy(w, milk.id, { settledAt: new Date() });

        const answer = await raise(w, milk.id, 1, true);

        expect(answer.extra?.buyers).toEqual([
          { userId: luis },
          { userId: w.userId },
        ]);
        expect(JSON.stringify(answer.extra)).not.toContain(registered);
      });

      it('answers null for someone who is not a member, or is gone, as one entry', async () => {
        const w = await world();
        const milk = await line(w, 0);
        const stranger = await participant(
          w.basket,
          ParticipantKind.REGISTERED,
          randomUUID()
        );
        await insertBuy(w, milk.id, { settledByParticipantId: stranger });
        await insertBuy(w, milk.id, { settledByParticipantId: randomUUID() });
        await insertBuy(w, milk.id, {});

        const answer = await raise(w, milk.id, 1, true);

        expect(answer.extra).toEqual({
          above: 6,
          countable: 1,
          buyers: [{ userId: null }, { userId: w.userId }],
        });
      });
    });

    // --- spec 11: who may count -----------------------------------------------------

    describe('who may count (spec 11)', () => {
      it('refuses a reader who may not lower an approved line, and moves nothing', async () => {
        const { w, milk } = await afterCaseOne();
        const writer = randomUUID();
        const membership = await member(w.zoneId, writer, ZoneRole.MEMBER);
        await dataSource.getRepository(ListAccess).save({
          listId: w.listId,
          membershipId: membership.id,
          permissions: [ListPermission.READ, ListPermission.WRITE],
        });
        const before = await mark(milk.id);

        await expect(
          count({ userId: writer }, milk.id, 3, 4)
        ).rejects.toMatchObject({ code: 'forbidden' });

        expect((await lineOf(milk.id)).quantity).toBe(4);
        expect(await changesOf(milk.id)).toBe(before.changes);
        expect(await appliedOf(milk.id)).toEqual(before.applied);
      });

      it('refuses the basket count when the owner may not change the demand', async () => {
        const w = await world();
        const milk = await line(w, 1);
        // A basket of a plain writer, who may not move an approved line.
        const writer = await shopper(
          w.zoneId,
          w.listId,
          randomUUID(),
          ZoneRole.MEMBER
        );
        const membership = await dataSource
          .getRepository(ZoneMembership)
          .findOneByOrFail({ zoneId: w.zoneId, userId: writer.userId });
        await dataSource.getRepository(ListAccess).save({
          listId: w.listId,
          membershipId: membership.id,
          permissions: [ListPermission.READ, ListPermission.WRITE],
        });
        await raise(w, milk.id, 3);
        const before = await mark(milk.id);

        await expect(basketCount(writer, milk.id, 1, 4)).rejects.toMatchObject({
          code: 'forbidden',
        });

        expect((await lineOf(milk.id)).quantity).toBe(4);
        expect(await changesOf(milk.id)).toBe(before.changes);
      });

      it('refuses a count in another unit and one on a finished basket', async () => {
        const { w, milk } = await afterCaseOne();

        await expect(count(w, milk.id, 3, 4, 'GRAM')).rejects.toMatchObject({
          code: 'line_unit_mismatch',
        });
        await expect(count(w, milk.id, 5, 4)).rejects.toMatchObject({
          code: 'validation_failed',
        });

        await dataSource
          .getRepository(Basket)
          .update(w.basket.id, { status: BasketStatus.FINISHED });
        await expect(basketCount(w, milk.id, 3, 4)).rejects.toMatchObject({
          code: 'basket_finished',
        });
        expect((await lineOf(milk.id)).quantity).toBe(4);
      });
    });

    // --- the lock ---------------------------------------------------------------------

    it('takes in the buys as they stand at the lock, with a settle that landed in between', async () => {
      const w = await world();
      const milk = await line(w, 3);

      // A settle holding the line's lock while the raise arrives.
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.manager.getRepository(ListLine).findOne({
          where: { id: milk.id },
          lock: { mode: 'pessimistic_write' },
        });
        const pending = raise(w, milk.id, 2, true);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await runner.manager.getRepository(LineSettlement).insert({
          lineId: milk.id,
          listId: w.listId,
          itemId: null,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 4,
          applied: 3,
          settledByUserId: null,
          settledByParticipantId: w.participantId,
          settledAt: new Date(),
          basketId: w.basket.id,
        });
        await runner.manager
          .getRepository(ListLine)
          .update({ id: milk.id }, { quantity: 0 });
        await runner.commitTransaction();

        const answer = await pending;

        expect(answer.extra).toMatchObject({ above: 1, countable: 1 });
        expect(answer.quantity).toBe(2);
        expect(await numbersOf(w, milk.id)).toEqual(n(6, 2, 4));
      } finally {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
        }
        await runner.release();
      }
    });

    it('takes nothing in from a basket that finished while the raise waited for the lock', async () => {
      const { w, milk } = await askedOneBoughtFour();
      const before = await appliedOf(milk.id);

      const runner = dataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.manager.getRepository(ListLine).findOne({
          where: { id: milk.id },
          lock: { mode: 'pessimistic_write' },
        });
        const pending = raise(w, milk.id, 2, true);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await runner.manager
          .getRepository(Basket)
          .update(w.basket.id, { status: BasketStatus.FINISHED });
        await runner.commitTransaction();

        const answer = await pending;

        expect(answer.extra).toEqual({ above: 0, countable: 0, buyers: [] });
        expect(answer.quantity).toBe(2);
        expect(await appliedOf(milk.id)).toEqual(before);
      } finally {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
        }
        await runner.release();
      }
    });

    // --- spec 13: one pool connection ---------------------------------------------------

    it('reads the counting baskets of an add and a batch through the transaction, on a pool of one (spec 13)', async () => {
      const single = new DataSource({
        type: 'postgres',
        url: requiredEnv('CORE_DB_URL'),
        entities: CORE_ENTITIES,
        synchronize: false,
        extra: { max: 1 },
      });
      await single.initialize();
      try {
        // Access is read before the transaction, so it may use the pool.
        const service = lineServiceOver(single, accessOver(single));
        const added = await askedOneBoughtFour();
        const timeout = (ms: number) =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('the pool deadlocked')), ms)
          );

        const answer = (await Promise.race([
          service.add({
            userId: added.w.userId,
            listId: added.w.listId,
            content: 'Milk',
            quantity: 2,
            reportExtra: true,
          }),
          timeout(10_000),
        ])) as Awaited<ReturnType<LineService['add']>>;
        expect(answer.outcome).toBe('RAISED');
        expect(extraOf(answer)).toMatchObject({ above: 3, countable: 2 });

        const batched = await askedOneBoughtFour();
        const [result] = (await Promise.race([
          service.addMany({
            userId: batched.w.userId,
            listId: batched.w.listId,
            items: [{ content: 'Milk', quantity: 2 }],
          }),
          timeout(10_000),
        ])) as Awaited<ReturnType<LineService['addMany']>>;
        expect(result.outcome).toBe('RAISED');
        expect(await numbersOf(batched.w, batched.milk.id)).toEqual(n(6, 2, 4));
      } finally {
        await single.destroy();
      }
    });
  }
);
