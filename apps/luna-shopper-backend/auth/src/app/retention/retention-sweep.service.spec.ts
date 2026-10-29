import type { RetentionConfig } from './retention-config';
import {
  authRetentionTargets,
  deletedCount,
  RETENTION_FIRST_TICK_DELAY_MS,
  retentionDeleteSql,
  RetentionSweepService,
} from './retention-sweep.service';

/**
 * The sweep's loop and timer (plan 0233, section 7). What a statement deletes
 * is proved on real Postgres in `retention-sweep.integration.spec.ts`; this
 * file proves which statements run, how many, and when.
 */
describe('RetentionSweepService (auth)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = new Date('2026-10-29T12:00:00Z');

  function cfg(sweep: Partial<RetentionConfig['sweep']> = {}): RetentionConfig {
    return {
      auditMs: 180 * DAY,
      adminLoginFailuresMs: 90 * DAY,
      expiredGrantsMs: 14 * DAY,
      sweep: {
        enabled: true,
        intervalMs: 60 * 60 * 1000,
        batchSize: 10,
        maxBatches: 3,
        ...sweep,
      },
    };
  }

  /**
   * A data source whose `DELETE` answers the driver's `[rows, rowCount]` with
   * the counts queued for each table, then zero.
   */
  function build(
    config: RetentionConfig,
    counts: Record<string, number[]> = {}
  ) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const table = /DELETE FROM "([a-z_]+)"/.exec(sql)?.[1] ?? '';
      const next = counts[table]?.shift() ?? 0;
      return [[], next];
    });
    const logger = { log: jest.fn(), error: jest.fn() };
    const svc = new RetentionSweepService(
      { query } as never,
      logger as never,
      { getOrThrow: () => ({ retention: config }) } as never
    );
    return { svc, calls, query, logger };
  }

  describe('the target list', () => {
    it('names every table of section 1 with its column and period', () => {
      expect(authRetentionTargets(cfg())).toEqual([
        { table: 'auth_audit', column: 'at', retainMs: 180 * DAY },
        {
          table: 'impersonation_sessions',
          column: 'expiresAt',
          retainMs: 180 * DAY,
          extraWhere: `"endedAt" IS NOT NULL OR "expiresAt" < now()`,
        },
        {
          table: 'admin_login_failures',
          column: 'createdAt',
          retainMs: 90 * DAY,
        },
        { table: 'refresh_tokens', column: 'expiresAt', retainMs: 14 * DAY },
        { table: 'password_resets', column: 'expiresAt', retainMs: 14 * DAY },
        {
          table: 'email_verifications',
          column: 'expiresAt',
          retainMs: 14 * DAY,
        },
        { table: 'oauth_states', column: 'expiresAt', retainMs: 14 * DAY },
        { table: 'oauth_handoffs', column: 'expiresAt', retainMs: 14 * DAY },
      ]);
    });

    it('builds one batch as a locked, limited subquery', () => {
      expect(
        retentionDeleteSql({
          table: 'refresh_tokens',
          column: 'expiresAt',
          retainMs: 1,
        })
      ).toBe(
        'DELETE FROM "refresh_tokens" WHERE "id" IN (SELECT "id" FROM "refresh_tokens" ' +
          'WHERE "expiresAt" < $1 ORDER BY "expiresAt" LIMIT $2 FOR UPDATE SKIP LOCKED)'
      );
    });

    it('adds the extra condition in its own parentheses', () => {
      expect(
        retentionDeleteSql({
          table: 'impersonation_sessions',
          column: 'expiresAt',
          retainMs: 1,
          extraWhere: '"endedAt" IS NOT NULL OR "expiresAt" < now()',
        })
      ).toContain(
        'WHERE "expiresAt" < $1 AND ("endedAt" IS NOT NULL OR "expiresAt" < now()) ORDER BY'
      );
    });

    it('refuses a DELETE answer it cannot count', () => {
      expect(deletedCount([[], 4])).toBe(4);
      expect(() => deletedCount([])).toThrow(/unexpected DELETE result/);
    });
  });

  describe('sweep', () => {
    it('runs one statement per table when a batch comes back short', async () => {
      const { svc, calls } = build(cfg(), { refresh_tokens: [4] });

      const results = await svc.sweep(NOW);

      expect(calls).toHaveLength(8);
      expect(results.find((r) => r.table === 'refresh_tokens')).toEqual({
        table: 'refresh_tokens',
        deleted: 4,
        failed: false,
      });
    });

    it('computes each cutoff once from the sweep clock', async () => {
      const { svc, calls } = build(cfg(), { auth_audit: [10, 10, 2] });

      await svc.sweep(NOW);

      const audit = calls.filter((c) => c.sql.includes('"auth_audit"'));
      expect(audit).toHaveLength(3);
      for (const call of audit) {
        expect(call.params).toEqual([new Date(NOW.getTime() - 180 * DAY), 10]);
      }
      const grants = calls.find((c) => c.sql.includes('"oauth_states"'));
      expect(grants?.params[0]).toEqual(new Date(NOW.getTime() - 14 * DAY));
      const failures = calls.find((c) =>
        c.sql.includes('"admin_login_failures"')
      );
      expect(failures?.params[0]).toEqual(new Date(NOW.getTime() - 90 * DAY));
    });

    it('stops a table at the batch cap', async () => {
      const { svc, calls, logger } = build(cfg({ maxBatches: 3 }), {
        password_resets: [10, 10, 10, 10, 10],
      });

      const results = await svc.sweep(NOW);

      expect(
        calls.filter((c) => c.sql.includes('"password_resets"'))
      ).toHaveLength(3);
      expect(results.find((r) => r.table === 'password_resets')?.deleted).toBe(
        30
      );
      expect(logger.log).toHaveBeenCalledWith(
        { table: 'password_resets', deleted: 30 },
        expect.any(String)
      );
    });

    it('logs nothing for a table that deleted nothing', async () => {
      const { svc, logger } = build(cfg());

      await svc.sweep(NOW);

      expect(logger.log).not.toHaveBeenCalled();
    });

    it('logs a failing table and goes on to the next', async () => {
      const { svc, query, logger } = build(cfg());
      query.mockImplementationOnce(async () => {
        throw new Error('deadlock detected');
      });

      const results = await svc.sweep(NOW);

      expect(results[0]).toEqual({
        table: 'auth_audit',
        deleted: 0,
        failed: true,
      });
      expect(results.slice(1).every((r) => !r.failed)).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ table: 'auth_audit' }),
        expect.any(String)
      );
    });
  });

  describe('the timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('runs the first tick one minute after boot, then every interval', async () => {
      const { svc, query } = build(cfg({ intervalMs: 60 * 60 * 1000 }));
      svc.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(RETENTION_FIRST_TICK_DELAY_MS - 1);
      expect(query).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      expect(query).toHaveBeenCalledTimes(8);

      await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(query).toHaveBeenCalledTimes(16);

      svc.onApplicationShutdown();
      await jest.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
      expect(query).toHaveBeenCalledTimes(16);
    });

    it('starts nothing when switched off', async () => {
      const { svc, query } = build(cfg({ enabled: false }));
      svc.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);

      expect(query).not.toHaveBeenCalled();
    });

    it('stops before the first tick when shut down within the minute', async () => {
      const { svc, query } = build(cfg());
      svc.onApplicationBootstrap();
      svc.onApplicationShutdown();

      await jest.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);

      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('tick', () => {
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
      expect(query).toHaveBeenCalledTimes(8);
    });

    it('swallows and logs an error of the whole sweep', async () => {
      const { svc, logger } = build(cfg());
      jest.spyOn(svc, 'sweep').mockRejectedValueOnce(new Error('boom'));

      await expect(svc.tick()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        'retention sweep failed'
      );
    });
  });
});
