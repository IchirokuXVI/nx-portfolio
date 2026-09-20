import {
  BasketKind,
  GeneratedLineOrigin,
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
  GeneratedListLine,
  GeneratedListLineOption,
  GeneratedListLineOrigin,
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
      dataSource.getRepository(GeneratedListLine),
      dataSource.getRepository(GeneratedListLineOrigin),
      dataSource.getRepository(GeneratedListLineOption),
      dataSource.getRepository(LineSettlement),
      // The run's profile resolution and walk order, which no write here asks.
      undefined as never,
      fakeLineClaims({}).service,
      { emitTo: jest.fn(), emitToUsers: jest.fn() } as never,
      undefined as never,
      { liveRegistered: async () => [] } as never,
      dataSource.getRepository(BasketSource),
      tripRows
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
    if (ids.zone) {
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  async function list(name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    const saved = await repo.save(
      repo.create({ zoneId: ids.zone, name, createdByUserId: ids.shopper })
    );
    return saved.id;
  }

  async function line(listId: string, content: string): Promise<string> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        listId,
        content,
        quantity: 5,
        position,
        createdByUserId: ids.shopper,
      })
    );
    return saved.id;
  }

  async function basket(status = OPEN): Promise<string> {
    const repo = dataSource.getRepository(GeneratedList);
    const saved = await repo.save(
      repo.create({
        ownerUserId: ids.shopper,
        name: 'Saturday',
        status,
        generatedAt: new Date('2026-03-01T10:00:00Z'),
        kind: BasketKind.GENERATED,
        defaultTargetListId: null,
        idempotencyKey: null,
      })
    );
    return saved.id;
  }

  async function basketLine(generatedListId: string): Promise<string> {
    const repo = dataSource.getRepository(GeneratedListLine);
    position += 1;
    const saved = await repo.save(
      repo.create({
        generatedListId,
        content: 'Basket line',
        quantity: 1,
        settledQuantity: 0,
        itemId: null,
        origin: GeneratedLineOrigin.DERIVED,
        targetListId: null,
        position,
      })
    );
    return saved.id;
  }

  async function origin(
    generatedListLineId: string,
    listId: string,
    lineId: string,
    quantity: number
  ): Promise<void> {
    const repo = dataSource.getRepository(GeneratedListLineOrigin);
    await repo.save(
      repo.create({
        generatedListLineId,
        zoneId: ids.zone,
        listId,
        lineId,
        quantity,
        lineVersion: 1,
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
    it('sums the sibling basket lines of one zone line into one row', async () => {
      // Plan 0094: two basket lines of one basket can each carry a part of one
      // ask, and the trip asked for the sum.
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const bread = await line(flat, 'Bread');
      const id = await basket();
      const whole = await basketLine(id);
      const skimmed = await basketLine(id);
      await origin(whole, flat, milk, 2);
      await origin(skimmed, flat, milk, 3);
      await origin(whole, flat, bread, 1);

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual(
        [
          [milk, 5],
          [bread, 1],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      );
    });

    it('writes a row for an origin taken back to zero', async () => {
      // Zero is a value: a trip that stopped asking still asked, and today it is
      // still a row of the trip with the outcome `NOT_BOUGHT`.
      const flat = await list('Flat with a zero');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      await origin(await basketLine(id), flat, milk, 0);

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([[milk, 0]]);
    });

    it('copies the list from the line and not from the origin', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      await origin(await basketLine(id), flat, milk, 2);

      await setStatus(id, FINISHED);

      const [row] = await dataSource
        .getRepository(BasketTripRow)
        .find({ where: { basketId: id } });
      expect(row.listId).toBe(flat);
    });
  });

  describe('which origins the freeze can write (test 6)', () => {
    it('skips an origin whose line no longer exists', async () => {
      // An origin carries no foreign key on `lineId` (plan 0050), so it can name
      // a line that is gone. A trip row carries one, and the inner join is what
      // makes the two agree. Nothing is lost: `basket_rows` drops the same
      // origin on every read today.
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      const carrier = await basketLine(id);
      await origin(carrier, flat, milk, 2);
      await origin(carrier, flat, randomUUID(), 3);

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([[milk, 2]]);
    });

    it('writes a soft deleted line’s row like any other', async () => {
      // Since plan 0132 a deleted line is still a row, so it is frozen, and the
      // trips read decides whether to draw it, as it does for an open basket.
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      await origin(await basketLine(id), flat, milk, 4);
      await dataSource.getRepository(ListLine).softDelete({ id: milk });

      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([[milk, 4]]);
    });
  });

  describe('freezing twice, and thawing between (test 7)', () => {
    it('is one set of rows however many times it runs', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      await origin(await basketLine(id), flat, milk, 2);

      await tripRows.freeze(dataSource.manager, id);
      await tripRows.freeze(dataSource.manager, id);

      expect(await rowsOf(id)).toEqual([[milk, 2]]);
    });

    it('reads the edited number after a thaw and a second freeze', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      const carrier = await basketLine(id);
      await origin(carrier, flat, milk, 2);

      await setStatus(id, FINISHED);
      expect(await rowsOf(id)).toEqual([[milk, 2]]);

      await setStatus(id, OPEN);
      expect(await rowsOf(id)).toEqual([]);

      await dataSource
        .getRepository(GeneratedListLineOrigin)
        .update(
          { generatedListLineId: carrier, lineId: milk },
          { quantity: 7 }
        );
      await setStatus(id, FINISHED);

      expect(await rowsOf(id)).toEqual([[milk, 7]]);
    });
  });

  describe('the invariant, across every transition (test 8)', () => {
    it('has rows exactly while the basket is not open', async () => {
      const flat = await list('Flat');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      await origin(await basketLine(id), flat, milk, 1);

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
      const milk = await line(flat, 'Milk');
      const id = await basket();
      await origin(await basketLine(id), flat, milk, 3);

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
      const milk = await line(flat, 'Milk');
      const id = await basket();
      const carrier = await basketLine(id);
      await origin(carrier, flat, milk, 2);
      const settlements = dataSource.getRepository(LineSettlement);
      await settlements.save(
        settlements.create({
          lineId: milk,
          listId: flat,
          itemId: null,
          outcome: SettlementOutcome.BOUGHT,
          quantity: 1,
          settledByUserId: ids.shopper,
          settledByParticipantId: null,
          settledAt: new Date('2026-03-01T11:00:00Z'),
          revertedAt: null,
          generatedListLineId: carrier,
          basketId: id,
        })
      );
      await setStatus(id, FINISHED);
      expect(await rowsOf(id)).toEqual([[milk, 2]]);

      await generated.delete({ userId: ids.shopper, generatedListId: id });

      expect(await rowsOf(id)).toEqual([]);
      expect(await settlements.count({ where: { lineId: milk } })).toBe(1);
    });

    it('deletes them with the list the line was on', async () => {
      const flat = await list('Flat that goes');
      const milk = await line(flat, 'Milk');
      const id = await basket();
      await origin(await basketLine(id), flat, milk, 1);
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
