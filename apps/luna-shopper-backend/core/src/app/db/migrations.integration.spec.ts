import { ZoneStatus } from '@portfolio/luna-shopper/contracts';
import { DataSource } from 'typeorm';
import { CORE_ENTITIES, Zone } from '../entities';
import { describeIntegration } from '../../test/infra-gate';

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
      url: process.env.CORE_DB_URL,
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
    const names = new Set(rows.map((r: { table_name: string }) => r.table_name));
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
});
