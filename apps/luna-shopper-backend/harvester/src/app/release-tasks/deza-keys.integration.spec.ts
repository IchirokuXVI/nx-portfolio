import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  PriceSourceKind,
  type SupermarketLocationView,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, type Repository } from 'typeorm';
import {
  DiscoveredPlace,
  HARVESTER_ENTITIES,
  SourceCatalogEntry,
  SourceEntryAvailability,
  SourceEntryPrice,
  SourceLocation,
  type SupermarketSource,
} from '../entities';
import type { CatalogClient } from '../harvest/catalog-client.service';
import { DezaCatalogRunner } from '../harvest/deza-catalog.runner';
import { DezaKeyGuard } from '../harvest/deza-key-guard';
import {
  startFakeListing,
  type FakeListing,
} from '../harvest/deza-listing.fake';
import { entryKey, isNameKeyed } from '../harvest/matching';
import type { PlatformAdminService } from '../harvest/platform-admin.service';
import type { RunContext } from '../harvest/run-context';
import { RunReportSink } from '../harvest/run-report.sink';
import { SourceEntryAvailabilityWriter } from '../harvest/source-entry-availability';
import { SourceIngest } from '../harvest/source-ingest';
import { SourceLocationService } from '../harvest/source-location.service';
import {
  descriptionOf,
  dezaKeysRefusal,
  REKEY_SQL,
  runDezaKeysOn,
  type DezaKeysDb,
  type DezaKeysPorts,
  type Sql,
} from './deza-keys';

/**
 * Release task 0008 of backend plan 0272 against real Postgres.
 *
 * The unit spec answers the selection with canned rows, so only this file
 * proves the SQL: the read of a chain's rows, the count of active runs, the
 * table lock, the CTE around each `UPDATE ... RETURNING`, the snapshot of
 * section 7.1, a rollback that leaves no row re-keyed, and that the prices,
 * availability and presence of a re-keyed row still join to it. The last case
 * walks a fake DEZA listing through the real runner, sink and ingest after the
 * task, which is section 7.2.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *     --testFile=deza-keys.integration.spec.ts
 */

/** A chain nothing else in this database uses, so cleanup is exact. */
const CHAIN = '02720000-0000-4000-a000-0000000000a1';
const SCOPE = '02720000-0000-4000-a000-0000000000b1';
const RUN = '02720000-0000-4000-a000-0000000000c1';
const WALK = '02720000-0000-4000-a000-0000000000c2';
const ITEM = {
  socks: '02720000-0000-4000-a000-000000000001',
  yogurt: '02720000-0000-4000-a000-000000000002',
  tea: '02720000-0000-4000-a000-000000000003',
  milk: '02720000-0000-4000-a000-000000000004',
};

const SEEDED_AT = '2026-11-01T06:00:00.000Z';

interface Seed {
  name: string;
  sizeFormat: string | null;
  itemId?: string | null;
  status?: 'ACTIVE' | 'UNRESOLVED' | 'CANDIDATE' | 'REJECTED';
  sourceKind?: 'OFFICIAL_WEB' | 'OFFICIAL_LEAFLET';
  /** A key other than the one the text builds: an unkeyed row. */
  externalId?: string;
}

/** The rows of the case: four moves, a collision, and four that stay. */
const SEEDS: Record<string, Seed> = {
  // Moves: each held the whole description as its name and no size text.
  socks: {
    name: 'Calcetines ALTEZA 3 pares',
    sizeFormat: null,
    itemId: ITEM.socks,
  },
  yogurt: {
    name: 'Yogur natural ALTEZA 2X125 g',
    sizeFormat: null,
    itemId: ITEM.yogurt,
  },
  hose: {
    name: 'Manguera ALTEZA 15 m.',
    sizeFormat: null,
    status: 'UNRESOLVED',
  },
  towel: { name: 'Toalla ALTEZA 2 u', sizeFormat: null, status: 'REJECTED' },
  // A collision: its new key is the key of the row below.
  tea: {
    name: 'Infusion ALTEZA 20 bolsitas',
    sizeFormat: null,
    itemId: ITEM.tea,
  },
  teaHolder: {
    name: 'Infusion ALTEZA',
    sizeFormat: '20 bolsitas',
    status: 'UNRESOLVED',
  },
  // Stays: already split, a leaflet row, an unkeyed row.
  milk: { name: 'Leche ALTEZA', sizeFormat: '1 L', itemId: ITEM.milk },
  leaflet: {
    name: 'Calcetines ALTEZA 4 pares',
    sizeFormat: null,
    sourceKind: 'OFFICIAL_LEAFLET',
  },
  unkeyed: {
    name: 'Calcetines ALTEZA 5 pares',
    sizeFormat: null,
    externalId: 'printed-key',
  },
};

