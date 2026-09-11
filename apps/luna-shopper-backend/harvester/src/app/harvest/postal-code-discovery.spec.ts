import { ConfigService } from '@nestjs/config';
import {
  HarvestRunStatus,
  HarvestRunTrigger,
  PostalCodeDiscoveryStatus,
  type PostalCodeLocationCountsView,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import type {
  DiscoveredPlace,
  PostalCodeDiscoveryRequest,
  SupermarketSource,
} from '../entities';
import type { CatalogClient } from './catalog-client.service';
import {
  ActiveRunExistsError,
  type HarvestRunStore,
} from './harvest-run.store';
import type { PlatformAdminService } from './platform-admin.service';
import {
  PostalCodeDiscoveryService,
  type PlaceSourceRef,
} from './postal-code-discovery.service';
import {
  backoffSeconds,
  type PostalCodeDiscoveryStore,
} from './postal-code-discovery.store';
import { PostalCodeDiscoveryWorker } from './postal-code-discovery.worker';
import type { RunExecutor } from './run-executor.service';
import type { SupermarketSourceService } from './supermarket-source.service';

const ADMIN = 'owner-1';

/** The source every code is asked of, and the only one that is not a row. */
const OSM: PlaceSourceRef = {
  sourceId: null,
  supermarketId: null,
  label: 'OpenStreetMap',
  autoImportPlaces: false,
};

/** A chain that names its own shops, for the runs that are not OpenStreetMap's. */
const LIDL: PlaceSourceRef = {
  sourceId: 'src-lidl',
  supermarketId: 'chain-lidl',
  label: 'lidl-api',
  autoImportPlaces: false,
};

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
    postalCodeDeriveMaxMetres: 5000,
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

/**
 * A place repository that counts nothing.
 *
 * The enqueue half never reads it, and the listing's two grouped queries are
 * asserted in their own describe below, where the rows are stated.
 */
function places(rows: unknown[][] = [[], []]): Repository<DiscoveredPlace> {
  const answers = [...rows];
  return {
    query: jest.fn(async () => answers.shift() ?? []),
  } as unknown as Repository<DiscoveredPlace>;
}

/** One `supermarket_sources` row, as the place source set reads it. */
function source(overrides: Partial<SupermarketSource> = {}): SupermarketSource {
  return {
    id: 'src-lidl',
    supermarketId: 'chain-lidl',
    adapterKey: 'lidl-api',
    enabled: true,
    autoImportPlaces: false,
    config: {},
    workers: 4,
    maxRequestsPerSecond: 4,
    lastRunAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    updatedAt: new Date('2026-09-01T09:00:00.000Z'),
    ...overrides,
  } as SupermarketSource;
}

function sourceService(
  rows: SupermarketSource[] = []
): SupermarketSourceService {
  return {
    listEnabled: jest.fn(async () => rows),
  } as unknown as SupermarketSourceService;
}

/** Which source last answered a code, and when. Keyed like the real query. */
function runStore(
  answered: Map<string | null, Date> = new Map()
): HarvestRunStore {
  return {
    lastAnsweredBySource: jest.fn(async () => answered),
  } as unknown as HarvestRunStore;
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
    requeuedAt: null,
    attempts: 1,
    runId: null,
    error: null,
    placeName: null,
    dismissed: false,
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
      places(),
      catalog,
      admin(),
      sourceService(),
      runStore(),
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
      places(),
      catalog,
      admin(),
      sourceService(),
      runStore(),
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

// --- Which sources a code is asked of (plan 0107, section 2) ---------------

describe('PostalCodeDiscoveryService place sources (plan 0107)', () => {
  function build(options: {
    rows?: SupermarketSource[];
    answered?: Map<string | null, Date>;
    config?: Partial<HarvesterConfig>;
  }) {
    return new PostalCodeDiscoveryService(
      {} as unknown as PostalCodeDiscoveryStore,
      places(),
      {} as unknown as CatalogClient,
      admin(),
      sourceService(options.rows ?? []),
      runStore(options.answered ?? new Map()),
      configOf(settings(options.config))
    );
  }

  const labels = (refs: PlaceSourceRef[]): string[] =>
    refs.map((ref) => ref.label);

  it('always includes OpenStreetMap, which is not a chain row', async () => {
    const service = build({ rows: [] });

    expect(labels(await service.placeSourcesFor('es'))).toEqual([
      'OpenStreetMap',
    ]);
  });

  it('adds every enabled chain that publishes its own shop list', async () => {
    const service = build({
      rows: [
        source({ id: 'src-lidl', adapterKey: 'lidl-api' }),
        source({
          id: 'src-mercadona',
          supermarketId: 'chain-mercadona',
          adapterKey: 'mercadona-api',
        }),
      ],
    });

    expect(labels(await service.placeSourcesFor('es'))).toEqual([
      'OpenStreetMap',
      'lidl-api',
      'mercadona-api',
    ]);
  });

  it('leaves out a chain that publishes no shop list at all', async () => {
    // `deza-web` and `carrefour-web` publish an assortment and no store list,
    // so asking them where the shops are would be asking the wrong question.
    const service = build({
      rows: [
        source({ id: 'src-deza', adapterKey: 'deza-web' }),
        source({ id: 'src-lidl', adapterKey: 'lidl-api' }),
      ],
    });

    expect(labels(await service.placeSourcesFor('es'))).toEqual([
      'OpenStreetMap',
      'lidl-api',
    ]);
  });

  it('carries the chain, its row and its trust switch', async () => {
    const service = build({
      rows: [source({ autoImportPlaces: true })],
    });
    const [osm, lidl] = await service.placeSourcesFor('es');

    // OpenStreetMap can never be trusted: it has no row to carry the flag, and
    // its data is why the review queue exists (D3).
    expect(osm).toEqual({
      sourceId: null,
      supermarketId: null,
      label: 'OpenStreetMap',
      autoImportPlaces: false,
    });
    expect(lidl).toEqual({
      sourceId: 'src-lidl',
      supermarketId: 'chain-lidl',
      label: 'lidl-api',
      autoImportPlaces: true,
    });
  });

  it('asks every source that has never answered the code', async () => {
    const service = build({ rows: [source()] });

    expect(labels(await service.dueSourcesFor('es', '14013', null))).toEqual([
      'OpenStreetMap',
      'lidl-api',
    ]);
  });

  it('asks only the source that has not answered recently (D5)', async () => {
    // The rule this plan is about: a code answered by OpenStreetMap last week
    // and never by LIDL starts the LIDL run alone. Asking the question per code
    // would have let the first source to answer silence the other two.
    const lastWeek = new Date(Date.now() - 7 * 86_400_000);
    const service = build({
      rows: [source()],
      answered: new Map([[null, lastWeek]]),
    });

    expect(labels(await service.dueSourcesFor('es', '14013', null))).toEqual([
      'lidl-api',
    ]);
  });

  it('asks nobody when every source answered inside the cooldown', async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const service = build({
      rows: [source()],
      answered: new Map([
        [null, yesterday],
        ['src-lidl', yesterday],
      ]),
    });

    expect(await service.dueSourcesFor('es', '14013', null)).toEqual([]);
  });

  it('asks again once the cooldown has passed', async () => {
    const longAgo = new Date(Date.now() - 40 * 86_400_000);
    const service = build({
      rows: [source()],
      answered: new Map([
        [null, longAgo],
        ['src-lidl', longAgo],
      ]),
    });

    expect(labels(await service.dueSourcesFor('es', '14013', null))).toEqual([
      'OpenStreetMap',
      'lidl-api',
    ]);
  });

  it('asks everybody again when an operator requeued the code', async () => {
    // Plan 0097 section 6.2 promises that requeueing ignores the cooldown. A
    // per source cooldown alone would turn that button into a row that goes
    // straight back to DONE without anybody being asked anything.
    const yesterday = new Date(Date.now() - 86_400_000);
    const service = build({
      rows: [source()],
      answered: new Map([
        [null, yesterday],
        ['src-lidl', yesterday],
      ]),
    });

    expect(
      labels(await service.dueSourcesFor('es', '14013', new Date()))
    ).toEqual(['OpenStreetMap', 'lidl-api']);
  });

  it('does not re-ask a source that already answered since the requeue', async () => {
    // Which is what makes a partially failed pass retry the failed source
    // alone: the ones that answered are on the far side of the stamp.
    const requeuedAt = new Date(Date.now() - 3600_000);
    const service = build({
      rows: [source()],
      answered: new Map([[null, new Date()]]),
    });

    expect(
      labels(await service.dueSourcesFor('es', '14013', requeuedAt))
    ).toEqual(['lidl-api']);
  });
});

// --- The drain half --------------------------------------------------------

describe('PostalCodeDiscoveryWorker (plan 0063)', () => {
  function build(
    options: {
      config?: Partial<HarvesterConfig>;
      pending?: PostalCodeDiscoveryRequest[];
      status?: HarvestRunStatus;
      statuses?: HarvestRunStatus[];
      createImpl?: HarvestRunStore['create'];
      runError?: string | null;
      /** The sources every claimed code is due for. OpenStreetMap alone by default. */
      due?: PlaceSourceRef[];
      dueError?: string;
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
    const statuses = [...(options.statuses ?? [])];
    const runToCompletion = jest.fn(async () => {
      inFlight += 1;
      concurrentPeak = Math.max(concurrentPeak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return statuses.shift() ?? options.status ?? HarvestRunStatus.COMPLETED;
    });
    const executor = { runToCompletion } as unknown as RunExecutor;

    const dueSourcesFor = jest.fn(async () => {
      if (options.dueError) {
        throw new Error(options.dueError);
      }
      return options.due ?? [OSM];
    });
    const discovery = {
      dueSourcesFor,
    } as unknown as PostalCodeDiscoveryService;

    const worker = new PostalCodeDiscoveryWorker(
      queue,
      runs,
      executor,
      discovery,
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
      dueSourcesFor,
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

  // --- One code, one run per source (plan 0107, section 2) -----------------

  it('starts one run per source the code is due for', async () => {
    const { worker, create, runToCompletion, markDone, peak } = build({
      pending: [row()],
      due: [OSM, LIDL],
    });

    await worker.drain();

    expect(runToCompletion).toHaveBeenCalledTimes(2);
    // Still one at a time: the active run index allows one store discovery, and
    // `OsmPlacesClient` rate limits per instance.
    expect(peak()).toBe(1);
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ supermarketId: null, sourceId: null })
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        supermarketId: 'chain-lidl',
        sourceId: 'src-lidl',
      })
    );
    // The row is done when every run it started has finished, and it points at
    // the last one.
    expect(markDone).toHaveBeenCalledWith('q-1', 'run-2');
  });

  it('filters a chain wide source to the code, and never OpenStreetMap', async () => {
    // What stops a 1,675 shop document being read again for every code in the
    // queue (plan 0106, section 4). OpenStreetMap's query is already centred on
    // the code, so a filter there would be a second answer to one question.
    const { worker, create } = build({ pending: [row()], due: [OSM, LIDL] });

    await worker.drain();

    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: expect.not.objectContaining({
          postalCodes: expect.anything(),
        }),
      })
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: expect.objectContaining({ postalCodes: ['14013'] }),
      })
    );
  });

  it('starts nothing and marks the code done when no source is due', async () => {
    const { worker, runToCompletion, markDone } = build({
      pending: [row()],
      due: [],
    });

    await worker.drain();

    expect(runToCompletion).not.toHaveBeenCalled();
    // Null rather than a run id: the row keeps whatever run it already names
    // instead of pointing at one this pass did not start.
    expect(markDone).toHaveBeenCalledWith('q-1', null);
  });

  it('keeps the code retryable for the source that failed, and names it', async () => {
    // The other source answered, so the next pass finds it inside its cooldown
    // and asks the failed one alone (section 2.2).
    const { worker, markDone, markAttemptFailed } = build({
      pending: [row()],
      due: [OSM, LIDL],
      statuses: [HarvestRunStatus.COMPLETED, HarvestRunStatus.FAILED],
      runError: 'The chain answered 503',
    });

    await worker.drain();

    expect(markDone).not.toHaveBeenCalled();
    expect(markAttemptFailed).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '14013' }),
      'lidl-api: The chain answered 503',
      3,
      // The run that did answer, so the row points at work that happened.
      'run-1'
    );
  });

  it('puts the whole row back when another run holds the lock mid pass', async () => {
    let calls = 0;
    const { worker, release, markAttemptFailed, runToCompletion } = build({
      pending: [row(), row({ id: 'q-2', postalCode: '14010' })],
      due: [OSM, LIDL],
      createImpl: (async () => {
        calls += 1;
        if (calls === 1) {
          return { id: 'run-1' };
        }
        throw new ActiveRunExistsError('someone-elses-run');
      }) as unknown as HarvestRunStore['create'],
    });

    await worker.drain();

    // One run happened and the second source never started. The row goes back
    // whole: the source that answered is recorded on its own run, so the next
    // pass asks only for what is still missing.
    expect(runToCompletion).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(markAttemptFailed).not.toHaveBeenCalled();
  });

  it('gives the row back when shutdown interrupts a pass', async () => {
    // Marking it DONE here would say every source answered and hide the rest
    // behind the thirty day cooldown. The sources that did answer are recorded
    // on their own runs, so the row costs nothing to hand back.
    const harness = build({ pending: [row()], due: [OSM, LIDL] });
    harness.runToCompletion.mockImplementationOnce(async () => {
      harness.worker.onApplicationShutdown();
      return HarvestRunStatus.COMPLETED;
    });

    await harness.worker.drain();

    expect(harness.runToCompletion).toHaveBeenCalledTimes(1);
    expect(harness.markDone).not.toHaveBeenCalled();
    expect(harness.markAttemptFailed).not.toHaveBeenCalled();
    expect(harness.release).toHaveBeenCalledTimes(1);
  });

  it('spends the attempt when the source set cannot be read', async () => {
    const { worker, markAttemptFailed, runToCompletion } = build({
      pending: [row()],
      dueError: 'the database is down',
    });

    await worker.drain();

    expect(runToCompletion).not.toHaveBeenCalled();
    expect(markAttemptFailed).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '14013' }),
      expect.stringContaining('the database is down'),
      3,
      null
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
    // The source is named on the reason, so a row that failed for one of three
    // sources says which (section 2.2).
    expect(markAttemptFailed).toHaveBeenCalledWith(
      expect.objectContaining({ postalCode: '14013' }),
      'OpenStreetMap: Nominatim found no point for postal code 99999',
      3,
      null
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
