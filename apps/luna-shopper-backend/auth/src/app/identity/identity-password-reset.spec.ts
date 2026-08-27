import { UserKind } from '@portfolio/luna-shopper/contracts';
import {
  THROTTLE_LIMITS,
  ValidationException,
  throttleWaitSeconds,
} from '@portfolio/luna-shopper/platform';
import {
  Credential,
  EmailVerification,
  OAuthIdentity,
  PasswordReset,
  RefreshToken,
  User,
} from '../entities';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';

/**
 * Password reset (plan 0022): asking for a link without telling the asker
 * anything, and spending one.
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

/**
 * The real {@link TokenService.revokeAllForUser} matches live rows with
 * `IsNull()`, which the repository double cannot evaluate, so the double stands
 * in for it here. Its ordering against issuing the new pair is the thing under
 * test, and that lives in {@link IdentityService}, not in the operator.
 */
function makeTokens(refreshTokens: Row[]) {
  return {
    issueTokens: jest.fn(async (user: Row) => {
      const issued = {
        id: `rt${refreshTokens.length + 1}`,
        userId: user['id'],
        revokedAt: null,
      };
      refreshTokens.push(issued);
      return {
        userId: user['id'],
        kind: user['kind'],
        username: user['username'],
        accessToken: 'a',
        refreshToken: issued.id,
      };
    }),
    revokeAllForUser: jest.fn(async (userId: string) => {
      refreshTokens
        .filter((row) => row['userId'] === userId && row['revokedAt'] === null)
        .forEach((row) => (row['revokedAt'] = new Date()));
    }),
  };
}

