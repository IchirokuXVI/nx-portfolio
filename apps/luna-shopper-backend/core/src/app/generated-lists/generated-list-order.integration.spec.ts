import {
  BasketKind,
  GeneratedListStatus,
  LineItemSource,
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
import { DataSource, In } from 'typeorm';
import {
  CORE_ENTITIES,
  GeneratedList,
  LineSettlement,
  ListLine,
  ListLineItem,
  ShoppingList,
  Zone,
  ZoneMembership,
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
 * ## What a visit is read from, since plan 0136 section 3.5
 *
 * It used to be a basket line: the text and the pick came off
 * `generated_list_lines`, and the settlement found its line through
 * `generatedListLineId`. A basket holds no copy of a line any more, so a visit
 * is a standing settlement of a trip joined to `list_lines` for the text and to
 * `list_line_items` for the products, with `min("settledAt")` per line as
 * before. So this file needs a zone, a list and real zone lines, where it used
 * to need none of them: a settlement with `lineId` and `listId` both null was a
 * waiting settlement, and plan 0136 section 9 deleted those rows and put both
 * columns back to `NOT NULL`.
 *
 * What the query learns **from** is plan 0141's; this file asserts only where it
 * reads.
 */
describeIntegration('the order a shopper walks (real Postgres)', () => {
  let dataSource: DataSource;
  let service: GeneratedListOrderService;

  /** Every basket this file wrote, dropped in `afterAll`. */
  const baskets: string[] = [];
  /** The one zone and list every line below sits on. */
  const ids = { owner: randomUUID(), zone: '', list: '' };
  let position = 0;

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
        status: GeneratedListStatus.FINISHED,
        generatedAt: new Date(generatedAt),
        kind: BasketKind.GENERATED,
        idempotencyKey: null,
      })
    );
    baskets.push(list.id);
    return list.id;
  }

  /**
   * A zone line, with the product its set holds.
   *
   * A line rather than a basket line: what a trip asked for is read from the
   * list it asked it of (plan 0136, section 3.5), so the text the order matches
   * on is the household's own.
   */
  async function seedLine(
    content: string,
    itemId: string | null = null
  ): Promise<string> {
    const lines = dataSource.getRepository(ListLine);
    position += 1;
    const line = await lines.save(
      lines.create({
        listId: ids.list,
        content,
        quantity: 1,
        position,
        createdByUserId: ids.owner,
      })
    );
    if (itemId) {
      const items = dataSource.getRepository(ListLineItem);
      await items.save(
        items.create({
          lineId: line.id,
          itemId,
          position: 0,
          source: LineItemSource.USER,
        })
      );
    }
    return line.id;
  }

  /**
   * One settling act of one trip, at a stated moment.
   *
   * The basket is on the settlement itself since plan 0134, which is what the
   * `trips` CTE asks ("has this basket a standing purchase") and what joins a
   * visit to the trip it happened on.
   */
  async function seedSettlement(
    basketId: string,
    lineId: string,
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
        lineId,
        listId: ids.list,
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
        basketId,
      })
    );
  }

  /** The query's own answer, which is what most of this file asserts on. */
  async function historyRows(owner: string): Promise<OrderHistoryRow[]> {
    return dataSource.query<OrderHistoryRow[]>(ORDER_HISTORY_SQL, [
      owner,
      [GeneratedListStatus.FINISHED, GeneratedListStatus.ARCHIVED],
      7,
    ]);
  }

  /** The offset the query reports for one line's text, in seconds. */
  function offsetOf(rows: OrderHistoryRow[], content: string): number | null {
    const row = rows.find((entry) => entry.content === content);
    return row ? row.offsetSeconds : null;
  }

  /**
   * Every product one visit can be matched by, which is what the service folds
   * the two item columns into (`itemIdsOf`).
   *
   * Asserted as the union rather than column by column, because the two are one
   * matching key: what the line's set held and what the shopper said they
   * actually got are both this shelf.
   */
  function itemsOf(rows: OrderHistoryRow[], content: string): string[] {
    const row = rows.find((entry) => entry.content === content);
    if (!row) {
      return [];
    }
    const ids = new Set(row.settledItemIds ?? []);
    if (row.pickItemId) {
      ids.add(row.pickItemId);
    }
    return [...ids].sort();
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

    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Walk order',
        joinCode: `WAL${Date.now()}`.slice(0, 16),
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
    const lists = dataSource.getRepository(ShoppingList);
    const list = await lists.save(
      lists.create({
        zoneId: zone.id,
        name: 'Weekly shop',
        createdByUserId: ids.owner,
      })
    );
    ids.list = list.id;
  });

  afterAll(async () => {
    if (baskets.length > 0) {
      // A settlement holds no foreign key into the basket on purpose, so it
      // survives the cascade and has to be deleted by hand.
      await dataSource
        .getRepository(LineSettlement)
        .delete({ basketId: In(baskets) });
      await dataSource.getRepository(GeneratedList).delete({ id: In(baskets) });
    }
    if (ids.zone) {
      // Lists, lines and their product sets cascade.
      await dataSource.getRepository(Zone).delete({ id: ids.zone });
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
        trip,
        await seedLine('Milk', MILK_ITEM),
        owner,
        '2026-03-07T12:00:00Z'
      );
      // Bought, taken back, and bought again half a minute after the start. The
      // reverted row is a minute **before** the start, so a query that counted
      // it would move the start as well as this line's own offset.
      const bread = await seedLine('Bread');
      await seedSettlement(trip, bread, owner, '2026-03-07T11:59:00Z', {
        reverted: true,
      });
      await seedSettlement(trip, bread, owner, '2026-03-07T12:00:30Z');
      // The shop did not have it, which is still a shelf the shopper stood at.
      await seedSettlement(
        trip,
        await seedLine('Eggs'),
        owner,
        '2026-03-07T12:00:10Z',
        { outcome: SettlementOutcome.NOT_AVAILABLE }
      );
      // Settled twice, in two shops. The first is when they stood there.
      const juice = await seedLine('Juice');
      await seedSettlement(trip, juice, owner, '2026-03-07T12:00:05Z');
      await seedSettlement(trip, juice, owner, '2026-03-07T12:02:00Z');
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

      expect(itemsOf(rows, 'Milk')).toEqual([MILK_ITEM]);
      expect(itemsOf(rows, 'Bread')).toEqual([]);
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
      await seedTrip(owner, '2026-04-01T10:00:00Z');
      // Newer still, and everything on it was taken back, which is the same
      // thing said a second way.
      const reverted = await seedTrip(owner, '2026-04-02T10:00:00Z');
      await seedSettlement(
        reverted,
        await seedLine('Taken back'),
        owner,
        '2026-04-02T12:00:00Z',
        { reverted: true }
      );
      // Eight settled trips, so the oldest falls outside the seven.
      for (let n = 1; n <= 8; n += 1) {
        const day = String(n).padStart(2, '0');
        const trip = await seedTrip(owner, `2026-03-${day}T10:00:00Z`);
        await seedSettlement(
          trip,
          await seedLine(`Trip ${day}`),
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

  /**
   * The permanent basket is excluded by its **kind** and not by its status (plan
   * 0134, section 5).
   *
   * It is asked with `OPEN` in the statuses, which the service never passes, for
   * exactly that reason: `ck_generated_lists_live_shape` requires a `LIVE` basket
   * to be `OPEN`, so a spec that passed the service's own two statuses would pass
   * with the kind predicate deleted.
   */
  describe('the permanent basket is no trip (plan 0134, section 5)', () => {
    const owner = randomUUID();

    beforeAll(async () => {
      // An open basket somebody composed, which the kind predicate admits.
      const repo = dataSource.getRepository(GeneratedList);
      const open = await repo.save(
        repo.create({
          ownerUserId: owner,
          name: 'Shopping now',
          status: GeneratedListStatus.OPEN,
          generatedAt: new Date('2026-05-01T10:00:00Z'),
          kind: BasketKind.GENERATED,
          idempotencyKey: null,
        })
      );
      baskets.push(open.id);
      await seedSettlement(
        open.id,
        await seedLine('Milk on an open trip'),
        owner,
        '2026-05-01T12:00:00Z'
      );

      // The permanent basket. It is settled, and it never ends, so counting it
      // would give the shopper one endless trip that crowds the seven out.
      // `OPEN` and unnamed is the shape `ck_generated_lists_live_shape` allows.
      const live = await repo.save(
        repo.create({
          ownerUserId: owner,
          name: null,
          status: GeneratedListStatus.OPEN,
          generatedAt: new Date('2026-05-02T10:00:00Z'),
          kind: BasketKind.LIVE,
          idempotencyKey: null,
        })
      );
      baskets.push(live.id);
      await seedSettlement(
        live.id,
        await seedLine('Bread on the permanent basket'),
        owner,
        '2026-05-02T12:00:00Z'
      );
    });

    it('leaves it out, however recently it was settled', async () => {
      const rows = await dataSource.query<OrderHistoryRow[]>(
        ORDER_HISTORY_SQL,
        [
          owner,
          [
            GeneratedListStatus.OPEN,
            GeneratedListStatus.FINISHED,
            GeneratedListStatus.ARCHIVED,
          ],
          7,
        ]
      );

      expect(rows.map((row) => row.content)).toEqual(['Milk on an open trip']);
    });
  });
});
