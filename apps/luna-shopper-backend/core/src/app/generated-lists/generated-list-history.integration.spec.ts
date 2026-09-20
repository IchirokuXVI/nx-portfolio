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
import { GeneratedListService } from './generated-list.service';
import { fakeLineClaims } from './line-claims.fake';

/**
 * What a history row says a run finished, against real Postgres (plan 0053,
 * section 2).
 *
 * The unit spec beside this one owns the defaults and the shape. What it cannot
 * own is the query, and the interesting half of this query is a
 * `LEFT JOIN LATERAL` picking each line's **newest** settlement so the two
 * outcome counts can be taken from it. Which settlement is newest, and whether a
 * line with several of them is counted once, are Postgres's answers.
 *
 * ## What it counts changed with plan 0136, section 7.4
 *
 * The counts used to be taken off `generated_list_lines`, where the basket kept
 * a copy of every row with its own `settledQuantity`. There is no copy any more,
 * so the counts are two reads split on the status: an **ended** trip counts its
 * `basket_trip_rows` against the standing settlements that name the basket, and
 * an open one is composed by `BasketReadService`. This file owns the first,
 * because that is the one that is a query.
 *
 * So the fixture is an ended basket, a frozen row per zone line, and settlements
 * carrying `basketId`. `left` is `asked - bought` and the outcome of the newest
 * settlement decides a line the trip did not finish, which is where the lateral
 * earns its place.
 *
 * The invariant worth protecting is the one that costs nothing to break by
 * accident: `settledLineCount` still means every finished line, and it is still
 * the sum of the two outcomes, because `NOT_AVAILABLE` closes a line's
 * outstanding amount exactly as a purchase does.
 */
