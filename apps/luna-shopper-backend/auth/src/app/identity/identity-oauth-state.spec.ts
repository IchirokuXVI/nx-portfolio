import { UserKind } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { createHash } from 'node:crypto';
import {
  Credential,
  EmailVerification,
  OAuthIdentity,
  OAuthState,
  PasswordReset,
  RefreshToken,
  User,
} from '../entities';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';

/**
 * The OAuth state grant (plan 0023, section 4.1 and section 7).
 *
 * What is under test is the property the whole design was chosen for: the state
 * is opaque, it is spent exactly once, and it expires in minutes. A state that
 * could be replayed is how an attacker links **their** Google identity onto
 * **your** account, and unlike a stolen access token that is permanent.
 */

type Row = Record<string, unknown>;

/** An in memory repository double, one per entity. */
function makeRepo(store: Row[]) {
  let sequence = 0;
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  return {
    store,
    create: (row: Row) => ({ ...row }),
    save: jest.fn(async (row: Row) => {
      const existing = row['id']
        ? store.find((candidate) => candidate['id'] === row['id'])
        : undefined;
      if (existing) {
        Object.assign(existing, row);
        return existing;
      }
      const saved = { id: `x${++sequence}`, ...row };
      store.push(saved);
      return saved;
    }),
    findOne: async ({ where }: { where: Row }) =>
      store.find((row) => matches(row, where)) ?? null,
    update: async (where: Row, patch: Row) => {
      const rows = store.filter((candidate) => matches(candidate, where));
      rows.forEach((row) => Object.assign(row, patch));
      return { affected: rows.length };
    },
    delete: async () => ({ affected: 1 }),
  };
}

function build() {
  const stores = {
    users: [] as Row[],
    credentials: [] as Row[],
    verifications: [] as Row[],
    resets: [] as Row[],
    states: [] as Row[],
    identities: [] as Row[],
    refreshTokens: [] as Row[],
  };
  const repos = new Map<unknown, ReturnType<typeof makeRepo>>([
    [User, makeRepo(stores.users)],
    [Credential, makeRepo(stores.credentials)],
    [EmailVerification, makeRepo(stores.verifications)],
    [PasswordReset, makeRepo(stores.resets)],
    [OAuthState, makeRepo(stores.states)],
    [OAuthIdentity, makeRepo(stores.identities)],
    [RefreshToken, makeRepo(stores.refreshTokens)],
  ]);
  const getRepository = (entity: unknown) => {
    const repo = repos.get(entity);
    if (!repo) {
      throw new Error('no repository double for that entity');
    }
    return repo;
  };
  const dataSource = {
    getRepository,
    transaction: (callback: (manager: unknown) => Promise<unknown>) =>
      callback({ getRepository }),
  };
  const service = new IdentityService(
    dataSource as never,
    { issueTokens: jest.fn(), revokeAllForUser: jest.fn() } as never,
    new TokenGrantService(),
    { hash: jest.fn(), verify: jest.fn() } as never,
    {} as never,
    {} as never,
    new UsernameGenerator(),
    { getOrThrow: () => ({ smtp: {} }) } as never
  );
  return { service, stores };
}

describe('minting an OAuth state', () => {
  it('round trips the userId and locale it was given', async () => {
    const { service } = build();

    const { state } = await service.mintOAuthState({
      userId: 'u1',
      locale: 'es',
    });

    await expect(service.consumeOAuthState({ state })).resolves.toEqual({
      userId: 'u1',
      locale: 'es',
    });
  });

  it('mints a state carrying nobody for a sign in from scratch', async () => {
    const { service } = build();

    const { state } = await service.mintOAuthState({ locale: 'en' });

    // Absent, not null: `OAuthStatePayload` says absent, and a `userId` of null
    // arriving at `googleLogin` as `linkUserId` would read as a link request for
    // nobody rather than as no link request at all.
    const payload = await service.consumeOAuthState({ state });
    expect(payload).toEqual({ locale: 'en' });
    expect('userId' in payload).toBe(false);
  });

  it('never stores the raw value', async () => {
    const { service, stores } = build();

    const { state } = await service.mintOAuthState({ userId: 'u1' });

    // A database read must not yield a usable state. Only the hash is kept, so a
    // dump of this table is a list of values nobody can spend.
    const row = stores.states[0];
    expect(row['tokenHash']).toBe(
      createHash('sha256').update(state).digest('hex')
    );
    expect(JSON.stringify(stores.states)).not.toContain(state);
  });

  it('gives it ten minutes: a consent screen and a password, not a lunch break', async () => {
    const { service, stores } = build();
    const before = Date.now();

    await service.mintOAuthState({ userId: 'u1' });
    const after = Date.now();

    const expiresAt = (stores.states[0]['expiresAt'] as Date).getTime();
    expect(expiresAt).toBeGreaterThan(before + 9 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 10 * 60 * 1000);
  });
});

describe('spending an OAuth state', () => {
  it('refuses the second attempt', async () => {
    const { service } = build();
    const { state } = await service.mintOAuthState({ userId: 'u1' });

    await expect(service.consumeOAuthState({ state })).resolves.toEqual({
      userId: 'u1',
    });

    // The property the store exists to provide. A replayable state is a standing
    // way to link an attacker's Google identity onto this account.
    await expect(service.consumeOAuthState({ state })).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('refuses one that has expired', async () => {
    const { service, stores } = build();
    const { state } = await service.mintOAuthState({ userId: 'u1' });

    stores.states[0]['expiresAt'] = new Date(Date.now() - 1000);

    await expect(service.consumeOAuthState({ state })).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('refuses one nobody ever minted', async () => {
    const { service } = build();

    await expect(
      service.consumeOAuthState({ state: 'not-a-state' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('refuses an absent one rather than treating it as no link', async () => {
    const { service } = build();

    // Section 4.4: falling back to "no linkUserId" here is the data loss this
    // plan exists to fix, arrived at from a different direction.
    await expect(
      service.consumeOAuthState({ state: '' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('answers the same way whichever of those it was', async () => {
    const { service, stores } = build();
    const { state } = await service.mintOAuthState({ userId: 'u1' });
    stores.states[0]['expiresAt'] = new Date(Date.now() - 1000);

    const expired = await service
      .consumeOAuthState({ state })
      .catch((error: Error) => error.message);
    const unknown = await service
      .consumeOAuthState({ state: 'never-minted' })
      .catch((error: Error) => error.message);

    // Telling them apart would tell a caller which of their guesses was once a
    // real state.
    expect(expired).toBe(unknown);
  });
});

describe('what a state is for', () => {
  it('is what makes a guest keep their userId through Google sign in', async () => {
    const { service, stores } = build();
    stores.users.push({
      id: 'guest-1',
      kind: UserKind.TEMPORARY,
      username: 'Quiet Lantern',
      email: null,
      emailVerifiedAt: null,
      displayName: null,
    });

    // The gateway mints this holding the guest's token, and reads it back after
    // Google hands the browser over. Everything between the two is a redirect,
    // and nothing in a redirect can carry an Authorization header.
    const { state } = await service.mintOAuthState({ userId: 'guest-1' });
    const payload = await service.consumeOAuthState({ state });

    expect(payload.userId).toBe('guest-1');
  });
});
