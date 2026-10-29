import {
  RecoverySignInOutcome,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import {
  ImpersonationNotAllowedException,
  RecoveryNeedsEmailException,
  RecoveryNeedsPasswordException,
  RecoveryOtherAccountException,
  THROTTLE_LIMITS,
  ValidationException,
  throttleWaitSeconds,
} from '@portfolio/luna-shopper/platform';
import { fakeAudit } from '../audit/auth-audit.testing';
import {
  Credential,
  EmailVerification,
  OAuthIdentity,
  PasswordReset,
  PasswordResetChannel,
  PasswordResetSpentAs,
  RefreshToken,
  User,
} from '../entities';
import { InMemoryTokenGrantService } from '../tokens/token-grant.testing';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';
import { InMemoryTermsService } from './terms.testing';

/**
 * Password reset (plan 0022): asking for a link without telling the asker
 * anything, and spending one. And the same grant spent as a sign in, mailed or
 * handed to an operator (plan 0210).
 *
 * The spend here is the in memory one of `token-grant.testing.ts`. What makes
 * a grant end at most one time under two requests at the same instant is the
 * statement of the real service, proven in `token-grant.integration.spec.ts`.
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
    find: async ({ where }: { where: Row }) =>
      store.filter((row) => matches(row, where)),
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
    sendRecoveryLinksNotice: jest.fn(),
  };
  const passwords = {
    hash: jest.fn(async (raw: string) => `hashed:${raw}`),
    verify: jest.fn(
      async (hash: string, raw: string) => hash === `hashed:${raw}`
    ),
  };
  // The operator routes of plan 0210 write through the trail. Bound to the
  // same doubles the rest of the spec reads, so a grant an operator made is
  // in `stores.resets` like any other.
  const audit = fakeAudit([
    [User, { name: 'users', repository: repos.get(User) as never }],
    [
      Credential,
      { name: 'credentials', repository: repos.get(Credential) as never },
    ],
    [
      PasswordReset,
      {
        name: 'password_resets',
        repository: repos.get(PasswordReset) as never,
      },
    ],
  ]);
  const service = new IdentityService(
    dataSource as never,
    tokens as never,
    new InMemoryTokenGrantService(),
    passwords,
    mail as never,
    events as never,
    new UsernameGenerator(),
    audit.service,
    {
      getOrThrow: () => ({
        smtp: {
          verifyBaseUrl: 'https://x/verify',
          resetBaseUrl: 'https://x/reset',
          enabled: true,
        },
        google: { enabled: true },
      }),
    } as never,
    undefined as never,
    new InMemoryTermsService()
  );
  return {
    service,
    stores,
    events,
    mail,
    tokens,
    passwords,
    recorded: audit.recorded,
  };
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

/** A grant for `password`, through the page anybody can use. */
async function selfServiceGrant(context: ReturnType<typeof build>) {
  context.mail.sendPasswordResetEmail.mockClear();
  await context.service.forgotPassword({ email: 'a@b.com' });
  return resetToken(context.mail);
}

/** The stored row of a raw token, read back by its hash. */
function rowOf(context: ReturnType<typeof build>, raw: string): Row {
  const hash = new InMemoryTokenGrantService().hash(raw);
  const row = context.stores.resets.find((r) => r['tokenHash'] === hash);
  if (!row) {
    throw new Error('no grant for that token');
  }
  return row;
}

describe('ending the other grants of the account (plan 0210, target state 3)', () => {
  it('ends every other live grant when one is spent, as SUPERSEDED', async () => {
    const context = build([{ ...password }], [credentialFor('u1')]);
    const first = await selfServiceGrant(context);
    const second = await selfServiceGrant(context);

    await context.service.resetPassword({ token: second, password: 'new-one' });

    expect(rowOf(context, second)['spentAs']).toBe(PasswordResetSpentAs.RESET);
    expect(rowOf(context, first)['spentAs']).toBe(
      PasswordResetSpentAs.SUPERSEDED
    );
    expect(rowOf(context, first)['consumedAt']).toBeInstanceOf(Date);
    // The first mail, read late, is no longer a key.
    await expect(
      context.service.recoverySignIn({ token: first })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('leaves the older grants alone when another is issued (decision D5)', async () => {
    const context = build([{ ...password }], [credentialFor('u1')]);
    const first = await selfServiceGrant(context);
    await selfServiceGrant(context);

    expect(rowOf(context, first)['consumedAt'] ?? null).toBeNull();
    await expect(
      context.service.recoverySignIn({ token: first })
    ).resolves.toMatchObject({ outcome: RecoverySignInOutcome.SIGNED_IN });
  });

  it('leaves the grants of other accounts alone', async () => {
    const other = { ...password, id: 'u3', email: 'c@b.com' };
    const context = build(
      [{ ...password }, other],
      [credentialFor('u1'), credentialFor('u3')]
    );
    const mine = await selfServiceGrant(context);
    context.mail.sendPasswordResetEmail.mockClear();
    await context.service.forgotPassword({ email: 'c@b.com' });
    const theirs = resetToken(context.mail);

    await context.service.recoverySignIn({ token: mine });

    expect(rowOf(context, theirs)['consumedAt'] ?? null).toBeNull();
  });
});

describe('IdentityService.recoverySignIn (plan 0210, target state 5)', () => {
  async function granted(account: Row = { ...password }) {
    const context = build([account], [credentialFor('u1')]);
    const token = await selfServiceGrant(context);
    return { ...context, token };
  }

  it('refuses a support session, whatever the grant, and writes nothing', async () => {
    const { service, stores, token, tokens } = await granted();

    await expect(
      service.recoverySignIn({
        token,
        callerUserId: 'u1',
        supportSession: true,
      })
    ).rejects.toBeInstanceOf(ImpersonationNotAllowedException);
    expect(stores.resets[0]['consumedAt'] ?? null).toBeNull();
    expect(tokens.issueTokens).not.toHaveBeenCalled();
  });

  it('tells the owner of a live grant they are signed in, and spends it', async () => {
    const context = await granted();
    const older = context.token;
    const token = await selfServiceGrant(context);

    const answer = await context.service.recoverySignIn({
      token,
      callerUserId: 'u1',
    });

    expect(answer).toEqual({
      outcome: RecoverySignInOutcome.ALREADY_SIGNED_IN,
    });
    expect(context.tokens.issueTokens).not.toHaveBeenCalled();
    expect(rowOf(context, token)['spentAs']).toBe(
      PasswordResetSpentAs.ALREADY_SIGNED_IN
    );
    // The visit ends the other grants too, as any spend does.
    expect(rowOf(context, older)['spentAs']).toBe(
      PasswordResetSpentAs.SUPERSEDED
    );
    // And the reset link of the same mail is refused afterwards.
    await expect(
      context.service.resetPassword({ token, password: 'new-one' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('tells the owner of a spent grant they are signed in, and writes nothing', async () => {
    const context = await granted();
    await context.service.resetPassword({
      token: context.token,
      password: 'new-one',
    });
    const before = { ...rowOf(context, context.token) };

    const answer = await context.service.recoverySignIn({
      token: context.token,
      callerUserId: 'u1',
    });

    expect(answer).toEqual({
      outcome: RecoverySignInOutcome.ALREADY_SIGNED_IN,
    });
    expect(rowOf(context, context.token)).toEqual(before);
  });

  it('tells the owner of an expired grant they are signed in, and writes nothing', async () => {
    const context = await granted();
    rowOf(context, context.token)['expiresAt'] = new Date(Date.now() - 1000);

    await expect(
      context.service.recoverySignIn({
        token: context.token,
        callerUserId: 'u1',
      })
    ).resolves.toEqual({ outcome: RecoverySignInOutcome.ALREADY_SIGNED_IN });
    expect(rowOf(context, context.token)['consumedAt'] ?? null).toBeNull();
  });

  it('refuses another signed in account with 409 and spends nothing', async () => {
    const context = await granted();

    await expect(
      context.service.recoverySignIn({
        token: context.token,
        callerUserId: 'u9',
      })
    ).rejects.toBeInstanceOf(RecoveryOtherAccountException);
    // `false` is no agreement either.
    await expect(
      context.service.recoverySignIn({
        token: context.token,
        callerUserId: 'u9',
        switchAccount: false,
      })
    ).rejects.toBeInstanceOf(RecoveryOtherAccountException);
    expect(rowOf(context, context.token)['consumedAt'] ?? null).toBeNull();
    expect(context.tokens.issueTokens).not.toHaveBeenCalled();
  });

  it('refuses a token nobody issued, with the one refusal', async () => {
    const context = await granted();

    await expect(
      context.service.recoverySignIn({ token: 'invented' })
    ).rejects.toBeInstanceOf(ValidationException);
    await expect(
      context.service.recoverySignIn({ token: 'invented', callerUserId: 'u1' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('refuses a spent or expired grant to anybody but its owner', async () => {
    const context = await granted();
    const expired = await selfServiceGrant(context);
    rowOf(context, expired)['expiresAt'] = new Date(Date.now() - 1000);
    await context.service.recoverySignIn({ token: context.token });

    for (const token of [context.token, expired]) {
      await expect(
        context.service.recoverySignIn({ token })
      ).rejects.toBeInstanceOf(ValidationException);
      await expect(
        context.service.recoverySignIn({
          token,
          callerUserId: 'u9',
          switchAccount: true,
        })
      ).rejects.toBeInstanceOf(ValidationException);
    }
  });

  it('signs in a caller with no session, and spends the grant as SIGN_IN', async () => {
    const context = await granted({ ...password, emailVerifiedAt: null });

    const answer = await context.service.recoverySignIn({
      token: context.token,
    });

    expect(answer).toMatchObject({
      outcome: RecoverySignInOutcome.SIGNED_IN,
      tokens: { userId: 'u1' },
    });
    expect(rowOf(context, context.token)['spentAs']).toBe(
      PasswordResetSpentAs.SIGN_IN
    );
    // The same proof a reset accepts (decision D4), announced once.
    expect(context.stores.users[0]['emailVerifiedAt']).toBeInstanceOf(Date);
    expect(context.events.userEmailVerified).toHaveBeenCalledTimes(1);
    // The password stays as it was.
    expect(context.stores.credentials[0]['passwordHash']).toBe(
      'hashed:old-password'
    );
    // And the reset link of the same mail is refused afterwards.
    await expect(
      context.service.resetPassword({
        token: context.token,
        password: 'new-one',
      })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('signs in another account that agreed to switch', async () => {
    const context = await granted();

    await expect(
      context.service.recoverySignIn({
        token: context.token,
        callerUserId: 'u9',
        switchAccount: true,
      })
    ).resolves.toMatchObject({
      outcome: RecoverySignInOutcome.SIGNED_IN,
      tokens: { userId: 'u1' },
    });
  });

  it('revokes no session (decision D4)', async () => {
    const context = await granted();
    context.stores.refreshTokens.push({
      id: 'rt-a',
      userId: 'u1',
      revokedAt: null,
    });

    await context.service.recoverySignIn({ token: context.token });

    expect(context.tokens.revokeAllForUser).not.toHaveBeenCalled();
    expect(
      context.stores.refreshTokens.find((row) => row['id'] === 'rt-a')?.[
        'revokedAt'
      ]
    ).toBeNull();
  });
});

describe('the operator routes (plan 0210, target states 7 and 8)', () => {
  const HOUR = 60 * 60 * 1000;
  const ACTOR = '44444444-4444-4444-8444-444444444444';
  const guest = {
    id: 'u4',
    kind: UserKind.TEMPORARY,
    username: 'Quiet Lantern',
    email: null,
    emailVerifiedAt: null,
    displayName: null,
  };

  it('mails the grant as OPERATOR_EMAIL, for an hour, and records it without its hash', async () => {
    const context = build([{ ...password }], [credentialFor('u1')]);
    const before = Date.now();

    const answer = await context.service.sendPasswordResetAsOperator(
      'u1',
      ACTOR,
      'es'
    );

    expect(context.stores.resets).toHaveLength(1);
    const grant = context.stores.resets[0];
    expect(grant['channel']).toBe(PasswordResetChannel.OPERATOR_EMAIL);
    expect(grant['issuedByAdminId']).toBe(ACTOR);
    const expiresAt = Date.parse(answer.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + HOUR);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + HOUR);
    expect(context.mail.sendPasswordResetEmail).toHaveBeenCalledWith(
      'a@b.com',
      expect.any(String),
      'https://x/reset',
      'es'
    );

    expect(context.recorded).toEqual([
      expect.objectContaining({
        actorId: ACTOR,
        action: 'CREATE',
        entity: 'password_resets',
      }),
    ]);
    expect(context.recorded[0].after).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(context.recorded)).not.toContain(
      resetToken(context.mail)
    );
  });

  it('creates the two links of one grant, for a day, and mails only a notice', async () => {
    const context = build([{ ...password }], [credentialFor('u1')]);
    const before = Date.now();

    const answer = await context.service.createRecoveryLinksAsOperator(
      'u1',
      ACTOR
    );

    const token = new URL(answer.resetUrl).searchParams.get('token') ?? '';
    expect(answer.resetUrl).toBe(
      `https://x/reset?token=${encodeURIComponent(token)}`
    );
    expect(answer.signInUrl).toBe(`${answer.resetUrl}&mode=sign-in`);
    const expiresAt = Date.parse(answer.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 24 * HOUR);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 24 * HOUR);

    const grant = rowOf(context, token);
    expect(grant['channel']).toBe(PasswordResetChannel.OPERATOR_LINK);
    expect(grant['issuedByAdminId']).toBe(ACTOR);

    // Decision D2: the person hears of it, and the mail holds no link.
    expect(context.mail.sendRecoveryLinksNotice).toHaveBeenCalledWith(
      'a@b.com',
      grant['createdAt'],
      undefined
    );
    expect(context.mail.sendPasswordResetEmail).not.toHaveBeenCalled();

    expect(context.recorded).toHaveLength(1);
    expect(context.recorded[0]).toMatchObject({
      actorId: ACTOR,
      action: 'CREATE',
      entity: 'password_resets',
    });
    expect(JSON.stringify(context.recorded)).not.toContain(token);
  });

  it('hands out a sign in link that works one time', async () => {
    const context = build([{ ...password }], [credentialFor('u1')]);
    const { signInUrl } = await context.service.createRecoveryLinksAsOperator(
      'u1',
      ACTOR
    );
    const token = new URL(signInUrl).searchParams.get('token') ?? '';

    await expect(
      context.service.recoverySignIn({ token })
    ).resolves.toMatchObject({ outcome: RecoverySignInOutcome.SIGNED_IN });
    await expect(
      context.service.recoverySignIn({ token })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it.each([
    ['sendPasswordResetAsOperator' as const],
    ['createRecoveryLinksAsOperator' as const],
  ])(
    '%s refuses a guest and a Google only account, and writes nothing',
    async (method) => {
      const context = build([{ ...guest }, { ...google }], []);

      await expect(context.service[method]('u4', ACTOR)).rejects.toBeInstanceOf(
        RecoveryNeedsEmailException
      );
      await expect(context.service[method]('u2', ACTOR)).rejects.toBeInstanceOf(
        RecoveryNeedsPasswordException
      );

      expect(context.stores.resets).toHaveLength(0);
      expect(context.recorded).toHaveLength(0);
      expect(context.mail.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(context.mail.sendRecoveryLinksNotice).not.toHaveBeenCalled();
    }
  );
});