describeIntegration('a run history row (real Postgres)', () => {
  let dataSource: DataSource;
  let generated: GeneratedListService;

  const ids = {
    zone: '',
    list: '',
    basket: '',
    owner: randomUUID(),
  };
  let position = 0;

  /**
   * A zone line this trip asked `asked` of, frozen as its finish would have
   * frozen it.
   *
   * One line per row, because `uq_basket_trip_rows_line` allows one row per
   * basket and zone line: a trip has one ask of a line, however many purchases
   * it made against it.
   */
  async function seedRow(asked: number): Promise<string> {
    const lines = dataSource.getRepository(ListLine);
    position += 1;
    const line = await lines.save(
      lines.create({
        listId: ids.list,
        content: 'Milk',
        quantity: 0,
        position,
        createdByUserId: ids.owner,
      })
    );
    await dataSource.getRepository(BasketTripRow).insert({
      basketId: ids.basket,
      listId: ids.list,
      lineId: line.id,
      asked,
    });
    return line.id;
  }

  /**
   * One standing purchase of a zone line, made through this basket, at a stated
   * moment so which one is newest is not a race.
   *
   * The lateral orders on `("settledAt", id)`, so no `createdAt` is written by
   * hand: what decides the last act of a row is when it was settled.
   */
  async function seedSettlement(
    lineId: string,
    outcome: SettlementOutcome,
    settledAt: string,
    quantity = outcome === SettlementOutcome.BOUGHT ? 1 : 0
  ): Promise<void> {
    const repo = dataSource.getRepository(LineSettlement);
    await repo.save(
      repo.create({
        lineId,
        listId: ids.list,
        itemId: null,
        outcome,
        quantity,
        settledByUserId: ids.owner,
        settledByParticipantId: null,
        settledAt: new Date(settledAt),
        revertedAt: null,
        basketId: ids.basket,
      })
    );
  }

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
      {} as never,
      fakeLineClaims({}).service,
      { emitToUsers: jest.fn() } as never,
      {} as never,
      {} as never,
      dataSource.getRepository(BasketSource),
      {} as never,
      // The open basket's counts, which this fixture never reaches: the basket
      // below is `FINISHED`, so every number comes off its frozen rows.
      {} as never
    );

    const zone = await dataSource.getRepository(Zone).save(
      dataSource.getRepository(Zone).create({
        name: 'Home',
        joinCode: `HIS${Date.now()}`.slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: ids.owner,
        config: {},
      })
    );
    ids.zone = zone.id;
    await dataSource.getRepository(ZoneMembership).save(
      dataSource.getRepository(ZoneMembership).create({
        zoneId: zone.id,
        userId: ids.owner,
        username: 'Owner',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
    const list = await dataSource.getRepository(ShoppingList).save(
      dataSource.getRepository(ShoppingList).create({
        zoneId: zone.id,
        name: 'Weekly shop',
        createdByUserId: ids.owner,
      })
    );
    ids.list = list.id;

    // Ended, because an ended trip is what answers from its frozen rows. An
    // open basket's four numbers are composed by `BasketReadService` and belong
    // to that service's own specs.
    const basket = await dataSource.getRepository(GeneratedList).save(
      dataSource.getRepository(GeneratedList).create({
        ownerUserId: ids.owner,
        name: 'Saturday',
        status: GeneratedListStatus.FINISHED,
        generatedAt: new Date('2026-02-01T10:00:00Z'),
        kind: BasketKind.GENERATED,
        idempotencyKey: null,
      })
    );
    ids.basket = basket.id;
    const sources = dataSource.getRepository(BasketSource);
    await sources.save(
      sources.create({
        basketId: basket.id,
        zoneId: zone.id,
        listId: list.id,
      })
    );
  });

  afterAll(async () => {
    if (ids.basket) {
      await dataSource.getRepository(GeneratedList).delete({ id: ids.basket });
    }
    if (ids.zone) {
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
    }
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    // The settlements go first: a line cascades them, and the trip rows carry a
    // foreign key onto the line.
    await dataSource.getRepository(LineSettlement).delete({ listId: ids.list });
    await dataSource
      .getRepository(BasketTripRow)
      .delete({ basketId: ids.basket });
    await dataSource.getRepository(ListLine).delete({ listId: ids.list });
  });

  async function row() {
    const page = await generated.listMine({ userId: ids.owner });
    const found = page.items.find((item) => item.id === ids.basket);
    if (!found) {
      throw new Error('the basket seeded by this suite was not listed');
    }
    return found;
  }

  it('splits the finished lines into what was bought and what was not there', async () => {
    const bought = await seedRow(1);
    const missing = await seedRow(1);
    await seedSettlement(
      bought,
      SettlementOutcome.BOUGHT,
      '2026-02-01T11:00:00Z'
    );
    await seedSettlement(
      missing,
      SettlementOutcome.NOT_AVAILABLE,
      '2026-02-01T11:05:00Z'
    );

    expect(await row()).toMatchObject({
      lineCount: 2,
      settledLineCount: 2,
      boughtLineCount: 1,
      notAvailableLineCount: 1,
    });
  });

  it('keeps `settledLineCount` as the sum, so nothing reading it changes', async () => {
    const bought = await seedRow(1);
    const missing = await seedRow(1);
    await seedRow(2);
    await seedSettlement(
      bought,
      SettlementOutcome.BOUGHT,
      '2026-02-01T11:00:00Z'
    );
    await seedSettlement(
      missing,
      SettlementOutcome.NOT_AVAILABLE,
      '2026-02-01T11:05:00Z'
    );

    const summary = await row();

    expect(summary.settledLineCount).toBe(2);
    expect(summary.boughtLineCount + summary.notAvailableLineCount).toBe(
      summary.settledLineCount
    );
    expect(summary.lineCount).toBe(3);
  });

  it('reads the newest settlement, not the first one', async () => {
    // Bought once of two, then reported not available. The last act is what
    // decided it, which is exactly what the basket screen's own state says.
    //
    // It takes a line the trip did **not** finish, which is plan 0136's
    // reversal of the shape this test used to have: `left = asked - bought`
    // decides first, so a line bought all the way through is counted as bought
    // whatever was said about it afterwards. `NOT_AVAILABLE` answers for a row
    // that still has something outstanding, and nothing else.
    const line = await seedRow(2);
    await seedSettlement(
      line,
      SettlementOutcome.BOUGHT,
      '2026-02-01T11:00:00Z'
    );
    await seedSettlement(
      line,
      SettlementOutcome.NOT_AVAILABLE,
      '2026-02-01T12:00:00Z'
    );

    expect(await row()).toMatchObject({
      settledLineCount: 1,
      boughtLineCount: 0,
      notAvailableLineCount: 1,
    });
  });

  it('counts a line once however many purchases the trip made against it', async () => {
    // A trip buys three of a line in three taps, and the counts are a count of
    // lines rather than of settlements: the lateral folds them into one `bought`
    // and one last outcome per frozen row.
    const line = await seedRow(3);
    await seedSettlement(
      line,
      SettlementOutcome.BOUGHT,
      '2026-02-01T11:00:00Z'
    );
    await seedSettlement(
      line,
      SettlementOutcome.BOUGHT,
      '2026-02-01T11:00:01Z'
    );
    await seedSettlement(
      line,
      SettlementOutcome.BOUGHT,
      '2026-02-01T11:00:02Z'
    );

    expect(await row()).toMatchObject({
      lineCount: 1,
      settledLineCount: 1,
      boughtLineCount: 1,
    });
  });

  it('counts an unfinished line in neither outcome, even when it has been settled once', async () => {
    // Cumulative settling: two of three bought is progress, not a finished line.
    const line = await seedRow(3);
    await seedSettlement(
      line,
      SettlementOutcome.BOUGHT,
      '2026-02-01T11:00:00Z',
      2
    );

    expect(await row()).toMatchObject({
      lineCount: 1,
      settledLineCount: 0,
      boughtLineCount: 0,
      notAvailableLineCount: 0,
    });
  });

  it('answers zeros for a basket with no lines at all', async () => {
    expect(await row()).toMatchObject({
      lineCount: 0,
      settledLineCount: 0,
      boughtLineCount: 0,
      notAvailableLineCount: 0,
    });
  });
});
