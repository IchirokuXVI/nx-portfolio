import {
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type AdminCredential,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { CATALOG_MIGRATIONS } from '../db/migrations';
import {
  AuditAction,
  AuditActorKind,
  CATALOG_ENTITIES,
  CatalogAudit,
  Item,
  ItemPrice,
  PriceScope,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
  SupermarketLocationItem,
} from '../entities';
import { CatalogAuditService } from './catalog-audit.service';
import { EffectivePriceService } from './effective-price.service';
import { ItemPriceService } from './item-price.service';
import { LocationScopeService, setStack } from './location-scopes';
import type {
  CatalogActor,
  PlatformAdminService,
} from './platform-admin.service';
import { SupermarketItemService } from './supermarket-item.service';
import { SupermarketLocationItemService } from './supermarket-location-item.service';

/**
 * What a row that left a product is taken back by (plan 0191), against real
 * Postgres: `itemPrice.withdraw` and `supermarketItem.withdraw`.
 *
 * Nothing here is a fake. Every price is written through `itemPrice.addBatch`
 * or `itemPrice.add`, so the materialized rows under test are the ones the
 * recompute made, and every availability through the two services that own
 * it. What is proved is what a fake repository cannot: which rows the SQL
 * names, what the recompute leaves behind, and that a dry run writes nothing.
 *
 * The chain is the one the plan describes. A default scope, three scopes
 * that fall through to it, and a product that a wrong row priced there.
 *
 *   LUNA_INTEGRATION=1 CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-catalog:test-integration --testFile=item-withdraw.integration.spec.ts
 */
const SCHEMA = 'plan0191_item_withdraw_test';

/** The harvester, which catalog knows as a service. */
const HARVESTER = '19100000-0000-4000-a000-000000000001';
/** An operator, which catalog knows by a verified token. */
const PERSON = '19100000-0000-4000-a000-000000000002';

const RUN = '19100000-0000-4000-a000-0000000000a1';
const OLDER_RUN = '19100000-0000-4000-a000-0000000000a2';

const KINDS = [
  PriceSourceKind.OFFICIAL_API,
  PriceSourceKind.OFFICIAL_WEB,
  PriceSourceKind.OFFICIAL_LEAFLET,
];

/** Recent, so no price here is out of date, and never in the future. */
const MONDAY = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const SUNDAY = new Date(MONDAY.getTime() - 24 * 60 * 60 * 1000);

describeIntegration(
  'what a row that left a product is taken back by (real Postgres)',
  () => {
    let dataSource: DataSource;
    let prices: ItemPriceService;
    let offers: SupermarketItemService;
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
        extra: { options: `-c search_path=${SCHEMA},public` },
      });
      await dataSource.initialize();
      await dataSource.runMigrations();

      // The gate answers who wrote, and that is what the trail records. A
      // token is not what is under test, so the person is recognised by id,
      // and still as `admin`: the offers withdraw reads that kind back.
      const admin = {
        requireAdmin: async (
          credential: AdminCredential
        ): Promise<CatalogActor> =>
          credential.userId === PERSON
            ? { kind: 'admin', actorId: PERSON }
            : { kind: 'service', actorId: HARVESTER },
      } as unknown as PlatformAdminService;
      const audit = new CatalogAuditService(dataSource);
      const stacks = new LocationScopeService();
      prices = new ItemPriceService(
        dataSource.getRepository(ItemPrice),
        dataSource.getRepository(Item),
        dataSource.getRepository(PriceScope),
        admin,
        audit,
        new EffectivePriceService()
      );
      offers = new SupermarketItemService(
        dataSource.getRepository(SupermarketItem),
        dataSource.getRepository(Item),
        dataSource.getRepository(PriceScope),
        dataSource.getRepository(SupermarketLocation),
        admin,
        audit,
        stacks
      );
      shopItems = new SupermarketLocationItemService(
        dataSource.getRepository(SupermarketLocationItem),
        dataSource.getRepository(Item),
        dataSource.getRepository(SupermarketLocation),
        admin,
        audit,
        stacks
      );
    }, 180_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
      }
    });

    interface Chain {
      id: string;
      /** The chain's default scope, which every other scope falls through to. */
      national: string;
      regions: [string, string, string];
      scopes: string[];
    }

    /** A chain with a default scope and three scopes that fall through to it. */
    async function chain(): Promise<Chain> {
      const supermarkets = dataSource.getRepository(Supermarket);
      const row = await supermarkets.save(
        supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
      );
      const scopes = dataSource.getRepository(PriceScope);
      const scope = async (kind: PriceScopeKind, externalKey: string | null) =>
        (
          await scopes.save(
            scopes.create({ supermarketId: row.id, kind, externalKey })
          )
        ).id;
      const national = await scope(PriceScopeKind.NATIONAL, null);
      const regions: [string, string, string] = [
        await scope(PriceScopeKind.REGION, 'north'),
        await scope(PriceScopeKind.REGION, 'centre'),
        await scope(PriceScopeKind.REGION, 'south'),
      ];
      row.defaultPriceScopeId = national;
      await supermarkets.save(row);
      return { id: row.id, national, regions, scopes: [national, ...regions] };
    }

    /** A shop of the chain that sells at one scope. */
    async function shop(of: Chain, priceScopeId: string): Promise<string> {
      const locations = dataSource.getRepository(SupermarketLocation);
      const row = await locations.save(
        locations.create({ supermarketId: of.id })
      );
      await setStack(dataSource.manager, row.id, [priceScopeId]);
      return row.id;
    }

    let seq = 0;
    async function product(): Promise<string> {
      seq += 1;
      const items = dataSource.getRepository(Item);
      return (
        await items.save(
          items.create({
            name: { es: `Figura ${seq}` },
            defaultUnit: UnitOfMeasure.UNIT,
          })
        )
      ).id;
    }

    /** A price a harvest run wrote: an automated kind, and a run id. */
    function runPrice(
      itemId: string,
      priceScopeId: string,
      price: number,
      over: { observedAt?: Date; runId?: string; kind?: PriceSourceKind } = {}
    ) {
      return prices.addBatch({
        userId: HARVESTER,
        priceScopeId,
        sourceKind: over.kind ?? PriceSourceKind.OFFICIAL_WEB,
        sourceRunId: over.runId ?? RUN,
        entries: [
          {
            itemId,
            price,
            currency: 'EUR',
            observedAt: (over.observedAt ?? MONDAY).toISOString(),
          },
        ],
      });
    }

    const priceRows = (itemId: string) =>
      dataSource
        .getRepository(ItemPrice)
        .find({
          where: { itemId },
          order: { observedAt: 'ASC', price: 'ASC' },
        });

    const offerRows = (itemId: string) =>
      dataSource.getRepository(SupermarketItem).findBy({ itemId });

    const shown = (itemId: string, priceScopeId: string) =>
      dataSource
        .getRepository(SupermarketItem)
        .findOneBy({ itemId, priceScopeId });

    const trail = (entityId: string) =>
      dataSource.getRepository(CatalogAudit).findBy({ entityId });

    const withdrawPrices = (
      itemId: string,
      of: Chain,
      over: Partial<Parameters<ItemPriceService['withdraw']>[0]> = {}
    ) =>
      prices.withdraw({
        userId: HARVESTER,
        itemId,
        priceScopeIds: of.scopes,
        sourceKinds: KINDS,
        ...over,
      });

    const withdrawOffers = (
      itemId: string,
      of: Chain,
      over: Partial<Parameters<SupermarketItemService['withdraw']>[0]> = {}
    ) =>
      offers.withdraw({
        userId: HARVESTER,
        itemId,
        supermarketId: of.id,
        priceScopeIds: of.scopes,
        ...over,
      });

    describe('the figurine: a price at the default scope, and the three scopes that fall through to it', () => {
      it('is left with four offers and no price when its price row goes, which is the defect', async () => {
        const of = await chain();
        const figurine = await product();
        await runPrice(figurine, of.national, 4.99);
        // One price row, and the recompute materialized it in all four scopes.
        expect(await priceRows(figurine)).toHaveLength(1);
        expect(
          (await offerRows(figurine)).map((row) => Number(row.price))
        ).toEqual([4.99, 4.99, 4.99, 4.99]);

        const withdrawn = await withdrawPrices(figurine, of);

        expect(withdrawn).toEqual({
          deleted: 1,
          removed: [
            {
              priceScopeId: of.national,
              sourceKind: PriceSourceKind.OFFICIAL_WEB,
              deleted: 1,
            },
          ],
          // The scope written to and the three that fall through to it.
          recomputed: 4,
        });
        expect(await priceRows(figurine)).toEqual([]);
        // `recomputeEffectivePrices` leaves a held row in place with no
        // price. This is what slot 1 holds for the figurine: rows with a null
        // price that say the chain sells it.
        const left = await offerRows(figurine);
        expect(left).toHaveLength(4);
        expect(left.every((row) => row.price === null)).toBe(true);
        expect(left.every((row) => row.available === true)).toBe(true);
      }, 60_000);

      it('holds no price row and no offer in any scope once both calls ran', async () => {
        const of = await chain();
        const figurine = await product();
        const other = await product();
        await runPrice(figurine, of.national, 4.99);
        await runPrice(other, of.national, 1.25);
        const [priceRow] = await priceRows(figurine);
        const before = await offerRows(figurine);

        await withdrawPrices(figurine, of);
        const result = await withdrawOffers(figurine, of);

        expect([...result.offersRemoved].sort()).toEqual([...of.scopes].sort());
        expect(result.offersKept).toEqual([]);
        expect(await priceRows(figurine)).toEqual([]);
        expect(await offerRows(figurine)).toEqual([]);
        // The product beside it, priced by a row that is still bound, is not
        // named and not touched.
        expect(await priceRows(other)).toHaveLength(1);
        expect(await offerRows(other)).toHaveLength(4);

        // Audited like `deleteByRun`: one trail row per row that went, by the
        // service that asked, with the row as it was.
        const priceTrail = await trail(priceRow.id);
        expect(
          priceTrail.filter((row) => row.action === AuditAction.DELETE)
        ).toEqual([
          expect.objectContaining({
            entity: 'item_prices',
            actorKind: AuditActorKind.SERVICE,
            actorId: HARVESTER,
            before: expect.objectContaining({ sourceRunId: RUN, price: 4.99 }),
            after: null,
          }),
        ]);
        for (const offer of before) {
          expect(await trail(offer.id)).toEqual([
            expect.objectContaining({
              entity: 'supermarket_items',
              action: AuditAction.DELETE,
              actorKind: AuditActorKind.SERVICE,
            }),
          ]);
        }
      }, 60_000);

      it('answers the same for a dry run of both calls, and writes nothing', async () => {
        const of = await chain();
        const figurine = await product();
        await runPrice(figurine, of.national, 4.99);
        const audited = await dataSource.getRepository(CatalogAudit).count();

        const wouldWithdraw = await withdrawPrices(figurine, of, {
          dryRun: true,
        });
        // The price is still there, so a dry run of the offers by itself
        // finds every one of them priced.
        const alone = await withdrawOffers(figurine, of, { dryRun: true });
        // Told to count the prices as gone, it answers what the real pair of
        // calls answers.
        const wouldRemove = await withdrawOffers(figurine, of, {
          dryRun: true,
          assumePricesWithdrawn: KINDS,
        });

        expect(wouldWithdraw).toMatchObject({ deleted: 1, recomputed: 4 });
        expect(alone.offersRemoved).toEqual([]);
        expect(alone.offersKept.map((kept) => kept.reason)).toEqual([
          'PRICED',
          'PRICED',
          'PRICED',
          'PRICED',
        ]);
        expect([...wouldRemove.offersRemoved].sort()).toEqual(
          [...of.scopes].sort()
        );

        // Nothing moved: the price row, the four priced offers, the trail.
        expect(await priceRows(figurine)).toHaveLength(1);
        expect(
          (await offerRows(figurine)).map((row) => Number(row.price))
        ).toEqual([4.99, 4.99, 4.99, 4.99]);
        expect(await dataSource.getRepository(CatalogAudit).count()).toBe(
          audited
        );

        // And the real calls then do what the dry run said.
        expect(await withdrawPrices(figurine, of)).toEqual(wouldWithdraw);
        expect(await withdrawOffers(figurine, of)).toEqual(wouldRemove);
      }, 60_000);

      it('removes nothing when it is run again', async () => {
        const of = await chain();
        const figurine = await product();
        await runPrice(figurine, of.national, 4.99);
        await withdrawPrices(figurine, of);
        await withdrawOffers(figurine, of);

        expect(await withdrawPrices(figurine, of)).toEqual({
          deleted: 0,
          removed: [],
          recomputed: 0,
        });
        expect(await withdrawOffers(figurine, of)).toEqual({
          offersRemoved: [],
          offersKept: [],
          shopRowsRemoved: 0,
          shopRowsCleared: 0,
          conflicts: [],
        });
      }, 60_000);
    });

    describe('nothing a person typed is removed', () => {
      it('keeps an ADMIN price and the offers it prices', async () => {
        const of = await chain();
        const figurine = await product();
        await runPrice(figurine, of.national, 4.99);
        await prices.add({
          userId: PERSON,
          itemId: figurine,
          priceScopeId: of.national,
          sourceKind: PriceSourceKind.ADMIN,
          price: 5.49,
          currency: 'EUR',
        });

        const withdrawn = await withdrawPrices(figurine, of);
        const result = await withdrawOffers(figurine, of);

        expect(withdrawn.deleted).toBe(1);
        const left = await priceRows(figurine);
        expect(left).toHaveLength(1);
        expect(left[0]).toMatchObject({
          sourceKind: PriceSourceKind.ADMIN,
          sourceRunId: null,
        });
        // The person's price is what every scope shows now, and every offer
        // stays because something prices it.
        expect(result.offersRemoved).toEqual([]);
        expect(result.offersKept.map((kept) => kept.reason)).toEqual([
          'PRICED',
          'PRICED',
          'PRICED',
          'PRICED',
        ]);
        expect(
          (await offerRows(figurine)).map((row) => Number(row.price))
        ).toEqual([5.49, 5.49, 5.49, 5.49]);
      }, 60_000);

      it('refuses to be asked for an ADMIN price', async () => {
        const of = await chain();
        const figurine = await product();

        await expect(
          withdrawPrices(figurine, of, {
            sourceKinds: [PriceSourceKind.ADMIN],
          })
        ).rejects.toBeInstanceOf(ValidationException);
      }, 60_000);

      it('keeps a price of an automated kind that names no run, because a person can type one', async () => {
        const of = await chain();
        const figurine = await product();
        // The back office accepts an automated kind, and such a row carries
        // no run. The kind and the run id are what tell the two apart.
        await prices.add({
          userId: PERSON,
          itemId: figurine,
          priceScopeId: of.national,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          price: 4.75,
          currency: 'EUR',
        });

        const withdrawn = await withdrawPrices(figurine, of);

        expect(withdrawn.deleted).toBe(0);
        expect(await priceRows(figurine)).toHaveLength(1);
      }, 60_000);

      it('keeps an offer an operator wrote, and removes one the harvester wrote, whatever they say', async () => {
        const of = await chain();
        const figurine = await product();
        const [north, centre] = of.regions;
        // "Not sold here", typed in the back office.
        await offers.setAvailability({
          userId: PERSON,
          priceScopeId: north,
          entries: [{ itemId: figurine, available: false }],
        });
        // The same sentence from a run, about a product no row names now.
        await offers.setAvailability({
          userId: HARVESTER,
          priceScopeId: centre,
          entries: [{ itemId: figurine, available: false }],
        });

        const result = await withdrawOffers(figurine, of);

        expect(result.offersRemoved).toEqual([centre]);
        expect(result.offersKept).toEqual([
          { priceScopeId: north, reason: 'PERSON' },
        ]);
        expect(await shown(figurine, north)).toMatchObject({
          available: false,
        });
        expect(await shown(figurine, centre)).toBeNull();
      }, 60_000);
    });

    describe('what a bound row still states is spared', () => {
      /**
       * The El Pozo burger. Two rows of one chain priced one product at one
       * scope, and one run stamps every product with one instant, so the two
       * current candidates carry the same `observedAt`.
       */
      async function burger() {
        const of = await chain();
        const product_ = await product();
        // History: what the row that stays stated a run ago.
        await runPrice(product_, of.national, 2.3, {
          observedAt: SUNDAY,
          runId: OLDER_RUN,
        });
        // This run: the row that stays, and the row that left.
        await runPrice(product_, of.national, 2.45);
        await runPrice(product_, of.national, 2.95);
        return { of, itemId: product_ };
      }

      it('removes the rows observed at the statement or later, and keeps the history', async () => {
        const { of, itemId } = await burger();
        expect(
          (await priceRows(itemId)).map((row) => Number(row.price))
        ).toEqual([2.3, 2.45, 2.95]);

        const withdrawn = await withdrawPrices(itemId, of, {
          stated: [
            {
              priceScopeId: of.national,
              sourceKind: PriceSourceKind.OFFICIAL_WEB,
              observedAt: MONDAY.toISOString(),
            },
          ],
        });

        // Both rows of this run go, the one that stays included: which of two
        // rows with one instant is current is decided by their ids.
        expect(withdrawn.deleted).toBe(2);
        expect(
          (await priceRows(itemId)).map((row) => Number(row.price))
        ).toEqual([2.3]);

        // The harvester then writes the stated price again, and it is the
        // current one in every scope, whatever the ids were.
        await runPrice(itemId, of.national, 2.45);
        expect(
          (await priceRows(itemId)).map((row) => Number(row.price))
        ).toEqual([2.3, 2.45]);
        expect(
          (await offerRows(itemId)).map((row) => Number(row.price))
        ).toEqual([2.45, 2.45, 2.45, 2.45]);
      }, 60_000);

      it('removes nothing where the bound rows disagree, so the price that was current stays', async () => {
        const { of, itemId } = await burger();
        const before = await shown(itemId, of.national);

        const withdrawn = await withdrawPrices(itemId, of, {
          stated: [
            {
              priceScopeId: of.national,
              sourceKind: PriceSourceKind.OFFICIAL_WEB,
              observedAt: null,
            },
          ],
        });

        expect(withdrawn.deleted).toBe(0);
        expect(await priceRows(itemId)).toHaveLength(3);
        expect((await shown(itemId, of.national))?.itemPriceId).toBe(
          before?.itemPriceId
        );
      }, 60_000);

      it('spares only the scope and kind that is stated', async () => {
        const of = await chain();
        const itemId = await product();
        const [north] = of.regions;
        await runPrice(itemId, of.national, 2.45, { observedAt: SUNDAY });
        await runPrice(itemId, north, 2.6);
        await runPrice(itemId, of.national, 1.99, {
          kind: PriceSourceKind.OFFICIAL_LEAFLET,
        });

        const withdrawn = await withdrawPrices(itemId, of, {
          stated: [
            {
              priceScopeId: of.national,
              sourceKind: PriceSourceKind.OFFICIAL_WEB,
              // Later than the row: the row is history and stays.
              observedAt: MONDAY.toISOString(),
            },
          ],
        });

        expect(
          withdrawn.removed
            .map((each) => `${each.priceScopeId}|${each.sourceKind}`)
            .sort()
        ).toEqual(
          [
            `${north}|${PriceSourceKind.OFFICIAL_WEB}`,
            `${of.national}|${PriceSourceKind.OFFICIAL_LEAFLET}`,
          ].sort()
        );
        expect(
          (await priceRows(itemId)).map((row) => Number(row.price))
        ).toEqual([2.45]);
      }, 60_000);
    });

    describe('the shop rows of the chain', () => {
      it('removes the rows a run wrote, and the offer they derived', async () => {
        const of = await chain();
        const figurine = await product();
        const [north] = of.regions;
        const store = await shop(of, north);
        // A run said the shop stocks it. Catalog derived the offer of the
        // shop's scope from that, with no price.
        await shopItems.setAvailability({
          userId: HARVESTER,
          supermarketLocationId: store,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          sourceRunId: RUN,
          entries: [{ itemId: figurine, available: true }],
        });
        expect(await shown(figurine, north)).toMatchObject({
          available: true,
          price: null,
        });

        const result = await withdrawOffers(figurine, of);

        expect(result).toMatchObject({
          shopRowsRemoved: 1,
          shopRowsCleared: 0,
          conflicts: [],
          offersRemoved: [north],
        });
        expect(
          await dataSource
            .getRepository(SupermarketLocationItem)
            .findBy({ itemId: figurine })
        ).toEqual([]);
        expect(await offerRows(figurine)).toEqual([]);
      }, 60_000);

      it('leaves a row a person wrote, reports it as a conflict, and keeps the offer it backs', async () => {
        const of = await chain();
        const figurine = await product();
        const [north, centre] = of.regions;
        const typed = await shop(of, north);
        const crawled = await shop(of, centre);
        await shopItems.setAvailability({
          userId: PERSON,
          supermarketLocationId: typed,
          sourceKind: PriceSourceKind.ADMIN,
          entries: [{ itemId: figurine, available: true }],
        });
        await shopItems.setAvailability({
          userId: HARVESTER,
          supermarketLocationId: crawled,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          sourceRunId: RUN,
          entries: [{ itemId: figurine, available: true }],
        });

        const result = await withdrawOffers(figurine, of);

        // The same line `setLocationAvailability` draws: a row a person
        // typed is skipped and reported, never overwritten and never cleared.
        expect(result.conflicts).toEqual([
          { supermarketLocationId: typed, held: true },
        ]);
        expect(result.shopRowsRemoved).toBe(1);
        expect(result.offersRemoved).toEqual([centre]);
        expect(result.offersKept).toEqual([
          { priceScopeId: north, reason: 'SHOP_ROW' },
        ]);
        const left = await dataSource
          .getRepository(SupermarketLocationItem)
          .findBy({ itemId: figurine });
        expect(left).toHaveLength(1);
        expect(left[0]).toMatchObject({
          supermarketLocationId: typed,
          available: true,
          availabilitySourceKind: PriceSourceKind.ADMIN,
        });
      }, 60_000);

      it('keeps a position a person typed, and clears what the run said beside it', async () => {
        const of = await chain();
        const figurine = await product();
        const [north] = of.regions;
        const store = await shop(of, north);
        await shopItems.upsert({
          userId: PERSON,
          itemId: figurine,
          supermarketLocationId: store,
          positionInStore: 'Pasillo 4',
        });
        await shopItems.setAvailability({
          userId: HARVESTER,
          supermarketLocationId: store,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          sourceRunId: RUN,
          entries: [{ itemId: figurine, available: true }],
        });

        const result = await withdrawOffers(figurine, of);

        expect(result).toMatchObject({
          shopRowsRemoved: 0,
          shopRowsCleared: 1,
          conflicts: [],
        });
        const [row] = await dataSource
          .getRepository(SupermarketLocationItem)
          .findBy({ itemId: figurine });
        expect(row).toMatchObject({
          positionInStore: 'Pasillo 4',
          available: null,
          availabilitySourceKind: null,
          availabilitySourceRunId: null,
        });
        // With no opinion left, nothing backs the offer the run derived.
        expect(result.offersRemoved).toEqual([north]);
      }, 60_000);

      it('touches no shop of another chain', async () => {
        const of = await chain();
        const elsewhere = await chain();
        const figurine = await product();
        const store = await shop(elsewhere, elsewhere.regions[0]);
        await shopItems.setAvailability({
          userId: HARVESTER,
          supermarketLocationId: store,
          sourceKind: PriceSourceKind.OFFICIAL_WEB,
          sourceRunId: RUN,
          entries: [{ itemId: figurine, available: true }],
        });

        const result = await withdrawOffers(figurine, of);

        expect(result.shopRowsRemoved).toBe(0);
        expect(
          await dataSource
            .getRepository(SupermarketLocationItem)
            .findBy({ itemId: figurine })
        ).toHaveLength(1);
        expect(await shown(figurine, elsewhere.regions[0])).not.toBeNull();
      }, 60_000);
    });

    it('refuses a scope of another chain, and removes nothing', async () => {
      const of = await chain();
      const elsewhere = await chain();
      const figurine = await product();
      await offers.setAvailability({
        userId: HARVESTER,
        priceScopeId: of.national,
        entries: [{ itemId: figurine, available: true }],
      });

      await expect(
        withdrawOffers(figurine, of, {
          priceScopeIds: [of.national, elsewhere.national],
        })
      ).rejects.toBeInstanceOf(ValidationException);

      expect(await offerRows(figurine)).toHaveLength(1);
    }, 60_000);
  }
);
