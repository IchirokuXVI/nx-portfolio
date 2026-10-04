import { JwtService } from '@nestjs/jwt';
import { UnitOfMeasure } from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ItemEanHeldException,
  ItemEanInvalidException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { categoryId } from '../db/taxonomy/ids';
import { seedTaxonomy } from '../db/taxonomy/taxonomy-seed';
import {
  Brand,
  CATALOG_ENTITIES,
  Category,
  Item,
  ProductGroup,
  SupermarketItem,
} from '../entities';
import type { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * A product's barcodes through the item service, against real Postgres (plan
 * 0185).
 *
 * The table's own rules are `item-eans-migration.integration.spec.ts`'s claim.
 * This file is about what a caller sees, and about the things a double cannot
 * prove: that the product and its barcode rows are written in one transaction
 * and roll back together, that a duplicate is refused by the primary key and
 * read as a conflict, and that the search SQL finds a product by a barcode
 * that is not its first.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-eans.integration.spec.ts
 */
const SCHEMA = 'plan0185_item_eans_test';
const OWNER = 'ac700000-0000-4000-a000-000000000185';

const FIRST = '8402001002083';
const SECOND = '8402001047251';
const THIRD = '4006381333931';
const FOURTH = '96385074';
const IN_STORE = '2204500000000';

