import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import type { DataSource, EntityManager } from 'typeorm';
import { CORE_INSERT_ORDER, seedCore } from './seed';

/**
 * Unit coverage for the core seeder's ordering logic and the core half of the
 * demo world it consumes (plan 0013, sections 1 and 2). No database: a fake
 * DataSource records the delete/insert calls so we can assert the seeder deletes
 * children-first and inserts parents-first.
 */
describe('core seed', () => {
  const core = demoWorld.core;

  it('is idempotent-safe: deletes children-first, then inserts parents-first', async () => {
    const calls: string[] = [];
    const manager = {
      getRepository: (entity: { name: string }) => ({
        delete: async () => {
          calls.push(`delete:${entity.name}`);
        },
        insert: async () => {
          calls.push(`insert:${entity.name}`);
        },
      }),
    } as unknown as EntityManager;
    const fakeDataSource = {
      isInitialized: true,
      transaction: async (cb: (m: EntityManager) => Promise<void>) =>
        cb(manager),
    } as unknown as DataSource;

    await seedCore(fakeDataSource);

    const names = CORE_INSERT_ORDER.map((s) => s.name);
    const expected = [
      ...[...names].reverse().map((n) => `delete:${n}`),
      ...names.map((n) => `insert:${n}`),
    ];
    expect(calls).toEqual(expected);
    // Zone is created before its memberships and deleted after them.
    expect(calls.indexOf('insert:Zone')).toBeLessThan(
      calls.indexOf('insert:ZoneMembership')
    );
    expect(calls.indexOf('delete:Zone')).toBeGreaterThan(
      calls.indexOf('delete:ZoneMembership')
    );
  });

  it('the core half is referentially closed within itself', () => {
    const zoneIds = new Set(core.zones.map((z) => z.id));
    const listIds = new Set(core.lists.map((l) => l.id));
    const membershipIds = new Set(core.memberships.map((m) => m.id));
    const lineIds = new Set(core.lines.map((l) => l.id));

    for (const l of core.lists) expect(zoneIds.has(l.zoneId)).toBe(true);
    for (const a of core.listAccess) {
      expect(listIds.has(a.listId)).toBe(true);
      expect(membershipIds.has(a.membershipId)).toBe(true);
    }
    for (const l of core.lines) expect(listIds.has(l.listId)).toBe(true);
    for (const c of core.comments) expect(lineIds.has(c.lineId)).toBe(true);
  });
});
