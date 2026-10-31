import { JwtService } from '@nestjs/jwt';
import {
  UnitOfMeasure,
  type ItemExpectationFailure,
} from '@portfolio/luna-shopper/contracts';
import {
  ITEM_EXPECTATION_FAILURES_DETAIL,
  ItemExpectationFailedException,
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
});