function build(users: Row[] = [], credentials: Row[] = []) {
  const stores = {
    users: [...users],
    credentials: [...credentials],
    verifications: [] as Row[],
    resets: [] as Row[],
    identities: [] as Row[],
    refreshTokens: [] as Row[],
  };
  const repos = new Map<unknown, ReturnType<typeof makeRepo>>([
    [User, makeRepo(stores.users)],
    [Credential, makeRepo(stores.credentials)],
    [EmailVerification, makeRepo(stores.verifications)],
    [PasswordReset, makeRepo(stores.resets)],
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
  const tokens = makeTokens(stores.refreshTokens);
  const events = {
    userRegistered: jest.fn(),
    userUpgraded: jest.fn(),
    userDeleted: jest.fn(),
    userEmailVerified: jest.fn(),
    userUsernameChanged: jest.fn(),
  };
  const mail = {
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    sendGoogleAccountEmail: jest.fn(),
  };
  const passwords = {
    hash: jest.fn(async (raw: string) => `hashed:${raw}`),
    verify: jest.fn(
      async (hash: string, raw: string) => hash === `hashed:${raw}`
    ),
  };
  const service = new IdentityService(
    dataSource as never,
    tokens as never,
    new TokenGrantService(),
    passwords,
    mail as never,
    events as never,
    new UsernameGenerator(),
    {
      getOrThrow: () => ({
        smtp: {
          verifyBaseUrl: 'https://x/verify',
          resetBaseUrl: 'https://x/reset',
        },
      }),
    } as never
  );
  return { service, stores, events, mail, tokens, passwords };
}

/** The raw token the reset mail was handed. Only issue ever reveals it. */
const resetToken = (mail: { sendPasswordResetEmail: jest.Mock }): string =>
  mail.sendPasswordResetEmail.mock.calls[0][1] as string;

const password = {
  id: 'u1',
  kind: UserKind.REGISTERED,
  username: 'Swift Sail',
  email: 'a@b.com',
  emailVerifiedAt: new Date(),
  displayName: null,
};

const credentialFor = (userId: string, raw = 'old-password') => ({
  id: `c-${userId}`,
  userId,
  passwordHash: `hashed:${raw}`,
});

/** The same account without a credential row: it signs in with Google. */
const google = { ...password, id: 'u2', email: 'g@b.com' };

describe('IdentityService.forgotPassword (section 2)', () => {
  it('answers identically for an unknown, a password and a Google address', async () => {
    const unknown = build();
    const withPassword = build([{ ...password }], [credentialFor('u1')]);
    const withGoogle = build([{ ...google }]);

    // The property is the equality itself, so the three are asserted together:
    // a difference in any of status, body or shape is the enumeration oracle
    // `login()` already refuses to hand out.
    const answers = await Promise.all([
      unknown.service.forgotPassword({ email: 'nobody@b.com' }),
      withPassword.service.forgotPassword({ email: 'a@b.com' }),
      withGoogle.service.forgotPassword({ email: 'g@b.com' }),
    ]);

    expect(answers[0]).toEqual(answers[1]);
    expect(answers[1]).toEqual(answers[2]);
    expect(answers[0].retryAfterSeconds).toBe(
      throttleWaitSeconds(THROTTLE_LIMITS.passwordReset)
    );
    expect(answers[0].retryAfterSeconds).toBe(60);
  });

  it('sends the reset link to an account that has a password', async () => {
    const { service, stores, mail } = build(
      [{ ...password }],
      [credentialFor('u1')]
    );

    await service.forgotPassword({ email: 'a@b.com', locale: 'es' });

    expect(stores.resets).toHaveLength(1);
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledWith(
      'a@b.com',
      expect.any(String),
      'https://x/reset',
      'es'
    );
    expect(mail.sendGoogleAccountEmail).not.toHaveBeenCalled();
  });

  it('sends the Google mail, and never a token, to an account with no password', async () => {
    const { service, stores, mail } = build([{ ...google }]);

    await service.forgotPassword({ email: 'g@b.com' });

    // Section 2.3: silence would be correct and useless, because it is
    // indistinguishable from a lost mail and they would only ask again.
    expect(mail.sendGoogleAccountEmail).toHaveBeenCalledWith(
      'g@b.com',
      undefined
    );
    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(stores.resets).toHaveLength(0);
  });

  it('sends nothing at all for an address with no account', async () => {
    const { service, stores, mail } = build();

    await service.forgotPassword({ email: 'nobody@b.com' });

    expect(mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(mail.sendGoogleAccountEmail).not.toHaveBeenCalled();
    expect(stores.resets).toHaveLength(0);
  });

  it('still answers the same when the send itself fails', async () => {
    const { service, mail } = build([{ ...password }], [credentialFor('u1')]);
    mail.sendPasswordResetEmail.mockRejectedValueOnce(new Error('smtp down'));

    await expect(service.forgotPassword({ email: 'a@b.com' })).resolves.toEqual(
      { retryAfterSeconds: 60 }
    );
  });

  it('matches the address the way login does, ignoring case and padding', async () => {
    const { service, mail } = build([{ ...password }], [credentialFor('u1')]);

    await service.forgotPassword({ email: '  A@B.com ' });

    expect(mail.sendPasswordResetEmail).toHaveBeenCalled();
  });
});

describe('IdentityService.resetPassword (section 3)', () => {
  async function grantFor(
    account: Row = { ...password },
    credentials: Row[] = [credentialFor('u1')]
  ) {
    const context = build([account], credentials);
    await context.service.forgotPassword({ email: account['email'] as string });
    return { ...context, token: resetToken(context.mail) };
  }

  it('sets the new password, retires the old one and signs the caller in', async () => {
    const { service, stores, token } = await grantFor();

    const issued = await service.resetPassword({ token, password: 'new-one' });

    expect(issued.userId).toBe('u1');
    expect(issued.accessToken).toBeTruthy();
    expect(stores.credentials[0]['passwordHash']).toBe('hashed:new-one');
    await expect(
      service.login({ email: 'a@b.com', password: 'old-password' })
    ).rejects.toBeTruthy();
    await expect(
      service.login({ email: 'a@b.com', password: 'new-one' })
    ).resolves.toMatchObject({ userId: 'u1' });
  });

  it('refuses a token that has already been spent', async () => {
    const { service, token } = await grantFor();

    await service.resetPassword({ token, password: 'new-one' });

    await expect(
      service.resetPassword({ token, password: 'newer-one' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('refuses an expired token', async () => {
    const { service, stores, token } = await grantFor();
    stores.resets[0]['expiresAt'] = new Date(Date.now() - 1000);

    await expect(
      service.resetPassword({ token, password: 'new-one' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('refuses a token nobody ever issued, with the same error', async () => {
    const { service } = await grantFor();

    await expect(
      service.resetPassword({ token: 'invented', password: 'new-one' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('marks the address verified when it was not, and says so once', async () => {
    const { service, stores, events, token } = await grantFor({
      ...password,
      emailVerifiedAt: null,
    });

    await service.resetPassword({ token, password: 'new-one' });

    // Following a mailed link is the evidence the confirmation flow accepts, and
    // a stronger action than clicking a confirmation link.
    expect(stores.users[0]['emailVerifiedAt']).toBeInstanceOf(Date);
    expect(events.userEmailVerified).toHaveBeenCalledTimes(1);
  });

  it('leaves an already verified address alone and announces nothing', async () => {
    const { service, events, token } = await grantFor();

    await service.resetPassword({ token, password: 'new-one' });

    expect(events.userEmailVerified).not.toHaveBeenCalled();
  });

  it('revokes every session that existed before it, and not the one it issues', async () => {
    const { service, stores, tokens, token } = await grantFor();
    stores.refreshTokens.push(
      { id: 'rt-a', userId: 'u1', revokedAt: null },
      { id: 'rt-b', userId: 'u1', revokedAt: null }
    );

    const issued = await service.resetPassword({ token, password: 'new-one' });

    // The ordering is the point: revoke, then issue. Doing it the other way
    // round is the mistake, and it signs the person resetting straight back out.
    const live = stores.refreshTokens.filter(
      (row) => row['revokedAt'] === null
    );
    expect(live).toHaveLength(1);
    expect(live[0]['id']).toBe(issued.refreshToken);
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      expect.anything()
    );
    expect(tokens.revokeAllForUser.mock.invocationCallOrder[0]).toBeLessThan(
      tokens.issueTokens.mock.invocationCallOrder[0]
    );
  });

  it('leaves the sessions of other users untouched', async () => {
    const { service, stores, token } = await grantFor();
    stores.refreshTokens.push({ id: 'rt-x', userId: 'u9', revokedAt: null });

    await service.resetPassword({ token, password: 'new-one' });

    expect(
      stores.refreshTokens.find((row) => row['id'] === 'rt-x')?.['revokedAt']
    ).toBeNull();
  });
});
