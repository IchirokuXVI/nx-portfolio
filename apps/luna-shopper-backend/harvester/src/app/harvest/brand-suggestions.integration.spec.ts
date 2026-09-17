import { ConfigService } from '@nestjs/config';
import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryPrice,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
import type { SourceEntryPriceWriter } from './source-entry-write';
import { SourceEntryService } from './source-entry.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * The two brand reads against real Postgres (plan 0115, sections 7, 8 and 10).
 *
 * Everything either of them is correct about is in the SQL: which statuses count,
 * a grouped subquery that must not become a query per row, a `mode()` picking the
 * commonest spelling, and a keyset cursor over a moving count. A fake repository
 * proves none of it.
 *
 *   docker run -d --name tmp-pg-harvester -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=harvester -p 45992:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://postgres:pw@localhost:45992/harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const ADMIN = 'owner-1';

/** Two chains nothing else in this database uses, so cleanup is exact. */
const MERCADONA = 'b1150000-0000-4000-a000-000000000001';
const CARREFOUR = 'b1150000-0000-4000-a000-000000000002';

describeIntegration('brand suggestions and spellings (real Postgres)', () => {
  let dataSource: DataSource;
  let service: SourceEntryService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const admin = {
      requireAdmin: async () => ADMIN,
    } as unknown as PlatformAdminService;

    service = new SourceEntryService(
      dataSource.getRepository(SourceCatalogEntry),
      dataSource.getRepository(SourceEntryPrice),
      dataSource.getRepository(HarvestRun),
      {} as unknown as CatalogClient,
      {} as unknown as SupermarketSourceService,
      admin,
      {} as unknown as SourceEntryPriceWriter,
      {
        getOrThrow: () => ({ harvestEnabled: true }),
      } as unknown as ConfigService
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await clean();
  });

  function clean() {
    return dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = ANY($1::uuid[])`,
      [[MERCADONA, CARREFOUR]]
    );
  }

  let seq = 0;

  /**
   * One source row. The brand key is written here rather than derived, so a
   * test can state exactly which keys the table holds and the read is the only
   * thing under test.
   */
  async function entry(options: {
    supermarketId: string;
    brand: string | null;
    brandKey: string | null;
    status?: SourceEntryStatus;
    firstSeenAt?: string;
  }): Promise<void> {
    seq += 1;
    await dataSource.query(
      `INSERT INTO "source_catalog_entries"
              ("supermarketId", "externalId", "sourceKind", "name", "brand",
               "brandKey", "status", "firstSeenAt", "lastSeenAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        options.supermarketId,
        `plan0115-${seq}`,
        PriceSourceKind.OFFICIAL_API,
        `Product ${seq}`,
        options.brand,
        options.brandKey,
        options.status ?? SourceEntryStatus.UNRESOLVED,
        options.firstSeenAt ?? '2026-06-01T00:00:00.000Z',
      ]
    );
  }

  it('answers the unregistered keys of queued rows, and nothing else', async () => {
    // Two chains carry Mahou, so it counts twice per product: a product two
    // chains carry is two source rows, which is the number the queue shows.
    await entry({
      supermarketId: MERCADONA,
      brand: 'MAHOU',
      brandKey: 'mahou',
    });
    await entry({
      supermarketId: CARREFOUR,
      brand: 'Mahou',
      brandKey: 'mahou',
      firstSeenAt: '2026-05-01T00:00:00.000Z',
    });
    await entry({
      supermarketId: CARREFOUR,
      brand: 'Mahou',
      brandKey: 'mahou',
      status: SourceEntryStatus.CANDIDATE,
    });
    await entry({
      supermarketId: MERCADONA,
      brand: 'El Pozo',
      brandKey: 'elpozo',
    });
    // Registered: catalog already holds it, so it is not a suggestion.
    await entry({
      supermarketId: MERCADONA,
      brand: 'Hacendado',
      brandKey: 'hacendado',
    });
    // Already a product, and refused for good. Neither is waiting for anybody.
    await entry({
      supermarketId: MERCADONA,
      brand: 'Bimbo',
      brandKey: 'bimbo',
      status: SourceEntryStatus.ACTIVE,
    });
    await entry({
      supermarketId: MERCADONA,
      brand: 'Junk',
      brandKey: 'junk',
      status: SourceEntryStatus.REJECTED,
    });
    // No brand at all: nothing to suggest.
    await entry({ supermarketId: MERCADONA, brand: '---', brandKey: null });

    const page = await service.brandSuggestions({
      userId: ADMIN,
      registeredKeys: ['hacendado'],
    });

    expect(page.items.map((row) => row.key)).toEqual(['mahou', 'elpozo']);
    const mahou = page.items[0];
    expect(mahou.productCount).toBe(3);
    // The commonest verbatim spelling, which is the label the back office
    // proposes: two rows say `Mahou` and one says `MAHOU`.
    expect(mahou.spelling).toBe('Mahou');
    // The earliest observation of the key, across every chain carrying it.
    expect(mahou.firstSeenAt).toBe('2026-05-01T00:00:00.000Z');
    expect(mahou.chains).toEqual([
      { supermarketId: CARREFOUR, productCount: 2 },
      { supermarketId: MERCADONA, productCount: 1 },
    ]);
  }, 180_000);

  it('keys the query before matching, so a spaced query still finds it', async () => {
    await entry({
      supermarketId: MERCADONA,
      brand: 'El Pozo',
      brandKey: 'elpozo',
    });
    await entry({
      supermarketId: MERCADONA,
      brand: 'Mahou',
      brandKey: 'mahou',
    });

    const found = await service.brandSuggestions({
      userId: ADMIN,
      registeredKeys: [],
      query: 'el pozo',
    });
    expect(found.items.map((row) => row.key)).toEqual(['elpozo']);

    // A query of punctuation keys to nothing and narrows nothing, which is the
    // plan's "answers every suggestion" rather than an empty page.
    const all = await service.brandSuggestions({
      userId: ADMIN,
      registeredKeys: [],
      query: '---',
    });
    expect(all.items).toHaveLength(2);
  }, 180_000);

  it('walks a fixed table with no gap and no repeat', async () => {
    // Four keys with four different counts, so the ordering cannot be right by
    // accident of insertion order.
    const keys = ['alpha', 'bravo', 'charlie', 'delta'];
    for (const [index, key] of keys.entries()) {
      for (let n = 0; n <= index; n += 1) {
        await entry({ supermarketId: MERCADONA, brand: key, brandKey: key });
      }
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.brandSuggestions({
        userId: ADMIN,
        registeredKeys: [],
        limit: 1,
        cursor,
      });
      seen.push(...page.items.map((row) => row.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual(['delta', 'charlie', 'bravo', 'alpha']);
  }, 180_000);

  it('splits the spellings by chain and by what each chain printed', async () => {
    await entry({
      supermarketId: CARREFOUR,
      brand: 'MAHOU',
      brandKey: 'mahou',
    });
    await entry({
      supermarketId: CARREFOUR,
      brand: 'MAHOU',
      brandKey: 'mahou',
      status: SourceEntryStatus.ACTIVE,
    });
    await entry({
      supermarketId: CARREFOUR,
      brand: 'Mahou',
      brandKey: 'mahou',
    });
    await entry({
      supermarketId: MERCADONA,
      brand: 'Mahou',
      brandKey: 'mahou',
      status: SourceEntryStatus.ACTIVE,
    });
    // Refused for good, so it says nothing about how the chain writes the brand.
    await entry({
      supermarketId: MERCADONA,
      brand: 'mahou clasica',
      brandKey: 'mahou',
      status: SourceEntryStatus.REJECTED,
    });

    const { spellings } = await service.brandSpellings({
      userId: ADMIN,
      keys: ['mahou'],
    });

    expect(spellings).toEqual([
      // Ordered by chain, then by count descending. `MAHOU` has two rows and
      // one of them is already a product, so it is counted once as queued.
      {
        supermarketId: MERCADONA,
        spelling: 'Mahou',
        productCount: 1,
        queuedCount: 0,
      },
      {
        supermarketId: CARREFOUR,
        spelling: 'MAHOU',
        productCount: 2,
        queuedCount: 1,
      },
      {
        supermarketId: CARREFOUR,
        spelling: 'Mahou',
        productCount: 1,
        queuedCount: 1,
      },
    ]);
  }, 180_000);

  it('answers nothing for a brand no source row carries', async () => {
    await expect(
      service.brandSpellings({ userId: ADMIN, keys: ['nobodyhasthis'] })
    ).resolves.toEqual({ spellings: [] });
  }, 180_000);
});
