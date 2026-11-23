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
  type AddLineQuantityResult,
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
import { BasketCoverageService } from './basket-coverage.service';
import { BasketPatchReader } from './basket-patch.reader';
import { BasketReadService } from './basket-read.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketWriteContext } from './basket-write.context';
import { BasketMarksReader } from './changes/basket-marks.reader';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A raise from the zone list counts what was bought above the ask (plan 0275,
 * section 1, specs 2 to 9).
 *
 * Against Postgres, because the count is a read of standing buys under the
 * line's lock and every number here is a sum the basket read computes. Each
 * test builds a zone of its own with one list and one `GENERATED` basket that
 * names it, and a second basket when the case says two.
 */
describeIntegration(
  'a raise from the zone list counts what was bought above the ask (real Postgres)',
  () => {
    let dataSource: DataSource;
    let read: BasketReadService;
    let settleService: BasketSettleService;
    let lines: LineService;

    const announcer = fakeBasketAnnouncer();
    /** Every `events.emit` of the line service, event name first. */
    const emitted: unknown[][] = [];
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
        emit: (...args: unknown[]) => {
          emitted.push(args);
        },
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
          name: 'Count the extra',
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
      unit: LineUnit = 'UNIT'
    ): Promise<ListLine> {
      const repo = dataSource.getRepository(ListLine);
      position += 1;
      return repo.save(
        repo.create({
          listId: w.listId,
          content: 'Milk',
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
      countExtra?: boolean,
      unit: LineUnit = 'UNIT'
    ): Promise<AddLineQuantityResult> =>
      lines.addQuantity({
        userId: w.userId,
        lineId,
        delta,
        unit,
        ...(countExtra === undefined ? {} : { countExtra }),
      });

    async function rowOf(s: Shopper, lineId: string): Promise<BasketRowView> {
      const view = await read.read({
        basketId: s.basket.id,
        participantId: s.participantId,
      });
      const row = view.rows.find((candidate) =>
        candidate.entries.some((entry) => entry.lineId === lineId)
      );
      if (!row) {
        throw new Error(`no row holds ${lineId}`);
      }
      return row;
    }

    /** `asked / left / bought` and the units above the ask, as the read serves them. */
    async function numbersOf(s: Shopper, lineId: string) {
      const row = await rowOf(s, lineId);
      return {
        asked: row.asked,
        left: row.left,
        bought: row.bought,
        above: Math.max(0, row.bought - (row.asked - row.left)),
      };
    }

    const patchesOf = (s: Shopper, w: World, lineIds: string[]) =>
      new BasketPatchReader(
        dataSource.getRepository(Basket),
        fakeCoreConfig()
      ).entriesOf(
        { basketId: s.basket.id, kind: s.basket.kind },
        [w.listId],
        lineIds
      );

    const lineOf = (lineId: string) =>
      dataSource.getRepository(ListLine).findOneByOrFail({ id: lineId });

    const changesOf = (lineId: string) =>
      dataSource.getRepository(ListLineChange).count({ where: { lineId } });

    const appliedOf = async (lineId: string) =>
      (
        await dataSource.getRepository(LineSettlement).find({
          where: { lineId, revertedAt: IsNull() },
          order: { settledAt: 'ASC', id: 'ASC' },
        })
      ).map((row) => row.applied);

    const lineUpdates = (lineId: string) =>
      emitted.filter(
        (args) =>
          args[0] === RealtimeEvent.LineUpdated &&
          (args[2] as { id: string }).id === lineId
      );

    beforeEach(() => {
      announcer.reset();
      emitted.length = 0;
    });

    /** One basket asking 3 that bought 4: 3 / 0 / 4, 1 above. */
    async function askedThreeBoughtFour() {
      const w = await world();
      const milk = await line(w, 3);
      await buy(w, milk.id, 4, 3);
      expect(await numbersOf(w, milk.id)).toEqual({
        asked: 3,
        left: 0,
        bought: 4,
        above: 1,
      });
      return { w, milk };
    }

    /** Case 7's two baskets: A asks 3 and bought 4, B bought 2 at 0. */
    async function twoBaskets() {
      const { w, milk } = await askedThreeBoughtFour();
      const b = await shopper(w.zoneId, w.listId);
      await insertBuy(w, milk.id, {
        basketId: b.basket.id,
        settledByParticipantId: b.participantId,
        quantity: 2,
        applied: 0,
        settledAt: new Date(),
      });
      expect(await numbersOf(b, milk.id)).toEqual({
        asked: 0,
        left: 0,
        bought: 2,
        above: 2,
      });
      return { w, b, milk };
    }

    // --- spec 2: the table ---------------------------------------------------

    describe('the table of the plan (spec 2)', () => {
      it('case 1: asks 3, bought 4, +2 with the flag', async () => {
        const { w, milk } = await askedThreeBoughtFour();

        const answer = await raise(w, milk.id, 2, true);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 5,
          left: 1,
          bought: 4,
          above: 0,
        });
        expect(answer.quantity).toBe(1);
        expect(answer.extra).toEqual({
          above: 1,
          counted: 1,
          buyers: [{ userId: w.userId }],
        });
      });

      it('case 2: asks 3, bought 4, +1 with the flag writes no line (spec 3)', async () => {
        const { w, milk } = await askedThreeBoughtFour();
        const before = await lineOf(milk.id);
        const changes = await changesOf(milk.id);
        announcer.reset();
        emitted.length = 0;

        const answer = await raise(w, milk.id, 1, true);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 4,
          left: 0,
          bought: 4,
          above: 0,
        });
        expect(answer.extra).toEqual({
          above: 1,
          counted: 1,
          buyers: [{ userId: w.userId }],
        });
        const after = await lineOf(milk.id);
        expect(after.quantity).toBe(0);
        expect(after.version).toBe(before.version);
        expect(answer.version).toBe(before.version);
        expect(await changesOf(milk.id)).toBe(changes);
        expect(lineUpdates(milk.id)).toEqual([]);
        expect(announcer.calls.linesMoved).toEqual([
          {
            listId: w.listId,
            lineIds: [milk.id],
            marksMoved: false,
            throughBasketId: null,
          },
        ]);
        // What the patch carries now: the entry's ask moved to 4.
        expect(await patchesOf(w, w, [milk.id])).toEqual([
          expect.objectContaining({ lineId: milk.id, asked: 4, left: 0 }),
        ]);
      });

      it('case 3: "Still need" after case 1', async () => {
        const { w, milk } = await askedThreeBoughtFour();
        await raise(w, milk.id, 2, true);

        const answer = await raise(w, milk.id, 1);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 6,
          left: 2,
          bought: 4,
          above: 0,
        });
        expect('extra' in answer).toBe(false);
      });

      it('case 4: "Still need" after case 2', async () => {
        const { w, milk } = await askedThreeBoughtFour();
        await raise(w, milk.id, 1, true);

        const answer = await raise(w, milk.id, 1);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 5,
          left: 1,
          bought: 4,
          above: 0,
        });
        expect('extra' in answer).toBe(false);
      });

      it('case 5: another control raises without the flag, as before (spec 7)', async () => {
        const { w, milk } = await askedThreeBoughtFour();
        const changes = await changesOf(milk.id);

        const answer = await raise(w, milk.id, 2);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 5,
          left: 2,
          bought: 4,
          above: 1,
        });
        expect('extra' in answer).toBe(false);
        expect(await changesOf(milk.id)).toBe(changes + 1);
        expect(lineUpdates(milk.id)).toHaveLength(1);
        expect(announcer.calls.linesMoved).toEqual([
          expect.objectContaining({ marksMoved: true }),
        ]);
      });

      it('case 6: more above than the raise writes no line (spec 3)', async () => {
        const w = await world();
        const milk = await line(w, 1);
        await buy(w, milk.id, 4, 1);
        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 1,
          left: 0,
          bought: 4,
          above: 3,
        });
        const before = await lineOf(milk.id);
        const changes = await changesOf(milk.id);
        announcer.reset();
        emitted.length = 0;

        const answer = await raise(w, milk.id, 2, true);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 3,
          left: 0,
          bought: 4,
          above: 1,
        });
        expect(answer.extra).toMatchObject({ above: 3, counted: 2 });
        expect((await lineOf(milk.id)).version).toBe(before.version);
        expect(await changesOf(milk.id)).toBe(changes);
        expect(lineUpdates(milk.id)).toEqual([]);
        expect(announcer.calls.linesMoved).toEqual([
          expect.objectContaining({ lineIds: [milk.id], marksMoved: false }),
        ]);
      });

      it('case 7: two baskets, +2, the older buy first and no line written (spec 3)', async () => {
        const { w, b, milk } = await twoBaskets();
        const before = await lineOf(milk.id);
        const changes = await changesOf(milk.id);
        announcer.reset();
        emitted.length = 0;

        const answer = await raise(w, milk.id, 2, true);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 4,
          left: 0,
          bought: 4,
          above: 0,
        });
        expect(await numbersOf(b, milk.id)).toEqual({
          asked: 1,
          left: 0,
          bought: 2,
          above: 1,
        });
        expect(answer.extra).toEqual({
          above: 3,
          counted: 2,
          buyers: [{ userId: w.userId }, { userId: b.userId }],
        });
        expect((await lineOf(milk.id)).version).toBe(before.version);
        expect(await changesOf(milk.id)).toBe(changes);
        expect(lineUpdates(milk.id)).toEqual([]);
        // One call, which the announcer sends to every covering basket, and
        // each one's entry reads its own moved ask.
        expect(announcer.calls.linesMoved).toEqual([
          expect.objectContaining({ lineIds: [milk.id], marksMoved: false }),
        ]);
        expect(await patchesOf(w, w, [milk.id])).toEqual([
          expect.objectContaining({ asked: 4 }),
        ]);
        expect(await patchesOf(b, w, [milk.id])).toEqual([
          expect.objectContaining({ asked: 1 }),
        ]);
      });

      it('case 8: the same two baskets, +4', async () => {
        const { w, b, milk } = await twoBaskets();

        const answer = await raise(w, milk.id, 4, true);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 5,
          left: 1,
          bought: 4,
          above: 0,
        });
        expect(await numbersOf(b, milk.id)).toEqual({
          asked: 3,
          left: 1,
          bought: 2,
          above: 0,
        });
        expect(answer.extra).toMatchObject({ above: 3, counted: 3 });
        expect(lineUpdates(milk.id)).toHaveLength(1);
      });

      it('cases 9 and 10: a weight, then "Still need"', async () => {
        const w = await world();
        const ham = await line(w, 1000, 'GRAM');
        await buy(w, ham.id, 1500, 1000, 'GRAM');
        expect(await numbersOf(w, ham.id)).toEqual({
          asked: 1000,
          left: 0,
          bought: 1500,
          above: 500,
        });

        const answer = await raise(w, ham.id, 1500, true, 'GRAM');

        expect(await numbersOf(w, ham.id)).toEqual({
          asked: 2500,
          left: 1000,
          bought: 1500,
          above: 0,
        });
        expect(answer.extra).toMatchObject({ above: 500, counted: 500 });

        const again = await raise(w, ham.id, 500, undefined, 'GRAM');

        expect(await numbersOf(w, ham.id)).toEqual({
          asked: 3000,
          left: 1500,
          bought: 1500,
          above: 0,
        });
        expect('extra' in again).toBe(false);
      });

      it('case 11: no extra, the same as without the flag', async () => {
        const w = await world();
        const milk = await line(w, 3);
        await buy(w, milk.id, 2, 3);

        const answer = await raise(w, milk.id, 2, true);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 5,
          left: 3,
          bought: 2,
          above: 0,
        });
        expect(answer.extra).toEqual({ above: 0, counted: 0, buyers: [] });
        expect(lineUpdates(milk.id)).toHaveLength(1);
      });

      it('case 12: a lowering with the flag counts nothing (spec 6)', async () => {
        const { w, milk } = await askedThreeBoughtFour();
        await raise(w, milk.id, 2);

        const answer = await raise(w, milk.id, -1, true);

        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 4,
          left: 1,
          bought: 4,
          above: 1,
        });
        expect(answer.quantity).toBe(1);
        expect(answer.extra).toEqual({
          above: 1,
          counted: 0,
          buyers: [{ userId: w.userId }],
        });
      });
    });

    // --- spec 4: buys that never count ------------------------------------------

    it('never counts a LIVE basket outside its session, a list page buy, a reverted buy or a buy in another unit (spec 4)', async () => {
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

      expect(answer.extra).toEqual({ above: 0, counted: 0, buyers: [] });
      expect(answer.quantity).toBe(5);
      expect(await appliedOf(milk.id)).toEqual(before);
    });

    // --- spec 5: who is named ---------------------------------------------------

    describe('who bought the extra (spec 5)', () => {
      it("names the basket's owner for a guest's buy", async () => {
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
          counted: 1,
          buyers: [{ userId: w.userId }],
        });
      });

      it('answers two people in the order of their oldest buy', async () => {
        const w = await world();
        const milk = await line(w, 3);
        const luis = randomUUID();
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

      it('answers null for a buy whose participant is gone', async () => {
        const w = await world();
        const milk = await line(w, 0);
        await insertBuy(w, milk.id, { settledByParticipantId: randomUUID() });

        const answer = await raise(w, milk.id, 1, true);

        expect(answer.extra).toEqual({
          above: 2,
          counted: 1,
          buyers: [{ userId: null }],
        });
      });
    });

    // --- spec 8: the permission -------------------------------------------------

    it('refuses a reader without DECIDE on an approved line with the flag, and moves no applied (spec 8)', async () => {
      const { w, milk } = await askedThreeBoughtFour();
      const writer = randomUUID();
      const membership = await member(w.zoneId, writer, ZoneRole.MEMBER);
      await dataSource.getRepository(ListAccess).save({
        listId: w.listId,
        membershipId: membership.id,
        permissions: [ListPermission.READ, ListPermission.WRITE],
      });
      const before = await appliedOf(milk.id);

      await expect(
        raise({ userId: writer }, milk.id, 1, true)
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(raise({ userId: writer }, milk.id, 1)).rejects.toMatchObject(
        { code: 'forbidden' }
      );
      expect(await appliedOf(milk.id)).toEqual(before);
      expect((await lineOf(milk.id)).quantity).toBe(0);
    });

    // --- spec 9: the lock ---------------------------------------------------------

    it('counts the buys as they stand at the lock, with a settle that landed in between (spec 9)', async () => {
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

        expect(answer.extra).toMatchObject({ above: 1, counted: 1 });
        expect(answer.quantity).toBe(1);
        expect(await numbersOf(w, milk.id)).toEqual({
          asked: 5,
          left: 1,
          bought: 4,
          above: 0,
        });
      } finally {
        if (runner.isTransactionActive) {
          await runner.rollbackTransaction();
        }
        await runner.release();
      }
    });
  }
);
