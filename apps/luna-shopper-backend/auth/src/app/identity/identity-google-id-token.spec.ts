import { Logger } from '@nestjs/common';
import {
  AuthProvider,
  LEGAL_TEMPLATES,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  GoogleSignInNeedsConsentException,
  InvalidGoogleTokenException,
  NotConfiguredException,
  TermsVersionStaleException,
  ValidationException,
} from '@portfolio/luna-shopper/platform';
import { createHash } from 'node:crypto';
import { fakeAudit } from '../audit/auth-audit.testing';
import {
  Credential,
  EmailVerification,
  OAuthHandoff,
  OAuthIdentity,
  OAuthNonce,
  OAuthState,
  PasswordReset,
  RefreshToken,
  TermsAcceptanceVia,
  User,
} from '../entities';
import { InMemoryTokenGrantService } from '../tokens/token-grant.testing';
import { UsernameGenerator } from '../username/username-generator.service';
import type {
  GoogleIdTokenClaims,
  GoogleIdTokenVerifier,
} from './google-id-token-verifier';
import { IdentityService } from './identity.service';
import { InMemoryTermsService } from './terms.testing';

/**
 * The Android app signs in with a Google ID token (plan 0238).
 *
 * The verifier is a double that answers the claims a spec registered for a
 * token, and `null` for any other token, which is what the real one answers
 * for a bad signature, another audience or issuer, or an expired token. That
 * the real one does refuse each of those is proven against google-auth-library
 * itself, with a key of its own and no network, in
 * `google-id-token-verifier.spec.ts`. What makes two spends of one nonce yield
 * one pair is proven against a real Postgres, in
 * `google-id-token.integration.spec.ts`.
 */

const CURRENT = LEGAL_TEMPLATES.terms.version;
const CLIENT_ID = 'web-client.apps.googleusercontent.com';

const GUEST_A = 'guest-a';
const USER_B = 'user-b';

/** What Google says about the person signing in. */
const person = {
  sub: 'g-person',
  email: 'person@example.com',
  name: 'Example Person',
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
    delete: async (where: Row) => {
      const kept = store.filter((candidate) => !matches(candidate, where));
      const affected = store.length - kept.length;
      store.splice(0, store.length, ...kept);
      return { affected };
    },
  };
}

function build(
  options: { google?: boolean; acceptanceRequired?: boolean } = {}
) {
  const stores = {
    users: [] as Row[],
    credentials: [] as Row[],
    verifications: [] as Row[],
    resets: [] as Row[],
    states: [] as Row[],
    handoffs: [] as Row[],
    nonces: [] as Row[],
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
    [OAuthNonce, makeRepo(stores.nonces)],
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
  const terms = new InMemoryTermsService({
    acceptanceRequired: options.acceptanceRequired ?? false,
  });

  // The double of the verifier: the claims registered for a token, or null.
  const claimsByToken = new Map<string, GoogleIdTokenClaims>();
  const verifier = {
    verify: jest.fn(
      async (idToken: string) => claimsByToken.get(idToken) ?? null
    ),
  };

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
        google: { enabled: options.google ?? true, clientId: CLIENT_ID },
      }),
    } as never,
    undefined as never,
    terms,
    { publishSoon: () => undefined } as never,
    verifier as unknown as GoogleIdTokenVerifier
  );

  let tokenSerial = 0;
  /**
   * A token the double accepts, carrying `nonce` and what Google said about
   * the person, with any claim overridden.
   */
  const tokenFor = (
    nonce: string | undefined,
    claims: Partial<GoogleIdTokenClaims> = {}
  ): string => {
    const idToken = `id-token-${++tokenSerial}`;
    claimsByToken.set(idToken, {
      sub: person.sub,
      email: person.email,
      emailVerified: true,
      name: person.name,
      ...(nonce === undefined ? {} : { nonce }),
      ...claims,
    });
    return idToken;
  };

  const addGuest = (id: string) =>
    stores.users.push({
      id,
      kind: UserKind.TEMPORARY,
      username: 'Quiet Lantern',
      email: null,
      emailVerifiedAt: null,
      displayName: null,
    });

  /** A registered account under `email`, with a password. */
  const addRegistered = (id: string, email = person.email) => {
    stores.users.push({
      id,
      kind: UserKind.REGISTERED,
      username: 'Bruma Audaz',
      email,
      emailVerifiedAt: new Date('2026-01-01'),
      displayName: null,
    });
    stores.credentials.push({ id: `cred-${id}`, userId: id });
  };

  /** The Google identity of `person`, linked onto `userId`. */
  const linkPerson = (userId: string) =>
    stores.identities.push({
      id: `oi-${userId}`,
      userId,
      provider: AuthProvider.GOOGLE,
      providerUserId: person.sub,
    });

  /** Everything a refused sign in must leave as it was. */
  const snapshot = () =>
    JSON.stringify({
      users: stores.users,
      credentials: stores.credentials,
      identities: stores.identities,
      refreshTokens: stores.refreshTokens,
      terms: terms.rows,
    });

  return {
    service,
    stores,
    tokens,
    events,
    terms,
    verifier,
    tokenFor,
    addGuest,
    addRegistered,
    linkPerson,
    snapshot,
  };
}

