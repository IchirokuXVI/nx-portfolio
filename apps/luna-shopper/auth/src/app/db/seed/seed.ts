import { demoWorld } from '@portfolio/luna-shopper/test-fixtures';
import * as argon2 from 'argon2';
import type { DataSource } from 'typeorm';
import { Credential, OAuthIdentity, User } from '../../entities';
import defaultDataSource from '../data-source';

/**
 * The auth half of the demo world seeder (plan 0013, section 2).
 *
 * It inserts through the real TypeORM entities and repositories (reusing the
 * migration CLI's `data-source.ts` wiring), so the stored argon2 hashes, enum
 * columns and timestamps are genuinely valid rather than hand written SQL that
 * drifts from the entities. It is idempotent by fixed id: it removes the known
 * seed users first (which cascades to their credentials and identities) and
 * reinserts, so it only ever touches the canonical scenario rows.
 */

const auth = demoWorld.auth;

/**
 * Hash each seeded credential's plaintext password with argon2id, exactly as the
 * running service does, returning entity shaped rows ready to insert. Pulled out
 * so it is unit testable without a database.
 */
export function hashCredentials(
  credentials = auth.credentials
): Promise<{ id: string; userId: string; passwordHash: string }[]> {
  return Promise.all(
    credentials.map(async (c) => ({
      id: c.id,
      userId: c.userId,
      passwordHash: await argon2.hash(c.password, { type: argon2.argon2id }),
    }))
  );
}

export async function seedAuth(
  dataSource: DataSource = defaultDataSource
): Promise<void> {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  const credentialRows = await hashCredentials();
  await dataSource.transaction(async (m) => {
    const userIds = auth.users.map((u) => u.id);
    // Deleting the users cascades to their credentials and oauth identities.
    if (userIds.length) {
      await m.getRepository(User).delete(userIds);
    }
    await m.getRepository(User).insert(auth.users);
    if (credentialRows.length) {
      await m.getRepository(Credential).insert(credentialRows);
    }
    if (auth.oauthIdentities.length) {
      await m.getRepository(OAuthIdentity).insert(auth.oauthIdentities);
    }
  });
}

/** CLI entry: seed, then close the connection (the CLI wrapper handles errors). */
export async function main(): Promise<void> {
  await seedAuth();
  await defaultDataSource.destroy();
  console.log(
    `[seed] auth: ${auth.users.length} users, ${auth.credentials.length} credentials, ${auth.oauthIdentities.length} identities`
  );
}
