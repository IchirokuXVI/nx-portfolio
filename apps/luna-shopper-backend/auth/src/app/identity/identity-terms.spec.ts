import { UserKind } from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  TermsAcceptanceMissingException,
  TermsVersionStaleException,
} from '@portfolio/luna-shopper/platform';
import { fakeAudit } from '../audit/auth-audit.testing';
import {
  Credential,
  EmailVerification,
  OAuthHandoff,
  OAuthIdentity,
  OAuthState,
  PasswordReset,
  RefreshToken,
  TermsAcceptanceVia,
  User,
} from '../entities';
import { InMemoryTokenGrantService } from '../tokens/token-grant.testing';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';
import { InMemoryTermsService } from './terms.testing';

/**
 * Every path that creates an account checks and records the Terms (plan 0231,
 * section 4.2), through the same calls the gateway makes.
 *
 * What the fakes cannot prove, the unique key under two concurrent accepts and
 * the cascade on delete, is proven against a real Postgres in
 * `terms-acceptance.integration.spec.ts`.
 */

const CURRENT = '2026-10-28+2026-12-15';
const STALE = '2026-10-28';

/** A fixed verifier and its S256 challenge, base64url of its SHA-256. */
const VERIFIER = 'dBjftJeZ4CVP-mJ92K1ifhZ-dDyiYZUiYvyCxt3zbJs';
const CHALLENGE = 'lgghW2CGVJuIAQbifjAcK_8CsFoeysR6G6EYjaO0E8c';

const google = {
  providerUserId: 'g-1',
  email: 'person@example.invalid',
  displayName: 'Jane Example',
};

type Row = Record<string, unknown>;

function makeRepo(store: Row[]) {
  let sequence = 0;
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const findOne = async ({ where }: { where: Row }) => {
    const row = store.find((candidate) => matches(candidate, where));
    return row ? { ...row } : null;
  };
  return {
    create: (row: Row) => ({ ...row }),
    save: async (row: Row) => {
      const existing = row['id']
        ? store.find((candidate) => candidate['id'] === row['id'])
        : undefined;
      if (existing) {
        Object.assign(existing, row);
        return { ...existing };
      }
      const saved = { id: `x${++sequence}`, ...row };
      store.push(saved);
      return { ...saved };
    },
    findOne,
    findOneOrFail: async (options: { where: Row }) => {
      const row = await findOne(options);
      if (!row) {
        throw new Error('not found');
      }
      return row;
    },
    update: async (where: Row, patch: Row) => {
      const rows = store.filter((candidate) => matches(candidate, where));
      rows.forEach((row) => Object.assign(row, patch));
      return { affected: rows.length };
    },
  };
}

