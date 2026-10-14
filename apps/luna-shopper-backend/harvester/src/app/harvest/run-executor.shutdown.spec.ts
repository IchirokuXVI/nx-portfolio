import type { ConfigService } from '@nestjs/config';
import {
  HarvestRunMode,
  HarvestRunStatus,
  PriceSourceKind,
} from '@portfolio/luna-shopper/contracts';
import type { HarvesterConfig } from '../config/app-config';
import type { HarvestRun, SupermarketSource } from '../entities';
import type { FileImportRunner } from './file-import.runner';
import type { HarvestRunStore } from './harvest-run.store';
import type { RunContext } from './run-context';
import { RunExecutor, SHUTDOWN_STOPPED_RUN } from './run-executor.service';
import type { SupermarketSourceService } from './supermarket-source.service';

/**
 * How a run ends when it is stopped (plan 0206, sections 6 and 7).
 *
 * - **An abort is not a failure of the source**, whether a person stopped the
 *   run or a shutdown did, in both of the branches that finish a run.
 * - **A run the shutdown hook stopped says so** in its `error`, and that
 *   sentence wins over the message the abort made the runner throw.
 *
 * A file import is the run driven here, because it has no sink: the fake
 * runner waits for the abort and then either throws, as a fetch cut off
 * mid request does, or returns what it had, as a runner that flushes does.
 */

const CHAIN = '02060206-0000-4000-a000-000000000001';

type Ending = 'throws' | 'returns';

function build(ending: Ending = 'throws') {
  const run = {
    id: 'run-1',
    mode: HarvestRunMode.FILE_IMPORT,
    supermarketId: CHAIN,
    priceScopeId: '02060206-0000-4000-a000-0000000000ff',
    input: { sourceKind: PriceSourceKind.OFFICIAL_LEAFLET },
    report: {},
    failed: 0,
    totalPlanned: null,
  } as unknown as HarvestRun;

  const store = {
    load: jest.fn(async () => run),
    markRunning: jest.fn(async () => undefined),
    isAbortRequested: jest.fn(async () => false),
    touchHeartbeat: jest.fn(async () => undefined),
    addCounters: jest.fn(async () => undefined),
    addWarnings: jest.fn(async () => undefined),
    setReport: jest.fn(async () => undefined),
    finish: jest.fn(async () => undefined),
  } as unknown as HarvestRunStore;

  const source = {
    id: 'src-1',
    supermarketId: CHAIN,
    adapterKey: 'mercadona-api',
    maxRequestsPerSecond: 4,
    consecutiveFailures: 1,
  } as SupermarketSource;
  const sources = {
    findBySupermarket: jest.fn(async () => source),
    recordRunStarted: jest.fn(async () => undefined),
    recordRunFinished: jest.fn(async () => undefined),
  } as unknown as SupermarketSourceService;

  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  const fileImport = {
    run: jest.fn(
      (context: RunContext) =>
        new Promise((resolve, reject) => {
          started();
          context.signal.addEventListener('abort', () => {
            if (ending === 'throws') {
              reject(new Error('The operation was aborted.'));
            } else {
              resolve({
                pricesRecorded: 0,
                pricesWritten: 0,
                pricesConfirmed: 0,
                pricesConflicted: 0,
              });
            }
          });
        })
    ),
  } as unknown as FileImportRunner;

  const config = {
    getOrThrow: () =>
      ({
        defaultMaxRequestsPerSecond: 4,
        failureRatio: 0.25,
        postalCodeDeriveMaxMetres: 5000,
      }) as HarvesterConfig,
  } as unknown as ConfigService;

  const executor = new RunExecutor(
    undefined as never,
    store,
    sources,
    undefined as never,
    undefined as never,
    fileImport,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    config,
    undefined as never
  );
  return { executor, store, sources, running };
}

describe('RunExecutor, a run that is stopped (plan 0206)', () => {
  it.each<Ending>(['throws', 'returns'])(
    'writes the shutdown sentence when the hook stops a run whose runner %s',
    async (ending) => {
      const { executor, store, running } = build(ending);

      const done = executor.runToCompletion('run-1');
      await running;
      executor.onApplicationShutdown();

      await expect(done).resolves.toBe(HarvestRunStatus.ABORTED);
      expect(store.finish).toHaveBeenCalledWith(
        'run-1',
        HarvestRunStatus.ABORTED,
        SHUTDOWN_STOPPED_RUN
      );
    }
  );

  it.each<Ending>(['throws', 'returns'])(
    'leaves consecutiveFailures alone for an aborted run whose runner %s',
    async (ending) => {
      const { executor, sources, running } = build(ending);

      const done = executor.runToCompletion('run-1');
      await running;
      executor.onApplicationShutdown();
      await done;

      expect(sources.recordRunFinished).not.toHaveBeenCalled();
    }
  );

  it('leaves the counter alone for a run a person aborted, and keeps the runner’s reason', async () => {
    const { executor, store, sources, running } = build('throws');

    const done = executor.runToCompletion('run-1');
    await running;
    executor.cancel('run-1');

    await expect(done).resolves.toBe(HarvestRunStatus.ABORTED);
    expect(store.finish).toHaveBeenCalledWith(
      'run-1',
      HarvestRunStatus.ABORTED,
      'The operation was aborted.'
    );
    expect(sources.recordRunFinished).not.toHaveBeenCalled();
  });

  it('does not take a person’s abort for a shutdown when the pod then stops', async () => {
    const { executor, store, running } = build('throws');

    const done = executor.runToCompletion('run-1');
    await running;
    executor.cancel('run-1');
    executor.onApplicationShutdown();
    await done;

    expect(store.finish).toHaveBeenCalledWith(
      'run-1',
      HarvestRunStatus.ABORTED,
      'The operation was aborted.'
    );
  });

  it('still counts a run that failed on its own', async () => {
    const { executor, sources } = build();
    const failing = executor['fileImport'] as unknown as {
      run: jest.Mock;
    };
    failing.run.mockImplementationOnce(async () => {
      throw new Error('The document is not a harvest document.');
    });

    await expect(executor.runToCompletion('run-1')).resolves.toBe(
      HarvestRunStatus.FAILED
    );
    expect(sources.recordRunFinished).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'src-1' }),
      false
    );
  });
});
