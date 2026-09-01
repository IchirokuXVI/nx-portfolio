import {
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
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListLine,
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
    zoneLine: '',
    basket: '',
    owner: randomUUID(),
  };

  /** A basket line wanting `quantity`, with `settledQuantity` already applied. */
  async function seedLine(
    quantity: number,
    settledQuantity: number
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedListLine);
    const line = await repo.save(
      repo.create({
        generatedListId: ids.basket,
        content: 'Milk',
        quantity,
        settledQuantity,
        itemId: null,
        origin: GeneratedLineOrigin.DERIVED,
        targetListId: null,
        position: 1,
      })
    );
    return line.id;
  }

  /** One settlement on a basket line, at a stated moment so order is not a race. */
  async function seedSettlement(
    generatedListLineId: string,
    outcome: SettlementOutcome,
    createdAt: string
  ): Promise<void> {
    const repo = dataSource.getRepository(LineSettlement);
    const row = await repo.save(
      repo.create({
        lineId: ids.zoneLine,
        listId: ids.list,
        itemId: null,
        outcome,
        quantity: outcome === SettlementOutcome.BOUGHT ? 1 : 0,
        settledByUserId: ids.owner,
        settledAt: new Date(createdAt),
        generatedListLineId,
      })
    );
    // `createdAt` is what the lateral orders on and TypeORM fills it from the
    // clock, so it is set explicitly rather than left to the insert order.
    await repo.update({ id: row.id }, { createdAt: new Date(createdAt) });
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
      dataSource.getRepository(GeneratedListLine),
      {} as never,
      {} as never,
      dataSource.getRepository(LineSettlement),
      {} as never,
      fakeLineClaims({}).service,
      { emitToUsers: jest.fn() } as never
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
    const zoneLine = await dataSource.getRepository(ListLine).save(
      dataSource.getRepository(ListLine).create({
        listId: list.id,
        content: 'Milk',
        quantity: 1,
        position: 1,
        createdByUserId: ids.owner,
      })
    );
    ids.zoneLine = zoneLine.id;

    const basket = await dataSource.getRepository(GeneratedList).save(
      dataSource.getRepository(GeneratedList).create({
        ownerUserId: ids.owner,
        name: 'Saturday',
        status: GeneratedListStatus.ACTIVE,
        generatedAt: new Date('2026-02-01T10:00:00Z'),
        sourceSnapshot: { profileId: null, sources: [] },
        defaultTargetListId: null,
        idempotencyKey: null,
      })
    );
    ids.basket = basket.id;
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
    await dataSource.getRepository(LineSettlement).delete({ listId: ids.list });
    await dataSource
      .getRepository(GeneratedListLine)
      .delete({ generatedListId: ids.basket });
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
    const bought = await seedLine(1, 1);
    const missing = await seedLine(1, 1);
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
    const bought = await seedLine(1, 1);
    const missing = await seedLine(1, 1);
    await seedLine(2, 0);
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
    // Bought, then reported not available. The last act is what decided it,
    // which is exactly what the basket screen's own `lastOutcome` says.
    const line = await seedLine(1, 1);
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

  it('counts a line once however many origins its settle wrote a row for', async () => {
    // A settle writes one row per origin it touched, all carrying the same
    // outcome. The lateral takes one row per line, so this stays a count of
    // lines rather than becoming a count of settlements.
    const line = await seedLine(1, 1);
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
    const line = await seedLine(3, 2);
    await seedSettlement(
      line,
      SettlementOutcome.BOUGHT,
      '2026-02-01T11:00:00Z'
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
