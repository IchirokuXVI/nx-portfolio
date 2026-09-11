import {
  GeneratedLineOrigin,
  GeneratedListStatus,
  SettlementOutcome,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource, In } from 'typeorm';
import {
  CORE_ENTITIES,
  GeneratedList,
  GeneratedListLine,
  LineSettlement,
} from '../entities';
import { GeneratedListOrderService } from './generated-list-order.service';
import { ORDER_HISTORY_SQL, type OrderHistoryRow } from './generated-list.sql';

/**
 * The order a shopper walks, against real Postgres (plan 0110, section 2).
 *
 * The unit spec beside this one owns the median, the two matching keys and the
 * A to Z tail. What it cannot own is the query, and everything interesting about
 * this query is Postgres's answer rather than the service's:
 *
 * - a reverted settlement is not a shelf the shopper stood at, and it must not
 *   move the trip's start either;
 * - a line closed as `NOT_AVAILABLE` **is** a shelf they stood at;
 * - a line settled twice, in two shops, counts from the first;
 * - a basket nobody settled anything in is not a trip and does not use up one of
 *   the seven.
 *
 * **One owner per describe block**, because the history is read per owner and
 * the two blocks seed trips that would otherwise fall inside each other's seven.
 *
 * Nothing here needs a zone or a list. A settlement with `lineId` and `listId`
 * both null is a waiting settlement (plan 0093), which is a perfectly ordinary
 * row, and it keeps the fixture to the three tables the query actually reads.
 */
