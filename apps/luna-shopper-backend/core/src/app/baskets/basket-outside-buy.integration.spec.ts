import {
  BasketChangeOriginKind,
  BasketKind,
  BasketRowMark,
  BasketRowNote,
  BasketRowState,
  BasketStatus,
  LineApprovalStatus,
  LineChangeKind,
  MembershipStatus,
  ParticipantKind,
  PURCHASE_SESSION_GAP_MS,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, IsNull } from 'typeorm';
import {
  Basket,
  BasketParticipant,
  BasketSource,
  CORE_ENTITIES,
  LineSettlement,
  ListAccess,
  ListLine,
  ListLineChange,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { ListAccessService } from '../lists/list-access.service';
import { SettlementService } from '../lists/settlement.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { fakeBasketAnnouncer } from './basket-announcer.fake';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketWriteContext } from './basket-write.context';
import { BasketChangesService } from './changes/basket-changes.service';
import { BasketMarksReader } from './changes/basket-marks.reader';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A buy made outside a basket is a change, and counts for nothing in it (plan
 * 0203, section 8, tests 1 to 8, 12 and 13).
 *
 * Against Postgres, with the **real** marks reader and the real writes. Who a
 * buy change is for is a `CASE` over the kind and the basket of the change, and
 * how long a removed row lives is a comparison with the `now()` of the
 * database. A mocked repository has neither.
 *
 * Tests 9 to 11 are in the suites that already held their fixtures: test 9 in
 * `changes/basket-changes.integration.spec.ts`, tests 10 and 11 in
 * `basket-bought-elsewhere.integration.spec.ts`. Test 14 is
 * `db/line-change-buy-kinds.migration.integration.spec.ts`.
 *
 * **Two people share one zone here on purpose**, as in the suite of plan 0188.
 * Every other `LIVE` fixture gives each owner a zone of their own (plan 0149).
 * This file is about two baskets over the same lines, so each test builds one
 * zone for one pair and no other test ever reads it. No basket covers a whole
 * zone: a `GENERATED` basket names its one list.
 *
 * The clock is moved by writing `settledAt` and `createdAt`, never by a mocked
 * `Date`: the values under test are `now()` inside a statement.
 */
describeIntegration(
  'a buy made outside a basket is a change (real Postgres)',
  () => {
    let dataSource: DataSource;
    let read: BasketReadService;
    let changes: BasketChangesService;
    let settleService: BasketSettleService;
    let revertService: BasketRevertService;
    let settlements: SettlementService;

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

      // Every account here is staff of its zone, so it writes every list and is
      // served every list. A guest has no account, and the context asks nothing
      // for one, so a guest is served no list.
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
      changes = new BasketChangesService(
        dataSource.getRepository(ListLineChange),
        context,
        read,
        marks
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
      settlements = new SettlementService(
        dataSource,
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        events,
        announcer,
        new LineChangeRecorder()
      );
    });

    afterAll(async () => {
      const zones = dataSource.getRepository(Zone);
      for (const zoneId of zoneIds) {
        // Memberships, lists, lines, settlements and changes cascade from it.
        await zones.delete({ id: zoneId });
      }
      await dataSource?.destroy();
    });

    // --- fixtures ----------------------------------------------------------

    interface Shopper {
      userId: string;
      basket: Basket;
      participantId: string;
    }

    /**
     * A basket and its people start two days ago. A viewer is shown no change
     * from before they started, and test 13 moves a change seven hours back.
     */
    const earlier = () => new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

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
          joinedAt: earlier(),
          lastSeenAt: new Date(),
          revokedAt: null,
          // A link visitor always carries one and the owner never does (plan
          // 0140).
          expiresAt:
            kind === ParticipantKind.OWNER
              ? null
              : new Date(Date.now() + 12 * 60 * 60 * 1000),
        })
      );
      return saved.id;
    }

    async function basketOf(
      userId: string,
      kind: BasketKind,
      zoneId: string,
      listId: string
    ): Promise<Shopper> {
      const repo = dataSource.getRepository(Basket);
      const basket = await repo.save(
        repo.create({
          ownerUserId: userId,
          kind,
          name: kind === BasketKind.LIVE ? null : 'Saturday',
          status: BasketStatus.OPEN,
          generatedAt: earlier(),
          idempotencyKey: null,
        })
      );
      if (kind === BasketKind.GENERATED) {
        const sources = dataSource.getRepository(BasketSource);
        await sources.save(
          sources.create({ basketId: basket.id, zoneId, listId })
        );
      }
      return {
        userId,
        basket,
        participantId: await participant(basket, ParticipantKind.OWNER, userId),
      };
    }

    /** One zone, one list, and two people who each write it from a basket. */
    async function world(
      kind: BasketKind = BasketKind.LIVE
    ): Promise<{ zoneId: string; listId: string; a: Shopper; b: Shopper }> {
      const users = { a: randomUUID(), b: randomUUID() };
      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Outside buys',
          joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: users.a,
          config: {},
        })
      );
      zoneIds.push(zone.id);
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.save([
        memberships.create({
          zoneId: zone.id,
          userId: users.a,
          username: 'Ana',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        }),
        memberships.create({
          zoneId: zone.id,
          userId: users.b,
          username: 'Bruno',
          role: ZoneRole.ADMIN,
          status: MembershipStatus.APPROVED,
        }),
      ]);
      const lists = dataSource.getRepository(ShoppingList);
      const list = await lists.save(
        lists.create({
          zoneId: zone.id,
          name: 'Weekly',
          createdByUserId: users.a,
        })
      );
      return {
        zoneId: zone.id,
        listId: list.id,
        a: await basketOf(users.a, kind, zone.id, list.id),
        b: await basketOf(users.b, kind, zone.id, list.id),
      };
    }

    async function line(
      listId: string,
      createdByUserId: string,
      content: string,
      quantity = 2
    ): Promise<ListLine> {
      const repo = dataSource.getRepository(ListLine);
      position += 1;
      return repo.save(
        repo.create({
          listId,
          content,
          quantity,
          position,
          createdByUserId,
          approvalStatus: LineApprovalStatus.APPROVED,
        })
      );
    }

    /** Somebody buys units of a row through a basket. */
    const buy = (
      who: Pick<Shopper, 'basket' | 'participantId'>,
      row: ListLine,
      quantity: number,
      from: number
    ) =>
      settleService.settle({
        basketId: who.basket.id,
        participantId: who.participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity,
        from,
      });

    const takeBack = (
      who: Shopper,
      row: ListLine,
      units: number,
      from: number
    ) =>
      revertService.revert({
        basketId: who.basket.id,
        participantId: who.participantId,
        rowKey: row.id,
        target: 'UNITS',
        units,
        from,
      });

    const viewOf = (who: Pick<Shopper, 'basket' | 'participantId'>) =>
      read.read({ basketId: who.basket.id, participantId: who.participantId });

    const changesOf = (who: Pick<Shopper, 'basket' | 'participantId'>) =>
      changes.list({
        basketId: who.basket.id,
        participantId: who.participantId,
      });

    const recordedOn = (lineId: string) =>
      dataSource.getRepository(ListLineChange).find({
        where: { lineId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });

    const NOTHING_COUNTED = { done: 0, unavailable: 0, total: 0, pending: 0 };
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;

    // --- 1. a line bought to zero through another basket --------------------

    it('reads a line that another basket bought as BOUGHT_ELSEWHERE, marked, and counts it for nothing (test 1)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);

      await buy(a, milk, 2, 2);

      const recorded = await recordedOn(milk.id);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        kind: LineChangeKind.BOUGHT,
        quantityBefore: 2,
        quantityAfter: 0,
        contentBefore: null,
        approvalAfter: null,
        actorParticipantId: a.participantId,
        actorUserId: a.userId,
        basketId: a.basket.id,
      });

      const other = await viewOf(b);
      expect(other.rows).toHaveLength(1);
      expect(other.rows[0]).toMatchObject({
        rowKey: milk.id,
        left: 0,
        bought: 0,
        asked: 0,
        boughtElsewhere: 2,
        state: BasketRowState.BOUGHT_ELSEWHERE,
        note: BasketRowNote.BOUGHT_ON_ANOTHER_BASKET,
        mark: BasketRowMark.CHANGED,
        touchedBy: null,
      });
      expect(other.rows[0].entries[0]).toMatchObject({
        state: BasketRowState.BOUGHT_ELSEWHERE,
        bought: 0,
      });
      expect(other.unseenChangeCount).toBe(1);
      expect(other.newestUnseenChangeId).toBe(recorded[0].id);
      // The owner's answer 5: it is dropped from the progress.
      expect(other.progress).toEqual(NOTHING_COUNTED);

      // The read of the buyer is what it is today.
      const own = await viewOf(a);
      expect(own.rows[0]).toMatchObject({
        left: 0,
        bought: 2,
        asked: 2,
        boughtElsewhere: 0,
        state: BasketRowState.DONE,
        note: null,
        mark: null,
        touchedBy: a.participantId,
      });
      expect(own.unseenChangeCount).toBe(0);
      expect(own.newestUnseenChangeId).toBeNull();
      expect(own.progress).toEqual({
        done: 1,
        unavailable: 0,
        total: 1,
        pending: 0,
      });
    });

    // --- 2. a partial buy ---------------------------------------------------

    it('lowers the row of the other basket by a partial buy, and marks it (test 2)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3);

      await buy(a, milk, 1, 3);

      const other = await viewOf(b);
      expect(other.rows[0]).toMatchObject({
        left: 2,
        bought: 0,
        asked: 2,
        boughtElsewhere: 1,
        // Something is left, so the state is what the table of plan 0130 gives.
        state: BasketRowState.WANTED,
        mark: BasketRowMark.CHANGED,
      });
      expect(other.unseenChangeCount).toBe(1);
      expect(other.progress).toEqual({
        done: 0,
        unavailable: 0,
        total: 1,
        pending: 1,
      });
    });

    // --- 3 and 4. this basket bought some, another the rest, then a revert --

    it('is DONE with own buys when another basket bought the rest, and PARTLY after that buy is taken back (tests 3 and 4)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3);

      await buy(b, milk, 2, 3);
      await buy(a, milk, 1, 1);

      // The owner's answer 4: "instead of 3 now you only have to get 2".
      const done = await viewOf(b);
      expect(done.rows[0]).toMatchObject({
        left: 0,
        bought: 2,
        asked: 2,
        boughtElsewhere: 1,
        state: BasketRowState.DONE,
        mark: BasketRowMark.CHANGED,
      });
      expect(done.progress).toEqual({
        done: 1,
        unavailable: 0,
        total: 1,
        pending: 0,
      });
      // The own buy of B is no change for B. The buy of A is one.
      expect(done.unseenChangeCount).toBe(1);

      await takeBack(a, milk, 1, 1);

      const reverted = (await recordedOn(milk.id)).at(-1);
      expect(reverted).toMatchObject({
        kind: LineChangeKind.BUY_REVERTED,
        quantityBefore: 0,
        quantityAfter: 1,
        actorParticipantId: a.participantId,
        basketId: a.basket.id,
      });

      const back = await viewOf(b);
      expect(back.rows[0]).toMatchObject({
        left: 1,
        bought: 2,
        asked: 3,
        boughtElsewhere: 0,
        state: BasketRowState.PARTLY,
        mark: BasketRowMark.CHANGED,
        note: null,
      });
      // The buy and the taken back buy are two changes.
      expect(back.unseenChangeCount).toBe(2);
      expect(back.newestUnseenChangeId).toBe(reverted?.id);

      // Neither is a change in the basket they were made through. The buy of
      // B is one there.
      expect((await viewOf(a)).unseenChangeCount).toBe(1);
    });

    // --- 5. another person of the same basket -------------------------------

    it('reads a buy by another person of the same basket as an own buy, with no mark (test 5)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      const guest = {
        basket: b.basket,
        participantId: await participant(b.basket, ParticipantKind.GUEST, null),
      };

      await buy(guest, milk, 2, 2);

      // The shape plan 0138 stores for a change by a guest: a participant, a
      // basket and no account.
      expect((await recordedOn(milk.id))[0]).toMatchObject({
        kind: LineChangeKind.BOUGHT,
        actorParticipantId: guest.participantId,
        actorUserId: null,
        basketId: b.basket.id,
      });

      const own = await viewOf(b);
      expect(own.rows[0]).toMatchObject({
        left: 0,
        bought: 2,
        asked: 2,
        boughtElsewhere: 0,
        state: BasketRowState.DONE,
        mark: null,
        note: null,
        touchedBy: guest.participantId,
      });
      expect(own.unseenChangeCount).toBe(0);

      // It is an outside buy for the other basket.
      const other = await viewOf(a);
      expect(other.rows[0]).toMatchObject({
        state: BasketRowState.BOUGHT_ELSEWHERE,
        mark: BasketRowMark.CHANGED,
      });
      expect(other.unseenChangeCount).toBe(1);
    });

    // --- 6. a buy on the list page ------------------------------------------

    it('says a buy on the list page came from the list, to the buyer too, until a basket buys later (test 6)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      announcer.reset();

      await settlements.settle({
        userId: a.userId,
        lineId: milk.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
      });

      const [recorded] = await recordedOn(milk.id);
      expect(recorded).toMatchObject({
        kind: LineChangeKind.BOUGHT,
        quantityBefore: 2,
        quantityAfter: 0,
        actorUserId: a.userId,
        actorParticipantId: null,
        basketId: null,
      });
      // Every covering basket is told to read its marks: the buy named none.
      expect(announcer.calls.linesMoved).toEqual([
        {
          listId,
          lineIds: [milk.id],
          marksMoved: true,
          throughBasketId: null,
        },
      ]);

      // The basket of the buyer is shown the change too: it was not bought
      // through that basket either.
      for (const who of [b, a]) {
        const view = await viewOf(who);
        expect(view.rows[0]).toMatchObject({
          left: 0,
          bought: 0,
          boughtElsewhere: 2,
          state: BasketRowState.BOUGHT_ELSEWHERE,
          note: BasketRowNote.BOUGHT_ON_THE_LIST,
          mark: BasketRowMark.CHANGED,
        });
        expect(view.unseenChangeCount).toBe(1);
        expect(view.progress).toEqual(NOTHING_COUNTED);

        const [change] = (await changesOf(who)).items;
        expect(change).toMatchObject({
          kind: LineChangeKind.BOUGHT,
          origin: { kind: BasketChangeOriginKind.LIST },
          // "Bought from the list by X": the buyer, beside a served list.
          actor: { userId: a.userId },
          listId,
          rowKey: milk.id,
        });
      }

      // A later buy of the same line through the basket of A. The line is at
      // zero, so the units are an excess and no quantity moves.
      await buy(a, milk, 1, 0);
      expect(await recordedOn(milk.id)).toHaveLength(1);

      const later = await viewOf(b);
      expect(later.rows[0]).toMatchObject({
        boughtElsewhere: 3,
        state: BasketRowState.BOUGHT_ELSEWHERE,
        note: BasketRowNote.BOUGHT_ON_ANOTHER_BASKET,
      });
    });

    // --- 7. two baskets of one account --------------------------------------

    it('shows a buy through one basket of an account as a change in its other basket (test 7)', async () => {
      const { zoneId, listId, a } = await world(BasketKind.LIVE);
      const trip = await basketOf(
        a.userId,
        BasketKind.GENERATED,
        zoneId,
        listId
      );
      const milk = await line(listId, a.userId, 'Milk', 2);
      const bread = await line(listId, a.userId, 'Bread', 1);

      // The owner's answer 2: the live basket and the generated basket are
      // different lists and share nothing.
      await buy(trip, milk, 2, 2);
      const live = await viewOf(a);
      expect(live.rows.find((row) => row.rowKey === milk.id)).toMatchObject({
        bought: 0,
        boughtElsewhere: 2,
        state: BasketRowState.BOUGHT_ELSEWHERE,
        mark: BasketRowMark.CHANGED,
      });
      expect(live.unseenChangeCount).toBe(1);
      expect(live.progress).toEqual({
        done: 0,
        unavailable: 0,
        total: 1,
        pending: 1,
      });
      expect((await viewOf(trip)).unseenChangeCount).toBe(0);

      // And the other way.
      await buy(a, bread, 1, 1);
      const generated = await viewOf(trip);
      expect(
        generated.rows.find((row) => row.rowKey === bread.id)
      ).toMatchObject({
        state: BasketRowState.BOUGHT_ELSEWHERE,
        mark: BasketRowMark.CHANGED,
      });
      expect(generated.unseenChangeCount).toBe(1);

      // The changes view names the owner of the other basket, who is the
      // reader here, and still no basket.
      const [newest] = (await changesOf(trip)).items;
      expect(newest.origin).toEqual({
        kind: BasketChangeOriginKind.ANOTHER_BASKET,
        owner: { userId: a.userId },
      });
    });

    // --- 8. the changes view ------------------------------------------------

    it('names the owner of the other basket to a member, nobody to a guest, and no other basket to anybody (test 8)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3);
      const guestOfB = {
        basket: b.basket,
        participantId: await participant(b.basket, ParticipantKind.GUEST, null),
      };
      // Somebody who shops through the basket of A and is not its owner.
      const helper = {
        basket: a.basket,
        participantId: await participant(
          a.basket,
          ParticipantKind.REGISTERED,
          randomUUID()
        ),
      };

      await buy(helper, milk, 1, 3);
      await buy(b, milk, 1, 2);

      const asMember = (await changesOf(b)).items;
      const outside = asMember.find((change) => change.origin !== null);
      const own = asMember.find((change) => change.origin === null);
      // The owner of the other basket, and not the person who did the buying.
      expect(outside).toMatchObject({
        kind: LineChangeKind.BOUGHT,
        quantityBefore: 3,
        quantityAfter: 2,
        origin: {
          kind: BasketChangeOriginKind.ANOTHER_BASKET,
          owner: { userId: a.userId },
        },
        listId,
        rowKey: milk.id,
      });
      // The own buy of the reading basket is in the history, with its
      // participant.
      expect(own).toMatchObject({
        kind: LineChangeKind.BOUGHT,
        quantityBefore: 2,
        quantityAfter: 1,
        origin: null,
        actor: { participantId: b.participantId },
      });

      const asGuest = (await changesOf(guestOfB)).items;
      const outsideForGuest = asGuest.find((change) => change.origin !== null);
      // A guest is served no list, so a guest is told no account: "Someone".
      expect(outsideForGuest).toMatchObject({
        origin: { kind: BasketChangeOriginKind.ANOTHER_BASKET, owner: null },
        actor: null,
      });
      expect(Object.keys(outsideForGuest ?? {})).not.toContain('listId');

      // No answer holds the other basket, its participant or, for the guest,
      // any account.
      for (const wire of [JSON.stringify(asMember), JSON.stringify(asGuest)]) {
        expect(wire).not.toContain(a.basket.id);
        expect(wire).not.toContain(helper.participantId);
      }
      expect(JSON.stringify(asGuest)).not.toContain(a.userId);
      expect(JSON.stringify(asGuest)).not.toContain(listId);
      // The id of the own basket is in no change either: a change names a row.
      expect(JSON.stringify(asMember)).not.toContain(b.basket.id);
    });

    // --- the announcement ---------------------------------------------------

    it('tells the other baskets that their marks moved, and names the basket the buy was made through', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      announcer.reset();

      // "They had none" moves no quantity, so no marks moved.
      await settleService.settle({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        outcome: SettlementOutcome.NOT_AVAILABLE,
        from: 2,
      });
      await buy(a, milk, 2, 2);
      await takeBack(a, milk, 1, 2);

      expect(announcer.calls.linesMoved).toEqual([
        {
          listId,
          lineIds: [milk.id],
          marksMoved: false,
          throughBasketId: a.basket.id,
        },
        {
          listId,
          lineIds: [milk.id],
          marksMoved: true,
          throughBasketId: a.basket.id,
        },
        {
          listId,
          lineIds: [milk.id],
          marksMoved: true,
          throughBasketId: a.basket.id,
        },
      ]);
    });

    // --- 12. the window of an outside buy -----------------------------------

    it('gives no row, and no removed row, for an outside buy older than the window (test 12)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 2, 2);

      const settledAgo = (ms: number) =>
        dataSource
          .getRepository(LineSettlement)
          .update(
            { lineId: milk.id },
            { settledAt: new Date(Date.now() - ms) }
          );

      await settledAgo(PURCHASE_SESSION_GAP_MS - MINUTE);
      expect((await viewOf(b)).rows).toHaveLength(1);

      await settledAgo(PURCHASE_SESSION_GAP_MS + MINUTE);
      const after = await viewOf(b);
      // The change is still unseen, and its line is no row any more. A buy
      // never removes a row, so nothing is drawn for it.
      expect(after.unseenChangeCount).toBe(1);
      expect(after.rows).toEqual([]);
      expect(after.progress).toEqual(NOTHING_COUNTED);
    });

    // --- 13. a removed row stays for six hours ------------------------------

    it('keeps a deleted line as a REMOVED row for six hours, with its mark only while it is marked (test 13)', async () => {
      const { zoneId, listId, a, b } = await world();
      const olives = await line(listId, a.userId, 'Olives', 2);
      await dataSource.getRepository(ListLine).softDelete({ id: olives.id });
      const [{ id: changeId }] = (await dataSource.query(
        `INSERT INTO "list_line_changes"
           ("zoneId", "listId", "lineId", "kind",
            "contentBefore", "quantityBefore", "approvalBefore", "actorUserId")
         VALUES ($1, $2, $3, 'DELETED', 'Olives', 2, 'APPROVED', $4)
         RETURNING "id"`,
        [zoneId, listId, olives.id, a.userId]
      )) as { id: string }[];
      const changedAgo = (ms: number) =>
        dataSource.query(
          `UPDATE "list_line_changes"
           SET "createdAt" = now() - ($2::double precision * interval '1 millisecond')
           WHERE "id" = $1`,
          [changeId, ms]
        );

      // Fresh and unseen: the row of plan 0138, with its mark.
      await changedAgo(MINUTE);
      const fresh = await viewOf(b);
      expect(fresh.rows).toHaveLength(1);
      expect(fresh.rows[0]).toMatchObject({
        rowKey: olives.id,
        content: 'Olives',
        state: BasketRowState.REMOVED,
        mark: BasketRowMark.REMOVED,
        entries: [],
      });
      expect(fresh.progress).toEqual(NOTHING_COUNTED);

      // Acknowledged, and then the mark window runs out. Before plan 0203 the
      // row left with its mark.
      await changes.acknowledge({
        basketId: b.basket.id,
        participantId: b.participantId,
        through: changeId,
      });
      await dataSource.query(
        `UPDATE "basket_change_cursors"
         SET "ackedAt" = now() - interval '1 hour'
         WHERE "participantId" = $1`,
        [b.participantId]
      );

      await changedAgo(5 * HOUR);
      const fiveHours = await viewOf(b);
      expect(fiveHours.unseenChangeCount).toBe(0);
      expect(fiveHours.rows).toHaveLength(1);
      expect(fiveHours.rows[0]).toMatchObject({
        rowKey: olives.id,
        content: 'Olives',
        state: BasketRowState.REMOVED,
        mark: null,
      });
      expect(fiveHours.progress).toEqual(NOTHING_COUNTED);

      // The removal a viewer made is still not drawn for that viewer.
      expect((await viewOf(a)).rows).toEqual([]);

      await changedAgo(7 * HOUR);
      expect((await viewOf(b)).rows).toEqual([]);
    });
  }
);
