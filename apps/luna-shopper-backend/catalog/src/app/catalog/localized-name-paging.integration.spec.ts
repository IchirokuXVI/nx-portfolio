import { JwtService } from '@nestjs/jwt';
import {
  ItemCategory,
  UnitOfMeasure,
  type LocalizedText,
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
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';
import { SupermarketService } from './supermarket.service';

/**
 * A name in one language, paged by name (plan 0079, section 3).
 *
 * Three admin listings page by keyset on the name. Before this plan they ordered
 * and seeked on `name ->> 'en'`; a row comparison with a NULL member yields
 * NULL, a NULL predicate drops the row, and `ORDER BY ... ASC` puts NULLs last,
 * so a product with no English name sorted to the end and every page after the
 * first excluded it from the seek. It appeared on no page, and nothing errored.
 *
 * **A mocked repository cannot check any of this**: the claim is about what
 * Postgres does with a row comparison over a missing jsonb key. The test seeds
 * seven rows, three with no `en`, pages two at a time and asserts every id
 * appears exactly once. It fails on the code as it stood with the type widened
 * and the paginators unchanged, and that is its purpose.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0079_paging_test';
const OWNER = 'ac790000-0000-4000-a000-000000000001';

/**
 * Seven names, three without English. The English ones are chosen to sort on
 * both sides of the Spanish only ones under the coalesced key, so a seek that
 * skipped them would skip rows in the middle of the listing and not only at its
 * end.
 */
const NAMES: readonly LocalizedText[] = [
  { en: 'Apples', es: 'Manzanas' },
  { es: 'Berenjena' },
  { en: 'Cheese', es: 'Queso' },
  { es: 'Dátiles' },
  { en: 'Eggs', es: 'Huevos' },
  { es: 'Fresas' },
  { en: 'Grapes', es: 'Uvas' },
];

describeIntegration('localized name paging (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;
  let groups: ProductGroupService;
  let chains: SupermarketService;

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
      // The scratch schema first, `public` behind it for `pg_trgm`: see the
      // search integration spec for that argument in full.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
    } as never);
    const events = {
      itemGroupChanged: jest.fn(),
      productGroupDeleted: jest.fn(),
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
    groups = new ProductGroupService(
      dataSource.getRepository(ProductGroup),
      admin,
      audit,
      events
    );
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      groups,
      admin,
      audit,
      events
    );
    chains = new SupermarketService(
      dataSource.getRepository(Supermarket),
      new PriceScopeService(
        dataSource.getRepository(PriceScope),
        dataSource.getRepository(Supermarket),
        admin,
        audit
      ),
      admin,
      audit
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  /** Every id across every page, two rows at a time, in the order served. */
  async function collect(
    page: (cursor: string | undefined) => Promise<{
      items: { id: string }[];
      nextCursor: string | null;
    }>
  ): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard += 1) {
      const result = await page(cursor);
      seen.push(...result.items.map((row) => row.id));
      if (result.nextCursor === null) {
        return seen;
      }
      cursor = result.nextCursor;
    }
    throw new Error('the listing never ran out of pages');
  }

  it('lists every product exactly once when some have no English name', async () => {
    const created: string[] = [];
    for (const name of NAMES) {
      const item = await items.create({
        userId: OWNER,
        name,
        category: ItemCategory.OTHER,
        defaultUnit: UnitOfMeasure.UNIT,
      });
      created.push(item.id);
    }

    const seen = await collect((cursor) =>
      items.search({ userId: OWNER, order: 'name', limit: 2, cursor })
    );

    expect(seen).toHaveLength(created.length);
    expect([...seen].sort()).toEqual([...created].sort());
  });

  it('lists every group exactly once when some have no English name', async () => {
    const created: string[] = [];
    for (const [index, name] of NAMES.entries()) {
      const group = await groups.create({
        userId: OWNER,
        name,
        slug: `group-${index}`,
        referenceUnit: UnitOfMeasure.UNIT,
        synonyms: { en: [], es: [] },
      });
      created.push(group.id);
    }

    const seen = await collect((cursor) =>
      groups.list({ userId: OWNER, limit: 2, cursor })
    );

    expect(seen).toHaveLength(created.length);
    expect([...seen].sort()).toEqual([...created].sort());
  });

  it('lists every chain exactly once when some have no English name', async () => {
    const created: string[] = [];
    for (const name of NAMES) {
      const chain = await chains.create({ userId: OWNER, name });
      created.push(chain.id);
    }

    const seen = await collect((cursor) =>
      chains.list({ userId: OWNER, order: 'name', limit: 2, cursor })
    );

    expect(seen).toHaveLength(created.length);
    expect([...seen].sort()).toEqual([...created].sort());
  });
});
