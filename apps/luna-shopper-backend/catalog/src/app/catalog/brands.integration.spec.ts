import { JwtService } from '@nestjs/jwt';
import { ItemCategory, UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  BrandKeyTakenException,
  BrandLabelEmptyException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  Brand,
  CATALOG_ENTITIES,
  Item,
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { BrandService } from './brand.service';
import { CatalogAuditService } from './catalog-audit.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * The registry against real Postgres (plan 0115, section 10).
 *
 * Every claim here is a claim about SQL a double cannot make: a unique index
 * raising the 409, an update claiming rows by key inside the create's own
 * transaction, the search trigger rebuilding a document because `items.brand`
 * moved, and a keyset cursor walking a table without a gap or a repeat.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   docker run -d --name tmp-pg-catalog -e POSTGRES_PASSWORD=pw \
 *     -e POSTGRES_DB=catalog -p 45991:5432 postgres:16-alpine
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://postgres:pw@localhost:45991/catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0115_brands_test';

const OWNER = '44444444-4444-4444-8444-444444444444';

describeIntegration('the brand registry (real Postgres)', () => {
  let dataSource: DataSource;
  let brands: BrandService;
  let items: ItemService;

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
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    // The service branch of the gate, which needs no keypair. Who came through
    // which door is plan 0072's subject, not this file's.
    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({
        adminJwtPublicKey: '',
        serviceActorIds: [OWNER],
      }),
    } as never);
    const events = {
      itemGroupChanged: jest.fn(),
      productGroupDeleted: jest.fn(),
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);

    brands = new BrandService(dataSource.getRepository(Brand), admin, audit);
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Brand),
      new ProductGroupService(
        dataSource.getRepository(ProductGroup),
        admin,
        audit,
        events
      ),
      admin,
      audit,
      events
    );
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Items reference brands, so they go first.
    await dataSource.query(`DELETE FROM "items"`);
    await dataSource.query(`DELETE FROM "brands"`);
    await dataSource.query(`DELETE FROM "supermarkets"`);
  });

  const product = (name: string, brand: string | null) =>
    items.create({
      userId: OWNER,
      name: { es: name },
      brand,
      category: ItemCategory.OTHER,
      defaultUnit: UnitOfMeasure.UNIT,
    });

  async function itemRow(id: string) {
    const [row] = await dataSource.query(
      `SELECT "brand", "brandKey", "brandId" FROM "items" WHERE "id" = $1`,
      [id]
    );
    return row as {
      brand: string | null;
      brandKey: string | null;
      brandId: string | null;
    };
  }

  it('claims the products already carrying its key, and says how many', async () => {
    const shouted = await product('Cerveza', 'MAHOU');
    const written = await product('Cerveza Tostada', 'Mahou');
    const other = await product('Jamon', 'El Pozo');

    const created = await brands.create({ userId: OWNER, label: 'Mahou' });

    expect(created.linkedItems).toBe(2);
    expect(created.itemCount).toBe(2);
    // The label is copied onto `items.brand`, byte for byte, so the search
    // trigger and the trigram index keep reading the one column they always did.
    expect((await itemRow(shouted.id)).brand).toBe('Mahou');
    expect((await itemRow(written.id)).brandId).toBe(created.id);
    expect((await itemRow(other.id)).brandId).toBeNull();
  }, 180_000);

  it('makes the linked products findable under the label', async () => {
    const shouted = await product('Cerveza', 'MAHOU');
    await brands.create({ userId: OWNER, label: 'Mahou' });

    // `tg_items_search` fires on the update the create made, so the document is
    // rebuilt with no extra work. Reading the vector is what proves it, because
    // a search would also pass on the name alone.
    const [row] = await dataSource.query(
      `SELECT "search_es"::text AS vector FROM "items" WHERE "id" = $1`,
      [shouted.id]
    );
    expect(row.vector).toContain('mahou');
  }, 180_000);

  it('refuses a second brand on one key, and names the one holding it', async () => {
    const first = await brands.create({ userId: OWNER, label: 'El Pozo' });

    const second = brands.create({ userId: OWNER, label: 'ELPOZO' });

    await expect(second).rejects.toBeInstanceOf(BrandKeyTakenException);
    await expect(second).rejects.toMatchObject({
      // The id is the whole reason this is not a plain conflict.
      details: { brandId: first.id },
    });
  }, 180_000);

  it('refuses a label that makes no key, and writes nothing', async () => {
    await expect(
      brands.create({ userId: OWNER, label: '---' })
    ).rejects.toBeInstanceOf(BrandLabelEmptyException);

    const [{ count }] = await dataSource.query(
      `SELECT count(*)::int AS count FROM "brands"`
    );
    expect(count).toBe(0);
  }, 180_000);

  it('a rename rewrites every linked product and picks up the newly matching', async () => {
    const misspelled = await product('Leche', 'Hacenado');
    const correct = await product('Yogur', 'Hacendado');
    const brand = await brands.create({ userId: OWNER, label: 'Hacenado' });
    expect((await itemRow(misspelled.id)).brandId).toBe(brand.id);
    expect((await itemRow(correct.id)).brandId).toBeNull();

    const renamed = await brands.update({
      userId: OWNER,
      brandId: brand.id,
      label: 'Hacendado',
    });

    expect(renamed.key).toBe('hacendado');
    // Linked under the old key, and still linked: it was this brand, and a
    // corrected spelling does not change that. Its text is rewritten too.
    const wasMisspelled = await itemRow(misspelled.id);
    expect(wasMisspelled.brandId).toBe(brand.id);
    expect(wasMisspelled.brand).toBe('Hacendado');
    expect(wasMisspelled.brandKey).toBe('hacendado');
    // And the one the new key has just made matchable is claimed.
    expect((await itemRow(correct.id)).brandId).toBe(brand.id);
    expect(renamed.itemCount).toBe(2);
  }, 180_000);

  it('an item written against a registered key stores the label', async () => {
    const brand = await brands.create({ userId: OWNER, label: 'Mahou' });

    const created = await product('Cerveza', 'MAHOU');

    expect(created.brand).toBe('Mahou');
    expect((await itemRow(created.id)).brandId).toBe(brand.id);
  }, 180_000);

  it('counts products and pages both orders without a gap or a repeat', async () => {
    const chain = dataSource.getRepository(Supermarket);
    const mercadona = await chain.save(
      chain.create({
        name: { es: 'Testcadona' },
        logoUrl: null,
        websiteUrl: null,
        externalBrandKey: null,
      })
    );

    // Four brands with four different counts, so `itemCount` cannot be right by
    // accident of insertion order.
    const labels = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    for (const [index, label] of labels.entries()) {
      for (let n = 0; n < index; n += 1) {
        await product(`${label} ${n}`, label);
      }
    }
    for (const label of labels) {
      await brands.create({
        userId: OWNER,
        label,
        privateLabelSupermarketId: label === 'Delta' ? mercadona.id : null,
      });
    }

    const walk = async (order: 'label' | 'itemCount') => {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await brands.list({
          userId: OWNER,
          order,
          limit: 1,
          cursor,
        });
        seen.push(...page.items.map((row) => row.key));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return seen;
    };

    expect(await walk('label')).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
    // Most products first, and the counts are 0, 1, 2, 3 in declaration order.
    expect(await walk('itemCount')).toEqual([
      'delta',
      'charlie',
      'bravo',
      'alpha',
    ]);

    const counted = await brands.list({ userId: OWNER, order: 'itemCount' });
    expect(counted.items.map((row) => row.itemCount)).toEqual([3, 2, 1, 0]);

    // The two filters, on the same read.
    const keyed = await brands.list({ userId: OWNER, query: 'BRA vo' });
    expect(keyed.items.map((row) => row.key)).toEqual(['bravo']);
    const chainOnly = await brands.list({
      userId: OWNER,
      privateLabelSupermarketId: mercadona.id,
    });
    expect(chainOnly.items.map((row) => row.key)).toEqual(['delta']);

    // And the keys read, which is what the suggestions route subtracts.
    const { keys } = await brands.keys({ userId: OWNER });
    expect(keys).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  }, 300_000);
});
