import { UserKind } from '@portfolio/luna-shopper/contracts';
import {
  ConflictException,
  NotFoundException,
  THROTTLE_LIMITS,
  throttleWaitSeconds,
} from '@portfolio/luna-shopper/platform';
import {
  Credential,
  EmailVerification,
  OAuthIdentity,
  User,
} from '../entities';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';

/**
 * Confirming an email (plan 0021): resending one, consuming a link that a resend
 * superseded, and the three things `upgrade()` used to get wrong.
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
    findOneOrFail: async ({ where }: { where: Row }) => {
      const found = store.find((row) => matches(row, where));
      if (!found) {
        throw new Error('not found');
      }
      return found;
    },
    update: async (where: Row, patch: Row) => {
      const row = store.find((candidate) => matches(candidate, where));
      if (row) {
        Object.assign(row, patch);
      }
      return { affected: row ? 1 : 0 };
    },
    delete: async () => ({ affected: 1 }),
  };
}

function build(users: Row[] = []) {
  const stores = {
    users: [...users],
    credentials: [] as Row[],
    verifications: [] as Row[],
    identities: [] as Row[],
  };
  const repos = new Map<unknown, ReturnType<typeof makeRepo>>([
    [User, makeRepo(stores.users)],
    [Credential, makeRepo(stores.credentials)],
    [EmailVerification, makeRepo(stores.verifications)],
    [OAuthIdentity, makeRepo(stores.identities)],
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
    issueTokens: jest.fn(async (user: Row) => ({
      userId: user['id'],
      kind: user['kind'],
      username: user['username'],
      accessToken: 'a',
      refreshToken: 'r',
    })),
  };
  const events = {
    userRegistered: jest.fn(),
    userUpgraded: jest.fn(),
    userDeleted: jest.fn(),
    userEmailVerified: jest.fn(),
    userUsernameChanged: jest.fn(),
  };
  const mail = { sendVerificationEmail: jest.fn() };
  const service = new IdentityService(
    dataSource as never,
    tokens as never,
    new TokenGrantService(),
    { hash: jest.fn(async () => 'hash'), verify: jest.fn(async () => true) },
    mail as never,
    events as never,
    new UsernameGenerator(),
    {
      getOrThrow: () => ({
        smtp: { verifyBaseUrl: 'https://x', enabled: true },
        google: { enabled: true },
      }),
    } as never
  );
  return { service, stores, events, mail };
}

/** The raw tokens the mailer was handed, in order. Only issue ever reveals them. */
const sentTokens = (mail: { sendVerificationEmail: jest.Mock }): string[] =>
  mail.sendVerificationEmail.mock.calls.map((call) => call[1] as string);

const unconfirmed = {
  id: 'u1',
  kind: UserKind.REGISTERED,
  username: 'Swift Sail',
  email: 'a@b.com',
  emailVerifiedAt: null,
  displayName: null,
};

