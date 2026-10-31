import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type AdminCredential,
  type ItemView,
  type MergeItemResult,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ITEM_IN_USE_LINES_DETAIL,
  ITEM_IN_USE_MERGED_DETAIL,
  ITEM_IN_USE_PRICES_DETAIL,
  ITEM_IN_USE_QUEUE_DETAIL,
  ITEM_MERGE_CHAINS_DETAIL,
  ITEM_MERGED_INTO_DETAIL,
  ItemInUseException,
  ItemMergedException,
  ItemMergeFormatDiffersException,
  ItemMergeTwoArticlesOneChainException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import { categoryId } from '../db/taxonomy/ids';
import {
  AuditAction,
  Brand,
  CATALOG_ENTITIES,
  CatalogAudit,
  Category,
  Item,
  ItemPrice,
  PriceScope,
  ProductGroup,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationItem,
} from '../entities';
import { CatalogEventsPublisher } from '../events/catalog-events.publisher';
import { CatalogAuditService } from './catalog-audit.service';
import { CategoryService } from './category.service';
import { EffectivePriceService } from './effective-price.service';
import { itemEanStoreOf } from './item-ean.store';
import { ItemPriceService } from './item-price.service';
import type { ItemReferences, QueueUsage } from './item-references.client';
import { ItemService } from './item.service';
import { LocationScopeService } from './location-scopes';
import {
  PlatformAdminService,
  type CatalogActor,
} from './platform-admin.service';
import { PriceScopeService } from './price-scope.service';
import { ProductGroupService } from './product-group.service';
import { SupermarketItemService } from './supermarket-item.service';
import { SupermarketLocationItemService } from './supermarket-location-item.service';

/**
 * A product merge against real Postgres (plan 0239).
 *
 * Every claim here is about one transaction over several tables: that the
 * prices moved and the survivor's shown price was worked out again, that the
 * merged row stayed and names its survivor, that every read leaves it out or
 * answers its survivor, that a dry run writes nothing, and that a delete
 * refuses what something still names. A double could only agree with itself.
 *
 * The harvester and core are a fake {@link ItemReferences}: what they hold is
 * theirs, and their own integration specs prove their halves.
 *
 * It works in a scratch schema of its own and drops it afterwards.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up 4 --services catalog
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-merge.integration.spec.ts
 */
const SCHEMA = 'plan0239_item_merge_test';

/** The operator, verified as an admin by the fake gate below. */
const OPERATOR = '39239239-2392-4392-8392-239239239239';
/** The harvester, a service actor of the real gate, for the prices. */
const HARVESTER = '11111111-1111-4111-8111-111111111111';
const RUN = '33333333-3333-4333-8333-333333333333';
const CHAIN_X = '0a0a0a0a-0000-4000-8000-000000000001';

const AS_OPERATOR: AdminCredential = {
  userId: OPERATOR,
  adminToken: 'a token the fake gate does not read',
};

/** What the fake harvester and core answer, set per test. */
class FakeReferences implements ItemReferences {
  queue = new Map<string, QueueUsage>();
  lines = new Map<string, number>();
  asked: { what: 'queue' | 'lines'; itemIds: string[] }[] = [];

  async queueUsage(
    _credential: AdminCredential,
    itemIds: readonly string[]
  ): Promise<Map<string, QueueUsage>> {
    this.asked.push({ what: 'queue', itemIds: [...itemIds] });
    return new Map(
      itemIds.map((id) => [
        id,
        this.queue.get(id) ?? { rowCount: 0, activeSupermarketIds: [] },
      ])
    );
  }

  async lineUsage(
    _credential: AdminCredential,
    itemIds: readonly string[]
  ): Promise<Map<string, number>> {
    this.asked.push({ what: 'lines', itemIds: [...itemIds] });
    return new Map(itemIds.map((id) => [id, this.lines.get(id) ?? 0]));
  }
}

