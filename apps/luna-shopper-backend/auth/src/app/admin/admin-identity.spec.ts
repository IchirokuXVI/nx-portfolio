import {
  NotConfiguredException,
  RateLimitedException,
  UnauthorizedException,
} from '@portfolio/luna-shopper/platform';
import type { AdminLoginFailure, AdminUser } from '../entities';
import { AdminIdentityService } from './admin-identity.service';

/**
 * Operator login (plan 0071, sections 5, 7 and 8).
 *
 * Four of section 11's exit criteria live here: a disabled admin cannot log in,
 * repeated failures lock out, every failure writes a row, and the development
 * autologin does nothing unless it is switched on.
 */

const LOCKOUT = { threshold: 3, windowMs: 15 * 60 * 1000 };

function makeAdmins(rows: Partial<AdminUser>[]) {
  const store = rows.map((row, index) => ({
    id: row.id ?? `a${index + 1}`,
    displayName: null,
    disabledAt: null,
    lastLoginAt: null,
    ...row,
  })) as AdminUser[];

  return {
    store,
    findOne: jest.fn(
      async ({ where }: { where: Partial<AdminUser> }) =>
        store.find((r) =>
          Object.entries(where).every(
            ([key, value]) => r[key as keyof AdminUser] === value
          )
        ) ?? null
    ),
    save: jest.fn(async (row: AdminUser) => row),
  };
}

/**
 * The failure log, with the one query the lockout makes: how many rows for this
 * username are newer than a moment.
 */
function makeFailures() {
  const store: { username: string; ip: string | null; createdAt: Date }[] = [];
  return {
    store,
    create: jest.fn((row: Partial<AdminLoginFailure>) => ({
      ...row,
      createdAt: new Date(),
    })),
    save: jest.fn(async (row: { username: string; ip: string | null }) => {
      store.push({ ...row, createdAt: new Date() });
      return row;
    }),
    count: jest.fn(
      async ({
        where,
      }: {
        where: { username: string; createdAt: unknown };
      }) => {
        // `MoreThan(date)` is opaque here; the double reads the bound off it, so
        // the "counting from" decision is genuinely exercised rather than stubbed.
        const since = (where.createdAt as { value: Date }).value;
        return store.filter(
          (r) => r.username === where.username && r.createdAt > since
        ).length;
      }
    ),
  };
}

function build(
  admins: Partial<AdminUser>[],
  options: { devAutologin?: boolean; passwordMatches?: boolean } = {}
) {
  const adminRepo = makeAdmins(admins);
  const failures = makeFailures();
  const passwords = {
    hash: jest.fn(async () => 'dummy-hash'),
    verify: jest.fn(
      async (hash: string) =>
        (options.passwordMatches ?? true) && hash !== 'dummy-hash'
    ),
  };
  const tokens = {
    issue: jest.fn(async (admin: AdminUser) => ({
      adminId: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      accessToken: 'signed',
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    })),
  };
  const config = {
    getOrThrow: () => ({
      admin: {
        lockout: LOCKOUT,
        devAutologin: options.devAutologin ?? false,
        devAutologinUsername: 'dev-admin',
      },
    }),
  };

  const service = new AdminIdentityService(
    adminRepo as never,
    failures as never,
    passwords as never,
    tokens as never,
    config as never
  );
  return { service, adminRepo, failures, passwords, tokens };
}

