import type { ConfigService } from '@nestjs/config';
import type { ClientProxy } from '@nestjs/microservices';
import {
  ITEM_PATTERNS,
  ITEM_PRICE_PATTERNS,
  PRICE_SCOPE_PATTERNS,
  PriceScopeKind,
  PriceSourceKind,
  SourceEntryStatus,
  SUPERMARKET_ITEM_PATTERNS,
  SUPERMARKET_PATTERNS,
  UnitOfMeasure,
  type AdminCredential,
  type ItemPriceDetails,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defer, from } from 'rxjs';
import { DataSource, type Repository } from 'typeorm';
// The other half of the proof is catalog's own code, run in this process
// against catalog's own database. Catalog is an application and exports no
// library, so there is no alias to import it through. Only this spec reaches
// across, and no file the harvester ships does.
/* eslint-disable @nx/enforce-module-boundaries */
import { CatalogAuditService } from '../../../../catalog/src/app/catalog/catalog-audit.service';
import { EffectivePriceService } from '../../../../catalog/src/app/catalog/effective-price.service';
import { ItemPriceService } from '../../../../catalog/src/app/catalog/item-price.service';
import { LocationScopeService } from '../../../../catalog/src/app/catalog/location-scopes';
import type {
  CatalogActor,
  PlatformAdminService as CatalogGate,
} from '../../../../catalog/src/app/catalog/platform-admin.service';
import { SupermarketItemService } from '../../../../catalog/src/app/catalog/supermarket-item.service';
import { CATALOG_MIGRATIONS } from '../../../../catalog/src/app/db/migrations';
import {
  CATALOG_ENTITIES,
  CatalogAudit,
  Item,
  ItemPrice,
  ItemPriceDetailsRow,
  PriceScope,
  Supermarket,
  SupermarketItem,
  SupermarketLocation,
} from '../../../../catalog/src/app/entities';
/* eslint-enable @nx/enforce-module-boundaries */
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  SourceCatalogEntry,
  SourceEntryAvailability,
  SourceEntryPrice,
  SupermarketSource,
} from '../entities';
import { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
import { SourceEntryAvailabilityWriter } from './source-entry-availability';
import { SourceEntrySettler } from './source-entry-settle';
import { SourceEntryPriceWriter } from './source-entry-write';
import { SourceEntryService } from './source-entry.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * The settle, end to end: the harvester's real services over the harvester's
 * database, and catalog's real services over catalog's database (plan 0191).
 *
 * The two halves are each proved alone, with the other one a recorder:
 * `source-entry-settle.integration.spec.ts` here and
 * `item-withdraw.integration.spec.ts` in catalog. A recorder proves that a
 * message was sent, and not that the two halves mean the same thing by it.
 * The review of the plan found five ways in which they did not, and each one
 * deleted a price row a bound row still stood behind. So this runs the whole
 * path, and asserts on the rows of both databases.
 *
 * **What is real.** `SourceEntryService`, `SourceEntrySettler`, the price and
 * availability writers and `CatalogClient` on one side. `ItemPriceService`
 * and `SupermarketItemService` on the other, over a schema this spec migrates
 * with catalog's own migrations. The two SQL databases.
 *
 * **What is not.** NATS. `CatalogClient` builds each message as it does in
 * production and hands it to a `ClientProxy` that calls catalog's service for
 * that pattern in this process. So the payload is the real one, and the
 * transport and the JSON schema check on it are not exercised here.
 *
 * It needs both databases:
 *
 *   LUNA_INTEGRATION=1 \
 *   HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *   CATALOG_DB_URL=postgres://luna_catalog:luna_catalog@localhost:<port>/luna_catalog \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *       --testFile=settle-across-services.integration.spec.ts
 *
 * `CATALOG_DB_URL` is read from catalog's own `.env` when it is not exported,
 * which is where the slot script writes it and where CI finds it.
 */
const SCHEMA = 'plan0191_settle_across_services';

/** The harvester, as catalog knows it. */
const HARVESTER = '19100000-0000-4000-b000-000000000001';
const OPERATOR = 'owner-1';

/** A walk of the chain's website this week, and one a month ago. */
const WALK = '19100000-0000-4000-b000-0000000000a1';
const OLD_WALK = '19100000-0000-4000-b000-0000000000a2';
/** A walk in between, whose row has left the product. */
const MID_WALK = '19100000-0000-4000-b000-0000000000a3';
/** A leaflet an operator uploaded. */
const LEAFLET = '19100000-0000-4000-b000-0000000000a4';
const RUNS = [WALK, OLD_WALK, MID_WALK, LEAFLET];

const DAY = 24 * 60 * 60 * 1000;
/** Recent, so no price here is out of date, and never in the future. */
const MONDAY = new Date(Date.now() - 2 * DAY);
const LAST_WEEK = new Date(Date.now() - 9 * DAY);
const LAST_MONTH = new Date(Date.now() - 30 * DAY);

const WEB = PriceSourceKind.OFFICIAL_WEB;
const LEAFLET_KIND = PriceSourceKind.OFFICIAL_LEAFLET;

/** Catalog's database, from the environment or from catalog's own `.env`. */
function catalogDbUrl(): string {
  const exported = process.env['CATALOG_DB_URL'];
  if (exported) {
    return exported;
  }
  const file = join(__dirname, '../../../../catalog/.env');
  const line = existsSync(file)
    ? /^CATALOG_DB_URL=(.+)$/m.exec(readFileSync(file, 'utf8'))
    : null;
  if (!line) {
    throw new Error(
      'CATALOG_DB_URL is not set and apps/luna-shopper-backend/catalog/.env ' +
        'does not state it. This spec runs catalog against its own database: ' +
        'run the slot script, or export the variable.'
    );
  }
  return line[1].trim();
}

describeIntegration(
  'settling a product at a chain, across the harvester and catalog (real Postgres)',
  () => {
    let harvester: DataSource;
    let catalog: DataSource;
    let entries: Repository<SourceCatalogEntry>;
    let service: SourceEntryService;
    let client: CatalogClient;

    /** The chain, in both databases: catalog's id is the harvester's key. */
    let chain: string;
    let national: string;
    let regions: string[];
    let scopes: string[];

    /** Set by a test to make catalog refuse the next price batch. */
    let failNextPriceBatch: Error | null = null;

    beforeAll(async () => {
      // --- catalog: a schema of its own, migrated by catalog's migrations ---
      const url = catalogDbUrl();
      const bootstrap = new DataSource({ type: 'postgres', url });
      await bootstrap.initialize();
      await bootstrap.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await bootstrap.query(`CREATE SCHEMA "${SCHEMA}"`);
      await bootstrap.destroy();
      catalog = new DataSource({
        type: 'postgres',
        url,
        schema: SCHEMA,
        entities: CATALOG_ENTITIES,
        migrations: CATALOG_MIGRATIONS,
        synchronize: false,
        extra: { options: `-c search_path=${SCHEMA},public` },
      });
      await catalog.initialize();
      await catalog.runMigrations();

      // The gate answers who wrote. Only the harvester's uuid is a service,
      // and anything else is refused, so a message the harvester sent under
      // another identity would fail here as it would in a cluster.
      const gate = {
        requireAdmin: async (
          credential: AdminCredential
        ): Promise<CatalogActor> => {
          if (credential.userId !== HARVESTER || credential.adminToken) {
            throw new ForbiddenException('not the harvester');
          }
          return { kind: 'service', actorId: HARVESTER };
        },
      } as unknown as CatalogGate;
      const audit = new CatalogAuditService(catalog);
      const prices = new ItemPriceService(
        catalog.getRepository(ItemPrice),
        catalog.getRepository(Item),
        catalog.getRepository(PriceScope),
        gate,
        audit,
        new EffectivePriceService()
      );
      const offers = new SupermarketItemService(
        catalog.getRepository(SupermarketItem),
        catalog.getRepository(Item),
        catalog.getRepository(PriceScope),
        catalog.getRepository(SupermarketLocation),
        gate,
        audit,
        new LocationScopeService()
      );

      // The chain of the plan: a default scope, and three that fall through.
      const supermarkets = catalog.getRepository(Supermarket);
      const row = await supermarkets.save(
        supermarkets.create({ name: { en: 'Chain', es: 'Cadena' } })
      );
      const scopeRepo = catalog.getRepository(PriceScope);
      const scope = async (kind: PriceScopeKind, externalKey: string | null) =>
        (
          await scopeRepo.save(
            scopeRepo.create({ supermarketId: row.id, kind, externalKey })
          )
        ).id;
      national = await scope(PriceScopeKind.NATIONAL, null);
      regions = [
        await scope(PriceScopeKind.REGION, 'north'),
        await scope(PriceScopeKind.REGION, 'centre'),
        await scope(PriceScopeKind.REGION, 'south'),
      ];
      scopes = [national, ...regions];
      row.defaultPriceScopeId = national;
      await supermarkets.save(row);
      chain = row.id;

      // --- the wire: the real client, and catalog's services behind it ------
      type Handler = (payload: never) => Promise<unknown>;
      const handlers: Record<string, Handler> = {
        [PRICE_SCOPE_PATTERNS.list]: async (payload: {
          supermarketId: string;
        }) => ({
          items: await scopeRepo.find({
            where: { supermarketId: payload.supermarketId },
            order: { priority: 'ASC', id: 'ASC' },
          }),
          nextCursor: null,
        }),
        [SUPERMARKET_PATTERNS.get]: async (payload: {
          supermarketId: string;
        }) => supermarkets.findOneByOrFail({ id: payload.supermarketId }),
        [ITEM_PATTERNS.findByEan]: async () => ({ item: null }),
        [ITEM_PRICE_PATTERNS.addBatch]: async (payload) => {
          if (failNextPriceBatch) {
            const failure = failNextPriceBatch;
            failNextPriceBatch = null;
            throw failure;
          }
          return prices.addBatch(payload);
        },
        [ITEM_PRICE_PATTERNS.withdraw]: (payload) => prices.withdraw(payload),
        [SUPERMARKET_ITEM_PATTERNS.withdraw]: (payload) =>
          offers.withdraw(payload),
        [SUPERMARKET_ITEM_PATTERNS.setAvailability]: (payload) =>
          offers.setAvailability(payload),
      };
      const wire = {
        send: (pattern: string, record: { data: never }) =>
          defer(() => {
            const handler = handlers[pattern];
            if (!handler) {
              throw new Error(`This spec serves no ${pattern}.`);
            }
            return from(handler(record.data));
          }),
      } as unknown as ClientProxy;
      client = new CatalogClient(wire, {
        getOrThrow: () => ({ actorId: HARVESTER }),
      } as unknown as ConfigService);

      // --- the harvester -----------------------------------------------------
      harvester = new DataSource({
        type: 'postgres',
        url: requiredEnv('HARVESTER_DB_URL'),
        entities: HARVESTER_ENTITIES,
        synchronize: false,
      });
      await harvester.initialize();
      entries = harvester.getRepository(SourceCatalogEntry);
      await cleanRuns();
      // The runs the prices name. A walk takes its kind from the chain's
      // adapter, and a file import from the stamp in its input.
      await harvester.query(
        `INSERT INTO "harvest_runs"
                ("id", "supermarketId", "mode", "status", "input")
         VALUES ($1, $5, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb),
                ($2, $5, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb),
                ($3, $5, 'CATALOG_DISCOVERY', 'COMPLETED', '{}'::jsonb),
                ($4, $5, 'FILE_IMPORT', 'COMPLETED',
                 '{"sourceKind":"OFFICIAL_LEAFLET"}'::jsonb)`,
        [...RUNS, chain]
      );
      await harvester.query(
        `INSERT INTO "supermarket_sources" ("supermarketId", "adapterKey")
         VALUES ($1, 'deza-web')`,
        [chain]
      );

      const writer = new SourceEntryPriceWriter(client, entries);
      service = new SourceEntryService(
        entries,
        harvester.getRepository(SourceEntryPrice),
        harvester.getRepository(HarvestRun),
        client,
        // An accept and a reject read no source row of the chain.
        {} as unknown as SupermarketSourceService,
        {
          requireAdmin: async () => OPERATOR,
        } as unknown as PlatformAdminService,
        writer,
        {} as unknown as ConfigService,
        new SourceEntryAvailabilityWriter(
          harvester.getRepository(SourceEntryAvailability),
          client
        ),
        new SourceEntrySettler(
          entries,
          harvester.getRepository(HarvestRun),
          harvester.getRepository(SupermarketSource),
          client
        )
      );
    }, 240_000);

    afterAll(async () => {
      if (harvester?.isInitialized) {
        await harvester.query(
          `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
          [chain]
        );
        await cleanRuns();
        await harvester.destroy();
      }
      if (catalog?.isInitialized) {
        await catalog.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await catalog.destroy();
      }
    });

    beforeEach(() => {
      failNextPriceBatch = null;
    });

    async function cleanRuns() {
      await harvester.query(
        `DELETE FROM "harvest_runs" WHERE "id" = ANY($1::uuid[])`,
        [RUNS]
      );
      if (chain) {
        await harvester.query(
          `DELETE FROM "supermarket_sources" WHERE "supermarketId" = $1`,
          [chain]
        );
      }
    }

    let seq = 0;

    /** A product of the catalog. */
    async function product(): Promise<string> {
      seq += 1;
      const items = catalog.getRepository(Item);
      return (
        await items.save(
          items.create({
            name: { es: `Producto ${seq}` },
            defaultUnit: UnitOfMeasure.UNIT,
          })
        )
      ).id;
    }

    interface Stated {
      price: number;
      runId?: string;
      observedAt?: Date;
      validUntil?: Date;
      priceScopeId?: string;
      details?: Record<string, unknown>;
    }

    /**
     * A row of the chain that is bound to a product, with the prices it
     * holds. `sourceKind` is what the row says today, which is not always the
     * kind its prices were observed as.
     */
    async function boundRow(
      itemId: string,
      prices: Stated[],
      over: { sourceKind?: PriceSourceKind; decidedAt?: Date } = {}
    ): Promise<string> {
      seq += 1;
      const [inserted] = await harvester.query(
        `INSERT INTO "source_catalog_entries"
                ("supermarketId", "externalId", "sourceKind", "name",
                 "itemId", "status", "matchedBy", "decidedAt")
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'MANUAL', $6)
         RETURNING "id"`,
        [
          chain,
          `plan0191-across-${Date.now()}-${seq}`,
          over.sourceKind ?? WEB,
          `Artículo ${seq}`,
          itemId,
          over.decidedAt ?? new Date(Date.now() - 20 * DAY + seq * 1000),
        ]
      );
      for (const each of prices) {
        await harvester.query(
          `INSERT INTO "source_entry_prices"
                  ("entryId", "priceScopeId", "price", "currency",
                   "observedAt", "runId", "validUntil", "details")
           VALUES ($1, $2, $3, 'EUR', $4, $5, $6, $7)`,
          [
            inserted.id,
            each.priceScopeId ?? national,
            each.price,
            each.observedAt ?? MONDAY,
            each.runId ?? WALK,
            each.validUntil ?? null,
            each.details ? JSON.stringify(each.details) : null,
          ]
        );
      }
      return inserted.id as string;
    }

    /** A price in catalog, written as a run writes one: through the client. */
    function wrote(
      itemId: string,
      each: Stated & {
        kind?: PriceSourceKind;
        catalogDetails?: ItemPriceDetails;
      }
    ) {
      return client.addPrices(
        each.priceScopeId ?? national,
        [
          {
            itemId,
            price: each.price,
            currency: 'EUR',
            observedAt: (each.observedAt ?? MONDAY).toISOString(),
            validUntil: each.validUntil?.toISOString() ?? null,
            details: each.catalogDetails ?? null,
          },
        ],
        each.runId ?? WALK,
        each.kind ?? WEB
      );
    }

    const priceRows = (itemId: string) =>
      catalog.getRepository(ItemPrice).find({
        where: { itemId },
        order: { observedAt: 'ASC', price: 'ASC' },
      });

    const offerRows = (itemId: string) =>
      catalog.getRepository(SupermarketItem).findBy({ itemId });

    const amounts = async (itemId: string) =>
      (await priceRows(itemId)).map((row) => Number(row.price));

    const shown = async (itemId: string) =>
      (await offerRows(itemId))
        .map((row) => (row.price === null ? null : Number(row.price)))
        .sort();

    /** Everything a settle could change in catalog for a product. */
    async function everything(itemId: string) {
      const rows = await priceRows(itemId);
      return {
        prices: rows.map((row) => ({ ...row })),
        offers: (await offerRows(itemId))
          .map((row) => ({ ...row }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        details: await catalog
          .getRepository(ItemPriceDetailsRow)
          .count({ where: rows.map((row) => ({ itemPriceId: row.id })) }),
        // The whole trail of the schema: a settle that records anything at
        // all, about any row, moves this number.
        trail: await catalog.getRepository(CatalogAudit).count(),
      };
    }

    const settle = (itemId: string, dryRun = false) =>
      service.settleItem({
        userId: OPERATOR,
        itemId,
        supermarketId: chain,
        dryRun,
      });

    /** What a settle answers when there is nothing to do. */
    const NOTHING = {
      pricesWithdrawn: 0,
      pricesWithdrawnAt: [],
      pricesWritten: 0,
      pricesKeptAsWritten: [],
      pricesWithheld: [],
      offersRemoved: [],
      shopRowsRemoved: 0,
      shopRowsCleared: 0,
    };

    it('settle, state again, settle again: the second call changes no row, no id and no trail row', async () => {
      // The El Pozo burger. Two rows of the chain were bound to one product
      // and one walk priced both, so catalog holds both amounts with one
      // instant. A person then moves the dearer row to its own product.
      const burger = await product();
      const king = await product();
      await wrote(burger, {
        price: 2.3,
        runId: OLD_WALK,
        observedAt: LAST_MONTH,
      });
      await wrote(burger, { price: 2.45 });
      await wrote(burger, { price: 2.95 });
      const staying = await boundRow(burger, [{ price: 2.45 }]);
      const leaving = await boundRow(burger, [{ price: 2.95 }]);
      const stayedAs = (await priceRows(burger)).find(
        (row) => Number(row.price) === 2.45
      );

      const moved = await service.accept({
        userId: OPERATOR,
        entryId: leaving,
        itemId: king,
      });

      // The row took its price with it. The old product holds the history
      // and the price of the row that stayed, as the row it always was.
      expect(moved.settled).toMatchObject({
        boundEntryIds: [staying],
        pricesWithdrawn: 1,
        pricesRestated: 1,
        pricesWritten: 0,
      });
      expect(await amounts(burger)).toEqual([2.3, 2.45]);
      expect(
        (await priceRows(burger)).find((row) => Number(row.price) === 2.45)?.id
      ).toBe(stayedAs?.id);
      expect(await shown(burger)).toEqual([2.45, 2.45, 2.45, 2.45]);
      expect(await amounts(king)).toEqual([2.95]);

      const settled = await everything(burger);

      // A dry run of a settled product reports nothing to do.
      expect(await settle(burger, true)).toMatchObject({
        ...NOTHING,
        dryRun: true,
        pricesRestated: 1,
      });
      // And a real second call does nothing.
      expect(await settle(burger)).toMatchObject({
        ...NOTHING,
        pricesRestated: 1,
      });
      expect(await settle(burger)).toMatchObject(NOTHING);
      expect(await everything(burger)).toEqual(settled);
    }, 120_000);

    it('the figurine: the old product holds no price and no offer in any scope, and the new one holds the price', async () => {
      const wrong = await product();
      const right = await product();
      await wrote(wrong, { price: 4.99 });
      const figurine = await boundRow(wrong, [{ price: 4.99 }]);
      expect(await shown(wrong)).toEqual([4.99, 4.99, 4.99, 4.99]);

      const moved = await service.accept({
        userId: OPERATOR,
        entryId: figurine,
        itemId: right,
      });

      expect(moved.pricesWritten).toBe(1);
      expect(moved.settled?.pricesWithdrawn).toBe(1);
      expect([...(moved.settled?.offersRemoved ?? [])].sort()).toEqual(
        [...scopes].sort()
      );
      expect(await priceRows(wrong)).toEqual([]);
      expect(await offerRows(wrong)).toEqual([]);
      expect(await amounts(right)).toEqual([4.99]);
      expect(await shown(right)).toEqual([4.99, 4.99, 4.99, 4.99]);

      // The route for a person, afterwards: nothing left to do.
      expect(await settle(wrong)).toMatchObject({
        ...NOTHING,
        boundEntryIds: [],
        pricesRestated: 0,
      });
    }, 120_000);

    it('keeps a leaflet price whose row changed kind after the price was written', async () => {
      // One shared row for a website listing and a leaflet offer (plan
      // 0190). The leaflet wrote the price, and catalog holds it as a
      // leaflet price. A website walk has touched the row since, so the row
      // says OFFICIAL_WEB. Slot 1 holds six such rows.
      const milk = await product();
      await wrote(milk, {
        price: 1.99,
        runId: LEAFLET,
        kind: LEAFLET_KIND,
        observedAt: LAST_WEEK,
      });
      await boundRow(
        milk,
        [{ price: 1.99, runId: LEAFLET, observedAt: LAST_WEEK }],
        { sourceKind: WEB }
      );
      const before = await everything(milk);
      expect(before.prices).toHaveLength(1);

      const result = await settle(milk);

      // Read from the row, the kind would be OFFICIAL_WEB: nothing would
      // account for the leaflet row, it would be deleted, and its price
      // written again as a website price with the leaflet's run.
      expect(result).toMatchObject({ ...NOTHING, pricesRestated: 1 });
      expect(await everything(milk)).toEqual(before);
      expect(before.prices[0]).toMatchObject({
        sourceKind: LEAFLET_KIND,
        sourceRunId: LEAFLET,
      });
    }, 120_000);

    it('keeps a price an accept wrote under the kind of its row, and does not write it a second time', async () => {
      // The other order (plan 0190): the row already said OFFICIAL_WEB when
      // a person accepted it, so the leaflet price went to catalog as a
      // website price, with the leaflet's run.
      const milk = await product();
      await wrote(milk, {
        price: 1.99,
        runId: LEAFLET,
        kind: WEB,
        observedAt: LAST_WEEK,
      });
      await boundRow(
        milk,
        [{ price: 1.99, runId: LEAFLET, observedAt: LAST_WEEK }],
        { sourceKind: WEB }
      );
      const before = await everything(milk);

      const result = await settle(milk);

      expect(result.pricesWithdrawn).toBe(0);
      expect(result.pricesWritten).toBe(0);
      expect(result.pricesKeptAsWritten).toEqual([
        { priceScopeId: national, sourceKind: LEAFLET_KIND, heldAs: WEB },
      ]);
      expect(await everything(milk)).toEqual(before);
    }, 120_000);

    it('states the newest observation when two bound rows agree, and keeps the history between them', async () => {
      // A row the chain stopped listing keeps its last price, from a month
      // ago. The live row states the same amount today. Between the two the
      // product showed another amount, from a row that has left since.
      const cheese = await product();
      await wrote(cheese, {
        price: 2.45,
        runId: OLD_WALK,
        observedAt: LAST_MONTH,
      });
      await wrote(cheese, {
        price: 2.6,
        runId: MID_WALK,
        observedAt: LAST_WEEK,
      });
      await wrote(cheese, { price: 2.45 });
      await boundRow(
        cheese,
        [{ price: 2.45, runId: OLD_WALK, observedAt: LAST_MONTH }],
        { decidedAt: new Date(Date.now() - 40 * DAY) }
      );
      await boundRow(cheese, [{ price: 2.45 }]);
      const before = await everything(cheese);
      expect(await amounts(cheese)).toEqual([2.45, 2.6, 2.45]);

      const result = await settle(cheese);

      // Stated from the row decided first, the statement would carry last
      // month's instant: the two newer rows would go, and the price would be
      // written again with last month's instant and run.
      expect(result).toMatchObject({ ...NOTHING, pricesRestated: 1 });
      expect(await everything(cheese)).toEqual(before);
      expect(await shown(cheese)).toEqual([2.45, 2.45, 2.45, 2.45]);
    }, 120_000);

    it('keeps the price rows of a leaflet that ended, with what the leaflet printed', async () => {
      const ham = await product();
      const ended = new Date(Date.now() - DAY);
      await wrote(ham, {
        price: 1.49,
        runId: LEAFLET,
        kind: LEAFLET_KIND,
        observedAt: LAST_WEEK,
        validUntil: ended,
        catalogDetails: {
          offerId: 'p3-o7',
          page: 3,
          rawText: ['Jamón cocido', '1,49 €'],
          promotion: null,
          loyalty: null,
        },
      });
      // The row still holds the price. Its window closed, so it states none.
      await boundRow(ham, [
        {
          price: 1.49,
          runId: LEAFLET,
          observedAt: LAST_WEEK,
          validUntil: ended,
        },
      ]);
      const before = await everything(ham);
      expect(before.prices).toHaveLength(1);
      expect(before.details).toBe(1);

      const result = await settle(ham);

      expect(result).toMatchObject({ ...NOTHING, pricesRestated: 0 });
      expect(await everything(ham)).toEqual(before);
    }, 120_000);

    it('still removes the price of a kind and scope that no bound row holds', async () => {
      // The other side of "keep the row": the row that left is still taken
      // back. A leaflet row was bound here by mistake and moved away, and a
      // website row stays.
      const yoghurt = await product();
      const [north] = regions;
      await wrote(yoghurt, { price: 0.99 });
      await wrote(yoghurt, {
        price: 0.79,
        runId: LEAFLET,
        kind: LEAFLET_KIND,
        observedAt: LAST_WEEK,
      });
      await wrote(yoghurt, {
        price: 1.05,
        priceScopeId: north,
        runId: MID_WALK,
      });
      await boundRow(yoghurt, [{ price: 0.99 }]);

      const result = await settle(yoghurt);

      expect(result.pricesWithdrawn).toBe(2);
      expect(await amounts(yoghurt)).toEqual([0.99]);
      expect(await shown(yoghurt)).toEqual([0.99, 0.99, 0.99, 0.99]);
    }, 120_000);

    it('has settled the old product when the price write to the new one fails, and the retry has nothing left to settle', async () => {
      const wrong = await product();
      const right = await product();
      await wrote(wrong, { price: 3.2 });
      const row = await boundRow(wrong, [{ price: 3.2 }]);
      failNextPriceBatch = new Error('catalog is away');

      const failure = await service
        .accept({ userId: OPERATOR, entryId: row, itemId: right })
        .catch((error: Error) => error);

      // The decision stands, and the old product was settled first.
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain('catalog is away');
      expect((failure as Error).message).toContain(wrong);
      expect((failure as Error).message).toContain(chain);
      expect(await entries.findOneByOrFail({ id: row })).toMatchObject({
        status: SourceEntryStatus.ACTIVE,
        itemId: right,
      });
      expect(await priceRows(wrong)).toEqual([]);
      expect(await offerRows(wrong)).toEqual([]);
      expect(await priceRows(right)).toEqual([]);

      // The retry writes the price it owes and settles nothing: the saved
      // row no longer names the product it left.
      const retried = await service.accept({
        userId: OPERATOR,
        entryId: row,
        itemId: right,
      });
      expect(retried.settled).toBeNull();
      expect(await amounts(right)).toEqual([3.2]);
    }, 120_000);
  }
);
