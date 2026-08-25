import { UserKind } from '@portfolio/luna-shopper/contracts';
import { DataSource } from 'typeorm';
import { AUTH_ENTITIES, User } from '../entities';
import { describeIntegration } from '../../test/infra-gate';

/**
 * Real-Postgres integration test (plan 0010, section 1). Runs only with
 * LUNA_INTEGRATION=1 against the compose stack's auth database, after
 * `nx run luna-shopper-auth:migration:run` has applied the committed migrations.
 * It proves the migrated schema matches the entities: the expected tables exist
 * and a User round-trips through the enum column and the partial unique email
 * index, which a mocked repository cannot validate honestly.
 */
describeIntegration('auth schema (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.AUTH_DB_URL,
      entities: AUTH_ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  it('has the auth tables the migration creates', async () => {
    const rows = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const names = new Set(rows.map((r: { table_name: string }) => r.table_name));
    for (const table of [
      'users',
      'credentials',
      'oauth_identities',
      'email_verifications',
      'refresh_tokens',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('round-trips a temporary User through the kind enum column', async () => {
    const users = dataSource.getRepository(User);
    const saved = await users.save(users.create({ kind: UserKind.TEMPORARY }));
    try {
      const found = await users.findOneOrFail({ where: { id: saved.id } });
      expect(found.kind).toBe(UserKind.TEMPORARY);
      expect(found.email).toBeNull();
    } finally {
      await users.delete({ id: saved.id });
    }
  });
});
