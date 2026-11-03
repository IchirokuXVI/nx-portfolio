import {
  CATALOG_EVENTS,
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES, SourceCatalogEntry } from '../entities';
import { ItemMergeService } from './item-merge.service';
import type { PlatformAdminService } from './platform-admin.service';

/**
 * The harvester's half of a product merge, against real Postgres (plan 0239).
 *
 * What is under test is SQL: the counts and chains catalog asks for before a
 * merge or a delete, and the one statement that moves the rows of a merged
 * product onto its survivor. That statement is also why the harvester needs no
 * inbox for this event: a second delivery finds nothing to move.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services harvester
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration --testFile=item-merge.integration.spec.ts --runInBand
 */
const ADMIN = 'owner-1';

/** Two chains nothing else in this database uses, so cleanup is exact. */
const CHAIN_A = 'b2390000-0000-4000-a000-000000000001';
const CHAIN_B = 'b2390000-0000-4000-a000-000000000002';

const MERGED = 'c2390000-0000-4000-a000-000000000001';
const SURVIVOR = 'c2390000-0000-4000-a000-000000000002';
const UNTOUCHED = 'c2390000-0000-4000-a000-000000000003';

describeIntegration('the harvester and a product merge (real Postgres)', () => {
  let dataSource: DataSource;
  let service: ItemMergeService;
  let gated: number;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    service = new ItemMergeService(
      dataSource.getRepository(SourceCatalogEntry),
      {
        requireAdmin: async () => {
          gated += 1;
          return ADMIN;
        },
      } as unknown as PlatformAdminService
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    gated = 0;
    await clean();
  });

  function clean() {
    return dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = ANY($1::uuid[])`,
      [[CHAIN_A, CHAIN_B]]
    );
  }

  let seq = 0;

  async function entry(
    supermarketId: string,
    itemId: string | null,
    status: SourceEntryStatus
  ): Promise<string> {
    seq += 1;
    const [row] = await dataSource.query(
      `INSERT INTO "source_catalog_entries"
              ("supermarketId", "externalId", "sourceKind", "name", "itemId", "status")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING "id"`,
      [
        supermarketId,
        `plan0239-${seq}`,
        PriceSourceKind.OFFICIAL_API,
        `Kiwi ${seq}`,
        itemId,
        status,
      ]
    );
    return row.id as string;
  }

  const itemOf = async (id: string): Promise<string | null> =>
    (
      (await dataSource.query(
        `SELECT "itemId" FROM "source_catalog_entries" WHERE "id" = $1`,
        [id]
      )) as { itemId: string | null }[]
    )[0].itemId;

  it('counts the rows of each product and names the chains of its ACTIVE rows', async () => {
    await entry(CHAIN_A, MERGED, SourceEntryStatus.ACTIVE);
    await entry(CHAIN_B, MERGED, SourceEntryStatus.CANDIDATE);
    await entry(CHAIN_B, SURVIVOR, SourceEntryStatus.ACTIVE);
    await entry(CHAIN_A, SURVIVOR, SourceEntryStatus.ACTIVE);
    await entry(CHAIN_A, SURVIVOR, SourceEntryStatus.ACTIVE);

    const answer = await service.usage({
      userId: ADMIN,
      adminToken: 'token',
      itemIds: [MERGED, SURVIVOR, UNTOUCHED, 'not-a-uuid'],
    });

    expect(gated).toBe(1);
    expect(answer.usage).toEqual([
      { itemId: MERGED, rowCount: 2, activeSupermarketIds: [CHAIN_A] },
      {
        itemId: SURVIVOR,
        rowCount: 3,
        activeSupermarketIds: [CHAIN_A, CHAIN_B],
      },
      // Nothing names these, and they are still answered.
      { itemId: UNTOUCHED, rowCount: 0, activeSupermarketIds: [] },
      { itemId: 'not-a-uuid', rowCount: 0, activeSupermarketIds: [] },
    ]);
  });

  it('moves every row of the merged product, and a second delivery changes nothing', async () => {
    const active = await entry(CHAIN_A, MERGED, SourceEntryStatus.ACTIVE);
    const candidate = await entry(CHAIN_B, MERGED, SourceEntryStatus.CANDIDATE);
    const rejected = await entry(CHAIN_B, MERGED, SourceEntryStatus.REJECTED);
    const other = await entry(CHAIN_A, UNTOUCHED, SourceEntryStatus.ACTIVE);
    const event = {
      eventId: 'e2390000-0000-4000-a000-000000000001',
      itemId: MERGED,
      intoItemId: SURVIVOR,
    };

    await service.onItemMerged(event);

    for (const id of [active, candidate, rejected]) {
      expect(await itemOf(id)).toBe(SURVIVOR);
    }
    expect(await itemOf(other)).toBe(UNTOUCHED);
    const snapshot = await dataSource.query(
      `SELECT "id", "itemId", "status", "updatedAt" FROM "source_catalog_entries"
        WHERE "supermarketId" = ANY($1::uuid[]) ORDER BY "id"`,
      [[CHAIN_A, CHAIN_B]]
    );

    // The same event again, as an at least once broker may deliver it.
    await service.onItemMerged(event);

    expect(
      await dataSource.query(
        `SELECT "id", "itemId", "status", "updatedAt" FROM "source_catalog_entries"
          WHERE "supermarketId" = ANY($1::uuid[]) ORDER BY "id"`,
        [[CHAIN_A, CHAIN_B]]
      )
    ).toEqual(snapshot);
    // An event about catalog needs no operator: it is not gated.
    expect(gated).toBe(0);
  });

  it(`ignores a malformed ${CATALOG_EVENTS.itemMerged} and throws nothing`, async () => {
    const row = await entry(CHAIN_A, MERGED, SourceEntryStatus.ACTIVE);

    await expect(
      service.onItemMerged({
        eventId: 'x',
        itemId: MERGED,
        intoItemId: 'nope',
      })
    ).resolves.toBeUndefined();

    expect(await itemOf(row)).toBe(MERGED);
  });
});
