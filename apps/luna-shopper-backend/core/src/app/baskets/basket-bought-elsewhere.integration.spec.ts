import {
  BasketKind,
  BasketRowNote,
  BasketRowState,
  BasketStatus,
  LineApprovalStatus,
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
  ListLineGroupRemoval,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { LineMergeService } from '../lists/line-merge.service';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { BasketAnnouncer } from './basket-announcer.service';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketDemandService } from './basket-demand.service';
import { BasketReadService } from './basket-read.service';
import { BasketRedaction } from './basket-redaction';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketTripRowsService } from './basket-trip-rows.service';
import { BasketWriteContext } from './basket-write.context';
import { fakeBasketMarks } from './changes/basket-marks.fake';
import { fakeLineClaims } from './line-claims.fake';

/**
 * A line bought through another basket stays a row (plan 0188).
 *
 * Against Postgres, because the rule is an `EXISTS` over `line_settlements`
 * compared with the database's `now()`, and the writes that produce the
 * purchase are the real settle and the real revert. A mocked repository has
 * neither the clock nor the lock.
 *
 * **Two people share one zone here on purpose.** Every other `LIVE` fixture
 * gives each owner a zone of their own (plan 0149), because a `LIVE` basket
 * covers every list its owner writes. This file is about two baskets over the
 * same lines, so each test builds one zone for one pair and no other test ever
 * reads it.
 */
