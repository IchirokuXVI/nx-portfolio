import { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunTrigger,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  ForbiddenException,
  NotConfiguredException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestRun, SupermarketSource } from '../entities';
import { HarvestRunService } from './harvest-run.service';
import { ActiveRunExistsError, type HarvestRunStore } from './harvest-run.store';
import type { PlatformAdminService } from './platform-admin.service';
import type { RunExecutor } from './run-executor.service';
import type { SupermarketSourceService } from './supermarket-source.service';

const ADMIN = 'owner-1';
const SUPERMARKET = '5efa0000-0000-4000-a000-000000000001';

function settings(overrides: Partial<HarvesterConfig> = {}): HarvesterConfig {
  return {
    port: 3005,
    natsUrl: 'nats://localhost:4222',
    dbUrl: 'postgres://localhost/harvester',
    authJwtPublicKey: 'key',
    platformAdminUserIds: [ADMIN],
    logLevel: 'silent',
    actorId: 'ac700000-0000-4000-a000-000000000001',
    harvestEnabled: true,
    userAgent: 'LunaShopper/test',
    batchSize: 200,
    defaultWorkers: 4,
    defaultMaxRequestsPerSecond: 4,
    staleAfterSeconds: 900,
    failureRatio: 0.25,
    mercadonaEnabled: true,
    mercadonaBaseUrl: undefined,
    overpassUrl: undefined,
    nominatimUrl: undefined,
    ...overrides,
  };
}

function build(overrides: {
  config?: Partial<HarvesterConfig>;
  source?: Partial<SupermarketSource> | null;
  createImpl?: HarvestRunStore['create'];
} = {}) {
  const admin = {
    isAdmin: (id: string) => id === ADMIN,
    requireAdmin: (id: string) => {
      if (id !== ADMIN) {
        throw new ForbiddenException('nope');
      }
    },
  } as unknown as PlatformAdminService;

  const created: HarvestRun[] = [];
  const store = {
    create: overrides.createImpl ??
      (jest.fn(async (input) => {
        const run = {
          id: 'run-1',
          requestedAt: new Date('2026-08-30T09:00:00.000Z'),
          status: HarvestRunStatus.PENDING,
          trigger: HarvestRunTrigger.MANUAL,
          processed: 0,
          created: 0,
          updated: 0,
          unchanged: 0,
          notFound: 0,
          failed: 0,
          startedAt: null,
          finishedAt: null,
          heartbeatAt: null,
          totalPlanned: null,
          stage: null,
          stageLabel: null,
          abortRequestedAt: null,
          error: null,
          ...input,
        } as unknown as HarvestRun;
        created.push(run);
        return run;
      }) as unknown as HarvestRunStore['create']),
    seedHeartbeat: jest.fn(async () => undefined),
    load: jest.fn(async () => created[0]),
    requestAbort: jest.fn(async () => ({
      ...created[0],
      abortRequestedAt: new Date(),
    })),
    reapStale: jest.fn(async () => 2),
    repository: jest.fn(),
  } as unknown as HarvestRunStore;

  const executor = {
    start: jest.fn(),
    cancel: jest.fn(),
    isRunning: jest.fn(() => false),
  } as unknown as RunExecutor;

  const source =
    overrides.source === null
      ? null
      : ({
          id: 'src-1',
          supermarketId: SUPERMARKET,
          enabled: true,
          workers: 4,
          maxRequestsPerSecond: 4,
          config: { warehouse: '4661' },
          ...overrides.source,
        } as SupermarketSource);

  const sources = {
    findBySupermarket: jest.fn(async () => source),
  } as unknown as SupermarketSourceService;

  const config = {
    getOrThrow: () => settings(overrides.config),
  } as unknown as ConfigService;

  const service = new HarvestRunService(
    store,
    executor,
    sources,
    admin,
    config
  );
  return { service, store, executor, sources, created };
}

