import type { ConfigService } from '@nestjs/config';
import {
  DEFAULT_SCOPE_PRIORITY,
  HarvestDetailFetch,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunWrites,
  PriceScopeKind,
  type PriceScopeView,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import {
  HARVESTER_ENTITIES,
  HarvestRun,
  HarvestRunPreset,
  type SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import { HarvestRunPresetService } from './harvest-run-preset.service';
import { HarvestRunPresetStore } from './harvest-run-preset.store';
import { HarvestRunService } from './harvest-run.service';
import { HarvestRunStore } from './harvest-run.store';
import type { PlatformAdminService } from './platform-admin.service';
import type { RunExecutor } from './run-executor.service';
import type { SourceEntryService } from './source-entry.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * Run presets against real Postgres (plan 0120, sections 2 to 7).
 *
 * What a mocked repository cannot say: that the name index is case insensitive
 * and per chain, that `presetId` on a run survives the preset's deletion with
 * no foreign key in the way, and that the latest run is the one `DISTINCT ON`
 * picks. Catalog is a stub that holds two warehouse scopes, and the executor
 * starts nothing.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up
 *   LUNA_INTEGRATION=1 HARVESTER_DB_URL=postgres://luna_harvester:luna_harvester@localhost:<port>/luna_harvester \
 *     npx nx run luna-shopper-backend-harvester:test-integration
 */
describeIntegration('run presets (real Postgres)', () => {
  /** Chains nothing else in this database uses, so cleanup is exact. */
  const CHAIN = '0120c0de-0000-4000-8000-111111111111';
  const OTHER_CHAIN = '0120c0de-0000-4000-8000-111111111112';
  const ADMIN = '0120c0de-0000-4000-8000-aaaaaaaaaaaa';
  const WAREHOUSE = '0120c0de-0000-4000-8000-333333333301';
  const GROUP = '0120c0de-0000-4000-8000-333333333302';

  let dataSource: DataSource;
  let presets: HarvestRunPresetService;
  let runs: HarvestRunService;
  let scopes: PriceScopeView[];

  const scope = (id: string, externalKey: string | null): PriceScopeView => ({
    id,
    supermarketId: CHAIN,
    kind: PriceScopeKind.LOCAL_AREA,
    externalKey,
    label: null,
    priority: DEFAULT_SCOPE_PRIORITY[PriceScopeKind.LOCAL_AREA],
  });

  const input = {
    mode: HarvestRunMode.CATALOG_DISCOVERY,
    priceScopeIds: [WAREHOUSE],
    scopeCopies: [{ from: WAREHOUSE, to: [GROUP] }],
  };

  async function clean(): Promise<void> {
    await dataSource.query(
      `DELETE FROM "harvest_runs" WHERE "supermarketId" = ANY($1)`,
      [[CHAIN, OTHER_CHAIN]]
    );
    await dataSource.query(
      `DELETE FROM "harvest_run_presets" WHERE "supermarketId" = ANY($1)`,
      [[CHAIN, OTHER_CHAIN]]
    );
  }

  /** Finish every run of the chain, which releases the one active run lock. */
  async function finishRuns(): Promise<void> {
    await dataSource.query(
      `UPDATE "harvest_runs" SET status = 'COMPLETED' WHERE "supermarketId" = $1`,
      [CHAIN]
    );
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('HARVESTER_DB_URL'),
      entities: HARVESTER_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    const admin = {
      requireAdmin: async () => ADMIN,
    } as unknown as PlatformAdminService;
    const source = {
      id: '0120c0de-0000-4000-8000-555555555555',
      supermarketId: CHAIN,
      adapterKey: 'mercadona-api',
      enabled: true,
    } as SupermarketSource;
    const sources = {
      findBySupermarket: async () => source,
    } as unknown as SupermarketSourceService;
    const catalog = {
      listAllPriceScopes: async () => scopes,
    } as unknown as CatalogClient;
    const config = {
      getOrThrow: () => ({ harvestEnabled: true }),
    } as unknown as ConfigService;
    const executor = { start: () => undefined } as unknown as RunExecutor;

    const presetStore = new HarvestRunPresetStore(
      dataSource.getRepository(HarvestRunPreset)
    );
    runs = new HarvestRunService(
      new HarvestRunStore(dataSource.getRepository(HarvestRun)),
      executor,
      sources,
      undefined as unknown as SourceEntryService,
      catalog,
      admin,
      config,
      presetStore
    );
    presets = new HarvestRunPresetService(presetStore, runs, sources, admin);
  });

  beforeEach(async () => {
    scopes = [scope(WAREHOUSE, '4661'), scope(GROUP, null)];
    await clean();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await clean();
      await dataSource.destroy();
    }
  });

  it('creates the table, the case insensitive name index and the run column', async () => {
    const indexes: Array<{ indexname: string; indexdef: string }> =
      await dataSource.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE tablename IN ('harvest_run_presets', 'harvest_runs')`
      );
    const byName = new Map(indexes.map((row) => [row.indexname, row.indexdef]));

    expect(byName.get('uq_harvest_run_presets_name')).toMatch(
      /UNIQUE INDEX .*\("supermarketId", lower\(\(name\)::text\)\)/
    );
    expect(byName.get('ix_harvest_runs_preset')).toMatch(/\("presetId"\)/);

    const constraints: Array<{ conname: string }> = await dataSource.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'harvest_runs'::regclass AND contype = 'f'`
    );
    // No foreign key, so a deleted preset leaves its runs alone.
    expect(constraints).toEqual([]);
  });

  it('stores the resolved input and refuses a name that differs only in case', async () => {
    const saved = await presets.create({
      userId: ADMIN,
      supermarketId: CHAIN,
      name: 'Weekly Mercadona',
      input,
    });

    const row = await dataSource
      .getRepository(HarvestRunPreset)
      .findOneByOrFail({ id: saved.id });
    expect(row.input).toEqual({
      ...input,
      writes: HarvestRunWrites.PRICES_AND_AVAILABILITY,
      details: HarvestDetailFetch.NEW,
    });
    expect(row.createdByUserId).toBe(ADMIN);

    const duplicate = presets.create({
      userId: ADMIN,
      supermarketId: CHAIN,
      name: 'weekly MERCADONA',
      input,
    });
    await expect(duplicate).rejects.toBeInstanceOf(ConflictException);
    await expect(
      presets.create({
        userId: ADMIN,
        supermarketId: CHAIN,
        name: 'WEEKLY mercadona',
        input,
      })
    ).rejects.toThrow(new RegExp(`"Weekly Mercadona": ${saved.id}`));
  });

  it('lets another chain use the same name', async () => {
    await presets.create({
      userId: ADMIN,
      supermarketId: CHAIN,
      name: 'Weekly',
      input,
    });
    await dataSource.getRepository(HarvestRunPreset).save({
      supermarketId: OTHER_CHAIN,
      name: 'weekly',
      input: { mode: HarvestRunMode.CATALOG_DISCOVERY },
      createdByUserId: ADMIN,
      updatedByUserId: ADMIN,
    });

    const page = await presets.list({ userId: ADMIN, supermarketId: CHAIN });
    expect(page.items.map((preset) => preset.name)).toEqual(['Weekly']);
  });

  it('starts two runs from a preset, and the list shows the second as the latest', async () => {
    const preset = await presets.create({
      userId: ADMIN,
      supermarketId: CHAIN,
      name: 'Weekly Mercadona',
      input,
    });
    expect(preset.lastRun).toBeNull();

    const first = await runs.spawnFromPreset({
      userId: ADMIN,
      presetId: preset.id,
    });
    await finishRuns();
    const second = await runs.spawnFromPreset({
      userId: ADMIN,
      presetId: preset.id,
    });

    expect(first.presetId).toBe(preset.id);
    const stored = await dataSource
      .getRepository(HarvestRun)
      .findOneByOrFail({ id: second.id });
    expect(stored.input).toEqual(
      expect.objectContaining({
        supermarketId: CHAIN,
        priceScopeIds: [WAREHOUSE],
        scopeCopies: [{ from: WAREHOUSE, to: [GROUP] }],
        details: HarvestDetailFetch.NEW,
      })
    );

    const page = await presets.list({ userId: ADMIN, supermarketId: CHAIN });
    expect(page.items[0].lastRun).toEqual({
      id: second.id,
      status: HarvestRunStatus.PENDING,
      requestedAt: second.requestedAt,
    });

    const filtered = await runs.list({ userId: ADMIN, presetId: preset.id });
    expect(filtered.items.map((run) => run.id).sort()).toEqual(
      [first.id, second.id].sort()
    );
  });

  it('conflicts while a run of the chain is in flight', async () => {
    const preset = await presets.create({
      userId: ADMIN,
      supermarketId: CHAIN,
      name: 'Weekly',
      input,
    });
    await runs.spawnFromPreset({ userId: ADMIN, presetId: preset.id });

    await expect(
      runs.spawnFromPreset({ userId: ADMIN, presetId: preset.id })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a scope deleted since the preset was saved, and creates no run', async () => {
    const preset = await presets.create({
      userId: ADMIN,
      supermarketId: CHAIN,
      name: 'Weekly',
      input,
    });
    scopes = [scope(WAREHOUSE, '4661')];

    const attempt = runs.spawnFromPreset({
      userId: ADMIN,
      presetId: preset.id,
    });
    await expect(attempt).rejects.toBeInstanceOf(ValidationException);
    await expect(
      runs.spawnFromPreset({ userId: ADMIN, presetId: preset.id })
    ).rejects.toThrow(new RegExp(`Weekly.*${preset.id}.*${GROUP}`));

    const count = await dataSource
      .getRepository(HarvestRun)
      .countBy({ supermarketId: CHAIN });
    expect(count).toBe(0);
  });

  it('changes no run when the preset is edited or deleted', async () => {
    const preset = await presets.create({
      userId: ADMIN,
      supermarketId: CHAIN,
      name: 'Weekly',
      input,
    });
    const run = await runs.spawnFromPreset({
      userId: ADMIN,
      presetId: preset.id,
    });
    const before = await dataSource
      .getRepository(HarvestRun)
      .findOneByOrFail({ id: run.id });

    await presets.update({
      userId: ADMIN,
      presetId: preset.id,
      name: 'Renamed',
      input: {
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        priceScopeIds: [WAREHOUSE],
        details: HarvestDetailFetch.ALL,
      },
    });
    await presets.delete({ userId: ADMIN, presetId: preset.id });

    const after = await dataSource
      .getRepository(HarvestRun)
      .findOneByOrFail({ id: run.id });
    expect(after.input).toEqual(before.input);
    expect(after.presetId).toBe(preset.id);
    const filtered = await runs.list({ userId: ADMIN, presetId: preset.id });
    expect(filtered.items.map((row) => row.id)).toEqual([run.id]);
  });
});