describeIntegration(
  'a line bought through another basket (real Postgres)',
  () => {
    let dataSource: DataSource;
    let read: BasketReadService;
    let resolver: BasketRowResolver;
    let settleService: BasketSettleService;
    let revertService: BasketRevertService;
    let demandService: BasketDemandService;

    const zoneIds: string[] = [];
    let position = 0;

    const events = {
      emit: () => undefined,
      emitTo: () => undefined,
      emitToUsers: () => undefined,
    };

    /** The claim, which has its own integration spec and is not this one's. */
    const claims = {
      claimsOf: async () => new Map(),
      claimOf: async () => ({ claimed: false, claimedByUserId: null }),
      announceReleased: async () => undefined,
    };

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
      const announcer = new BasketAnnouncer(
        coverage,
        events as unknown as CoreEventsPublisher
      );
      resolver = new BasketRowResolver(baskets, fakeCoreConfig());

      // The three methods the context and the read ask of it. The participants
      // are the real rows, because the read looks its caller up in them.
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

      // The **real** access service: the demand write asks it who the owner is
      // on the list, and both people here are staff of the zone.
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
        fakeBasketMarks(),
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
        claims as never,
        events as never
      );
      revertService = new BasketRevertService(
        dataSource,
        context,
        claims as never,
        events as never
      );
      const lines = new LineService(
        dataSource,
        dataSource.getRepository(ListLine),
        dataSource.getRepository(ListLineItem),
        dataSource.getRepository(ListLineGroupRemoval),
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        events as never,
        new CoreAuditService(dataSource),
        new LineMergeService(new LineChangeRecorder()),
        new LineChangeRecorder(),
        announcer
      );
      demandService = new BasketDemandService(
        context,
        lines,
        listAccess,
        events as never
      );
    });

    afterAll(async () => {
      const zones = dataSource.getRepository(Zone);
      for (const zoneId of zoneIds) {
        // Memberships, lists, lines and settlements cascade from the zone.
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

    /** The owner's participant row of a basket. */
    async function ownerOf(basket: Basket, userId: string): Promise<string> {
      const participants = dataSource.getRepository(BasketParticipant);
      const saved = await participants.save(
        participants.create({
          basketId: basket.id,
          shareLinkId: null,
          kind: ParticipantKind.OWNER,
          userId,
          displayName: null,
          username: 'Shopper',
          guestNumber: null,
          sessionSecretHash: null,
          userAgent: null,
          joinedAt: new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
        })
      );
      return saved.id;
    }

    /**
     * One zone, one list, and two people who each write it.
     *
     * `LIVE` gives each of them their permanent basket, which covers the list
     * by rule. `GENERATED` gives each a trip whose one source is the list, never
     * the whole zone.
     */
    async function world(
      kind: BasketKind = BasketKind.LIVE
    ): Promise<{ zoneId: string; listId: string; a: Shopper; b: Shopper }> {
      const users = { a: randomUUID(), b: randomUUID() };
      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Bought elsewhere',
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
          // Staff of the zone, so the list is writable by role and no
          // `list_access` row is needed.
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

      const shopper = async (userId: string): Promise<Shopper> => {
        const repo = dataSource.getRepository(Basket);
        const basket = await repo.save(
          repo.create({
            ownerUserId: userId,
            kind,
            name: kind === BasketKind.LIVE ? null : 'Saturday',
            status: BasketStatus.OPEN,
            generatedAt: new Date(),
            idempotencyKey: null,
          })
        );
        if (kind === BasketKind.GENERATED) {
          const sources = dataSource.getRepository(BasketSource);
          await sources.save(
            sources.create({
              basketId: basket.id,
              zoneId: zone.id,
              listId: list.id,
            })
          );
        }
        return {
          userId,
          basket,
          participantId: await ownerOf(basket, userId),
        };
      };

      return {
        zoneId: zone.id,
        listId: list.id,
        a: await shopper(users.a),
        b: await shopper(users.b),
      };
    }

    async function line(
      listId: string,
      createdByUserId: string,
      content: string,
      quantity = 2,
      over: Partial<ListLine> = {}
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
          ...over,
        })
      );
    }

    /** One person buys units of a row through their own basket. */
    const buy = (who: Shopper, row: ListLine, quantity: number, from: number) =>
      settleService.settle({
        basketId: who.basket.id,
        participantId: who.participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity,
        from,
      });

    /** The whole basket, as its owner reads it. */
    const viewOf = (who: Shopper) =>
      read.read({ basketId: who.basket.id, participantId: who.participantId });

    const standingOf = (lineId: string) =>
      dataSource.getRepository(LineSettlement).find({
        where: { lineId, revertedAt: IsNull() },
        order: { settledAt: 'ASC', id: 'ASC' },
      });

    const quantityOf = async (id: string) =>
      (await dataSource.getRepository(ListLine).findOneByOrFail({ id }))
        .quantity;

    /**
     * Move a purchase in time, through the row itself.
     *
     * The window is compared with the database's `now()`, so the honest way to
     * make a purchase old is to say when it happened. A mocked `Date` would
     * move the application's clock and leave the one that decides untouched.
     */
    const settledAgo = (lineId: string, ms: number) =>
      dataSource
        .getRepository(LineSettlement)
        .update({ lineId }, { settledAt: new Date(Date.now() - ms) });

    const MINUTE = 60 * 1000;

    // --- 1. the row stays ---------------------------------------------------

    it('keeps the row in the other basket as DONE, and names nobody (test 1)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);

      const before = await viewOf(b);
      await buy(a, milk, 2, 2);
      const after = await viewOf(b);

      expect(before.rows).toHaveLength(1);
      expect(before.progress).toEqual({
        done: 0,
        unavailable: 0,
        total: 1,
        pending: 1,
      });

      // Before plan 0188 this was an empty basket: the row left the screen of
      // everybody but the buyer.
      expect(after.rows).toHaveLength(1);
      const [row] = after.rows;
      const [purchase] = await standingOf(milk.id);
      expect(row).toMatchObject({
        rowKey: milk.id,
        content: 'Milk',
        left: 0,
        bought: 0,
        asked: 0,
        boughtElsewhere: 2,
        state: BasketRowState.DONE,
        note: BasketRowNote.BOUGHT_ON_ANOTHER_BASKET,
        noteAt: purchase.settledAt.toISOString(),
        // About this basket's own acts, and it made none.
        touchedBy: null,
        touchedAt: null,
      });
      expect(row.entries).toHaveLength(1);
      expect(row.entries[0]).toMatchObject({
        lineId: milk.id,
        left: 0,
        bought: 0,
        boughtElsewhere: 2,
        state: BasketRowState.DONE,
      });
      // The reader's progress does not fall because somebody else bought.
      expect(after.progress).toEqual({
        done: 1,
        unavailable: 0,
        total: 1,
        pending: 0,
      });

      // No person, no account and no basket of the purchase, anywhere on it.
      const wire = JSON.stringify(row);
      expect(wire).not.toContain(a.participantId);
      expect(wire).not.toContain(a.userId);
      expect(wire).not.toContain(a.basket.id);
      expect(wire).not.toContain(purchase.id);

      // The buyer's read is what it was: their own purchase, and no note.
      const [own] = (await viewOf(a)).rows;
      expect(own).toMatchObject({
        left: 0,
        bought: 2,
        asked: 2,
        boughtElsewhere: 0,
        state: BasketRowState.DONE,
        note: null,
        touchedBy: a.participantId,
      });
    });

    // --- 2. the window ------------------------------------------------------

    it('drops the row once the purchase is older than the gap (test 2)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 2, 2);

      // A minute inside the six hours, and it is still a row.
      await settledAgo(milk.id, PURCHASE_SESSION_GAP_MS - MINUTE);
      expect((await viewOf(b)).rows).toHaveLength(1);

      // A minute past, and it leaves on this read, with no event and no write:
      // nothing happened except the clock.
      await settledAgo(milk.id, PURCHASE_SESSION_GAP_MS + MINUTE);
      const after = await viewOf(b);
      expect(after.rows).toEqual([]);
      expect(after.progress.total).toBe(0);
    });

    // --- 3. a purchase taken back -------------------------------------------

    it('gives no row for a purchase that was reverted (test 3)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 2, 2);
      expect((await viewOf(b)).rows[0].boughtElsewhere).toBe(2);

      await revertService.revert({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        target: 'UNITS',
        units: 2,
        from: 2,
      });

      // The units are back on the list, so the row is there for its own
      // reason and says nothing about another basket.
      const [back] = (await viewOf(b)).rows;
      expect(back).toMatchObject({
        left: 2,
        boughtElsewhere: 0,
        state: BasketRowState.WANTED,
        note: null,
      });

      // With the demand taken to zero as well, only the reverted purchase could
      // keep the row, and it does not.
      await dataSource.getRepository(ListLine).update(milk.id, { quantity: 0 });
      expect((await viewOf(b)).rows).toEqual([]);
    });

    // --- 4. a loose buy -----------------------------------------------------

    it('keeps the row for a buy made through no basket at all (test 4)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 0);
      // What the zone list page writes: a purchase that names no basket.
      const repo = dataSource.getRepository(LineSettlement);
      await repo.save(
        repo.create({
          lineId: milk.id,
          listId,
          itemId: null,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 3,
          settledByUserId: a.userId,
          settledByParticipantId: null,
          settledAt: new Date(),
          revertedAt: null,
          revertedByParticipantId: null,
          basketId: null,
          pricePaidCents: null,
          supermarketLocationId: null,
        })
      );

      // `NULL <> basket` is null and a `WHERE` reads that as false, so this is
      // the case `IS DISTINCT FROM` exists for. Both baskets see it, the
      // buyer's own included: it was not bought through that basket either.
      for (const who of [a, b]) {
        const [row] = (await viewOf(who)).rows;
        expect(row).toMatchObject({
          left: 0,
          bought: 0,
          boughtElsewhere: 3,
          state: BasketRowState.DONE,
          note: BasketRowNote.BOUGHT_ON_ANOTHER_BASKET,
        });
        expect(JSON.stringify(row)).not.toContain(a.userId);
      }
    });

    // --- 5. a partial buy ---------------------------------------------------

    it('keeps the state of today when one unit is left (test 5)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 1, 2);

      const view = await viewOf(b);
      expect(view.rows[0]).toMatchObject({
        left: 1,
        bought: 0,
        asked: 1,
        boughtElsewhere: 1,
        // Nothing bought here and one left is `WANTED`, as it always was.
        state: BasketRowState.WANTED,
        note: BasketRowNote.BOUGHT_ON_ANOTHER_BASKET,
      });
      expect(view.progress).toEqual({
        done: 0,
        unavailable: 0,
        total: 1,
        pending: 1,
      });
    });

    it('counts both baskets apart when each bought some', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 3);
      await buy(a, milk, 2, 3);
      await buy(b, milk, 1, 1);

      expect((await viewOf(a)).rows[0]).toMatchObject({
        bought: 2,
        boughtElsewhere: 1,
        asked: 2,
        state: BasketRowState.DONE,
      });
      expect((await viewOf(b)).rows[0]).toMatchObject({
        bought: 1,
        boughtElsewhere: 2,
        asked: 1,
        state: BasketRowState.DONE,
        // This basket's own act, and nobody else's.
        touchedBy: b.participantId,
      });
    });

    // --- 7. a revert from the other basket ----------------------------------

    it('refuses a revert sent from the other basket, and the purchase stands (test 7)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 2, 2);

      // A client that mistook `boughtElsewhere` for `bought` and asked for
      // those units back: this basket holds none, so the bargain is stale.
      await expect(
        revertService.revert({
          basketId: b.basket.id,
          participantId: b.participantId,
          rowKey: milk.id,
          target: 'UNITS',
          units: 2,
          from: 2,
        })
      ).rejects.toMatchObject({ code: 'stale_quantity' });

      // And one that told the truth about what this basket holds takes nothing
      // back, because the revert reads this basket's purchases alone.
      const answer = await revertService.revert({
        basketId: b.basket.id,
        participantId: b.participantId,
        rowKey: milk.id,
        target: 'UNITS',
        units: 1,
        from: 0,
      });
      expect(answer.row).toMatchObject({
        boughtElsewhere: 2,
        state: BasketRowState.DONE,
      });

      const standing = await standingOf(milk.id);
      expect(standing).toHaveLength(1);
      expect(standing[0]).toMatchObject({
        quantity: 2,
        basketId: a.basket.id,
        revertedAt: null,
      });
      expect(await quantityOf(milk.id)).toBe(0);
    });

    // --- 8. demand raised again ---------------------------------------------

    it.each([
      ['a free text row', {}],
      // The `SET` narrowing of the row resolver, which carries the hash as its
      // last parameter and so moved when the window was added.
      ['a row that names a product set', { itemSetHash: 'plan-0188-set' }],
    ])(
      'makes %s WANTED again when the other basket raises the demand (test 8)',
      async (_name, over) => {
        const { listId, a, b } = await world();
        const milk = await line(listId, a.userId, 'Milk', 2, over);
        await buy(a, milk, 2, 2);

        // The resolver finds the row the read drew. Without the same predicate
        // it answered "Row not found" here.
        const resolved = await resolver.resolve(b.basket, [listId], milk.id);
        expect(resolved.entries.map((entry) => entry.lineId)).toEqual([
          milk.id,
        ]);

        const answer = await demandService.setDemand({
          basketId: b.basket.id,
          participantId: b.participantId,
          rowKey: milk.id,
          quantity: 1,
          from: 0,
        });

        expect(answer.row).toMatchObject({
          left: 1,
          bought: 0,
          state: BasketRowState.WANTED,
          // The purchase is still recent, so the row still says so.
          boughtElsewhere: 2,
          note: BasketRowNote.BOUGHT_ON_ANOTHER_BASKET,
        });
        expect(await quantityOf(milk.id)).toBe(1);
      }
    );

    // --- 9. both kinds, and the freeze ---------------------------------------

    it('holds for a GENERATED basket, and the finish writes no trip row for it (test 9)', async () => {
      const { listId, a, b } = await world(BasketKind.GENERATED);
      const milk = await line(listId, a.userId, 'Milk', 2);
      const bread = await line(listId, a.userId, 'Bread', 1);
      await buy(a, milk, 2, 2);

      // While it is open, a trip reads the row exactly as a `LIVE` basket does.
      const open = await viewOf(b);
      expect(open.rows.map((row) => row.content).sort()).toEqual([
        'Bread',
        'Milk',
      ]);
      expect(open.rows.find((row) => row.rowKey === milk.id)).toMatchObject({
        boughtElsewhere: 2,
        state: BasketRowState.DONE,
      });

      // The freeze of plan 0135 writes this basket's own rows: the bread it
      // still asks for, and nothing for the milk it never bought.
      await dataSource.transaction(async (manager) => {
        await new BasketTripRowsService().freeze(manager, b.basket.id);
        await manager
          .getRepository(Basket)
          .update(b.basket.id, { status: BasketStatus.FINISHED });
      });
      const frozen = await dataSource
        .getRepository(BasketTripRow)
        .find({ where: { basketId: b.basket.id } });
      expect(frozen.map((row) => row.lineId)).toEqual([bread.id]);

      // And a finished basket does not read another basket's purchase: the
      // rule holds only while a basket is open.
      const finished = await dataSource
        .getRepository(Basket)
        .findOneByOrFail({ id: b.basket.id });
      const { rows } = await read.rowsOf(
        finished,
        [listId],
        BasketRedaction.unredacted([listId])
      );
      expect(rows.map((row) => row.rowKey)).toEqual([bread.id]);

      // The buyer's own trip freezes its purchase, as it always did.
      await dataSource.transaction((manager) =>
        new BasketTripRowsService().freeze(manager, a.basket.id)
      );
      const own = await dataSource
        .getRepository(BasketTripRow)
        .find({ where: { basketId: a.basket.id } });
      expect(own.map((row) => row.lineId).sort()).toEqual(
        [bread.id, milk.id].sort()
      );
    });

    // --- 10. a guest --------------------------------------------------------

    it('serves a guest the same row a member reads, and no id of the other basket (test 10)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId, 'Milk', 2);
      await buy(a, milk, 2, 2);

      const participants = dataSource.getRepository(BasketParticipant);
      const guest = await participants.save(
        participants.create({
          basketId: b.basket.id,
          shareLinkId: null,
          kind: ParticipantKind.GUEST,
          userId: null,
          displayName: 'Marta',
          username: null,
          guestNumber: 1,
          sessionSecretHash: randomUUID(),
          userAgent: null,
          joinedAt: new Date(),
          lastSeenAt: new Date(),
          revokedAt: null,
          // A link visitor always carries one (plan 0140).
          expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        })
      );

      const [asMember] = (await viewOf(b)).rows;
      const [asGuest] = (
        await read.read({ basketId: b.basket.id, participantId: guest.id })
      ).rows;

      // The one difference is the redaction that was already there: a guest is
      // not told which list an entry is on (plan 0130, section 6).
      expect(asMember.entries[0].listId).toBe(listId);
      expect('listId' in asGuest.entries[0]).toBe(false);
      expect({
        ...asGuest,
        entries: asGuest.entries.map((entry) => ({ ...entry, listId })),
      }).toEqual(asMember);

      expect(asGuest).toMatchObject({
        boughtElsewhere: 2,
        state: BasketRowState.DONE,
        note: BasketRowNote.BOUGHT_ON_ANOTHER_BASKET,
      });
      const wire = JSON.stringify(asGuest);
      expect(wire).not.toContain(a.basket.id);
      expect(wire).not.toContain(a.participantId);
      expect(wire).not.toContain(a.userId);
    });
  }
);
