import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ItemCategory,
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  CATALOG_ENTITIES,
  Item,
  PriceScope,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationItem,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { PlatformAdminService } from './platform-admin.service';
import { SupermarketLocationItemService } from './supermarket-location-item.service';

/**
 * Per shop availability against real Postgres (plan 0084, section 9).
 *
 * What a fake cannot prove is here: that a batch of a few thousand entries goes
 * through in one transaction rather than a query per row, that the provenance
 * ladder survives a real `IN (...)` chunked over the batch, and that the scope
 * wide flag really is derived from every shop of the scope and not only from the
 * one that was written.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up 4
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0084_location_availability_test';

const HARVESTER = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '22222222-2222-4222-8222-222222222222';
const RUN = '44444444-4444-4444-8444-444444444444';

/** Enough that the chunking in the service is exercised rather than skipped. */
const BATCH = 3_000;

describeIntegration('per shop availability (real Postgres)', () => {
  let dataSource: DataSource;
  let shopItems: SupermarketLocationItemService;

  beforeAll(async () => {
    const url = requiredEnv('CATALOG_DB_URL');
    const bootstrap = new DataSource({ type: 'postgres', url });
    await bootstrap.initialize();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
    await bootstrap.destroy();

    dataSource = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: CATALOG_ENTITIES,
      migrations: CATALOG_MIGRATIONS,
      synchronize: false,
      extra: { options: `-c search_path=${SCHEMA}` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const admin = new PlatformAdminService(new JwtService({}), {
      getOrThrow: () => ({
        authJwtPublicKey: '',
        adminJwtPublicKey: '',
        serviceActorIds: [HARVESTER, OPERATOR],
      }),
    } as unknown as ConfigService);
    shopItems = new SupermarketLocationItemService(
      dataSource.getRepository(SupermarketLocationItem),
      dataSource.getRepository(Item),
      dataSource.getRepository(SupermarketLocation),
      admin,
      new CatalogAuditService(dataSource)
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  let scopeId: string;
  let shopA: string;
  let shopB: string;
  let itemIds: string[];

  beforeAll(async () => {
    const supermarkets = dataSource.getRepository(Supermarket);
    const chain = await supermarkets.save(
      supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
    );
    const scopes = dataSource.getRepository(PriceScope);
    scopeId = (
      await scopes.save(
        scopes.create({
          supermarketId: chain.id,
          kind: PriceScopeKind.NATIONAL,
          externalKey: null,
        })
      )
    ).id;
    const locations = dataSource.getRepository(SupermarketLocation);
    shopA = (
      await locations.save(
        locations.create({ supermarketId: chain.id, priceScopeId: scopeId })
      )
    ).id;
    shopB = (
      await locations.save(
        locations.create({ supermarketId: chain.id, priceScopeId: scopeId })
      )
    ).id;

    const items = dataSource.getRepository(Item);
    const created = await items.save(
      Array.from({ length: BATCH }, (_, i) =>
        items.create({
          name: { en: `Product ${i}`, es: `Producto ${i}` },
          category: ItemCategory.PANTRY,
          defaultUnit: UnitOfMeasure.UNIT,
        })
      ),
      { chunk: 500 }
    );
    itemIds = created.map((item) => item.id);
  }, 300_000);

  function crawl(
    supermarketLocationId: string,
    entries: { itemId: string; available: boolean }[],
    sourceKind = PriceSourceKind.OFFICIAL_WEB
  ) {
    return shopItems.setAvailability({
      userId: HARVESTER,
      supermarketLocationId,
      sourceKind,
      sourceRunId: sourceKind === PriceSourceKind.ADMIN ? null : RUN,
      entries,
    });
  }

  it(`writes ${BATCH} entries, then confirms them for nothing`, async () => {
    // The negatives are the point: a shop missing from a product's list of
    // shops does not stock it, so a run sends a value for every product it
    // resolved.
    const entries = itemIds.map((itemId, i) => ({
      itemId,
      available: i % 3 !== 0,
    }));

    const first = await crawl(shopA, entries);
    expect(first.written).toBe(BATCH);
    expect(first.skipped).toBe(0);
    expect(first.conflicts).toEqual([]);

    const again = await crawl(shopA, entries);
    expect(again.written).toBe(0);
    expect(again.skipped).toBe(BATCH);

    const stored = await dataSource
      .getRepository(SupermarketLocationItem)
      .findBy({ supermarketLocationId: shopA });
    expect(stored).toHaveLength(BATCH);
    expect(
      stored.every(
        (row) =>
          row.availabilitySourceKind === PriceSourceKind.OFFICIAL_WEB &&
          row.availabilitySourceRunId === RUN
      )
    ).toBe(true);
    // False, never null: absence of stock is a claim and absence of a crawl is
    // not, and only one of the two is what a run saw.
    expect(stored.filter((row) => row.available === false).length).toBe(
      entries.filter((entry) => !entry.available).length
    );
    expect(stored.some((row) => row.available === null)).toBe(false);
  }, 300_000);

  it('declines every row a person owns, and names them', async () => {
    const typed = itemIds.slice(0, 5);
    await crawl(
      shopB,
      typed.map((itemId) => ({ itemId, available: true })),
      PriceSourceKind.ADMIN
    );

    const result = await crawl(
      shopB,
      itemIds.slice(0, 10).map((itemId) => ({ itemId, available: false }))
    );
    expect(result.written).toBe(5);
    expect(result.conflicts.map((c) => c.itemId).sort()).toEqual(
      [...typed].sort()
    );
    expect(result.conflicts.every((c) => c.held === true && !c.offered)).toBe(
      true
    );

    const survivors = await dataSource
      .getRepository(SupermarketLocationItem)
      .findBy({ supermarketLocationId: shopB });
    for (const row of survivors.filter((r) => typed.includes(r.itemId))) {
      expect(row.available).toBe(true);
      expect(row.availabilitySourceKind).toBe(PriceSourceKind.ADMIN);
    }
  }, 300_000);

  /**
   * Section 5, over two real shops of one scope. Shop A said false for these
   * products and shop B says true, so the scope carries them: "any true wins"
   * is a claim about the scope and not about the shop that was written last.
   */
  it('derives the scope flag from every shop of the scope', async () => {
    // Well clear of the rows test two handed to a person: an ADMIN row would
    // decline the crawl below and the derivation would be reading a fact
    // nobody wrote here.
    const bothFalse = itemIds[2000];
    const trueSomewhere = itemIds[2001];

    await crawl(shopA, [
      { itemId: bothFalse, available: false },
      { itemId: trueSomewhere, available: false },
    ]);
    await crawl(shopB, [
      { itemId: bothFalse, available: false },
      { itemId: trueSomewhere, available: true },
    ]);

    const scopeRows = dataSource.getRepository(SupermarketItem);
    expect(
      (await scopeRows.findOneBy({ itemId: bothFalse, priceScopeId: scopeId }))
        ?.available
    ).toBe(false);
    expect(
      (
        await scopeRows.findOneBy({
          itemId: trueSomewhere,
          priceScopeId: scopeId,
        })
      )?.available
    ).toBe(true);
  }, 300_000);
});