describe('HarvestRunService.spawn', () => {
  it('is gated to the platform admin, like every subject on this service', async () => {
    const { service } = build();
    await expect(
      service.spawn({
        userId: 'intruder',
        mode: HarvestRunMode.STORE_DISCOVERY,
        postalCode: '14013',
      })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses when HARVEST_ENABLED is false, without touching a source', async () => {
    // The default. A deploy that turns fetching on is a decision someone makes.
    const { service, store } = build({ config: { harvestEnabled: false } });
    await expect(
      service.spawn({
        userId: ADMIN,
        mode: HarvestRunMode.STORE_DISCOVERY,
        postalCode: '14013',
      })
    ).rejects.toBeInstanceOf(NotConfiguredException);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('starts a store discovery run on a postal code and a radius', async () => {
    // It belongs to a postal code and a radius, NOT to a chain: it discovers
    // many chains at once, so `supermarketId` is null by design.
    const { service, store, executor } = build();
    const run = await service.spawn({
      userId: ADMIN,
      mode: HarvestRunMode.STORE_DISCOVERY,
      postalCode: '14013',
      country: 'es',
    });

    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: HarvestRunMode.STORE_DISCOVERY,
        supermarketId: null,
        payload: expect.objectContaining({
          postalCode: '14013',
          country: 'es',
          // Section 11's recommended default.
          radiusMetres: 3000,
        }),
      })
    );
    expect(executor.start).toHaveBeenCalledWith(run.id);
  });

  it('refuses a store discovery run with no postal code to centre on', async () => {
    const { service } = build();
    await expect(
      service.spawn({ userId: ADMIN, mode: HarvestRunMode.STORE_DISCOVERY })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('refuses a refresh with no scope to write the prices for', async () => {
    const { service } = build();
    await expect(
      service.spawn({
        userId: ADMIN,
        mode: HarvestRunMode.REFRESH,
        supermarketId: SUPERMARKET,
      })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('refuses a chain that has no configured source', async () => {
    const { service } = build({ source: null });
    await expect(
      service.spawn({
        userId: ADMIN,
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        supermarketId: SUPERMARKET,
      })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('refuses a source that is disabled', async () => {
    const { service } = build({ source: { enabled: false } });
    await expect(
      service.spawn({
        userId: ADMIN,
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        supermarketId: SUPERMARKET,
      })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('answers a conflict naming the active run when one is already going', async () => {
    // The lock is a partial unique index in the database, so a second caller
    // finds out by being refused the insert rather than by a check that could
    // lose the race.
    const { service } = build({
      createImpl: (async () => {
        throw new ActiveRunExistsError('run-already-going');
      }) as unknown as HarvestRunStore['create'],
    });

    await expect(
      service.spawn({
        userId: ADMIN,
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        supermarketId: SUPERMARKET,
      })
    ).rejects.toThrow(/run-already-going/);
    await expect(
      service.spawn({
        userId: ADMIN,
        mode: HarvestRunMode.CATALOG_DISCOVERY,
        supermarketId: SUPERMARKET,
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('gives a run a heartbeat the moment it exists, not when it starts working', async () => {
    // A process that dies between the insert and the first tick would otherwise
    // hold the lock forever: the reaper compares heartbeats.
    const { service, store } = build();
    await service.spawn({
      userId: ADMIN,
      mode: HarvestRunMode.STORE_DISCOVERY,
      postalCode: '14013',
    });
    expect(store.seedHeartbeat).toHaveBeenCalledWith('run-1');
  });
});

describe('HarvestRunService.abort', () => {
  it('records the request and cancels the in flight requests', async () => {
    const { service, store, executor } = build();
    await service.spawn({
      userId: ADMIN,
      mode: HarvestRunMode.STORE_DISCOVERY,
      postalCode: '14013',
    });

    const aborted = await service.abort({ userId: ADMIN, runId: 'run-1' });
    expect(store.requestAbort).toHaveBeenCalledWith('run-1');
    // Both halves matter: the row is what another replica reads, and the
    // controller is what stops this process's own sockets.
    expect(executor.cancel).toHaveBeenCalledWith('run-1');
    expect(aborted.abortRequestedAt).not.toBeNull();
  });

  it('is gated too: aborting someone else’s run is not a public action', async () => {
    const { service } = build();
    await expect(
      service.abort({ userId: 'intruder', runId: 'run-1' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('HarvestRunService.reapStale', () => {
  it('reaps runs whose heartbeat stopped', async () => {
    const { service, store } = build();
    await service.reapStale();
    expect(store.reapStale).toHaveBeenCalledWith(900);
  });

  it('never lets the reaper take the process down', async () => {
    // It runs on a timer with no caller to return an error to.
    const { service, store } = build();
    (store.reapStale as jest.Mock).mockRejectedValueOnce(new Error('db gone'));
    await expect(service.reapStale()).resolves.toBeUndefined();
  });
});
