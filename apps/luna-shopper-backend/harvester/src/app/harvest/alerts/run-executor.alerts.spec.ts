import type { ConfigService } from '@nestjs/config';
import {
  HarvestAlertKind,
  HarvestRunMode,
  HarvestRunStatus,
  HarvestRunStopReason,
  HarvestRunTrigger,
  type HarvestRunWarning,
} from '@portfolio/luna-shopper/contracts';
import { SourceBlockedError } from '@portfolio/luna-shopper/source-guard';
import type { HarvesterConfig } from '../../config/app-config';
import type { HarvestRun, SupermarketSource } from '../../entities';
import type { CatalogDiscoveryRunner } from '../catalog-discovery.runner';
import type { HarvestRunStore } from '../harvest-run.store';
import type { PriceScopeResolver } from '../price-scope-resolver';
import type { RunContext } from '../run-context';
import { RunExecutor, SHUTDOWN_STOPPED_RUN } from '../run-executor.service';
import { RunReportSink } from '../run-report.sink';
import type { SupermarketSourceService } from '../supermarket-source.service';
import type { HarvestAlertDraft } from './harvest-alert.rules';

jest.mock('../run-report.sink', () => ({ RunReportSink: jest.fn() }));

/**
 * The alert in the run's final write (plan 0218, sections 2 and 4.1).
 *
 * The runner, the sink and the store are fakes, so what is pinned is the
 * executor's finalizer: which run passes a draft to `finish`, and which
 * passes exactly the arguments it passed before this plan.
 */

const CHAIN = '02180218-0000-4000-a000-000000000001';

type Behaviour =
  /** Returns with 30 of 100 items failed, over the 0.25 ratio. */
  | 'ratio'
  /** Waits until the run is aborted, then throws. */
  | 'waits'
  /** Refuses five times so the guard stops the run, then returns or throws. */
  | 'refused-returns'
  | 'refused-throws';

function build(
  behaviour: Behaviour,
  options: {
    trigger?: HarvestRunTrigger;
    adapterKey?: string;
    consecutiveFailures?: number;
    enabledSchedules?: number | Error;
    presetId?: string;
    presetName?: string | Error | null;
  } = {}
) {
  let row = {
    id: 'run-1',
    mode: HarvestRunMode.CATALOG_DISCOVERY,
    trigger: options.trigger ?? HarvestRunTrigger.MANUAL,
    supermarketId: CHAIN,
    priceScopeId: null,
    presetId: options.presetId ?? null,
    scheduleId: null,
    requestedAt: new Date('2026-11-05T03:00:00.000Z'),
    startedAt: new Date('2026-11-05T03:00:01.000Z'),
    input: {},
    report: {} as Record<string, unknown>,
    failed: behaviour === 'ratio' ? 30 : 0,
    totalPlanned: 100,
    warnings: [] as HarvestRunWarning[],
  } as unknown as HarvestRun;

  const countEnabledSchedules = jest.fn(async () => {
    if (options.enabledSchedules instanceof Error) {
      throw options.enabledSchedules;
    }
    return options.enabledSchedules ?? 0;
  });
  const store = {
    load: jest.fn(async () => row),
    markRunning: jest.fn(async () => undefined),
    isAbortRequested: jest.fn(async () => false),
    touchHeartbeat: jest.fn(async () => undefined),
    addCounters: jest.fn(async () => undefined),
    addWarnings: jest.fn(async (_id: string, warnings: HarvestRunWarning[]) => {
      row.warnings.push(...warnings);
    }),
    setStage: jest.fn(async () => undefined),
    setReport: jest.fn(async (_id: string, report: Record<string, unknown>) => {
      row = { ...row, report } as HarvestRun;
    }),
    finish: jest.fn(async () => undefined),
    countEnabledSchedules,
    presetNameOf: jest.fn(async () => {
      if (options.presetName instanceof Error) {
        throw options.presetName;
      }
      return options.presetName ?? null;
    }),
  } as unknown as HarvestRunStore & { finish: jest.Mock };

  const source = {
    id: 'src-1',
    supermarketId: CHAIN,
    adapterKey: options.adapterKey ?? 'dia-api',
    maxRequestsPerSecond: 100,
    workers: 4,
    config: {},
    consecutiveFailures: options.consecutiveFailures ?? 0,
  } as unknown as SupermarketSource;
  const sources = {
    findBySupermarket: jest.fn(async () => source),
    recordRunStarted: jest.fn(async () => undefined),
    recordRunFinished: jest.fn(async () => undefined),
  } as unknown as SupermarketSourceService;

  (RunReportSink as unknown as jest.Mock).mockImplementation(() => ({
    drain: jest.fn(async () => ({
      products: 3,
      pricedScopes: [],
      pricesCopied: {},
      availabilityCopied: {},
    })),
    delistingListings: () => ({ whole: [], notWhole: [] }),
  }));

  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  const catalogDiscovery = {
    run: jest.fn(async (context: RunContext) => {
      if (behaviour === 'ratio') {
        return;
      }
      if (behaviour === 'waits') {
        started();
        await new Promise((_, reject) =>
          context.signal.addEventListener('abort', () =>
            reject(new Error('The run was aborted.'))
          )
        );
        return;
      }
      await context.acquire();
      try {
        for (const n of [1, 2, 3, 4, 5]) {
          context.guard?.refused(403, `https://shop.test/p/${n}`);
        }
        await context.acquire();
      } catch (error) {
        if (
          behaviour === 'refused-throws' ||
          !(error instanceof SourceBlockedError)
        ) {
          throw error;
        }
      }
    }),
  } as unknown as CatalogDiscoveryRunner;

  const config = {
    getOrThrow: () =>
      ({
        defaultMaxRequestsPerSecond: 4,
        failureRatio: 0.25,
        postalCodeDeriveMaxMetres: 5000,
      }) as HarvesterConfig,
  } as unknown as ConfigService;

  const executor = new RunExecutor(
    { find: jest.fn(async () => []) } as never,
    store,
    sources,
    undefined as never,
    catalogDiscovery,
    undefined as never,
    undefined as never,
    { forRun: () => null } as unknown as PriceScopeResolver,
    undefined as never,
    undefined as never,
    undefined as never,
    config,
    undefined as never
  );
  return { executor, store, running, countEnabledSchedules };
}

