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
import { DataSource, Repository } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  AuditAction,
  AuditActorKind,
  CATALOG_ENTITIES,
  CatalogAudit,
  Item,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { ItemService } from './item.service';
import { PlatformAdminService } from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';
import { SupermarketItemService } from './supermarket-item.service';

/**
 * The audit trail against real Postgres (plan 0075, section 7).
 *
 * **A double cannot check any of this.** Every claim the plan makes is a claim
 * about a transaction: that the row and its trail commit together, that a
 * rollback takes both, and that a write which moved no field wrote nothing. A
 * fake repository would let a separately written trail pass while it was exactly
 * the thing the plan forbids.
 *
 * It works in a scratch schema of its own and drops it afterwards, so it never
 * touches the developer's own catalog data.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration
 */
const SCHEMA = 'plan0075_audit_test';

/**
 * Two configured service actors and one operator.
 *
 * They are both uuids on the wire, which is the whole reason `actorKind` is a
 * stored column: the value alone cannot say which of the two it is.
 */
const HARVESTER = '11111111-1111-4111-8111-111111111111';
const OPERATOR = '22222222-2222-4222-8222-222222222222';

describeIntegration('the catalog audit trail (real Postgres)', () => {
  let dataSource: DataSource;
  let audit: CatalogAuditService;
  let trail: Repository<CatalogAudit>;
  let items: ItemService;
  let groups: ProductGroupService;
  let scopes: PriceScopeService;
  let prices: SupermarketItemService;

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
      // The migrations are raw SQL naming unqualified tables, so the scratch
      // schema has to be on the connection's search_path. `public` follows it
      // for the extensions they use.
      extra: { options: `-c search_path=${SCHEMA},public` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    // Both actors go through the service branch of the gate, which needs no
    // keypair. Which door a caller came through is plan 0072's subject; this
    // file is about what the trail records once they are through, and one of
    // the two is re-verified as an operator in its own test below.
    const admin = new PlatformAdminService(new JwtService(), {
      getOrThrow: () => ({
        adminJwtPublicKey: '',
        serviceActorIds: [HARVESTER, OPERATOR],
      }),
    } as never);
    const events = {
      itemGroupChanged: jest.fn(),
      productGroupDeleted: jest.fn(),
    } as unknown as CatalogEventsPublisher;

    audit = new CatalogAuditService(dataSource);
    trail = dataSource.getRepository(CatalogAudit);
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
    scopes = new PriceScopeService(
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(Supermarket),
      admin,
      audit
    );
    prices = new SupermarketItemService(
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Item),
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(SupermarketLocation),
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

  beforeEach(async () => {
    await trail.clear();
  });

  /** The trail rows for one entity row, oldest first. */
  function historyOf(entity: string, entityId: string) {
    return trail.find({ where: { entity, entityId }, order: { at: 'ASC' } });
  }

  async function newItem(actorId = OPERATOR) {
    return items.create({
      userId: actorId,
      name: { en: 'Semi Skimmed 1L', es: 'Semidesnatada 1L' },
      brand: 'Pascual',
      category: ItemCategory.DAIRY,
      defaultUnit: UnitOfMeasure.LITER,
    });
  }

  it('records a create with the whole row and no before', async () => {
    const item = await newItem();

    const history = await historyOf('items', item.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actorId: OPERATOR,
      actorKind: AuditActorKind.SERVICE,
      entity: 'items',
      entityId: item.id,
      action: AuditAction.CREATE,
      before: null,
    });
    expect(history[0].after).toMatchObject({
      brand: 'Pascual',
      category: ItemCategory.DAIRY,
    });
    // The id is the `entityId` column, so repeating it inside the diff would be
    // the same fact twice on the smallest row the table ever holds.
    expect(history[0].after).not.toHaveProperty('id');
    expect(history[0].after).not.toHaveProperty('updatedAt');
  });

  it('records an update as the moved fields alone', async () => {
    const item = await newItem();
    await trail.clear();

    await items.update({
      userId: OPERATOR,
      itemId: item.id,
      brand: 'Hacendado',
    });

    const history = await historyOf('items', item.id);
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe(AuditAction.UPDATE);
    // Exactly the field that moved. `name`, `category` and `defaultUnit` were
    // all sent to the database by the same save and none of them changed.
    expect(history[0].before).toEqual({ brand: 'Pascual' });
    expect(history[0].after).toEqual({ brand: 'Hacendado' });
  });

  it('writes no row for an update that changes nothing', async () => {
    const item = await newItem();
    await trail.clear();

    // A well formed request that assigns the value already stored. Section 4's
    // first mitigation, and the one that keeps a harvest run from growing the
    // trail by a catalog.
    await items.update({ userId: OPERATOR, itemId: item.id, brand: 'Pascual' });

    expect(await historyOf('items', item.id)).toHaveLength(0);
  });

  it('records a delete with what was lost and no after', async () => {
    const item = await newItem();
    await trail.clear();

    await items.delete({ userId: OPERATOR, itemId: item.id });

    const history = await historyOf('items', item.id);
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe(AuditAction.DELETE);
    expect(history[0].after).toBeNull();
    // A trail saying only that something with this id used to exist cannot
    // answer what was deleted, which is the question a deletion raises.
    expect(history[0].before).toMatchObject({ brand: 'Pascual' });
  });

  it('writes no row when the change it describes rolled back', async () => {
    const item = await newItem();
    await trail.clear();

    const boom = new Error('the write failed after the trail was written');
    await expect(
      audit.write({ kind: 'admin', actorId: OPERATOR }, async (tx) => {
        const row = await tx.manager.findOneOrFail(Item, {
          where: { id: item.id },
        });
        const before = { ...row };
        row.brand = 'Hacendado';
        await tx.update(Item, before, row);
        throw boom;
      })
    ).rejects.toBe(boom);

    // Both halves are gone. A trail that is sometimes wrong is worse than none,
    // because it gets trusted.
    expect(await historyOf('items', item.id)).toHaveLength(0);
    const stored = await dataSource
      .getRepository(Item)
      .findOneByOrFail({ id: item.id });
    expect(stored.brand).toBe('Pascual');
  });

  it('records an operator as ADMIN and a machine as SERVICE', async () => {
    const item = await newItem();
    await trail.clear();

    await audit.write({ kind: 'admin', actorId: OPERATOR }, async (tx) => {
      const row = await tx.manager.findOneOrFail(Item, {
        where: { id: item.id },
      });
      const before = { ...row };
      row.brand = 'Hacendado';
      await tx.update(Item, before, row);
    });

    const history = await historyOf('items', item.id);
    // The id is the same uuid either way, which is exactly why the kind is a
    // column: it is what a retention job reads to prune a machine's rows and
    // keep a person's (plan 0075, section 4).
    expect(history[0].actorKind).toBe(AuditActorKind.ADMIN);
    expect(history[0].actorId).toBe(OPERATOR);
  });

  it('names the table the changed row lives in', async () => {
    const group = await groups.create({
      userId: OPERATOR,
      name: { en: 'Milk', es: 'Leche' },
      slug: `milk-${Date.now()}`,
      referenceUnit: UnitOfMeasure.LITER,
      synonyms: { en: ['milk'], es: ['leche'] },
    });

    const history = await historyOf('product_groups', group.id);
    expect(history).toHaveLength(1);
  });

  describe('a harvest run is the harvester’s, whoever started it', () => {
    let itemId: string;
    let scopeId: string;

    beforeEach(async () => {
      const supermarkets = dataSource.getRepository(Supermarket);
      const chain = await supermarkets.save(
        supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
      );
      const scope = await scopes.create({
        userId: OPERATOR,
        supermarketId: chain.id,
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
      });
      scopeId = scope.id;
      itemId = (await newItem()).id;
      await trail.clear();
    });

    it('attributes a batch price write to the service, not to the operator', async () => {
      // The operator pressed "start run" and the harvester is what wrote the
      // prices. Collapsing the two would make the trail claim a person typed
      // them, which is the wrong answer to the question the trail answers.
      await prices.upsertBatch({
        userId: HARVESTER,
        priceScopeId: scopeId,
        priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
        entries: [{ itemId, price: 1.75, currency: 'EUR' }],
      });

      const history = await trail.find({
        where: { entity: 'supermarket_items' },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        actorId: HARVESTER,
        actorKind: AuditActorKind.SERVICE,
        action: AuditAction.CREATE,
      });
    });

    it('writes nothing for a re-fetch that found the same price', async () => {
      await prices.upsertBatch({
        userId: HARVESTER,
        priceScopeId: scopeId,
        priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
        entries: [{ itemId, price: 1.75, currency: 'EUR' }],
      });
      await trail.clear();

      const result = await prices.upsertBatch({
        userId: HARVESTER,
        priceScopeId: scopeId,
        priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
        entries: [{ itemId, price: 1.75, currency: 'EUR' }],
      });

      // The row was still saved, because an unchanged price with a stale
      // observation time reads as an unrefreshed one. What did not happen is a
      // history entry: a price that did not change is not history.
      expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
      expect(
        await trail.find({ where: { entity: 'supermarket_items' } })
      ).toEqual([]);
    });

    it('records the price that did move, and only the price', async () => {
      await prices.upsertBatch({
        userId: HARVESTER,
        priceScopeId: scopeId,
        priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
        entries: [{ itemId, price: 1.75, currency: 'EUR' }],
      });
      await trail.clear();

      await prices.upsertBatch({
        userId: HARVESTER,
        priceScopeId: scopeId,
        priceSourceKind: PriceSourceKind.OFFICIAL_WEB,
        entries: [{ itemId, price: 1.89, currency: 'EUR' }],
      });

      const history = await trail.find({
        where: { entity: 'supermarket_items' },
      });
      expect(history).toHaveLength(1);
      expect(history[0].action).toBe(AuditAction.UPDATE);
      expect(history[0].before).toEqual({ price: 1.75 });
      expect(history[0].after).toEqual({ price: 1.89 });
    });
  });
});
