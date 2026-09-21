import {
  BasketKind,
  BasketRowNote,
  BasketRowState,
  GeneratedListStatus,
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
  ParticipantKind,
  RealtimeEvent,
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
  BasketLineSkip,
  BasketSource,
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListParticipant,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { LineClaimService } from '../generated-lists/line-claim.service';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { LineChangeRecorder } from '../lists/changes/line-change.recorder';
import { LineMergeService } from '../lists/line-merge.service';
import { BasketAnnouncer } from './basket-announcer.service';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import { BasketRedaction } from './basket-redaction';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketSkipService } from './basket-skip.service';
import { BasketWriteContext } from './basket-write.context';
import { fakeBasketMarks } from './changes/basket-marks.fake';

/**
 * The **real** announcer, wired to the same publisher fake the rest of this file
 * asserts through (plan 0139, section 3).
 *
 * A skip is the one write that announces to its own basket and to no other, so
 * the event it publishes is part of what this file proves rather than a nudge to
 * be stubbed out. It is built in `beforeAll`, because it needs the coverage
 * service and therefore the database.
 */
let announcer: BasketAnnouncer;

/**
 * A line skipped for now (plan 0137, section 10, tests 6 to 15).
 *
 * Against Postgres, because almost every rule here is a `WHERE`: a skip stands
 * while no later settlement of the same basket does, the window is compared
 * against the database's `now()`, the claim is a join over five tables, and a
 * merge moves rows a foreign key would otherwise cascade away. None of those is
 * a fact about a spy.
 *
 * The clock is the point of tests 12 and 14 in particular. Nothing here moves a
 * system time: a stale skip is written with a `skippedAt` in the past and the
 * database is asked what it makes of it, which is the property the production
 * read relies on.
 */
