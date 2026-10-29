import type { RetentionConfig } from './retention-config';
import {
  catalogRetentionTargets,
  RETENTION_FIRST_TICK_DELAY_MS,
  RetentionSweepService,
} from './retention-sweep.service';

/**
 * The sweep's loop and timer in catalog (plan 0233, section 7). What the
 * statement deletes is proved on real Postgres in
 * `retention-sweep.integration.spec.ts`.
 */
describe('RetentionSweepService (catalog)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = new Date('2026-10-29T12:00:00Z');

  function cfg(sweep: Partial<RetentionConfig['sweep']> = {}): RetentionConfig {
    return {
      auditMs: 180 * DAY,
      sweep: {
        enabled: true,
        intervalMs: 60 * 60 * 1000,
        batchSize: 10,
        maxBatches: 3,
        ...sweep,
      },
    };
  }

  /** A data source whose `DELETE` answers `[rows, rowCount]` from a queue. */
  function build(config: RetentionConfig, counts: number[] = []) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return [[], counts.shift() ?? 0];
    });
    const logger = { log: jest.fn(), error: jest.fn() };
    const svc = new RetentionSweepService(
      { query } as never,
      logger as never,
      { getOrThrow: () => ({ retention: config }) } as never
    );
    return { svc, calls, query, logger };
  }

  it('sweeps its audit trail and nothing else', () => {
    expect(catalogRetentionTargets(cfg())).toEqual([
      { table: 'catalog_audit', column: 'at', retainMs: 180 * DAY },
    ]);
  });

  it('ends on a short batch, with one cutoff for every batch', async () => {
    const { svc, calls, logger } = build(cfg(), [10, 4]);

    const results = await svc.sweep(NOW);

    expect(results).toEqual([
      { table: 'catalog_audit', deleted: 14, failed: false },
    ]);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.sql).toContain('DELETE FROM "catalog_audit"');
      expect(call.sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(call.params).toEqual([new Date(NOW.getTime() - 180 * DAY), 10]);
    }
    expect(logger.log).toHaveBeenCalledWith(
      { table: 'catalog_audit', deleted: 14 },
      expect.any(String)
    );
  });

  it('stops at the batch cap', async () => {
    const { svc, calls } = build(cfg({ maxBatches: 3 }), [10, 10, 10, 10]);

    const results = await svc.sweep(NOW);

    expect(calls).toHaveLength(3);
    expect(results[0].deleted).toBe(30);
  });

  it('logs a failure and reports it', async () => {
    const { svc, query, logger } = build(cfg());
    query.mockRejectedValueOnce(new Error('deadlock detected'));

    const results = await svc.sweep(NOW);

    expect(results).toEqual([
      { table: 'catalog_audit', deleted: 0, failed: true },
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  describe('the timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('runs the first tick one minute after boot, then every interval', async () => {
      const { svc, query } = build(cfg());
      svc.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(RETENTION_FIRST_TICK_DELAY_MS - 1);
      expect(query).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(query).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(query).toHaveBeenCalledTimes(2);

      svc.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
      expect(query).toHaveBeenCalledTimes(2);
    });

    it('starts nothing when switched off', async () => {
      const { svc, query } = build(cfg({ enabled: false }));
      svc.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);

      expect(query).not.toHaveBeenCalled();
    });
  });

  it('never overlaps a tick that is still running', async () => {
    const { svc, query } = build(cfg());
    let release!: () => void;
    query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([[], 0]);
        })
    );

    const first = svc.tick();
    await svc.tick();
    expect(query).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(query).toHaveBeenCalledTimes(1);
  });
});
