import type { ConfigService } from '@nestjs/config';
import { SourceProbeStatus } from '@portfolio/luna-shopper/contracts';
import type { SupermarketSource } from '../../entities';
import type { SourceProbeService } from './source-probe.service';
import type { ClaimedProbe } from './source-probe.store';
import { FakeSourceProbeStore } from './source-probe.store.fake';
import { SourceProbeWorker } from './source-probe.worker';

/**
 * The daily probe worker (plan 0219, section 7), with a clock passed in and no
 * real timer. The store is the in memory fake; the claim between two real
 * processes is the integration spec's.
 */

const NOW = new Date('2026-11-05T10:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

function source(
  id: string,
  over: Partial<SupermarketSource> = {}
): SupermarketSource {
  return {
    id,
    supermarketId: `chain-of-${id}`,
    adapterKey: 'mercadona-api',
    enabled: true,
    config: {},
    maxRequestsPerSecond: 4,
    ...over,
  } as SupermarketSource;
}

function build(
  options: {
    harvestEnabled?: boolean;
    schedulerEnabled?: boolean;
    sources?: SupermarketSource[];
  } = {}
) {
  const store = new FakeSourceProbeStore();
  store.sources = options.sources ?? [source('source-1')];
  const ran: ClaimedProbe[] = [];
  const probes = {
    runClaimed: async (claimed: ClaimedProbe) => {
      ran.push(claimed);
      await store.finish(claimed.probe.id, {
        status: SourceProbeStatus.PASSED,
        previousStatus: null,
        changed: false,
        finishedAt: NOW,
        requests: 5,
        steps: [],
        error: null,
      });
    },
  } as unknown as SourceProbeService;
  const config = {
    getOrThrow: () => ({
      harvestEnabled: options.harvestEnabled ?? true,
      schedulerEnabled: options.schedulerEnabled ?? true,
    }),
  } as unknown as ConfigService;
  let clock = NOW;
  const worker = new SourceProbeWorker(
    store.asStore(),
    probes,
    config,
    () => clock
  );
  return {
    worker,
    store,
    ran,
    setClock: (at: Date) => {
      clock = at;
    },
  };
}

describe('SourceProbeWorker', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    'starts nothing unless both switches are on (HARVEST_ENABLED %s, HARVEST_SCHEDULER_ENABLED %s)',
    async (harvestEnabled, schedulerEnabled) => {
      const { worker, ran, store } = build({
        harvestEnabled,
        schedulerEnabled,
      });
      await worker.tick();
      expect(ran).toEqual([]);
      expect(store.rows).toEqual([]);
    }
  );

  it('starts a probe of a source with none, as SCHEDULED', async () => {
    const { worker, ran } = build();
    await worker.tick();
    expect(ran).toHaveLength(1);
    expect(ran[0].probe).toEqual(
      expect.objectContaining({ trigger: 'SCHEDULED', startedAt: NOW })
    );
  });

  it('leaves a source probed 23 hours ago and probes one probed 25 hours ago', async () => {
    const { worker, ran, store } = build({
      sources: [source('recent'), source('stale')],
    });
    store.seed({ sourceId: 'recent', startedAt: hoursAgo(23) });
    store.seed({ sourceId: 'stale', startedAt: hoursAgo(25) });

    await worker.tick();
    await worker.tick();

    expect(ran.map((claimed) => claimed.source.id)).toEqual(['stale']);
  });

  it('starts one probe per tick, oldest newest probe first', async () => {
    const { worker, ran, store } = build({
      sources: [source('a'), source('b'), source('c')],
    });
    store.seed({ sourceId: 'a', startedAt: hoursAgo(30) });
    store.seed({ sourceId: 'b', startedAt: hoursAgo(50) });

    await worker.tick();
    expect(ran.map((claimed) => claimed.source.id)).toEqual(['c']);
    await worker.tick();
    await worker.tick();
    expect(ran.map((claimed) => claimed.source.id)).toEqual(['c', 'b', 'a']);
  });

  it('reads the interval of each chain from its config (2026-11-06)', async () => {
    const { worker, ran, store } = build({
      sources: [
        source('hourly', { config: { probeIntervalHours: 1 } }),
        source('never', { config: { probeIntervalHours: 0 } }),
        source('daily'),
      ],
    });
    store.seed({ sourceId: 'hourly', startedAt: hoursAgo(2) });
    store.seed({ sourceId: 'daily', startedAt: hoursAgo(2) });

    await worker.tick();
    await worker.tick();
    await worker.tick();

    expect(ran.map((claimed) => claimed.source.id)).toEqual(['hourly']);
  });

  it('retries an UNREACHABLE probe 30 minutes on as the next attempt, and starts again at 1 after any other status', async () => {
    const { worker, ran, store } = build({
      sources: [source('retry'), source('final'), source('recovered')],
    });
    const minutesAgo = (minutes: number) =>
      new Date(NOW.getTime() - minutes * 60_000);
    store.seed({
      sourceId: 'retry',
      startedAt: minutesAgo(31),
      status: SourceProbeStatus.UNREACHABLE,
      attempt: 2,
    });
    store.seed({
      sourceId: 'final',
      startedAt: minutesAgo(31),
      status: SourceProbeStatus.UNREACHABLE,
      attempt: 3,
    });
    store.seed({
      sourceId: 'recovered',
      startedAt: hoursAgo(25),
      status: SourceProbeStatus.PASSED,
      attempt: 2,
    });

    await worker.tick();
    await worker.tick();
    await worker.tick();

    expect(
      ran.map((claimed) => [claimed.source.id, claimed.probe.attempt])
    ).toEqual([
      ['recovered', 1],
      ['retry', 3],
    ]);
  });

  it('skips a source whose chain has a run in flight', async () => {
    const { worker, ran, store } = build();
    store.busyChains.add('chain-of-source-1');
    await worker.tick();
    expect(ran).toEqual([]);
  });

  it('skips a source whose row is off', async () => {
    const { worker, ran } = build({
      sources: [source('source-1', { enabled: false })],
    });
    await worker.tick();
    expect(ran).toEqual([]);
  });

  it('skips a source with no probe of its adapter', async () => {
    const { worker, ran } = build({
      sources: [source('source-1', { adapterKey: 'osm-places' })],
    });
    await worker.tick();
    expect(ran).toEqual([]);
  });

  it('marks a 15 minute old RUNNING probe ABORTED and leaves a 5 minute old one', async () => {
    const { worker, store } = build({ harvestEnabled: false });
    const old = store.seed({
      sourceId: 'x',
      startedAt: new Date(NOW.getTime() - 15 * 60_000),
      status: SourceProbeStatus.RUNNING,
      finishedAt: null,
    });
    const young = store.seed({
      sourceId: 'y',
      startedAt: new Date(NOW.getTime() - 5 * 60_000),
      status: SourceProbeStatus.RUNNING,
      finishedAt: null,
    });

    await worker.tick();

    expect((await store.load(old.id)).status).toBe(SourceProbeStatus.ABORTED);
    expect((await store.load(young.id)).status).toBe(SourceProbeStatus.RUNNING);
  });

  it('prunes once per UTC day, keeping 90 days', async () => {
    const { worker, store, setClock } = build({ schedulerEnabled: false });
    await worker.tick();
    await worker.tick();
    setClock(new Date('2026-11-06T00:01:00.000Z'));
    await worker.tick();

    expect(store.prunes).toEqual([
      new Date(NOW.getTime() - 90 * 86_400_000),
      new Date(Date.parse('2026-11-06T00:01:00.000Z') - 90 * 86_400_000),
    ]);
  });

  it('does not stop the next tick after an error inside one', async () => {
    const { worker, ran, store } = build();
    const claim = store.claimDue.bind(store);
    let calls = 0;
    store.claimDue = async (...args) => {
      calls += 1;
      if (calls === 1) {
        throw new Error('the database went away');
      }
      return claim(...args);
    };

    await expect(worker.tick()).resolves.toBeUndefined();
    await worker.tick();

    expect(ran).toHaveLength(1);
  });

  it('does nothing after shutdown', async () => {
    const { worker, ran } = build();
    worker.onApplicationShutdown();
    await worker.tick();
    expect(ran).toEqual([]);
  });
});