describeIntegration('a product’s barcodes (real Postgres)', () => {
  let dataSource: DataSource;
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
      // `public` for the extensions the search reads, after the scratch schema.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.transaction((m) => seedTaxonomy(m));

    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({ adminJwtPublicKey: '', serviceActorIds: [OWNER] }),
    } as never);
    const events = {
      itemGroupChanged: () => undefined,
      productGroupDeleted: () => undefined,
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
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
      events,
      new CategoryService(dataSource.getRepository(Category), admin, audit),
      itemEanStoreOf(dataSource)
    );
  }, 180_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM "items"`);
  });

  const input = (name: string, ean: string | null) => ({
    name: { es: name, en: name },
    categoryIds: [categoryId('frozen-pizzas')],
    defaultUnit: UnitOfMeasure.MILLILITER,
    unitSize: 1000,
    ean,
  });
  const product = (name: string, ean: string | null) =>
    items.create({ userId: OWNER, ...input(name, ean) });

  const rows = (): Promise<{ ean: string; itemId: string }[]> =>
    dataSource.query(
      `SELECT "ean", "itemId" FROM "item_eans" ORDER BY "createdAt", "ean"`
    );
  const count = async (table: string): Promise<number> => {
    const [{ n }] = await dataSource.query(
      `SELECT count(*)::int AS "n" FROM "${table}"`
    );
    return n as number;
  };

  it('writes a created product’s barcode as a row, in the same transaction', async () => {
    const milk = await product('Leche entera', FIRST);
    expect(milk.ean).toBe(FIRST);
    expect(milk.eans).toEqual([FIRST]);
    expect(await rows()).toEqual([{ ean: FIRST, itemId: milk.id }]);

    const bare = await product('Novedad', null);
    expect(bare.eans).toEqual([]);
    expect(await count('item_eans')).toBe(1);
  }, 60_000);

  it('finds a product by its second barcode: the lookup, the batch lookup and both branches of the search', async () => {
    const milk = await product('Leche entera', FIRST);
    await product('Leche semidesnatada', THIRD);
    const view = await items.addEan({
      userId: OWNER,
      itemId: milk.id,
      ean: SECOND,
    });
    expect(view.ean).toBe(FIRST);
    expect(view.eans).toEqual([FIRST, SECOND]);

    // The acceptance criterion.
    const found = await items.findByEan({ userId: OWNER, ean: SECOND });
    expect(found.item?.id).toBe(milk.id);
    expect(found.item?.eans).toEqual([FIRST, SECOND]);
    expect((await items.findByEan({ userId: OWNER, ean: FOURTH })).item).toBe(
      null
    );

    const batch = await items.findByEans({
      userId: OWNER,
      eans: [SECOND, FIRST, FOURTH],
    });
    expect(batch.items.map((item) => item.id)).toEqual([milk.id]);

    // Ranked: the scanned product is the first hit, by a barcode that is not
    // its `items.ean`.
    const ranked = await items.search({ userId: OWNER, query: SECOND });
    expect(ranked.items.map((item) => item.id)).toEqual([milk.id]);
    expect(ranked.items[0].eans).toEqual([FIRST, SECOND]);
    // Listed: an admin who pastes it into a table ordered by name.
    const listed = await items.search({
      userId: OWNER,
      query: SECOND,
      order: 'name',
    });
    expect(listed.items.map((item) => item.id)).toEqual([milk.id]);
    // A barcode nobody holds finds nothing on either branch.
    expect(
      (await items.search({ userId: OWNER, query: FOURTH })).items
    ).toEqual([]);

    // Every other read carries the list too.
    expect((await items.getMany({ ids: [milk.id] })).items[0].eans).toEqual([
      FIRST,
      SECOND,
    ]);
    expect((await items.get({ userId: OWNER, itemId: milk.id })).eans).toEqual([
      FIRST,
      SECOND,
    ]);
  }, 60_000);

  it('refuses a barcode another product holds, on every write that could give it away', async () => {
    const milk = await product('Leche entera', FIRST);
    const other = await product('Leche semidesnatada', THIRD);
    await items.addEan({ userId: OWNER, itemId: milk.id, ean: SECOND });

    // The admin operation names the holder.
    const held = await items
      .addEan({ userId: OWNER, itemId: other.id, ean: SECOND })
      .catch((error: unknown) => error);
    expect(held).toBeInstanceOf(ItemEanHeldException);
    expect(held).toMatchObject({
      code: 'item_ean_held',
      details: { ean: SECOND, heldBy: milk.id },
    });

    // A create with another product's second barcode is refused by the
    // primary key, read as the same conflict a duplicate first barcode is,
    // and the product is not left behind.
    await expect(product('Leche duplicada', SECOND)).rejects.toBeInstanceOf(
      ConflictException
    );
    // A batch rolls back whole: the first product of it is gone too.
    await expect(
      items.createMany({
        userId: OWNER,
        items: [input('Mantequilla', FOURTH), input('Leche duplicada', SECOND)],
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await count('items')).toBe(2);
    expect((await items.findByEan({ userId: OWNER, ean: FOURTH })).item).toBe(
      null
    );

    // An edit that types it as another product's first barcode.
    await expect(
      items.update({ userId: OWNER, itemId: other.id, ean: SECOND })
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await items.get({ userId: OWNER, itemId: other.id })).ean).toBe(
      THIRD
    );

    // An in-store code is never a row.
    await expect(
      items.addEan({ userId: OWNER, itemId: milk.id, ean: IN_STORE })
    ).rejects.toBeInstanceOf(ItemEanInvalidException);
    expect((await rows()).map((row) => row.ean).sort()).toEqual(
      [FIRST, SECOND, THIRD].sort()
    );
  }, 60_000);

  it('keeps items.ean one of the rows through an edit, a removal and a delete', async () => {
    const milk = await product('Leche entera', FIRST);
    await items.addEan({ userId: OWNER, itemId: milk.id, ean: SECOND });

    // A new first barcode replaces the old first one and keeps the rest.
    const replaced = await items.update({
      userId: OWNER,
      itemId: milk.id,
      ean: THIRD,
    });
    expect(replaced.ean).toBe(THIRD);
    expect(replaced.eans).toEqual([THIRD, SECOND]);

    // A barcode the product already holds is a reorder: it becomes the first,
    // and the old first barcode stays a barcode of the product.
    const reordered = await items.update({
      userId: OWNER,
      itemId: milk.id,
      ean: SECOND,
    });
    expect(reordered.ean).toBe(SECOND);
    expect(reordered.eans).toEqual([SECOND, THIRD]);
    expect(await count('item_eans')).toBe(2);
    await items.update({ userId: OWNER, itemId: milk.id, ean: THIRD });

    // Taking the first one off promotes the oldest of the rest.
    const promoted = await items.removeEan({
      userId: OWNER,
      itemId: milk.id,
      ean: THIRD,
    });
    expect(promoted.ean).toBe(SECOND);
    expect(promoted.eans).toEqual([SECOND]);
    const [{ ean }] = await dataSource.query(
      `SELECT "ean" FROM "items" WHERE "id" = $1`,
      [milk.id]
    );
    expect(ean).toBe(SECOND);

    // Clearing the last one leaves a product with no barcode at all.
    const bare = await items.update({
      userId: OWNER,
      itemId: milk.id,
      ean: null,
    });
    expect(bare.ean).toBeNull();
    expect(bare.eans).toEqual([]);
    expect(await count('item_eans')).toBe(0);

    // And a deleted product takes its rows with it.
    await items.addEan({ userId: OWNER, itemId: milk.id, ean: FIRST });
    await items.addEan({ userId: OWNER, itemId: milk.id, ean: SECOND });
    await items.delete({ userId: OWNER, itemId: milk.id });
    expect(await count('item_eans')).toBe(0);
  }, 60_000);

  it('teaches barcodes in one transaction, and names the ones another product holds', async () => {
    const milk = await product('Leche entera', FIRST);
    const butter = await product('Mantequilla', null);

    const result = await items.teachEans({
      userId: OWNER,
      entries: [
        { itemId: milk.id, ean: SECOND },
        { itemId: butter.id, ean: FIRST },
        { itemId: butter.id, ean: THIRD },
        { itemId: butter.id, ean: IN_STORE },
      ],
    });

    expect(result.added).toBe(2);
    expect(result.refused).toEqual([
      { itemId: butter.id, ean: IN_STORE, reason: 'INVALID', heldBy: null },
      { itemId: butter.id, ean: FIRST, reason: 'HELD', heldBy: milk.id },
    ]);
    expect(
      (await items.findByEan({ userId: OWNER, ean: SECOND })).item?.id
    ).toBe(milk.id);
    // A product with no first barcode takes the one it was taught as its
    // first, so `items.ean` is not empty while the product holds a barcode.
    const taught = await items.get({ userId: OWNER, itemId: butter.id });
    expect(taught.ean).toBe(THIRD);
    expect(taught.eans).toEqual([THIRD]);
  }, 60_000);
});
