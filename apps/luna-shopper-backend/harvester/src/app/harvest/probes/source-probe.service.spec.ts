import type { ConfigService } from '@nestjs/config';
import {
  HarvestAlertKind,
  HarvestRunTrigger,
  SourceProbeStatus,
  type SourceProbeResult,
} from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotConfiguredException,
  NotFoundException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import type {
  HarvestRun,
  SourceProbe,
  SupermarketSource,
} from '../../entities';
import type { HarvestRunStore } from '../harvest-run.store';
import type { PlatformAdminService } from '../platform-admin.service';
import type { SupermarketSourceService } from '../supermarket-source.service';
import { toSourceProbeView } from './source-probe.mappers';
import type { SourceProbeDispatcher } from './source-probe.runner';
import { SourceProbeService } from './source-probe.service';
import type { ClaimedProbe } from './source-probe.store';
import { FakeSourceProbeStore } from './source-probe.store.fake';

/**
 * The probe service (plan 0219, sections 5, 6 and 8): the manual start and
 * each of its refusals, the answer before the probe ends, and `previousStatus`
 * and `changed` across a first probe, a repeat, a change and a recovery.
 */

const ADMIN = 'admin-1';
const CHAIN = 'chain-1';
const NOW = new Date('2026-11-05T10:00:00.000Z');

function source(over: Partial<SupermarketSource> = {}): SupermarketSource {
  return {
    id: 'source-1',
    supermarketId: CHAIN,
    adapterKey: 'mercadona-api',
    enabled: true,
    autoImportPlaces: false,
    config: {},
    workers: 4,
    maxRequestsPerSecond: 4,
    lastRunAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    ...over,
  } as SupermarketSource;
}

const passed: SourceProbeResult = {
  steps: [
    {
      name: 'listing',
      url: null,
      ok: true,
      httpStatus: null,
      error: null,
      problems: [],
      sample: { rows: 40 },
      durationMs: 3,
    },
  ],
  requests: 5,
};

const changedShape: SourceProbeResult = {
  steps: [
    {
      ...passed.steps[0],
      ok: false,
      problems: ['2 of 40 rows carried a price above zero'],
    },
  ],
  requests: 3,
};