/** The draft the one `finish` call passed, or undefined. */
function draftOf(finish: jest.Mock): HarvestAlertDraft | undefined {
  expect(finish).toHaveBeenCalledTimes(1);
  return finish.mock.calls[0][4] as HarvestAlertDraft | undefined;
}

describe('RunExecutor and the owner alert (plan 0218)', () => {
  it('names the preset of a failed run, and keeps the alert when the name cannot be read (plan 0255)', async () => {
    const named = build('ratio', {
      presetId: 'preset-1',
      presetName: 'Weekly DIA',
    });
    await named.executor.runToCompletion('run-1');
    expect(draftOf(named.store.finish)?.payload).toMatchObject({
      presetId: 'preset-1',
      presetName: 'Weekly DIA',
    });

    const unread = build('ratio', {
      presetId: 'preset-1',
      presetName: new Error('connection lost'),
    });
    await unread.executor.runToCompletion('run-1');
    expect(draftOf(unread.store.finish)).toMatchObject({
      kind: HarvestAlertKind.RUN_FAILED,
      payload: expect.objectContaining({
        presetId: 'preset-1',
        presetName: null,
      }),
    });
  });

  it('passes a RUN_FAILED draft to finish for a run that fails on the ratio', async () => {
    const { executor, store, countEnabledSchedules } = build('ratio');

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );

    const [, status, error, reason] = store.finish.mock.calls[0];
    expect(status).toBe(HarvestRunStatus.FAILED);
    expect(error).toBe(
      '30 of 100 items failed, which is over the 0.25 threshold.'
    );
    expect(reason).toBeUndefined();
    expect(draftOf(store.finish)).toMatchObject({
      kind: HarvestAlertKind.RUN_FAILED,
      dedupeKey: 'run:run-1',
      runId: 'run-1',
      supermarketId: CHAIN,
      payload: expect.objectContaining({
        trigger: HarvestRunTrigger.MANUAL,
        failed: 30,
        totalPlanned: 100,
        adapterKey: 'dia-api',
        error,
        schedulesStopped: null,
      }),
    });
    // The counter is 0, so the schedules are not counted.
    expect(countEnabledSchedules).not.toHaveBeenCalled();
  });

  it('passes no draft for a run the shutdown hook aborted', async () => {
    const { executor, store, running } = build('waits', {
      trigger: HarvestRunTrigger.SCHEDULED,
    });

    const finished = executor.runToCompletion('run-1');
    await running;
    executor.onApplicationShutdown();

    await expect(finished).resolves.toBe(HarvestRunStatus.ABORTED);
    expect(store.finish).toHaveBeenCalledWith(
      'run-1',
      HarvestRunStatus.ABORTED,
      SHUTDOWN_STOPPED_RUN
    );
  });

  it.each(['refused-returns', 'refused-throws'] as const)(
    'gives RUN_BLOCKED for a run the guard stopped, when the runner %s',
    async (behaviour) => {
      const { executor, store } = build(behaviour);

      await expect(executor.runToCompletion('run-1')).resolves.toBe(
        HarvestRunStatus.FAILED
      );

      const [, , error, reason] = store.finish.mock.calls[0];
      expect(reason).toBe(HarvestRunStopReason.SOURCE_BLOCKED);
      expect(draftOf(store.finish)).toMatchObject({
        kind: HarvestAlertKind.RUN_BLOCKED,
        payload: expect.objectContaining({ error }),
      });
    }
  );

  it('says the schedules stopped when a SYSTEM run takes the counter from 2 to 3', async () => {
    const { executor, store, countEnabledSchedules } = build('ratio', {
      trigger: HarvestRunTrigger.SYSTEM,
      consecutiveFailures: 2,
      enabledSchedules: 2,
    });

    await executor.runToCompletion('run-1');

    expect(countEnabledSchedules).toHaveBeenCalledWith(CHAIN);
    expect(draftOf(store.finish)?.payload['schedulesStopped']).toBe(2);
  });

  it('finishes a SYSTEM run that stops nothing exactly as before, with no draft', async () => {
    const { executor, store } = build('ratio', {
      trigger: HarvestRunTrigger.SYSTEM,
    });

    await executor.runToCompletion('run-1');

    expect(store.finish).toHaveBeenCalledWith(
      'run-1',
      HarvestRunStatus.FAILED,
      expect.any(String)
    );
  });

  it('still finishes the run when the alert cannot be decided', async () => {
    const { executor, store } = build('ratio', {
      consecutiveFailures: 2,
      enabledSchedules: new Error('the database blinked'),
    });

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );
    expect(store.finish).toHaveBeenCalledWith(
      'run-1',
      HarvestRunStatus.FAILED,
      expect.any(String)
    );
  });
});
