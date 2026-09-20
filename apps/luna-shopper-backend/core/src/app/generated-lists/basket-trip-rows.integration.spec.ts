import {
  BasketKind,
  GeneratedListStatus,
  MembershipStatus,
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
  BasketTripRow,
  CORE_ENTITIES,
  GeneratedList,
  LineSettlement,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { BasketTripRowsService } from './basket-trip-rows.service';
import { GeneratedListService } from './generated-list.service';
import { fakeLineClaims } from './line-claims.fake';

/**
 * What a trip asked, frozen by its finish (plan 0135, section 9, tests 5 to 9).
 *
 * Against Postgres, because what is asserted is a unique key, a check, two
 * cascades and an `INSERT … SELECT` that groups. A mocked repository has none of
 * them, and the invariant this plan turns on ("a basket has rows exactly while
 * it is not `OPEN`") is a fact about rows in a table rather than about a spy.
 *
 * One zone for the file and a fresh list and basket per test, so no test has to
 * clean up after another.
 */
describeIntegration('the ask a finish writes down (real Postgres)', () => {
  let dataSource: DataSource;
  let generated: GeneratedListService;
  const tripRows = new BasketTripRowsService();

  const ids = { zone: '', shopper: randomUUID() };
  /** One zone per list, torn down together. */
  const zoneIds: string[] = [];
  /** The zone of the list made most recently, which a zone wide source names. */
  let lastZoneId = '';
  let position = 0;

  const { OPEN, FINISHED, ARCHIVED } = GeneratedListStatus;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    generated = new GeneratedListService(
      dataSource,
      dataSource.getRepository(GeneratedList),
      // The run's profile resolution and walk order, which no write here asks.
      undefined as never,
      fakeLineClaims({}).service,
      { emitTo: jest.fn(), emitToUsers: jest.fn() } as never,
      undefined as never,
      { liveRegistered: async () => [] } as never,
      dataSource.getRepository(BasketSource),
      tripRows,
      // The basket read, asked by the history counts alone, which nothing here
      // calls: `update` and `delete` answer the header and its sources.
      undefined as never
    );

    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name: 'Trip rows',
        joinCode: `TR${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.shopper,
        config: {},
      })
    );
    ids.zone = zone.id;
    await dataSource.getRepository(ZoneMembership).save(
      dataSource.getRepository(ZoneMembership).create({
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
    for (const zoneId of zoneIds) {
      await zones.delete({ id: zoneId });
    }
    if (ids.zone) {
      await zones.delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  /**
   * A list, **in a zone of its own**.
   *
   * A zone each rather than one for the file, because a basket seeded with no
   * named list covers the whole zone (plan 0133, section 5) and would then read
   * every other test's lines. One zone per list is what keeps "the freeze wrote
   * exactly these rows" a statement about this test rather than about the order
   * the file happens to run in.
   */
  async function list(name: string, inZoneId?: string): Promise<string> {
    if (inZoneId) {
      // A second list in a zone a test already made, for the one case that is
      // **about** two lists in one zone.
      const repo = dataSource.getRepository(ShoppingList);
      const saved = await repo.save(
        repo.create({ zoneId: inZoneId, name, createdByUserId: ids.shopper })
      );
      return saved.id;
    }
    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: `Trip rows: ${name}`,
        joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.shopper,
        config: {},
      })
    );
    zoneIds.push(zone.id);
    const memberships = dataSource.getRepository(ZoneMembership);
    await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: ids.shopper,
        username: 'Shopper',
        // A zone OWNER holds all four permissions on every list in it, which is
        // the derived staff grant `WRITABLE_LIST` reads.
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
    lastZoneId = zone.id;
    const repo = dataSource.getRepository(ShoppingList);
    const saved = await repo.save(
      repo.create({ zoneId: zone.id, name, createdByUserId: ids.shopper })
    );
    return saved.id;
  }

  async function line(
    listId: string,
    content: string,
    quantity = 5
  ): Promise<string> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content,
        quantity,
        position,
        createdByUserId: ids.shopper,
      })
    );
    return saved.id;
  }

  /**
   * A basket, covering the whole zone unless a list is named.
   *
   * The source row is the whole of what a basket holds about a list since plan
   * 0136: the freeze reads the lines through it, so a basket seeded without one
   * covers nothing and freezes nothing.
   */
  async function basket(
    status = OPEN,
    source: { listId?: string } = {}
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedList);
    const saved = await repo.save(
      repo.create({
        ownerUserId: ids.shopper,
        name: 'Saturday',
        status,
        generatedAt: new Date('2026-03-01T10:00:00Z'),
        kind: BasketKind.GENERATED,
        idempotencyKey: null,
      })
    );
    const sources = dataSource.getRepository(BasketSource);
    await sources.save(
      sources.create({
        basketId: saved.id,
        // The named list's own zone, or the zone of the list this test made
        // most recently, so a source with no named list still covers only that
        // test's lines.
        zoneId: source.listId
          ? (
              await dataSource
                .getRepository(ShoppingList)
                .findOneByOrFail({ id: source.listId })
            ).zoneId
          : lastZoneId,
        listId: source.listId ?? null,
      })
    );
    return saved.id;
  }

  /** One standing purchase of a zone line, made through this basket. */
  async function bought(
    basketId: string,
    listId: string,
    lineId: string,
    quantity: number
  ): Promise<void> {
    const repo = dataSource.getRepository(LineSettlement);
    await repo.save(
      repo.create({
        lineId,
        listId,
        itemId: null,
        outcome: SettlementOutcome.BOUGHT,
        quantity,
        settledByUserId: ids.shopper,
        settledByParticipantId: null,
        settledAt: new Date('2026-03-01T11:00:00Z'),
        revertedAt: null,
        basketId,
      })
    );
  }

  /** Every trip row of a basket, as `[lineId, asked]`, in a stable order. */
  async function rowsOf(basketId: string): Promise<[string, number][]> {
    const rows = await dataSource.getRepository(BasketTripRow).find({
      where: { basketId },
      order: { lineId: 'ASC' },
    });
    return rows.map((row) => [row.lineId, row.asked]);
  }

  async function statusOf(basketId: string): Promise<string> {
    const row = await dataSource
      .getRepository(GeneratedList)
      .findOneByOrFail({ id: basketId });
    return row.status;
  }

  async function setStatus(
    basketId: string,
    status: GeneratedListStatus
  ): Promise<void> {
    await generated.update({
      userId: ids.shopper,
      generatedListId: basketId,
      status,
    });
  }

  describe('what the freeze writes (test 5)', () => {
    it('freezes each covered line at what was bought plus what is left', async () => {
      // Plan 0136, section 7.2. This used to be plan 0094's sum, over the
      // sibling basket lines that each carried a part of one ask. A basket holds
      // no copy of a line any more, so the sum is the freeze's own: `asked` is
      // `bought + left`, one row per zone line, and a line bought down freezes
      // at what the trip asked for rather than at what is still outstanding.
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk', 2);
      const bread = await line(flat, 'Bread', 1);
      const id = await basket();
      await bought(id, flat, milk, 3);

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual(
        [
          [milk, 5],
          [bread, 1],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      );
    });

    it('writes a row for a line bought all the way down to zero', async () => {
      // Zero is still a value, and this is where it went. The line asks for
      // nothing now because the trip bought it, and `bought + left` is what
      // keeps the ask readable afterwards.
      const flat = await list('Flat bought to zero');
      const milk = await line(flat, 'Milk', 0);
      const id = await basket();
      await bought(id, flat, milk, 2);

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([[milk, 2]]);
    });

    it('writes no row for a line the list stopped asking for (plan 0136, section 7.2)', async () => {
      // The reversal of "zero is a value". An origin taken back to zero was
      // still a row of the trip, because the basket held a row of its own for
      // it. A line at zero that this basket never bought is not in the view at
      // all, so the freeze has nothing to write down: `(ll.quantity > 0 OR
      // bought > 0)` is the predicate the open basket reads by, which is the
      // point of it.
      const flat = await list('Flat with a zero');
      await line(flat, 'Milk', 0);
      const id = await basket();

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([]);
    });

    it('names the list the line is on', async () => {
      const flat = await list('Flat');
      await line(flat, 'Milk', 2);
      const id = await basket();

      await setStatus(id, FINISHED);

      const [row] = await dataSource
        .getRepository(BasketTripRow)
        .find({ where: { basketId: id } });
      expect(row.listId).toBe(flat);
    });
  });

  describe('which lines the freeze can write (test 6)', () => {
    it('freezes only the lists this basket’s sources name', async () => {
      // The freeze reads the coverage, and the coverage is `basket_sources`
      // narrowed by the owner's `WRITE` (plan 0133, section 5). A second list in
      // the same zone that no source names is not in the open basket's view, so
      // it is not in the frozen one either: the two are the same predicate.
      const flat = await list('Flat');
      const flatZone = lastZoneId;
      const pharmacy = await list('Pharmacy', flatZone);
      const milk = await line(flat, 'Milk', 2);
      await line(pharmacy, 'Plasters', 3);
      const id = await basket(OPEN, { listId: flat });

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([[milk, 2]]);
    });

    it('writes no row for a soft deleted line (plan 0136, section 7.2)', async () => {
      // The reversal of plan 0135's own test. A deleted line used to be frozen,
      // because an origin outlived the line it named and the trips read decided
      // afterwards whether to draw it. The freeze reads the view now, and a
      // deleted line is not in it (plan 0132), so it is dropped on both sides of
      // the finish instead of on one. The purchase survives on the settlement,
      // which is what that plan bought.
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk', 4);
      const id = await basket();
      await dataSource.getRepository(ListLine).softDelete({ id: milk });

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([]);
    });
  });

  describe('freezing twice, and thawing between (test 7)', () => {
    it('is one set of rows however many times it runs', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk', 2);
      const id = await basket();

      await tripRows.freeze(dataSource.manager, id);
      await tripRows.freeze(dataSource.manager, id);

      expect(await rowsOf(id)).toEqual([[milk, 2]]);
    });

    it('reads the list as it now stands after a thaw and a second freeze', async () => {
      // What is edited between the two freezes is the **zone line**, because
      // there is nothing else left to edit: a reopened trip follows its lists
      // again (plan 0136, section 6).
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk', 2);
      const id = await basket();

      await setStatus(id, FINISHED);
      expect(await rowsOf(id)).toEqual([[milk, 2]]);

      await setStatus(id, OPEN);
      expect(await rowsOf(id)).toEqual([]);

      await dataSource
        .getRepository(ListLine)
        .update({ id: milk }, { quantity: 7 });
      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([[milk, 7]]);
    });
  });

  describe('the invariant, across every transition (test 8)', () => {
    it('has rows exactly while the basket is not open', async () => {
      const flat = await list('Flat');
      await line(flat, 'Milk', 1);
      const id = await basket();

      const walk: [GeneratedListStatus, boolean][] = [
        [FINISHED, true],
        [ARCHIVED, true],
        [FINISHED, true],
        [OPEN, false],
        [ARCHIVED, true],
        [OPEN, false],
        [OPEN, false],
      ];

      for (const [status, hasRows] of walk) {
        await setStatus(id, status);
        expect([status, await statusOf(id)]).toEqual([status, status]);
        expect([status, (await rowsOf(id)).length > 0]).toEqual([
          status,
          hasRows,
        ]);
      }
    });

    it('holds when the sweep is what finished the basket (test 3)', async () => {
      // The sweep writes through `update`, so it takes the same transaction and
      // the same freeze. It is stated here rather than in the sweep's own unit
      // spec because what is asserted is the rows.
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk', 3);
      const id = await basket();

      await generated.update({
        userId: ids.shopper,
        generatedListId: id,
        status: FINISHED,
      });

      expect(await rowsOf(id)).toEqual([[milk, 3]]);
    });
  });

  describe('what a delete takes with it (test 9)', () => {
    it('deletes the trip rows and leaves the purchase behind', async () => {
      // The rows cascade on the basket. The purchase does not: it keeps its
      // `basketId` naming a row that is gone, which is what makes it a session
      // purchase (plan 0134).
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk', 1);
      const id = await basket();
      await bought(id, flat, milk, 1);
      const settlements = dataSource.getRepository(LineSettlement);
      await setStatus(id, FINISHED);
      expect(await rowsOf(id)).toEqual([[milk, 2]]);

      await generated.delete({ userId: ids.shopper, generatedListId: id });

      expect(await rowsOf(id)).toEqual([]);
      expect(await settlements.count({ where: { lineId: milk } })).toBe(1);
    });

    it('deletes them with the list the line was on', async () => {
      const flat = await list('Flat that goes');
      await line(flat, 'Milk', 1);
      const id = await basket();
      await setStatus(id, FINISHED);

      await dataSource.getRepository(ShoppingList).delete({ id: flat });

      expect(await rowsOf(id)).toEqual([]);
    });
  });

  describe('what the table refuses', () => {
    it('refuses a second row for one basket and line', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      const repo = dataSource.getRepository(BasketTripRow);
      await repo.insert({ basketId: id, listId: flat, lineId: milk, asked: 1 });

      await expect(
        repo.insert({ basketId: id, listId: flat, lineId: milk, asked: 2 })
      ).rejects.toThrow(/uq_basket_trip_rows_line/);
    });

    it('refuses a negative ask', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket();

      await expect(
        dataSource
          .getRepository(BasketTripRow)
          .insert({ basketId: id, listId: flat, lineId: milk, asked: -1 })
      ).rejects.toThrow(/ck_basket_trip_rows_asked/);
    });
  });
});
