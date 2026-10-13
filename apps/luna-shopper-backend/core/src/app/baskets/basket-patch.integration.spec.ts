import {
  BASKET_LIMITS,
  BasketKind,
  BasketRowState,
  BasketStatus,
  LineApprovalStatus,
  MembershipStatus,
  ParticipantKind,
  RealtimeEvent,
  SettlementOutcome,
  ZoneRole,
  ZoneStatus,
  type BasketEntryPatch,
  type BasketLinesChangedEvent,
  type BasketRowMark,
  type BasketView,
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
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { LineMergeService } from '../lists/line-merge.service';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { SettlementService } from '../lists/settlement.service';
import { ZoneAuthzService } from '../zones/zone-authz.service';
import { BasketAnnouncer } from './basket-announcer.service';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketDemandService } from './basket-demand.service';
import { BasketPatchReader, type PatchedBasket } from './basket-patch.reader';
import { BasketReadService } from './basket-read.service';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketSkipService } from './basket-skip.service';
import { BasketWriteContext } from './basket-write.context';
import { BasketChangesService } from './changes/basket-changes.service';
import { BasketMarksReader } from './changes/basket-marks.reader';
import { fakeLineClaims } from './line-claims.fake';

/** One published envelope: who it was for, and what it said. */
interface Sent {
  basketIds: readonly string[];
  userIds: readonly string[];
  payload: BasketLinesChangedEvent;
}

/**
 * What each basket is told when a line moves (plan 0204, section 8).
 *
 * Against Postgres, because a patch is the basket read narrowed to a few lines:
 * the session of a `LIVE` basket, the purchases in scope, the purchases made
 * elsewhere inside a window of the database's own clock, and the standing
 * skips. The proof that it is the same read is test 2, which compares every
 * patch with the entry a read of the same basket serves in the same test.
 *
 * Two people share one zone, as in `basket-bought-elsewhere`. Ana holds the
 * `LIVE` basket A and the `GENERATED` basket C, and Luis holds the `LIVE`
 * basket B. All three cover the one list.
 */