describeIntegration('the order a shopper walks (real Postgres)', () => {
  let dataSource: DataSource;
  let service: GeneratedListOrderService;

  /** Every basket this file wrote, dropped in `afterAll`. */
  const baskets: string[] = [];

  /** A finished trip, generated at a stated moment so the seven are decidable. */
  async function seedTrip(
    ownerUserId: string,
    generatedAt: string
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedList);
    const list = await repo.save(
      repo.create({
        ownerUserId,
        name: null,
        status: GeneratedListStatus.COMPLETED,
        generatedAt: new Date(generatedAt),
        sourceSnapshot: {
          profileId: null,
          pricingProfileId: null,
          sources: [],
        },
        defaultTargetListId: null,
        idempotencyKey: null,
      })
    );
    baskets.push(list.id);
    return list.id;
  }

  /** One line of a trip, with the product the basket was pointing at. */
  async function seedLine(
    generatedListId: string,
    content: string,
    itemId: string | null = null
  ): Promise<string> {
    const repo = dataSource.getRepository(GeneratedListLine);
    const line = await repo.save(
      repo.create({
        generatedListId,
        content,
        quantity: 1,
        settledQuantity: 1,
        itemId,
        origin: GeneratedLineOrigin.DERIVED,
        targetListId: null,
        position: 1,
      })
    );
    return line.id;
  }

  /** One settling act on a basket line, at a stated moment. */
  async function seedSettlement(
    generatedListLineId: string,
    settledByUserId: string,
    settledAt: string,
    options: {
      outcome?: SettlementOutcome;
      itemId?: string | null;
      reverted?: boolean;
    } = {}
  ): Promise<void> {
    const outcome = options.outcome ?? SettlementOutcome.BOUGHT;
    const repo = dataSource.getRepository(LineSettlement);
    await repo.save(
      repo.create({
        lineId: null,
        listId: null,
        itemId: options.itemId ?? null,
        outcome,
        quantity: outcome === SettlementOutcome.BOUGHT ? 1 : 0,
        settledByUserId,
        settledByParticipantId: null,
        settledAt: new Date(settledAt),
        // Both columns together or neither, which is
        // `ck_line_settlements_revert` rather than a service rule.
        revertedAt: options.reverted ? new Date(settledAt) : null,
        revertedByParticipantId: options.reverted ? randomUUID() : null,
        generatedListLineId,
      })
    );
  }

  /** The query's own answer, which is what most of this file asserts on. */
  async function historyRows(owner: string): Promise<OrderHistoryRow[]> {
    return dataSource.query<OrderHistoryRow[]>(ORDER_HISTORY_SQL, [
      owner,
      [GeneratedListStatus.COMPLETED, GeneratedListStatus.ARCHIVED],
      7,
    ]);
  }

  /** The offset the query reports for one line's text, in seconds. */
  function offsetOf(rows: OrderHistoryRow[], content: string): number | null {
    const row = rows.find((entry) => entry.content === content);
    return row ? row.offsetSeconds : null;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    service = new GeneratedListOrderService(
      dataSource.getRepository(GeneratedList)
    );
  });

  afterAll(async () => {
    if (baskets.length > 0) {
      // A settlement holds no foreign key into the basket on purpose, so it
      // survives the cascade and has to be deleted by hand, line by line.
      const lines = await dataSource
        .getRepository(GeneratedListLine)
        .find({ where: { generatedListId: In(baskets) } });
      if (lines.length > 0) {
        await dataSource.getRepository(LineSettlement).delete({
          generatedListLineId: In(lines.map((line) => line.id)),
        });
      }
      await dataSource.getRepository(GeneratedList).delete({ id: In(baskets) });
    }
    await dataSource?.destroy();
  });

  describe('one trip', () => {
    const owner = randomUUID();
    const MILK_ITEM = 'a1a1a1a1-0000-4000-8000-000000000001';

    beforeAll(async () => {
      const trip = await seedTrip(owner, '2026-03-07T10:00:00Z');

      // The trip's start, and the only settlement that decides it.
      await seedSettlement(
        await seedLine(trip, 'Milk', MILK_ITEM),
        owner,
        '2026-03-07T12:00:00Z'
      );
      // Bought, taken back, and bought again half a minute after the start. The
      // reverted row is a minute **before** the start, so a query that counted
      // it would move the start as well as this line's own offset.
      const bread = await seedLine(trip, 'Bread');
      await seedSettlement(bread, owner, '2026-03-07T11:59:00Z', {
        reverted: true,
      });
      await seedSettlement(bread, owner, '2026-03-07T12:00:30Z');
      // The shop did not have it, which is still a shelf the shopper stood at.
      await seedSettlement(
        await seedLine(trip, 'Eggs'),
        owner,
        '2026-03-07T12:00:10Z',
        { outcome: SettlementOutcome.NOT_AVAILABLE }
      );
      // Settled twice, in two shops. The first is when they stood there.
      const juice = await seedLine(trip, 'Juice');
      await seedSettlement(juice, owner, '2026-03-07T12:00:05Z');
      await seedSettlement(juice, owner, '2026-03-07T12:02:00Z');
    });

    it('ignores a reverted settlement, in the offset and in the start', async () => {
      const rows = await historyRows(owner);

      expect(offsetOf(rows, 'Milk')).toBe(0);
      expect(offsetOf(rows, 'Bread')).toBe(30);
    });

    it('counts a line the shop did not have as a visit to the shelf', async () => {
      expect(offsetOf(await historyRows(owner), 'Eggs')).toBe(10);
    });

    it('counts a line settled twice from its first settlement', async () => {
      expect(offsetOf(await historyRows(owner), 'Juice')).toBe(5);
    });

    it('answers the products a line can be matched by', async () => {
      const rows = await historyRows(owner);

      expect(rows.find((row) => row.content === 'Milk')?.pickItemId).toBe(
        MILK_ITEM
      );
      expect(
        rows.find((row) => row.content === 'Bread')?.pickItemId
      ).toBeNull();
    });

    it('orders a basket composed afterwards by those offsets', async () => {
      const walked = await service.order(owner, [
        { content: 'Anchovies', options: [] },
        { content: 'Bread', options: [] },
        { content: 'milk', options: [] },
      ]);

      // Milk at 0 and bread at 30, and then the one this shopper has never
      // settled, which goes last however early in the alphabet it sits.
      expect(walked.map((line) => line.content)).toEqual([
        'milk',
        'Bread',
        'Anchovies',
      ]);
    });
  });

  describe('which trips count', () => {
    const owner = randomUUID();

    beforeAll(async () => {
      // Newer than every settled trip below and settled by nobody, so it must
      // not use up one of the seven.
      const unsettled = await seedTrip(owner, '2026-04-01T10:00:00Z');
      await seedLine(unsettled, 'Never settled');
      // Newer still, and everything on it was taken back, which is the same
      // thing said a second way.
      const reverted = await seedTrip(owner, '2026-04-02T10:00:00Z');
      await seedSettlement(
        await seedLine(reverted, 'Taken back'),
        owner,
        '2026-04-02T12:00:00Z',
        { reverted: true }
      );
      // Eight settled trips, so the oldest falls outside the seven.
      for (let n = 1; n <= 8; n += 1) {
        const day = String(n).padStart(2, '0');
        const trip = await seedTrip(owner, `2026-03-${day}T10:00:00Z`);
        await seedSettlement(
          await seedLine(trip, `Trip ${day}`),
          owner,
          `2026-03-${day}T12:00:00Z`
        );
      }
    });

    it('reads seven trips, counting only the ones something was settled on', async () => {
      const rows = await historyRows(owner);

      // The eight settled trips less the oldest, and neither of the two the
      // shopper settled nothing on.
      expect(rows.map((row) => row.content).sort()).toEqual([
        'Trip 02',
        'Trip 03',
        'Trip 04',
        'Trip 05',
        'Trip 06',
        'Trip 07',
        'Trip 08',
      ]);
    });
  });
});
