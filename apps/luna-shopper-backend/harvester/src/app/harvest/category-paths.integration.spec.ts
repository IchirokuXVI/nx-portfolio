import {
  PriceSourceKind,
  SourceEntryStatus,
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
import { SourceIngest } from './source-ingest';

/**
 * The write of the category paths at the drain (plan 0268, section 2),
 * against real Postgres: a `jsonb` list of lists through a plain `update`.
 *
 * What a fake repository cannot prove: that the column takes the list as
 * written, names and order verbatim, that `ADD` reads what the table holds
 * now, and that the write leaves every other column of the row alone.
 *
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://... \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
const CHAIN = '02680268-0000-4000-a000-0000000000c1';
const RUN = '02680268-0000-4000-a000-0000000000a1';
const EARLIER_RUN = '02680268-0000-4000-a000-0000000000a0';

const COLA = ['Agua y refrescos', 'Cola'];
const PACKS = ['Agua y refrescos', 'Packs de agua y refrescos'];
const IBERICOS = ['Navidad', 'Ibéricos y quesos'];

describeIntegration('SourceIngest.writeCategoryPaths (real Postgres)', () => {
  let dataSource: DataSource;
  let entries: Repository<SourceCatalogEntry>;
  let ingest: SourceIngest;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    entries = dataSource.getRepository(SourceCatalogEntry);
    ingest = new SourceIngest(
      entries,
      dataSource.getRepository(SourceEntryPrice),
      {} as CatalogClient
    );
  });

  beforeEach(clean);

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

  async function entry(
    externalId: string,
    categoryPaths?: string[][],
    categoryPathsReplacedByRunId?: string
  ): Promise<SourceCatalogEntry> {
    return entries.save(
      entries.create({
        supermarketId: CHAIN,
        externalId,
        sourceKind: PriceSourceKind.OFFICIAL_API,
        name: `Producto ${externalId}`,
        status: SourceEntryStatus.UNRESOLVED,
        categoryPath: COLA,
        ...(categoryPaths ? { categoryPaths } : {}),
        ...(categoryPathsReplacedByRunId
          ? { categoryPathsReplacedByRunId }
          : {}),
      })
    );
  }

  /** The run each row's paths were last replaced by (164a), by id. */
  const replacedBy = async (id: string) =>
    (
      await entries.findOneOrFail({
        select: { id: true, categoryPathsReplacedByRunId: true },
        where: { id },
      })
    ).categoryPathsReplacedByRunId;

  const stored = async (id: string) =>
    (
      await entries.findOneOrFail({
        select: {
          id: true,
          name: true,
          categoryPath: true,
          categoryPaths: true,
          timesSeen: true,
        },
        where: { id },
      })
    ).categoryPaths;

  it('holds a new row at no path, and writes the paths of REPLACE and ADD as stated', async () => {
    const fresh = await entry('659');
    const known = await entry('38406', [IBERICOS]);
    expect(await stored(fresh.id)).toEqual([]);

    const changed = await ingest.writeCategoryPaths(RUN, [
      { entryId: fresh.id, paths: [COLA, PACKS], mode: 'REPLACE' },
      { entryId: known.id, paths: [COLA, IBERICOS], mode: 'ADD' },
    ]);

    expect(changed).toBe(2);
    expect(await stored(fresh.id)).toEqual([COLA, PACKS]);
    expect(await stored(known.id)).toEqual([IBERICOS, COLA]);
  });

  it('replaces what the table holds now, and leaves every other column alone', async () => {
    const row = await entry('38406', [IBERICOS, COLA]);

    await ingest.writeCategoryPaths(RUN, [
      { entryId: row.id, paths: [PACKS], mode: 'REPLACE' },
    ]);

    const after = await entries.findOneByOrFail({ id: row.id });
    expect(after.categoryPaths).toEqual([PACKS]);
    expect(after.categoryPath).toEqual(COLA);
    expect(after.name).toBe('Producto 38406');
    expect(after.timesSeen).toBe(row.timesSeen);
  });

  it('writes nothing for a row that already holds the paths, or no longer exists', async () => {
    const row = await entry('659', [COLA, PACKS]);

    const changed = await ingest.writeCategoryPaths(RUN, [
      { entryId: row.id, paths: [COLA, PACKS], mode: 'REPLACE' },
      { entryId: row.id, paths: [PACKS], mode: 'ADD' },
      {
        entryId: '02680268-0000-4000-a000-0000000000ff',
        paths: [COLA],
        mode: 'REPLACE',
      },
    ]);

    expect(changed).toBe(0);
    expect(await stored(row.id)).toEqual([COLA, PACKS]);
  });

  it('keeps every stored path under ADD, in its order, even one a longer run path covers', async () => {
    const A = ['Frescos'];
    const AB = ['Frescos', 'Frutas'];
    const C = ['Despensa'];
    const short = await entry('1001', [A]);
    const two = await entry('1002', [A, C]);

    const landed: number[] = [];
    const changed = await ingest.writeCategoryPaths(
      RUN,
      [
        { entryId: short.id, paths: [AB], mode: 'ADD' },
        { entryId: two.id, paths: [AB], mode: 'ADD' },
      ],
      () => landed.push(landed.length + 1)
    );

    expect(changed).toBe(2);
    expect(landed).toEqual([1, 2]);
    expect(await stored(short.id)).toEqual([A, AB]);
    expect(await stored(two.id)).toEqual([A, C, AB]);
  });

  it('names the run on a row it replaced, in the statement of the paths, and on none it added to (164a)', async () => {
    const fresh = await entry('659');
    const known = await entry('38406', [IBERICOS], EARLIER_RUN);
    const before = await entries.findOneByOrFail({ id: known.id });

    const changed = await ingest.writeCategoryPaths(RUN, [
      { entryId: fresh.id, paths: [COLA, PACKS], mode: 'REPLACE' },
      { entryId: known.id, paths: [COLA], mode: 'ADD' },
    ]);

    expect(changed).toBe(2);
    expect(await replacedBy(fresh.id)).toBe(RUN);
    expect(await replacedBy(known.id)).toBe(EARLIER_RUN);
    // Nothing else of the added row moved, but for the clock its changed
    // paths move, as before the column.
    const after = await entries.findOneByOrFail({ id: known.id });
    expect({
      ...after,
      categoryPaths: before.categoryPaths,
      updatedAt: before.updatedAt,
    }).toEqual(before);
  });

  it('names the run on a row whose paths a REPLACE left as they were, and counts no write (164a)', async () => {
    const same = await entry('659', [COLA, PACKS], EARLIER_RUN);
    const already = await entry('660', [COLA], RUN);
    const before = await entries.findOneByOrFail({ id: same.id });

    const landed: string[] = [];
    const changed = await ingest.writeCategoryPaths(
      RUN,
      [
        { entryId: same.id, paths: [COLA, PACKS], mode: 'REPLACE' },
        { entryId: already.id, paths: [COLA], mode: 'REPLACE' },
      ],
      () => landed.push('row')
    );

    expect(changed).toBe(0);
    expect(landed).toEqual([]);
    expect(await replacedBy(same.id)).toBe(RUN);
    expect(await replacedBy(already.id)).toBe(RUN);
    // Every other column, the clock included, is what it was.
    const after = await entries.findOneByOrFail({ id: same.id });
    expect({ ...after, categoryPathsReplacedByRunId: EARLIER_RUN }).toEqual(
      before
    );
  });
});
