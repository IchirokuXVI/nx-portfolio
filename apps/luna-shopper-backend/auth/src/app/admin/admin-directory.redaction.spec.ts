import { UserKind } from '@portfolio/luna-shopper/contracts';
import { AdminDirectoryService } from './admin-directory.service';
import type { AuthPlatformAdminService } from './platform-admin.service';

/**
 * `passwordHash` never leaves auth (plan 0074, section 4, and section 7's
 * "asserted directly").
 *
 * **Asserted against the response, not against the mapper.** A test that checked
 * the mapper would pass for a mapper that is correct and a query that selected
 * the whole row, which is the version of this bug that actually happens: somebody
 * adds a field, reaches for `select('*')`, and the hash arrives in a process that
 * has to remember not to send it. Serializing the answer and searching it catches
 * that; reading the mapper does not.
 *
 * The fixtures deliberately carry a hash on every row, so a leak has something to
 * leak.
 */
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$SALT$HASHVALUE';

const NOW = new Date('2026-09-01T10:00:00.000Z');

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    kind: UserKind.REGISTERED,
    username: 'Vela',
    displayName: null,
    email: 'vela@example.com',
    emailVerifiedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    // Not a column on `users` at all: the hash lives on `credentials`. Present
    // here anyway, because what this suite proves is that a row carrying one
    // cannot reach a response whatever a future query decides to select.
    passwordHash: HASH,
    ...over,
  };
}

function adminRow(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    username: 'ichiroku',
    displayName: 'Operator',
    passwordHash: HASH,
    lastLoginAt: NOW,
    disabledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** A gate that lets everything through: refusal is `platform-admin.spec`'s job. */
const openGate = {
  requireAdmin: jest.fn(async () => 'a1'),
} as unknown as AuthPlatformAdminService;

function makeService(rows = [userRow()]) {
  const qb = {
    orderBy: () => qb,
    addOrderBy: () => qb,
    take: () => qb,
    andWhere: () => qb,
    getMany: async () => rows,
  };
  const users = {
    createQueryBuilder: () => qb,
    findOne: async () => rows[0] ?? null,
    find: async () => rows,
  };
  const credentials = { countBy: async () => 1 };
  const identities = { find: async () => [] };
  const admins = { find: async () => [adminRow()] };

  return new AdminDirectoryService(
    users as never,
    credentials as never,
    identities as never,
    admins as never,
    openGate,
    {} as never
  );
}

/** Every string in the response, however deeply nested. */
const serialize = (value: unknown) => JSON.stringify(value);

describe('the admin directory never returns a password hash', () => {
  it('not on a page of users', async () => {
    const service = makeService();
    const page = await service.list({ userId: 'a1', adminToken: 't' });

    expect(serialize(page)).not.toContain(HASH);
    expect(serialize(page)).not.toContain('passwordHash');
    expect(page.items[0].username).toBe('Vela');
  });

  it('not on one user read on their own', async () => {
    const service = makeService();
    const view = await service.get({
      userId: 'a1',
      adminToken: 't',
      targetUserId: 'u1',
    });

    expect(serialize(view)).not.toContain(HASH);
    expect(serialize(view)).not.toContain('passwordHash');
    // `hasPassword` is the fact an operator needs, and it says a credential row
    // exists while saying nothing whatever about it.
    expect(view.hasPassword).toBe(true);
  });

  it('not on the batched name lookup', async () => {
    const service = makeService();
    const result = await service.resolveMany({
      userId: 'a1',
      adminToken: 't',
      userIds: ['u1'],
    });

    expect(serialize(result)).not.toContain(HASH);
    // Three fields and no more: a decoration that carried an email address would
    // leak one into every screen that only wanted to render a name.
    expect(Object.keys(result.users[0]).sort()).toEqual([
      'displayName',
      'userId',
      'username',
    ]);
  });

  it('not on the admin roster, where the hash is a column on the row read', async () => {
    const service = makeService();
    const roster = await service.listAdmins({ userId: 'a1', adminToken: 't' });

    expect(serialize(roster)).not.toContain(HASH);
    expect(serialize(roster)).not.toContain('passwordHash');
    expect(roster.admins[0]).toEqual({
      adminId: 'a1',
      username: 'ichiroku',
      displayName: 'Operator',
      lastLoginAt: NOW.toISOString(),
      disabledAt: null,
    });
  });
});

describe('the admin directory gates before it reads', () => {
  it.each([
    ['list', (s: AdminDirectoryService) => s.list({ userId: 'a1' })],
    [
      'get',
      (s: AdminDirectoryService) => s.get({ userId: 'a1', targetUserId: 'u1' }),
    ],
    [
      'resolveMany',
      (s: AdminDirectoryService) =>
        s.resolveMany({ userId: 'a1', userIds: ['u1'] }),
    ],
    [
      'deleteUser',
      (s: AdminDirectoryService) =>
        s.deleteUser({ userId: 'a1', targetUserId: 'u1' }),
    ],
    [
      'resendVerification',
      (s: AdminDirectoryService) =>
        s.resendVerification({ userId: 'a1', targetUserId: 'u1' }),
    ],
    [
      'listAdmins',
      (s: AdminDirectoryService) => s.listAdmins({ userId: 'a1' }),
    ],
  ])('%s asks the gate first', async (_name, call) => {
    const gate = {
      requireAdmin: jest.fn(async () => {
        throw new Error('refused');
      }),
    } as unknown as AuthPlatformAdminService;
    const service = new AdminDirectoryService(
      {
        createQueryBuilder: () => {
          throw new Error('reached the database past the gate');
        },
        findOne: () => {
          throw new Error('reached the database past the gate');
        },
        find: () => {
          throw new Error('reached the database past the gate');
        },
      } as never,
      {} as never,
      {} as never,
      {
        find: () => {
          throw new Error('reached the database past the gate');
        },
      } as never,
      gate,
      {
        deleteAccount: () => {
          throw new Error('reached the service past the gate');
        },
        resendVerification: () => {
          throw new Error('reached the service past the gate');
        },
      } as never
    );

    // The refusal, and specifically not "reached the database past the gate":
    // every method must gate before it touches a table or delegates a write.
    await expect(call(service)).rejects.toThrow('refused');
  });
});
