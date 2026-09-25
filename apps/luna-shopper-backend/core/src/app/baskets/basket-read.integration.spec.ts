import {
  BasketKind,
  BasketRowState,
  BasketStatus,
  LineApprovalStatus,
  ListPermission,
  MembershipStatus,
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
import { DataSource } from 'typeorm';
import {
  BasketSource,
  CORE_ENTITIES,
  Basket,
  LineSettlement,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { fakeCoreConfig } from './basket-config.fake';
import { fakeBasketMarks } from './changes/basket-marks.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import { BasketRedaction } from './basket-redaction';

/**
 * The basket, read from the lists it covers (plan 0136, section 13, tests 5 to
 * 7).
 *
 * Against Postgres, because every rule here is a `WHERE`, a join or a window.
 * The session is a gaps and islands query over `now()`; coverage is a join
 * through `zone_memberships` and `list_access`; and "keep the row after it is
 * bought" is an `EXISTS` inside the line read. A mocked repository has none of
 * them, and each of the three has already been the kind of rule a fixture
 * agrees with and a database does not.
 *
 * One zone and one shopper for the file, a fresh list and basket per test, so no
 * test has to clean up after another.
 */
describeIntegration('the basket, read from its lists (real Postgres)', () => {
  let dataSource: DataSource;
  let read: BasketReadService;

  const ids = { zone: '', shopper: randomUUID(), other: randomUUID() };
  /** One zone per `LIVE` test, torn down together. */
  const liveZones: string[] = [];
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
    read = new BasketReadService(
      baskets,
      new BasketCoverageService(baskets),
      // The participants, which every test here reads as the owner.
      {
        writableAmong: async (userId: string, listIds: readonly string[]) =>
          new Set(listIds),
        listParticipants: async () => ({ participants: [] }),
        liveParticipantById: async () => null,
      } as never,
      // The **owner's** permissions on each covered list (plan 0131). Every
      // list here is the owner's own zone, so they hold all four.
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
      // The walk order learns from the owner's past sessions (plan 0141), and
      // none of these tests has one, so it answers what it was given. Its own
      // file owns the rule.
      { order: async <T>(_userId: string, rows: T[]) => rows } as never,
      // What changed since somebody looked (plan 0138). Every read below passes
      // no viewer, so the marks are never asked for; the reads that are about
      // them have their own file.
      fakeBasketMarks(),
      // The skip window (plan 0137). Nothing here skips anything, so the
      // default is the only value it has to be.
      fakeCoreConfig()
    );

    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Basket read',
        joinCode: `BR${Date.now()}`.slice(0, 16),
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

  afterAll(async () => {
    const zones = dataSource.getRepository(Zone);
    for (const zoneId of liveZones) {
      await zones.delete({ id: zoneId });
    }
    if (ids.zone) {
      await zones.delete({ id: ids.zone });
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
    over: Partial<ListLine> = {}
  ): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    return repo.save(
      repo.create({
        listId,
        content,
        quantity: 2,
        position,
        createdByUserId: ids.shopper,
        approvalStatus: LineApprovalStatus.APPROVED,
        ...over,
      })
    );
  }

  /**
   * A basket covering exactly the lists it is given.
   *
   * Named lists rather than the whole zone, so one test's lines never reach
   * another test's basket. A source naming no list would cover the zone, which
   * is the rule `basket-coverage.integration.spec.ts` proves; here it would only
   * make every case depend on the order the file happens to run in.
   */
  async function basket(
    kind = BasketKind.GENERATED,
    ...listIds: string[]
  ): Promise<Basket> {
    const repo = dataSource.getRepository(Basket);
    const saved = await repo.save(
      repo.create({
        ownerUserId: ids.shopper,
        kind,
        name: kind === BasketKind.LIVE ? null : 'Saturday',
        status: BasketStatus.OPEN,
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
    return saved;
  }

  async function settle(
    basketRow: Basket,
    lineRow: ListLine,
    quantity: number,
    at: Date,
    outcome = SettlementOutcome.BOUGHT
  ): Promise<LineSettlement> {
    const repo = dataSource.getRepository(LineSettlement);
    return repo.save(
      repo.create({
        lineId: lineRow.id,
        listId: lineRow.listId,
        itemId: null,
        outcome,
        quantity: outcome === SettlementOutcome.BOUGHT ? quantity : 0,
        settledByUserId: null,
        settledByParticipantId: randomUUID(),
        settledAt: at,
        revertedAt: null,
        revertedByParticipantId: null,
        basketId: basketRow.id,
        pricePaidCents: null,
        supermarketLocationId: null,
      })
    );
  }

  /** The rows as the owner reads them, unredacted. */
  async function rowsOf(basketRow: Basket) {
    const covered = await new BasketCoverageService(
      dataSource.getRepository(Basket)
    ).listsOf(basketRow);
    const listIds = covered.map((row) => row.listId);
    return read.rowsOf(basketRow, listIds, BasketRedaction.unredacted(listIds));
  }

  const ago = (ms: number) => new Date(Date.now() - ms);

  /**
   * A whole world for one `LIVE` basket: its own owner, its own zone and one
   * list in it.
   *
   * Its own owner because `uq_baskets_live_owner` allows exactly one
   * `LIVE` row per person, which is the invariant plan 0133 declared and plan
   * 0136 leans on: "one permanent basket a person" is a fact of the database
   * rather than a convention of the service. Its own **zone** because a `LIVE`
   * basket covers every list its owner can write, so two tests sharing a zone
   * would read each other's lines.
   */
  async function liveWorld(
    name: string
  ): Promise<{ basket: Basket; listId: string; zoneId: string }> {
    const owner = randomUUID();
    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: `Live ${name}`,
        joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: owner,
        config: {},
      })
    );
    liveZones.push(zone.id);
    const memberships = dataSource.getRepository(ZoneMembership);
    await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: owner,
        username: 'Shopper',
        // A zone OWNER holds all four permissions on every list in it, which
        // is the derived staff grant `WRITABLE_LIST` reads.
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
    const lists = dataSource.getRepository(ShoppingList);
    const saved = await lists.save(
      lists.create({ zoneId: zone.id, name, createdByUserId: owner })
    );
    const baskets = dataSource.getRepository(Basket);
    const held = await baskets.save(
      baskets.create({
        ownerUserId: owner,
        kind: BasketKind.LIVE,
        name: null,
        status: BasketStatus.OPEN,
        generatedAt: new Date(),
        idempotencyKey: null,
      })
    );
    return { basket: held, listId: saved.id, zoneId: zone.id };
  }

  // --- 5. coverage ---------------------------------------------------------

  describe('coverage (test 5)', () => {
    it('shows a line added to a covered list with no write to the basket', async () => {
      const listId = await list('Weekly');
      const held = await basket(BasketKind.GENERATED, listId);
      // Added **after** the basket was made, and the basket never hears of it:
      // that is the whole of plan 0130 section 3, a basket's sources are a rule
      // evaluated on every read rather than a stored list of lines.
      await line(listId, 'Milk');

      const { rows } = await rowsOf(held);
      expect(rows.map((row) => row.content)).toEqual(['Milk']);
    });

    it('drops a list the owner loses access to, with its rows', async () => {
      const listId = await list('Parents');
      const held = await basket(BasketKind.GENERATED, listId);
      await line(listId, 'Bread');

      expect((await rowsOf(held)).rows).toHaveLength(1);

      // Take the membership away and the coverage goes with it, because
      // `WRITABLE_LIST` needs an approved membership before anything else.
      const memberships = dataSource.getRepository(ZoneMembership);
      await memberships.update(
        { zoneId: ids.zone, userId: ids.shopper },
        { status: MembershipStatus.PENDING }
      );
      try {
        expect((await rowsOf(held)).rows).toEqual([]);
      } finally {
        await memberships.update(
          { zoneId: ids.zone, userId: ids.shopper },
          { status: MembershipStatus.APPROVED }
        );
      }
    });

    it('covers every list its owner writes for a LIVE basket, with no sources', async () => {
      const { basket: held, listId } = await liveWorld('Flat');
      await line(listId, 'Rice');

      // No `basket_sources` row exists for it at all, and it still reads the
      // list: that is the difference between the two kinds (plan 0133).
      expect(
        await dataSource
          .getRepository(BasketSource)
          .countBy({ basketId: held.id })
      ).toBe(0);
      const contents = (await rowsOf(held)).rows.map((row) => row.content);
      expect(contents).toContain('Rice');
    });
  });

  // --- 6. which lines are rows --------------------------------------------

  describe('which lines are rows (test 6)', () => {
    it('serves a PENDING line as a row that is awaiting approval', async () => {
      const listId = await list('Pending');
      const held = await basket(BasketKind.GENERATED, listId);
      await line(listId, 'Olives', {
        approvalStatus: LineApprovalStatus.PENDING,
      });

      const [row] = (await rowsOf(held)).rows;
      // A pending line is still coverable, because plan 0092 made one adoptable
      // and plan 0136 section 5.4 lets one be bought.
      expect(row.content).toBe('Olives');
      expect(row.awaitingApproval).toBe(true);
    });

    it('serves neither a REJECTED line nor a soft deleted one', async () => {
      const listId = await list('Refused');
      const held = await basket(BasketKind.GENERATED, listId);
      await line(listId, 'Rejected', {
        approvalStatus: LineApprovalStatus.REJECTED,
      });
      const deleted = await line(listId, 'Deleted');
      await dataSource
        .getRepository(ListLine)
        .update(deleted.id, { deletedAt: new Date() });

      // A rejection is a decision and a decision is not shopping; a deleted
      // line is on nobody's list to see (plan 0132).
      expect((await rowsOf(held)).rows).toEqual([]);
    });

    it('keeps a row that was bought to zero, so a revert has something to press', async () => {
      const listId = await list('Bought out');
      const held = await basket(BasketKind.GENERATED, listId);
      const row = await line(listId, 'Butter', { quantity: 0 });
      await settle(held, row, 2, new Date());

      // `quantity > 0` alone would make a settle hide its own row. The second
      // half of the predicate is what keeps it on the screen.
      const [drawn] = (await rowsOf(held)).rows;
      expect(drawn.content).toBe('Butter');
      expect(drawn.state).toBe(BasketRowState.DONE);
      expect(drawn.bought).toBe(2);
      expect(drawn.asked).toBe(2);
    });
  });

  // --- 7. the session ------------------------------------------------------

  describe('the current session of a LIVE basket (test 7)', () => {
    it('joins purchases five hours apart into one session', async () => {
      const { basket: held, listId } = await liveWorld('Session one');
      const row = await line(listId, 'Coffee', { quantity: 0 });
      const gap = PURCHASE_SESSION_GAP_MS;

      await settle(held, row, 1, ago(5 * 60 * 60 * 1000));
      await settle(held, row, 1, ago(60 * 1000));

      // Five hours is inside the six hour gap, so both are this session's.
      expect(gap).toBeGreaterThan(5 * 60 * 60 * 1000);
      const [drawn] = (await rowsOf(held)).rows;
      expect(drawn.bought).toBe(2);
    });

    it('splits purchases seven hours apart into two, and counts the newest', async () => {
      const { basket: held, listId } = await liveWorld('Session two');
      const row = await line(listId, 'Tea', { quantity: 0 });

      await settle(held, row, 5, ago(8 * 60 * 60 * 1000));
      await settle(held, row, 1, ago(60 * 1000));

      // Seven hours is past the gap, so yesterday's shop is a session of its
      // own and does not reappear as today's progress.
      const [drawn] = (await rowsOf(held)).rows;
      expect(drawn.bought).toBe(1);
    });

    it('counts nothing once the session is over', async () => {
      const { basket: held, listId } = await liveWorld('Session over');
      const row = await line(listId, 'Sugar', { quantity: 0 });
      await settle(held, row, 3, ago(12 * 60 * 60 * 1000));

      // The newest purchase is more than one gap from `now()`, so there is no
      // current session at all: `bought` is zero everywhere, and the row that
      // was only there because of that purchase goes with it.
      expect((await rowsOf(held)).rows).toEqual([]);
    });

    it('counts every standing purchase of a GENERATED basket, however old', async () => {
      const listId = await list('Trip');
      const held = await basket(BasketKind.GENERATED, listId);
      const row = await line(listId, 'Flour', { quantity: 0 });
      await settle(held, row, 4, ago(20 * 24 * 60 * 60 * 1000));

      // A trip has an end, so it needs no session: every purchase it made is
      // its own, and the sweep is what stops it running forever.
      const [drawn] = (await rowsOf(held)).rows;
      expect(drawn.bought).toBe(4);
    });

    it('ignores a purchase somebody took back', async () => {
      const listId = await list('Reverted');
      const held = await basket(BasketKind.GENERATED, listId);
      const row = await line(listId, 'Salt');
      const taken = await settle(held, row, 2, new Date());
      await dataSource.getRepository(LineSettlement).update(taken.id, {
        revertedAt: new Date(),
        revertedByParticipantId: randomUUID(),
      });

      // A settlement somebody took back is excluded from every consumption
      // total (plan 0054, section 3.3). It is still in the table, marked.
      const [drawn] = (await rowsOf(held)).rows;
      expect(drawn.bought).toBe(0);
      expect(drawn.state).toBe(BasketRowState.WANTED);
    });
  });

  // --- the grouping, against the database ---------------------------------

  describe('two lists are one row', () => {
    it('folds two lines of one name into one row with two entries', async () => {
      const flat = await list('Flat');
      const parents = await list('Parents');
      const held = await basket(BasketKind.GENERATED, flat, parents);
      await line(flat, 'Milk', { quantity: 2 });
      await line(parents, 'milk', { quantity: 1 });

      const [row] = (await rowsOf(held)).rows;
      expect(row.entries).toHaveLength(2);
      // The row is the sum of its entries, computed on every read.
      expect(row.left).toBe(3);
      expect(row.asked).toBe(3);
      expect(row.entries.map((entry) => entry.listId).sort()).toEqual(
        [flat, parents].sort()
      );
    });

    it('anchors the row on the older line', async () => {
      const first = await list('First');
      const second = await list('Second');
      const held = await basket(BasketKind.GENERATED, first, second);
      const older = await line(first, 'Eggs');
      await line(second, 'eggs');

      // `COVERED_LINES_SQL` orders by `(createdAt, id)`, so the oldest ask for
      // a thing names the row and a write can address it by that key.
      const [row] = (await rowsOf(held)).rows;
      expect(row.rowKey).toBe(older.id);
    });
  });

  describe('a NOT_AVAILABLE row', () => {
    it('says so while units remain, on the newest act', async () => {
      const listId = await list('Missing');
      const held = await basket(BasketKind.GENERATED, listId);
      const row = await line(listId, 'Yeast', { quantity: 2 });
      await settle(held, row, 0, new Date(), SettlementOutcome.NOT_AVAILABLE);

      const [drawn] = (await rowsOf(held)).rows;
      expect(drawn.state).toBe(BasketRowState.NOT_AVAILABLE);
      // A close is an outcome rather than a quantity: it moves nothing.
      expect(drawn.left).toBe(2);
      expect(drawn.bought).toBe(0);
    });
  });

  describe('the list refs a reader is served', () => {
    it('names only the lists the redaction served, and omits the rest', async () => {
      const flat = await list('Flat');
      const parents = await list('Parents');
      const held = await basket(BasketKind.GENERATED, flat, parents);
      await line(flat, 'Milk');
      await line(parents, 'milk');

      const covered = await new BasketCoverageService(
        dataSource.getRepository(Basket)
      ).listsOf(held);
      const { rows } = await read.rowsOf(
        held,
        covered.map((row) => row.listId),
        // A reader who writes the flat's list and not the parents'.
        BasketRedaction.unredacted([flat])
      );

      const entries = rows[0].entries;
      expect(entries.filter((entry) => entry.listId === flat)).toHaveLength(1);
      // Absent rather than null, so the reader cannot tell "a list you may not
      // see" from "no list" (plan 0130, section 6).
      expect(entries.filter((entry) => 'listId' in entry)).toHaveLength(1);
    });
  });
});
