import {
  HarvestRunMode,
  HarvestRunStatus,
  ItemSourceMatch,
  SourceAliasStatus,
} from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { HARVESTER_ENTITIES, HarvestRun, SourceAlias } from '../entities';

/**
 * The two promises plan 0081 makes in the schema rather than in code, against a
 * real Postgres.
 *
 * Both are the sort of thing that either works or silently does not, and no
 * mocked repository can tell you which: a partial unique index with three
 * conditions in its predicate, and two enum labels added to types that already
 * existed. The unit suite pins the ladder and the rules; this pins the database.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('the leaflet import schema (real Postgres)', () => {
  const CHAIN = '5efa0000-0000-4000-a000-00000000b001';
  const OTHER_CHAIN = '5efa0000-0000-4000-a000-00000000b002';
  const SCOPE = '5efa0000-0000-4000-a000-00000000b0ff';
  const DIGEST = 'e'.repeat(64);
  const MARK = 'leaflet-integration-test';

  let dataSource: DataSource;
  let runs: ReturnType<DataSource['getRepository<HarvestRun>']>;
  let aliases: ReturnType<DataSource['getRepository<SourceAlias>']>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    runs = dataSource.getRepository(HarvestRun);
    aliases = dataSource.getRepository(SourceAlias);
  });

  beforeEach(async () => {
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
      `DELETE FROM "harvest_runs" WHERE "correlationId" = $1`,
      [MARK]
    );
    await dataSource.query(
      `DELETE FROM "source_aliases" WHERE "supermarketId" IN ($1, $2)`,
      [CHAIN, OTHER_CHAIN]
    );
  }

  function importRun(patch: Partial<HarvestRun> = {}): Partial<HarvestRun> {
    return {
      supermarketId: CHAIN,
      sourceId: null,
      priceScopeId: SCOPE,
      mode: HarvestRunMode.LEAFLET_IMPORT,
      status: HarvestRunStatus.COMPLETED,
      documentSha256: DIGEST,
      correlationId: MARK,
      ...patch,
    };
  }

  it('takes a run with a chain and no source at all (section 1)', async () => {
    // `SupermarketSource` is fetching configuration, and an upload fetches
    // nothing, so a chain that publishes only leaflets has no source row.
    const saved = await runs.save(runs.create(importRun()));

    expect(saved.sourceId).toBeNull();
    expect(saved.skipped).toBe(0);
    expect(saved.warnings).toEqual([]);
    expect(saved.revertedAt).toBeNull();
  });

  it('refuses a second import of one document for one chain (section 7)', async () => {
    await runs.save(runs.create(importRun()));

    await expect(runs.save(runs.create(importRun()))).rejects.toThrow(
      /uq_harvest_run_leaflet_document/
    );
  });

  it('lets a failed run be retried, because it wrote nothing', async () => {
    await runs.save(
      runs.create(importRun({ status: HarvestRunStatus.FAILED }))
    );

    const retry = await runs.save(runs.create(importRun()));
    expect(retry.id).toBeDefined();
  });

  it('lets a corrected upload through once the run is reverted', async () => {
    // The case the exclusion exists for (plan 0082, section 4): the right file
    // against the wrong chain or scope, reverted, then imported again.
    const first = await runs.save(runs.create(importRun()));
    first.revertedAt = new Date();
    await runs.save(first);

    const again = await runs.save(runs.create(importRun()));
    expect(again.id).not.toBe(first.id);
  });

  it('scopes the lock to the chain, so two chains may hold one digest', async () => {
    await runs.save(runs.create(importRun()));

    const other = await runs.save(
      runs.create(importRun({ supermarketId: OTHER_CHAIN }))
    );
    expect(other.id).toBeDefined();
  });

  it('holds one alias per printed key per chain, and the new enum labels', async () => {
    const row = await aliases.save(
      aliases.create({
        supermarketId: CHAIN,
        aliasKey: 'cerveza alhambra tradicional|lata 33 cl',
        printedName: 'Cerveza Alhambra Tradicional',
        printedFormat: 'lata 33 cl',
        // NAME_SIZE and LEAFLET_IMPORT are labels this plan's migration added to
        // types that already existed; a value that does not exist in the type
        // is refused by Postgres rather than stored.
        matchedBy: ItemSourceMatch.NAME_SIZE,
        status: SourceAliasStatus.UNRESOLVED,
      })
    );

    expect(row.status).toBe(SourceAliasStatus.UNRESOLVED);
    expect(row.matchedBy).toBe(ItemSourceMatch.NAME_SIZE);

    await expect(
      aliases.save(
        aliases.create({
          supermarketId: CHAIN,
          aliasKey: 'cerveza alhambra tradicional|lata 33 cl',
          printedName: 'Cerveza Alhambra Tradicional otra vez',
          matchedBy: ItemSourceMatch.NAME_SIZE,
        })
      )
    ).rejects.toThrow(/uq_source_aliases_key/);

    // The same string for another chain is another product's name as far as
    // this table is concerned, and the index says so.
    const elsewhere = await aliases.save(
      aliases.create({
        supermarketId: OTHER_CHAIN,
        aliasKey: 'cerveza alhambra tradicional|lata 33 cl',
        printedName: 'Cerveza Alhambra Tradicional',
        matchedBy: ItemSourceMatch.NAME_SIZE,
      })
    );
    expect(elsewhere.id).not.toBe(row.id);
  });
});