describe('POST /v1/auth/google/nonce, in auth', () => {
  it('stores only the hash, beside the caller, the flag, the version and the locale', async () => {
    const { service, stores } = build();

    const { nonce, clientId } = await service.mintGoogleNonce({
      userId: GUEST_A,
      locale: 'es',
      acceptedTermsVersion: CURRENT,
    });

    expect(clientId).toBe(CLIENT_ID);
    // 32 random bytes in base64url.
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stores.nonces).toEqual([
      expect.objectContaining({
        userId: GUEST_A,
        silent: false,
        termsVersion: CURRENT,
        locale: 'es',
        tokenHash: createHash('sha256').update(nonce).digest('hex'),
      }),
    ]);
    expect(JSON.stringify(stores.nonces)).not.toContain(nonce);
  });

  it('gives the nonce ten minutes', async () => {
    const { service, stores } = build();
    const before = Date.now();

    await service.mintGoogleNonce({});
    const after = Date.now();

    const expiresAt = (stores.nonces[0]['expiresAt'] as Date).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 10 * 60 * 1000);
  });

  it('mints with nobody when there is no bearer', async () => {
    const { service, stores } = build();

    await service.mintGoogleNonce({ silent: true });

    expect(stores.nonces[0]).toMatchObject({
      userId: null,
      silent: true,
      termsVersion: null,
      locale: null,
    });
  });

  it('refuses a silent nonce that carries a Terms version, and writes nothing', async () => {
    const { service, stores } = build();

    await expect(
      service.mintGoogleNonce({ silent: true, acceptedTermsVersion: CURRENT })
    ).rejects.toBeInstanceOf(ValidationException);
    expect(stores.nonces).toEqual([]);
  });

  it('refuses a stale Terms version before Android is asked', async () => {
    const { service, stores } = build();

    await expect(
      service.mintGoogleNonce({ acceptedTermsVersion: '1999-01-01' })
    ).rejects.toBeInstanceOf(TermsVersionStaleException);
    expect(stores.nonces).toEqual([]);
  });

  it('mints a silent nonce where acceptance is required: it accepts nothing and creates nothing', async () => {
    const { service, stores } = build({ acceptanceRequired: true });

    await service.mintGoogleNonce({ silent: true });

    expect(stores.nonces).toHaveLength(1);
  });

  it('answers not_configured without Google', async () => {
    const { service, stores } = build({ google: false });

    await expect(service.mintGoogleNonce({})).rejects.toBeInstanceOf(
      NotConfiguredException
    );
    expect(stores.nonces).toEqual([]);
  });
});

