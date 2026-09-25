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
 * The source rows that name one product, against real Postgres (plan 0160).
 *
 * Operator plan 0150 counted by hand, with psql, which EANs several rows of one
 * chain share. What is under test is the SQL that replaces that count: which
 * rows name the product, and a count per (chain, EAN) that spans every status.
 *
 *   docker run -d --name tmp-pg-harvester -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=harvester -p 45992:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://postgres:pw@localhost:45992/harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const ADMIN = 'owner-1';

/** Two chains nothing else in this database uses, so cleanup is exact. */
const MERCADONA = 'b1600000-0000-4000-a000-000000000001';
const CARREFOUR = 'b1600000-0000-4000-a000-000000000002';

const DORADA = 'c1600000-0000-4000-a000-000000000001';
const OTHER_ITEM = 'c1600000-0000-4000-a000-000000000002';

describeIntegration('source rows by product (real Postgres)', () => {
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

  async function entry(options: {
    supermarketId: string;
    ean: string | null;
    itemId: string | null;
    status: SourceEntryStatus;
    lastSeenAt?: string;
  }): Promise<string> {
    seq += 1;
    const [row] = await dataSource.query(
      `INSERT INTO "source_catalog_entries"
              ("supermarketId", "externalId", "sourceKind", "name", "ean",
               "itemId", "status", "lastSeenAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING "id"`,
      [
        options.supermarketId,
        `plan0160-${seq}`,
        PriceSourceKind.OFFICIAL_API,
        `Dorada ${seq}`,
        options.ean,
        options.itemId,
        options.status,
        options.lastSeenAt ?? '2026-09-01T00:00:00.000Z',
      ]
    );
    return row.id as string;
  }

  it('lists every row that names the product, and counts each EAN within its chain', async () => {
    // Mercadona lists the Dorada barcode three times: two bound rows and one a
    // person rejected. The rejected one still counts, it is the same barcode.
    const bound = await entry({
      supermarketId: MERCADONA,
      ean: '8480000123456',
      itemId: DORADA,
      status: SourceEntryStatus.ACTIVE,
      lastSeenAt: '2026-09-03T00:00:00.000Z',
    });
    const twin = await entry({
      supermarketId: MERCADONA,
      ean: '8480000123456',
      itemId: DORADA,
      status: SourceEntryStatus.ACTIVE,
      lastSeenAt: '2026-09-02T00:00:00.000Z',
    });
    await entry({
      supermarketId: MERCADONA,
      ean: '8480000123456',
      itemId: null,
      status: SourceEntryStatus.REJECTED,
    });
    // Carrefour carries the same barcode once. The count is per chain.
    await entry({
      supermarketId: CARREFOUR,
      ean: '8480000123456',
      itemId: OTHER_ITEM,
      status: SourceEntryStatus.ACTIVE,
    });
    // A proposal names the product too, and says so in its status.
    const proposed = await entry({
      supermarketId: CARREFOUR,
      ean: null,
      itemId: DORADA,
      status: SourceEntryStatus.CANDIDATE,
      lastSeenAt: '2026-09-01T00:00:00.000Z',
    });

    const page = await service.listByItem({ userId: ADMIN, itemId: DORADA });

    expect(
      page.items.map((row) => [row.id, row.status, row.eanSharedBy])
    ).toEqual([
      [bound, SourceEntryStatus.ACTIVE, 3],
      [twin, SourceEntryStatus.ACTIVE, 3],
      [proposed, SourceEntryStatus.CANDIDATE, null],
    ]);
    expect(page.nextCursor).toBeNull();
  }, 60_000);

  it('pages without a gap or a repeat', async () => {
    const ids: string[] = [];
    for (let day = 1; day <= 3; day += 1) {
      ids.push(
        await entry({
          supermarketId: MERCADONA,
          ean: `848000000000${day}`,
          itemId: DORADA,
          status: SourceEntryStatus.ACTIVE,
          lastSeenAt: `2026-09-0${day}T00:00:00.000Z`,
        })
      );
    }

    const first = await service.listByItem({
      userId: ADMIN,
      itemId: DORADA,
      limit: 2,
    });
    const second = await service.listByItem({
      userId: ADMIN,
      itemId: DORADA,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    expect([...first.items, ...second.items].map((row) => row.id)).toEqual(
      [...ids].reverse()
    );
    expect(first.items.every((row) => row.eanSharedBy === 1)).toBe(true);
    expect(second.nextCursor).toBeNull();
  }, 60_000);
});