function build(options: { acceptanceRequired?: boolean } = {}) {
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
  const tokens = {
    issueTokens: async (user: { id: string; kind: UserKind }) => ({
      userId: user.id,
      kind: user.kind,
      username: 'Quiet Lantern',
      accessToken: 'access',
      refreshToken: 'refresh',
    }),
    revokeAllForUser: async () => undefined,
  };
  const terms = new InMemoryTermsService({
    currentVersion: CURRENT,
    acceptanceRequired: options.acceptanceRequired ?? false,
  });

  const service = new IdentityService(
    dataSource as never,
    tokens as never,
    new InMemoryTokenGrantService(),
    { hash: async () => 'hashed', verify: async () => true } as never,
    { sendVerificationEmail: async () => undefined } as never,
    { userRegistered: () => undefined, userUpgraded: () => undefined } as never,
    new UsernameGenerator(),
    fakeAudit([]).service,
    {
      getOrThrow: () => ({
        smtp: { enabled: true, verifyBaseUrl: 'https://app.example' },
        google: { enabled: true },
      }),
    } as never,
    undefined as never,
    terms,
    { publishSoon: () => undefined } as never,
    undefined as never
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

  /** Mint, consume and stage, as the gateway does up to the exchange. */
  async function throughCallback(
    acceptedTermsVersion: string | undefined,
    linkUserId?: string
  ): Promise<string> {
    const { state } = await service.mintOAuthState({
      ...(linkUserId ? { userId: linkUserId } : {}),
      codeChallenge: CHALLENGE,
      ...(acceptedTermsVersion ? { acceptedTermsVersion } : {}),
    });
    const payload = await service.consumeOAuthState({ state });
    const { code } = await service.stageGoogleSignIn({
      ...google,
      linkUserId: payload.userId,
      codeChallenge: payload.codeChallenge,
      acceptedTermsVersion: payload.acceptedTermsVersion,
    });
    return code;
  }

  return { service, stores, terms, addGuest, throughCallback };
}

const register = (acceptedTermsVersion?: string) => ({
  email: 'person@example.invalid',
  password: 'correct horse',
  ...(acceptedTermsVersion ? { acceptedTermsVersion } : {}),
});

const upgrade = (userId: string, acceptedTermsVersion?: string) => ({
  userId,
  email: 'person@example.invalid',
  password: 'correct horse',
  ...(acceptedTermsVersion ? { acceptedTermsVersion } : {}),
});

describe('register', () => {
  it('records the current version, via REGISTER', async () => {
    const { service, terms } = build();
    const { userId } = await service.register(register(CURRENT));
    expect(terms.rows).toEqual([
      expect.objectContaining({
        userId,
        version: CURRENT,
        via: TermsAcceptanceVia.REGISTER,
      }),
    ]);
  });

  it('refuses a stale version and writes no account', async () => {
    const { service, stores, terms } = build();
    const refusal = service.register(register(STALE));
    await expect(refusal).rejects.toBeInstanceOf(TermsVersionStaleException);
    await expect(refusal).rejects.toMatchObject({
      code: ERROR_CODES.TERMS_VERSION_STALE,
      details: { currentVersion: CURRENT },
      exposesDetails: true,
    });
    expect(stores.users).toEqual([]);
    expect(terms.rows).toEqual([]);
  });

  it('accepts no version while acceptance is not required, and records nothing', async () => {
    const { service, stores, terms } = build();
    await service.register(register());
    expect(stores.users).toHaveLength(1);
    expect(terms.rows).toEqual([]);
  });

  it('refuses no version while acceptance is required', async () => {
    const { service, stores } = build({ acceptanceRequired: true });
    await expect(service.register(register())).rejects.toMatchObject({
      code: ERROR_CODES.TERMS_ACCEPTANCE_MISSING,
      details: { currentVersion: CURRENT },
    });
    expect(stores.users).toEqual([]);
  });
});

describe('upgrade with a typed address', () => {
  it('records the current version, via UPGRADE', async () => {
    const { service, addGuest, terms } = build();
    addGuest('guest');
    await service.upgrade(upgrade('guest', CURRENT));
    expect(terms.rows).toEqual([
      expect.objectContaining({
        userId: 'guest',
        version: CURRENT,
        via: TermsAcceptanceVia.UPGRADE,
      }),
    ]);
  });

  it('refuses a stale version and leaves the guest a guest', async () => {
    const { service, stores, addGuest } = build();
    addGuest('guest');
    await expect(
      service.upgrade(upgrade('guest', STALE))
    ).rejects.toBeInstanceOf(TermsVersionStaleException);
    expect(stores.users[0]['kind']).toBe(UserKind.TEMPORARY);
  });

  it('accepts no version while not required, and refuses it while required', async () => {
    const off = build();
    off.addGuest('guest');
    await off.service.upgrade(upgrade('guest'));
    expect(off.terms.rows).toEqual([]);

    const on = build({ acceptanceRequired: true });
    on.addGuest('guest');
    await expect(on.service.upgrade(upgrade('guest'))).rejects.toBeInstanceOf(
      TermsAcceptanceMissingException
    );
  });
});

describe('guest creation', () => {
  it('records the current version, via GUEST', async () => {
    const { service, terms } = build();
    const { userId } = await service.createTemporaryUser({
      acceptedTermsVersion: CURRENT,
    });
    expect(terms.rows).toEqual([
      expect.objectContaining({
        userId,
        version: CURRENT,
        via: TermsAcceptanceVia.GUEST,
      }),
    ]);
  });

  it('refuses a stale version and mints no guest', async () => {
    const { service, stores } = build();
    await expect(
      service.createTemporaryUser({ acceptedTermsVersion: STALE })
    ).rejects.toBeInstanceOf(TermsVersionStaleException);
    expect(stores.users).toEqual([]);
  });

  it('mints a guest with no version while not required, and refuses one while required', async () => {
    const off = build();
    await off.service.createTemporaryUser({});
    expect(off.stores.users).toHaveLength(1);
    expect(off.terms.rows).toEqual([]);

    const on = build({ acceptanceRequired: true });
    await expect(on.service.createTemporaryUser({})).rejects.toBeInstanceOf(
      TermsAcceptanceMissingException
    );
    expect(on.stores.users).toEqual([]);
  });
});

describe('Google', () => {
  it('checks at the start: a stale version is refused at the mint', async () => {
    const { service, stores } = build();
    await expect(
      service.mintOAuthState({
        codeChallenge: CHALLENGE,
        acceptedTermsVersion: STALE,
      })
    ).rejects.toBeInstanceOf(TermsVersionStaleException);
    expect(stores.states).toEqual([]);
  });

  it('refuses a mint with no version while acceptance is required', async () => {
    const { service } = build({ acceptanceRequired: true });
    await expect(
      service.mintOAuthState({ codeChallenge: CHALLENGE })
    ).rejects.toBeInstanceOf(TermsAcceptanceMissingException);
  });

  it('carries the version from the state to the handoff', async () => {
    const { stores, throughCallback } = build();
    await throughCallback(CURRENT);
    expect(stores.states[0]['termsVersion']).toBe(CURRENT);
    expect(stores.handoffs[0]['termsVersion']).toBe(CURRENT);
  });

  it('records a new account, via GOOGLE', async () => {
    const { service, terms, throughCallback } = build();
    const code = await throughCallback(CURRENT);
    const { userId } = await service.exchangeGoogleSignIn({
      code,
      codeVerifier: VERIFIER,
    });
    expect(terms.rows).toEqual([
      expect.objectContaining({
        userId,
        version: CURRENT,
        via: TermsAcceptanceVia.GOOGLE,
      }),
    ]);
  });

  it('records a guest upgraded in place via GOOGLE rather than UPGRADE', async () => {
    const { service, terms, addGuest, throughCallback } = build();
    addGuest('guest');
    const code = await throughCallback(CURRENT, 'guest');
    await service.exchangeGoogleSignIn({
      code,
      codeVerifier: VERIFIER,
      callerUserId: 'guest',
    });
    expect(terms.rows).toEqual([
      expect.objectContaining({
        userId: 'guest',
        version: CURRENT,
        via: TermsAcceptanceVia.GOOGLE,
      }),
    ]);
  });

  it('records a new version for an existing Google identity', async () => {
    const { service, stores, terms, throughCallback } = build();
    stores.users.push({
      id: 'known',
      kind: UserKind.REGISTERED,
      username: 'Swift Sail',
      email: google.email,
      emailVerifiedAt: new Date(),
      displayName: null,
    });
    stores.identities.push({
      id: 'i1',
      userId: 'known',
      provider: 'GOOGLE',
      providerUserId: google.providerUserId,
    });
    await terms.record(
      null as never,
      'known',
      STALE,
      TermsAcceptanceVia.REGISTER
    );

    const code = await throughCallback(CURRENT);
    const { userId } = await service.exchangeGoogleSignIn({
      code,
      codeVerifier: VERIFIER,
    });

    expect(userId).toBe('known');
    expect(terms.rows.map((row) => [row.version, row.via])).toEqual([
      [STALE, TermsAcceptanceVia.REGISTER],
      [CURRENT, TermsAcceptanceVia.GOOGLE],
    ]);
    await expect(
      service.getProfile({ userId: 'known' })
    ).resolves.toMatchObject({ termsAcceptedVersion: CURRENT });
  });

  it('signs in and records nothing when the version went stale inside the state', async () => {
    const { service, stores, terms, throughCallback } = build();
    const code = await throughCallback(CURRENT);
    // The version the handoff carries is no longer current: the operator
    // moved the revision between the mint and the exchange.
    stores.handoffs[0]['termsVersion'] = STALE;

    const signedIn = await service.exchangeGoogleSignIn({
      code,
      codeVerifier: VERIFIER,
    });

    expect(signedIn.userId).toBeTruthy();
    expect(terms.rows).toEqual([]);
    await expect(
      service.getProfile({ userId: signedIn.userId })
    ).resolves.toMatchObject({
      termsAcceptedVersion: null,
      termsAcceptedAt: null,
    });
  });
});

describe('the accept route', () => {
  it('records PROMPT once, and a repeat answers the same row', async () => {
    const { service, terms, addGuest } = build();
    addGuest('guest');

    const first = await service.acceptTerms({
      userId: 'guest',
      version: CURRENT,
    });
    const second = await service.acceptTerms({
      userId: 'guest',
      version: CURRENT,
    });

    expect(first).toEqual(second);
    expect(first.version).toBe(CURRENT);
    expect(terms.rows).toEqual([
      expect.objectContaining({ via: TermsAcceptanceVia.PROMPT }),
    ]);
  });

  it('refuses a stale version', async () => {
    const { service, addGuest, terms } = build();
    addGuest('guest');
    await expect(
      service.acceptTerms({ userId: 'guest', version: STALE })
    ).rejects.toBeInstanceOf(TermsVersionStaleException);
    expect(terms.rows).toEqual([]);
  });

  it('answers not found for an account that is gone', async () => {
    const { service } = build();
    await expect(
      service.acceptTerms({ userId: 'nobody', version: CURRENT })
    ).rejects.toMatchObject({ code: ERROR_CODES.NOT_FOUND });
  });
});

describe('the accepted version of the profile', () => {
  it('answers the newest row while none is for the current version', async () => {
    const { service, terms, addGuest } = build();
    addGuest('guest');
    await terms.record(null as never, 'guest', STALE, TermsAcceptanceVia.GUEST);

    await expect(
      service.getProfile({ userId: 'guest' })
    ).resolves.toMatchObject({ termsAcceptedVersion: STALE });
  });

  it('answers the current version again when the version moves back to one the account accepted', async () => {
    const { service, terms, addGuest } = build({ acceptanceRequired: true });
    addGuest('guest');
    terms.moveCurrentVersion(STALE);
    const first = await service.acceptTerms({
      userId: 'guest',
      version: STALE,
    });
    terms.moveCurrentVersion(CURRENT);
    await service.acceptTerms({ userId: 'guest', version: CURRENT });

    // A rollback past a template bump, or the operator clearing the revision.
    terms.moveCurrentVersion(STALE);

    // The gateway asks again only when this differs from the current version,
    // so answering the newest row here would ask forever: accepting STALE again
    // keeps its first row and CURRENT stays the newest.
    await expect(
      service.getProfile({ userId: 'guest' })
    ).resolves.toMatchObject({
      termsAcceptedVersion: STALE,
      termsAcceptedAt: first.acceptedAt,
    });
    await expect(
      service.acceptTerms({ userId: 'guest', version: STALE })
    ).resolves.toEqual(first);
    expect(terms.rows.map((row) => row.version)).toEqual([STALE, CURRENT]);
  });
});
