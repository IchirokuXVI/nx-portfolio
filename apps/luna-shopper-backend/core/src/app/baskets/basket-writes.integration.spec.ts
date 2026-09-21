import {
  BasketKind,
  BasketRowState,
  GeneratedListStatus,
  LineApprovalStatus,
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
  LineSettlement,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import type { CoreEventsPublisher } from '../events/core-events.publisher';
import { BasketAnnouncer } from './basket-announcer.service';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import { BasketRevertService } from './basket-revert.service';
import { BasketRowResolver } from './basket-row-resolver';
import { BasketSettleService } from './basket-settle.service';
import { BasketWriteContext } from './basket-write.context';
import { fakeBasketMarks } from './changes/basket-marks.fake';

/**
 * The **real** announcer, wired to the same publisher fake the rest of this file
 * asserts through (plan 0139, section 3).
 *
 * `basket.linesChanged` is one of the events this file exists to prove, so it is
 * published here rather than stubbed. It is built in `beforeAll`, because it
 * needs the coverage service and therefore the database.
 */
let announcer: BasketAnnouncer;

/**
 * The writes on a basket row (plan 0136, section 13, tests 8 to 10).
 *
 * Against Postgres, because what is asserted is a lock order, a decrement, a
 * split that copies every column of a row, and a `from` bargain checked against
 * what the lock read. None of those is a fact about a spy.
 *
 * The settle and the revert are here and the other three are not: those two are
 * the ones that write `line_settlements` and move a zone line's quantity, which
 * is the pair of tables only a database can answer for. The demand goes through
 * `LineService.addQuantity`, which has its own integration spec, and the add and
 * the rename go through `LineService.add` and `planListRename`, which have
 * theirs.
 */
describeIntegration('writing on a basket row (real Postgres)', () => {
  let dataSource: DataSource;
  let settleService: BasketSettleService;
  let revertService: BasketRevertService;

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

    const baskets = dataSource.getRepository(GeneratedList);
    const coverage = new BasketCoverageService(baskets);
    announcer = new BasketAnnouncer(
      coverage,
      events as unknown as CoreEventsPublisher
    );
    const resolver = new BasketRowResolver(baskets, fakeCoreConfig());

    // The three methods the context and the read ask of it. A real one needs a
    // share link table and a members service, and none of the rules under test
    // is about sharing.
    const sharing = {
      writableAmong: async (_userId: string, listIds: readonly string[]) =>
        new Set(listIds),
      liveParticipantById: async (participantId: string) =>
        dataSource
          .getRepository(GeneratedListParticipant)
          .findOne({ where: { id: participantId } }),
      // The real rows, because the read looks its caller up in them: a
      // participant the list does not name is a revocation that landed between
      // the guard and the read, and the answer would be a refusal.
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

    const read = new BasketReadService(
      baskets,
      coverage,
      sharing,
      listAccess,
      { order: async <T>(_userId: string, rows: T[]) => rows } as never,
      // What changed since somebody looked (plan 0138). The writes here answer a
      // row rather than a banner, and the marks have their own file.
      fakeBasketMarks(),
      // The skip window (plan 0137). Nothing here skips anything, and the two
      // that do have their own file.
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

    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Basket writes',
        joinCode: `BW${Date.now()}`.slice(0, 16),
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

  // --- fixtures ------------------------------------------------------------

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

  /**
   * A basket covering exactly the lists it is given, and the owner's row.
   *
   * Named lists rather than the whole zone, so one test's lines never reach
   * another test's basket. Coverage over a whole zone is what
   * `basket-coverage.integration.spec.ts` proves; here it would only make every
   * case depend on the order the file happens to run in.
   */
  async function basket(
    ...listIds: string[]
  ): Promise<{ basket: GeneratedList; participantId: string }> {
    const repo = dataSource.getRepository(GeneratedList);
    const saved = await repo.save(
      repo.create({
        ownerUserId: ids.shopper,
        kind: BasketKind.GENERATED,
        name: 'Saturday',
        status: GeneratedListStatus.OPEN,
        generatedAt: new Date(),
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
    const participant = await participants.save(
      participants.create({
        generatedListId: saved.id,
        shareLinkId: null,
        kind: ParticipantKind.OWNER,
        userId: ids.shopper,
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
    return { basket: saved, participantId: participant.id };
  }

  const quantityOf = async (id: string) =>
    (await dataSource.getRepository(ListLine).findOneByOrFail({ id })).quantity;

  const standingOf = (lineId: string) =>
    dataSource.getRepository(LineSettlement).find({
      where: { lineId, revertedAt: IsNull() },
      order: { settledAt: 'ASC', id: 'ASC' },
    });

  // --- 8. settle -----------------------------------------------------------

  describe('settle (test 8)', () => {
    it('decrements the line and writes one settlement naming the basket', async () => {
      const listId = await list('Weekly');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Milk', 2);

      const result = await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
        from: 2,
      });

      expect(await quantityOf(row.id)).toBe(0);
      const [written] = await standingOf(row.id);
      expect(written.basketId).toBe(held.id);
      // The participant, always, including for the owner
      // (`ck_line_settlements_actor`).
      expect(written.settledByParticipantId).toBe(participantId);
      expect(written.settledByUserId).toBeNull();
      // Both set, always, since plan 0136: there is no waiting settlement left
      // for either to be null on.
      expect(written.lineId).toBe(row.id);
      expect(written.listId).toBe(listId);
      // The purchase is in scope, so the row stays and reads DONE.
      expect(result.row.state).toBe(BasketRowState.DONE);
      expect(result.row.bought).toBe(2);
    });

    it('refuses a settle whose `from` no longer matches', async () => {
      const listId = await list('Raced');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Bread', 3);

      // Somebody else moved the line between the read and the tap.
      await dataSource.getRepository(ListLine).update(row.id, { quantity: 1 });

      await expect(
        settleService.settle({
          basketId: held.id,
          participantId,
          rowKey: row.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          from: 3,
        })
      ).rejects.toMatchObject({ code: 'stale_quantity' });
      // Nothing was written: the refusal is before any settlement row.
      expect(await standingOf(row.id)).toHaveLength(0);
    });

    it('refuses the second of two identical taps', async () => {
      const listId = await list('Double tap');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Cheese', 2);
      const tap = {
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
        from: 2,
      };

      await settleService.settle(tap);
      // The `from` bargain is what catches it, which is why the units are not
      // capped at `left` any more (plan 0136, section 5.1).
      await expect(settleService.settle(tap)).rejects.toMatchObject({
        code: 'stale_quantity',
      });
      expect(await standingOf(row.id)).toHaveLength(1);
    });

    it('records three bought of a line that says two', async () => {
      const listId = await list('Extra');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Apples', 2);

      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 3,
        from: 2,
      });

      // Plan 0047 section 4.2: the extra unit is real and belongs in the
      // consumption history even though it had no demand to satisfy. The line
      // floors at zero; the settlement keeps what was actually bought.
      expect(await quantityOf(row.id)).toBe(0);
      expect((await standingOf(row.id))[0].quantity).toBe(3);
    });

    it('writes a close per entry with no units, and refuses one on a finished row', async () => {
      const flat = await list('Flat');
      const parents = await list('Parents');
      const { basket: held, participantId } = await basket(flat, parents);
      const first = await line(flat, 'Yeast', 1);
      await line(parents, 'yeast', 1);

      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: first.id,
        outcome: SettlementOutcome.NOT_AVAILABLE,
        from: 2,
      });

      // One row per entry with `quantity` zero, which is what makes the
      // indicator of plan 0047 section 5 derivable. Nothing moved.
      const rows = await dataSource.getRepository(LineSettlement).find({
        where: { basketId: held.id, revertedAt: IsNull() },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((entry) => entry.quantity === 0)).toBe(true);
      expect(await quantityOf(first.id)).toBe(1);
    });

    it('refuses a close on a row that has nothing left to close', async () => {
      const listId = await list('Finished');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Salt', 1);

      // Bought to zero first, which is what keeps the row in the view at all:
      // a line at zero with nothing bought is not covered, and the resolver
      // answers `not_found` rather than a conflict.
      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        from: 1,
      });

      // A conflict rather than a validation failure (plan 0054, section 4): the
      // request is well formed and the state refuses it.
      await expect(
        settleService.settle({
          basketId: held.id,
          participantId,
          rowKey: row.id,
          outcome: SettlementOutcome.NOT_AVAILABLE,
          from: 0,
        })
      ).rejects.toMatchObject({ code: 'conflict' });
    });

    it('refuses an itemId that is not one of the row’s options', async () => {
      const listId = await list('Swap');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Milk', 1);

      // A swap is a gesture at the shelf rather than a way to write an
      // arbitrary catalog id into a household's purchase history.
      await expect(
        settleService.settle({
          basketId: held.id,
          participantId,
          rowKey: row.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          from: 1,
          itemId: randomUUID(),
        })
      ).rejects.toMatchObject({ code: 'validation_failed' });
    });

    it('allocates oldest first across two households', async () => {
      const flat = await list('Flat');
      const parents = await list('Parents');
      const { basket: held, participantId } = await basket(flat, parents);
      const older = await line(flat, 'Milk', 2);
      const newer = await line(parents, 'milk', 1);

      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: older.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
        from: 3,
      });

      // Deterministic, explicable in one sentence, and identical to the obvious
      // answer on the overwhelmingly common single entry row.
      expect(await quantityOf(older.id)).toBe(0);
      expect(await quantityOf(newer.id)).toBe(1);
      // A `BOUGHT` with a zero allocation writes nothing at all.
      expect(await standingOf(newer.id)).toHaveLength(0);
    });
  });

  // --- 9. two settles that share a line -----------------------------------

  describe('the lock order (test 9)', () => {
    it('lets two settles on two rows that share a list both commit', async () => {
      const listId = await list('Shared');
      const { basket: held, participantId } = await basket(listId);
      const first = await line(listId, 'Rice', 1);
      const second = await line(listId, 'Beans', 1);

      // Both entries are locked in ascending id order, one order for every
      // caller, so two settles wait for each other instead of deadlocking.
      const [a, b] = await Promise.all([
        settleService.settle({
          basketId: held.id,
          participantId,
          rowKey: first.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          from: 1,
        }),
        settleService.settle({
          basketId: held.id,
          participantId,
          rowKey: second.id,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          from: 1,
        }),
      ]);

      expect(a.row.bought).toBe(1);
      expect(b.row.bought).toBe(1);
      expect(await quantityOf(first.id)).toBe(0);
      expect(await quantityOf(second.id)).toBe(0);
    });
  });

  // --- 10. revert ----------------------------------------------------------

  describe('revert (test 10)', () => {
    it('takes the newest purchase back first and puts the units on by addition', async () => {
      const listId = await list('Revert');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Milk', 4);

      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        from: 4,
      });
      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
        from: 3,
      });
      expect(await quantityOf(row.id)).toBe(1);

      const result = await revertService.revert({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        target: 'UNITS',
        units: 2,
        from: 3,
      });

      // The units this basket took off are the units it puts back, added to
      // whatever the line says now rather than restored to a remembered number.
      expect(await quantityOf(row.id)).toBe(3);
      expect(result.row.bought).toBe(1);
      // The older purchase still stands: the walk runs newest first.
      const standing = await standingOf(row.id);
      expect(standing.map((entry) => entry.quantity)).toEqual([1]);
    });

    it('splits a purchase taken back in part, copying every column', async () => {
      const listId = await list('Split');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Eggs', 6);

      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 6,
        from: 6,
      });
      const [original] = await standingOf(row.id);

      await revertService.revert({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        target: 'UNITS',
        units: 2,
        from: 6,
      });

      // Plan 0104 section 3.2: the original is reverted in full and the
      // remainder is appended as an ordinary settlement carrying the buyer, the
      // product, the line, the basket and the **time the shopping happened**.
      const standing = await standingOf(row.id);
      expect(standing).toHaveLength(1);
      expect(standing[0].quantity).toBe(4);
      expect(standing[0].id).not.toBe(original.id);
      expect(standing[0].basketId).toBe(held.id);
      expect(standing[0].settledByParticipantId).toBe(participantId);
      expect(standing[0].settledAt.getTime()).toBe(
        original.settledAt.getTime()
      );
      expect(await quantityOf(row.id)).toBe(2);
    });

    it('takes a whole close back, and the close held no units', async () => {
      const flat = await list('Flat close');
      const parents = await list('Parents close');
      const { basket: held, participantId } = await basket(flat, parents);
      const first = await line(flat, 'Yeast', 1);
      const second = await line(parents, 'yeast', 1);

      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: first.id,
        outcome: SettlementOutcome.NOT_AVAILABLE,
        from: 2,
      });
      const result = await revertService.revert({
        basketId: held.id,
        participantId,
        rowKey: first.id,
        target: 'CLOSE',
      });

      // One `NOT_AVAILABLE` settle writes a row per entry sharing a
      // `settledAt`: they were one gesture and they go back as one.
      expect(await standingOf(first.id)).toHaveLength(0);
      expect(await standingOf(second.id)).toHaveLength(0);
      // A close moved no units, so taking it back moves none either.
      expect(await quantityOf(first.id)).toBe(1);
      expect(result.row.state).toBe(BasketRowState.WANTED);
    });

    it('refuses a revert whose `from` no longer matches', async () => {
      const listId = await list('Revert raced');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Flour', 2);
      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        from: 2,
      });

      await expect(
        revertService.revert({
          basketId: held.id,
          participantId,
          rowKey: row.id,
          target: 'UNITS',
          units: 1,
          // The client believed two had been bought; one has.
          from: 2,
        })
      ).rejects.toMatchObject({ code: 'stale_quantity' });
    });

    it('leaves a deleted line’s purchase standing, and reverts what is left', async () => {
      const flat = await list('Flat gone');
      const parents = await list('Parents gone');
      const { basket: held, participantId } = await basket(flat, parents);
      const first = await line(flat, 'Milk', 1);
      const second = await line(parents, 'milk', 1);

      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: first.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 2,
        from: 2,
      });
      // The household deleted their line after the purchase (plan 0132). Its
      // settlement survives, because that is what plan 0132 bought: a deleted
      // line keeps its purchases.
      await dataSource
        .getRepository(ListLine)
        .update(second.id, { deletedAt: new Date() });
      expect(await standingOf(second.id)).toHaveLength(1);

      // The row is now one entry, so the revert acts on that one and the
      // deleted line is not in it to be skipped: an entry outside the coverage
      // is not part of the row at all, which is the difference between plan
      // 0136's model and the origins it replaced.
      const result = await revertService.revert({
        basketId: held.id,
        participantId,
        rowKey: first.id,
        target: 'UNITS',
        units: 1,
        from: 1,
      });

      expect(result.row.bought).toBe(0);
      expect(await quantityOf(first.id)).toBe(1);
      // Untouched: nothing may write to a list the basket no longer covers.
      expect(await standingOf(second.id)).toHaveLength(1);
    });
  });

  // --- the event both writes emit ------------------------------------------

  describe('what a write announces (section 8)', () => {
    it('emits the list’s own line.settled and basket.linesChanged with ids alone', async () => {
      const listId = await list('Announced');
      const { basket: held, participantId } = await basket(listId);
      const row = await line(listId, 'Milk', 1);

      await settleService.settle({
        basketId: held.id,
        participantId,
        rowKey: row.id,
        outcome: SettlementOutcome.BOUGHT,
        quantity: 1,
        from: 1,
      });

      expect(emitted.map((entry) => entry.event)).toContain('line.settled');
      const changed = emitted.find(
        (entry) => entry.event === 'basket.linesChanged'
      );
      // Ids only, which is the least privileged view of plan 0130 section 6: a
      // basket room holds guests and a broadcast cannot be projected per socket.
      expect(changed?.payload).toEqual({ lineIds: [row.id] });
    });
  });
});
