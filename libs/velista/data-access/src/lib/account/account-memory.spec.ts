import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { UserKind } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import { AccountMemory } from './account-memory';

/**
 * The acceptance criterion this file is: *every state in section 3 is reachable against
 * `AccountMemory` with no gateway running*.
 *
 * A fake that is kinder than the real thing is worse than no fake, so what is asserted
 * here is the three places this one refuses to be: a guest has no email, the rename
 * bucket is hourly rather than per minute, and delete is idempotent.
 */
function setUp(kind: UserKind | null = 'REGISTERED'): {
  account: AccountMemory;
  tokens: TokenStore;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting(),
      provideHttpClient(),
      ApiUrl,
      TokenStore,
      AccountMemory,
    ],
  });

  const tokens = TestBed.inject(TokenStore);
  if (kind === null) {
    tokens.clear();
  } else {
    tokens.set({
      userId: 'u1',
      kind,
      username: 'Marta',
      accessToken: 'access',
      refreshToken: 'refresh',
    });
  }

  return { account: TestBed.inject(AccountMemory), tokens };
}

describe('AccountMemory', () => {
  describe('the profile', () => {
    it('gives a registered account an address that is confirmed', async () => {
      const { account } = setUp('REGISTERED');

      await expect(account.getProfile()).resolves.toMatchObject({
        kind: 'REGISTERED',
        email: 'marta@example.com',
        emailVerified: true,
      });
    });

    it('gives a guest no address at all, which is what makes their screen reachable', async () => {
      const { account } = setUp('TEMPORARY');

      await expect(account.getProfile()).resolves.toMatchObject({
        kind: 'TEMPORARY',
        email: null,
        emailVerified: false,
      });
    });

    it('refuses with a 401 when there is no session, as the real route does', async () => {
      // Every account route is bearer authenticated, so answering a blank profile would
      // let a spec render the screen for nobody.
      const { account } = setUp(null);

      await expect(account.getProfile()).rejects.toBeInstanceOf(GatewayError);
    });
  });

  describe('renaming', () => {
    it('adopts the new name', async () => {
      const { account } = setUp();

      await account.setUsername('Marta R.', 'MY_GROUPS_TOO');

      await expect(account.getProfile()).resolves.toMatchObject({
        username: 'Marta R.',
      });
    });

    it('records the scope, so rule A3 is assertable with no gateway', async () => {
      const { account } = setUp();

      await account.setUsername('A name', 'ONLY_HERE');

      expect(account.scopesSent).toEqual(['ONLY_HERE']);
    });

    it('refuses the sixth attempt with a wait far longer than a minute', async () => {
      // `THROTTLE_LIMITS.usernameChange` is five per **hour**, so a screen that
      // hardcoded sixty is visibly wrong against this fake rather than plausible.
      const { account } = setUp();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await account.setUsername(`Name ${attempt}`, 'MY_GROUPS_TOO');
      }

      await expect(
        account.setUsername('One too many', 'MY_GROUPS_TOO')
      ).rejects.toMatchObject({
        code: 'rate_limited',
        retryAfterSeconds: 2468,
      });
    });

    it('does not count a refused attempt against the caller twice', async () => {
      const { account } = setUp();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await account.setUsername(`Name ${attempt}`, 'MY_GROUPS_TOO');
      }

      // The refusal is thrown before the scope is recorded, so a spec counting what
      // was sent is not misled by an attempt the server never accepted.
      await expect(
        account.setUsername('One too many', 'MY_GROUPS_TOO')
      ).rejects.toBeInstanceOf(GatewayError);
      expect(account.scopesSent).toHaveLength(5);
    });
  });

  describe('deleting', () => {
    it('is idempotent: a repeat is a clean no-op rather than an error', async () => {
      const { account } = setUp();

      await expect(account.deleteAccount()).resolves.toEqual({ deleted: true });
      await expect(account.deleteAccount()).resolves.toEqual({
        deleted: false,
      });
    });
  });
});
