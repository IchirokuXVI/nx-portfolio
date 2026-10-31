import { JwtService } from '@nestjs/jwt';
import {
  brandKey,
  toBaseUnit,
  UnitOfMeasure,
  type ItemExpectationFailure,
} from '@portfolio/luna-shopper/contracts';
import {
  BRAND_LABELS_DETAIL,
  BrandUnregisteredException,
  CATEGORY_DETAIL,
  CATEGORY_UNKNOWN_DETAIL,
  CategoryNotALeafException,
  CategoryNotFoundException,
  ITEM_EXPECTATION_FAILURES_DETAIL,
  ITEM_GRAMS_DETAIL,
  ITEM_UNIT_BECOMES_DETAIL,
  ITEM_UNIT_DETAIL,
  ITEM_UNIT_SIZE_DETAIL,
  ItemExpectationFailedException,
  ItemKilogramHasSizeException,
  ItemUnitNotBaseException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, Repository } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { categoryId } from '../db/taxonomy/ids';
import {
  AuditAction,
  Brand,
  CATALOG_ENTITIES,
  CatalogAudit,
  Category,
  Item,
  ProductGroup,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { ProductGroupService } from './product-group.service';

/**
 * The operations of a catalog audit against real Postgres (plan 0237,
 * sections 3.2 to 3.6).
 *
 * Each rule here is a claim about one transaction: that an expectation is
 * compared before anything of the batch is written, that a refused batch
 * leaves every product as it was, and that the trail of a category edit is the
 * row the edit wrote. A double could only agree with itself on any of them.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own catalog data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services catalog
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=catalog-audit-operations.integration.spec.ts
 */
const SCHEMA = 'plan0237_audit_operations_test';

/** The operator. A service actor, so the gate needs no keypair. */
const OPERATOR = '37237237-2372-4372-8372-237237237237';

describeIntegration('the operations of a catalog audit (real Postgres)', () => {
  let dataSource: DataSource;
  let trail: Repository<CatalogAudit>;
  let brands: Repository<Brand>;
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

    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({
        adminJwtPublicKey: '',
        serviceActorIds: [OPERATOR],
      }),
    } as never);
    const events = {
      itemGroupChanged: () => undefined,
      productGroupDeleted: () => undefined,
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
    trail = dataSource.getRepository(CatalogAudit);
    brands = dataSource.getRepository(Brand);
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      brands,
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

    await brands.save(
      brands.create({
        key: 'pierrot',
        label: 'Pierrot',
        privateLabelSupermarketId: null,
        canonicalBrandId: null,
      })
    );
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await trail.clear();
  });

  /** A sized product of one registered brand on two leaves, in that order. */
  function newProduct(es = 'Galletas de chocolate') {
    return items.create({
      userId: OPERATOR,
      name: { es, en: 'Chocolate biscuits' },
      brand: 'Pierrot',
      unitSize: 4000,
      defaultUnit: UnitOfMeasure.GRAM,
      categoryIds: [categoryId('milk'), categoryId('eggs')],
    });
  }

  async function refusal(work: Promise<unknown>): Promise<{
    error: ItemExpectationFailedException;
    failures: ItemExpectationFailure[];
  }> {
    const error = await work.then(
      () => {
        throw new Error('expected the write to be refused');
      },
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ItemExpectationFailedException);
    const refused = error as ItemExpectationFailedException;
    return {
      error: refused,
      failures: refused.details?.[
        ITEM_EXPECTATION_FAILURES_DETAIL
      ] as ItemExpectationFailure[],
    };
  }

  describe('3.2: an entry states what it expects', () => {
    it('writes an entry whose expectation holds', async () => {
      const product = await newProduct();

      const { items: written } = await items.updateMany({
        userId: OPERATOR,
        items: [
          {
            itemId: product.id,
            name: { es: 'Galletas Pierrot', en: 'Pierrot biscuits' },
            expect: {
              // Both halves, each trimmed.
              name: {
                es: '  Galletas de chocolate ',
                en: 'Chocolate biscuits',
              },
              brand: 'Pierrot',
              unitSize: 4000,
              defaultUnit: UnitOfMeasure.GRAM,
              packCount: null,
              categorySlugs: ['milk', 'eggs'],
            },
          },
        ],
      });

      expect(written[0].name).toEqual({
        es: 'Galletas Pierrot',
        en: 'Pierrot biscuits',
      });
    });

    it('compares the brand by key, so another spelling of the label agrees', async () => {
      const product = await newProduct();

      await expect(
        items.updateMany({
          userId: OPERATOR,
          items: [
            {
              itemId: product.id,
              packCount: 6,
              expect: { brand: 'PIERROT.' },
            },
          ],
        })
      ).resolves.toMatchObject({ items: [{ packCount: 6 }] });
    });

    it('refuses the whole batch on one wrong brand, names the entry, the field and the value, and writes nothing', async () => {
      const first = await newProduct('Primero');
      const second = await newProduct('Segundo');

      const { failures } = await refusal(
        items.updateMany({
          userId: OPERATOR,
          items: [
            {
              itemId: first.id,
              name: { es: 'Cambiado', en: 'Changed' },
              expect: { brand: 'Pierrot' },
            },
            {
              itemId: second.id,
              name: { es: 'Cambiado dos', en: 'Changed two' },
              expect: { brand: 'Cuétara', unitSize: 4000 },
            },
          ],
        })
      );

      expect(failures).toEqual([
        {
          itemId: second.id,
          fields: [{ field: 'brand', expected: 'Cuétara', actual: 'Pierrot' }],
        },
      ]);
      const [kept] = (await items.getMany({ ids: [first.id] })).items;
      expect(kept.name.es).toBe('Primero');
      // The two creates, and no edit.
      expect(await trail.count({ where: { action: AuditAction.UPDATE } })).toBe(
        0
      );
    });

    it('refuses categorySlugs in another order', async () => {
      const product = await newProduct();

      const { failures } = await refusal(
        items.update({
          userId: OPERATOR,
          itemId: product.id,
          packCount: 12,
          expect: { categorySlugs: ['eggs', 'milk'] },
        })
      );

      expect(failures[0].fields).toEqual([
        {
          field: 'categorySlugs',
          expected: ['eggs', 'milk'],
          actual: ['milk', 'eggs'],
        },
      ]);
    });

    it('reads null as "the product holds nothing here"', async () => {
      const product = await newProduct();

      const { failures } = await refusal(
        items.update({
          userId: OPERATOR,
          itemId: product.id,
          packCount: 12,
          // No pack count is right; no brand and no size are not.
          expect: { packCount: null, brand: null, unitSize: null },
        })
      );

      expect(failures[0].fields).toEqual([
        { field: 'brand', expected: null, actual: 'Pierrot' },
        { field: 'unitSize', expected: null, actual: 4000 },
      ]);
    });

    it('reads a null expectation from the bus as none, and writes the edit', async () => {
      const product = await newProduct();

      await expect(
        items.updateMany({
          userId: OPERATOR,
          items: [
            {
              itemId: product.id,
              packCount: 6,
              // The gateway refuses it; a caller on the bus is not validated.
              expect: null as never,
            },
          ],
        })
      ).resolves.toMatchObject({ items: [{ packCount: 6 }] });
    });

    it('refuses a name whose missing half the product holds', async () => {
      const product = await newProduct();

      const { failures } = await refusal(
        items.update({
          userId: OPERATOR,
          itemId: product.id,
          packCount: 12,
          expect: { name: { es: 'Galletas de chocolate' } },
        })
      );

      expect(failures[0].fields[0]).toMatchObject({
        field: 'name',
        actual: { es: 'Galletas de chocolate', en: 'Chocolate biscuits' },
      });
    });
  });

  describe('3.3: the unit rules the service left to the tools', () => {
    async function caught(work: Promise<unknown>): Promise<unknown> {
      return work.then(
        () => {
          throw new Error('expected the write to be refused');
        },
        (error: unknown) => error
      );
    }

    it('refuses KILOGRAM alone on a product sized 4000 GRAM, naming the grams, and writes nothing', async () => {
      const product = await newProduct();

      const error = await caught(
        items.updateMany({
          userId: OPERATOR,
          items: [{ itemId: product.id, defaultUnit: UnitOfMeasure.KILOGRAM }],
        })
      );

      expect(error).toBeInstanceOf(ItemKilogramHasSizeException);
      expect((error as ItemKilogramHasSizeException).details).toEqual({
        itemId: product.id,
        [ITEM_UNIT_SIZE_DETAIL]: 4000,
        [ITEM_GRAMS_DETAIL]: 4_000_000,
      });
      const [kept] = (await items.getMany({ ids: [product.id] })).items;
      expect(kept).toMatchObject({
        defaultUnit: UnitOfMeasure.GRAM,
        unitSize: 4000,
      });
    });

    it('applies KILOGRAM with a null size', async () => {
      const product = await newProduct();

      const { items: written } = await items.updateMany({
        userId: OPERATOR,
        items: [
          {
            itemId: product.id,
            defaultUnit: UnitOfMeasure.KILOGRAM,
            unitSize: null,
          },
        ],
      });

      expect(written[0]).toMatchObject({
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
      });
    });

    it('refuses LITER on a create, naming the unit and the size it becomes', async () => {
      const error = await caught(
        items.create({
          userId: OPERATOR,
          name: { es: 'Leche', en: 'Milk' },
          unitSize: 1.5,
          defaultUnit: UnitOfMeasure.LITER,
          categoryIds: [categoryId('milk')],
        })
      );

      expect(error).toBeInstanceOf(ItemUnitNotBaseException);
      expect((error as ItemUnitNotBaseException).details).toEqual({
        [ITEM_UNIT_DETAIL]: UnitOfMeasure.LITER,
        [ITEM_UNIT_BECOMES_DETAIL]: UnitOfMeasure.MILLILITER,
        [ITEM_UNIT_SIZE_DETAIL]: 1500,
      });
    });

    it('refuses LITER on an update, and PACK in a create batch by its position', async () => {
      const product = await newProduct();

      const onUpdate = await caught(
        items.update({
          userId: OPERATOR,
          itemId: product.id,
          defaultUnit: UnitOfMeasure.LITER,
          unitSize: 1,
        })
      );
      const inBatch = await caught(
        items.createMany({
          userId: OPERATOR,
          items: [
            {
              name: { es: 'Uno', en: 'One' },
              defaultUnit: UnitOfMeasure.UNIT,
              categoryIds: [categoryId('eggs')],
            },
            {
              name: { es: 'Seis', en: 'Six' },
              unitSize: 6,
              defaultUnit: UnitOfMeasure.PACK,
              categoryIds: [categoryId('eggs')],
            },
          ],
        })
      );

      expect(onUpdate).toBeInstanceOf(ItemUnitNotBaseException);
      expect((onUpdate as ItemUnitNotBaseException).details).toMatchObject({
        itemId: product.id,
        [ITEM_UNIT_BECOMES_DETAIL]: UnitOfMeasure.MILLILITER,
      });
      expect(inBatch).toBeInstanceOf(ItemUnitNotBaseException);
      expect((inBatch as ItemUnitNotBaseException).details).toEqual({
        index: 1,
        [ITEM_UNIT_DETAIL]: UnitOfMeasure.PACK,
        [ITEM_UNIT_BECOMES_DETAIL]: UnitOfMeasure.UNIT,
        [ITEM_UNIT_SIZE_DETAIL]: 6,
      });
      // The first entry was valid, and the refusal of the second took it too.
      const [{ count }] = (await dataSource.query(
        `SELECT count(*)::int AS "count" FROM "items" WHERE "name"->>'es' = 'Uno'`
      )) as { count: number }[];
      expect(count).toBe(0);
    });

    it('still saves a rename of a product that already holds LITER, because the edit does not touch the unit', async () => {
      // A row from before the rule, written past the service as a cluster
      // could hold one. Check A3 of plan 0186 counts none in the first
      // catalog; a cluster that holds one keeps it until a write sets a unit.
      const old = await items.create({
        userId: OPERATOR,
        name: { es: 'Leche antigua', en: 'Old milk' },
        defaultUnit: UnitOfMeasure.MILLILITER,
        categoryIds: [categoryId('milk')],
      });
      await dataSource
        .getRepository(Item)
        .update({ id: old.id }, { defaultUnit: UnitOfMeasure.LITER });

      await expect(
        items.update({
          userId: OPERATOR,
          itemId: old.id,
          name: { es: 'Leche de antes', en: 'Milk from before' },
        })
      ).resolves.toMatchObject({ defaultUnit: UnitOfMeasure.LITER });
    });

    it('accepts every size the harvester creates with, because it converts with toBaseUnit first', async () => {
      // `sourceEntry.createItem` and the bulk decisions send
      // `toBaseUnit(size, unit)` for a row with no override, and a null
      // `KILOGRAM` for a row sold by weight (plan 0183). Every unit the row
      // can state, sized and unsized, is created here as it would be sent.
      const sent = Object.values(UnitOfMeasure).flatMap((unit) =>
        [null, 0.25, 33, 4].map((size) => toBaseUnit(size, unit))
      );
      sent.push({ unitSize: null, unit: UnitOfMeasure.KILOGRAM });

      const { items: created } = await items.createMany({
        userId: OPERATOR,
        items: sent.map((size, index) => ({
          name: { es: `Fila ${index}`, en: `Row ${index}` },
          unitSize: size.unitSize,
          defaultUnit: size.unit,
          categoryIds: [categoryId('eggs')],
        })),
      });

      expect(created).toHaveLength(sent.length);
      expect(created.map((item) => item.defaultUnit).sort()).not.toContain(
        UnitOfMeasure.LITER
      );
    });
  });

  describe('3.4: category slugs on the item routes', () => {
    async function caught(work: Promise<unknown>): Promise<unknown> {
      return work.then(
        () => {
          throw new Error('expected the write to be refused');
        },
        (error: unknown) => error
      );
    }

    async function heldBy(itemId: string) {
      return dataSource.query(
        `SELECT "categoryId", "position" FROM "item_categories"
          WHERE "itemId" = $1 ORDER BY "position"`,
        [itemId]
      );
    }

    it('writes the same rows by slug as by id, on a create and on an edit', async () => {
      const byId = await items.create({
        userId: OPERATOR,
        name: { es: 'Batidora', en: 'Blender' },
        defaultUnit: UnitOfMeasure.UNIT,
        categoryIds: [categoryId('small-appliances'), categoryId('milk')],
      });
      const bySlug = await items.create({
        userId: OPERATOR,
        name: { es: 'Batidora dos', en: 'Blender two' },
        defaultUnit: UnitOfMeasure.UNIT,
        categorySlugs: ['small-appliances', 'milk'],
      });

      expect(bySlug.categories.map((category) => category.slug)).toEqual([
        'small-appliances',
        'milk',
      ]);
      const slugRows = await heldBy(bySlug.id);
      expect(slugRows).toEqual(await heldBy(byId.id));

      const { items: edited } = await items.updateMany({
        userId: OPERATOR,
        items: [{ itemId: byId.id, categorySlugs: ['small-appliances'] }],
      });
      expect(edited[0].categories.map((category) => category.id)).toEqual([
        categoryId('small-appliances'),
      ]);
      expect(await heldBy(byId.id)).toEqual([
        { categoryId: categoryId('small-appliances'), position: 0 },
      ]);
    });

    it('refuses both lists at once with validation_failed', async () => {
      const product = await newProduct();

      const error = await caught(
        items.updateMany({
          userId: OPERATOR,
          items: [
            {
              itemId: product.id,
              categoryIds: [categoryId('milk')],
              categorySlugs: ['milk'],
            },
          ],
        })
      );

      expect(error).toBeInstanceOf(ValidationException);
      expect((error as ValidationException).code).toBe('validation_failed');
    });

    it('refuses a root slug with category_not_a_leaf, and an unknown slug with category_not_found naming it', async () => {
      const product = await newProduct();

      const root = await caught(
        items.update({
          userId: OPERATOR,
          itemId: product.id,
          categorySlugs: ['eggs-milk-and-butter'],
        })
      );
      const unknown = await caught(
        items.createMany({
          userId: OPERATOR,
          items: [
            {
              name: { es: 'Nada', en: 'Nothing' },
              defaultUnit: UnitOfMeasure.UNIT,
              categorySlugs: ['milk', 'no-such-aisle'],
            },
          ],
        })
      );

      expect(root).toBeInstanceOf(CategoryNotALeafException);
      expect((root as CategoryNotALeafException).details).toEqual({
        [CATEGORY_DETAIL]: categoryId('eggs-milk-and-butter'),
      });
      expect(unknown).toBeInstanceOf(CategoryNotFoundException);
      expect((unknown as CategoryNotFoundException).details).toEqual({
        [CATEGORY_UNKNOWN_DETAIL]: ['no-such-aisle'],
      });
    });
  });

  describe('3.5: a category change is audited', () => {
    /** The trail rows of one product's edits, oldest first. */
    function editsOf(itemId: string) {
      return trail.find({
        where: {
          entity: 'items',
          entityId: itemId,
          action: AuditAction.UPDATE,
        },
        order: { at: 'ASC', id: 'ASC' },
      });
    }

    it('records a create with its categories as slugs, in order', async () => {
      const product = await newProduct();

      const [created] = await trail.find({
        where: { entityId: product.id, action: AuditAction.CREATE },
      });
      expect(created.after).toMatchObject({ categories: ['milk', 'eggs'] });
    });

    it('leaves one row with both slug lists for a category edit', async () => {
      const product = await newProduct();

      await items.updateMany({
        userId: OPERATOR,
        items: [{ itemId: product.id, categorySlugs: ['small-appliances'] }],
      });

      const history = await editsOf(product.id);
      expect(history).toHaveLength(1);
      expect(history[0].before).toEqual({ categories: ['milk', 'eggs'] });
      expect(history[0].after).toEqual({ categories: ['small-appliances'] });
    });

    it('records the categories in the same row as the fields of the same edit', async () => {
      const product = await newProduct();

      await items.update({
        userId: OPERATOR,
        itemId: product.id,
        packCount: 6,
        categoryIds: [categoryId('eggs')],
      });

      const history = await editsOf(product.id);
      expect(history).toHaveLength(1);
      expect(history[0].before).toEqual({
        packCount: null,
        categories: ['milk', 'eggs'],
      });
      expect(history[0].after).toEqual({ packCount: 6, categories: ['eggs'] });
    });

    it('leaves no row for the set the product holds, in the same order, and one for another order', async () => {
      const product = await newProduct();

      await items.updateMany({
        userId: OPERATOR,
        items: [{ itemId: product.id, categorySlugs: ['milk', 'eggs'] }],
      });
      expect(await editsOf(product.id)).toHaveLength(0);

      await items.updateMany({
        userId: OPERATOR,
        items: [{ itemId: product.id, categorySlugs: ['eggs', 'milk'] }],
      });
      const history = await editsOf(product.id);
      expect(history).toHaveLength(1);
      expect(history[0].after).toEqual({ categories: ['eggs', 'milk'] });
    });
  });

  describe('3.6: a batch that refuses a brand the registry lacks', () => {
    let pierrotId: string;

    beforeAll(async () => {
      const pierrot = await brands.findOneOrFail({ where: { key: 'pierrot' } });
      pierrotId = pierrot.id;
      // A spelling of Pierrot (plan 0124): its own key, linked to the brand.
      await brands.save(
        brands.create({
          key: brandKey('Pierrot Piwy') as string,
          label: 'Pierrot Piwy',
          privateLabelSupermarketId: null,
          canonicalBrandId: pierrot.id,
        })
      );
    });

    async function brandOf(itemId: string) {
      return dataSource
        .getRepository(Item)
        .findOneOrFail({ where: { id: itemId } });
    }

    it('refuses the whole batch for a label the registry lacks, naming it, and writes nothing', async () => {
      const first = await newProduct('Uno');
      const second = await newProduct('Dos');

      const error = await items
        .updateMany({
          userId: OPERATOR,
          requireRegisteredBrands: true,
          items: [
            { itemId: first.id, brand: 'PIERROT' },
            { itemId: second.id, brand: ' Marca Nueva ' },
          ],
        })
        .then(
          () => null,
          (caught: unknown) => caught
        );

      expect(error).toBeInstanceOf(BrandUnregisteredException);
      expect((error as BrandUnregisteredException).details).toEqual({
        [BRAND_LABELS_DETAIL]: ['Marca Nueva'],
      });
      expect((await brandOf(second.id)).brand).toBe('Pierrot');
    });

    it('writes the same label with no brand id when the batch does not ask, as before', async () => {
      const product = await newProduct();

      await items.updateMany({
        userId: OPERATOR,
        items: [{ itemId: product.id, brand: 'Marca Nueva' }],
      });

      expect(await brandOf(product.id)).toMatchObject({
        brand: 'Marca Nueva',
        brandId: null,
      });
    });

    it('lets a spelling through and stores the label of the brand it spells, and lets a null brand through', async () => {
      const spelled = await newProduct('Escrita');
      const plain = await newProduct('Sin marca');

      await items.updateMany({
        userId: OPERATOR,
        requireRegisteredBrands: true,
        items: [
          { itemId: spelled.id, brand: 'PIERROT PIWY' },
          { itemId: plain.id, brand: null },
        ],
      });

      expect(await brandOf(spelled.id)).toMatchObject({
        brand: 'Pierrot',
        brandId: pierrotId,
        brandKey: brandKey('Pierrot Piwy'),
      });
      expect(await brandOf(plain.id)).toMatchObject({
        brand: null,
        brandId: null,
      });
    });

    it('refuses a create batch the same way', async () => {
      const error = await items
        .createMany({
          userId: OPERATOR,
          requireRegisteredBrands: true,
          items: [
            {
              name: { es: 'Nueva', en: 'New' },
              brand: 'Otra Marca',
              defaultUnit: UnitOfMeasure.UNIT,
              categorySlugs: ['eggs'],
            },
          ],
        })
        .then(
          () => null,
          (caught: unknown) => caught
        );

      expect(error).toBeInstanceOf(BrandUnregisteredException);
      expect((error as BrandUnregisteredException).details).toEqual({
        [BRAND_LABELS_DETAIL]: ['Otra Marca'],
      });
    });
  });
});
