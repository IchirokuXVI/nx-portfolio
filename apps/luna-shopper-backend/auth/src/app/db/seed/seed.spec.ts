import { demoWorld, TEMP_USER_ID } from '@portfolio/luna-shopper/test-fixtures';
import * as argon2 from 'argon2';
import { hashCredentials } from './seed';

/**
 * Unit coverage for the auth seeder's pure logic and the auth half of the demo
 * world it consumes (plan 0013, sections 1 and 2). No database: the insert path
 * is exercised by the integration suite against the throwaway stack.
 */
describe('auth seed', () => {
  const auth = demoWorld.auth;

  it('hashes every seeded credential with a verifiable argon2 hash', async () => {
    const rows = await hashCredentials();
    expect(rows).toHaveLength(auth.credentials.length);
    for (const [i, row] of rows.entries()) {
      const source = auth.credentials[i];
      expect(row.userId).toBe(source.userId);
      // A real argon2id hash, not a hand-written constant.
      expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(await argon2.verify(row.passwordHash, source.password)).toBe(true);
    }
  });

  it('every credential and identity references a seeded user', () => {
    const userIds = new Set(auth.users.map((u) => u.id));
    for (const c of auth.credentials) expect(userIds.has(c.userId)).toBe(true);
    for (const o of auth.oauthIdentities)
      expect(userIds.has(o.userId)).toBe(true);
  });

  it('leaves the temporary user with no email or credential', () => {
    const temp = auth.users.find((u) => u.id === TEMP_USER_ID);
    expect(temp?.email).toBeNull();
    expect(auth.credentials.some((c) => c.userId === TEMP_USER_ID)).toBe(false);
  });
});
