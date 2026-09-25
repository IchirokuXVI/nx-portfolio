import { ValidationException } from '@portfolio/luna-shopper/platform';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { UserAppStateService } from './user-app-state.service';
import { READ_APP_STATE_SQL, STAMP_APP_STATE_SQL } from './user-app-state.sql';

/**
 * The half of plan 0145 that is not the database's.
 *
 * The two rules the plan cares most about — a row created on demand, and a
 * stamp that never moves once it is set — are `ON CONFLICT` and `COALESCE`
 * inside one statement, so a fake repository here would only ever agree with
 * whatever this file told it to. They are proven against real Postgres in
 * `user-app-state.integration.spec.ts`, and what is left for this file is what
 * the service itself decides: which flags it asks for, that it refuses a call
 * that asks for none, that a read is a read, and how a row becomes a wire view.
 */
describe('UserAppStateService', () => {
  const userId = randomUUID();
  let rows: unknown[];
  let calls: { sql: string; params: unknown[] }[];
  let service: UserAppStateService;

  beforeEach(() => {
    rows = [];
    calls = [];
    const dataSource = {
      query: jest.fn((sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return Promise.resolve(rows);
      }),
    } as unknown as DataSource;
    service = new UserAppStateService(dataSource);
  });

  describe('get', () => {
    it('answers two nulls for an account that has never written', async () => {
      await expect(service.get({ userId })).resolves.toEqual({
        setupCompletedAt: null,
        tourSeenAt: null,
      });
    });

    it('reads and never writes', async () => {
      await service.get({ userId });

      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toBe(READ_APP_STATE_SQL);
      expect(calls[0].params).toEqual([userId]);
    });

    it('states each timestamp as an ISO string, and a missing one as null', async () => {
      rows = [
        {
          setupCompletedAt: new Date('2026-09-21T10:11:12.000Z'),
          tourSeenAt: null,
        },
      ];

      await expect(service.get({ userId })).resolves.toEqual({
        setupCompletedAt: '2026-09-21T10:11:12.000Z',
        tourSeenAt: null,
      });
    });
  });

  describe('set', () => {
    beforeEach(() => {
      rows = [{ setupCompletedAt: new Date(), tourSeenAt: null }];
    });

    it('asks for the setup alone when that is what was asked of it', async () => {
      await service.set({ userId, setupCompleted: true });

      expect(calls[0].sql).toBe(STAMP_APP_STATE_SQL);
      expect(calls[0].params).toEqual([userId, true, false]);
    });

    it('asks for the tour alone', async () => {
      await service.set({ userId, tourSeen: true });

      expect(calls[0].params).toEqual([userId, false, true]);
    });

    it('asks for both in one call', async () => {
      await service.set({ userId, setupCompleted: true, tourSeen: true });

      expect(calls[0].params).toEqual([userId, true, true]);
    });

    it('refuses a call that asks for neither, and writes nothing', async () => {
      await expect(service.set({ userId })).rejects.toBeInstanceOf(
        ValidationException
      );

      expect(calls).toHaveLength(0);
    });

    it('answers the whole state, not only what it was asked to stamp', async () => {
      rows = [
        {
          setupCompletedAt: new Date('2026-09-21T10:00:00.000Z'),
          tourSeenAt: new Date('2026-09-20T09:00:00.000Z'),
        },
      ];

      await expect(
        service.set({ userId, setupCompleted: true })
      ).resolves.toEqual({
        setupCompletedAt: '2026-09-21T10:00:00.000Z',
        tourSeenAt: '2026-09-20T09:00:00.000Z',
      });
    });
  });
});