describe('an interactive sign in', () => {
  it('creates a registered account from scratch and records the Terms', async () => {
    const { service, stores, events, terms, tokenFor } = build();
    const { nonce } = await service.mintGoogleNonce({
      acceptedTermsVersion: CURRENT,
    });

    const pair = await service.signInWithGoogleIdToken({
      idToken: tokenFor(nonce),
    });

    expect(stores.users).toEqual([
      expect.objectContaining({
        id: pair.userId,
        kind: UserKind.REGISTERED,
        email: person.email,
        displayName: person.name,
      }),
    ]);
    // Not the Google profile name (plan 0018, section 1).
    expect(stores.users[0]['username']).not.toBe(person.name);
    expect(stores.identities).toEqual([
      expect.objectContaining({
        userId: pair.userId,
        provider: AuthProvider.GOOGLE,
        providerUserId: person.sub,
      }),
    ]);
    expect(terms.rows).toEqual([
      expect.objectContaining({
        userId: pair.userId,
        version: CURRENT,
        via: TermsAcceptanceVia.GOOGLE,
      }),
    ]);
    expect(events.userRegistered).toHaveBeenCalledWith({
      userId: pair.userId,
    });
    expect(stores.nonces[0]['consumedAt']).toBeInstanceOf(Date);
  });

  it('signs in the account the Google identity already opens', async () => {
    const { service, stores, events, addRegistered, linkPerson, tokenFor } =
      build();
    addRegistered(USER_B);
    linkPerson(USER_B);
    const { nonce } = await service.mintGoogleNonce({});

    const pair = await service.signInWithGoogleIdToken({
      idToken: tokenFor(nonce),
    });

    expect(pair.userId).toBe(USER_B);
    expect(stores.users).toHaveLength(1);
    expect(events.userRegistered).not.toHaveBeenCalled();
  });

  it('links onto the guest that minted the nonce, upgrading it in place', async () => {
    const { service, stores, events, addGuest, tokenFor } = build();
    addGuest(GUEST_A);
    const { nonce } = await service.mintGoogleNonce({ userId: GUEST_A });

    const pair = await service.signInWithGoogleIdToken({
      idToken: tokenFor(nonce),
      callerUserId: GUEST_A,
    });

    expect(pair.userId).toBe(GUEST_A);
    expect(stores.users).toHaveLength(1);
    expect(stores.users[0]).toMatchObject({
      kind: UserKind.REGISTERED,
      email: person.email,
    });
    expect(stores.identities).toEqual([
      expect.objectContaining({ userId: GUEST_A, providerUserId: person.sub }),
    ]);
    expect(events.userUpgraded).toHaveBeenCalledWith({ userId: GUEST_A });
  });

  it('links onto the account that already holds the address, as the redirect flow does', async () => {
    const { service, stores, addRegistered, tokenFor } = build();
    addRegistered(USER_B);
    const { nonce } = await service.mintGoogleNonce({});

    const pair = await service.signInWithGoogleIdToken({
      idToken: tokenFor(nonce),
    });

    expect(pair.userId).toBe(USER_B);
    expect(stores.identities).toEqual([
      expect.objectContaining({ userId: USER_B, providerUserId: person.sub }),
    ]);
  });
});