describeIntegration('release task 0008, deza keys (real Postgres)', () => {
  let dataSource: DataSource;
  let entries: Repository<SourceCatalogEntry>;
  let db: DezaKeysDb;
  let listing: FakeListing | undefined;
  /** Throws on the update with this index, counted from 1, when set. */
  let failOnUpdate: number | null;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    entries = dataSource.getRepository(SourceCatalogEntry);
    db = {
      query: async <T>(sql: string, params?: unknown[]) =>
        (await dataSource.query(sql, params)) as T[],
      transaction: (work) =>
        dataSource.transaction((manager) => {
          let updates = 0;
          const tx: Sql = {
            query: async <T>(sql: string, params?: unknown[]) => {
              if (sql === REKEY_SQL) {
                updates += 1;
                if (failOnUpdate === updates) {
                  throw new Error('the connection dropped');
                }
              }
              return (await manager.query(sql, params)) as T[];
            },
          };
          return work(tx);
        }),
    };
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    failOnUpdate = null;
    await clean();
    await seed();
  });

  afterEach(async () => {
    await listing?.close();
    listing = undefined;
  });

  async function clean(): Promise<void> {
    // Prices, claims and presence cascade with their rows.
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "source_locations" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    await dataSource.query(
      `DELETE FROM "supermarket_sources" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
  }

  async function seed(): Promise<void> {
    await dataSource.query(
      `INSERT INTO "supermarket_sources" ("supermarketId", "adapterKey")
       VALUES ($1, 'deza-web')`,
      [CHAIN]
    );
    for (const row of Object.values(SEEDS)) {
      await insert(row);
    }
    await hangOffSocks();
  }

  /** One stored row of the chain, as a walk or a leaflet wrote it. */
  async function insert(row: Seed): Promise<void> {
    const status = row.status ?? (row.itemId ? 'ACTIVE' : 'UNRESOLVED');
    await dataSource.query(
      `INSERT INTO "source_catalog_entries"
         ("supermarketId", "externalId", "sourceKind", "name", "itemId",
          "status", "sizeFormat", "matchedBy", "confidence", "decidedAt",
          "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        CHAIN,
        row.externalId ?? entryKey(row.name, row.sizeFormat),
        row.sourceKind ?? 'OFFICIAL_WEB',
        row.name,
        row.itemId ?? null,
        status,
        row.sizeFormat,
        status === 'ACTIVE' ? 'MANUAL' : null,
        status === 'ACTIVE' ? 1 : 0,
        status === 'ACTIVE' || status === 'REJECTED' ? SEEDED_AT : null,
        SEEDED_AT,
      ]
    );
  }

  async function hangOffSocks(): Promise<void> {
    // What hangs off the socks: a price, a shop claim and a scope presence.
    const socks = await rowOf('socks');
    await dataSource.query(
      `INSERT INTO "source_entry_prices"
         ("entryId", "priceScopeId", "sourceKind", "price", "unitPrice",
          "unitPriceLabel", "observedAt", "runId")
       VALUES ($1, $2, 'OFFICIAL_LEAFLET', 4.5, 4.5, 'ud', $3, $4)`,
      [socks.id, SCOPE, SEEDED_AT, RUN]
    );
    const [shop] = await dataSource.query(
      `INSERT INTO "source_locations"
         ("supermarketId", "externalId", "printedName", "status", "matchedBy")
       VALUES ($1, 'T1', 'Jesús Rescatado', 'UNMAPPED', 'NAME_SIZE')
       RETURNING id`,
      [CHAIN]
    );
    await dataSource.query(
      `INSERT INTO "source_entry_availability" ("entryId", "sourceLocationId", "available", "runId")
       VALUES ($1, $2, true, $3)`,
      [socks.id, shop.id, RUN]
    );
    await dataSource.query(
      `INSERT INTO "source_entry_scope_presence" ("entryId", "priceScopeId")
       VALUES ($1, $2)`,
      [socks.id, SCOPE]
    );
  }

  /** The row a seed made, found by its id-free identity: its seeded name. */
  async function rowOf(seed: keyof typeof SEEDS): Promise<SourceCatalogEntry> {
    const all = await entries.find({ where: { supermarketId: CHAIN } });
    const byName = all.find((row) => row.name === SEEDS[seed].name);
    if (byName) {
      return byName;
    }
    throw new Error(`no row for ${seed}`);
  }

  async function chainRows(): Promise<SourceCatalogEntry[]> {
    return entries.find({
      where: { supermarketId: CHAIN },
      order: { id: 'ASC' },
    });
  }

  function out() {
    const lines: string[] = [];
    const files = new Map<string, string>();
    const p: DezaKeysPorts = {
      db,
      files: {
        write: async (path, text) => {
          files.set(path, text);
        },
      },
      log: (line) => lines.push(line),
    };
    return { ports: p, lines, files };
  }

  const count = async () => {
    const o = out();
    await runDezaKeysOn(o.ports, { mode: 'count' }, [CHAIN]);
    return o.lines;
  };

  it('counts without writing anything', async () => {
    const before = JSON.stringify(await chainRows());

    expect(await count()).toEqual([
      'rows 8',
      'unkeyed 1',
      'moves 5',
      'moves-active 3',
      'moves-unresolved 1',
      'moves-other 1',
      'collisions 1',
      'active-runs 0',
    ]);
    expect(JSON.stringify(await chainRows())).toBe(before);
  });

  it('re-keys every move but the collision in place, then counts moves 1, the collision', async () => {
    const before = await chainRows();
    const o = out();

    await runDezaKeysOn(o.ports, { mode: 'write', max: 10, record: 'r.tsv' }, [
      CHAIN,
    ]);

    expect(o.lines.at(-1)).toBe('rekeyed 4');
    const after = await chainRows();
    // No row deleted or inserted, and every row keeps its decision.
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    for (const row of after) {
      const was = before.find((b) => b.id === row.id) as SourceCatalogEntry;
      expect([
        row.itemId,
        row.status,
        row.matchedBy,
        row.confidence,
        row.decidedAt,
        row.candidateEntryId,
      ]).toEqual([
        was.itemId,
        was.status,
        was.matchedBy,
        was.confidence,
        was.decidedAt,
        was.candidateEntryId,
      ]);
      // Nothing but the three columns: the size columns stay for the walk.
      expect([
        row.unitSize,
        row.sizeUnit,
        row.packCount,
        row.updatedAt,
      ]).toEqual([was.unitSize, was.sizeUnit, was.packCount, was.updatedAt]);
    }
    const socks = after.find(
      (row) => row.id === before.find((b) => b.name === SEEDS.socks.name)?.id
    );
    expect(socks).toEqual(
      expect.objectContaining({
        name: 'Calcetines ALTEZA',
        sizeFormat: '3 pares',
        externalId: entryKey('Calcetines ALTEZA', '3 pares'),
      })
    );
    expect(
      after
        .filter(
          (row) =>
            row.sourceKind === PriceSourceKind.OFFICIAL_WEB &&
            row.name !== SEEDS.unkeyed.name
        )
        .every((row) => isNameKeyed(row))
    ).toBe(true);
    // The collision and the two rows that stay are untouched.
    for (const seed of [
      'tea',
      'teaHolder',
      'milk',
      'leaflet',
      'unkeyed',
    ] as const) {
      const was = before.find(
        (b) => b.name === SEEDS[seed].name
      ) as SourceCatalogEntry;
      const now = after.find((row) => row.id === was.id) as SourceCatalogEntry;
      expect([now.externalId, now.name, now.sizeFormat]).toEqual([
        was.externalId,
        was.name,
        was.sizeFormat,
      ]);
    }

    // The prices, the claim and the presence still join to the socks.
    const [joined] = await dataSource.query(
      `SELECT (SELECT count(*) FROM source_entry_prices WHERE "entryId" = $1)::int AS p,
              (SELECT count(*) FROM source_entry_availability WHERE "entryId" = $1)::int AS a,
              (SELECT count(*) FROM source_entry_scope_presence WHERE "entryId" = $1)::int AS s`,
      [socks?.id]
    );
    expect(joined).toEqual({ p: 1, a: 1, s: 1 });

    // The record: four re-keyed and one collision with its holder, no name.
    const record = (o.files.get('r.tsv') ?? '')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split('\t'));
    expect(record).toHaveLength(6);
    expect(record.filter((cells) => cells[3] === 'rekeyed')).toHaveLength(4);
    const holder = before.find(
      (b) => b.name === SEEDS.teaHolder.name
    ) as SourceCatalogEntry;
    expect(record.find((cells) => cells[3] === 'collision')?.[4]).toBe(
      holder.id
    );
    expect(record.join('\n')).not.toMatch(/ALTEZA/);

    // The counts of section 7.1, before and after, printed and equal.
    const before71 = o.lines
      .filter((l) => l.startsWith('before '))
      .map((l) => l.slice(7));
    const after71 = o.lines
      .filter((l) => l.startsWith('after '))
      .map((l) => l.slice(6));
    expect(after71).toEqual(before71);
    expect(before71).toContain('prices 1');

    // A second run counts the collision alone and writes nothing.
    expect(await count()).toContain('moves 1');
    const again = out();
    await runDezaKeysOn(
      again.ports,
      { mode: 'write', max: 10, record: 'r.tsv' },
      [CHAIN]
    );
    expect(again.lines.at(-1)).toBe('rekeyed 0');
  });

  it('refuses above --max before any write', async () => {
    const before = JSON.stringify(await chainRows());
    await expect(
      runDezaKeysOn(out().ports, { mode: 'write', max: 4, record: 'r.tsv' }, [
        CHAIN,
      ])
    ).rejects.toThrow('5 moves, above 4');
    expect(JSON.stringify(await chainRows())).toBe(before);
  });

  it('refuses while a run of the chain is in flight', async () => {
    await dataSource.query(
      `INSERT INTO "harvest_runs" ("id", "supermarketId", "mode", "status", "trigger")
       VALUES ($1, $2, 'FILE_IMPORT', 'RUNNING', 'MANUAL')`,
      [WALK, CHAIN]
    );
    expect(await count()).toContain('active-runs 1');
    await expect(
      runDezaKeysOn(out().ports, { mode: 'write', max: 10, record: 'r.tsv' }, [
        CHAIN,
      ])
    ).rejects.toThrow('PENDING or RUNNING');
    expect(await count()).toContain('moves 5');
  });

  it('leaves no row re-keyed when the last update fails', async () => {
    const before = JSON.stringify(await chainRows());
    failOnUpdate = 4;
    const o = out();
    await expect(
      runDezaKeysOn(o.ports, { mode: 'write', max: 10, record: 'r.tsv' }, [
        CHAIN,
      ])
    ).rejects.toThrow('the connection dropped');
    expect(JSON.stringify(await chainRows())).toBe(before);
    expect(o.files.size).toBe(0);
  });

  it('lets the guard refuse a DEZA walk before the task and pass it after', async () => {
    const guard = new DezaKeyGuard(entries);
    const source = {
      supermarketId: CHAIN,
      adapterKey: 'deza-web',
    } as SupermarketSource;
    const { CATALOG_DISCOVERY } = HarvestRunMode;

    await expect(guard.refusal(source, CATALOG_DISCOVERY)).resolves.toBe(
      dezaKeysRefusal(4)
    );
    await runDezaKeysOn(
      out().ports,
      { mode: 'write', max: 10, record: 'r.tsv' },
      [CHAIN]
    );
    // The collision is left, and it does not hold the walk.
    await expect(guard.refusal(source, CATALOG_DISCOVERY)).resolves.toBeNull();
  });

  it('lets a walk after the task record each re-keyed description on the row the task wrote (section 7.2)', async () => {
    const before = await chainRows();
    await runDezaKeysOn(
      out().ports,
      { mode: 'write', max: 10, record: 'r.tsv' },
      [CHAIN]
    );

    const walked = ['socks', 'yogurt', 'hose', 'towel', 'tea', 'milk'] as const;
    listing = await startFakeListing(
      [
        {
          code: 'W010000000',
          name: 'VARIOS',
          children: [{ code: 'W011', name: 'Hogar' }],
        },
      ],
      walked.map((seed) => ({
        description: descriptionOf(SEEDS[seed].name, SEEDS[seed].sizeFormat),
        section: 'W011',
        shops: ['T1'],
      }))
    );
    await walk(listing);

    const after = await chainRows();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    const now = (seed: keyof typeof SEEDS) => {
      const was = before.find(
        (b) => b.name === SEEDS[seed].name
      ) as SourceCatalogEntry;
      return {
        was,
        now: after.find((row) => row.id === was.id) as SourceCatalogEntry,
      };
    };
    for (const seed of ['socks', 'yogurt', 'hose', 'towel'] as const) {
      const { was, now: row } = now(seed);
      expect([row.itemId, row.status]).toEqual([was.itemId, was.status]);
      expect(row.lastRunId).toBe(WALK);
    }
    // The walk rewrote the size columns of the row it found.
    expect(now('yogurt').now).toEqual(
      expect.objectContaining({ unitSize: expect.anything(), sizeUnit: 'GRAM' })
    );
    // The skipped row's description landed on the holder of its key.
    expect(now('teaHolder').now.lastRunId).toBe(WALK);
    expect(now('tea').now.lastRunId).toBeNull();
  });

  /**
   * Moves that depend on each other (the review of PR #1016). The texts
   * differ in a comma, which the key ignores and the split does not.
   * `chainEnd` moves to a key nobody holds, `chainMiddle` to the key of
   * `chainEnd`, `chainStart` to the key of `chainMiddle`. `ringCloser` holds
   * the key `chainEnd` wants and wants the key of `chainMiddle`: with those
   * two it closes a ring of three.
   */
  const SHAPES: Record<string, Seed> = {
    chainEnd: { name: 'Zumo ALTEZA', sizeFormat: '3 x 187 ml,' },
    chainMiddle: {
      name: 'Zumo ALTEZA 3 x',
      sizeFormat: '187 ml',
      itemId: ITEM.tea,
    },
    chainStart: { name: 'Zumo ALTEZA 3', sizeFormat: 'x, 187 ml' },
    ringCloser: { name: 'Zumo ALTEZA 3 x, 187 ml', sizeFormat: null },
    swapWhole: { name: 'Calcetines ALTEZA 7 pares', sizeFormat: null },
    swapSplit: { name: 'Calcetines ALTEZA', sizeFormat: '7 pares,' },
    endHolder: {
      name: 'Zumo ALTEZA 3 x 187 ml',
      sizeFormat: null,
      sourceKind: 'OFFICIAL_LEAFLET',
    },
  };

  /** The chain holds only these rows. */
  async function only(...shapes: (keyof typeof SHAPES)[]): Promise<void> {
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
    for (const shape of shapes) {
      await insert(SHAPES[shape]);
    }
  }

  /** The count lines, then a write run, streaming its record. */
  async function countThenWrite(max: number) {
    const counted = await count();
    const o = out();
    await runDezaKeysOn(o.ports, { mode: 'write', max, record: '-' }, [CHAIN]);
    // The write reports first exactly what --count printed.
    expect(o.lines.slice(0, counted.length)).toEqual(counted);
    return { counted, lines: o.lines };
  }

  it.each([
    ['two', ['chainMiddle', 'chainEnd'] as const],
    ['three', ['chainStart', 'chainMiddle', 'chainEnd'] as const],
  ])(
    'resolves a chain of %s in one run, past the unique index',
    async (_, shapes) => {
      await only(...shapes);
      const guard = new DezaKeyGuard(entries);
      const source = {
        supermarketId: CHAIN,
        adapterKey: 'deza-web',
      } as SupermarketSource;
      const { CATALOG_DISCOVERY } = HarvestRunMode;
      await expect(guard.refusal(source, CATALOG_DISCOVERY)).resolves.toBe(
        dezaKeysRefusal(shapes.length)
      );

      const { counted, lines } = await countThenWrite(shapes.length);

      expect(counted).toContain(`moves ${shapes.length}`);
      expect(counted).toContain('collisions 0');
      expect(lines.at(-1)).toBe(`rekeyed ${shapes.length}`);
      const rows = await chainRows();
      expect(rows).toHaveLength(shapes.length);
      for (const row of rows) {
        expect(row.externalId).toBe(entryKey(row.name, row.sizeFormat));
      }
      expect(rows.find((row) => row.itemId === ITEM.tea)).toEqual(
        expect.objectContaining({
          name: 'Zumo ALTEZA',
          sizeFormat: '3 x 187 ml',
        })
      );
      const again = await count();
      expect(again).toContain('moves 0');
      expect(again).toContain('collisions 0');
      await expect(
        guard.refusal(source, CATALOG_DISCOVERY)
      ).resolves.toBeNull();
    }
  );

  it.each([
    ['a swap', ['swapWhole', 'swapSplit'] as const, 2],
    ['a ring of three', ['chainEnd', 'chainMiddle', 'ringCloser'] as const, 3],
    [
      'a chain whose last key a leaflet row holds',
      ['chainMiddle', 'chainEnd', 'endHolder'] as const,
      2,
    ],
  ])(
    'writes nothing for %s, and counts each moved row a collision',
    async (_, shapes, collisions) => {
      await only(...shapes);
      const before = JSON.stringify(await chainRows());

      const { counted, lines } = await countThenWrite(10);

      expect(counted).toContain(`moves ${collisions}`);
      expect(counted).toContain(`collisions ${collisions}`);
      expect(lines.at(-1)).toBe('rekeyed 0');
      expect(JSON.stringify(await chainRows())).toBe(before);
      // The guard does not wait for rows the task never changes.
      await expect(
        new DezaKeyGuard(entries).refusal(
          { supermarketId: CHAIN, adapterKey: 'deza-web' } as SupermarketSource,
          HarvestRunMode.CATALOG_DISCOVERY
        )
      ).resolves.toBeNull();
    }
  );

  /** One DEZA walk over a listing: the real runner, sink and ingest. */
  async function walk(fake: FakeListing): Promise<void> {
    const catalog = {
      searchItems: async () => ({ items: [], nextCursor: null }),
      findItemByEan: async () => ({ item: null }),
      fillPackCounts: async () => ({ written: 0 }),
      fillApproxWeights: async () => ({ written: 0 }),
      addPrices: async () => ({ inserted: 0, confirmed: 0 }),
      listSupermarketLocations: async () => ({
        items: [] as SupermarketLocationView[],
        nextCursor: null,
      }),
      getSupermarket: async () => ({ id: CHAIN, defaultPriceScopeId: null }),
      setAvailability: async () => ({ updated: 0 }),
      setLocationAvailability: async () => ({
        written: 0,
        skipped: 0,
        conflicts: [],
      }),
    } as unknown as CatalogClient;
    const prices = dataSource.getRepository(SourceEntryPrice);
    const availability = new SourceEntryAvailabilityWriter(
      dataSource.getRepository(SourceEntryAvailability),
      catalog
    );
    const locations = new SourceLocationService(
      dataSource.getRepository(SourceLocation),
      catalog,
      { requireAdmin: async () => 'admin' } as unknown as PlatformAdminService,
      availability,
      dataSource.getRepository(DiscoveredPlace)
    );
    const context = {
      runId: WALK,
      signal: new AbortController().signal,
      acquire: async () => undefined,
      setStage: async () => undefined,
      setTotalPlanned: async () => undefined,
      report: async () => undefined,
      advance: async () => undefined,
      heartbeat: async () => undefined,
      flush: async () => undefined,
      setReport: async () => undefined,
      warn: () => undefined,
    } as unknown as RunContext;
    const sink = new RunReportSink(
      context,
      {
        supermarketId: CHAIN,
        defaultPriceScopeId: null,
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        postalCodeDeriveMaxMetres: 5000,
        autoImportPlaces: false,
      },
      {
        ingest: new SourceIngest(entries, prices, catalog),
        scopes: null,
        places: {} as never,
        shops: locations,
        catalog,
        entries,
        availability,
      }
    );
    const runner = new DezaCatalogRunner(
      { getOrThrow: () => ({ userAgent: 'test' }) } as unknown as ConfigService,
      new DezaKeyGuard(entries)
    );
    await runner.run(context, sink, { supermarketId: CHAIN }, {
      supermarketId: CHAIN,
      adapterKey: 'deza-web',
      workers: 1,
      config: { baseUrl: fake.url },
    } as unknown as SupermarketSource);
    await sink.drain();
  }
});
