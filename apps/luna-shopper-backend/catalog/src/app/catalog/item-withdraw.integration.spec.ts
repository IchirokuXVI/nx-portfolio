import {
  PriceScopeKind,
  PriceSourceKind,
  UnitOfMeasure,
  type AdminCredential,
  type HeldItemPrice,
  type ItemPriceDetails,
  type StatedItemPrice,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
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
  ItemPriceDetailsRow,
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
/** A leaflet an operator uploaded. */
const LEAFLET_RUN = '19100000-0000-4000-a000-0000000000a3';

const WEB = PriceSourceKind.OFFICIAL_WEB;
const LEAFLET = PriceSourceKind.OFFICIAL_LEAFLET;

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
      over: {
        observedAt?: Date;
        runId?: string;
        kind?: PriceSourceKind;
        validUntil?: Date;
        details?: ItemPriceDetails;
      } = {}
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
            validUntil: over.validUntil?.toISOString() ?? null,
            details: over.details ?? null,
          },
        ],
      });
    }

    /** A price row a bound row holds: a scope and kind it accounts for. */
    const holds = (
      priceScopeId: string,
      over: { kind?: PriceSourceKind | null; runId?: string | null } = {}
    ): HeldItemPrice => ({
      priceScopeId,
      sourceKind: over.kind === undefined ? WEB : over.kind,
      sourceRunId: over.runId === undefined ? RUN : over.runId,
    });

    /** The one price the bound rows state at a scope and kind. */
    const states = (
      priceScopeId: string,
      price: number,
      over: { kind?: PriceSourceKind; runId?: string; observedAt?: Date } = {}
    ): StatedItemPrice => ({
      priceScopeId,
      sourceKind: over.kind ?? WEB,
      sourceRunId: over.runId ?? RUN,
      copiedFromScopeId: null,
      price: {
        price,
        currency: 'EUR',
        observedAt: (over.observedAt ?? MONDAY).toISOString(),
      },
    });

    /** Everything a settle could change for a product, to compare twice. */
    async function everything(itemId: string) {
      const rows = await priceRows(itemId);
      const offered = await offerRows(itemId);
      return {
        prices: rows.map((row) => ({ ...row })),
        offers: offered
          .map((row) => ({ ...row }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        details: await dataSource.getRepository(ItemPriceDetailsRow).count(),
        trail: await dataSource.getRepository(CatalogAudit).count(),
      };
    }

    const priceRows = (itemId: string) =>
      dataSource.getRepository(ItemPrice).find({
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
          inserted: 0,
          confirmed: 0,
          keptAsWritten: [],
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
          inserted: 0,
          confirmed: 0,
          keptAsWritten: [],
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

    describe('what a bound row accounts for is kept', () => {
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

      it('removes only the row that contradicts the statement, and keeps the stated row and the history', async () => {
        const { of, itemId } = await burger();
        const before = await priceRows(itemId);
        expect(before.map((row) => Number(row.price))).toEqual([
          2.3, 2.45, 2.95,
        ]);

        const withdrawn = await withdrawPrices(itemId, of, {
          held: [holds(of.national)],
          stated: [states(of.national, 2.45)],
        });

        // The 2.95 of the row that left goes. The 2.45 already says what is
        // stated, so it is not removed and nothing is written.
        expect(withdrawn).toMatchObject({
          deleted: 1,
          inserted: 0,
          confirmed: 0,
          keptAsWritten: [],
        });
        const after = await priceRows(itemId);
        expect(after.map((row) => Number(row.price))).toEqual([2.3, 2.45]);
        // The same rows, not new ones: no id changed.
        expect(after.map((row) => row.id)).toEqual(
          before.slice(0, 2).map((row) => row.id)
        );
        // And it is the current one in every scope, whatever the ids were.
        expect(
          (await offerRows(itemId)).map((row) => Number(row.price))
        ).toEqual([2.45, 2.45, 2.45, 2.45]);
      }, 60_000);

      it('changes no row, no id and no trail row when it is run a second time', async () => {
        const { of, itemId } = await burger();
        const request = {
          held: [holds(of.national)],
          stated: [states(of.national, 2.45)],
        };
        await withdrawPrices(itemId, of, request);
        const settled = await everything(itemId);

        const dry = await withdrawPrices(itemId, of, {
          ...request,
          dryRun: true,
        });
        const again = await withdrawPrices(itemId, of, request);

        const nothing = {
          deleted: 0,
          removed: [],
          inserted: 0,
          confirmed: 0,
          keptAsWritten: [],
          recomputed: 0,
        };
        // A dry run on a settled product reports nothing to do.
        expect(dry).toEqual(nothing);
        expect(again).toEqual(nothing);
        expect(await everything(itemId)).toEqual(settled);
      }, 60_000);

      it('writes the stated price in the same call when catalog does not hold it, and then holds still', async () => {
        const of = await chain();
        const itemId = await product();
        await runPrice(itemId, of.national, 2.3, {
          observedAt: SUNDAY,
          runId: OLDER_RUN,
        });
        // Only the row that left wrote in this run.
        await runPrice(itemId, of.national, 2.95);
        const request = {
          held: [holds(of.national)],
          stated: [states(of.national, 2.45)],
        };

        const withdrawn = await withdrawPrices(itemId, of, request);

        expect(withdrawn).toMatchObject({ deleted: 1, inserted: 1 });
        const rows = await priceRows(itemId);
        expect(rows.map((row) => Number(row.price))).toEqual([2.3, 2.45]);
        // Written with the run and the instant of the statement.
        expect(rows[1]).toMatchObject({
          sourceKind: WEB,
          sourceRunId: RUN,
          observedAt: MONDAY,
        });
        expect(
          (await offerRows(itemId)).map((row) => Number(row.price))
        ).toEqual([2.45, 2.45, 2.45, 2.45]);
        // Audited as any insert is.
        expect(await trail(rows[1].id)).toEqual([
          expect.objectContaining({
            action: AuditAction.CREATE,
            actorKind: AuditActorKind.SERVICE,
          }),
        ]);

        const settled = await everything(itemId);
        expect(await withdrawPrices(itemId, of, request)).toMatchObject({
          deleted: 0,
          inserted: 0,
          confirmed: 0,
        });
        expect(await everything(itemId)).toEqual(settled);
      }, 60_000);

      it('undoes the removal too when the write of the statement fails', async () => {
        const { of, itemId } = await burger();
        const before = await everything(itemId);

        // A copy of a scope of another chain is refused by the write, which
        // comes after the removal in the one transaction.
        const elsewhere = await chain();
        await expect(
          withdrawPrices(itemId, of, {
            held: [holds(of.national)],
            stated: [
              {
                ...states(of.national, 2.45),
                copiedFromScopeId: elsewhere.national,
              },
            ],
          })
        ).rejects.toBeInstanceOf(ValidationException);

        // Nothing went: the product never shows an older price because the
        // second half of a settle failed.
        expect(await everything(itemId)).toEqual(before);
      }, 60_000);

      it('removes nothing where the bound rows hold a price and state none, so the price that was current stays', async () => {
        const { of, itemId } = await burger();
        const before = await shown(itemId, of.national);

        const withdrawn = await withdrawPrices(itemId, of, {
          held: [holds(of.national)],
        });

        expect(withdrawn.deleted).toBe(0);
        expect(await priceRows(itemId)).toHaveLength(3);
        expect((await shown(itemId, of.national))?.itemPriceId).toBe(
          before?.itemPriceId
        );
      }, 60_000);

      it('keeps the history of a leaflet that ended, with its page and its text', async () => {
        const of = await chain();
        const itemId = await product();
        await runPrice(itemId, of.national, 1.99, {
          kind: LEAFLET,
          runId: LEAFLET_RUN,
          observedAt: SUNDAY,
          validUntil: new Date(MONDAY.getTime() + 60 * 60 * 1000),
          details: {
            offerId: 'p3-o7',
            page: 3,
            rawText: ['Leche entera', '1,99 €'],
            promotion: null,
            loyalty: null,
          },
        });
        const [row] = await priceRows(itemId);
        const details = dataSource.getRepository(ItemPriceDetailsRow);
        expect(await details.countBy({ itemPriceId: row.id })).toBe(1);

        // The window is closed, so the bound row states nothing. It still
        // holds the price row, and that is what keeps the history.
        const withdrawn = await withdrawPrices(itemId, of, {
          held: [holds(of.national, { kind: LEAFLET, runId: LEAFLET_RUN })],
        });

        expect(withdrawn.deleted).toBe(0);
        expect((await priceRows(itemId)).map((each) => each.id)).toEqual([
          row.id,
        ]);
        expect(await details.countBy({ itemPriceId: row.id })).toBe(1);
      }, 60_000);

      it('spares only the scope and kind that is held', async () => {
        const of = await chain();
        const itemId = await product();
        const [north] = of.regions;
        await runPrice(itemId, of.national, 2.45, { observedAt: SUNDAY });
        await runPrice(itemId, north, 2.6, { runId: OLDER_RUN });
        await runPrice(itemId, of.national, 1.99, {
          kind: LEAFLET,
          runId: LEAFLET_RUN,
        });

        const withdrawn = await withdrawPrices(itemId, of, {
          held: [holds(of.national)],
        });

        expect(
          withdrawn.removed
            .map((each) => `${each.priceScopeId}|${each.sourceKind}`)
            .sort()
        ).toEqual([`${north}|${WEB}`, `${of.national}|${LEAFLET}`].sort());
        expect(
          (await priceRows(itemId)).map((row) => Number(row.price))
        ).toEqual([2.45]);
      }, 60_000);

      it('spares every kind at a scope where a held price has no kind', async () => {
        const of = await chain();
        const itemId = await product();
        const [north] = of.regions;
        await runPrice(itemId, of.national, 2.45);
        await runPrice(itemId, of.national, 1.99, {
          kind: LEAFLET,
          runId: LEAFLET_RUN,
        });
        await runPrice(itemId, north, 2.6, { runId: OLDER_RUN });

        // The run of the bound price cannot be read, so its kind is unknown.
        const withdrawn = await withdrawPrices(itemId, of, {
          held: [holds(of.national, { kind: null, runId: null })],
          // A statement at such a scope is not applied either.
          stated: [states(of.national, 9.99)],
        });

        expect(withdrawn).toMatchObject({ deleted: 1, inserted: 0 });
        expect(withdrawn.removed).toEqual([
          { priceScopeId: north, sourceKind: WEB, deleted: 1 },
        ]);
        expect(
          (await priceRows(itemId)).map((row) => Number(row.price)).sort()
        ).toEqual([1.99, 2.45]);
      }, 60_000);
    });

    describe('a price keeps the kind it was written with', () => {
      it('keeps a leaflet price that a bound row holds, whatever its row says its kind is today', async () => {
        // The six Deza rows of slot 1: a leaflet run wrote the price, the
        // product holds it as OFFICIAL_LEAFLET, and a website walk has since
        // rewritten the kind of the shared row.
        const of = await chain();
        const itemId = await product();
        await runPrice(itemId, of.national, 1.99, {
          kind: LEAFLET,
          runId: LEAFLET_RUN,
        });
        const before = await everything(itemId);

        // The harvester reads the kind from the run, so this is what it
        // sends. Read from the row it would have said OFFICIAL_WEB, the
        // leaflet pair would be unaccounted for, and the row would go.
        const withdrawn = await withdrawPrices(itemId, of, {
          held: [holds(of.national, { kind: LEAFLET, runId: LEAFLET_RUN })],
          stated: [
            states(of.national, 1.99, { kind: LEAFLET, runId: LEAFLET_RUN }),
          ],
        });

        expect(withdrawn).toMatchObject({
          deleted: 0,
          inserted: 0,
          confirmed: 0,
          keptAsWritten: [],
        });
        expect(await everything(itemId)).toEqual(before);
      }, 60_000);

      it('does not state under its own kind a price catalog holds for that run under another', async () => {
        // An accept wrote a leaflet price while its row said OFFICIAL_WEB
        // (plan 0190): the kind of the row, the run of the leaflet.
        const of = await chain();
        const itemId = await product();
        await runPrice(itemId, of.national, 1.99, {
          kind: WEB,
          runId: LEAFLET_RUN,
        });
        const before = await everything(itemId);

        const withdrawn = await withdrawPrices(itemId, of, {
          held: [holds(of.national, { kind: LEAFLET, runId: LEAFLET_RUN })],
          stated: [
            states(of.national, 1.99, { kind: LEAFLET, runId: LEAFLET_RUN }),
          ],
        });

        // Not removed as a website price nobody states, and not written a
        // second time as a leaflet price.
        expect(withdrawn).toMatchObject({
          deleted: 0,
          inserted: 0,
          keptAsWritten: [
            { priceScopeId: of.national, sourceKind: LEAFLET, heldAs: WEB },
          ],
        });
        expect(await everything(itemId)).toEqual(before);
      }, 60_000);

      it('keeps a row of another run that a bound row names, when a statement is applied beside it', async () => {
        const of = await chain();
        const itemId = await product();
        // A bound row's website price, and a leaflet price a second bound
        // row holds, written under the website kind by an accept.
        await runPrice(itemId, of.national, 2.45, { observedAt: SUNDAY });
        await runPrice(itemId, of.national, 1.99, {
          kind: WEB,
          runId: LEAFLET_RUN,
        });

        const withdrawn = await withdrawPrices(itemId, of, {
          held: [
            holds(of.national),
            holds(of.national, { kind: LEAFLET, runId: LEAFLET_RUN }),
          ],
          stated: [states(of.national, 2.45, { observedAt: SUNDAY })],
        });

        // The 1.99 is newer than the statement and differs from it, and it
        // stays: the run a bound row names wrote it.
        expect(withdrawn.deleted).toBe(0);
        expect(
          (await priceRows(itemId)).map((row) => Number(row.price)).sort()
        ).toEqual([1.99, 2.45]);
      }, 60_000);
    });

    describe('who may send the two messages', () => {
      it('refuses an operator, because only the harvester knows which rows are bound', async () => {
        const of = await chain();
        const figurine = await product();
        await runPrice(figurine, of.national, 4.99);

        await expect(
          withdrawPrices(figurine, of, { userId: PERSON })
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          withdrawOffers(figurine, of, { userId: PERSON })
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(await priceRows(figurine)).toHaveLength(1);
        expect(await offerRows(figurine)).toHaveLength(4);
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

    describe('an offer the trail cannot speak for', () => {
      it('keeps every offer that is older than the trail, as a catalog restored without its audit rows has them', async () => {
        const of = await chain();
        const figurine = await product();
        await runPrice(figurine, of.national, 4.99);
        // The restore: the rows are there and the trail is not. Whether an
        // operator typed one of these offers can no longer be read.
        await dataSource.query(`DELETE FROM "catalog_audit"`);

        await withdrawPrices(figurine, of);
        // The withdraw above wrote to the trail. That does not make the
        // trail speak for offers that are older than its first row.
        expect(
          await dataSource.getRepository(CatalogAudit).count()
        ).toBeGreaterThan(0);
        const result = await withdrawOffers(figurine, of);

        expect(result.offersRemoved).toEqual([]);
        expect(result.offersKept.map((kept) => kept.reason)).toEqual([
          'NO_TRAIL',
          'NO_TRAIL',
          'NO_TRAIL',
          'NO_TRAIL',
        ]);
        expect(await offerRows(figurine)).toHaveLength(4);
      }, 60_000);

      it('still removes an offer that was made after the trail began', async () => {
        const of = await chain();
        const figurine = await product();
        await runPrice(figurine, of.national, 4.99);

        await withdrawPrices(figurine, of);
        const result = await withdrawOffers(figurine, of);

        expect([...result.offersRemoved].sort()).toEqual([...of.scopes].sort());
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
