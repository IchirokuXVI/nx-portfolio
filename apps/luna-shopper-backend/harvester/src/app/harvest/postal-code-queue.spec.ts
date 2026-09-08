import { ConfigService } from '@nestjs/config';
import {
  DiscoveredPlaceStatus,
  PostalCodeDiscoveryStatus,
  PostalCodeSource,
  type NearbyPostalCodesView,
} from '@portfolio/luna-shopper/contracts';
import {
  ForbiddenException,
  PostalCodeUnknownException,
  RunInProgressException,
} from '@portfolio/luna-shopper/platform';
import type { Repository } from 'typeorm';
import type { HarvesterConfig } from '../config/app-config';
import type { DiscoveredPlace, PostalCodeDiscoveryRequest } from '../entities';
import type { CatalogClient } from './catalog-client.service';
import type { PlatformAdminService } from './platform-admin.service';
import { PostalCodeDiscoveryService } from './postal-code-discovery.service';
import type { PostalCodeDiscoveryStore } from './postal-code-discovery.store';
import { OsmStoreDiscoveryRunner } from './osm-store-discovery.runner';

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
    requireAdmin: (credential: { userId?: string }) => {
      if (credential.userId !== ADMIN) {
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
    status: PostalCodeDiscoveryStatus.DONE,
    requestedAt: new Date('2026-09-01T09:00:00.000Z'),
    lastAttemptedAt: new Date('2026-09-01T09:00:00.000Z'),
    discoveredAt: new Date('2026-09-01T09:30:00.000Z'),
    nextAttemptAt: null,
    attempts: 1,
    runId: 'run-1',
    error: null,
    placeName: '14013, Córdoba, Andalucía, España',
    dismissed: false,
    createdAt: new Date('2026-09-01T09:00:00.000Z'),
    updatedAt: new Date('2026-09-01T09:30:00.000Z'),
    ...overrides,
  } as PostalCodeDiscoveryRequest;
}

/** One row of either grouped count query. */
function count(
  country: string,
  postalCode: string,
  status: DiscoveredPlaceStatus,
  n: number
) {
  return { country, postalCode, status, count: String(n) };
}

/**
 * A repository that answers the two grouped queries in the order the service
 * asks them: found by its runs first, located in it second.
 */
function places(found: unknown[] = [], located: unknown[] = []) {
  const answers = [found, located];
  const query = jest.fn(async () => answers.shift() ?? []);
  return {
    repository: { query } as unknown as Repository<DiscoveredPlace>,
    query,
  };
}

function catalogHolding(known: boolean): CatalogClient {
  return {
    nearbyPostalCodes: jest.fn(
      async (): Promise<NearbyPostalCodesView> => ({
        country: 'es',
        postalCode: '14013',
        known,
        postalCodes: [],
      })
    ),
  } as unknown as CatalogClient;
}

