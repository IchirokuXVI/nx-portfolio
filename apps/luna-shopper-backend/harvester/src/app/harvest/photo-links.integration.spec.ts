import {
  ItemSourceMatch,
  PriceSourceKind,
  SourceEntryStatus,
  type ItemLinkedImageLink,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource, type Repository } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  SourceCatalogEntry,
  SourceEntryPrice,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { RunContext } from './run-context';
import { SourceEntryService } from './source-entry.service';
import {
  SourceIngest,
  type ReportedObservation,
  type SourceObservation,
} from './source-ingest';

/**
 * The photo address of a source row, against real Postgres (plan 0198).
 *
 * The unit specs prove which rows a chunk sends. What a double cannot prove
 * is the column: that a full read rewrites it, that a partial read with no
 * field leaves it and one with null clears it, and that the query a revert
 * reads its rows with names the rows it then deletes.
 *
 * Catalog is another service behind the broker, so it is a recorder here.
 * **Nothing opens an address.** Every assertion is on strings.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration \
 *       --testFile=photo-links.integration.spec.ts
 */
describeIntegration('the photo a source row states (real Postgres)', () => {
  /** A chain nothing else in this database uses, so cleanup is exact. */
  const CHAIN = '01980198-0000-4000-8000-111111111111';
  const SCOPE = '01980198-0000-4000-8000-222222222222';
  const FIRST_RUN = '01980198-0000-4000-8000-333333333301';
  const SECOND_RUN = '01980198-0000-4000-8000-333333333302';
  const ITEM = '01980198-0000-4000-8000-444444444444';

  const PHOTO = 'https://prod-mercadona.imgix.net/images/4241.jpg';
  const NEW_PHOTO =
    'https://prod-mercadona.imgix.net/images/4241-b.jpg?fit=crop&h=300&w=300';

  let dataSource: DataSource;
  let entries: Repository<SourceCatalogEntry>;
  let prices: Repository<SourceEntryPrice>;
  let linked: ItemLinkedImageLink[][];
  let unlinked: string[][];

  const catalog = {
    searchItems: async () => ({ items: [], nextCursor: null }),
    addPrices: async () => ({ inserted: 0, confirmed: 0 }),
    linkItemImages: async (links: ItemLinkedImageLink[]) => {
      linked.push(links);
      return { linked: links.length, moved: 0, unchanged: 0, rejected: [] };
    },
    unlinkItemImages: async (ids: string[]) => {
      unlinked.push(ids);
      return { unlinked: ids.length };
    },
  } as unknown as CatalogClient;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    entries = dataSource.getRepository(SourceCatalogEntry);
    prices = dataSource.getRepository(SourceEntryPrice);
  });

  beforeEach(async () => {
    linked = [];
    unlinked = [];
    await clean();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  async function clean(): Promise<void> {
    await dataSource.query(
      `DELETE FROM "source_catalog_entries" WHERE "supermarketId" = $1`,
      [CHAIN]
    );
  }

  function full(
    externalId: string,
    imageUrl: string | null,
    over: Partial<SourceObservation> = {}
  ): SourceObservation {
    return {
      externalId,
      name: `Producto ${externalId}`,
      brand: null,
      ean: null,
      unitSize: null,
      sizeUnit: null,
      sizeFormat: null,
      categoryPath: [],
      url: null,
      imageUrl,
      observedAt: new Date('2026-10-11T08:00:00.000Z'),
      extra: null,
      prices: [],
      ...over,
    };
  }

  const partial = (
    externalId: string,
    imageUrl?: string | null
  ): ReportedObservation => ({
    externalId,
    detailFetched: false,
    observedAt: new Date('2026-10-12T08:00:00.000Z'),
    prices: [],
    ...(imageUrl === undefined ? {} : { imageUrl }),
  });

  function run(runId: string, observations: ReportedObservation[]) {
    const context = {
      runId,
      report: async () => undefined,
      warn: () => undefined,
    } as unknown as RunContext;
    return new SourceIngest(entries, prices, catalog).ingest(context, {
      supermarketId: CHAIN,
      defaultPriceScopeId: SCOPE,
      sourceKind: PriceSourceKind.OFFICIAL_API,
      observations,
    });
  }

  /** The stored address of each row, read with SQL and not through the entity. */
  async function stored(): Promise<Record<string, string | null>> {
    const rows: { externalId: string; imageUrl: string | null }[] =
      await dataSource.query(
        `SELECT "externalId", "imageUrl" FROM "source_catalog_entries"
          WHERE "supermarketId" = $1`,
        [CHAIN]
      );
    return Object.fromEntries(
      rows.map((row) => [row.externalId, row.imageUrl])
    );
  }

  /** A person accepted the row onto the product. */
  async function bind(externalId: string): Promise<string> {
    const row = await entries.findOneByOrFail({
      supermarketId: CHAIN,
      externalId,
    });
    row.status = SourceEntryStatus.ACTIVE;
    row.itemId = ITEM;
    row.matchedBy = ItemSourceMatch.MANUAL;
    row.confidence = 1;
    row.decidedAt = new Date();
    await entries.save(row);
    return row.id;
  }

  it('stores the address a walk states on every row, verbatim, and links only the rows that are bound', async () => {
    await run(FIRST_RUN, [
      full('a', PHOTO),
      full('b', NEW_PHOTO),
      full('c', null),
    ]);

    expect(await stored()).toEqual({ a: PHOTO, b: NEW_PHOTO, c: null });
    // Nobody is bound yet, so nothing is a link.
    expect(linked).toEqual([]);

    const rowId = await bind('a');
    await run(SECOND_RUN, [
      full('a', PHOTO),
      full('b', NEW_PHOTO),
      full('c', null),
    ]);

    expect(linked).toEqual([
      [
        {
          sourceEntryId: rowId,
          itemId: ITEM,
          supermarketId: CHAIN,
          url: PHOTO,
          runId: SECOND_RUN,
        },
      ],
    ]);
    expect(unlinked).toEqual([]);
  }, 60_000);

  it('rewrites the address on a full read, leaves it on a partial read with no field, and clears it on one with null', async () => {
    await run(FIRST_RUN, [full('a', PHOTO)]);
    const rowId = await bind('a');

    await run(SECOND_RUN, [full('a', NEW_PHOTO)]);
    expect((await stored())['a']).toBe(NEW_PHOTO);

    linked = [];
    await run(SECOND_RUN, [partial('a')]);
    expect((await stored())['a']).toBe(NEW_PHOTO);
    // Still bound and still holding an address, so it is sent again.
    expect(linked).toHaveLength(1);
    expect(unlinked).toEqual([]);

    await run(SECOND_RUN, [partial('a', null)]);
    expect((await stored())['a']).toBeNull();
    expect(unlinked).toEqual([[rowId]]);

    // And a listing that prints one writes it with no detail read.
    await run(SECOND_RUN, [partial('a', PHOTO)]);
    expect((await stored())['a']).toBe(PHOTO);
  }, 60_000);

  it('takes the link back when a full read states no photo', async () => {
    await run(FIRST_RUN, [full('a', PHOTO)]);
    const rowId = await bind('a');

    const { images } = await run(SECOND_RUN, [full('a', null)]);

    expect((await stored())['a']).toBeNull();
    expect(unlinked).toEqual([[rowId]]);
    expect(images.unlinked).toBe(1);
  }, 60_000);

  it('names the undecided rows of a reverted run that state a photo, before it deletes them', async () => {
    await run(FIRST_RUN, [
      full('a', PHOTO),
      full('b', null),
      full('kept', NEW_PHOTO),
    ]);
    // A person decided this one, so the revert keeps it.
    await bind('kept');
    const doomed = await entries.findOneByOrFail({
      supermarketId: CHAIN,
      externalId: 'a',
    });

    // The two collaborators this path uses. The rest are never reached.
    const service = new SourceEntryService(
      entries,
      prices,
      undefined as never,
      catalog,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never
    );
    const deleted = await service.deleteUndecidedFrom(FIRST_RUN);

    expect(deleted).toBe(2);
    expect(unlinked).toEqual([[doomed.id]]);
    expect(Object.keys(await stored())).toEqual(['kept']);
  }, 60_000);
});
