import {
  BASKET_CHANGE_LIMITS,
  BasketKind,
  BasketRowMark,
  BasketRowState,
  GeneratedListStatus,
  LineApprovalStatus,
  LineChangeKind,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
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
  BasketSource,
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListParticipant,
  ListLine,
  ListLineChange,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../../entities';
import { ListLineChangeSweepService } from '../../lists/changes/list-line-change-sweep.service';
import { CHANGE_MARK_WINDOW_MS, fakeCoreConfig } from '../basket-config.fake';
import { BasketCoverageService } from '../basket-coverage.service';
import { BasketReadService } from '../basket-read.service';
import { BasketRedaction } from '../basket-redaction';
import { BasketRevertService } from '../basket-revert.service';
import { BasketRowResolver } from '../basket-row-resolver';
import { BasketSettleService } from '../basket-settle.service';
import { BasketSkipService } from '../basket-skip.service';
import { BasketWriteContext } from '../basket-write.context';
import { BasketChangesService } from './basket-changes.service';
import { BasketMarksReader } from './basket-marks.reader';

/**
 * What one viewer is told has changed, against real Postgres (plan 0138, section
 * 13, tests 5 to 15).
 *
 * **Every rule here is a comparison of database times**, which is the reason none
 * of it can be asserted anywhere else: whether a change is unseen, whether an
 * acknowledged one is still lingering, whether a row is old enough to sweep. The
 * clock is moved by writing `ackedAt` and `createdAt`, never by waiting and never
 * by faking a timer, because the values under test are `now()` inside a statement.
 *
 * The changes are seeded with `INSERT` rather than by driving writes. What each
 * write records is `line-change.integration.spec.ts`; this file is about what a
 * reader is then told, and seeding the rows is what lets it put one three weeks in
 * the past.
 */
describeIntegration(
  'what changed, as one viewer reads it (real Postgres)',
  () => {
    let dataSource: DataSource;
    let read: BasketReadService;
    let changes: BasketChangesService;
    let marks: BasketMarksReader;
    let settleService: BasketSettleService;
    let revertService: BasketRevertService;
    let skipService: BasketSkipService;

    const ids = { zone: '', owner: randomUUID(), other: randomUUID() };
    let position = 0;

    /** Which lists a reader is told about, rewritten per test. */
    let writable: Set<string> = new Set();

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('CORE_DB_URL'),
        entities: CORE_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();

      const baskets = dataSource.getRepository(GeneratedList);
      const coverage = new BasketCoverageService(baskets);
      const resolver = new BasketRowResolver(baskets, fakeCoreConfig());
      marks = new BasketMarksReader(
        dataSource.getRepository(ListLineChange),
        fakeCoreConfig()
      );

      // The three methods the read and the context ask of sharing. `writable` is
      // per test, because the redaction is what tests 13 asserts.
      const sharing = {
        writableAmong: async (_userId: string, listIds: readonly string[]) =>
          new Set(listIds.filter((listId) => writable.has(listId))),
        liveParticipantById: async (participantId: string) =>
          dataSource
            .getRepository(GeneratedListParticipant)
            .findOne({ where: { id: participantId } }),
        listParticipants: async ({
          generatedListId,
        }: {
          generatedListId: string;
        }) => ({
          participants: (
            await dataSource
              .getRepository(GeneratedListParticipant)
              .find({ where: { generatedListId, revokedAt: IsNull() } })
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

      const listAccess = {
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
      } as never;

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
        read
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
        announce: () => undefined,
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
        events
      );
      revertService = new BasketRevertService(
        dataSource,
        context,
        claims,
        events
      );
      skipService = new BasketSkipService(dataSource, context, claims, events);

      const zones = dataSource.getRepository(Zone);
      const zone = await zones.save(
        zones.create({
          name: 'Basket changes',
          joinCode: `BC${Date.now()}`.slice(0, 16),
          status: ZoneStatus.ACTIVE,
          ownerUserId: ids.owner,
          config: {},
        })
      );
      ids.zone = zone.id;
      const memberships = dataSource.getRepository(ZoneMembership);
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
      writable = new Set([...writable, saved.id]);
      return saved.id;
    }

    async function line(
      listId: string,
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
          createdByUserId: ids.owner,
          approvalStatus: LineApprovalStatus.APPROVED,
        })
      );
    }

    /**
     * A basket covering the named lists, with the owner's participant row.
     *
     * `joinedAt` and `generatedAt` are both arguments, because where a viewer
     * **starts** is the later of the two and test 5 is about exactly that.
     */
    async function basket(
      listIds: string[],
      options: {
        generatedAt?: Date;
        joinedAt?: Date;
        userId?: string | null;
        kind?: ParticipantKind;
      } = {}
    ): Promise<{ basket: GeneratedList; participantId: string }> {
      const repo = dataSource.getRepository(GeneratedList);
      const saved = await repo.save(
        repo.create({
          ownerUserId: ids.owner,
          kind: BasketKind.GENERATED,
          name: 'Saturday',
          status: GeneratedListStatus.OPEN,
          // A day back by default, so a seeded change is inside the window a
          // viewer may be told about: `start` is the later of these two, and a
          // change before it is not theirs to see.
          generatedAt:
            options.generatedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000),
          idempotencyKey: null,
        })
      );
      const sources = dataSource.getRepository(BasketSource);
      for (const listId of listIds) {
        await sources.save(
          sources.create({ basketId: saved.id, zoneId: ids.zone, listId })
        );
      }
      const participants = dataSource.getRepository(GeneratedListParticipant);
      const kind = options.kind ?? ParticipantKind.OWNER;
      const participant = await participants.save(
        participants.create({
          generatedListId: saved.id,
          shareLinkId: null,
          kind,
          userId:
            options.userId === undefined
              ? kind === ParticipantKind.GUEST
                ? null
                : ids.owner
              : options.userId,
          displayName: kind === ParticipantKind.GUEST ? 'Dani' : null,
          username: kind === ParticipantKind.GUEST ? null : 'Owner',
          guestNumber: kind === ParticipantKind.GUEST ? 1 : null,
          sessionSecretHash: null,
          userAgent: null,
          joinedAt:
            options.joinedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000),
          lastSeenAt: new Date(),
          revokedAt: null,
          // A link visitor always carries one and the owner never does, which
          // plan 0140's `ck_generated_list_participants_expiry` holds.
          expiresAt:
            kind === ParticipantKind.OWNER
              ? null
              : new Date(Date.now() + 12 * 60 * 60 * 1000),
        })
      );
      return { basket: saved, participantId: participant.id };
    }

    /**
     * One change row, written straight in.
     *
     * `ago` moves its `createdAt` into the past **in the database**, which is what
     * lets one test put a change three weeks back without anybody's clock being
     * involved.
     */
    async function change(
      listId: string,
      lineId: string,
      over: {
        kind?: LineChangeKind;
        ago?: string;
        contentBefore?: string | null;
        contentAfter?: string | null;
        quantityBefore?: number | null;
        quantityAfter?: number | null;
        approvalBefore?: LineApprovalStatus | null;
        approvalAfter?: LineApprovalStatus | null;
        mergedIntoLineId?: string | null;
        actorUserId?: string | null;
        actorParticipantId?: string | null;
        basketId?: string | null;
      } = {}
    ): Promise<string> {
      const [row] = (await dataSource.query(
        `INSERT INTO "list_line_changes" (
         "createdAt", "zoneId", "listId", "lineId", "kind",
         "contentBefore", "contentAfter", "quantityBefore", "quantityAfter",
         "approvalBefore", "approvalAfter", "mergedIntoLineId",
         "actorUserId", "actorParticipantId", "basketId"
       ) VALUES (
         now() - ($1::text)::interval, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
       ) RETURNING "id"`,
        [
          over.ago ?? '0 seconds',
          ids.zone,
          listId,
          lineId,
          over.kind ?? LineChangeKind.QUANTITY_CHANGED,
          over.contentBefore ?? null,
          over.contentAfter ?? null,
          over.quantityBefore ?? null,
          over.quantityAfter ?? null,
          over.approvalBefore ?? null,
          over.approvalAfter ?? null,
          over.mergedIntoLineId ?? null,
          over.actorUserId ?? null,
          over.actorParticipantId ?? null,
          over.basketId ?? null,
        ]
      )) as { id: string }[];
      return row.id;
    }

    /** The basket as one participant reads it, marks and all. */
    async function view(held: GeneratedList, participantId: string) {
      const participant = await dataSource
        .getRepository(GeneratedListParticipant)
        .findOneByOrFail({ id: participantId });
      return read.view(held, participant);
    }

    /** The cursor row, read as text so nothing loses its microseconds. */
    async function cursorOf(participantId: string, changeId: string) {
      const [row] = (await dataSource.query(
        `SELECT c."seenFrom"::text AS "seenFrom",
              c."seenThrough"::text AS "seenThrough",
              c."ackedAt"::text AS "ackedAt",
              (c."seenThrough" = ch."createdAt") AS "matchesChange"
       FROM "basket_change_cursors" c
       LEFT JOIN "list_line_changes" ch ON ch.id = $2::uuid
       WHERE c."participantId" = $1::uuid`,
        [participantId, changeId]
      )) as {
        seenFrom: string;
        seenThrough: string;
        ackedAt: string;
        matchesChange: boolean | null;
      }[];
      return row;
    }

    /** Move this viewer's acknowledgement into the past, by the database's clock. */
    async function ackedAgo(participantId: string, ago: string): Promise<void> {
      await dataSource.query(
        `UPDATE "basket_change_cursors"
       SET "ackedAt" = now() - ($2::text)::interval
       WHERE "participantId" = $1::uuid`,
        [participantId, ago]
      );
    }

    // --- 5. where a viewer starts --------------------------------------------

    describe('a viewer with no cursor (test 5)', () => {
      it('sees every change since they joined, and none from before it', async () => {
        const listId = await list('Since joining');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId], {
          generatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          joinedAt: new Date(Date.now() - 60 * 60 * 1000),
        });
        // Before they joined, and after the basket was made: the later of the two
        // decides, so this one is not theirs to be told about.
        await change(listId, milk.id, { ago: '2 hours' });
        const since = await change(listId, milk.id, { ago: '30 minutes' });

        const drawn = await view(held, participantId);

        expect(drawn.unseenChangeCount).toBe(1);
        expect(drawn.newestUnseenChangeId).toBe(since);
        expect(drawn.rows[0].mark).toBe(BasketRowMark.CHANGED);
      });

      it('starts at the basket for an owner whose row is older than it', async () => {
        const listId = await list('Since the basket');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId], {
          generatedAt: new Date(Date.now() - 60 * 60 * 1000),
          joinedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        });
        await change(listId, milk.id, { ago: '2 hours' });

        const drawn = await view(held, participantId);

        expect(drawn.unseenChangeCount).toBe(0);
        expect(drawn.newestUnseenChangeId).toBeNull();
        expect(drawn.rows[0].mark).toBeNull();
      });
    });

    // --- 6, 7, 8, 9. the acknowledgement -------------------------------------

    describe('acknowledging (tests 6 to 9)', () => {
      it('moves the cursor to the change’s own time, microseconds intact', async () => {
        const listId = await list('Acknowledged');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        const first = await change(listId, milk.id, { ago: '10 minutes' });

        const answered = await changes.acknowledge({
          basketId: held.id,
          participantId,
          through: first,
        });

        const cursor = await cursorOf(participantId, first);
        // Compared **in the database**, which is the whole point: a `Date` in
        // JavaScript is milliseconds and a `timestamptz` is microseconds.
        expect(cursor.matchesChange).toBe(true);
        expect(answered.unseenChangeCount).toBe(0);
        expect(answered.marksLapseInMs).toBe(CHANGE_MARK_WINDOW_MS);
      });

      it('shifts the old value into seenFrom, so the marks linger', async () => {
        const listId = await list('Lingering');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        const first = await change(listId, milk.id, { ago: '20 minutes' });
        const second = await change(listId, milk.id, { ago: '10 minutes' });

        await changes.acknowledge({
          basketId: held.id,
          participantId,
          through: first,
        });
        const before = await cursorOf(participantId, first);
        await changes.acknowledge({
          basketId: held.id,
          participantId,
          through: second,
        });
        const after = await cursorOf(participantId, second);

        expect(after.seenFrom).toBe(before.seenThrough);
        expect(after.matchesChange).toBe(true);
      });

      it('keeps a change marked for the window after it was acknowledged (test 7)', async () => {
        const listId = await list('Nine minutes');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        const only = await change(listId, milk.id, { ago: '3 hours' });

        await changes.acknowledge({
          basketId: held.id,
          participantId,
          through: only,
        });

        // The window runs from **the acknowledgement**, not from the change: a
        // phone in a pocket for three hours acknowledges nothing, and the mark is
        // there when it comes out.
        await ackedAgo(participantId, '9 minutes');
        const marked = await view(held, participantId);
        expect(marked.rows[0].mark).toBe(BasketRowMark.CHANGED);
        // ...and it is unseen no longer, so the banner says nothing.
        expect(marked.unseenChangeCount).toBe(0);

        await ackedAgo(participantId, '11 minutes');
        expect((await view(held, participantId)).rows[0].mark).toBeNull();
      });

      it('writes nothing for a through at or before the cursor (test 8)', async () => {
        const listId = await list('Idempotent');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        const first = await change(listId, milk.id, { ago: '20 minutes' });
        const second = await change(listId, milk.id, { ago: '10 minutes' });

        await changes.acknowledge({
          basketId: held.id,
          participantId,
          through: second,
        });
        const after = await cursorOf(participantId, second);
        // The older one, as a second phone of the same account would send it.
        await changes.acknowledge({
          basketId: held.id,
          participantId,
          through: first,
        });

        const again = await cursorOf(participantId, second);
        expect(again.seenThrough).toBe(after.seenThrough);
        expect(again.seenFrom).toBe(after.seenFrom);
        // A cursor never moves backwards, so nothing it had acknowledged comes back.
        expect(again.matchesChange).toBe(true);
      });

      it('refuses a through from a list the basket does not cover (test 9)', async () => {
        const covered = await list('Covered');
        const outside = await list('Outside');
        const milk = await line(covered, 'Milk');
        const other = await line(outside, 'Bread');
        const { basket: held, participantId } = await basket([covered]);
        const elsewhere = await change(outside, other.id);
        await change(covered, milk.id);

        await expect(
          changes.acknowledge({
            basketId: held.id,
            participantId,
            through: elsewhere,
          })
        ).rejects.toMatchObject({ code: 'not_found' });
      });

      it('refuses a through older than the retention', async () => {
        const listId = await list('Too old to acknowledge');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        const ancient = await change(listId, milk.id, { ago: '40 days' });

        // No read serves it, so there is nothing for a client to have drawn.
        await expect(
          changes.acknowledge({
            basketId: held.id,
            participantId,
            through: ancient,
          })
        ).rejects.toMatchObject({ code: 'not_found' });
      });
    });

    // --- 10. a viewer's own change -------------------------------------------

    describe('a viewer’s own change (test 10)', () => {
      it('is neither counted nor marked, by participant or by account', async () => {
        const listId = await list('My own');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        // One made through this basket by this participant, one made by the same
        // account from its own list page.
        await change(listId, milk.id, {
          actorParticipantId: participantId,
          basketId: held.id,
          actorUserId: ids.owner,
        });
        await change(listId, milk.id, { actorUserId: ids.owner });

        const drawn = await view(held, participantId);

        expect(drawn.unseenChangeCount).toBe(0);
        expect(drawn.rows[0].mark).toBeNull();
      });

      it('is still listed by the changes view, which is a history', async () => {
        const listId = await list('My own, listed');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        const mine = await change(listId, milk.id, { actorUserId: ids.owner });

        const page = await changes.list({ basketId: held.id, participantId });

        expect(page.items.map((item) => item.id)).toEqual([mine]);
        expect(page.items[0].rowKey).toBe(milk.id);
      });
    });

    // --- 11 and 12. a line that left the basket ------------------------------

    describe('a line that left the basket (tests 11 and 12)', () => {
      it('is one disabled row that counts toward nothing', async () => {
        const listId = await list('Removed');
        const olives = await line(listId, 'Olives', 2);
        // A second line, so `progress` has something to count and the removed row
        // can be shown not to be in it.
        await line(listId, 'Milk', 1);
        const { basket: held, participantId } = await basket([listId]);
        await dataSource.getRepository(ListLine).softDelete({ id: olives.id });
        await change(listId, olives.id, {
          kind: LineChangeKind.DELETED,
          contentBefore: 'Olives',
          quantityBefore: 2,
        });

        const drawn = await view(held, participantId);

        const removed = drawn.rows.find(
          (row) => row.state === BasketRowState.REMOVED
        );
        expect(removed).toMatchObject({
          rowKey: olives.id,
          content: 'Olives',
          left: 0,
          mark: BasketRowMark.REMOVED,
          entries: [],
        });
        // It counts toward neither `progress` nor `pending`: only Milk does.
        expect(drawn.progress).toMatchObject({ total: 1, pending: 1, done: 0 });
      });

      it('marks the covered row instead when another household shares its name', async () => {
        const flat = await list('Flat');
        const parents = await list('Parents');
        const theirs = await line(parents, 'Milk', 1);
        const ours = await line(flat, 'Milk', 1);
        const { basket: held, participantId } = await basket([flat, parents]);
        await dataSource.getRepository(ListLine).softDelete({ id: theirs.id });
        await change(parents, theirs.id, {
          kind: LineChangeKind.DELETED,
          contentBefore: 'Milk',
        });

        const drawn = await view(held, participantId);

        expect(drawn.rows).toHaveLength(1);
        expect(drawn.rows[0].rowKey).toBe(ours.id);
        expect(drawn.rows[0].mark).toBe(BasketRowMark.CHANGED);
      });

      it('removes a row whose demand was set to zero, and not one bought to zero', async () => {
        const listId = await list('Zeroes');
        const zeroed = await line(listId, 'Capers', 2);
        const bought = await line(listId, 'Bread', 2);
        const { basket: held, participantId } = await basket([listId]);

        // Bought to zero **in this basket**, so the line is still covered (plan
        // 0130, section 3) and the row stays, so the revert has something to be
        // pressed on.
        await settleService.settle({
          basketId: held.id,
          participantId,
          rowKey: bought.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 2,
          from: 2,
        });
        // Set to zero by somebody, which takes it out of the basket.
        await dataSource
          .getRepository(ListLine)
          .update({ id: zeroed.id }, { quantity: 0 });
        await change(listId, zeroed.id, {
          quantityBefore: 2,
          quantityAfter: 0,
        });
        await change(listId, bought.id, {
          quantityBefore: 2,
          quantityAfter: 2,
          kind: LineChangeKind.RENAMED,
          contentBefore: 'Bread',
          contentAfter: 'Bread',
        });

        const drawn = await view(held, participantId);

        const removed = drawn.rows.filter(
          (row) => row.state === BasketRowState.REMOVED
        );
        expect(removed.map((row) => row.rowKey)).toEqual([zeroed.id]);
        const done = drawn.rows.find((row) => row.rowKey === bought.id);
        expect(done?.state).toBe(BasketRowState.DONE);
      });

      it('keeps what the basket bought of the line that went', async () => {
        const listId = await list('Removed but bought');
        const olives = await line(listId, 'Olives', 2);
        const { basket: held, participantId } = await basket([listId]);
        await settleService.settle({
          basketId: held.id,
          participantId,
          rowKey: olives.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          from: 2,
        });
        await dataSource.getRepository(ListLine).softDelete({ id: olives.id });
        await change(listId, olives.id, {
          kind: LineChangeKind.DELETED,
          contentBefore: 'Olives',
        });

        const [removed] = (await view(held, participantId)).rows.filter(
          (row) => row.state === BasketRowState.REMOVED
        );
        expect(removed.bought).toBe(1);
        expect(removed.asked).toBe(1);
      });
    });

    // --- 13. redaction -------------------------------------------------------

    describe('what a reader may know (test 13)', () => {
      it('serves a guest no list and no account', async () => {
        const listId = await list('Guest reads');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId], {
          kind: ParticipantKind.GUEST,
          userId: null,
        });
        await change(listId, milk.id, { actorUserId: ids.other });

        const page = await changes.list({ basketId: held.id, participantId });

        expect(page.items).toHaveLength(1);
        expect('listId' in page.items[0]).toBe(false);
        expect(page.items[0].actor).toBeNull();
      });

      it('serves a named person their own list alone', async () => {
        const mine = await list('Mine');
        const theirs = await list('Theirs');
        const here = await line(mine, 'Milk');
        const there = await line(theirs, 'Bread');
        const { basket: held, participantId } = await basket([mine, theirs]);
        // Only one of the two is writable by this reader.
        writable = new Set([mine]);
        await change(mine, here.id, { actorUserId: ids.other });
        await change(theirs, there.id, { actorUserId: ids.other });

        const page = await changes.list({ basketId: held.id, participantId });
        writable = new Set([mine, theirs]);

        const served = page.items.filter((item) => item.listId !== undefined);
        expect(served).toHaveLength(1);
        expect(served[0].listId).toBe(mine);
        expect(served[0].actor).toEqual({ userId: ids.other });
        // The other one names neither the list nor the person.
        const withheld = page.items.find((item) => item.listId === undefined);
        expect(withheld?.actor).toBeNull();
      });

      it('names a participant of this basket to a guest', async () => {
        const listId = await list('Participants are public');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId], {
          kind: ParticipantKind.GUEST,
          userId: null,
        });
        await change(listId, milk.id, {
          actorParticipantId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          basketId: held.id,
          actorUserId: ids.other,
        });

        const page = await changes.list({ basketId: held.id, participantId });

        // Everybody on a basket already sees its people.
        expect(page.items[0].actor).toEqual({
          participantId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        });
      });
    });

    // --- 14. the cap and the paging -----------------------------------------

    describe('the cap and the paging (test 14)', () => {
      it('stops counting at the cap', async () => {
        const listId = await list('Three weeks away');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        await dataSource.query(
          `INSERT INTO "list_line_changes"
           ("zoneId", "listId", "lineId", "kind", "quantityBefore", "quantityAfter")
         SELECT $1, $2, $3, 'QUANTITY_CHANGED', 1, 2
         FROM generate_series(1, $4::int)`,
          [ids.zone, listId, milk.id, BASKET_CHANGE_LIMITS.countCap + 40]
        );

        const drawn = await view(held, participantId);

        expect(drawn.unseenChangeCount).toBe(BASKET_CHANGE_LIMITS.countCap);
        // And the row is still marked once, however many changes it took.
        expect(drawn.rows[0].mark).toBe(BasketRowMark.CHANGED);
      });

      it('pages across two changes that share a createdAt, visiting each once', async () => {
        const listId = await list('Tied times');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId]);
        // One statement, so both rows carry the transaction's start.
        await dataSource.query(
          `INSERT INTO "list_line_changes"
           ("zoneId", "listId", "lineId", "kind", "quantityBefore", "quantityAfter")
         SELECT $1, $2, $3, 'QUANTITY_CHANGED', 1, 2
         FROM generate_series(1, 2)`,
          [ids.zone, listId, milk.id]
        );

        const first = await changes.list({
          basketId: held.id,
          participantId,
          limit: 1,
        });
        expect(first.items).toHaveLength(1);
        expect(first.nextCursor).not.toBeNull();
        const second = await changes.list({
          basketId: held.id,
          participantId,
          limit: 1,
          cursor: first.nextCursor as string,
        });

        // The id is the tie break, in SQL, so neither row is skipped or repeated.
        expect(second.items).toHaveLength(1);
        expect(second.items[0].id).not.toBe(first.items[0].id);
        expect(second.nextCursor).toBeNull();
      });
    });

    // --- 15. the sweep -------------------------------------------------------

    describe('the retention sweep (test 15)', () => {
      it('deletes what is past the retention, oldest first and in batches', async () => {
        const listId = await list('Swept');
        const milk = await line(listId, 'Milk');
        // The sweep walks the **whole table**, oldest first, so the other tests'
        // stale rows would take this one's batch. Cleared first, which is what makes
        // the batch observable at all.
        await dataSource.query(
          `DELETE FROM "list_line_changes"
         WHERE "createdAt" < now() - interval '30 days'`
        );
        const old = [
          await change(listId, milk.id, { ago: '40 days' }),
          await change(listId, milk.id, { ago: '35 days' }),
        ];
        const young = await change(listId, milk.id, { ago: '1 hour' });

        const sweep = new ListLineChangeSweepService(
          dataSource.getRepository(ListLineChange),
          { error: () => undefined, log: () => undefined } as never,
          // One row per tick, so the batch is observable.
          {
            getOrThrow: () => ({
              listLineChange: {
                retentionMs: 30 * 24 * 60 * 60 * 1000,
                sweep: { enabled: false, intervalMs: 3600_000, batchSize: 1 },
              },
            }),
          } as never
        );

        expect(await sweep.sweep()).toBe(1);
        const left = await dataSource
          .getRepository(ListLineChange)
          .find({ where: { listId } });
        // The oldest went first.
        expect(left.map((row) => row.id).sort()).toEqual(
          [old[1], young].sort()
        );
        expect(await sweep.sweep()).toBe(1);
        expect(await sweep.sweep()).toBe(0);
      });

      it('serves a row past the retention to neither read before the sweep reaches it', async () => {
        const listId = await list('Invisible already');
        const milk = await line(listId, 'Milk');
        const { basket: held, participantId } = await basket([listId], {
          generatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          joinedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        });
        await change(listId, milk.id, { ago: '40 days' });

        const drawn = await view(held, participantId);
        const page = await changes.list({ basketId: held.id, participantId });

        // Both reads filter the retention themselves, so no screen depends on
        // whether a timer fired.
        expect(drawn.unseenChangeCount).toBe(0);
        expect(drawn.rows[0].mark).toBeNull();
        expect(page.items).toEqual([]);
      });
    });

    // --- what a purchase, a revert and a skip record ------------------------

    describe('a purchase records no change', () => {
      it('writes none for a settle, a revert or a skip', async () => {
        const listId = await list('Shopping');
        const milk = await line(listId, 'Milk', 2);
        const { basket: held, participantId } = await basket([listId]);

        await settleService.settle({
          basketId: held.id,
          participantId,
          rowKey: milk.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          from: 2,
        });
        await revertService.revert({
          basketId: held.id,
          participantId,
          rowKey: milk.id,
          target: 'UNITS',
          units: 1,
          from: 1,
        });
        await skipService.skip({
          basketId: held.id,
          participantId,
          rowKey: milk.id,
        });
        await skipService.unskip({
          basketId: held.id,
          participantId,
          rowKey: milk.id,
        });

        // A shopper buying a thing, taking that back, and putting it off is not
        // the household changing what it asked for (plan 0130, section 11).
        expect(
          await dataSource
            .getRepository(ListLineChange)
            .find({ where: { listId } })
        ).toEqual([]);
        expect((await view(held, participantId)).rows[0].mark).toBeNull();
      });
    });

    // --- the unredacted reads ------------------------------------------------

    describe('a read with no viewer', () => {
      it('marks nothing and draws no removed row', async () => {
        // The history counts, the admin detail and the finish read the rows to
        // count or freeze them. There is nobody to measure, so inventing a viewer
        // would be a lie in whichever direction it was pointed.
        const listId = await list('No viewer');
        const olives = await line(listId, 'Olives', 2);
        const { basket: held } = await basket([listId]);
        await dataSource.getRepository(ListLine).softDelete({ id: olives.id });
        await change(listId, olives.id, {
          kind: LineChangeKind.DELETED,
          contentBefore: 'Olives',
        });

        const { rows, marks: answered } = await read.rowsOf(
          held,
          [listId],
          BasketRedaction.unredacted([listId])
        );

        expect(rows).toEqual([]);
        expect(answered.unseenChangeCount).toBe(0);
        expect(answered.removed).toEqual([]);
      });
    });
  }
);