describe('IdentityService.resendVerification (section 4)', () => {
  it('sends a fresh link and returns the wait the gateway bucket enforces', async () => {
    const { service, stores, mail } = build([{ ...unconfirmed }]);

    const result = await service.resendVerification({
      userId: 'u1',
      locale: 'es',
    });

    // Read from the bucket, never restated, so retuning the limit cannot leave
    // the response advertising a wait nothing enforces.
    expect(result.retryAfterSeconds).toBe(
      throttleWaitSeconds(THROTTLE_LIMITS.verifyResend)
    );
    expect(result.retryAfterSeconds).toBe(60);
    expect(stores.verifications).toHaveLength(1);
    expect(mail.sendVerificationEmail).toHaveBeenCalledWith(
      'a@b.com',
      expect.any(String),
      'https://x',
      'es'
    );
  });

  it('refuses an account with no email, because no mail is coming', async () => {
    const { service, mail } = build([
      { ...unconfirmed, email: null, kind: UserKind.TEMPORARY },
    ]);

    await expect(
      service.resendVerification({ userId: 'u1' })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('refuses an address that is already confirmed', async () => {
    const { service, mail } = build([
      { ...unconfirmed, emailVerifiedAt: new Date() },
    ]);

    await expect(
      service.resendVerification({ userId: 'u1' })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('refuses a token whose user is gone', async () => {
    const { service } = build();

    await expect(
      service.resendVerification({ userId: 'ghost' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('leaves the link it superseded working', async () => {
    const { service, stores } = build([{ ...unconfirmed }]);

    await service.resendVerification({ userId: 'u1' });
    await service.resendVerification({ userId: 'u1' });

    // Two live grants: a resend does not invalidate the mail that is still in
    // flight, which is the one the user is most likely to receive first.
    expect(stores.verifications).toHaveLength(2);
    expect(
      stores.verifications.every((row) => row['consumedAt'] === undefined)
    ).toBe(true);
  });
});

describe('IdentityService.verifyEmail with more than one live link (section 4.5)', () => {
  it('confirms once and emits once, whichever link arrives second', async () => {
    const { service, events, mail } = build();
    const registered = await service.register({
      email: 'a@b.com',
      password: 'pw',
    });
    await service.resendVerification({ userId: registered.userId });
    const [first, second] = sentTokens(mail);

    await expect(service.verifyEmail(first)).resolves.toEqual({
      userId: registered.userId,
    });
    // Succeeds rather than erroring: the user did nothing wrong by opening the
    // other mail. It just has nothing left to announce.
    await expect(service.verifyEmail(second)).resolves.toEqual({
      userId: registered.userId,
    });

    expect(events.userEmailVerified).toHaveBeenCalledTimes(1);
  });

  it('still marks the second link spent, so it cannot be replayed', async () => {
    const { service, stores, mail } = build();
    const registered = await service.register({
      email: 'a@b.com',
      password: 'pw',
    });
    await service.resendVerification({ userId: registered.userId });
    const [first, second] = sentTokens(mail);

    await service.verifyEmail(first);
    await service.verifyEmail(second);

    expect(
      stores.verifications.every((row) => row['consumedAt'] instanceof Date)
    ).toBe(true);
  });
});

describe('IdentityService.upgrade (section 5)', () => {
  const guest = {
    id: 'u1',
    kind: UserKind.TEMPORARY,
    username: 'Quiet Lantern',
    email: null,
    emailVerifiedAt: null,
    displayName: null,
  };

  it('sends a confirmation for an address the user typed', async () => {
    const { service, stores, mail } = build([{ ...guest }]);

    const tokens = await service.upgrade({
      userId: 'u1',
      email: 'a@b.com',
      password: 'pw',
      locale: 'en',
    });

    // Before this plan an upgraded guest held an unconfirmed address with no way
    // to ever confirm it: the only grant the system could make came from register.
    expect(stores.verifications).toHaveLength(1);
    expect(mail.sendVerificationEmail).toHaveBeenCalledWith(
      'a@b.com',
      expect.any(String),
      'https://x',
      'en'
    );
    expect(stores.users[0]['emailVerifiedAt']).toBeNull();
    expect(tokens.userId).toBe('u1');
  });

  it('trusts an address Google already verified, and sends nothing', async () => {
    const { service, stores, mail } = build([{ ...guest }]);

    const tokens = await service.upgrade({
      userId: 'u1',
      google: { providerUserId: 'g1', email: 'g@b.com' },
    });

    expect(stores.users[0]['emailVerifiedAt']).toBeInstanceOf(Date);
    expect(mail.sendVerificationEmail).not.toHaveBeenCalled();
    expect(stores.verifications).toHaveLength(0);
    expect(tokens.userId).toBe('u1');
  });

  it('answers a taken Google address with a conflict, not a 500', async () => {
    const { service } = build([
      { ...guest },
      { ...unconfirmed, id: 'u2', email: 'taken@b.com' },
    ]);

    // The email branch has always checked this. The Google branch assigned the
    // address straight onto the row, so the partial unique index surfaced raw.
    await expect(
      service.upgrade({
        userId: 'u1',
        google: { providerUserId: 'g1', email: 'taken@b.com' },
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps the userId across every branch, so the guest keeps their zones', async () => {
    const typed = build([{ ...guest }]);
    const google = build([{ ...guest }]);

    await expect(
      typed.service.upgrade({ userId: 'u1', email: 'a@b.com', password: 'pw' })
    ).resolves.toMatchObject({ userId: 'u1' });
    await expect(
      google.service.upgrade({
        userId: 'u1',
        google: { providerUserId: 'g1', email: 'g@b.com' },
      })
    ).resolves.toMatchObject({ userId: 'u1' });
  });
});
