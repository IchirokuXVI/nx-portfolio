import {
  BASKET_USUAL_WINDOW,
  BasketKind,
  BasketRowUsualState,
  BasketStatus,
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
import { DataSource } from 'typeorm';
import {
  Basket,
  BasketParticipant,
  BasketSource,
  CORE_ENTITIES,
  LineSettlement,
  ListLine,
  ShoppingList,
  Zone,
  ZoneMembership,
} from '../entities';
import { fakeCoreConfig } from './basket-config.fake';
import { BasketCoverageService } from './basket-coverage.service';
import { BasketReadService } from './basket-read.service';
import { USUAL_WINDOWS_SQL } from './basket-usual.sql';
import { fakeBasketMarks } from './changes/basket-marks.fake';

/**
 * Where a row is usually bought, against Postgres (plan 0165).
 *
 * The rule itself is a table in `basket-usual.spec.ts`. What only a database
 * can prove is which purchases reach it: every settle on a line counts,
 * whoever made it and through whichever basket or list page, and a window
 * holds the newest six that stand and nothing else. And that the one query
 * rides `ix_settlements_line`.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 6 --services core
 *   LUNA_INTEGRATION=1 CORE_DB_URL=postgres://luna_core:luna_core@localhost:43511/luna_core \
 *     npx nx run luna-shopper-backend-core:test-integration --testFile=basket-usual.integration.spec.ts
 */
describeIntegration('where a row is usually bought (real Postgres)', () => {
  let dataSource: DataSource;
  let read: BasketReadService;

  const shopper = randomUUID();
  const MERCADONA = randomUUID();
  const LIDL = randomUUID();
  const READER = randomUUID();
  let zoneId = '';
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
      // The reader is the owner, and is the one participant the view names.
      {
        writableAmong: async (_userId: string, listIds: readonly string[]) =>
          new Set(listIds),
        listParticipants: async () => ({ participants: [{ id: READER }] }),
        liveParticipantById: async () => null,
      } as never,
      {
        permissionsAmong: async (_userId: string, listIds: readonly string[]) =>
          new Map(
            listIds.map((listId) => [
              listId,
              new Set([ListPermission.READ, ListPermission.WRITE]),
            ])
          ),
      } as never,
      // The walk order is not what this file proves.
      { order: async <T>(_userId: string, rows: T[]) => rows } as never,
      fakeBasketMarks(),
      fakeCoreConfig()
    );

    const zones = dataSource.getRepository(Zone);
    const zone = await zones.save(
      zones.create({
        name: 'Usual chain',
        joinCode: randomUUID().replace(/-/g, '').slice(0, 16),
        status: ZoneStatus.ACTIVE,
        ownerUserId: shopper,
        config: {},
      })
    );
    zoneId = zone.id;
    const memberships = dataSource.getRepository(ZoneMembership);
    await memberships.save(
      memberships.create({
        zoneId,
        userId: shopper,
        username: 'Shopper',
        role: ZoneRole.OWNER,
        status: MembershipStatus.APPROVED,
      })
    );
  });

  afterAll(async () => {
    if (zoneId) {
      await dataSource.getRepository(Zone).delete({ id: zoneId });
    }
    await dataSource?.destroy();
  });

  // --- fixtures ------------------------------------------------------------

  async function list(name: string): Promise<string> {
    const repo = dataSource.getRepository(ShoppingList);
    const saved = await repo.save(
      repo.create({ zoneId, name, createdByUserId: shopper })
    );
    return saved.id;
  }

  async function line(listId: string, content: string): Promise<ListLine> {
    const repo = dataSource.getRepository(ListLine);
    position += 1;
    return repo.save(
      repo.create({
        listId,
        content,
        quantity: 1,
        position,
        createdByUserId: shopper,
        approvalStatus: LineApprovalStatus.APPROVED,
      })
    );
  }

  async function basket(...listIds: string[]): Promise<Basket> {
    const repo = dataSource.getRepository(Basket);
    const saved = await repo.save(
      repo.create({
        ownerUserId: shopper,
        kind: BasketKind.GENERATED,
        name: 'Saturday',
        status: BasketStatus.OPEN,
        generatedAt: new Date(),
        idempotencyKey: null,
      })
    );
    const sources = dataSource.getRepository(BasketSource);
    for (const listId of listIds) {
      await sources.save(
        sources.create({ basketId: saved.id, zoneId, listId })
      );
    }
    return saved;
  }

  interface Settle {
    /** The chain, `null` for a settle made in "any shop" mode or before 0163. */
    chain: string | null;
    /** How long ago, in minutes. The window is the newest first. */
    minutesAgo: number;
    /** Through a basket, as a participant, or from the list page, as a user. */
    via?: 'basket' | 'list' | 'guest';
    basketId?: string;
    outcome?: SettlementOutcome;
    reverted?: boolean;
  }

  async function settle(lineRow: ListLine, s: Settle): Promise<void> {
    const via = s.via ?? 'basket';
    const repo = dataSource.getRepository(LineSettlement);
    await repo.save(
      repo.create({
        lineId: lineRow.id,
        listId: lineRow.listId,
        itemId: null,
        outcome: s.outcome ?? SettlementOutcome.BOUGHT,
        quantity: 1,
        // The list page settles as the account; a basket settles as its
        // participant, and a guest is a participant with no account.
        settledByUserId: via === 'list' ? shopper : null,
        settledByParticipantId: via === 'list' ? null : randomUUID(),
        settledAt: new Date(Date.now() - s.minutesAgo * 60_000),
        revertedAt: s.reverted ? new Date() : null,
        revertedByParticipantId: s.reverted ? randomUUID() : null,
        basketId: via === 'list' ? null : (s.basketId ?? null),
        pricePaidCents: null,
        pricePaidCurrency: null,
        // The chain is never stored without the shop, nor the shop without
        // the scope (`ck_line_settlements_location_scope`).
        priceScopeId: s.chain ? randomUUID() : null,
        supermarketLocationId: s.chain ? randomUUID() : null,
        supermarketId: s.chain,
      })
    );
  }

  const reader = (basketId: string): BasketParticipant =>
    ({
      id: READER,
      basketId,
      userId: shopper,
      kind: ParticipantKind.OWNER,
    }) as BasketParticipant;

  async function usualAt(held: Basket, chain?: string) {
    const view = await read.view(held, reader(held.id), chain);
    return new Map(view.rows.map((row) => [row.content, row.usual]));
  }

  // --- what counts ---------------------------------------------------------

  it('counts a settle from a basket, from the list page and from a guest alike', async () => {
    const listId = await list('Weekly');
    const held = await basket(listId);
    const other = await basket(listId);
    const milk = await line(listId, 'Milk');

    await settle(milk, {
      chain: MERCADONA,
      minutesAgo: 30,
      via: 'basket',
      basketId: held.id,
    });
    await settle(milk, { chain: MERCADONA, minutesAgo: 20, via: 'list' });
    // A guest on another basket of the same list: the line is the household's.
    await settle(milk, {
      chain: MERCADONA,
      minutesAgo: 10,
      via: 'guest',
      basketId: other.id,
    });

    expect((await usualAt(held, MERCADONA)).get('Milk')).toEqual({
      state: BasketRowUsualState.HERE,
      bought: 3,
      of: 3,
    });
  });

  it('keeps the newest six in the window, and drops the older ones', async () => {
    const listId = await list('Window');
    const held = await basket(listId);
    const bread = await line(listId, 'Bread');

    // Three old purchases here, then six newer ones at another chain.
    for (const minutesAgo of [300, 290, 280]) {
      await settle(bread, { chain: MERCADONA, minutesAgo, basketId: held.id });
    }
    for (const minutesAgo of [60, 50, 40, 30, 20, 10]) {
      await settle(bread, { chain: LIDL, minutesAgo, basketId: held.id });
    }

    expect((await usualAt(held, MERCADONA)).get('Bread')).toEqual({
      state: BasketRowUsualState.ELSEWHERE,
      bought: 0,
      of: BASKET_USUAL_WINDOW,
    });

    // One more purchase here pushes the oldest LIDL one out.
    await settle(bread, { chain: MERCADONA, minutesAgo: 1, basketId: held.id });
    expect((await usualAt(held, MERCADONA)).get('Bread')).toEqual({
      state: BasketRowUsualState.HERE,
      bought: 1,
      of: 6,
    });
    // And read at LIDL, the same window says five of six.
    expect((await usualAt(held, LIDL)).get('Bread')).toEqual({
      state: BasketRowUsualState.HERE,
      bought: 5,
      of: 6,
    });
  });

  it('counts neither a NOT_AVAILABLE close nor a purchase taken back', async () => {
    const listId = await list('Outcomes');
    const held = await basket(listId);
    const eggs = await line(listId, 'Eggs');

    await settle(eggs, { chain: LIDL, minutesAgo: 30, basketId: held.id });
    await settle(eggs, {
      chain: MERCADONA,
      minutesAgo: 20,
      basketId: held.id,
      outcome: SettlementOutcome.NOT_AVAILABLE,
    });
    await settle(eggs, {
      chain: MERCADONA,
      minutesAgo: 10,
      basketId: held.id,
      reverted: true,
    });

    expect((await usualAt(held, MERCADONA)).get('Eggs')).toEqual({
      state: BasketRowUsualState.ELSEWHERE,
      bought: 0,
      of: 1,
    });
  });

  it('answers a line never bought, and one bought only where nobody said', async () => {
    const listId = await list('States');
    const held = await basket(listId);
    await line(listId, 'Salt');
    const rice = await line(listId, 'Rice');
    await settle(rice, { chain: null, minutesAgo: 10, basketId: held.id });
    await settle(rice, { chain: null, minutesAgo: 5, via: 'list' });

    const usual = await usualAt(held, MERCADONA);
    expect(usual.get('Salt')).toEqual({
      state: BasketRowUsualState.NEVER_BOUGHT,
      bought: 0,
      of: 0,
    });
    expect(usual.get('Rice')).toEqual({
      state: BasketRowUsualState.NO_SHOP_KNOWN,
      bought: 0,
      of: 2,
    });
  });

  it('averages a row merged from two lists over the lines that were bought', async () => {
    const home = await list('Home');
    const parents = await list('Parents');
    const held = await basket(home, parents);
    const ours = await line(home, 'Coffee');
    // The same thing on the parents' list merges into one row, and was never
    // bought, so it does not halve the average.
    await line(parents, 'Coffee');
    for (const minutesAgo of [60, 50, 40, 30]) {
      await settle(ours, { chain: MERCADONA, minutesAgo, basketId: held.id });
    }

    const view = await read.view(held, reader(held.id), MERCADONA);
    const coffee = view.rows.find((row) => row.content === 'Coffee');
    expect(coffee?.entries).toHaveLength(2);
    expect(coffee?.usual).toEqual({
      state: BasketRowUsualState.HERE,
      bought: 4,
      of: 4,
    });
  });

  it('answers null on every row of a read with no chain', async () => {
    const listId = await list('No shop');
    const held = await basket(listId);
    const tea = await line(listId, 'Tea');
    await line(listId, 'Sugar');
    await settle(tea, { chain: MERCADONA, minutesAgo: 5, basketId: held.id });

    const view = await read.view(held, reader(held.id));
    expect(view.rows.map((row) => row.usual)).toEqual([null, null]);
  });

  it('asks one query for the whole basket, not one per row', async () => {
    const listId = await list('One query');
    const held = await basket(listId);
    for (const name of ['A', 'B', 'C', 'D']) {
      await line(listId, name);
    }
    // Called through, only recorded: the read service holds this repository.
    const spy = jest.spyOn(dataSource.getRepository(Basket), 'query');
    try {
      await read.view(held, reader(held.id), MERCADONA);
      const windows = spy.mock.calls.filter(
        ([sql]) => sql === USUAL_WINDOWS_SQL
      );
      expect(windows).toHaveLength(1);
      // Every line of the basket, in the one statement.
      expect((windows[0][1] as unknown[])[0]).toHaveLength(4);
    } finally {
      spy.mockRestore();
    }
  });

  // --- the index -----------------------------------------------------------

  describe('the plan on a basket of 100 lines', () => {
    const lineIds: string[] = [];

    beforeAll(async () => {
      const listId = await list('Hundred');
      const held = await basket(listId);
      for (let index = 0; index < 100; index += 1) {
        const row = await line(listId, `Thing ${index}`);
        lineIds.push(row.id);
        for (let n = 0; n < 8; n += 1) {
          await settle(row, {
            chain: n % 2 === 0 ? MERCADONA : LIDL,
            minutesAgo: 1000 - n,
            basketId: held.id,
          });
        }
      }
      // Statistics, without which the plan is not reproducible: a freshly
      // inserted table has none.
      await dataSource.query('VACUUM ANALYZE "line_settlements"');
    });

    /**
     * The planner picks a sequential scan on a table this small however good
     * the index is, so asking what it would do with one ruled out is the only
     * assertion that means anything, for the reason
     * `purchases.integration.spec.ts` gives. With `enable_seqscan` off Postgres
     * still falls back to a sequential scan when no index can serve the query,
     * so seeing the index named proves the predicate matches it.
     */
    async function planFor(seqscan: boolean): Promise<string> {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        await runner.query(`SET enable_seqscan = ${seqscan ? 'on' : 'off'}`);
        const plan = await runner.query(`EXPLAIN ${USUAL_WINDOWS_SQL}`, [
          lineIds,
          MERCADONA,
          BASKET_USUAL_WINDOW,
        ]);
        return (
          plan
            .map((row: Record<string, string>) => Object.values(row)[0])
            .join('\n')
            // The hundred ids Postgres inlines, which say nothing.
            .replace(/'\{[^}]*\}'/g, "'{100 line ids}'")
        );
      } finally {
        await runner.query('SET enable_seqscan = on');
        await runner.release();
      }
    }

    it('reads the windows through ix_settlements_line', async () => {
      const text = await planFor(false);
      // Printed for the plan's Progress evidence.
      console.log(`EXPLAIN, 100 lines, seqscan off:\n${text}`);
      console.log(`EXPLAIN, 100 lines, seqscan on:\n${await planFor(true)}`);

      expect(text).toContain('ix_settlements_line');
    });

    it('answers every one of the 100 lines, each with a full window', async () => {
      const rows = await dataSource.query(USUAL_WINDOWS_SQL, [
        lineIds,
        MERCADONA,
        BASKET_USUAL_WINDOW,
      ]);
      expect(rows).toHaveLength(100);
      // Eight purchases each, alternating, newest first: the six kept are
      // three here and three elsewhere.
      for (const row of rows) {
        expect(row).toMatchObject({ of: 6, bought: 3, named: 6 });
      }
    });
  });
});
