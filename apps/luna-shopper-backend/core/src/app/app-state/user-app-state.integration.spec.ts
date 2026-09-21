import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES } from '../entities';
import { UserAppStateService } from './user-app-state.service';

/**
 * What an account has been shown, against real Postgres (plan 0145, section 6).
 *
 * Every rule this plan states is the database's: the table and its primary key
 * come from a migration, the row is created by an `ON CONFLICT` and the stamp
 * that never moves is a `COALESCE`. A mocked repository would agree with
 * whatever the statement said, so this is the file that proves it.
 *
 * Each test uses an account of its own, and `afterAll` deletes every one it
 * wrote, so nothing here depends on the order the tests run in or on a database
 * that starts empty.
 */
describeIntegration('what an account has been shown (real Postgres)', () => {
  let dataSource: DataSource;
  let service: UserAppStateService;

  /** Every account this file wrote a row for. */
  const accounts: string[] = [];

  function account(): string {
    const id = randomUUID();
    accounts.push(id);
    return id;
  }

  async function rowsFor(userId: string): Promise<number> {
    const rows = await dataSource.query(
      'SELECT count(*)::int AS n FROM "user_app_state" WHERE "userId" = $1::uuid',
      [userId]
    );
    return rows[0].n;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
    service = new UserAppStateService(dataSource);
  });

  afterAll(async () => {
    if (accounts.length > 0) {
      await dataSource.query(
        'DELETE FROM "user_app_state" WHERE "userId" = ANY($1::uuid[])',
        [accounts]
      );
    }
    await dataSource.destroy();
  });

  it('applies the migration, so the table and its primary key are there', async () => {
    const [table] = await dataSource.query(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'p'
        WHERE c.relname = 'user_app_state'`
    );

    expect(table).toBeDefined();
  });

  it('reads an account that has never written as two nulls, and writes nothing', async () => {
    const userId = account();

    await expect(service.get({ userId })).resolves.toEqual({
      setupCompletedAt: null,
      tourSeenAt: null,
    });
    await expect(rowsFor(userId)).resolves.toBe(0);
  });

  it('creates the row on the first write', async () => {
    const userId = account();

    const state = await service.set({ userId, setupCompleted: true });

    expect(state.setupCompletedAt).not.toBeNull();
    expect(state.tourSeenAt).toBeNull();
    await expect(rowsFor(userId)).resolves.toBe(1);
    await expect(service.get({ userId })).resolves.toEqual(state);
  });

  it('leaves the timestamp alone on a second write of the same flag', async () => {
    const userId = account();

    const first = await service.set({ userId, setupCompleted: true });
    const second = await service.set({ userId, setupCompleted: true });

    expect(second.setupCompletedAt).toBe(first.setupCompletedAt);
  });

  it('stamps both flags in one call', async () => {
    const userId = account();

    const state = await service.set({
      userId,
      setupCompleted: true,
      tourSeen: true,
    });

    expect(state.setupCompletedAt).not.toBeNull();
    expect(state.tourSeenAt).not.toBeNull();
    // One statement, one `now()`, so both carry the same instant.
    expect(state.tourSeenAt).toBe(state.setupCompletedAt);
  });

  it('does not disturb the flag it was not asked about', async () => {
    const userId = account();

    const first = await service.set({ userId, setupCompleted: true });
    const second = await service.set({ userId, tourSeen: true });

    expect(second.setupCompletedAt).toBe(first.setupCompletedAt);
    expect(second.tourSeenAt).not.toBeNull();
  });

  it('leaves one row when two writes race, with one timestamp between them', async () => {
    const userId = account();

    const [left, right] = await Promise.all([
      service.set({ userId, setupCompleted: true }),
      service.set({ userId, setupCompleted: true }),
    ]);

    await expect(rowsFor(userId)).resolves.toBe(1);
    // Whichever of the two inserted, the other found the row and kept its
    // timestamp, so both callers were told the same thing.
    expect(left.setupCompletedAt).toBe(right.setupCompletedAt);
  });

  it('refuses a second row for one account', async () => {
    const userId = account();
    await service.set({ userId, setupCompleted: true });

    await expect(
      dataSource.query(
        'INSERT INTO "user_app_state" ("userId") VALUES ($1::uuid)',
        [userId]
      )
    ).rejects.toThrow();
  });
});
