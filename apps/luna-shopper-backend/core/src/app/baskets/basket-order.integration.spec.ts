import {
  BasketKind,
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
import { DataSource, In } from 'typeorm';
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
import { BasketCoverageService } from './basket-coverage.service';
import {
  BasketOrderService,
  WALK_HISTORY_HORIZON_MS,
  WALK_SESSIONS,
} from './basket-order.service';
import { WALK_HISTORY_SQL, type WalkHistoryRow } from './basket-order.sql';
import { BasketReadService } from './basket-read.service';
import { BasketRedaction } from './basket-redaction';
import { fakeBasketMarks } from './changes/basket-marks.fake';

/**
 * The order a shopper walks, against real Postgres (plan 0141, section 8).
 *
 * The unit spec beside this one owns the median, the two matching keys and the A
 * to Z tail. What it cannot own is the query, and everything interesting about
 * this query is Postgres's answer rather than the service's: what a session is,
 * which sessions have ended, which purchases belong to the owner's walk, and
 * what the horizon cuts are all a `WHERE` or a window.
 *
 * **One owner per describe block**, because the history is read per owner and
 * two blocks would otherwise seed sessions inside each other's seven.
 *
 * **No fixed calendar date anywhere.** Every timestamp is built from `NOW`,
 * which is read once when the file loads, and `NOW` is what the query is asked
 * with. A spec pinned to a date passes until that date and then reddens every
 * pull request.
 */
describeIntegration('the order a shopper walks (real Postgres)', () => {
  let dataSource: DataSource;

  /** Every basket this file wrote, dropped in `afterAll`. */
  const baskets: string[] = [];
  /** Every zone this file wrote. Lists, lines and product sets cascade. */
  const zones: string[] = [];
  /** The one zone and list most lines below sit on. */
  const ids = { author: randomUUID(), zone: '', list: '' };
  let position = 0;

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  /** Read once, and the only clock this file has. */
  const NOW = new Date();
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  // --- fixtures ------------------------------------------------------------

  async function seedZone(ownerUserId: string, name: string): Promise<string> {
    const repo = dataSource.getRepository(Zone);
    const zone = await repo.save(
      repo.create({
        name,
        joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId,
        config: {},
      })
    );
    zones.push(zone.id);
    const memberships = dataSource.getRepository(ZoneMembership);
    await memberships.save(
      memberships.create({
        zoneId: zone.id,
        userId: ownerUserId,
        username: 'Owner',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
    return zone.id;
  }

  async function seedList(zoneId: string, name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    const list = await repo.save(
      repo.create({ zoneId, name, createdByUserId: ids.author })
    );
    return list.id;
  }

  /** A basket of one owner. `LIVE` is one per person, so give it its own. */
  async function seedBasket(
    ownerUserId: string,
    kind = BasketKind.GENERATED,
    status = BasketStatus.OPEN
  ): Promise<string> {
    const repo = dataSource.getRepository(Basket);
    const basket = await repo.save(
      repo.create({
        ownerUserId,
        // `ck_baskets_live_shape` wants the permanent basket unnamed
        // and open.
        name: kind === BasketKind.LIVE ? null : 'Saturday',
        status: kind === BasketKind.LIVE ? BasketStatus.OPEN : status,
        generatedAt: NOW,
        kind,
        idempotencyKey: null,
      })
    );
    baskets.push(basket.id);
    return basket.id;
  }

  /**
   * A zone line, which is where the text the order matches on lives.
   *
   * A zone line rather than a basket line: plan 0136 deleted the basket's own
   * copy, so what a past purchase names is the household's own line, under the
   * text it carries **now**.
   */
  async function seedLine(
    content: string,
    listId = ids.list
  ): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    return repo.save(
      repo.create({
        listId,
        content,
        quantity: 2,
        position,
        createdByUserId: ids.author,
        approvalStatus: LineApprovalStatus.APPROVED,
      })
    );
  }

  /** One settling act, at a stated moment, through a stated basket or none. */
  async function settle(
    basketId: string | null,
    line: ListLine,
    settledAt: Date,
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
        lineId: line.id,
        listId: line.listId,
        itemId: options.itemId ?? null,
        outcome,
        quantity: outcome === SettlementOutcome.BOUGHT ? 1 : 0,
        settledByUserId: ids.author,
        settledByParticipantId: null,
        settledAt,
        // Both columns together or neither, which is
        // `ck_line_settlements_revert` rather than a service rule.
        revertedAt: options.reverted ? settledAt : null,
        revertedByParticipantId: options.reverted ? randomUUID() : null,
        basketId,
      })
    );
  }

  /** The query's own answer, which is what most of this file asserts on. */
  async function historyRows(
    owner: string,
    now: Date = NOW
  ): Promise<WalkHistoryRow[]> {
    return dataSource.query<WalkHistoryRow[]>(WALK_HISTORY_SQL, [
      owner,
      new Date(now.getTime() - WALK_HISTORY_HORIZON_MS),
      PURCHASE_SESSION_GAP_MS,
      now,
      WALK_SESSIONS,
    ]);
  }

  /** The texts the history answers, sorted, so a set is comparable. */
  const shelvesOf = (rows: WalkHistoryRow[]): string[] =>
    rows.map((row) => row.content).sort();

  /** How many sessions the answer holds. */
  const sessionsOf = (rows: WalkHistoryRow[]): number =>
    new Set(rows.map((row) => row.sessionId)).size;

  /** The offset the query reports for one shelf, in seconds. */
  function offsetOf(rows: WalkHistoryRow[], content: string): number | null {
    const row = rows.find((entry) => entry.content === content);
    return row ? row.offsetSeconds : null;
  }

  /** The service's own answer: the contents, in the order it drew them. */
  async function ordered(
    owner: string,
    contents: string[],
    now: Date = NOW
  ): Promise<string[]> {
    const service = new BasketOrderService(dataSource);
    const rows = contents.map((content) => ({
      key: `key-${content}`,
      content,
      optionIds: [] as string[],
    }));
    return (await service.order(owner, rows, now)).map((row) => row.content);
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    ids.zone = await seedZone(ids.author, 'Walk order');
    ids.list = await seedList(ids.zone, 'Weekly shop');
  });

  afterAll(async () => {
    if (baskets.length > 0) {
      // A settlement holds no foreign key into the basket on purpose, so it
      // survives the cascade and has to be deleted by hand.
      await dataSource
        .getRepository(LineSettlement)
        .delete({ basketId: In(baskets) });
      await dataSource.getRepository(Basket).delete({ id: In(baskets) });
    }
    for (const zoneId of zones) {
      await dataSource.getRepository(Zone).delete({ id: zoneId });
    }
    await dataSource?.destroy();
  });

  // --- 8. what a session is ------------------------------------------------

  describe('where one session ends and the next begins (test 8)', () => {
    const owner = randomUUID();

    beforeAll(async () => {
      const basket = await seedBasket(owner);
      // Five hours apart: one shop, with a long queue in it.
      await settle(basket, await seedLine('Close A'), ago(4 * DAY));
      await settle(basket, await seedLine('Close B'), ago(4 * DAY - 5 * HOUR));
      // Exactly one gap after the second, which **continues** the session, the
      // same way `continuesPurchaseSession` reads a gap of exactly this long.
      await settle(
        basket,
        await seedLine('Exactly a gap later'),
        ago(4 * DAY - 5 * HOUR - PURCHASE_SESSION_GAP_MS)
      );
      // Seven hours after that, which is a second shop.
      await settle(
        basket,
        await seedLine('Far'),
        ago(4 * DAY - 5 * HOUR - PURCHASE_SESSION_GAP_MS - 7 * HOUR)
      );
    });

    it('joins purchases inside a gap and splits them outside it', async () => {
      const rows = await historyRows(owner);

      expect(sessionsOf(rows)).toBe(2);
      expect(shelvesOf(rows)).toEqual([
        'Close A',
        'Close B',
        'Exactly a gap later',
        'Far',
      ]);
    });

    it('measures each shelf from the start of its own session', async () => {
      const rows = await historyRows(owner);

      expect(offsetOf(rows, 'Close A')).toBe(0);
      expect(offsetOf(rows, 'Close B')).toBe((5 * HOUR) / SECOND);
      expect(offsetOf(rows, 'Exactly a gap later')).toBe(
        (5 * HOUR + PURCHASE_SESSION_GAP_MS) / SECOND
      );
      // The second session's only purchase, which starts it.
      expect(offsetOf(rows, 'Far')).toBe(0);
    });
  });

  // --- 9 and 10. the current session teaches nothing -----------------------

  describe('the session being shopped is left out (tests 9 and 10)', () => {
    const owner = randomUUID();

    beforeAll(async () => {
      const older = await seedBasket(owner);
      await settle(older, await seedLine('Milk'), ago(2 * DAY));
      await settle(older, await seedLine('Bread'), ago(2 * DAY - 30 * SECOND));
      // The shop happening now: one hour old, so the session has not ended.
      const current = await seedBasket(owner);
      await settle(current, await seedLine('Juice'), ago(1 * HOUR));
    });

    it('leaves the current session out and keeps the order the older ones teach', async () => {
      const rows = await historyRows(owner);

      expect(shelvesOf(rows)).toEqual(['Bread', 'Milk']);
      // Juice was bought first in the shop that is running, and it still comes
      // last, because a row must not move under the thumb about to tap it.
      expect(await ordered(owner, ['Juice', 'Bread', 'Milk'])).toEqual([
        'Milk',
        'Bread',
        'Juice',
      ]);
    });

    it('takes the session in once it has ended', async () => {
      const later = new Date(NOW.getTime() + 7 * HOUR);

      expect(shelvesOf(await historyRows(owner, later))).toEqual([
        'Bread',
        'Juice',
        'Milk',
      ]);
      // Juice starts its own session, so it sits at zero and leads.
      expect(await ordered(owner, ['Milk', 'Bread', 'Juice'], later)).toEqual([
        'Juice',
        'Milk',
        'Bread',
      ]);
    });

    it('does not move a row when something is settled mid shop', async () => {
      const before = await ordered(owner, ['Juice', 'Bread', 'Milk']);

      // A purchase in the session that is running, which is exactly what a
      // shopper does between two reads of the same screen.
      const current = await seedBasket(owner);
      await settle(current, await seedLine('Butter'), ago(5 * MINUTE));

      expect(await ordered(owner, ['Juice', 'Bread', 'Milk'])).toEqual(before);
    });
  });

  // --- 11. which purchases count -------------------------------------------

  describe('which purchases are a shelf the shopper stood at (test 11)', () => {
    const owner = randomUUID();

    beforeAll(async () => {
      const basket = await seedBasket(owner);
      const start = ago(2 * DAY);
      await settle(basket, await seedLine('Milk'), start);
      // Bought, taken back, and bought again half a minute after the start. The
      // reverted row is a minute **before** the start, so a query that counted
      // it would move the start as well as this line's own offset.
      const bread = await seedLine('Bread');
      await settle(basket, bread, new Date(start.getTime() - MINUTE), {
        reverted: true,
      });
      await settle(basket, bread, new Date(start.getTime() + 30 * SECOND));
      // The shop did not have it, which is still a shelf they stood at.
      await settle(
        basket,
        await seedLine('Eggs'),
        new Date(start.getTime() + 10 * SECOND),
        { outcome: SettlementOutcome.NOT_AVAILABLE }
      );
      // Settled twice in one session. The first is when they stood there.
      const juice = await seedLine('Juice');
      await settle(basket, juice, new Date(start.getTime() + 5 * SECOND));
      await settle(basket, juice, new Date(start.getTime() + 2 * MINUTE));
    });

    it('ignores a reverted purchase, in the offset and in the start', async () => {
      const rows = await historyRows(owner);

      expect(offsetOf(rows, 'Milk')).toBe(0);
      expect(offsetOf(rows, 'Bread')).toBe(30);
    });

    it('counts a line the shop did not have as a visit to the shelf', async () => {
      expect(offsetOf(await historyRows(owner), 'Eggs')).toBe(10);
    });

    it('counts a line settled twice from its first purchase', async () => {
      expect(offsetOf(await historyRows(owner), 'Juice')).toBe(5);
    });
  });

  // --- 12. how many sessions -----------------------------------------------

  describe('how far back the history reaches (test 12)', () => {
    const owner = randomUUID();

    beforeAll(async () => {
      const basket = await seedBasket(owner);
      // Eight sessions, a day apart, so the oldest falls outside the seven.
      for (let n = 1; n <= 8; n += 1) {
        await settle(basket, await seedLine(`Session ${n}`), ago(n * DAY));
      }
    });

    it('reads the seven newest ended sessions and no eighth', async () => {
      const rows = await historyRows(owner);

      expect(sessionsOf(rows)).toBe(WALK_SESSIONS);
      expect(shelvesOf(rows)).toEqual([
        'Session 1',
        'Session 2',
        'Session 3',
        'Session 4',
        'Session 5',
        'Session 6',
        'Session 7',
      ]);
    });
  });

  // --- 13. whose purchases -------------------------------------------------

  describe('whose walk the history is (test 13)', () => {
    const owner = randomUUID();
    const stranger = randomUUID();

    beforeAll(async () => {
      const start = ago(3 * DAY);
      const generated = await seedBasket(owner);
      await settle(generated, await seedLine('On the trip'), start);
      // The permanent basket of the **same** owner, an hour later. One shop.
      const live = await seedBasket(owner, BasketKind.LIVE);
      await settle(
        live,
        await seedLine('On the permanent basket'),
        new Date(start.getTime() + HOUR)
      );
      // Somebody else's basket, in the same hour. Their walk, not this one.
      const theirs = await seedBasket(stranger);
      await settle(
        theirs,
        await seedLine('Somebody else'),
        new Date(start.getTime() + 2 * HOUR)
      );
      // Settled by hand on the list page, from the sofa. It says nothing about
      // a shop (plan 0141, section 3.1).
      await settle(
        null,
        await seedLine('By hand at home'),
        new Date(start.getTime() + 3 * HOUR)
      );
    });

    it('is one session across every basket the owner owns', async () => {
      const rows = await historyRows(owner);

      expect(sessionsOf(rows)).toBe(1);
      expect(shelvesOf(rows)).toEqual([
        'On the permanent basket',
        'On the trip',
      ]);
      expect(offsetOf(rows, 'On the permanent basket')).toBe(HOUR / SECOND);
    });

    it('holds nobody else and nothing settled off a basket', async () => {
      const rows = await historyRows(owner);

      expect(shelvesOf(rows)).not.toContain('Somebody else');
      expect(shelvesOf(rows)).not.toContain('By hand at home');
    });
  });

  // --- 14. the horizon -----------------------------------------------------

  describe('a session the horizon cut in half (test 14)', () => {
    const owner = randomUUID();
    const horizon = new Date(NOW.getTime() - WALK_HISTORY_HORIZON_MS);

    beforeAll(async () => {
      const basket = await seedBasket(owner);
      // Starts less than a gap after the horizon, so it can have begun before
      // it, and every offset it reports would be too small.
      await settle(
        basket,
        await seedLine('Cut in half'),
        new Date(horizon.getTime() + HOUR)
      );
      await settle(
        basket,
        await seedLine('Cut in half, later'),
        new Date(horizon.getTime() + 2 * HOUR)
      );
      // Seven hours after that, so it is a session of its own and it starts
      // more than a gap after the horizon.
      await settle(
        basket,
        await seedLine('Whole'),
        new Date(horizon.getTime() + 9 * HOUR)
      );
    });

    it('drops the cut session whole and keeps the one that starts a gap later', async () => {
      expect(shelvesOf(await historyRows(owner))).toEqual(['Whole']);
    });
  });

  // --- 15. a line that went ------------------------------------------------

  describe('a purchase on a line that was taken off the list (test 15)', () => {
    const owner = randomUUID();

    beforeAll(async () => {
      const basket = await seedBasket(owner);
      const lines = dataSource.getRepository(ListLine);
      const olives = await seedLine('Aceitunas');
      await settle(basket, olives, ago(2 * DAY));
      // Renamed and then removed. Plan 0132 keeps the row and its purchases.
      await lines.update({ id: olives.id }, { content: 'Olives' });
      await lines.softDelete({ id: olives.id });
    });

    it('still teaches its shelf, under the text the line has now', async () => {
      const rows = await historyRows(owner);

      expect(shelvesOf(rows)).toEqual(['Olives']);
    });
  });

  // --- 16. what it costs ---------------------------------------------------

  describe('what one order costs (test 16)', () => {
    const owner = randomUUID();

    it('is one statement, and none at all for a basket with no rows', async () => {
      let statements = 0;
      const counted = {
        query: (sql: string, params?: unknown[]) => {
          statements += 1;
          return dataSource.query(sql, params);
        },
      };
      const service = new BasketOrderService(counted as never);

      await service.order(
        owner,
        [{ key: 'k1', content: 'Milk', optionIds: [] }],
        NOW
      );
      expect(statements).toBe(1);

      await service.order(owner, [], NOW);
      expect(statements).toBe(1);
    });
  });

  // --- 17. through the basket read -----------------------------------------

  describe('the rows the basket read answers (test 17)', () => {
    let read: BasketReadService;

    /** A world of its own: `uq_baskets_live_owner` is one per person. */
    async function world(kind: BasketKind): Promise<{
      basket: Basket;
      listIds: string[];
    }> {
      const owner = randomUUID();
      const zoneId = await seedZone(owner, `Read ${kind}`);
      const listId = await seedList(zoneId, 'Weekly');

      // Three lines, created in the reverse of the order the owner walks them,
      // so a read that answered them in position order would fail.
      for (const content of ['Juice', 'Bread', 'Milk']) {
        await seedLine(content, listId);
      }

      // What the owner walked, on an **earlier** basket, so nothing on the
      // basket under test is already bought.
      const past = await seedBasket(owner, BasketKind.GENERATED);
      const start = ago(2 * DAY);
      await settle(past, await seedLine('Milk', listId), start);
      await settle(
        past,
        await seedLine('Bread', listId),
        new Date(start.getTime() + 30 * SECOND)
      );
      await settle(
        past,
        await seedLine('Juice', listId),
        new Date(start.getTime() + 60 * SECOND)
      );

      const basketId = await seedBasket(owner, kind);
      const basket = await dataSource
        .getRepository(Basket)
        .findOneOrFail({ where: { id: basketId } });
      if (kind === BasketKind.GENERATED) {
        const sources = dataSource.getRepository(BasketSource);
        await sources.save(sources.create({ basketId, zoneId, listId }));
      }
      return { basket, listIds: [listId] };
    }

    beforeAll(() => {
      const repo = dataSource.getRepository(Basket);
      read = new BasketReadService(
        repo,
        new BasketCoverageService(repo),
        {
          writableAmong: async (_userId: string, listIds: readonly string[]) =>
            new Set(listIds),
          listParticipants: async () => ({ participants: [] }),
          liveParticipantById: async () => null,
        } as never,
        {
          permissionsAmong: async (
            _userId: string,
            listIds: readonly string[]
          ) =>
            new Map(
              listIds.map((listId) => [listId, new Set([ListPermission.READ])])
            ),
        } as never,
        // The real thing, which is what this block is about.
        new BasketOrderService(dataSource),
        fakeBasketMarks(),
        fakeCoreConfig()
      );
    });

    it('draws a generated basket in the order its owner walks', async () => {
      const { basket, listIds } = await world(BasketKind.GENERATED);

      const { rows } = await read.rowsOf(
        basket,
        listIds,
        BasketRedaction.unredacted(listIds)
      );

      // The three lines it covers, plus the three the past trip settled, which
      // sit on the same list and share their names. Six lines, three rows.
      expect(rows.map((row) => row.content)).toEqual([
        'Milk',
        'Bread',
        'Juice',
      ]);
    });

    it('draws the permanent basket the same way', async () => {
      const { basket, listIds } = await world(BasketKind.LIVE);

      const { rows } = await read.rowsOf(
        basket,
        listIds,
        BasketRedaction.unredacted(listIds)
      );

      expect(rows.map((row) => row.content)).toEqual([
        'Milk',
        'Bread',
        'Juice',
      ]);
    });

    it('gives a reader who is not the owner the owner s order', async () => {
      const { basket, listIds } = await world(BasketKind.GENERATED);

      // A guest is served no list at all, and the order is still the owner's:
      // `rowsOf` passes `basket.ownerUserId` and never the reader (plan 0141,
      // section 3.1). Four people in one shop read one screen.
      const guest = await read.rowsOf(
        basket,
        listIds,
        BasketRedaction.none({
          userId: null,
          invitedAt: null,
        } as never)
      );
      const owner = await read.rowsOf(
        basket,
        listIds,
        BasketRedaction.unredacted(listIds)
      );

      expect(guest.rows.map((row) => row.rowKey)).toEqual(
        owner.rows.map((row) => row.rowKey)
      );
      expect(guest.rows.map((row) => row.content)).toEqual([
        'Milk',
        'Bread',
        'Juice',
      ]);
    });
  });
});
