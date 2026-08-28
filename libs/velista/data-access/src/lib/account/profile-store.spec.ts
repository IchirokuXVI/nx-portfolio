import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { UserProfile, UsernameScope } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ApiUrl } from '../api-url';
import { SessionStore } from '../auth/session-store';
import { TokenStore } from '../auth/token-store';
import { GatewayError } from '../errors';
import { Mutations } from '../mutations';
import { REALTIME_CLIENT } from '../realtime/realtime-client';
import { RealtimeMemory } from '../realtime/realtime-memory';
import { ACCOUNT_SERVICE, type AccountServiceI } from './account-service';
import { ProfileStore } from './profile-store';

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    userId: 'u1',
    kind: 'REGISTERED',
    username: 'Marta',
    email: 'marta@example.com',
    emailVerified: true,
    displayName: null,
    ...overrides,
  };
}

/** An `AccountServiceI` that records what it was asked, with no transport. */
function fakeAccount(
  options: {
    profile?: UserProfile;
    getRejectsWith?: unknown;
    setRejectsWith?: unknown;
    /** What the server answers to a rename, which is not what was sent. */
    normalizeTo?: string;
  } = {}
) {
  const calls: { method: string; username?: string; scope?: UsernameScope }[] =
    [];
  let held = options.profile ?? profile();

  const service: AccountServiceI = {
    getProfile: async () => {
      calls.push({ method: 'getProfile' });
      if (options.getRejectsWith !== undefined) {
        throw options.getRejectsWith;
      }
      return held;
    },
    setUsername: async (username, scope) => {
      calls.push({ method: 'setUsername', username, scope });
      if (options.setRejectsWith !== undefined) {
        throw options.setRejectsWith;
      }
      held = { ...held, username: options.normalizeTo ?? username };
      return held;
    },
    deleteAccount: async () => {
      calls.push({ method: 'deleteAccount' });
      return { deleted: true };
    },
  };

  return { ...service, calls };
}

function setUp(service: ReturnType<typeof fakeAccount>): {
  store: ProfileStore;
  session: SessionStore;
  tokens: TokenStore;
  realtime: RealtimeMemory;
} {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideVelistaTesting(),
      provideHttpClient(),
      ApiUrl,
      Mutations,
      TokenStore,
      ProfileStore,
      SessionStore,
      { provide: ACCOUNT_SERVICE, useValue: service },
      { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
    ],
  });

  return {
    store: TestBed.inject(ProfileStore),
    session: TestBed.inject(SessionStore),
    tokens: TestBed.inject(TokenStore),
    realtime: TestBed.inject(RealtimeMemory),
  };
}

/** A signed-in pair for `u1`, whose name is deliberately not the profile's. */
function signIn(tokens: TokenStore, username = 'Stale'): void {
  tokens.set({
    userId: 'u1',
    kind: 'REGISTERED',
    username,
    accessToken: 'access',
    refreshToken: 'refresh',
  });
}

