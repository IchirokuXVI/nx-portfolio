import { UserKind } from '@portfolio/luna-shopper/contracts';
import {
  describeIntegration,
  requiredEnv,
} from '@portfolio/luna-shopper/test-fixtures/jest';
import { DataSource } from 'typeorm';
import { AUTH_ENTITIES, User } from '../entities';

/**
 * Real-Postgres integration test (plan 0010, section 1). Runs only with
 * LUNA_INTEGRATION=1 against the compose stack's auth database, after
 * `nx run luna-shopper-backend-auth:migration:run` has applied the committed migrations.
 * It proves the migrated schema matches the entities: the expected tables exist
 * and a User round-trips through the enum column and the partial unique email
 * index, which a mocked repository cannot validate honestly.
 */
describeIntegration('auth schema (real Postgres)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: requiredEnv('AUTH_DB_URL'),
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
    const names = new Set(
      rows.map((r: { table_name: string }) => r.table_name)
    );
    for (const table of [
      'users',
      'credentials',
      'oauth_identities',
      'email_verifications',
      'password_resets',
      'oauth_states',
      'refresh_tokens',
    ]) {
      expect(names.has(table)).toBe(true);
    }
  });

  it('round-trips a temporary User through the kind enum column', async () => {
    const users = dataSource.getRepository(User);
    const saved = await users.save(
      users.create({ kind: UserKind.TEMPORARY, username: 'Quiet Lantern' })
    );
    try {
      const found = await users.findOneOrFail({ where: { id: saved.id } });
      expect(found.kind).toBe(UserKind.TEMPORARY);
      expect(found.email).toBeNull();
      expect(found.username).toBe('Quiet Lantern');
    } finally {
      await users.delete({ id: saved.id });
    }
  });

  it('accepts two users with the same global username (plan 0018)', async () => {
    const users = dataSource.getRepository(User);
    const rows = await users.save([
      users.create({ kind: UserKind.TEMPORARY, username: 'Swift Sail' }),
      users.create({ kind: UserKind.TEMPORARY, username: 'Swift Sail' }),
    ]);
    try {
      expect(rows).toHaveLength(2);
    } finally {
      await users.delete(rows.map((r) => r.id));
    }
  });
});
