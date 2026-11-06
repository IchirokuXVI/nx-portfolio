import type { Repository } from 'typeorm';
import type { HarvestSchedule } from '../entities';
import { HarvestScheduleStore } from './harvest-schedule.store';

/**
 * The hold of a slot gives its connection back to the pool only when the
 * session lock is gone (plan 0247, review round 2). A fake query runner with
 * TypeORM's postgres shape: `release` returns the client to the pool, and
 * `releasePostgresConnection` with an error makes pg-pool destroy it.
 * `schedule-probe-gate.integration.spec.ts` proves the lock itself on a real
 * Postgres.
 */
function build(answers: { lock?: unknown; unlock?: unknown }) {
  const runner = {
    connect: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
    releasePostgresConnection: jest.fn(async (_error: Error) => undefined),
    query: jest.fn(async (sql: string) => {
      const answer = sql.includes('pg_advisory_unlock')
        ? answers.unlock
        : answers.lock;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    }),
  };
  const repository = {
    manager: { connection: { createQueryRunner: () => runner } },
  } as unknown as Repository<HarvestSchedule>;
  return { store: new HarvestScheduleStore(repository), runner };
}

describe('HarvestScheduleStore.holdSlot', () => {
  it('returns the connection to the pool after an unlock that worked', async () => {
    const { store, runner } = build({
      lock: [{ held: true }],
      unlock: [{ pg_advisory_unlock: true }],
    });

    const hold = await store.holdSlot('schedule-1');
    await hold?.release();

    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(runner.releasePostgresConnection).not.toHaveBeenCalled();
  });

  it('destroys the connection when the unlock throws, and rethrows', async () => {
    const failure = new Error('unlock failed');
    const { store, runner } = build({
      lock: [{ held: true }],
      unlock: failure,
    });

    const hold = await store.holdSlot('schedule-1');

    await expect(hold?.release()).rejects.toBe(failure);
    expect(runner.releasePostgresConnection).toHaveBeenCalledWith(failure);
    expect(runner.release).not.toHaveBeenCalled();
  });

  it('destroys the connection when the lock query throws', async () => {
    const failure = new Error('lock failed');
    const { store, runner } = build({ lock: failure });

    await expect(store.holdSlot('schedule-1')).rejects.toBe(failure);
    expect(runner.releasePostgresConnection).toHaveBeenCalledWith(failure);
    expect(runner.release).not.toHaveBeenCalled();
  });

  it('returns the connection and answers null when another session holds it', async () => {
    const { store, runner } = build({ lock: [{ held: false }] });

    expect(await store.holdSlot('schedule-1')).toBeNull();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