describe('a silent sign in', () => {
  it('signs in an identity that is already linked, and records no Terms', async () => {
    const { service, terms, addRegistered, linkPerson, tokenFor } = build();
    addRegistered(USER_B);
    linkPerson(USER_B);
    const { nonce } = await service.mintGoogleNonce({ silent: true });

    const pair = await service.signInWithGoogleIdToken({
      idToken: tokenFor(nonce),
    });

    expect(pair.userId).toBe(USER_B);
    expect(terms.rows).toEqual([]);
  });

  it('signs in a registered caller whose own identity this is, and writes no row', async () => {
    const {
      service,
      stores,
      events,
      terms,
      addRegistered,
      linkPerson,
      tokenFor,
    } = build();
    addRegistered(USER_B);
    linkPerson(USER_B);
    const { nonce } = await service.mintGoogleNonce({
      userId: USER_B,
      silent: true,
    });
    // The pair writes its refresh token; nothing else may change.
    const before = JSON.stringify({
      users: stores.users,
      credentials: stores.credentials,
      identities: stores.identities,
      terms: terms.rows,
    });

    const pair = await service.signInWithGoogleIdToken({
      idToken: tokenFor(nonce),
      callerUserId: USER_B,
    });

    expect(pair.userId).toBe(USER_B);
    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(
      JSON.stringify({
        users: stores.users,
        credentials: stores.credentials,
        identities: stores.identities,
        terms: terms.rows,
      })
    ).toBe(before);
    expect(events.userRegistered).not.toHaveBeenCalled();
    expect(events.userUpgraded).not.toHaveBeenCalled();
  });

  it('needs consent for a Google account this deployment has never seen, and writes no row', async () => {
    const { service, stores, snapshot, tokenFor } = build();
    const { nonce } = await service.mintGoogleNonce({ silent: true });
    const before = snapshot();

    await expect(
      service.signInWithGoogleIdToken({ idToken: tokenFor(nonce) })
    ).rejects.toMatchObject({
      code: ERROR_CODES.GOOGLE_SIGN_IN_NEEDS_CONSENT,
    });

    expect(snapshot()).toBe(before);
    expect(stores.users).toEqual([]);
    expect(stores.identities).toEqual([]);
  });

  it('needs consent for a known address with no identity: no claim by address', async () => {
    const { service, snapshot, addRegistered, tokenFor } = build();
    addRegistered(USER_B);
    const { nonce } = await service.mintGoogleNonce({ silent: true });
    const before = snapshot();

    await expect(
      service.signInWithGoogleIdToken({ idToken: tokenFor(nonce) })
    ).rejects.toBeInstanceOf(GoogleSignInNeedsConsentException);

    expect(snapshot()).toBe(before);
  });

  it('needs consent for a guest caller, and links nothing onto the guest', async () => {
    const { service, stores, snapshot, addGuest, tokenFor } = build();
    addGuest(GUEST_A);
    const { nonce } = await service.mintGoogleNonce({
      userId: GUEST_A,
      silent: true,
    });
    const before = snapshot();

    await expect(
      service.signInWithGoogleIdToken({
        idToken: tokenFor(nonce),
        callerUserId: GUEST_A,
      })
    ).rejects.toBeInstanceOf(GoogleSignInNeedsConsentException);

    expect(snapshot()).toBe(before);
    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
  });

  it('needs consent for a guest caller even when the identity opens another account', async () => {
    const { service, snapshot, addGuest, addRegistered, linkPerson, tokenFor } =
      build();
    addGuest(GUEST_A);
    addRegistered(USER_B);
    linkPerson(USER_B);
    const { nonce } = await service.mintGoogleNonce({
      userId: GUEST_A,
      silent: true,
    });
    const before = snapshot();

    // Signing in to USER_B would leave the guest's zones behind it without
    // the person having pressed anything.
    await expect(
      service.signInWithGoogleIdToken({
        idToken: tokenFor(nonce),
        callerUserId: GUEST_A,
      })
    ).rejects.toBeInstanceOf(GoogleSignInNeedsConsentException);

    expect(snapshot()).toBe(before);
  });

  it('spends the nonce it refused', async () => {
    const { service, stores, tokenFor } = build();
    const { nonce } = await service.mintGoogleNonce({ silent: true });
    const idToken = tokenFor(nonce);

    await expect(
      service.signInWithGoogleIdToken({ idToken })
    ).rejects.toBeInstanceOf(GoogleSignInNeedsConsentException);

    expect(stores.nonces[0]['consumedAt']).toBeInstanceOf(Date);
    await expect(
      service.signInWithGoogleIdToken({ idToken })
    ).rejects.toBeInstanceOf(InvalidGoogleTokenException);
  });
});

