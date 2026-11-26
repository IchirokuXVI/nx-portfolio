import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type CreateItemRequest,
} from '@portfolio/luna-shopper/contracts';
import { ItemPieceCountNotAllowedException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { ItemPieceCount1759600000000 } from '../db/migrations/1759600000000-ItemPieceCount';
import { categoryId } from '../db/taxonomy/ids';
import {
  AuditAction,
  Brand,
  CATALOG_ENTITIES,
  CatalogAudit,
  Category,
  Item,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { recomputeComparablePrices } from './comparable-price.sql';
import { EffectivePriceService } from './effective-price.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';

/**
 * The piece count of a product against real Postgres (plan 0278).
 *
 * What only the database can say: the migration up and down, the two checks
 * refusing a raw write that breaks the rules, the write rule answering
 * before them, the view and the audit row of a change, and the comparable
 * price standing still when only the piece count moves.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 7 --services catalog
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-piece-count.integration.spec.ts
 */
const SCHEMA = 'plan0278_piece_count_test';

const HARVESTER = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '27827827-2782-4782-8782-278278278278';
const OBSERVED = new Date('2026-11-01T10:00:00.000Z');

describeIntegration('the piece count of a product (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;
  let scopeId: string;

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

    const gate = new PlatformAdminService(new JwtService({}), {
      getOrThrow: () => ({
        authJwtPublicKey: '',
        adminJwtPublicKey: '',
        serviceActorIds: [HARVESTER, OPERATOR],
      }),
    } as unknown as ConfigService);
    const events = {
      itemGroupChanged: () => undefined,
      productGroupDeleted: () => undefined,
      itemMerged: () => undefined,
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
    items = new ItemService(
      dataSource.getRepository(Item),
      dataSource.getRepository(ProductGroup),
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Brand),
      new ProductGroupService(
        dataSource.getRepository(ProductGroup),
        gate,
        audit,
        events
      ),
      gate,
      audit,
      events,
      new CategoryService(dataSource.getRepository(Category), gate, audit),
      itemEanStoreOf(dataSource)
    );
    const scopes = new PriceScopeService(
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(Supermarket),
      gate,
      audit,
      new EffectivePriceService()
    );
    const supermarkets = dataSource.getRepository(Supermarket);
    const chain = await supermarkets.save(
      supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
    );
    scopeId = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: chain.id,
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await dataSource.destroy();
    }
  });

  /** A bag of 35 g of candies, unless told otherwise. */
  function product(extra: Partial<Omit<CreateItemRequest, 'userId'>> = {}) {
    return items.create({
      userId: OPERATOR,
      name: { es: 'Caramelos de fresa' },
      categoryIds: [categoryId('milk')],
      defaultUnit: UnitOfMeasure.GRAM,
      unitSize: 35,
      ...extra,
    });
  }

  const row = (id: string) =>
    dataSource.getRepository(Item).findOneByOrFail({ id });

  async function refused(work: Promise<unknown>) {
    const error = await work.then(
      () => {
        throw new Error('expected the call to be refused');
      },
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ItemPieceCountNotAllowedException);
    return error as ItemPieceCountNotAllowedException;
  }

  /** A raw write of the piece count, which only the checks guard. */
  const rawPieces = (id: string, set: string) =>
    dataSource.query(`UPDATE "items" SET ${set} WHERE "id" = $1`, [id]);

  describe('the migration (section 2)', () => {
    async function columns(): Promise<string[]> {
      const found = (await dataSource.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'items'
            AND column_name = 'pieceCount'`,
        [SCHEMA]
      )) as { column_name: string }[];
      return found.map((r) => r.column_name);
    }

    async function checks(): Promise<string[]> {
      const found = (await dataSource.query(
        `SELECT c.conname FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = $1 AND c.conname LIKE 'item_piece_count_%'
          ORDER BY c.conname`,
        [SCHEMA]
      )) as { conname: string }[];
      return found.map((r) => r.conname);
    }

    it('adds the column null on every existing row, and down removes it and its checks', async () => {
      const before = await product({ name: { es: 'Anterior' } });
      expect(await columns()).toEqual(['pieceCount']);
      expect(await checks()).toEqual([
        'item_piece_count_bounds',
        'item_piece_count_on_sized',
      ]);
      expect((await row(before.id)).pieceCount).toBeNull();

      // Down to this migration, whatever lands after it.
      const name = new ItemPieceCount1759600000000().name;
      for (;;) {
        const ran = (await dataSource.query(
          `SELECT name FROM "${SCHEMA}".migrations ORDER BY id DESC LIMIT 1`
        )) as { name: string }[];
        if (ran.length === 0) {
          throw new Error(
            `the migrations table of ${SCHEMA} is empty and never held ${name}`
          );
        }
        await dataSource.undoLastMigration();
        if (ran[0].name === name) {
          break;
        }
      }
      expect(await columns()).toEqual([]);
      expect(await checks()).toEqual([]);
      // The rows the migration found are still there, untouched.
      const [kept] = (await dataSource.query(
        `SELECT "unitSize", "defaultUnit" FROM "items" WHERE "id" = $1`,
        [before.id]
      )) as { unitSize: string; defaultUnit: string }[];
      expect({ ...kept, unitSize: Number(kept.unitSize) }).toEqual({
        unitSize: 35,
        defaultUnit: 'GRAM',
      });

      await dataSource.runMigrations();
      expect(await columns()).toEqual(['pieceCount']);
      expect((await row(before.id)).pieceCount).toBeNull();
    });

    it('refuses a count off its bounds in raw SQL (item_piece_count_bounds)', async () => {
      const bag = await product();
      for (const count of [1, 0, 10001]) {
        await expect(
          rawPieces(bag.id, `"pieceCount" = ${count}`)
        ).rejects.toThrow(/item_piece_count_bounds/);
      }
      await rawPieces(bag.id, `"pieceCount" = 2`);
      await rawPieces(bag.id, `"pieceCount" = 10000`);
      expect((await row(bag.id)).pieceCount).toBe(10000);
    });

    it('refuses a count without a size, beside a weight, on another unit or not above the pack in raw SQL (item_piece_count_on_sized)', async () => {
      const kilo = await product({
        name: { es: 'Caramelos a granel' },
        defaultUnit: UnitOfMeasure.KILOGRAM,
        unitSize: null,
      });
      await expect(rawPieces(kilo.id, `"pieceCount" = 50`)).rejects.toThrow(
        /item_piece_count_on_sized/
      );
      const piece = await product({
        name: { es: 'Bolsa variable' },
        defaultUnit: UnitOfMeasure.UNIT,
        unitSize: null,
        approxWeight: 120,
      });
      await expect(rawPieces(piece.id, `"pieceCount" = 7`)).rejects.toThrow(
        /item_piece_count_on_sized/
      );
      const eggs = await product({
        name: { es: 'Huevos' },
        defaultUnit: UnitOfMeasure.UNIT,
        unitSize: 12,
      });
      await expect(rawPieces(eggs.id, `"pieceCount" = 50`)).rejects.toThrow(
        /item_piece_count_on_sized/
      );
      const burgers = await product({
        name: { es: 'Hamburguesas' },
        unitSize: 360,
        packCount: 4,
      });
      await expect(rawPieces(burgers.id, `"pieceCount" = 4`)).rejects.toThrow(
        /item_piece_count_on_sized/
      );
      await expect(rawPieces(burgers.id, `"pieceCount" = 3`)).rejects.toThrow(
        /item_piece_count_on_sized/
      );
      // A product with pieces whose size a raw write clears.
      const bag = await product({ pieceCount: 50 });
      await expect(rawPieces(bag.id, `"unitSize" = NULL`)).rejects.toThrow(
        /item_piece_count_on_sized/
      );
      // And the two rows of section 1 that hold pieces pass.
      await rawPieces(burgers.id, `"pieceCount" = 5`);
      const ml = await product({
        name: { es: 'Perlas' },
        defaultUnit: UnitOfMeasure.MILLILITER,
        unitSize: 250,
      });
      await rawPieces(ml.id, `"pieceCount" = 20`);
      expect((await row(ml.id)).pieceCount).toBe(20);
    });
  });

  describe('the write rule (sections 2 and 3)', () => {
    it('saves a count and serves it on every read', async () => {
      const smint = await product({
        name: { es: 'Caramelos de menta, dos bolsas' },
        unitSize: 70,
        packCount: 2,
        pieceCount: 100,
      });
      expect(smint.pieceCount).toBe(100);
      expect((await row(smint.id)).pieceCount).toBe(100);
      expect(
        (await items.get({ userId: OPERATOR, itemId: smint.id })).pieceCount
      ).toBe(100);
      const [many] = (await items.getMany({ ids: [smint.id] })).items;
      expect(many.pieceCount).toBe(100);
      // A product nobody counted answers null, never absent.
      const plain = await product({ name: { es: 'Sin contar' } });
      expect(plain.pieceCount).toBeNull();
    });

    it('refuses a count on a product sold by the kilo before the database does, with its details', async () => {
      const error = await refused(
        product({
          name: { es: 'Caramelos a granel' },
          defaultUnit: UnitOfMeasure.KILOGRAM,
          unitSize: null,
          pieceCount: 50,
        })
      );
      expect(error.details).toEqual({
        pieceCount: 50,
        packCount: null,
        unitSize: null,
        defaultUnit: UnitOfMeasure.KILOGRAM,
      });
    });

    it('refuses an edit that raises the pack count to the piece count, and saves it with a null count', async () => {
      const smint = await product({
        unitSize: 70,
        packCount: 2,
        pieceCount: 100,
      });
      await refused(
        items.update({ userId: OPERATOR, itemId: smint.id, packCount: 100 })
      );
      expect((await row(smint.id)).packCount).toBe(2);

      const saved = await items.update({
        userId: OPERATOR,
        itemId: smint.id,
        packCount: 100,
        pieceCount: null,
      });
      expect(saved).toMatchObject({ packCount: 100, pieceCount: null });
    });

    it('refuses a cleared size on a product with pieces, which only the check would otherwise catch', async () => {
      const bag = await product({ pieceCount: 50 });
      await refused(
        items.update({
          userId: OPERATOR,
          itemId: bag.id,
          defaultUnit: UnitOfMeasure.KILOGRAM,
          unitSize: null,
        })
      );
      expect((await row(bag.id)).defaultUnit).toBe(UnitOfMeasure.GRAM);
    });

    it('audits a change of count with its before and after', async () => {
      const bag = await product();
      await items.update({ userId: OPERATOR, itemId: bag.id, pieceCount: 50 });
      await items.update({ userId: OPERATOR, itemId: bag.id, pieceCount: 48 });
      const trail = await dataSource.getRepository(CatalogAudit).find({
        where: { entityId: bag.id, action: AuditAction.UPDATE },
        order: { at: 'ASC' },
      });
      expect(trail.map((entry) => [entry.before, entry.after])).toEqual([
        [{ pieceCount: null }, { pieceCount: 50 }],
        [{ pieceCount: 50 }, { pieceCount: 48 }],
      ]);
    });

    it('guards an edit with the count it expects', async () => {
      const bag = await product({ pieceCount: 50 });
      await expect(
        items.update({
          userId: OPERATOR,
          itemId: bag.id,
          pieceCount: 60,
          expect: { pieceCount: null },
        })
      ).rejects.toMatchObject({ code: 'item_expectation_failed' });
      expect((await row(bag.id)).pieceCount).toBe(50);
      await expect(
        items.updateMany({
          userId: OPERATOR,
          items: [
            {
              itemId: bag.id,
              pieceCount: 60,
              expect: { unitSize: 35, packCount: null, pieceCount: 50 },
            },
          ],
        })
      ).resolves.toMatchObject({ items: [{ pieceCount: 60 }] });
    });
  });

  describe('the comparable price (section 3, constraints)', () => {
    it('does not move when only the piece count does', async () => {
      const bag = await product({ name: { es: 'Caramelos con precio' } });
      const repository = dataSource.getRepository(SupermarketItem);
      await repository.save(
        repository.create({
          itemId: bag.id,
          priceScopeId: scopeId,
          price: 1.4,
          currency: 'EUR',
          unitPrice: null,
          unitPriceLabel: null,
          priceObservedAt: OBSERVED,
          priceSourceKind: PriceSourceKind.OFFICIAL_API,
          available: true,
        })
      );
      await recomputeComparablePrices(dataSource.manager, [bag.id]);
      const pair = async () => {
        const [found] = (await dataSource.query(
          `SELECT "comparablePrice", "comparableBasis", xmin::text AS "xmin"
             FROM "supermarket_items" WHERE "itemId" = $1`,
          [bag.id]
        )) as {
          comparablePrice: string;
          comparableBasis: string;
          xmin: string;
        }[];
        return found;
      };
      const before = await pair();
      expect(Number(before.comparablePrice)).toBe(40);
      expect(before.comparableBasis).toBe('KILOGRAM');

      await items.update({ userId: OPERATOR, itemId: bag.id, pieceCount: 50 });

      const after = await pair();
      expect(after).toEqual(before);
    });
  });
});