describeIntegration(
  'a basket event carries what moved on its lines (real Postgres)',
  () => {
    let dataSource: DataSource;
    let read: BasketReadService;
    let announcer: BasketAnnouncer;
    let settleService: BasketSettleService;
    let revertService: BasketRevertService;
    let skipService: BasketSkipService;
    let demandService: BasketDemandService;
    let settlements: SettlementService;
    let lines: LineService;
    let changes: BasketChangesService;

    const zoneIds: string[] = [];
    let position = 0;

    /** Every `basket.linesChanged` the writes published, in order. */
    const sent: Sent[] = [];
    /** Every id a payload must never hold, of every world built so far. */
    const secrets: string[] = [];
    /** The baskets whose patch is made to fail, for test 10. */
    const failing = new Set<string>();

    const events = {
      emit: () => undefined,
      emitToUsers: () => undefined,
      emitTo: (
        event: RealtimeEvent,
        audience: {
          basketIds?: readonly string[];
          userIds?: readonly string[];
        },
        payload: BasketLinesChangedEvent
      ) => {
        if (event === RealtimeEvent.BasketLinesChanged) {
          sent.push({
            basketIds: audience.basketIds ?? [],
            userIds: audience.userIds ?? [],
            payload,
          });
        }
      },
    };

    const claims = {
      claimsOf: async () => new Map(),
      claimOf: async () => ({ claimed: false, claimedByUserId: null }),
      announceReleased: async () => undefined,
      announce: () => undefined,
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
      const reader = new BasketPatchReader(baskets, fakeCoreConfig());
      announcer = new BasketAnnouncer(
        coverage,
        events as unknown as CoreEventsPublisher,
        // The real reader, behind one switch that makes a named basket fail.
        {
          entriesOf: (
            basket: PatchedBasket,
            listIds: readonly string[],
            lineIds: readonly string[]
          ) => {
            if (failing.has(basket.basketId)) {
              return Promise.reject(new Error('the patch read failed'));
            }
            return reader.entriesOf(basket, listIds, lineIds);
          },
        } as unknown as BasketPatchReader
      );
      // The failure of test 10 is logged, and the log is not what is asserted.
      (announcer as unknown as { logger: { error: () => void } }).logger = {
        error: () => undefined,
      };
      const resolver = new BasketRowResolver(baskets, fakeCoreConfig());

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

      // The real marks, because test 12 compares the marks route with a read.
      const marks = new BasketMarksReader(
        dataSource.getRepository(ListLineChange),
        fakeCoreConfig()
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
      skipService = new BasketSkipService(
        dataSource,
        context,
        claims as never,
        events as never
      );
      lines = new LineService(
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
      settlements = new SettlementService(
        dataSource,
        dataSource.getRepository(LineSettlement),
        listAccess,
        fakeLineClaims().service,
        events as never,
        announcer
      );
      changes = new BasketChangesService(
        dataSource.getRepository(ListLineChange),
        context,
        read,
        marks
      );
    });

    beforeEach(() => {
      sent.length = 0;
      failing.clear();
    });

    afterEach(() => {
      // Test 11, asked of every payload of every test: a room holds guests, so
      // a payload names no list, no zone, no account and no basket.
      for (const { payload } of sent) {
        const text = JSON.stringify(payload);
        for (const secret of secrets) {
          expect(text).not.toContain(secret);
        }
      }
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
          displayName: guest ? 'Dani' : null,
          username: guest ? null : 'Shopper',
          guestNumber: guest ? 1 : null,
          sessionSecretHash: null,
          userAgent: null,
          // A day back, so a change made in a test is one this viewer may be
          // told about: a viewer starts at the later of this and the basket.
          joinedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          lastSeenAt: new Date(),
          revokedAt: null,
          expiresAt: guest ? new Date(Date.now() + 12 * 60 * 60 * 1000) : null,
        })
      );
      return saved.id;
    }

    /** One zone, one list, and the three baskets that cover it. */
    async function world(): Promise<{
      listId: string;
      a: Shopper;
      b: Shopper;
      c: Shopper;
    }> {
      const users = { ana: randomUUID(), luis: randomUUID() };
      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Basket patches',
          joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: users.ana,
          config: {},
        })
      );
      zoneIds.push(zone.id);
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.save([
        memberships.create({
          zoneId: zone.id,
          userId: users.ana,
          username: 'Ana',
          role: ZoneRole.OWNER,
          status: MembershipStatus.APPROVED,
        }),
        memberships.create({
          zoneId: zone.id,
          userId: users.luis,
          username: 'Luis',
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
          createdByUserId: users.ana,
        })
      );

      const shopper = async (
        userId: string,
        kind: BasketKind
      ): Promise<Shopper> => {
        const repo = dataSource.getRepository(Basket);
        const basket = await repo.save(
          repo.create({
            ownerUserId: userId,
            kind,
            name: kind === BasketKind.LIVE ? null : 'Saturday',
            status: BasketStatus.OPEN,
            generatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
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
          participantId: await participant(
            basket,
            ParticipantKind.OWNER,
            userId
          ),
        };
      };

      const built = {
        listId: list.id,
        a: await shopper(users.ana, BasketKind.LIVE),
        b: await shopper(users.luis, BasketKind.LIVE),
        c: await shopper(users.ana, BasketKind.GENERATED),
      };
      secrets.push(
        zone.id,
        list.id,
        users.ana,
        users.luis,
        built.a.basket.id,
        built.b.basket.id,
        built.c.basket.id
      );
      return built;
    }

    async function line(
      listId: string,
      createdByUserId: string,
      quantity = 3,
      content = 'Milk'
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

    /**
     * Wait for the envelopes of a write.
     *
     * An announcement is not awaited by the write it follows, so its publish
     * lands after the answer. This polls for the count a test expects and then
     * waits once more, so a test that expects one envelope also learns of a
     * second that should not exist.
     */
    async function envelopes(count: number): Promise<Sent[]> {
      const deadline = Date.now() + 5000;
      while (sent.length < count && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      return [...sent];
    }

    /** The one envelope addressed to this basket. */
    function to(all: readonly Sent[], shopper: Shopper): Sent {
      const mine = all.filter((entry) =>
        entry.basketIds.includes(shopper.basket.id)
      );
      expect(mine).toHaveLength(1);
      return mine[0];
    }

    /** The patch of one line in the envelope of one basket. */
    function patchOf(
      all: readonly Sent[],
      shopper: Shopper,
      lineId: string
    ): BasketEntryPatch | undefined {
      return to(all, shopper).payload.entries?.find(
        (entry) => entry.lineId === lineId
      );
    }

    const viewOf = (shopper: Shopper, participantId = shopper.participantId) =>
      read.read({ basketId: shopper.basket.id, participantId });

    /** The entry of one line as a read of the basket serves it, as a patch. */
    function entryOf(view: BasketView, lineId: string): BasketEntryPatch {
      const entry = view.rows
        .flatMap((row) => row.entries)
        .find((candidate) => candidate.lineId === lineId);
      if (!entry) {
        throw new Error(`the read serves no entry for ${lineId}`);
      }
      const { listId: _listId, demandEditable: _editable, ...patch } = entry;
      return patch;
    }

    const settle = (who: Shopper, row: ListLine, quantity: number, from = 3) =>
      settleService.settle({
        basketId: who.basket.id,
        participantId: who.participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity,
        from,
      });

    const versionOf = async (lineId: string) =>
      (
        await dataSource
          .getRepository(ListLine)
          .findOneOrFail({ where: { id: lineId } })
      ).version;

    // --- 1 to 3: a buy and a revert through a basket ------------------------

    it('sends each covering basket what a buy reads as there (test 1)', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);

      await settle(a, milk, 1);
      const all = await envelopes(3);

      expect(all).toHaveLength(3);
      const version = await versionOf(milk.id);
      expect(patchOf(all, a, milk.id)).toMatchObject({
        left: 2,
        bought: 1,
        boughtElsewhere: 0,
        version,
        state: BasketRowState.PARTLY,
        act: {
          participantId: a.participantId,
          outcome: SettlementOutcome.BOUGHT,
        },
      });
      for (const other of [b, c]) {
        expect(patchOf(all, other, milk.id)).toMatchObject({
          left: 2,
          bought: 0,
          boughtElsewhere: 1,
          version,
          state: BasketRowState.WANTED,
          // Who bought through another basket is not this basket's to know.
          act: null,
        });
      }
      // Each envelope names its own basket and that basket's owner alone.
      expect(to(all, a).userIds).toEqual([a.userId]);
      expect(to(all, b).userIds).toEqual([b.userId]);
      expect(to(all, c).userIds).toEqual([c.userId]);
      for (const entry of all) {
        expect(entry.basketIds).toHaveLength(1);
        expect(entry.payload.marksMoved).toBeUndefined();
      }
    });

    it('sends the state a read of that basket gives, for a line bought to zero (test 2)', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);

      await settle(a, milk, 3);
      const all = await envelopes(3);

      for (const who of [a, b, c]) {
        // The whole patch, and not the state alone: a patch is the entry a
        // read of the same instant serves, less what a room may not carry.
        expect(patchOf(all, who, milk.id)).toEqual(
          entryOf(await viewOf(who), milk.id)
        );
      }
      expect(patchOf(all, a, milk.id)?.state).toBe(BasketRowState.DONE);
      expect(patchOf(all, b, milk.id)).toMatchObject({
        state: BasketRowState.DONE,
        left: 0,
        bought: 0,
        boughtElsewhere: 3,
      });
    });

    it('sends every basket the units back after a revert (test 3)', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);
      await settle(a, milk, 2);
      await envelopes(3);
      sent.length = 0;

      await revertService.revert({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        target: 'UNITS',
        units: 2,
        // What this basket bought of the row, which is what a revert starts from.
        from: 2,
      });
      const all = await envelopes(3);

      expect(all).toHaveLength(3);
      for (const who of [a, b, c]) {
        expect(patchOf(all, who, milk.id)).toMatchObject({
          left: 3,
          bought: 0,
          boughtElsewhere: 0,
          state: BasketRowState.WANTED,
          version: await versionOf(milk.id),
        });
        expect(patchOf(all, who, milk.id)).toEqual(
          entryOf(await viewOf(who), milk.id)
        );
      }
    });

    // --- 4: a skip belongs to one basket ------------------------------------

    it('tells one basket of its skip, and no other (test 4)', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);

      await skipService.skip({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
      });
      const all = await envelopes(1);

      expect(all).toHaveLength(1);
      expect(all[0].basketIds).toEqual([a.basket.id]);
      expect(patchOf(all, a, milk.id)).toMatchObject({
        skipped: true,
        closed: false,
        state: BasketRowState.SKIPPED,
        left: 3,
        act: { participantId: a.participantId, outcome: 'SKIPPED' },
      });
      expect(patchOf(all, a, milk.id)).toEqual(
        entryOf(await viewOf(a), milk.id)
      );
      // The line did not move, so the other two read what they read before.
      expect(all.some((entry) => entry.basketIds.includes(b.basket.id))).toBe(
        false
      );
      expect(all.some((entry) => entry.basketIds.includes(c.basket.id))).toBe(
        false
      );

      sent.length = 0;
      await skipService.unskip({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
      });
      const back = await envelopes(1);
      expect(back).toHaveLength(1);
      expect(patchOf(back, a, milk.id)).toMatchObject({
        skipped: false,
        state: BasketRowState.WANTED,
      });
    });

    // --- 5: a change of demand moves the marks ------------------------------

    it('says the marks moved for every basket, the acting one too (test 5)', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);

      await demandService.setDemand({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        quantity: 5,
        from: 3,
      });
      const all = await envelopes(3);

      // One envelope for each basket and not two: the demand announces through
      // the line write and adds nothing of its own.
      expect(all).toHaveLength(3);
      for (const who of [a, b, c]) {
        expect(to(all, who).payload.marksMoved).toBe(true);
        expect(patchOf(all, who, milk.id)).toMatchObject({ left: 5 });
      }
    });

    // --- 6: a buy on the list page ------------------------------------------

    it('sends entries for a buy made on the list page (test 6)', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);

      await settlements.settle({
        userId: b.userId,
        lineId: milk.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
      });
      const all = await envelopes(3);

      expect(all).toHaveLength(3);
      for (const who of [a, b, c]) {
        // Through no basket, so it is bought elsewhere for all three.
        expect(patchOf(all, who, milk.id)).toMatchObject({
          left: 2,
          bought: 0,
          boughtElsewhere: 1,
        });
        expect(patchOf(all, who, milk.id)).toEqual(
          entryOf(await viewOf(who), milk.id)
        );
      }
    });

    it('sends entries for a change of quantity on the list page, with the marks', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);

      await lines.update({ userId: b.userId, lineId: milk.id, quantity: 7 });
      const all = await envelopes(3);

      expect(all).toHaveLength(3);
      for (const who of [a, b, c]) {
        expect(to(all, who).payload.marksMoved).toBe(true);
        expect(patchOf(all, who, milk.id)).toMatchObject({ left: 7 });
      }
    });

    // --- 7: every other write sends what it sent before ----------------------

    it('sends one envelope with the ids alone for an add (test 7)', async () => {
      const { listId, a, b, c } = await world();

      const { line: added } = await lines.add({
        userId: a.userId,
        listId,
        content: 'Bread',
      });
      const all = await envelopes(1);

      expect(all).toHaveLength(1);
      expect(all[0].payload).toEqual({ lineIds: [added.id] });
      expect([...all[0].basketIds].sort()).toEqual(
        [a.basket.id, b.basket.id, c.basket.id].sort()
      );
    });

    it('sends the ids alone for an edit that names more than the quantity', async () => {
      const { listId, a } = await world();
      const milk = await line(listId, a.userId);

      await lines.update({
        userId: a.userId,
        lineId: milk.id,
        quantity: 4,
        content: 'MILK',
      });
      const all = await envelopes(1);

      expect(all).toHaveLength(1);
      expect(all[0].payload).toEqual({ lineIds: [milk.id] });
    });

    // --- 8: a line that left the basket --------------------------------------

    it('names a line that left the basket and sends no patch for it (test 8)', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);

      // Taken to zero with nothing bought, so it is no row of any basket.
      await demandService.setDemand({
        basketId: a.basket.id,
        participantId: a.participantId,
        rowKey: milk.id,
        quantity: 0,
        from: 3,
      });
      const all = await envelopes(3);

      for (const who of [a, b, c]) {
        expect(to(all, who).payload.lineIds).toEqual([milk.id]);
        expect(to(all, who).payload.entries).toEqual([]);
        const view = await viewOf(who);
        expect(
          view.rows
            .flatMap((row) => row.entries)
            .some((entry) => entry.lineId === milk.id)
        ).toBe(false);
      }
    });

    // --- 9 and 10: when the ids go alone -------------------------------------

    it('sends the ids alone for a write over the bound (test 9)', async () => {
      const { listId, a, b, c } = await world();
      const many: string[] = [];
      for (let at = 0; at <= BASKET_LIMITS.patchMaxLines; at += 1) {
        many.push((await line(listId, a.userId, 1, `Thing ${at}`)).id);
      }

      await announcer.linesMoved(listId, many);
      const all = await envelopes(1);

      expect(many).toHaveLength(26);
      expect(all).toHaveLength(1);
      expect(all[0].payload).toEqual({ lineIds: many });
      expect([...all[0].basketIds].sort()).toEqual(
        [a.basket.id, b.basket.id, c.basket.id].sort()
      );
    });

    it('sends the ids to a basket whose patch failed, and entries to the others (test 10)', async () => {
      const { listId, a, b, c } = await world();
      const milk = await line(listId, a.userId);
      failing.add(b.basket.id);

      await settle(a, milk, 1);
      const all = await envelopes(3);

      expect(all).toHaveLength(3);
      expect(to(all, b).payload).toEqual({ lineIds: [milk.id] });
      expect(patchOf(all, a, milk.id)).toMatchObject({ bought: 1, left: 2 });
      expect(patchOf(all, c, milk.id)).toMatchObject({
        boughtElsewhere: 1,
        left: 2,
      });
    });

    // --- 12: the marks alone -------------------------------------------------

    it('answers a member and a guest the marks a full read gives them (test 12)', async () => {
      const { listId, a, b } = await world();
      const milk = await line(listId, a.userId);
      const eggs = await line(listId, a.userId, 1, 'Eggs');
      const guestId = await participant(
        a.basket,
        ParticipantKind.GUEST,
        null
      );

      // Luis changes one line and adds another, on the list page. Both are
      // changes that the people of Ana's basket have not seen.
      await lines.update({ userId: b.userId, lineId: milk.id, quantity: 6 });
      const { line: bread } = await lines.add({
        userId: b.userId,
        listId,
        content: 'Bread',
      });
      await envelopes(4);

      for (const participantId of [a.participantId, guestId]) {
        const view = await viewOf(a, participantId);
        const answer = await changes.marksOf({
          basketId: a.basket.id,
          participantId,
        });

        const fromRead = new Map<string, BasketRowMark>();
        for (const row of view.rows) {
          if (row.mark && row.state !== BasketRowState.REMOVED) {
            for (const entry of row.entries) {
              fromRead.set(entry.lineId, row.mark);
            }
          }
        }
        expect(
          new Map(answer.lines.map((entry) => [entry.lineId, entry.mark]))
        ).toEqual(fromRead);
        expect(answer.unseenChangeCount).toBe(view.unseenChangeCount);
        expect(answer.newestUnseenChangeId).toBe(view.newestUnseenChangeId);

        expect(answer.unseenChangeCount).toBe(2);
        expect(fromRead.get(milk.id)).toBe('CHANGED');
        expect(fromRead.get(bread.id)).toBe('ADDED');
        expect(fromRead.has(eggs.id)).toBe(false);
        // The marks name lines and nothing about where they are.
        expect(JSON.stringify(answer)).not.toContain(listId);
      }

      // Luis made both changes, so his own basket marks neither.
      const own = await changes.marksOf({
        basketId: b.basket.id,
        participantId: b.participantId,
      });
      expect(own).toEqual({
        unseenChangeCount: 0,
        newestUnseenChangeId: null,
        lines: [],
      });
    });
  }
);