describe('The postal code queue as a screen (plan 0097)', () => {
  function build(options: {
    rows?: PostalCodeDiscoveryRequest[];
    found?: unknown[];
    located?: unknown[];
    store?: Partial<PostalCodeDiscoveryStore>;
    catalog?: CatalogClient;
    config?: Partial<HarvesterConfig>;
  }) {
    const qb = {
      orderBy: jest.fn(() => qb),
      addOrderBy: jest.fn(() => qb),
      take: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      getMany: jest.fn(async () => options.rows ?? []),
    };
    const repository = jest.fn(() => ({
      createQueryBuilder: jest.fn(() => qb),
    }));
    const store = {
      repository,
      ...options.store,
    } as unknown as PostalCodeDiscoveryStore;
    const placeRepo = places(options.found, options.located);
    const service = new PostalCodeDiscoveryService(
      store,
      placeRepo.repository,
      options.catalog ?? catalogHolding(true),
      admin(),
      configOf(settings(options.config))
    );
    return { service, qb, query: placeRepo.query };
  }

  // --- Section 2: the four numbers, twice ----------------------------------

  it('counts a run centred on one code and a place located in another apart', async () => {
    // The disagreement is the point of showing both. A run centred on 14013
    // with a radius returns places in 14010, so 14013 caused that work and
    // 14010 is where somebody would be shown the shop.
    const { service } = build({
      rows: [row({ id: 'q-1', postalCode: '14013' })],
      found: [count('es', '14013', DiscoveredPlaceStatus.NEW, 7)],
      located: [count('es', '14013', DiscoveredPlaceStatus.IMPORTED, 2)],
    });

    const page = await service.list({ userId: ADMIN });

    expect(page.items[0].foundByItsRuns).toEqual({
      total: 7,
      imported: 0,
      rejected: 0,
      undecided: 7,
    });
    expect(page.items[0].locatedInIt).toEqual({
      total: 2,
      imported: 2,
      rejected: 0,
      undecided: 0,
    });
  });

  it('splits one code’s places by what became of them', async () => {
    const { service } = build({
      rows: [row()],
      found: [
        count('es', '14013', DiscoveredPlaceStatus.NEW, 5),
        count('es', '14013', DiscoveredPlaceStatus.IMPORTED, 3),
        count('es', '14013', DiscoveredPlaceStatus.REJECTED, 1),
      ],
    });

    const page = await service.list({ userId: ADMIN });

    expect(page.items[0].foundByItsRuns).toEqual({
      total: 9,
      imported: 3,
      rejected: 1,
      undecided: 5,
    });
  });

  it('answers zeros for a code no run has produced a place for', async () => {
    const { service } = build({ rows: [row()] });

    const page = await service.list({ userId: ADMIN });

    expect(page.items[0].foundByItsRuns.total).toBe(0);
    expect(page.items[0].locatedInIt.total).toBe(0);
  });

  it('asks for a whole page of counts in two queries, not two per row', async () => {
    const { service, query } = build({
      rows: [
        row({ id: 'q-1', postalCode: '14013' }),
        row({ id: 'q-2', postalCode: '14010' }),
        row({ id: 'q-3', postalCode: '14011' }),
      ],
    });

    await service.list({ userId: ADMIN });

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('carries the name a run kept and the dismissed flag onto the row', async () => {
    const { service } = build({ rows: [row()] });

    const page = await service.list({ userId: ADMIN });

    expect(page.items[0].placeName).toBe('14013, Córdoba, Andalucía, España');
    expect(page.items[0].dismissed).toBe(false);
  });

  // --- Section 7: what the listing filters on ------------------------------

  it('lists the undismissed rows unless asked for the others', async () => {
    const { service, qb } = build({ rows: [] });

    await service.list({ userId: ADMIN });

    expect(qb.andWhere).toHaveBeenCalledWith('q.dismissed = :dismissed', {
      dismissed: false,
    });
  });

  it('lists the dismissed rows alone when asked', async () => {
    const { service, qb } = build({ rows: [] });

    await service.list({ userId: ADMIN, dismissed: true });

    expect(qb.andWhere).toHaveBeenCalledWith('q.dismissed = :dismissed', {
      dismissed: true,
    });
  });

  it('matches a typed code as a prefix', async () => {
    const { service, qb } = build({ rows: [] });

    await service.list({ userId: ADMIN, postalCode: '140' });

    expect(qb.andWhere).toHaveBeenCalledWith('q."postalCode" LIKE :prefix', {
      prefix: '140%',
    });
  });

  it('refuses the listing to anybody but an operator', async () => {
    const { service } = build({ rows: [] });

    await expect(service.list({ userId: 'somebody' })).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  // --- Section 6.1: adding a code ------------------------------------------

  it('refuses a code catalog does not hold and writes nothing', async () => {
    const add = jest.fn();
    const { service } = build({
      store: { add } as Partial<PostalCodeDiscoveryStore>,
      catalog: catalogHolding(false),
    });

    await expect(
      service.add({
        userId: ADMIN,
        country: 'es',
        postalCode: '99999',
        discoverNow: true,
      })
    ).rejects.toBeInstanceOf(PostalCodeUnknownException);
    expect(add).not.toHaveBeenCalled();
  });

  it('queues a code it holds, or parks it', async () => {
    const add = jest.fn(async () =>
      row({ status: PostalCodeDiscoveryStatus.PARKED })
    );
    const { service } = build({
      store: { add } as unknown as Partial<PostalCodeDiscoveryStore>,
    });

    const view = await service.add({
      userId: ADMIN,
      country: ' ES ',
      postalCode: ' 14013 ',
      discoverNow: false,
    });

    expect(add).toHaveBeenCalledWith('es', '14013', false);
    expect(view.status).toBe(PostalCodeDiscoveryStatus.PARKED);
  });

  // --- Section 6.2: discovering it again -----------------------------------

  it('clears the backoff of a failed row and queues it inside the cooldown', async () => {
    const failed = row({
      status: PostalCodeDiscoveryStatus.FAILED,
      attempts: 3,
      error: 'Nominatim found no point',
      nextAttemptAt: new Date('2026-09-02T09:00:00.000Z'),
    });
    const requeue = jest.fn(async () => undefined);
    const byId = jest.fn(async () => failed);
    const { service } = build({
      store: { requeue, byId } as unknown as Partial<PostalCodeDiscoveryStore>,
    });

    await service.requeue({ userId: ADMIN, requestId: 'q-1' });

    // The cooldown is never consulted: an operator who has just imported a
    // chain wants to look again today, which is the whole reason this exists.
    expect(requeue).toHaveBeenCalledWith(failed);
  });

  it('refuses to requeue a row that is running', async () => {
    const requeue = jest.fn();
    const byId = jest.fn(async () =>
      row({ status: PostalCodeDiscoveryStatus.RUNNING })
    );
    const { service } = build({
      store: { requeue, byId } as unknown as Partial<PostalCodeDiscoveryStore>,
    });

    await expect(
      service.requeue({ userId: ADMIN, requestId: 'q-1' })
    ).rejects.toBeInstanceOf(RunInProgressException);
    expect(requeue).not.toHaveBeenCalled();
  });

  // --- Section 6.3: dismissing ---------------------------------------------

  it('dismisses a row without deleting it', async () => {
    const setDismissed = jest.fn(async () => undefined);
    const byId = jest.fn(async () => row({ dismissed: true }));
    const { service } = build({
      store: {
        setDismissed,
        byId,
      } as unknown as Partial<PostalCodeDiscoveryStore>,
    });

    const view = await service.dismiss({ userId: ADMIN, requestId: 'q-1' });

    expect(setDismissed).toHaveBeenCalledWith('q-1', true);
    expect(view.dismissed).toBe(true);
  });

  // --- Section 7.1: the summary --------------------------------------------

  it('reports draining false when HARVEST_ENABLED is false', async () => {
    const summarize = jest.fn(async () => ({
      byStatus: {
        [PostalCodeDiscoveryStatus.QUEUED]: 4,
        [PostalCodeDiscoveryStatus.RUNNING]: 0,
        [PostalCodeDiscoveryStatus.DONE]: 11,
        [PostalCodeDiscoveryStatus.FAILED]: 1,
        [PostalCodeDiscoveryStatus.PARKED]: 2,
      },
      oldestQueuedAt: new Date('2026-09-01T09:00:00.000Z'),
    }));
    const { service } = build({
      store: { summarize } as unknown as Partial<PostalCodeDiscoveryStore>,
      config: { harvestEnabled: false },
    });

    const summary = await service.summary({ userId: ADMIN });

    // A queue that fills and never empties is the designed behaviour here, and
    // the screen has to be able to say so rather than let somebody watch a row
    // sit at QUEUED for a week.
    expect(summary.draining).toBe(false);
    expect(summary).toMatchObject({
      queued: 4,
      done: 11,
      failed: 1,
      parked: 2,
      oldestQueuedAt: '2026-09-01T09:00:00.000Z',
    });
  });

  it('reports no oldest queued row when nothing waits', async () => {
    const summarize = jest.fn(async () => ({
      byStatus: {
        [PostalCodeDiscoveryStatus.QUEUED]: 0,
        [PostalCodeDiscoveryStatus.RUNNING]: 0,
        [PostalCodeDiscoveryStatus.DONE]: 3,
        [PostalCodeDiscoveryStatus.FAILED]: 0,
        [PostalCodeDiscoveryStatus.PARKED]: 0,
      },
      oldestQueuedAt: null,
    }));
    const { service } = build({
      store: { summarize } as unknown as Partial<PostalCodeDiscoveryStore>,
    });

    await expect(service.summary({ userId: ADMIN })).resolves.toMatchObject({
      oldestQueuedAt: null,
      draining: true,
    });
  });
});

// --- Section 3: a place takes the nearest centroid --------------------------

describe('OsmStoreDiscoveryRunner and the postal code it writes (plan 0097)', () => {
  /**
   * The runner is exercised through {@link OsmStoreDiscoveryRunner.locate}, which
   * is private and reached here by name.
   *
   * The alternative is faking Nominatim and Overpass to reach three lines of
   * branching, which is what `osm-places` fixtures already cover, and the rule
   * being tested is about catalog rather than about either of them.
   */
  function locate(
    runner: OsmStoreDiscoveryRunner,
    place: { postalCode: string | null; latitude: number; longitude: number },
    country: string
  ) {
    return (
      runner as unknown as {
        locate: (
          place: unknown,
          country: string,
          config: HarvesterConfig
        ) => Promise<{
          postalCode: string | null;
          postalCodeSource: PostalCodeSource | null;
        }>;
      }
    ).locate(place, country, settings());
  }

  function build(
    nearest: { postalCode: string; distanceMetres: number } | null
  ) {
    const resolveNearestPostalCode = jest.fn(async () => ({
      country: 'es',
      nearest,
    }));
    const catalog = { resolveNearestPostalCode } as unknown as CatalogClient;
    const recordPlaceName = jest.fn(async () => undefined);
    const queue = { recordPlaceName } as unknown as PostalCodeDiscoveryStore;
    const runner = new OsmStoreDiscoveryRunner(
      {} as unknown as Repository<DiscoveredPlace>,
      queue,
      catalog,
      configOf(settings())
    );
    return { runner, resolveNearestPostalCode, recordPlaceName };
  }

  it('keeps the tag a place already carried and asks catalog nothing', async () => {
    const { runner, resolveNearestPostalCode } = build(null);

    await expect(
      locate(
        runner,
        { postalCode: '14013', latitude: 37.9, longitude: -4.8 },
        'es'
      )
    ).resolves.toEqual({
      postalCode: '14013',
      postalCodeSource: PostalCodeSource.SOURCE,
    });
    // A source value is never overridden by a guess.
    expect(resolveNearestPostalCode).not.toHaveBeenCalled();
  });

  it('derives a code for an untagged place, flagged DERIVED', async () => {
    const { runner, resolveNearestPostalCode } = build({
      postalCode: '14010',
      distanceMetres: 800,
    });

    await expect(
      locate(
        runner,
        { postalCode: null, latitude: 37.9, longitude: -4.8 },
        'es'
      )
    ).resolves.toEqual({
      postalCode: '14010',
      postalCodeSource: PostalCodeSource.DERIVED,
    });
    expect(resolveNearestPostalCode).toHaveBeenCalledWith(
      'es',
      37.9,
      -4.8,
      5000
    );
  });

  it('keeps both columns null when nothing is within the bound', async () => {
    // A wrong postcode is worse than none: it puts the shop in somebody else's
    // list, where none only makes the price say it is approximate.
    const { runner } = build(null);

    await expect(
      locate(
        runner,
        { postalCode: null, latitude: 37.9, longitude: -4.8 },
        'es'
      )
    ).resolves.toEqual({ postalCode: null, postalCodeSource: null });
  });

  it('does not fail the run when catalog cannot answer', async () => {
    const catalog = {
      resolveNearestPostalCode: jest.fn(async () => {
        throw new Error('catalog is down');
      }),
    } as unknown as CatalogClient;
    const runner = new OsmStoreDiscoveryRunner(
      {} as unknown as Repository<DiscoveredPlace>,
      {} as unknown as PostalCodeDiscoveryStore,
      catalog,
      configOf(settings())
    );

    await expect(
      locate(
        runner,
        { postalCode: null, latitude: 37.9, longitude: -4.8 },
        'es'
      )
    ).resolves.toEqual({ postalCode: null, postalCodeSource: null });
  });
});