function build(
  options: {
    row?: SupermarketSource | null;
    harvestEnabled?: boolean;
    activeRun?: Partial<HarvestRun> | null;
    /** What each probe answers, in order. */
    answers?: Array<SourceProbeResult | Promise<SourceProbeResult>>;
  } = {}
) {
  const store = new FakeSourceProbeStore();
  const row = options.row === undefined ? source() : options.row;
  const sourceWrites: unknown[] = [];
  const sources = {
    load: async () => {
      if (!row) {
        throw new NotFoundException(
          'That supermarket has no configured source.'
        );
      }
      return { ...row };
    },
    recordRunStarted: async (written: unknown) => sourceWrites.push(written),
    recordRunFinished: async (written: unknown) => sourceWrites.push(written),
  } as unknown as SupermarketSourceService;
  const runs = {
    findActiveBySupermarket: async () =>
      options.activeRun
        ? ({ id: 'run-1', ...options.activeRun } as HarvestRun)
        : null,
  } as unknown as HarvestRunStore;
  const answers = [...(options.answers ?? [passed])];
  const signals: AbortSignal[] = [];
  const dispatcher = {
    probe: async (_source: SupermarketSource, signal: AbortSignal) => {
      signals.push(signal);
      return answers.shift() ?? passed;
    },
  } as unknown as SourceProbeDispatcher;
  const admin = {
    requireAdmin: async () => ADMIN,
  } as unknown as PlatformAdminService;
  const config = {
    getOrThrow: () => ({ harvestEnabled: options.harvestEnabled ?? true }),
  } as unknown as ConfigService;
  let clock = NOW;
  const service = new SourceProbeService(
    store.asStore(),
    sources,
    runs,
    dispatcher,
    admin,
    config,
    () => clock
  );
  return {
    service,
    store,
    sourceWrites,
    signals,
    tick: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const req = { userId: ADMIN, adminToken: 'token', supermarketId: CHAIN };

describe('SourceProbeService.start', () => {
  it('answers the RUNNING row before the probe ends, as MANUAL and naming the user', async () => {
    let release!: (value: SourceProbeResult) => void;
    const pending = new Promise<SourceProbeResult>((resolve) => {
      release = resolve;
    });
    const { service, store } = build({ answers: [pending] });

    const view = await service.start(req);

    expect(view).toEqual(
      expect.objectContaining({
        status: SourceProbeStatus.RUNNING,
        trigger: HarvestRunTrigger.MANUAL,
        requestedByUserId: ADMIN,
        attempt: 1,
        sourceId: 'source-1',
        supermarketId: CHAIN,
        finishedAt: null,
        durationMs: null,
      })
    );
    expect(store.rows[0].status).toBe(SourceProbeStatus.RUNNING);

    release(passed);
    await flush();
    await flush();
    expect(store.rows[0]).toEqual(
      expect.objectContaining({
        status: SourceProbeStatus.PASSED,
        requests: 5,
        previousStatus: null,
        changed: false,
      })
    );
  });

  it('writes attempt 1 even after an UNREACHABLE series', async () => {
    const { service, store } = build();
    store.seed({
      sourceId: 'source-1',
      startedAt: new Date(NOW.getTime() - 60_000),
      status: SourceProbeStatus.UNREACHABLE,
      attempt: 2,
    });
    const view = await service.start(req);
    expect(view.attempt).toBe(1);
  });

  it('refuses while HARVEST_ENABLED is false, with the words of a run', async () => {
    const { service } = build({ harvestEnabled: false });
    await expect(service.start(req)).rejects.toThrow(NotConfiguredException);
    await expect(service.start(req)).rejects.toThrow(
      'Harvesting is disabled on this deployment (HARVEST_ENABLED is false).'
    );
  });

  it('refuses a chain with no source row', async () => {
    const { service } = build({ row: null });
    await expect(service.start(req)).rejects.toThrow(NotFoundException);
  });

  it('refuses an adapter with no probe, naming it', async () => {
    const { service } = build({ row: source({ adapterKey: 'manual' }) });
    await expect(service.start(req)).rejects.toThrow(ValidationException);
    await expect(service.start(req)).rejects.toThrow('"manual"');
  });

  it('refuses a row that is off (option (a) of O1)', async () => {
    const { service } = build({ row: source({ enabled: false }) });
    await expect(service.start(req)).rejects.toThrow(
      'That source is disabled. Enable it with supermarketSource.setEnabled.'
    );
  });

  it('refuses while a run of the chain is in flight', async () => {
    const { service, store } = build({ activeRun: { id: 'run-7' } });
    await expect(service.start(req)).rejects.toThrow(ConflictException);
    expect(store.rows).toEqual([]);
  });

  it('refuses while a probe of the source is running', async () => {
    const { service, store } = build();
    store.seed({
      sourceId: 'source-1',
      startedAt: NOW,
      status: SourceProbeStatus.RUNNING,
      finishedAt: null,
    });
    await expect(service.start(req)).rejects.toThrow(ConflictException);
    expect(store.rows).toHaveLength(1);
  });

  it('writes nothing to supermarket_sources', async () => {
    const { service, sourceWrites, store } = build();
    await service.start(req);
    await flush();
    await flush();
    // The probe ran to its end, so a throw that was logged cannot pass this.
    expect(store.rows).toEqual([
      expect.objectContaining({ status: SourceProbeStatus.PASSED }),
    ]);
    expect(sourceWrites).toEqual([]);
  });
});

describe('previousStatus and changed', () => {
  async function probeOnce(context: ReturnType<typeof build>) {
    context.tick(60_000);
    await context.service.start(req);
    await flush();
    await flush();
    return context.store.rows[context.store.rows.length - 1];
  }

  it('reads a first probe, a repeat, a change and a recovery, skipping ABORTED', async () => {
    const context = build({
      answers: [passed, passed, changedShape, passed],
    });

    const first = await probeOnce(context);
    expect(first).toEqual(
      expect.objectContaining({ previousStatus: null, changed: false })
    );

    const repeat = await probeOnce(context);
    expect(repeat).toEqual(
      expect.objectContaining({
        status: SourceProbeStatus.PASSED,
        previousStatus: SourceProbeStatus.PASSED,
        changed: false,
      })
    );

    const change = await probeOnce(context);
    expect(change).toEqual(
      expect.objectContaining({
        status: SourceProbeStatus.SHAPE_CHANGED,
        previousStatus: SourceProbeStatus.PASSED,
        changed: true,
        error: 'listing: 2 of 40 rows carried a price above zero',
      })
    );

    // An aborted probe after the change is not the previous status of the
    // recovery: the change it follows is.
    context.tick(60_000);
    context.store.seed({
      sourceId: 'source-1',
      startedAt: new Date(NOW.getTime() + 3.5 * 60_000),
      status: SourceProbeStatus.ABORTED,
    });

    const recovery = await probeOnce(context);
    expect(recovery).toEqual(
      expect.objectContaining({
        status: SourceProbeStatus.PASSED,
        previousStatus: SourceProbeStatus.SHAPE_CHANGED,
        changed: true,
      })
    );
  });
});

describe('SourceProbeService shutdown', () => {
  it('aborts the probe in flight and writes it ABORTED, never a change', async () => {
    let seen!: AbortSignal;
    const context = build();
    (
      context.service as unknown as { dispatcher: SourceProbeDispatcher }
    ).dispatcher = {
      probe: (_source: SupermarketSource, signal: AbortSignal) =>
        new Promise<SourceProbeResult>((resolve) => {
          seen = signal;
          signal.addEventListener('abort', () =>
            resolve({ steps: [], requests: 1 })
          );
        }),
    } as unknown as SourceProbeDispatcher;
    context.store.seed({
      sourceId: 'source-1',
      startedAt: new Date(NOW.getTime() - 86_400_000),
      status: SourceProbeStatus.PASSED,
    });

    await context.service.start(req);
    context.service.onApplicationShutdown();
    await flush();
    await flush();

    expect(seen.aborted).toBe(true);
    expect(context.store.rows[1]).toEqual(
      expect.objectContaining({
        status: SourceProbeStatus.ABORTED,
        changed: false,
      })
    );
  });

  it('writes a dispatcher failure as ERROR', async () => {
    const context = build();
    (
      context.service as unknown as { dispatcher: SourceProbeDispatcher }
    ).dispatcher = {
      probe: async () => {
        throw new Error('The adapter "osm-places" has no probe.');
      },
    } as unknown as SourceProbeDispatcher;

    await context.service.start(req);
    await flush();

    expect(context.store.rows[0]).toEqual(
      expect.objectContaining({
        status: SourceProbeStatus.ERROR,
        error: 'probe: The adapter "osm-places" has no probe.',
      })
    );
  });
});

describe('SourceProbeService reads', () => {
  it('lists the probes of a chain newest first and reads one', async () => {
    const { service, store } = build();
    store.seed({
      sourceId: 'source-1',
      startedAt: new Date('2026-11-01T00:00:00Z'),
    });
    const newest = store.seed({
      sourceId: 'source-1',
      startedAt: new Date('2026-11-02T00:00:00Z'),
    });

    const page = await service.list({ ...req, limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual([newest.id]);
    expect(page.nextCursor).toEqual(expect.any(String));

    const one = await service.get({ ...req, probeId: newest.id });
    expect(one.id).toBe(newest.id);
    expect(one.durationMs).toBe(0);
  });
});

describe('SourceProbeService.runForSchedule (plan 0247)', () => {
  const unreachable: SourceProbeResult = {
    steps: [{ ...passed.steps[0], ok: false, httpStatus: 503 }],
    requests: 1,
  };

  it('runs a SCHEDULED probe with no user, waits for it and answers the finished row', async () => {
    const context = build({ answers: [passed] });

    const probe = await context.service.runForSchedule(source(), 'schedule-1');

    expect(probe).toEqual(
      expect.objectContaining({
        trigger: HarvestRunTrigger.SCHEDULED,
        requestedByUserId: null,
        status: SourceProbeStatus.PASSED,
        attempt: 1,
      })
    );
    expect(context.store.alerts).toEqual([]);
  });

  it('carries the attempt of the series after an UNREACHABLE probe, with the interval ignored', async () => {
    const context = build({ answers: [unreachable] });
    context.store.seed({
      sourceId: 'source-1',
      startedAt: new Date(NOW.getTime() - 60_000),
      status: SourceProbeStatus.UNREACHABLE,
      attempt: 2,
    });

    const probe = await context.service.runForSchedule(source(), 'schedule-1');

    expect(probe).toEqual(
      expect.objectContaining({
        status: SourceProbeStatus.UNREACHABLE,
        attempt: 3,
      })
    );
    // The third attempt of the series is the one that alerts (section 4.1).
    expect(context.store.alerts).toEqual([
      expect.objectContaining({
        kind: HarvestAlertKind.PROBE_FAILED,
        dedupeKey: `probe:${probe?.id}`,
      }),
    ]);
  });

  it('passes the draft to finish for a change to SHAPE_CHANGED, and none for a first attempt UNREACHABLE', async () => {
    const changed = build({ answers: [changedShape] });
    changed.store.seed({
      sourceId: 'source-1',
      startedAt: new Date(NOW.getTime() - 86_400_000),
      status: SourceProbeStatus.PASSED,
    });
    const red = await changed.service.runForSchedule(source(), 'schedule-1');
    expect(changed.store.alerts).toEqual([
      expect.objectContaining({
        kind: HarvestAlertKind.PROBE_FAILED,
        dedupeKey: `probe:${red?.id}`,
        payload: expect.objectContaining({
          status: SourceProbeStatus.SHAPE_CHANGED,
          changed: true,
        }),
      }),
    ]);

    const first = build({ answers: [unreachable] });
    await first.service.runForSchedule(source(), 'schedule-1');
    expect(first.store.alerts).toEqual([]);
  });

  it('answers null and runs nothing while a probe of the source is RUNNING', async () => {
    const context = build();
    context.store.seed({
      sourceId: 'source-1',
      startedAt: NOW,
      status: SourceProbeStatus.RUNNING,
      finishedAt: null,
    });

    await expect(
      context.service.runForSchedule(source(), 'schedule-1')
    ).resolves.toBeNull();
    expect(context.signals).toHaveLength(0);
  });

  it('writes the schedule id on the gate probe row and on the view (the owner, 2026-11-06)', async () => {
    const context = build({ answers: [passed] });

    const probe = await context.service.runForSchedule(source(), 'schedule-1');

    expect(probe?.scheduleId).toBe('schedule-1');
    expect(context.store.rows[0].scheduleId).toBe('schedule-1');
    expect(toSourceProbeView(probe as SourceProbe).scheduleId).toBe(
      'schedule-1'
    );
  });

  it('writes no schedule id for a daily probe or a manual probe', async () => {
    const daily = build({ answers: [passed] });
    daily.store.sources = [source()];
    const claimed = await daily.store.claimDue(NOW, ['mercadona-api']);
    expect(claimed).not.toBeNull();
    await daily.service.runClaimed(claimed as ClaimedProbe);
    expect(daily.store.rows[0]).toEqual(
      expect.objectContaining({
        trigger: HarvestRunTrigger.SCHEDULED,
        status: SourceProbeStatus.PASSED,
        scheduleId: null,
      })
    );

    const manual = build({ answers: [passed] });
    const view = await manual.service.start(req);
    await flush();
    await flush();
    expect(view.scheduleId).toBeNull();
    expect(manual.store.rows[0]).toEqual(
      expect.objectContaining({
        trigger: HarvestRunTrigger.MANUAL,
        scheduleId: null,
      })
    );
  });

  it('writes the alert of a manual probe too', async () => {
    const context = build({ answers: [changedShape] });
    context.store.seed({
      sourceId: 'source-1',
      startedAt: new Date(NOW.getTime() - 86_400_000),
      status: SourceProbeStatus.PASSED,
    });

    await context.service.start(req);
    await flush();
    await flush();

    expect(context.store.alerts).toHaveLength(1);
  });
});
