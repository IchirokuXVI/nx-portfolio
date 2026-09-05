import { ConfigService } from '@nestjs/config';
import {
  HarvestRunStatus,
  HarvestRunTrigger,
  PostalCodeDiscoveryStatus,
  type PostalCodeLocationCountsView,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { HarvesterConfig } from '../config/app-config';
import type { PostalCodeDiscoveryRequest } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import {
  ActiveRunExistsError,
  type HarvestRunStore,
} from './harvest-run.store';
import type { PlatformAdminService } from './platform-admin.service';
import { PostalCodeDiscoveryService } from './postal-code-discovery.service';
import {
  backoffSeconds,
  type PostalCodeDiscoveryStore,
} from './postal-code-discovery.store';
import { PostalCodeDiscoveryWorker } from './postal-code-discovery.worker';
import type { RunExecutor } from './run-executor.service';

const ADMIN = 'owner-1';

function settings(overrides: Partial<HarvesterConfig> = {}): HarvesterConfig {
  return {
    port: 3005,
    natsUrl: 'nats://localhost:4222',
    dbUrl: 'postgres://localhost/harvester',
    authJwtPublicKey: 'key',
    adminJwtPublicKey: 'key',
    logLevel: 'silent',
    actorId: 'ac700000-0000-4000-a000-000000000001',
    harvestEnabled: true,
    userAgent: 'LunaShopper/test',
    batchSize: 200,
    defaultWorkers: 4,
    defaultMaxRequestsPerSecond: 4,
    staleAfterSeconds: 900,
    failureRatio: 0.25,
    discoveryRadiusMetres: 5000,
    discoveryCooldownDays: 30,
    discoveryMaxAttempts: 3,
    discoveryPollSeconds: 60,
    mercadonaBaseUrl: undefined,
    overpassUrl: undefined,
    nominatimUrl: undefined,
    ...overrides,
  };
}

function configOf(config: HarvesterConfig): ConfigService {
  return { getOrThrow: () => config } as unknown as ConfigService;
}

function admin(): PlatformAdminService {
  return {
    requireAdmin: (id: string) => {
      if (id !== ADMIN) {
        throw new ForbiddenException('nope');
      }
    },
  } as unknown as PlatformAdminService;
}

function row(
  overrides: Partial<PostalCodeDiscoveryRequest> = {}
): PostalCodeDiscoveryRequest {
  return {
    id: 'q-1',
    country: 'es',
    postalCode: '14013',
    status: PostalCodeDiscoveryStatus.RUNNING,
    requestedAt: new Date('2026-09-01T09:00:00.000Z'),
    lastAttemptedAt: new Date('2026-09-01T09:00:00.000Z'),
    discoveredAt: null,
    nextAttemptAt: null,
    attempts: 1,
    runId: null,
    error: null,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    updatedAt: new Date('2026-09-01T09:00:00.000Z'),
    ...overrides,
  } as PostalCodeDiscoveryRequest;
}

// --- The enqueue half ------------------------------------------------------

describe('PostalCodeDiscoveryService (plan 0063)', () => {
  function build(
    counts: PostalCodeLocationCountsView,
    config: HarvesterConfig = settings()
  ) {
    const enqueue = jest.fn(async () => true);
    const store = { enqueue } as unknown as PostalCodeDiscoveryStore;
    const countLocationsByPostalCode = jest.fn(async () => counts);
    const catalog = {
      countLocationsByPostalCode,
    } as unknown as CatalogClient;
    const service = new PostalCodeDiscoveryService(
      store,
      catalog,
      admin(),
      configOf(config)
    );
    return { service, enqueue, countLocationsByPostalCode };
  }

  it('queues only the codes catalog holds no shops in', async () => {
    const { service, enqueue } = build({
      country: 'es',
      counts: [
        { postalCode: '14013', locations: 0 },
        { postalCode: '14010', locations: 4 },
        { postalCode: '14011', locations: 0 },
      ],
    });

    await service.considerAnnounced({
      country: 'es',
      postalCodes: ['14013', '14010', '14011'],
    });

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith('es', '14013', 30);
    expect(enqueue).toHaveBeenCalledWith('es', '14011', 30);
  });

  it('asks catalog once for every code one write announced', async () => {
    // Six codes from one profile write is the case plan 0063 section 2 is
    // about; six lookups to answer one event would be the same mistake in a
    // different place.
    const codes = ['14013', '14010', '14011', '14012', '14014', '14004'];
    const { service, countLocationsByPostalCode } = build({
      country: 'es',
      counts: codes.map((postalCode) => ({ postalCode, locations: 0 })),
    });

    await service.considerAnnounced({ country: 'es', postalCodes: codes });

    expect(countLocationsByPostalCode).toHaveBeenCalledTimes(1);
    expect(countLocationsByPostalCode).toHaveBeenCalledWith('es', codes);
  });

  it('deduplicates and normalizes what the event carried', async () => {
    const { service, countLocationsByPostalCode } = build({
      country: 'es',
      counts: [{ postalCode: '14013', locations: 0 }],
    });

    await service.considerAnnounced({
      country: ' ES ',
      postalCodes: ['14013', ' 14013 ', '', '  '],
    });

    expect(countLocationsByPostalCode).toHaveBeenCalledWith('es', ['14013']);
  });

  it('swallows a catalog failure rather than throwing at the broker', async () => {
    // The announcement is fire and forget, so there is nobody to return an
    // error to and a throw here would only be an unhandled rejection.
    const store = {
      enqueue: jest.fn(),
    } as unknown as PostalCodeDiscoveryStore;
    const catalog = {
      countLocationsByPostalCode: jest.fn(async () => {
        throw new Error('catalog is down');
      }),
    } as unknown as CatalogClient;
    const service = new PostalCodeDiscoveryService(
      store,
      catalog,
      admin(),
      configOf(settings())
    );

    await expect(
      service.considerAnnounced({ country: 'es', postalCodes: ['14013'] })
    ).resolves.toBeUndefined();
  });

  it('asks catalog nothing when the event carried no codes', async () => {
    const { service, countLocationsByPostalCode } = build({
      country: 'es',
      counts: [],
    });

    await service.considerAnnounced({ country: 'es', postalCodes: [] });

    expect(countLocationsByPostalCode).not.toHaveBeenCalled();
  });

  it('still queues while HARVEST_ENABLED is false', async () => {
    // Section 6, and the desired behaviour rather than a compromise: the queue
    // fills, nothing drains, and turning the switch on later drains a real
    // backlog of the codes users actually asked about.
    const { service, enqueue } = build(
      { country: 'es', counts: [{ postalCode: '14013', locations: 0 }] },
      settings({ harvestEnabled: false })
    );

    await service.considerAnnounced({ country: 'es', postalCodes: ['14013'] });

    expect(enqueue).toHaveBeenCalledWith('es', '14013', 30);
  });

  it('refuses the queue read to anybody but a platform admin', async () => {
    const { service } = build({ country: 'es', counts: [] });

    await expect(
      service.list({ userId: 'someone-else' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// --- The drain half --------------------------------------------------------

describe('PostalCodeDiscoveryWorker (plan 0063)', () => {
  function build(
    options: {
      config?: Partial<HarvesterConfig>;
      pending?: PostalCodeDiscoveryRequest[];
      status?: HarvestRunStatus;
      createImpl?: HarvestRunStore['create'];
      runError?: string | null;
    } = {}
  ) {
    const pending = [...(options.pending ?? [])];
    const claimNext = jest.fn(async () => pending.shift() ?? null);
    const markDone = jest.fn(async () => undefined);
    const markAttemptFailed = jest.fn(async () => undefined);
    const release = jest.fn(async () => undefined);
    const reapStale = jest.fn(async () => 0);
    const queue = {
      claimNext,
      markDone,
      markAttemptFailed,
      release,
      reapStale,
    } as unknown as PostalCodeDiscoveryStore;

    let created = 0;
    const create = jest.fn(async () => {
      created += 1;
      return { id: `run-${created}` };
    });
    const runs = {
      create: options.createImpl ?? create,
      seedHeartbeat: jest.fn(async () => undefined),
      load: jest.fn(async () => ({ error: options.runError ?? null })),
    } as unknown as HarvestRunStore;

    /** How many runs were in flight at once. One, or the plan is broken. */
    let inFlight = 0;
    let concurrentPeak = 0;
    const runToCompletion = jest.fn(async () => {
      inFlight += 1;
      concurrentPeak = Math.max(concurrentPeak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return options.status ?? HarvestRunStatus.COMPLETED;
    });
    const executor = { runToCompletion } as unknown as RunExecutor;

    const worker = new PostalCodeDiscoveryWorker(
      queue,
      runs,
      executor,
      configOf(settings(options.config))
    );
    return {
      worker,
      claimNext,
      markDone,
      markAttemptFailed,
      release,
      create: options.createImpl ?? create,
      runToCompletion,
      peak: () => concurrentPeak,
    };
  }

  it('turns six queued codes into six runs, one at a time', async () => {
    const six = ['14013', '14010', '14011', '14012', '14014', '14004'].map(
      (postalCode, index) => row({ id: `q-${index}`, postalCode })
    );
    const { worker, runToCompletion, markDone, peak } = build({ pending: six });

    await worker.drain();

    expect(runToCompletion).toHaveBeenCalledTimes(6);
    expect(markDone).toHaveBeenCalledTimes(6);
    // The whole point of the queue: never two runs, so never a unique index
    // violation and never six times Nominatim's allowed rate.
    expect(peak()).toBe(1);
  });

  it('starts runs with the SYSTEM trigger and nobody as the requester', async () => {
    const { worker, create } = build({ pending: [row()] });

    await worker.drain();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: HarvestRunTrigger.SYSTEM,
        requestedByUserId: null,
        supermarketId: null,
      })
    );
  });

  it('searches the discovery radius, not the profile expansion radius', async () => {
    const { worker, create } = build({
      pending: [row()],
      config: { discoveryRadiusMetres: 8000 },
    });

    await worker.drain();

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { postalCode: '14013', country: 'es', radiusMetres: 8000 },
      })
    );
  });

  it('does not drain while HARVEST_ENABLED is false', async () => {
    const { worker, claimNext, runToCompletion } = build({
      pending: [row()],
      config: { harvestEnabled: false },
    });

    await worker.drain();

    // Nothing is even claimed: the queue fills and waits, so flipping the
    // switch later drains a real backlog (section 6).
    expect(claimNext).not.toHaveBeenCalled();
    expect(runToCompletion).not.toHaveBeenCalled();
  });

  it('records the run failure on the row instead of marking it done', async () => {
    const { worker, markDone, markAttemptFailed } = build({
      pending: [row()],
      status: HarvestRunStatus.FAILED,
      runError: 'Nominatim found no point for postal code 99999',
    });

    await worker.drain();

    expect(markDone).not.toHaveBeenCalled();
    expect(markAttemptFailed).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '14013' }),
      'Nominatim found no point for postal code 99999',
      3,
      'run-1'
    );
  });

  it('puts the row back without spending an attempt when a run holds the lock', async () => {
    const { worker, release, markAttemptFailed, runToCompletion } = build({
      pending: [row(), row({ id: 'q-2', postalCode: '14010' })],
      createImpl: (async () => {
        throw new ActiveRunExistsError('someone-elses-run');
      }) as unknown as HarvestRunStore['create'],
    });

    await worker.drain();

    expect(release).toHaveBeenCalledTimes(1);
    expect(markAttemptFailed).not.toHaveBeenCalled();
    expect(runToCompletion).not.toHaveBeenCalled();
  });

  it('does not start a second drain over the first', async () => {
    const { worker, runToCompletion } = build({
      pending: [row(), row({ id: 'q-2' })],
    });

    await Promise.all([worker.drain(), worker.drain()]);

    // A run takes minutes and the timer fires every minute, so the guard is
    // what stops the second tick joining the first.
    expect(runToCompletion).toHaveBeenCalledTimes(2);
  });
});

describe('discovery backoff (plan 0063, section 4)', () => {
  it('grows with the attempt and stops at an hour', () => {
    expect(backoffSeconds(1)).toBe(120);
    expect(backoffSeconds(2)).toBe(240);
    expect(backoffSeconds(3)).toBe(480);
    expect(backoffSeconds(20)).toBe(3600);
  });

  it('never waits the full cooldown, which is what a success earns', () => {
    // Section 4: a failure is not a success. A transient outage and a
    // permanently bad code are told apart by trying again in minutes, not in a
    // month.
    const thirtyDays = 30 * 24 * 3600;
    expect(backoffSeconds(50)).toBeLessThan(thirtyDays);
  });
});
