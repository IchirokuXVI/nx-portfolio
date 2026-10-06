import {
  PriceSourceKind,
  SourceEntryStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES, SourceCatalogEntry } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { SourceEntryPriceWriter } from './source-entry-write';

/**
 * One price per product, scope and source, against real Postgres (plan 0181).
 *
 * What is under test is the query that finds the other pieces of a product
 * sold by weight. A fake repository returns whatever it is given, so it cannot
 * prove the `where`: the same chain, the same source kind, the same product,
 * `ACTIVE`, sold by weight, and not the row being written. It also proves the
 * comparison on the values Postgres answers, where a `numeric` is a string and
 * `"10.20" < "9.41"` is true of the text and false of the money.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */

/** Two chains nothing else in this database uses, so cleanup is exact. */
const MERCADONA = 'b1810000-0000-4000-a000-000000000001';
const OTHER_CHAIN = 'b1810000-0000-4000-a000-000000000002';

const CHEESE = 'c1810000-0000-4000-a000-000000000001';
const OTHER_ITEM = 'c1810000-0000-4000-a000-000000000002';

const SCOPE = 'd1810000-0000-4000-a000-000000000001';
const RUN = 'e1810000-0000-4000-a000-000000000001';

describeIntegration(
  'the price of a product sold by weight (real Postgres)',
  () => {
    let dataSource: DataSource;
    let writer: SourceEntryPriceWriter;
    let sent: { priceScopeId: string; price: number | null; runId: string }[];

    beforeAll(async () => {
      dataSource = new DataSource({
        type: 'postgres',
        url: requiredEnv('HARVESTER_DB_URL'),
        entities: HARVESTER_ENTITIES,
        synchronize: false,
      });
      await dataSource.initialize();

      const catalog = {
        addPrices: async (
          priceScopeId: string,
          entries: { price: number | null }[],
          runId: string
        ) => {
          sent.push({ priceScopeId, price: entries[0].price, runId });
          return { inserted: 1, confirmed: 0 };
        },
      } as unknown as CatalogClient;
      writer = new SourceEntryPriceWriter(
        catalog,
        dataSource.getRepository(SourceCatalogEntry)
      );
    }, 120_000);

    afterAll(async () => {
      if (dataSource?.isInitialized) {
        await clean();
        await dataSource.destroy();
      }
    });

    beforeEach(async () => {
      sent = [];
      await clean();
    });

    function clean() {
      // The price rows go with their entries: the foreign key cascades.
      return dataSource.query(
        `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = ANY($1::uuid[])`,
        [[MERCADONA, OTHER_CHAIN]]
      );
    }

    let seq = 0;

    /** One row with one price at {@link SCOPE}, and the row as the service loads it. */
    async function piece(
      perKilo: number,
      over: {
        supermarketId?: string;
        sourceKind?: PriceSourceKind;
        itemId?: string;
        status?: SourceEntryStatus;
        soldByWeight?: boolean;
      } = {}
    ): Promise<SourceCatalogEntry> {
      seq += 1;
      const [row] = await dataSource.query(
        `INSERT INTO "source_catalog_entries"
              ("supermarketId", "externalId", "sourceKind", "name",
               "sizeFormat", "itemId", "status", "soldByWeight")
       VALUES ($1, $2, $3, $4, 'kg', $5, $6, $7)
       RETURNING "id"`,
        [
          over.supermarketId ?? MERCADONA,
          `plan0181-${seq}`,
          over.sourceKind ?? PriceSourceKind.OFFICIAL_API,
          `Queso semicurado ${seq}`,
          over.itemId ?? CHEESE,
          over.status ?? SourceEntryStatus.ACTIVE,
          over.soldByWeight ?? true,
        ]
      );
      await dataSource.query(
        `INSERT INTO "source_entry_prices"
              ("entryId", "priceScopeId", "price", "unitPrice",
               "unitPriceLabel", "runId", "sourceKind")
       VALUES ($1, $2, $3, $3, 'kg', $4, $5)`,
        // The kind of the run that observed it (plan 0190), which is the
        // kind an accept writes the price under.
        [
          row.id,
          SCOPE,
          perKilo,
          RUN,
          over.sourceKind ?? PriceSourceKind.OFFICIAL_API,
        ]
      );
      return dataSource.getRepository(SourceCatalogEntry).findOneOrFail({
        where: { id: row.id as string },
        relations: { prices: true },
      });
    }

    it('writes the lower per kilo figure of two pieces bound to one product', async () => {
      // 10.20 against 9.41: as text the first sorts lower, as money it does not.
      const dear = await piece(10.2);
      await piece(9.41);

      await writer.write(dear);

      expect(sent).toEqual([{ priceScopeId: SCOPE, price: 9.41, runId: RUN }]);
    }, 60_000);

    it('writes its own figure when no other piece is bound to the product', async () => {
      const alone = await piece(10.2);
      // Every one of these is cheaper, and none of them is another piece of
      // this product at this chain from this source.
      await piece(1, { itemId: OTHER_ITEM });
      await piece(1, { supermarketId: OTHER_CHAIN });
      await piece(1, { sourceKind: PriceSourceKind.OFFICIAL_LEAFLET });
      await piece(1, { status: SourceEntryStatus.CANDIDATE });

      await writer.write(alone);

      expect(sent).toEqual([{ priceScopeId: SCOPE, price: 10.2, runId: RUN }]);
    }, 60_000);

    /**
     * Plan 0191, decision 2A. Before it a pack was written whatever else was
     * bound to its product, and a piece ignored every pack. Now the query
     * reads every bound row of the chain and kind, and a pack beside a piece
     * is two articles that cannot be compared: neither price is sent.
     */
    it('sends no price for a pack bound beside a piece sold by weight, and names the piece', async () => {
      const pack = await piece(2.95, { soldByWeight: false });
      const other = await piece(1);

      const outcome = await writer.writeNamed(pack);

      expect(sent).toEqual([]);
      expect(outcome).toEqual({
        written: 0,
        withheld: [
          {
            entryId: pack.id,
            priceScopeId: SCOPE,
            otherEntryIds: [other.id],
          },
        ],
      });
    }, 60_000);

    it('writes the price of a pack that is the only bound row of its product', async () => {
      const pack = await piece(2.95, { soldByWeight: false });
      // Bound to another product, so it is not a second article of this one.
      await piece(1, { itemId: OTHER_ITEM, soldByWeight: false });

      await writer.write(pack);

      expect(sent).toEqual([{ priceScopeId: SCOPE, price: 2.95, runId: RUN }]);
    }, 60_000);
  }
);
