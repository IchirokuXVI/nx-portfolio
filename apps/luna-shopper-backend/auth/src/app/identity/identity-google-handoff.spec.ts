import { AuthProvider, UserKind } from '@portfolio/luna-shopper/contracts';
import {
  UnauthorizedException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { createHash } from 'node:crypto';
import { fakeAudit } from '../audit/auth-audit.testing';
import {
  Credential,
  EmailVerification,
  OAuthHandoff,
  OAuthIdentity,
  OAuthState,
  PasswordReset,
  RefreshToken,
  User,
} from '../entities';
import { InMemoryTokenGrantService } from '../tokens/token-grant.testing';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';
import { InMemoryTermsService } from './terms.testing';

/**
 * A Google sign in lands only on the account that asked for it (plan 0230,
 * section 5.1).
 *
 * The attack this closes, finding F2 of the session token review: an attacker
 * mints a guest, mints a state under the guest's token, and sends a victim the
 * start link. The victim consents, and the callback used to link the victim's
 * Google identity onto the attacker's guest. Now the callback stages, and the
 * exchange needs the verifier of the minting browser and the bearer of the link
 * target. These specs walk both halves at the service level, the attack and
 * the honest flow, through the same calls the gateway makes.
 */

/** A fixed verifier and its S256 challenge, base64url of its SHA-256. */
const VERIFIER = 'dBjftJeZ4CVP-mJ92K1ifhZ-dDyiYZUiYvyCxt3zbJs';
const CHALLENGE = 'lgghW2CGVJuIAQbifjAcK_8CsFoeysR6G6EYjaO0E8c';
/** A verifier of the right shape whose hash is not {@link CHALLENGE}. */
const OTHER_VERIFIER = 'A'.repeat(43);

const GUEST_A = 'guest-a';
const USER_B = 'user-b';

/** What Google said about the victim. */
const victim = {
  providerUserId: 'g-victim',
  email: 'victim@example.com',
  displayName: 'Victim Person',
};

type Row = Record<string, unknown>;

/** An in memory repository double, one per entity. */
function makeRepo(store: Row[]) {
  let sequence = 0;
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  const findOne = async ({ where }: { where: Row }) =>
    store.find((row) => matches(row, where)) ?? null;

  return {
    store,
    create: (row: Row) => ({ ...row }),
    save: async (row: Row) => {
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
    },
    findOne,
    findOneOrFail: async (options: { where: Row }) => {
      const row = await findOne(options);
      if (!row) {
        throw new Error('not found');
      }
      return row;
    },
    find: async ({ where }: { where: Row }) =>
      store.filter((row) => matches(row, where)),
    update: async (where: Row, patch: Row) => {
      const rows = store.filter((candidate) => matches(candidate, where));
      rows.forEach((row) => Object.assign(row, patch));
      return { affected: rows.length };
    },
  };
}

function build() {
  const stores = {
    users: [] as Row[],
    credentials: [] as Row[],
    verifications: [] as Row[],
    resets: [] as Row[],
    states: [] as Row[],
    handoffs: [] as Row[],
    identities: [] as Row[],
    refreshTokens: [] as Row[],
  };
  const repos = new Map<unknown, ReturnType<typeof makeRepo>>([
    [User, makeRepo(stores.users)],
    [Credential, makeRepo(stores.credentials)],
    [EmailVerification, makeRepo(stores.verifications)],
    [PasswordReset, makeRepo(stores.resets)],
    [OAuthState, makeRepo(stores.states)],
    [OAuthHandoff, makeRepo(stores.handoffs)],
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

  // A token service that writes and revokes refresh rows in the store, so a
  // spec can count the live sessions of an account.
  let issued = 0;
  const tokens = {
    issueTokens: jest.fn(
      async (user: { id: string; kind: UserKind; username: string }) => {
        const refreshToken = `refresh-${++issued}`;
        stores.refreshTokens.push({
          id: `rt-${issued}`,
          userId: user.id,
          tokenHash: refreshToken,
          revokedAt: null,
        });
        return {
          userId: user.id,
          kind: user.kind,
          username: user.username,
          accessToken: `access-${issued}`,
          refreshToken,
        };
      }
    ),
    revokeAllForUser: jest.fn(
      async (
        userId: string,
        manager?: { getRepository: typeof getRepository }
      ) => {
        await (manager ?? dataSource)
          .getRepository(RefreshToken)
          .update({ userId, revokedAt: null }, { revokedAt: new Date() });
      }
    ),
  };
  const events = { userRegistered: jest.fn(), userUpgraded: jest.fn() };

  const service = new IdentityService(
    dataSource as never,
    tokens as never,
    new InMemoryTokenGrantService(),
    { hash: jest.fn(async () => 'hashed'), verify: jest.fn() } as never,
    { sendVerificationEmail: jest.fn(async () => undefined) } as never,
    events as never,
    new UsernameGenerator(),
    fakeAudit([]).service,
    {
      getOrThrow: () => ({
        smtp: { enabled: true, verifyBaseUrl: 'https://app.example' },
        google: { enabled: true },
      }),
    } as never,
    undefined as never,
    new InMemoryTermsService()
  );

  const addGuest = (id: string) =>
    stores.users.push({
      id,
      kind: UserKind.TEMPORARY,
      username: 'Quiet Lantern',
      email: null,
      emailVerifiedAt: null,
      displayName: null,
    });

  /** A live refresh row of the account, as a session it already holds. */
  const addSession = (userId: string, id: string) =>
    stores.refreshTokens.push({
      id,
      userId,
      tokenHash: `old-${id}`,
      revokedAt: null,
    });

  const liveSessions = (userId: string) =>
    stores.refreshTokens.filter(
      (row) => row['userId'] === userId && row['revokedAt'] === null
    );

  /**
   * The gateway's three calls up to the exchange: mint, consume at the
   * callback, stage what Google said. Answers the code the fragment carries.
   */
  async function throughCallback(linkUserId?: string): Promise<string> {
    const { state } = await service.mintOAuthState({
      ...(linkUserId ? { userId: linkUserId } : {}),
      locale: 'en',
      codeChallenge: CHALLENGE,
    });
    const payload = await service.consumeOAuthState({ state });
    const { code } = await service.stageGoogleSignIn({
      ...victim,
      linkUserId: payload.userId,
      codeChallenge: payload.codeChallenge,
      locale: payload.locale,
    });
    return code;
  }

  return {
    service,
    stores,
    tokens,
    events,
    addGuest,
    addSession,
    liveSessions,
    throughCallback,
  };
}

describe('the callback stages and changes nothing', () => {
  it('writes one handoff row and touches no account', async () => {
    const { stores, addGuest, throughCallback } = build();
    addGuest(GUEST_A);

    const code = await throughCallback(GUEST_A);

    expect(stores.handoffs).toHaveLength(1);
    const handoff = stores.handoffs[0];
    expect(handoff).toMatchObject({
      userId: GUEST_A,
      providerUserId: victim.providerUserId,
      email: victim.email,
      displayName: victim.displayName,
      codeChallenge: CHALLENGE,
      locale: 'en',
    });
    expect(handoff['consumedAt']).toBeFalsy();
    // Only the hash is kept, as for every grant.
    expect(handoff['tokenHash']).toBe(
      createHash('sha256').update(code).digest('hex')
    );
    expect(JSON.stringify(stores.handoffs)).not.toContain(code);
    // Nothing permanent.
    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
    expect(stores.identities).toEqual([]);
  });

  it('gives the code two minutes', async () => {
    const { stores, throughCallback } = build();
    const before = Date.now();

    await throughCallback();
    const after = Date.now();

    const expiresAt = (stores.handoffs[0]['expiresAt'] as Date).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 2 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 2 * 60 * 1000);
  });
});

describe('1. the honest link', () => {
  it('upgrades the guest in place, with one live session, the one returned', async () => {
    const { service, stores, events, addGuest, liveSessions, throughCallback } =
      build();
    addGuest(GUEST_A);

    const code = await throughCallback(GUEST_A);
    const tokens = await service.exchangeGoogleSignIn({
      code,
      codeVerifier: VERIFIER,
      callerUserId: GUEST_A,
    });

    expect(tokens.userId).toBe(GUEST_A);
    expect(stores.users[0]['kind']).toBe(UserKind.REGISTERED);
    expect(stores.users[0]['email']).toBe(victim.email);
    expect(stores.identities).toEqual([
      expect.objectContaining({
        userId: GUEST_A,
        provider: AuthProvider.GOOGLE,
        providerUserId: victim.providerUserId,
      }),
    ]);
    expect(liveSessions(GUEST_A).map((row) => row['tokenHash'])).toEqual([
      tokens.refreshToken,
    ]);
    expect(events.userUpgraded).toHaveBeenCalledWith({ userId: GUEST_A });
    expect(events.userRegistered).not.toHaveBeenCalled();
  });
});

describe('2. the honest sign in from scratch', () => {
  it('creates a registered user', async () => {
    const { service, stores, events, throughCallback } = build();

    const code = await throughCallback();
    const tokens = await service.exchangeGoogleSignIn({
      code,
      codeVerifier: VERIFIER,
    });

    expect(stores.users).toHaveLength(1);
    expect(stores.users[0]).toMatchObject({
      id: tokens.userId,
      kind: UserKind.REGISTERED,
      email: victim.email,
    });
    // Not the Google profile name (plan 0018, section 1).
    expect(stores.users[0]['username']).not.toBe(victim.displayName);
    expect(stores.identities).toEqual([
      expect.objectContaining({ userId: tokens.userId }),
    ]);
    expect(events.userRegistered).toHaveBeenCalledWith({
      userId: tokens.userId,
    });
  });

  it('signs in the account a Google identity already belongs to', async () => {
    const { service, stores, throughCallback } = build();
    const first = await service.exchangeGoogleSignIn({
      code: await throughCallback(),
      codeVerifier: VERIFIER,
    });

    const second = await service.exchangeGoogleSignIn({
      code: await throughCallback(),
      codeVerifier: VERIFIER,
    });

    expect(second.userId).toBe(first.userId);
    expect(stores.users).toHaveLength(1);
  });
});

describe('3. the attack, wrong verifier', () => {
  it('is refused, links nothing, and burns the code', async () => {
    const { service, stores, addGuest, throughCallback } = build();
    addGuest(GUEST_A);
    const code = await throughCallback(GUEST_A);

    await expect(
      service.exchangeGoogleSignIn({
        code,
        codeVerifier: OTHER_VERIFIER,
        callerUserId: GUEST_A,
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
    expect(stores.identities).toEqual([]);
    expect(stores.handoffs[0]['consumedAt']).toBeInstanceOf(Date);
    // Spent, so the right verifier cannot follow the wrong one.
    await expect(
      service.exchangeGoogleSignIn({
        code,
        codeVerifier: VERIFIER,
        callerUserId: GUEST_A,
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
  });
});

describe('4. the attack, right verifier, wrong account', () => {
  it('is refused with the bearer of another account', async () => {
    const { service, stores, addGuest, throughCallback } = build();
    addGuest(GUEST_A);
    const code = await throughCallback(GUEST_A);

    await expect(
      service.exchangeGoogleSignIn({
        code,
        codeVerifier: VERIFIER,
        callerUserId: USER_B,
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
    expect(stores.identities).toEqual([]);
  });

  it('is refused with no bearer at all', async () => {
    const { service, stores, addGuest, throughCallback } = build();
    addGuest(GUEST_A);
    const code = await throughCallback(GUEST_A);

    await expect(
      service.exchangeGoogleSignIn({ code, codeVerifier: VERIFIER })
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(stores.users).toHaveLength(1);
    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
    expect(stores.identities).toEqual([]);
  });
});

describe('5. a replayed code', () => {
  it('is refused the second time', async () => {
    const { service, addGuest, throughCallback } = build();
    addGuest(GUEST_A);
    const code = await throughCallback(GUEST_A);
    const exchange = () =>
      service.exchangeGoogleSignIn({
        code,
        codeVerifier: VERIFIER,
        callerUserId: GUEST_A,
      });

    await expect(exchange()).resolves.toMatchObject({ userId: GUEST_A });
    await expect(exchange()).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('6. an expired code', () => {
  it('is refused', async () => {
    const { service, stores, addGuest, throughCallback } = build();
    addGuest(GUEST_A);
    const code = await throughCallback(GUEST_A);
    stores.handoffs[0]['expiresAt'] = new Date(Date.now() - 1000);

    await expect(
      service.exchangeGoogleSignIn({
        code,
        codeVerifier: VERIFIER,
        callerUserId: GUEST_A,
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
  });

  it('answers an unknown, a spent and an expired code the same way', async () => {
    const { service, stores, throughCallback } = build();
    const code = await throughCallback();
    stores.handoffs[0]['expiresAt'] = new Date(Date.now() - 1000);

    const expired = await service
      .exchangeGoogleSignIn({ code, codeVerifier: VERIFIER })
      .catch((error: Error) => error.message);
    const unknown = await service
      .exchangeGoogleSignIn({ code: 'never-staged', codeVerifier: VERIFIER })
      .catch((error: Error) => error.message);

    expect(expired).toBe(unknown);
  });
});

describe('7. a state with no challenge', () => {
  it('is refused at consume', async () => {
    const { service, stores } = build();
    const { state } = await service.mintOAuthState({
      userId: GUEST_A,
      codeChallenge: CHALLENGE,
    });
    // A row as a mint before plan 0230 wrote it.
    stores.states[0]['codeChallenge'] = null;

    await expect(service.consumeOAuthState({ state })).rejects.toBeInstanceOf(
      ValidationException
    );
  });

  it('cannot be minted', async () => {
    const { service, stores } = build();

    await expect(
      service.mintOAuthState({ userId: GUEST_A } as never)
    ).rejects.toBeInstanceOf(ValidationException);
    await expect(
      service.mintOAuthState({ codeChallenge: 'short' })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(stores.states).toEqual([]);
  });
});

describe('8. a bearer cannot turn a sign in into a link', () => {
  it('creates a new user and leaves the caller untouched', async () => {
    const { service, stores, addGuest, throughCallback } = build();
    addGuest(GUEST_A);
    const code = await throughCallback();

    const tokens = await service.exchangeGoogleSignIn({
      code,
      codeVerifier: VERIFIER,
      callerUserId: GUEST_A,
    });

    expect(tokens.userId).not.toBe(GUEST_A);
    expect(stores.users).toHaveLength(2);
    expect(stores.users[0]).toMatchObject({
      id: GUEST_A,
      kind: UserKind.TEMPORARY,
      email: null,
    });
    expect(stores.identities).toEqual([
      expect.objectContaining({ userId: tokens.userId }),
    ]);
  });
});

describe('9. an upgrade ends the other sessions', () => {
  it('by email: one live row remains, the one in the response', async () => {
    const { service, addGuest, addSession, liveSessions } = build();
    addGuest(GUEST_A);
    addSession(GUEST_A, 'rt-old-1');
    addSession(GUEST_A, 'rt-old-2');

    const tokens = await service.upgrade({
      userId: GUEST_A,
      email: 'a@example.com',
      password: 'hunter22!',
    });

    expect(liveSessions(GUEST_A).map((row) => row['tokenHash'])).toEqual([
      tokens.refreshToken,
    ]);
  });

  it('by Google, through the exchange: the same', async () => {
    const { service, addGuest, addSession, liveSessions, throughCallback } =
      build();
    addGuest(GUEST_A);
    addSession(GUEST_A, 'rt-old-1');
    addSession(GUEST_A, 'rt-old-2');

    const tokens = await service.exchangeGoogleSignIn({
      code: await throughCallback(GUEST_A),
      codeVerifier: VERIFIER,
      callerUserId: GUEST_A,
    });

    expect(liveSessions(GUEST_A).map((row) => row['tokenHash'])).toEqual([
      tokens.refreshToken,
    ]);
  });
});