describe('every failed check is invalid_google_token', () => {
  async function refusal(promise: Promise<unknown>): Promise<Error> {
    const error = await promise.then(
      () => {
        throw new Error('the sign in was expected to be refused');
      },
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(InvalidGoogleTokenException);
    expect(error).toMatchObject({ code: ERROR_CODES.INVALID_GOOGLE_TOKEN });
    return error as Error;
  }

  it('a spent nonce', async () => {
    const { service, stores, tokenFor } = build();
    const { nonce } = await service.mintGoogleNonce({});
    const idToken = tokenFor(nonce);
    await service.signInWithGoogleIdToken({ idToken });

    await refusal(service.signInWithGoogleIdToken({ idToken }));
    // A second token around the same nonce fares no better.
    await refusal(
      service.signInWithGoogleIdToken({ idToken: tokenFor(nonce) })
    );
    expect(stores.users).toHaveLength(1);
  });

  it('an unknown nonce', async () => {
    const { service, snapshot, tokenFor } = build();
    const before = snapshot();

    await refusal(
      service.signInWithGoogleIdToken({ idToken: tokenFor('never-minted') })
    );
    expect(snapshot()).toBe(before);
  });

  it('an expired nonce', async () => {
    const { service, stores, snapshot, tokenFor } = build();
    const { nonce } = await service.mintGoogleNonce({});
    stores.nonces[0]['expiresAt'] = new Date(Date.now() - 1000);
    const before = snapshot();

    await refusal(
      service.signInWithGoogleIdToken({ idToken: tokenFor(nonce) })
    );
    expect(snapshot()).toBe(before);
  });

  it('a token with no nonce, which spends nothing', async () => {
    const { service, stores, tokenFor } = build();
    await service.mintGoogleNonce({});

    await refusal(
      service.signInWithGoogleIdToken({ idToken: tokenFor(undefined) })
    );
    expect(stores.nonces[0]['consumedAt']).toBeFalsy();
    expect(stores.users).toEqual([]);
  });

  it('a token the verifier refuses: wrong audience, expired, bad signature', async () => {
    const { service, stores, verifier } = build();
    const { nonce } = await service.mintGoogleNonce({});

    await refusal(
      service.signInWithGoogleIdToken({ idToken: `refused.${nonce}` })
    );
    expect(verifier.verify).toHaveBeenCalledWith(`refused.${nonce}`);
    // Nothing of an unverified token is trusted, its nonce included.
    expect(stores.nonces[0]['consumedAt']).toBeFalsy();
    expect(stores.users).toEqual([]);
  });

  it('email_verified: false, which spends nothing and creates nothing', async () => {
    const { service, stores, tokenFor } = build();
    const { nonce } = await service.mintGoogleNonce({});

    await refusal(
      service.signInWithGoogleIdToken({
        idToken: tokenFor(nonce, { emailVerified: false }),
      })
    );
    expect(stores.nonces[0]['consumedAt']).toBeFalsy();
    expect(stores.users).toEqual([]);
    expect(stores.identities).toEqual([]);
  });

  it('a caller who is not the user the nonce names, which burns the nonce', async () => {
    const { service, stores, addGuest, tokenFor } = build();
    addGuest(GUEST_A);
    const { nonce } = await service.mintGoogleNonce({ userId: GUEST_A });
    const idToken = tokenFor(nonce);

    await refusal(
      service.signInWithGoogleIdToken({ idToken, callerUserId: USER_B })
    );
    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
    expect(stores.identities).toEqual([]);
    expect(stores.nonces[0]['consumedAt']).toBeInstanceOf(Date);
    // Spent, so the right caller cannot follow the wrong one.
    await refusal(
      service.signInWithGoogleIdToken({ idToken, callerUserId: GUEST_A })
    );
  });

  it('no caller at all when the nonce names one', async () => {
    const { service, stores, addGuest, tokenFor } = build();
    addGuest(GUEST_A);
    const { nonce } = await service.mintGoogleNonce({ userId: GUEST_A });

    await refusal(
      service.signInWithGoogleIdToken({ idToken: tokenFor(nonce) })
    );
    expect(stores.users).toHaveLength(1);
  });

  it('answers each of them with the same message, which names no token', async () => {
    const { service, tokenFor } = build();
    const { nonce } = await service.mintGoogleNonce({});
    const spentToken = tokenFor(nonce);
    await service.signInWithGoogleIdToken({ idToken: spentToken });

    const messages = [
      (await refusal(service.signInWithGoogleIdToken({ idToken: spentToken })))
        .message,
      (
        await refusal(
          service.signInWithGoogleIdToken({ idToken: tokenFor('unknown') })
        )
      ).message,
      (
        await refusal(
          service.signInWithGoogleIdToken({ idToken: 'not-a-google-token' })
        )
      ).message,
    ];

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).not.toContain(spentToken);
    expect(messages[0]).not.toContain('not-a-google-token');
  });
});

describe('what a sign in logs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('names the way in and never the token or the nonce', async () => {
    const lines: string[] = [];
    const record = (message: unknown) => {
      lines.push(String(message));
    };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(record);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(record);
    const { service, tokenFor } = build();

    const { nonce } = await service.mintGoogleNonce({});
    const idToken = tokenFor(nonce);
    await service.signInWithGoogleIdToken({ idToken });
    await service.signInWithGoogleIdToken({ idToken }).catch(() => undefined);
    await service
      .signInWithGoogleIdToken({ idToken: 'refused-token' })
      .catch(() => undefined);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(line).toContain('google_id_token');
      expect(line).not.toContain(idToken);
      expect(line).not.toContain(nonce);
      expect(line).not.toContain('refused-token');
      expect(line).not.toContain(person.email);
    }
  });
});

describe('without Google', () => {
  it('answers not_configured and asks the verifier nothing', async () => {
    const { service, verifier } = build({ google: false });

    await expect(
      service.signInWithGoogleIdToken({ idToken: 'any' })
    ).rejects.toBeInstanceOf(NotConfiguredException);
    expect(verifier.verify).not.toHaveBeenCalled();
  });
});