describeIntegration('skipping a basket row (real Postgres)', () => {
  let dataSource: DataSource;
  let skipService: BasketSkipService;
  let settleService: BasketSettleService;
  let revertService: BasketRevertService;
  let read: BasketReadService;
  let claims: LineClaimService;
  let merges: LineMergeService;

  const ids = { zone: '', shopper: randomUUID() };
  let position = 0;

  /** Every event the writes emit, so a test can assert one was announced. */
  const emitted: { event: string; payload: unknown }[] = [];
  const events = {
    emit: (event: string, _zoneId: string, payload: unknown) =>
      emitted.push({ event, payload }),
    emitTo: (event: string, _audience: unknown, payload: unknown) =>
      emitted.push({ event, payload }),
    emitToUsers: (event: string, _users: string[], payload: unknown) =>
      emitted.push({ event, payload }),
  };

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
    announcer = new BasketAnnouncer(
      coverage,
      events as unknown as CoreEventsPublisher
    );
    const resolver = new BasketRowResolver(baskets, fakeCoreConfig());

    const sharing = {
      writableAmong: async (_userId: string, listIds: readonly string[]) =>
        new Set(listIds),
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
      // Nothing here is about what changed since somebody looked (plan 0138),
      // and every read below passes no viewer, so the marks are never asked for.
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
    // The **real** claim service, which is the point of test 13: what the claim
    // says is a join over five tables and the fragment this plan added to it.
    claims = new LineClaimService(
      dataSource,
      events as never,
      fakeCoreConfig()
    );
    skipService = new BasketSkipService(
      dataSource,
      context,
      claims,
      events as never
    );
    settleService = new BasketSettleService(
      dataSource,
      baskets,
      context,
      claims,
      events as never
    );
    revertService = new BasketRevertService(
      dataSource,
      context,
      claims,
      events as never
    );
    merges = new LineMergeService(new LineChangeRecorder());

    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Basket skips',
        joinCode: `BK${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.shopper,
        config: {},
      })
    );
    ids.zone = zone.id;
    const memberships = dataSource.getRepository(ZoneMembership);
    await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: ids.shopper,
        username: 'Shopper',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
  });

  beforeEach(() => {
    emitted.length = 0;
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
      repo.create({ zoneId: ids.zone, name, createdByUserId: ids.shopper })
    );
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
        createdByUserId: ids.shopper,
        approvalStatus: LineApprovalStatus.APPROVED,
      })
    );
  }

  /** A basket covering exactly the lists it is given, and a participant on it. */
  async function basket(
    options: { kind?: BasketKind; guest?: boolean } = {},
    ...listIds: string[]
  ): Promise<{ basket: GeneratedList; participantId: string }> {
    const repo = dataSource.getRepository(GeneratedList);
    const kind = options.kind ?? BasketKind.GENERATED;
    const saved = await repo.save(
      repo.create({
        ownerUserId: ids.shopper,
        kind,
        name: kind === BasketKind.LIVE ? null : 'Saturday',
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date(),
        idempotencyKey: null,
      })
    );
    if (kind === BasketKind.GENERATED) {
      const sources = dataSource.getRepository(BasketSource);
      for (const listId of listIds) {
        await sources.save(
          sources.create({ basketId: saved.id, zoneId: ids.zone, listId })
        );
      }
    }
    const participants = dataSource.getRepository(GeneratedListParticipant);
    const participant = await participants.save(
      participants.create({
        generatedListId: saved.id,
        shareLinkId: null,
        // A guest is the point of test 6: both routes are open to any live
        // participant, and the permission is the owner's by construction.
        kind: options.guest ? ParticipantKind.GUEST : ParticipantKind.OWNER,
        userId: options.guest ? null : ids.shopper,
        displayName: options.guest ? 'Marta' : null,
        username: options.guest ? null : 'Shopper',
        guestNumber: options.guest ? 1 : null,
        sessionSecretHash: options.guest ? randomUUID() : null,
        userAgent: null,
        joinedAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
        // A link visitor always carries one and the owner never does, which
        // plan 0140's `ck_generated_list_participants_expiry` holds.
        expiresAt: options.guest
          ? new Date(Date.now() + 12 * 60 * 60 * 1000)
          : null,
      })
    );
    return { basket: saved, participantId: participant.id };
  }

  /** The row a key names, as the reader of the whole basket sees it. */
  async function rowOf(held: GeneratedList, rowKey: string) {
    const listIds = (await coverageOf(held)).map((row) => row.listId);
    const { rows } = await read.rowsOf(
      held,
      listIds,
      BasketRedaction.unredacted(listIds)
    );
    const row = rows.find(
      (candidate) =>
        candidate.rowKey === rowKey ||
        candidate.entries.some((entry) => entry.lineId === rowKey)
    );
    if (!row) {
      throw new Error(`no row for ${rowKey}`);
    }
    return row;
  }

  const coverageOf = (held: GeneratedList) =>
    new BasketCoverageService(dataSource.getRepository(GeneratedList)).listsOf(
      held
    );

  const skipsOf = (basketId: string) =>
    dataSource
      .getRepository(BasketLineSkip)
      .find({ where: { basketId }, order: { skippedAt: 'ASC', id: 'ASC' } });

  /** Push a skip's `skippedAt` into the past, with the database's own clock. */
  const ageSkip = (id: string, hours: number) =>
    dataSource.query(
      `UPDATE "basket_line_skips"
         SET "skippedAt" = now() - ($2::int * interval '1 hour')
       WHERE id = $1::uuid`,
      [id, hours]
    );

  // --- 6, 7. the two routes ------------------------------------------------

  describe('the PUT and the DELETE (tests 6 and 7)', () => {
    it('marks every entry of a two entry row, and a second call marks none', async () => {
      const flat = await list('Flat');
      const parents = await list('Parents');
      const { basket: held, participantId } = await basket(
        { guest: true },
        flat,
        parents
      );
      const first = await line(flat, 'Milk', 2);
      const second = await line(parents, 'milk', 1);

      const result = await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: first.id,
      });

      const written = await skipsOf(held.id);
      expect(written.map((row) => row.lineId).sort()).toEqual(
        [first.id, second.id].sort()
      );
      // One transaction, so both rows carry the same instant.
      expect(written[0].skippedAt.getTime()).toBe(
        written[1].skippedAt.getTime()
      );
      // A guest did it, and every act on a basket is attributed to the
      // participant (plan 0051, section 3.2).
      expect(written[0].skippedByParticipantId).toBe(participantId);
      expect(result.row.state).toBe(BasketRowState.SKIPPED);
      // No zone event about the line itself (section 5.3): the household's
      // line did not change, and whose trip put it off is private to the
      // basket. `line.claimChanged` is the exception and is section 5.4's own
      // rule, asserted in test 13.
      expect(
        emitted
          .map((entry) => entry.event)
          .filter((name) =>
            (
              [
                RealtimeEvent.LineAdded,
                RealtimeEvent.LineUpdated,
                RealtimeEvent.LineSettled,
                RealtimeEvent.LineDeleted,
              ] as string[]
            ).includes(name)
          )
      ).toEqual([]);
      expect(
        emitted.some(
          (entry) => entry.event === RealtimeEvent.BasketLinesChanged
        )
      ).toBe(true);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: first.id,
      });
      expect(await skipsOf(held.id)).toHaveLength(2);

      // And the same guest can take it back.
      const back = await skipService.unskip({
        basketId: held.id,
        participantId,
        rowKey: first.id,
      });
      expect(back.row.state).toBe(BasketRowState.WANTED);
      expect(
        (await skipsOf(held.id)).every(
          (row) => row.revertedByParticipantId === participantId
        )
      ).toBe(true);
    });

    it('refuses a PUT on a row with nothing left to skip', async () => {
      const listId = await list('Nothing left');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Salt', 1);

      // Bought to zero first, which is what keeps the row in the view at all:
      // a line at zero with nothing bought is not covered.
      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        from: 1,
      });

      await expect(
        skipService.skip({ basketId: held.id, participantId, rowKey: row.id })
      ).rejects.toMatchObject({ code: 'conflict' });
      expect(await skipsOf(held.id)).toHaveLength(0);
    });

    it('refuses both routes on a finished basket', async () => {
      const listId = await list('Finished');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Bread', 1);
      await dataSource
        .getRepository(GeneratedList)
        .update(held.id, { status: GeneratedListStatus.FINISHED });

      const req = { basketId: held.id, participantId, rowKey: row.id };
      await expect(skipService.skip(req)).rejects.toMatchObject({
        code: 'generated_list_finished',
      });
      await expect(skipService.unskip(req)).rejects.toMatchObject({
        code: 'generated_list_finished',
      });
    });
  });

  // --- 8, 9, 10, 11. what ends a skip --------------------------------------

  describe('what ends a skip (tests 8 to 11)', () => {
    it('ends on a purchase through the same basket, and comes back on its revert', async () => {
      const listId = await list('Bought after');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Eggs', 3);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        from: 3,
      });

      // The settle wrote nothing here, and the skip stopped standing anyway.
      expect(await skipsOf(held.id)).toHaveLength(1);
      const partly = await rowOf(held, row.id);
      expect(partly.state).toBe(BasketRowState.PARTLY);
      expect(partly.note).toBeNull();

      await revertService.revert({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        target: 'UNITS',
        units: 1,
        from: 1,
      });

      // No new row either: the skip is standing again because the settlement
      // that ended it is not (plan 0137, section 3.1).
      expect(await skipsOf(held.id)).toHaveLength(1);
      expect((await rowOf(held, row.id)).state).toBe(BasketRowState.SKIPPED);
    });

    it('survives a purchase made outside the basket', async () => {
      const listId = await list('Bought elsewhere');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Rice', 3);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      // A purchase on the list page carries no basket, so it cannot end this
      // basket's skip. It lowers `left` and nothing else.
      await dataSource.query(
        `INSERT INTO "line_settlements"
           ("lineId", "listId", "outcome", "quantity", "settledByUserId",
            "settledAt", "basketId")
         VALUES ($1::uuid, $2::uuid, 'BOUGHT', 1, $3::uuid, now(), NULL)`,
        [row.id, listId, ids.shopper]
      );
      await dataSource.getRepository(ListLine).update(row.id, { quantity: 2 });

      const after = await rowOf(held, row.id);
      expect(after.state).toBe(BasketRowState.SKIPPED);
      expect(after.left).toBe(2);
    });

    it('lets the newer of a skip and a close win, in both orders', async () => {
      const first = await list('Skip then close');
      const { basket: a, participantId: pa } = await basket({}, first);
      const one = await line(first, 'Bread', 2);

      await skipService.skip({
        basketId: a.id,
        participantId: pa,
        rowKey: one.id,
      });
      await settleService.settle({
        basketId: a.id,
        participantId: pa,
        rowKey: one.id,
        outcome: SettlementOutcome.NOT_AVAILABLE,
        from: 2,
      });
      // The shop had none, and that is the newer act.
      expect((await rowOf(a, one.id)).state).toBe(BasketRowState.NOT_AVAILABLE);

      const second = await list('Close then skip');
      const { basket: b, participantId: pb } = await basket({}, second);
      const two = await line(second, 'Bread', 2);

      await settleService.settle({
        basketId: b.id,
        participantId: pb,
        rowKey: two.id,
        outcome: SettlementOutcome.NOT_AVAILABLE,
        from: 2,
      });
      await skipService.skip({
        basketId: b.id,
        participantId: pb,
        rowKey: two.id,
      });
      expect((await rowOf(b, two.id)).state).toBe(BasketRowState.SKIPPED);
    });

    it('marks every unreverted row on a DELETE, including one a purchase ended', async () => {
      const listId = await list('Delete marks all');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Flour', 3);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        from: 3,
      });
      // The skip no longer stands, and the `DELETE` marks it anyway.
      await skipService.unskip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      expect(
        (await skipsOf(held.id)).every((entry) => entry.revertedAt !== null)
      ).toBe(true);

      await revertService.revert({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        target: 'UNITS',
        units: 1,
        from: 1,
      });

      // No stray row a later revert of that purchase could bring back to life.
      expect((await rowOf(held, row.id)).state).toBe(BasketRowState.WANTED);
    });
  });

  // --- 12. the window is the database's ------------------------------------

  describe('the window (test 12)', () => {
    it('reads a thirteen hour old skip as stale, and as fresh at fourteen hours', async () => {
      const listId = await list('Window');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Coffee', 2);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      const [written] = await skipsOf(held.id);
      await ageSkip(written.id, 13);

      const stale = await rowOf(held, row.id);
      expect(stale.state).toBe(BasketRowState.WANTED);
      expect(stale.note).toBe(BasketRowNote.SKIPPED_EARLIER);
      // The note names when it was skipped, not when it went stale.
      expect(stale.noteAt).not.toBeNull();

      // The same row, the same database, a longer window. Nothing about the
      // spec's own clock is involved in either answer.
      const wider = new BasketReadService(
        dataSource.getRepository(GeneratedList),
        new BasketCoverageService(dataSource.getRepository(GeneratedList)),
        {
          writableAmong: async (_u: string, ids: readonly string[]) =>
            new Set(ids),
          listParticipants: async () => ({ participants: [] }),
          liveParticipantById: async () => null,
        } as never,
        {
          permissionsAmong: async (_u: string, ids: readonly string[]) =>
            new Map(ids.map((id) => [id, new Set([ListPermission.MANAGE])])),
        } as never,
        { order: async <T>(_u: string, rows: T[]) => rows } as never,
        fakeBasketMarks(),
        fakeCoreConfig(14 * 60 * 60 * 1000)
      );
      const { rows } = await wider.rowsOf(
        held,
        [listId],
        BasketRedaction.unredacted([listId])
      );
      expect(rows[0].state).toBe(BasketRowState.SKIPPED);
    });
  });

  // --- 13. the claim -------------------------------------------------------

  describe('the claim (test 13)', () => {
    it('releases on a PUT, claims again on a DELETE, and a stale skip releases nothing', async () => {
      const listId = await list('Claimed');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Butter', 2);

      expect((await claims.claimOf(row.id)).claimed).toBe(true);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      expect((await claims.claimOf(row.id)).claimed).toBe(false);
      // And the household was told, rather than being left to find out on the
      // next cold read.
      expect(
        emitted.some(
          (entry) =>
            entry.event === RealtimeEvent.LineClaimChanged &&
            (entry.payload as { claimed: boolean }).claimed === false
        )
      ).toBe(true);

      emitted.length = 0;
      await skipService.unskip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      expect((await claims.claimOf(row.id)).claimed).toBe(true);
      expect(
        emitted.some(
          (entry) =>
            entry.event === RealtimeEvent.LineClaimChanged &&
            (entry.payload as { claimed: boolean }).claimed === true
        )
      ).toBe(true);

      // A stale skip says nothing about the claim any more: it would otherwise
      // hold a line free for ever, which is an expiry rather than a release.
      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      const standing = (await skipsOf(held.id)).filter(
        (entry) => entry.revertedAt === null
      );
      await ageSkip(standing[0].id, 13);
      expect((await claims.claimOf(row.id)).claimed).toBe(true);
    });

    it('leaves a line a second open basket still carries claimed', async () => {
      const listId = await list('Two baskets');
      const { basket: mine, participantId } = await basket({}, listId);
      await basket({}, listId);
      const row = await line(listId, 'Olives', 2);

      await skipService.skip({
        basketId: mine.id,
        participantId,
        rowKey: row.id,
      });

      // Asked of the derivation rather than assumed from the write: a line one
      // basket has let go of may still be held by another.
      expect((await claims.claimOf(row.id)).claimed).toBe(true);
    });
  });

  // --- 14. a merge carries them --------------------------------------------

  describe('a merge (test 14)', () => {
    it('moves a skip onto the survivor, and the merged row reads SKIPPED', async () => {
      const listId = await list('Merged');
      const { basket: held, participantId } = await basket({}, listId);
      const survivor = await line(listId, 'Jam', 1);
      const absorbed = await line(listId, 'Marmalade', 1);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: survivor.id,
      });
      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: absorbed.id,
      });

      await dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ListLine);
        await merges.merge(
          manager,
          await repo.findOneByOrFail({ id: survivor.id }),
          await repo.findOneByOrFail({ id: absorbed.id }),
          // The merge records its own change (plan 0138, section 4). Written
          // here for real, since there is a database; nothing below reads it.
          {
            list: { id: listId, zoneId: ids.zone },
            actor: { userId: ids.shopper, participantId: null, basketId: null },
          }
        );
      });

      // Without the move the cascade would take the absorbed line's skip with
      // it, and a row the shopper skipped would come back as wanted because
      // somebody fixed a spelling.
      const kept = await skipsOf(held.id);
      expect(kept).toHaveLength(2);
      expect(kept.every((entry) => entry.lineId === survivor.id)).toBe(true);
      expect((await rowOf(held, survivor.id)).state).toBe(
        BasketRowState.SKIPPED
      );
    });
  });

  // --- 15. what a skip dies with -------------------------------------------

  describe('what a skip dies with (test 15)', () => {
    it('goes with its basket', async () => {
      const listId = await list('Deleted basket');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Tea', 1);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      expect(await skipsOf(held.id)).toHaveLength(1);

      await dataSource.getRepository(GeneratedList).delete({ id: held.id });
      expect(await skipsOf(held.id)).toHaveLength(0);
    });

    it('survives the finish, which writes trip rows that say not bought', async () => {
      const listId = await list('Finished with a skip');
      const { basket: held, participantId } = await basket({}, listId);
      const row = await line(listId, 'Sugar', 2);

      await skipService.skip({
        basketId: held.id,
        participantId,
        rowKey: row.id,
      });
      await dataSource
        .getRepository(GeneratedList)
        .update(held.id, { status: GeneratedListStatus.FINISHED });

      // Finishing does nothing with a standing skip: the frozen row says asked
      // and not bought, and the skip dies with nothing to say.
      expect(await skipsOf(held.id)).toHaveLength(1);
      const finished = await dataSource
        .getRepository(GeneratedList)
        .findOneByOrFail({ id: held.id });
      const { rows } = await read.rowsOf(
        finished,
        [listId],
        BasketRedaction.unredacted([listId])
      );
      // A finished basket reads no skips at all (plan 0137, section 4).
      expect(rows.every((entry) => entry.note === null)).toBe(true);
    });
  });
});
