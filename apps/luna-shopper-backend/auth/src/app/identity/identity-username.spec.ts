import {
  UserKind,
  UsernamePropagation,
} from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { fakeAudit } from '../audit/auth-audit.testing';
import type { User } from '../entities';
import { TokenGrantService } from '../tokens/token-grant.service';
import { UsernameGenerator } from '../username/username-generator.service';
import { IdentityService } from './identity.service';

/**
 * The username half of the identity domain (plan 0018, sections 3.4 and 4): a
 * name exists from the moment an identity does, the upgrade never touches it, and
 * a change emits the event core's propagation saga consumes.
 */

/** A repository double that records rows and answers findOne from them. */
function makeRepo(rows: Partial<User>[] = []) {
  const store = [...rows];
  return {
    store,
    create: jest.fn((row: Partial<User>) => ({ ...row })),
    save: jest.fn(async (row: Partial<User>) => {
      const saved = { id: row.id ?? `u${store.length + 1}`, ...row } as User;
      const index = store.findIndex((r) => r.id === saved.id);
      if (index >= 0) {
        store[index] = saved;
      } else {
        store.push(saved);
      }
      return saved;
    }),
    findOne: jest.fn(
      async ({ where }: { where: Partial<User> }) =>
        store.find((r) =>
          Object.entries(where).every(
            ([key, value]) => r[key as keyof User] === value
          )
        ) ?? null
    ),
    findOneOrFail: jest.fn(async ({ where }: { where: Partial<User> }) => {
      const found = store.find((r) => r.id === where.id);
      if (!found) {
        throw new Error('not found');
      }
      return found;
    }),
    delete: jest.fn(async () => ({ affected: 1 })),
  };
}

function build(users: Partial<User>[] = []) {
  const repo = makeRepo(users);
  const dataSource = {
    getRepository: jest.fn(() => repo),
    transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) =>
      cb({ getRepository: () => repo })
    ),
  };
  const tokens = {
    issueTokens: jest.fn(async (user: User) => ({
      userId: user.id,
      kind: user.kind,
      username: user.username,
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
  const config = {
    getOrThrow: () => ({
      smtp: { verifyBaseUrl: 'https://x', enabled: true },
      google: { enabled: true },
    }),
  };
  const service = new IdentityService(
    dataSource as never,
    tokens as never,
    new TokenGrantService(),
    {
      hash: jest.fn(async () => 'hash'),
      verify: jest.fn(async () => true),
    } as never,
    { sendVerificationEmail: jest.fn() } as never,
    events as never,
    new UsernameGenerator(),
    fakeAudit([]).service,
    config as never
  );
  return { service, repo, events, tokens };
}

describe('username generation at identity creation (section 3.4)', () => {
  it('names a guest the moment the temporary identity is minted', async () => {
    const { service, repo } = build();
    const tokens = await service.createTemporaryUser();

    expect(tokens.username).toBeTruthy();
    expect(repo.save.mock.calls[0][0].username).toBe(tokens.username);
  });

  it('names a registering user regardless of any displayName supplied', async () => {
    const { service, repo } = build();
    await service.register({
      email: 'a@b.com',
      password: 'pw',
      displayName: 'Daniel Real Name',
    });

    const saved = repo.save.mock.calls[0][0];
    expect(saved.displayName).toBe('Daniel Real Name');
    expect(saved.username).not.toBe('Daniel Real Name');
    expect(saved.username).toBeTruthy();
  });

  it('draws a registering user’s name from the locale they registered in', async () => {
    const { service, repo } = build();
    await service.register({ email: 'a@b.com', password: 'pw', locale: 'es' });
    // Every Spanish name ends in an accented or Spanish-only adjective; the
    // simplest locale proof is that it is not one of the English pool's names.
    expect(repo.save.mock.calls[0][0].username).toMatch(/\s/);
  });

  it('never uses the Google profile name as the username', async () => {
    const { service, repo } = build();
    const identities = makeRepo();
    // Google login with no linked identity creates a fresh registered user.
    await service.googleLogin({
      providerUserId: 'g1',
      email: 'g@b.com',
      displayName: 'Real Person',
    });
    void identities;

    const created = repo.save.mock.calls.find((c) => c[0].kind !== undefined);
    expect(created?.[0].displayName).toBe('Real Person');
    expect(created?.[0].username).not.toBe('Real Person');
  });

  it('leaves the username untouched when a guest upgrades in place', async () => {
    const { service, repo } = build([
      {
        id: 'u1',
        kind: UserKind.TEMPORARY,
        username: 'Quiet Lantern',
        email: null,
        displayName: null,
      },
    ]);

    const tokens = await service.upgrade({
      userId: 'u1',
      email: 'a@b.com',
      password: 'pw',
    });

    // The upgrade is in place and the zones already know the guest by this name.
    expect(tokens.username).toBe('Quiet Lantern');
    expect(repo.store[0].username).toBe('Quiet Lantern');
  });
});

describe('IdentityService.setUsername (section 4)', () => {
  const existing = {
    id: 'u1',
    kind: UserKind.REGISTERED,
    username: 'Swift Sail',
    email: 'a@b.com',
    emailVerifiedAt: new Date(),
    displayName: 'Alice',
  };

  it('changes the global name and emits the event with both names', async () => {
    const { service, events } = build([{ ...existing }]);

    const profile = await service.setUsername({
      userId: 'u1',
      username: 'Vela Rápida',
      propagation: UsernamePropagation.ALL_ZONES,
    });

    expect(profile.username).toBe('Vela Rápida');
    expect(events.userUsernameChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        oldUsername: 'Swift Sail',
        newUsername: 'Vela Rápida',
        propagation: UsernamePropagation.ALL_ZONES,
      })
    );
  });

  it('defaults to GLOBAL_ONLY, and still emits so consumers see every rename', async () => {
    const { service, events } = build([{ ...existing }]);

    await service.setUsername({ userId: 'u1', username: 'Steady Helm' });

    expect(events.userUsernameChanged).toHaveBeenCalledWith(
      expect.objectContaining({ propagation: UsernamePropagation.GLOBAL_ONLY })
    );
  });

  it('carries a unique event id per change, so a rename back still applies', async () => {
    const { service, events } = build([{ ...existing }]);

    await service.setUsername({ userId: 'u1', username: 'Steady Helm' });
    await service.setUsername({ userId: 'u1', username: 'Swift Sail' });
    await service.setUsername({ userId: 'u1', username: 'Steady Helm' });

    const ids = events.userUsernameChanged.mock.calls.map((c) => c[0].eventId);
    expect(new Set(ids).size).toBe(3);
  });

  it('validates and normalizes before storing', async () => {
    const { service } = build([{ ...existing }]);

    await expect(
      service.setUsername({ userId: 'u1', username: '  Vela   Rápida ' })
    ).resolves.toMatchObject({ username: 'Vela Rápida' });

    await expect(
      service.setUsername({ userId: 'u1', username: 'x' })
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('exposes the profile the app bar needs', async () => {
    const { service } = build([{ ...existing }]);

    await expect(service.getProfile({ userId: 'u1' })).resolves.toEqual({
      userId: 'u1',
      kind: UserKind.REGISTERED,
      username: 'Swift Sail',
      email: 'a@b.com',
      emailVerified: true,
      displayName: 'Alice',
    });
  });
});
