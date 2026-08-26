import { ZoneStatus } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES, Zone, ZoneMembership } from '../entities';

/**
 * Real-Postgres integration test (plan 0010, section 1). Runs only with
 * LUNA_INTEGRATION=1 against the compose stack's core database, after
 * `nx run luna-shopper-backend-core:migration:run` has applied the committed migrations.
 * It proves the migrated schema matches the entities: the expected tables exist
 * and a Zone round-trips through the enum column and the jsonb `config` default,
 * which unit tests with a mocked repository cannot validate honestly.
 */
describeIntegration('core schema (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('CORE_DB_URL'),
      entities: CORE_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('has the core tables the migrations create', async () => {
    const rows = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(
      rows.map((r: { table_name: string }) => r.table_name)
    );
    for (const table of [
      'zones',
      'zone_memberships',
      'shopping_lists',
      'list_lines',
      'line_comments',
      'merge_requests',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('round-trips a Zone through the enum column and jsonb config default', async () => {
    const zones = dataSource.getRepository(Zone);
    const saved = await zones.save(
      zones.create({
        name: 'Integration Zone',
        joinCode: `IT${Date.now()}`,
        status: ZoneStatus.ACTIVE,
        ownerUserId: null,
        config: {},
      })
    );
    try {
      const found = await zones.findOneOrFail({ where: { id: saved.id } });
      expect(found.status).toBe(ZoneStatus.ACTIVE);
      expect(found.config).toEqual({});
    } finally {
      await zones.delete({ id: saved.id });
    }
  });

  it('no longer enforces per-zone username uniqueness (plan 0018, section 2)', async () => {
    const constraints = await dataSource.query(
      `SELECT conname FROM pg_constraint WHERE conname = 'uq_membership_zone_username'`
    );
    expect(constraints).toEqual([]);
  });

  it('accepts two members of one zone with the same username', async () => {
    const zones = dataSource.getRepository(Zone);
    const memberships = dataSource.getRepository(ZoneMembership);
    const zone = await zones.save(
      zones.create({
        name: 'Shared Names',
        joinCode: `IT${Date.now()}`,
        status: ZoneStatus.ACTIVE,
        ownerUserId: null,
        config: {},
      })
    );
    try {
      // Impersonation inside a zone is possible by construction now; the guard is
      // a discriminator in the UI, not a database constraint (section 2).
      const rows = await memberships.save([
        memberships.create({
          zoneId: zone.id,
          userId: randomUUID(),
          username: 'Vela',
        }),
        memberships.create({
          zoneId: zone.id,
          userId: randomUUID(),
          username: 'Vela',
        }),
      ]);
      expect(rows).toHaveLength(2);
    } finally {
      // The membership rows cascade with the zone.
      await zones.delete({ id: zone.id });
    }
  });
});