describeIntegration('a product merge (real Postgres)', () => {
  let dataSource: DataSource;
  let items: ItemService;
  /** The same service behind a gate that answers a service actor. */
  let itemsAsService: ItemService;
  let prices: ItemPriceService;
  let scopes: PriceScopeService;
  let shopItems: SupermarketLocationItemService;
  let scopeItems: SupermarketItemService;
  let references: FakeReferences;
  let merged: { itemId: string; intoItemId: string }[];

  let chainId: string;
  let nationalId: string;
  let warehouseId: string;
  /** The national scope of a second chain, which no scope of the first reaches. */
  let otherNationalId: string;

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

    const realGate = new PlatformAdminService(new JwtService({}), {
      getOrThrow: () => ({
        authJwtPublicKey: '',
        adminJwtPublicKey: '',
        serviceActorIds: [HARVESTER, OPERATOR],
      }),
    } as unknown as ConfigService);
    const gateAs = (kind: CatalogActor['kind']) =>
      ({
        requireAdmin: async (): Promise<CatalogActor> => ({
          kind,
          actorId: OPERATOR,
        }),
      }) as unknown as PlatformAdminService;
    merged = [];
    const events = {
      itemGroupChanged: () => undefined,
      productGroupDeleted: () => undefined,
      itemMerged: (itemId: string, intoItemId: string) =>
        merged.push({ itemId, intoItemId }),
    } as unknown as CatalogEventsPublisher;
    const audit = new CatalogAuditService(dataSource);
    references = new FakeReferences();
    const build = (gate: PlatformAdminService) =>
      new ItemService(
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
        itemEanStoreOf(dataSource),
        references
      );
    items = build(gateAs('admin'));
    itemsAsService = build(gateAs('service'));
    const effective = new EffectivePriceService();
    prices = new ItemPriceService(
      dataSource.getRepository(ItemPrice),
      dataSource.getRepository(Item),
      dataSource.getRepository(PriceScope),
      realGate,
      audit,
      effective
    );
    scopes = new PriceScopeService(
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(Supermarket),
      realGate,
      audit,
      effective
    );
    shopItems = new SupermarketLocationItemService(
      dataSource.getRepository(SupermarketLocationItem),
      dataSource.getRepository(Item),
      dataSource.getRepository(SupermarketLocation),
      realGate,
      audit,
      new LocationScopeService()
    );
    scopeItems = new SupermarketItemService(
      dataSource.getRepository(SupermarketItem),
      dataSource.getRepository(Item),
      dataSource.getRepository(PriceScope),
      dataSource.getRepository(SupermarketLocation),
      realGate,
      audit,
      new LocationScopeService()
    );

    const supermarkets = dataSource.getRepository(Supermarket);
    chainId = (
      await supermarkets.save(
        supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
      )
    ).id;
    nationalId = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: chainId,
        kind: PriceScopeKind.NATIONAL,
        externalKey: null,
      })
    ).id;
    warehouseId = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: chainId,
        kind: PriceScopeKind.REGION,
        externalKey: '4661',
      })
    ).id;
    const otherChain = await supermarkets.save(
      supermarkets.create({ name: { en: 'Other', es: 'Otra' } })
    );
    otherNationalId = (
      await scopes.create({
        userId: OPERATOR,
        supermarketId: otherChain.id,
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

  beforeEach(() => {
    references.queue.clear();
    references.lines.clear();
    references.asked = [];
    merged.length = 0;
  });

  /** A product of 1 litre, on the milk leaf, unless told otherwise. */
  async function product(
    es: string,
    extra: { ean?: string; unitSize?: number; defaultUnit?: UnitOfMeasure } = {}
  ): Promise<ItemView> {
    return items.create({
      userId: OPERATOR,
      name: { es, en: es },
      brand: 'Pascual',
      unitSize: extra.unitSize ?? 1000,
      defaultUnit: extra.defaultUnit ?? UnitOfMeasure.MILLILITER,
      ean: extra.ean,
      categoryIds: [categoryId('milk')],
    });
  }

  function price(
    itemId: string,
    amount: number,
    scopeId: string,
    sourceKind = PriceSourceKind.OFFICIAL_API
  ) {
    return prices.addBatch({
      userId: HARVESTER,
      priceScopeId: scopeId,
      sourceKind,
      sourceRunId: RUN,
      entries: [
        {
          itemId,
          price: amount,
          currency: 'EUR',
          observedAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    });
  }

  const priceRows = (itemId: string) =>
    dataSource.getRepository(ItemPrice).countBy({ itemId });
  const row = (id: string) =>
    dataSource.getRepository(Item).findOneByOrFail({ id });

  async function refused<T>(
    work: Promise<unknown>,
    type: new (...a: never[]) => T
  ) {
    const error = await work.then(
      () => {
        throw new Error('expected the call to be refused');
      },
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(type);
    return error as T & { details?: Record<string, unknown> };
  }

  describe('section 1: what a merge does', () => {
    it('moves the prices and the shop rows, keeps the merged row and names the survivor', async () => {
      const loser = await product('Leche entera fusion');
      const survivor = await product('Leche entera superviviente');
      // At scopes that do not reach each other, so the merged product's scope
      // row has nowhere to land but on the survivor.
      await price(loser.id, 0.99, warehouseId);
      await price(survivor.id, 1.05, otherNationalId);

      const shops = dataSource.getRepository(SupermarketLocation);
      const shared = await shops.save(shops.create({ supermarketId: chainId }));
      const own = await shops.save(shops.create({ supermarketId: chainId }));
      const shopRows = dataSource.getRepository(SupermarketLocationItem);
      await shopRows.save([
        shopRows.create({ itemId: loser.id, supermarketLocationId: shared.id }),
        shopRows.create({
          itemId: survivor.id,
          supermarketLocationId: shared.id,
        }),
        shopRows.create({ itemId: loser.id, supermarketLocationId: own.id }),
      ]);
      await dataSource.query(
        `INSERT INTO "item_linked_images" ("sourceEntryId", "itemId", "supermarketId", "url")
         VALUES (gen_random_uuid(), $1, $2, 'https://example.test/milk.jpg')`,
        [loser.id, chainId]
      );
      references.queue.set(loser.id, {
        rowCount: 2,
        activeSupermarketIds: [CHAIN_X],
      });

      const before =
        (await priceRows(loser.id)) + (await priceRows(survivor.id));
      const result = await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });

      expect(result).toMatchObject({
        itemId: loser.id,
        intoItemId: survivor.id,
        dryRun: false,
        mergedIntoId: survivor.id,
        prices: 1,
        scopeRows: 1,
        shopRows: 1,
        shopRowsKept: 1,
        linkedImages: 1,
        repointedItemIds: [],
        queueRows: 2,
      });
      expect(typeof result.mergedAt).toBe('string');
      // Every price row of both products is now the survivor's.
      expect(await priceRows(loser.id)).toBe(0);
      expect(await priceRows(survivor.id)).toBe(before);
      // The survivor shows a price at the warehouse it had none at.
      const shown = await dataSource
        .getRepository(SupermarketItem)
        .findOneBy({ itemId: survivor.id, priceScopeId: warehouseId });
      expect(Number(shown?.price)).toBe(0.99);
      // The merged row stays, with its own name, and names the survivor.
      const loserRow = await row(loser.id);
      expect(loserRow.mergedIntoId).toBe(survivor.id);
      expect(loserRow.mergedAt).toBeInstanceOf(Date);
      expect(loserRow.name.es).toBe('Leche entera fusion');
      // The shop row the survivor already had stays on the merged row.
      expect(await shopRows.countBy({ itemId: loser.id })).toBe(1);
      expect(await shopRows.countBy({ itemId: survivor.id })).toBe(2);
      // The photo link moved, and the survivor's list was worked out again.
      expect((await row(survivor.id)).linkedImages).toEqual([]);
      const [{ count: links }] = await dataSource.query(
        `SELECT count(*)::int AS "count" FROM "item_linked_images" WHERE "itemId" = $1`,
        [survivor.id]
      );
      expect(links).toBe(1);
      // One event, after the commit.
      expect(merged).toEqual([{ itemId: loser.id, intoItemId: survivor.id }]);
      // The harvester was asked about both products, before the write.
      expect(references.asked).toEqual([
        { what: 'queue', itemIds: [loser.id, survivor.id] },
      ]);
    });

    it('keeps the survivor its own scope row, and recomputes it from the moved price', async () => {
      const loser = await product('Leche fusion region');
      const survivor = await product('Leche queda nacional');
      // The national price reaches the warehouse, so the survivor already
      // shows a row there.
      await price(loser.id, 0.99, warehouseId);
      await price(survivor.id, 1.05, nationalId);

      const result = await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });

      expect(result).toMatchObject({ prices: 1, scopeRows: 0 });
      const rows = dataSource.getRepository(SupermarketItem);
      expect(await rows.countBy({ itemId: loser.id })).toBe(0);
      // The warehouse's own price beats the national one it fell through to.
      const shown = await rows.findOneBy({
        itemId: survivor.id,
        priceScopeId: warehouseId,
      });
      expect(Number(shown?.price)).toBe(0.99);
      const national = await rows.findOneBy({
        itemId: survivor.id,
        priceScopeId: nationalId,
      });
      expect(Number(national?.price)).toBe(1.05);
    });

    it('offers the survivor at a scope where only the merged product was offered', async () => {
      const loser = await product('Leche ofrecida fusion');
      const survivor = await product('Leche no ofrecida queda');
      // Both have a row at the scope: the survivor's is priced and says the
      // scope does not carry it, the merged one's says the scope does.
      await price(survivor.id, 1.05, otherNationalId);
      await scopeItems.setAvailability({
        userId: HARVESTER,
        priceScopeId: otherNationalId,
        entries: [
          { itemId: survivor.id, available: false },
          { itemId: loser.id, available: true },
        ],
      });
      const offered = async () =>
        (
          await items.getMany({
            ids: [survivor.id],
            priceScopeIds: [otherNationalId],
          })
        ).items[0]?.bestOffer ?? null;
      expect(await offered()).toBeNull();

      await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });

      const rows = dataSource.getRepository(SupermarketItem);
      expect(
        await rows.findOneBy({
          itemId: survivor.id,
          priceScopeId: otherNationalId,
        })
      ).toMatchObject({ available: true });
      expect(await rows.countBy({ itemId: loser.id })).toBe(0);
      expect(Number((await offered())?.price)).toBe(1.05);
    });

    it('writes the trail of both products as updates, never as a delete', async () => {
      const loser = await product('Leche trail perdida');
      const survivor = await product('Leche trail queda');
      await dataSource.getRepository(CatalogAudit).clear();

      await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });

      const trail = await dataSource.getRepository(CatalogAudit).find({
        where: { entity: 'items' },
        order: { at: 'ASC' },
      });
      const of = (id: string) => trail.filter((r) => r.entityId === id);
      expect(trail.map((r) => r.action)).not.toContain(AuditAction.DELETE);
      const [loserRow] = of(loser.id);
      expect(loserRow.action).toBe(AuditAction.UPDATE);
      expect(loserRow.before).toMatchObject({ mergedIntoId: null });
      expect(loserRow.after).toMatchObject({ mergedIntoId: survivor.id });
      const [survivorRow] = of(survivor.id);
      expect(survivorRow.action).toBe(AuditAction.UPDATE);
      expect(survivorRow.after).toMatchObject({
        mergedFrom: { itemId: loser.id },
      });
    });

    it('moves every barcode; the survivor takes the first one when it has none', async () => {
      const loser = await product('Leche barcodes a', { ean: '8402001002083' });
      await items.addEan({
        ...AS_OPERATOR,
        itemId: loser.id,
        ean: '8402001047251',
      });
      const survivor = await product('Leche barcodes b');

      const result = await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });

      expect(result.barcodes).toEqual(['8402001002083', '8402001047251']);
      expect(result.survivorEan).toBe('8402001002083');
      expect((await row(loser.id)).ean).toBeNull();
      const view = await items.get({ ...AS_OPERATOR, itemId: survivor.id });
      expect(view.ean).toBe('8402001002083');
      expect(view.eans).toEqual(['8402001002083', '8402001047251']);
      // Either barcode now finds the survivor.
      const found = await items.findByEan({
        userId: OPERATOR,
        ean: '8402001047251',
      });
      expect(found.item?.id).toBe(survivor.id);
    });

    it('keeps the survivor its own first barcode, and two barcodes are no refusal', async () => {
      const loser = await product('Leche dos codigos a', { ean: '96385074' });
      const survivor = await product('Leche dos codigos b', {
        ean: '036000291452',
      });

      const result = await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });

      expect(result.survivorEan).toBe('036000291452');
      const view = await items.get({ ...AS_OPERATOR, itemId: survivor.id });
      expect(view.ean).toBe('036000291452');
      expect(view.eans).toEqual(['036000291452', '96385074']);
      expect((await row(loser.id)).ean).toBeNull();
    });

    it('moves a product merged into the merged one onto the survivor (one level)', async () => {
      const a = await product('Leche nivel A');
      const b = await product('Leche nivel B');
      const c = await product('Leche nivel C');
      await items.merge({ ...AS_OPERATOR, itemId: a.id, intoItemId: b.id });

      const result = await items.merge({
        ...AS_OPERATOR,
        itemId: b.id,
        intoItemId: c.id,
      });

      expect(result.repointedItemIds).toEqual([a.id]);
      expect((await row(a.id)).mergedIntoId).toBe(c.id);
      expect((await row(b.id)).mergedIntoId).toBe(c.id);
      // A read of A answers C, not B.
      const view = await items.get({ ...AS_OPERATOR, itemId: a.id });
      expect(view).toMatchObject({ id: a.id, mergedInto: c.id });
    });
  });

  describe('section 1.1: a dry run and the refusals', () => {
    it('a dry run answers what a merge writes, and writes nothing', async () => {
      const loser = await product('Leche ensayo a', { ean: '10012345678902' });
      const survivor = await product('Leche ensayo b');
      await price(loser.id, 0.89, warehouseId);
      const snapshot = async () => ({
        loser: await row(loser.id),
        survivor: await row(survivor.id),
        loserPrices: await priceRows(loser.id),
        survivorPrices: await priceRows(survivor.id),
      });
      const before = await snapshot();

      const dry = await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
        dryRun: true,
      });

      expect(await snapshot()).toEqual(before);
      expect(before.loser.mergedIntoId).toBeNull();
      expect(merged).toEqual([]);

      const real = await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });
      const same = (r: MergeItemResult) => ({
        ...r,
        dryRun: undefined,
        mergedAt: undefined,
      });
      expect(same(dry)).toEqual(same(real));
      expect(dry).toMatchObject({ dryRun: true, mergedAt: null, prices: 1 });
    });

    it('refuses two formats, and merges them when the request allows it', async () => {
      const small = await product('Zumo pequeno', { unitSize: 200 });
      const large = await product('Zumo grande', { unitSize: 1000 });

      const error = await refused(
        items.merge({ ...AS_OPERATOR, itemId: small.id, intoItemId: large.id }),
        ItemMergeFormatDiffersException
      );
      expect(error.details).toEqual({
        item: { unitSize: 200, defaultUnit: UnitOfMeasure.MILLILITER },
        into: { unitSize: 1000, defaultUnit: UnitOfMeasure.MILLILITER },
      });
      expect((await row(small.id)).mergedIntoId).toBeNull();

      const done = await items.merge({
        ...AS_OPERATOR,
        itemId: small.id,
        intoItemId: large.id,
        allowFormatDifference: true,
      });
      expect(done.mergedIntoId).toBe(large.id);
    });

    it('refuses two articles of one chain, and merges them when the request allows it', async () => {
      const kiwi = await product('Kiwi uno');
      const other = await product('Kiwi dos');
      references.queue.set(kiwi.id, {
        rowCount: 1,
        activeSupermarketIds: [CHAIN_X],
      });
      references.queue.set(other.id, {
        rowCount: 1,
        activeSupermarketIds: [CHAIN_X],
      });

      const error = await refused(
        items.merge({ ...AS_OPERATOR, itemId: kiwi.id, intoItemId: other.id }),
        ItemMergeTwoArticlesOneChainException
      );
      expect(error.details?.[ITEM_MERGE_CHAINS_DETAIL]).toEqual([CHAIN_X]);
      // A dry run is refused the same way.
      await refused(
        items.merge({
          ...AS_OPERATOR,
          itemId: kiwi.id,
          intoItemId: other.id,
          dryRun: true,
        }),
        ItemMergeTwoArticlesOneChainException
      );

      const done = await items.merge({
        ...AS_OPERATOR,
        itemId: kiwi.id,
        intoItemId: other.id,
        allowSecondArticle: true,
      });
      expect(done.mergedIntoId).toBe(other.id);
    });

    it('counts the products already merged into either side, whose rows a lost event left', async () => {
      const a = await product('Kiwi ya fusionado');
      const b = await product('Kiwi que se fusiona');
      const c = await product('Kiwi que queda');
      await items.merge({ ...AS_OPERATOR, itemId: a.id, intoItemId: b.id });
      merged.length = 0;
      references.asked = [];
      // The harvester never heard that A became B: its rows still name A.
      references.queue.set(a.id, {
        rowCount: 2,
        activeSupermarketIds: [CHAIN_X],
      });
      references.queue.set(b.id, { rowCount: 1, activeSupermarketIds: [] });
      references.queue.set(c.id, {
        rowCount: 1,
        activeSupermarketIds: [CHAIN_X],
      });

      const error = await refused(
        items.merge({ ...AS_OPERATOR, itemId: b.id, intoItemId: c.id }),
        ItemMergeTwoArticlesOneChainException
      );
      expect(error.details?.[ITEM_MERGE_CHAINS_DETAIL]).toEqual([CHAIN_X]);
      expect(references.asked).toEqual([
        { what: 'queue', itemIds: [b.id, c.id, a.id] },
      ]);

      const done = await items.merge({
        ...AS_OPERATOR,
        itemId: b.id,
        intoItemId: c.id,
        allowSecondArticle: true,
      });
      // B's row and A's two.
      expect(done.queueRows).toBe(3);
      expect(done.repointedItemIds).toEqual([a.id]);
      // A is announced again, now onto C, so its rows move.
      expect(merged).toEqual([
        { itemId: b.id, intoItemId: c.id },
        { itemId: a.id, intoItemId: c.id },
      ]);
    });

    it('reads a product already merged into the survivor as the survivor for rule R28', async () => {
      const early = await product('Pera ya fusionada');
      const survivor = await product('Pera que queda');
      const late = await product('Pera que llega');
      await items.merge({
        ...AS_OPERATOR,
        itemId: early.id,
        intoItemId: survivor.id,
      });
      references.queue.set(early.id, {
        rowCount: 1,
        activeSupermarketIds: [CHAIN_X],
      });
      references.queue.set(late.id, {
        rowCount: 1,
        activeSupermarketIds: [CHAIN_X],
      });

      const error = await refused(
        items.merge({
          ...AS_OPERATOR,
          itemId: late.id,
          intoItemId: survivor.id,
        }),
        ItemMergeTwoArticlesOneChainException
      );
      expect(error.details?.[ITEM_MERGE_CHAINS_DETAIL]).toEqual([CHAIN_X]);
    });

    it('refuses a merged product on either side, the same product, and a service', async () => {
      const a = await product('Pan uno');
      const b = await product('Pan dos');
      const c = await product('Pan tres');
      await items.merge({ ...AS_OPERATOR, itemId: a.id, intoItemId: b.id });

      const again = await refused(
        items.merge({ ...AS_OPERATOR, itemId: a.id, intoItemId: c.id }),
        ItemMergedException
      );
      expect(again.details?.[ITEM_MERGED_INTO_DETAIL]).toBe(b.id);
      await refused(
        items.merge({ ...AS_OPERATOR, itemId: c.id, intoItemId: a.id }),
        ItemMergedException
      );
      await refused(
        items.merge({ ...AS_OPERATOR, itemId: c.id, intoItemId: c.id }),
        ValidationException
      );
      await refused(
        itemsAsService.merge({
          ...AS_OPERATOR,
          itemId: c.id,
          intoItemId: b.id,
        }),
        ForbiddenException
      );
    });
  });

  describe('section 2: what a read answers', () => {
    it('a search finds the survivor once and the merged row never', async () => {
      const loser = await product('Natillas Merengadas Fusion');
      const survivor = await product('Natillas Merengadas Fusion');
      await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });

      for (const order of ['relevance', 'name'] as const) {
        const page = await items.search({
          userId: OPERATOR,
          query: 'natillas merengadas',
          order,
        });
        const ids = page.items.map((item) => item.id);
        expect(ids.filter((id) => id === survivor.id)).toHaveLength(1);
        expect(ids).not.toContain(loser.id);
      }
      // The admin's history lists the merged row alone, as it was.
      const history = await items.search({
        userId: OPERATOR,
        query: 'natillas merengadas',
        merged: true,
      });
      expect(history.items.map((item) => item.id)).toEqual([loser.id]);
      expect(history.items[0]).toMatchObject({
        mergedInto: survivor.id,
        name: { es: 'Natillas Merengadas Fusion' },
      });
    });

    it('getMany answers the survivor under the merged id, with mergedInto and its offers', async () => {
      const loser = await product('Yogur fusion lookup');
      const survivor = await product('Yogur queda lookup');
      await price(survivor.id, 2.1, warehouseId);
      await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });

      const { items: found } = await items.getMany({
        ids: [loser.id, survivor.id],
        priceScopeIds: [warehouseId],
      });
      const byId = new Map(found.map((item) => [item.id, item]));
      expect(found).toHaveLength(2);
      expect(byId.get(loser.id)).toMatchObject({
        id: loser.id,
        mergedInto: survivor.id,
        name: { es: 'Yogur queda lookup' },
      });
      expect(Number(byId.get(loser.id)?.bestOffer?.price)).toBe(2.1);
      expect(byId.get(survivor.id)).not.toHaveProperty('mergedInto');

      const one = await items.getMany({ ids: [loser.id] });
      expect(one.items).toEqual([
        expect.objectContaining({ id: loser.id, mergedInto: survivor.id }),
      ]);
    });
  });

  describe('section 2: a write that names a merged product', () => {
    /** A merged product and its survivor, merged with nothing on either. */
    async function mergedPair(name: string) {
      const loser = await product(`${name} fusion`);
      const survivor = await product(`${name} queda`);
      await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });
      return { loser, survivor };
    }

    it('writes a price sent for the merged id onto the survivor', async () => {
      const { loser, survivor } = await mergedPair('Leche tarde');

      // A harvest that read the merged id before the merge, as a batch and
      // as one row.
      await price(loser.id, 1.11, warehouseId);
      const one = await prices.add({
        userId: HARVESTER,
        itemId: loser.id,
        priceScopeId: otherNationalId,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        price: 1.22,
        currency: 'EUR',
        observedAt: new Date(Date.now() - 60_000).toISOString(),
      });

      expect(one.itemId).toBe(survivor.id);
      expect(await priceRows(loser.id)).toBe(0);
      expect(await priceRows(survivor.id)).toBe(2);
      const shown = dataSource.getRepository(SupermarketItem);
      expect(
        Number(
          (
            await shown.findOneBy({
              itemId: survivor.id,
              priceScopeId: warehouseId,
            })
          )?.price
        )
      ).toBe(1.11);
      expect(await shown.countBy({ itemId: loser.id })).toBe(0);
    });

    it('writes availability sent for the merged id onto the survivor, at a shop and at a scope', async () => {
      const { loser, survivor } = await mergedPair('Leche tienda tarde');
      const shops = dataSource.getRepository(SupermarketLocation);
      const shop = await shops.save(shops.create({ supermarketId: chainId }));

      await shopItems.setAvailability({
        userId: HARVESTER,
        supermarketLocationId: shop.id,
        sourceKind: PriceSourceKind.OFFICIAL_WEB,
        sourceRunId: RUN,
        entries: [{ itemId: loser.id, available: true }],
      });
      await scopeItems.setAvailability({
        userId: HARVESTER,
        priceScopeId: otherNationalId,
        entries: [{ itemId: loser.id, available: true }],
      });

      const shopRows = dataSource.getRepository(SupermarketLocationItem);
      expect(
        await shopRows.findOneBy({
          itemId: survivor.id,
          supermarketLocationId: shop.id,
        })
      ).toMatchObject({ available: true });
      expect(await shopRows.countBy({ itemId: loser.id })).toBe(0);
      const scopeRows = dataSource.getRepository(SupermarketItem);
      expect(
        await scopeRows.findOneBy({
          itemId: survivor.id,
          priceScopeId: otherNationalId,
        })
      ).toMatchObject({ available: true });
      expect(await scopeRows.countBy({ itemId: loser.id })).toBe(0);
    });

    it('teaches a barcode sent for the merged id to the survivor', async () => {
      const { loser, survivor } = await mergedPair('Leche codigo tarde');

      const taught = await itemsAsService.teachEans({
        userId: HARVESTER,
        entries: [{ itemId: loser.id, ean: '4006381333931' }],
      });

      expect(taught).toEqual({ added: 1, refused: [] });
      const found = await items.findByEan({
        userId: OPERATOR,
        ean: '4006381333931',
      });
      expect(found.item?.id).toBe(survivor.id);
      expect((await row(loser.id)).ean).toBeNull();
    });

    it('answers the survivor for a barcode a merged row still holds', async () => {
      const { loser, survivor } = await mergedPair('Leche codigo viejo');
      // A barcode written to the merged row before such writes were moved.
      await dataSource.query(
        `INSERT INTO "item_eans" ("ean", "itemId") VALUES ($1, $2)`,
        ['5000112637922', loser.id]
      );

      const one = await items.findByEan({
        userId: OPERATOR,
        ean: '5000112637922',
      });
      expect(one.item?.id).toBe(survivor.id);
      const many = await items.findByEans({
        userId: OPERATOR,
        eans: ['5000112637922'],
      });
      expect(many.items.map((item) => item.id)).toEqual([survivor.id]);
    });

    it('refuses a barcode or a group on a merged row, and allows any other edit', async () => {
      const { loser } = await mergedPair('Leche editada');

      await refused(
        items.addEan({
          ...AS_OPERATOR,
          itemId: loser.id,
          ean: '9780201379624',
        }),
        ItemMergedException
      );
      await refused(
        items.update({
          ...AS_OPERATOR,
          itemId: loser.id,
          ean: '9780201379624',
        }),
        ItemMergedException
      );
      const groups = dataSource.getRepository(ProductGroup);
      const group = await groups.save(
        groups.create({
          name: { es: 'Leches', en: 'Milks' },
          slug: 'plan0239-merged-row-group',
        })
      );
      await refused(
        items.update({
          ...AS_OPERATOR,
          itemId: loser.id,
          productGroupId: group.id,
        }),
        ItemMergedException
      );
      expect((await row(loser.id)).productGroupId).toBeNull();

      const edited = await items.update({
        ...AS_OPERATOR,
        itemId: loser.id,
        brand: null,
      });
      expect(edited.brand).toBeNull();
    });
  });

  describe('section 4: what becomes of delete', () => {
    it('refuses a product with a price, naming the count', async () => {
      const priced = await product('Queso con precio');
      await price(priced.id, 3.2, warehouseId);

      const error = await refused(
        items.delete({ ...AS_OPERATOR, itemId: priced.id }),
        ItemInUseException
      );
      expect(error.details).toEqual({
        [ITEM_IN_USE_PRICES_DETAIL]: 1,
        [ITEM_IN_USE_MERGED_DETAIL]: 0,
        [ITEM_IN_USE_QUEUE_DETAIL]: 0,
        [ITEM_IN_USE_LINES_DETAIL]: 0,
      });
      expect(await row(priced.id)).toBeDefined();
    });

    it('refuses a survivor, a merged row, a queued product and a listed product', async () => {
      const loser = await product('Queso perdido');
      const survivor = await product('Queso queda');
      await items.merge({
        ...AS_OPERATOR,
        itemId: loser.id,
        intoItemId: survivor.id,
      });
      const survivorRefusal = await refused(
        items.delete({ ...AS_OPERATOR, itemId: survivor.id }),
        ItemInUseException
      );
      expect(survivorRefusal.details?.[ITEM_IN_USE_MERGED_DETAIL]).toBe(1);
      await refused(
        items.delete({ ...AS_OPERATOR, itemId: loser.id }),
        ItemMergedException
      );

      const queued = await product('Queso en la cola');
      references.queue.set(queued.id, {
        rowCount: 3,
        activeSupermarketIds: [],
      });
      const queueRefusal = await refused(
        items.delete({ ...AS_OPERATOR, itemId: queued.id }),
        ItemInUseException
      );
      expect(queueRefusal.details?.[ITEM_IN_USE_QUEUE_DETAIL]).toBe(3);

      const listed = await product('Queso en una lista');
      references.lines.set(listed.id, 2);
      const lineRefusal = await refused(
        items.delete({ ...AS_OPERATOR, itemId: listed.id }),
        ItemInUseException
      );
      expect(lineRefusal.details?.[ITEM_IN_USE_LINES_DETAIL]).toBe(2);
    });

    it('waits for a merge that holds the row, and then refuses the merged row', async () => {
      const doomed = await product('Queso en plena fusion');
      const survivor = await product('Queso que recibe');
      // A merge that is running: both rows locked as applyMerge locks them,
      // and the mark written but not committed.
      const merge = dataSource.createQueryRunner();
      await merge.connect();
      await merge.startTransaction();
      try {
        await merge.query(
          `SELECT "id" FROM "items" WHERE "id" = ANY($1::uuid[])
            ORDER BY "id" FOR UPDATE`,
          [[doomed.id, survivor.id]]
        );
        await merge.query(
          `UPDATE "items" SET "mergedIntoId" = $2, "mergedAt" = now()
            WHERE "id" = $1`,
          [doomed.id, survivor.id]
        );

        const deleting = items
          .delete({ ...AS_OPERATOR, itemId: doomed.id })
          .then(
            () => 'deleted',
            (error: unknown) => error
          );
        // The delete is waiting on the row once a statement over `items`
        // waits on a lock. Read, not slept: a fixed sleep proves nothing.
        const waiting = async () =>
          (
            (await dataSource.query(
              `SELECT count(*)::int AS "count" FROM pg_stat_activity
                WHERE "wait_event_type" = 'Lock'
                  AND "query" LIKE '%"items"%'
                  AND "pid" <> pg_backend_pid()`
            )) as { count: number }[]
          )[0].count;
        const deadline = Date.now() + 10_000;
        while ((await waiting()) === 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(await waiting()).toBeGreaterThan(0);

        await merge.commitTransaction();
        const outcome = await deleting;

        expect(outcome).toBeInstanceOf(ItemMergedException);
        expect((await row(doomed.id)).mergedIntoId).toBe(survivor.id);
      } finally {
        if (merge.isTransactionActive) {
          await merge.rollbackTransaction();
        }
        await merge.release();
      }
    });

    it('deletes a product nothing names, after asking the harvester and core', async () => {
      const lonely = await product('Queso solo');

      await items.delete({ ...AS_OPERATOR, itemId: lonely.id });

      expect(
        await dataSource.getRepository(Item).countBy({ id: lonely.id })
      ).toBe(0);
      expect(references.asked).toEqual([
        { what: 'queue', itemIds: [lonely.id] },
        { what: 'lines', itemIds: [lonely.id] },
      ]);
    });

    it('a service delete asks nobody, and still refuses a priced product', async () => {
      const created = await product('Queso de un fichero');
      references.queue.set(created.id, {
        rowCount: 1,
        activeSupermarketIds: [],
      });

      await itemsAsService.delete({ userId: HARVESTER, itemId: created.id });

      expect(references.asked).toEqual([]);
      const priced = await product('Queso de un fichero con precio');
      await price(priced.id, 1, warehouseId);
      await refused(
        itemsAsService.delete({ userId: HARVESTER, itemId: priced.id }),
        ItemInUseException
      );
    });
  });
});