describe('AdminIdentityService', () => {
  describe('login', () => {
    it('issues a token for a good password and stamps the login', async () => {
      const { service, adminRepo } = build([
        { id: 'a1', username: 'ops', passwordHash: 'real' },
      ]);

      const result = await service.login({ username: 'ops', password: 'pw' });

      expect(result.adminId).toBe('a1');
      expect(result.accessToken).toBe('signed');
      expect(adminRepo.save).toHaveBeenCalled();
      expect(adminRepo.store[0].lastLoginAt).not.toBeNull();
    });

    it('refuses a disabled admin', async () => {
      const { service } = build([
        {
          id: 'a1',
          username: 'ops',
          passwordHash: 'real',
          disabledAt: new Date(),
        },
      ]);

      await expect(
        service.login({ username: 'ops', password: 'pw' })
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('answers a disabled admin exactly as it answers an unknown one', async () => {
      // Telling them apart tells an attacker which names are real, and for an
      // account whose username is one of very few that is most of the secret.
      const disabled = build([
        {
          username: 'ops',
          passwordHash: 'real',
          disabledAt: new Date(),
        },
      ]);
      const unknown = build([]);

      const first = await disabled.service
        .login({ username: 'ops', password: 'pw' })
        .catch((e) => e as Error);
      const second = await unknown.service
        .login({ username: 'nobody', password: 'pw' })
        .catch((e) => e as Error);

      expect(first.message).toBe(second.message);
    });

    it('verifies a password even when the username does not exist', async () => {
      // Otherwise an unknown name returns as fast as the database can say "no
      // row" and a real one costs a full argon2 verification.
      const { service, passwords } = build([]);

      await expect(
        service.login({ username: 'nobody', password: 'pw' })
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(passwords.verify).toHaveBeenCalled();
    });

    it('writes a row for every failure, with the address and agent', async () => {
      const { service, failures } = build([], { passwordMatches: false });

      await expect(
        service.login({
          username: 'ops',
          password: 'wrong',
          ip: '203.0.113.4',
          userAgent: 'curl/8',
        })
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(failures.store).toHaveLength(1);
      expect(failures.store[0]).toMatchObject({
        username: 'ops',
        ip: '203.0.113.4',
      });
    });

    it('writes nothing on a success', async () => {
      const { service, failures } = build([
        { username: 'ops', passwordHash: 'real' },
      ]);

      await service.login({ username: 'ops', password: 'pw' });

      expect(failures.store).toHaveLength(0);
    });

    it('locks the username out after the threshold, with a wait', async () => {
      const { service } = build([], { passwordMatches: false });

      for (let i = 0; i < LOCKOUT.threshold; i++) {
        await expect(
          service.login({ username: 'ops', password: 'wrong' })
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }

      const locked = await service
        .login({ username: 'ops', password: 'wrong' })
        .catch((e) => e as RateLimitedException);
      expect(locked).toBeInstanceOf(RateLimitedException);
      expect(locked.details?.retryAfterSeconds).toBe(LOCKOUT.windowMs / 1000);
    });

    it('refuses a locked username before verifying anything', async () => {
      // The lockout is also what stops an attacker turning argon2 into a denial
      // of service against the one account that matters.
      const { service, passwords } = build([], { passwordMatches: false });
      for (let i = 0; i < LOCKOUT.threshold; i++) {
        await service.login({ username: 'ops', password: 'x' }).catch(() => 0);
      }
      passwords.verify.mockClear();

      await service.login({ username: 'ops', password: 'x' }).catch(() => 0);

      expect(passwords.verify).not.toHaveBeenCalled();
    });

    it('stops counting failures that predate a successful login', async () => {
      // What makes the count *consecutive*, and it does it without deleting a
      // single row: the record outlives every session, which is the whole reason
      // section 7 creates the table before anything reads it.
      //
      // Two failures, a success, two more failures. Four rows against a threshold
      // of three, and the next attempt still gets in; counting the window alone
      // would have locked the account out on the strength of a password the
      // operator has since typed correctly.
      const { service, passwords, failures } = build([
        { id: 'a1', username: 'ops', passwordHash: 'real' },
      ]);
      const attempt = { username: 'ops', password: 'pw' };

      passwords.verify.mockResolvedValueOnce(false);
      await expect(service.login(attempt)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
      passwords.verify.mockResolvedValueOnce(false);
      await expect(service.login(attempt)).rejects.toBeInstanceOf(
        UnauthorizedException
      );

      await expect(service.login(attempt)).resolves.toMatchObject({
        adminId: 'a1',
      });

      passwords.verify.mockResolvedValueOnce(false);
      await expect(service.login(attempt)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
      passwords.verify.mockResolvedValueOnce(false);
      await expect(service.login(attempt)).rejects.toBeInstanceOf(
        UnauthorizedException
      );

      expect(failures.store).toHaveLength(4);
      await expect(service.login(attempt)).resolves.toMatchObject({
        adminId: 'a1',
      });
    });
  });

  describe('refresh', () => {
    it('renews a live token', async () => {
      const { service } = build([{ id: 'a1', username: 'ops' }]);

      await expect(service.refresh({ adminId: 'a1' })).resolves.toMatchObject({
        adminId: 'a1',
      });
    });

    it('refuses an admin disabled since the token was signed', async () => {
      // Disabling cannot invalidate a signed token, so what it does instead is
      // stop the next renewal: the damage is bounded to one token lifetime.
      const { service } = build([
        { id: 'a1', username: 'ops', disabledAt: new Date() },
      ]);

      await expect(service.refresh({ adminId: 'a1' })).rejects.toBeInstanceOf(
        UnauthorizedException
      );
    });
  });

  describe('getAdmin', () => {
    it('returns the identity without the password hash', async () => {
      const { service } = build([
        {
          id: 'a1',
          username: 'ops',
          displayName: 'Operations',
          passwordHash: 'real',
        },
      ]);

      const view = await service.getAdmin({ adminId: 'a1' });

      expect(view).toEqual({
        adminId: 'a1',
        username: 'ops',
        displayName: 'Operations',
        lastLoginAt: null,
        disabledAt: null,
      });
      expect(JSON.stringify(view)).not.toContain('real');
    });
  });

  describe('devAutologin', () => {
    it('refuses when the switch is off', async () => {
      const { service } = build([{ username: 'dev-admin' }]);

      await expect(
        service.devAutologin({ username: 'dev-admin' })
      ).rejects.toBeInstanceOf(NotConfiguredException);
    });

    it('issues a token for a named existing admin when it is on', async () => {
      // A real actor id, not an invented one, so plan 0075's audit rows are
      // attributable even in development.
      const { service } = build([{ id: 'a1', username: 'dev-admin' }], {
        devAutologin: true,
      });

      await expect(
        service.devAutologin({ username: 'dev-admin' })
      ).resolves.toMatchObject({ adminId: 'a1' });
    });

    it('refuses to invent an admin that does not exist', async () => {
      const { service } = build([], { devAutologin: true });

      await expect(
        service.devAutologin({ username: 'dev-admin' })
      ).rejects.toBeInstanceOf(NotConfiguredException);
    });
  });
});