describe('ProfileStore', () => {
  describe('loading', () => {
    it('holds what the server answered', async () => {
      const { store } = setUp(fakeAccount());

      await store.load();

      expect(store.state()).toBe('loaded');
      expect(store.profile()?.email).toBe('marta@example.com');
    });

    it('records a failure without throwing, so the screen still renders', async () => {
      // Being unable to read an email must never be what traps somebody on a phone
      // they want off (plan 0015, section 3.1).
      const { store } = setUp(
        fakeAccount({
          getRejectsWith: new GatewayError({
            code: 'internal',
            status: 500,
            correlationId: 'c1',
          }),
        })
      );

      await store.load();

      expect(store.state()).toBe('failed');
      expect(store.error()).toBeInstanceOf(GatewayError);
    });

    it('does not blank a held profile while re-reading it', async () => {
      // Which is how the retry line works: a store that emptied itself first would
      // flash between the name it has and the name it is about to have again.
      const service = fakeAccount();
      const { store } = setUp(service);
      await store.load();

      const second = store.load();
      expect(store.profile()).not.toBeNull();
      await second;
    });
  });

  /**
   * **Rule A2.** `PATCH /v1/account/me` answers a profile and no new token pair, and
   * the access token's default life is fifteen minutes, so without this the app bar
   * would keep the old initial for up to a quarter of an hour.
   */
  describe('rule A2: the profile owns the name', () => {
    it('is preferred over the token pair once it has loaded', async () => {
      const { store, session, tokens } = setUp(fakeAccount());
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'Stale',
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      expect(session.username()).toBe('Stale');

      await store.load();

      expect(session.username()).toBe('Marta');
    });

    it('falls back to the pair until then, which is the only thing that knows', async () => {
      const { session, tokens } = setUp(fakeAccount());
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'FromToken',
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      expect(session.username()).toBe('FromToken');
    });

    it('is still null for an anonymous caller, whatever it holds', async () => {
      // A profile held from a session that has since been cleared must not put a name
      // in the app bar of somebody who is signed out. Signing out is the case: the page
      // clears both, and this proves the order between them cannot leak a name.
      const { store, session, tokens } = setUp(fakeAccount());
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'Marta',
        accessToken: 'access',
        refreshToken: 'refresh',
      });
      await store.load();

      tokens.clear();

      expect(session.username()).toBeNull();
    });

    it('changes the name on the same tick a rename lands', async () => {
      const { store, session, tokens } = setUp(fakeAccount());
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'Marta',
        accessToken: 'access',
        refreshToken: 'refresh',
      });
      await store.load();

      await store.rename('Marta R.', 'MY_GROUPS_TOO');

      expect(session.username()).toBe('Marta R.');
      // And the pair is untouched, which is the half of the rule that would otherwise
      // be a comment: the token catches up on its own schedule.
      expect(tokens.tokens()?.username).toBe('Marta');
    });

    it('never spends a rotation to update one letter', async () => {
      // Refresh **rotates**: the presented token is revoked and a new pair issued, so
      // calling it here would put a race into the cheapest possible action.
      const { store, tokens } = setUp(fakeAccount());
      const refresh = jest.spyOn(tokens, 'refresh');
      await store.load();

      await store.rename('Marta R.', 'MY_GROUPS_TOO');

      expect(refresh).not.toHaveBeenCalled();
    });

    it('adopts the server’s normalization, not the string that was sent', async () => {
      // `normalizeUsername` collapses whitespace runs and normalizes to NFC, so writing
      // back what was sent would leave the screen showing a name the server does not
      // have.
      const { store } = setUp(fakeAccount({ normalizeTo: 'Marta R.' }));
      await store.load();

      await store.rename('Marta   R.', 'MY_GROUPS_TOO');

      expect(store.profile()?.username).toBe('Marta R.');
    });
  });

  /**
   * Plan 0021, section 5. Rule A2 is true in the tab that did the renaming and was
   * exactly backwards in a second one, and not for fifteen minutes but for as long as
   * that tab stayed open: the profile held the old name, the refreshed pair carried
   * the new one, and the profile is preferred, so the fallback that exists to prevent
   * staleness was unreachable precisely where it would have helped.
   */
  describe('a global rename arriving from another tab', () => {
    it('applies the new name, so the app bar and the account screen agree', async () => {
      const { store, session, tokens, realtime } = setUp(fakeAccount());
      signIn(tokens);
      await store.load();
      expect(session.username()).toBe('Marta');

      realtime.emit('user.usernameChanged', {
        userId: 'u1',
        username: 'Marta R.',
      });

      expect(store.profile()?.username).toBe('Marta R.');
      expect(session.username()).toBe('Marta R.');
    });

    it('leaves a null profile null, so the token stays the fallback', async () => {
      // The event carries a name and not a profile. Inventing one would hand
      // `SessionStore` a name to prefer over a pair that is already correct, and would
      // have to invent an email verification state and a created date besides.
      const { store, session, tokens, realtime } = setUp(fakeAccount());
      signIn(tokens, 'FromToken');

      realtime.emit('user.usernameChanged', {
        userId: 'u1',
        username: 'Marta R.',
      });

      expect(store.profile()).toBeNull();
      expect(session.username()).toBe('FromToken');
    });

    it('ignores a rename addressed to somebody else', async () => {
      // The room makes it the caller's and the store does not take that on faith: a
      // client that trusts routing to be its authorization is one server bug away
      // from wearing somebody else's name.
      const { store, tokens, realtime } = setUp(fakeAccount());
      signIn(tokens);
      await store.load();

      realtime.emit('user.usernameChanged', {
        userId: 'someone-else',
        username: 'Intruder',
      });

      expect(store.profile()?.username).toBe('Marta');
    });

    it('is a no-op in the tab that did the renaming', async () => {
      // It fires there too, after `rename` has already written the response. Writing
      // the same string twice costs nothing, and suppressing it would need a flag
      // tracking which of the store's own actions caused which event.
      const { store, session, tokens, realtime } = setUp(
        fakeAccount({ normalizeTo: 'Marta R.' })
      );
      signIn(tokens);
      await store.load();
      await store.rename('Marta   R.', 'MY_GROUPS_TOO');

      realtime.emit('user.usernameChanged', {
        userId: 'u1',
        username: 'Marta R.',
      });

      expect(store.profile()?.username).toBe('Marta R.');
      expect(session.username()).toBe('Marta R.');
    });

    it('reads the id without SessionStore, which it cannot inject', async () => {
      // `SessionStore` injects **this** store to apply rule A2, so reaching back for
      // it would close a DI cycle. The id comes off the token pair instead, which is
      // where `SessionStore.userId` gets it from anyway. Asserted by resolving this
      // store in an injector that has no `SessionStore` in it at all.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideVelistaTesting(),
          provideHttpClient(),
          ApiUrl,
          Mutations,
          TokenStore,
          ProfileStore,
          { provide: ACCOUNT_SERVICE, useValue: fakeAccount() },
          { provide: REALTIME_CLIENT, useExisting: RealtimeMemory },
        ],
      });

      const store = TestBed.inject(ProfileStore);
      signIn(TestBed.inject(TokenStore));
      await store.load();

      TestBed.inject(RealtimeMemory).emit('user.usernameChanged', {
        userId: 'u1',
        username: 'Marta R.',
      });

      expect(store.profile()?.username).toBe('Marta R.');
    });
  });

  describe('renaming', () => {
    it('sends the scope it was given', async () => {
      const service = fakeAccount();
      const { store } = setUp(service);

      await store.rename('Marta R.', 'ONLY_HERE');

      expect(service.calls).toContainEqual({
        method: 'setUsername',
        username: 'Marta R.',
        scope: 'ONLY_HERE',
      });
    });

    it('reports a failure rather than throwing', async () => {
      const error = new GatewayError({
        code: 'rate_limited',
        status: 429,
        correlationId: 'c1',
        retryAfterSeconds: 2468,
      });
      const { store } = setUp(fakeAccount({ setRejectsWith: error }));

      await expect(store.rename('Marta R.', 'MY_GROUPS_TOO')).resolves.toEqual({
        state: 'failed',
        error,
      });
    });
  });

  describe('deleting', () => {
    it('does not clear the session itself', async () => {
      // Clearing is a decision about where the app goes next, which belongs to the
      // sheet that has somewhere to navigate to.
      const { store, tokens } = setUp(fakeAccount());
      tokens.set({
        userId: 'u1',
        kind: 'REGISTERED',
        username: 'Marta',
        accessToken: 'access',
        refreshToken: 'refresh',
      });

      await store.remove();

      expect(tokens.tokens()).not.toBeNull();
    });
  });

  describe('clearing', () => {
    it('drops what it holds, so the next person sees no address of theirs', async () => {
      const { store } = setUp(fakeAccount());
      await store.load();

      store.clear();

      expect(store.profile()).toBeNull();
      expect(store.username()).toBeNull();
    });
  });
});
