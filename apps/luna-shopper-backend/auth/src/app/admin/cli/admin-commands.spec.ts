import * as argon2 from 'argon2';
import type { AdminUser } from '../../entities';
import {
  createAdmin,
  formatAdminList,
  listAdmins,
  MIN_ADMIN_PASSWORD_LENGTH,
} from './admin-commands';

/**
 * The server side commands (plan 0071, section 6).
 *
 * What is worth asserting is narrow and none of it is the plumbing: the password
 * is hashed rather than stored, the length floor is enforced by the command
 * because no route will ever enforce it, a duplicate name is refused with a
 * sentence rather than a constraint violation, and nothing the list prints is a
 * secret.
 */
function fakeDataSource(rows: Partial<AdminUser>[] = []) {
  const store = rows as AdminUser[];
  const repo = {
    store,
    create: jest.fn((row: Partial<AdminUser>) => ({ ...row })),
    save: jest.fn(async (row: Partial<AdminUser>) => {
      const saved = {
        id: row.id ?? `a${store.length + 1}`,
        ...row,
      } as AdminUser;
      store.push(saved);
      return saved;
    }),
    findOne: jest.fn(
      async ({ where }: { where: { username: string } }) =>
        store.find((r) => r.username === where.username) ?? null
    ),
    find: jest.fn(async () => store),
  };
  return {
    repo,
    dataSource: { getRepository: () => repo } as never,
  };
}

describe('admin commands', () => {
  describe('create', () => {
    it('stores an argon2 hash and never the password', async () => {
      // The same `PasswordService` the running service uses, so the argon2
      // parameters stay in one place rather than being restated by a tool.
      const { dataSource, repo } = fakeDataSource();

      const created = await createAdmin(dataSource, {
        username: 'ops',
        password: 'a-long-enough-password',
      });

      expect(created.username).toBe('ops');
      expect(repo.store[0].passwordHash).toMatch(/^\$argon2id\$/);
      expect(repo.store[0].passwordHash).not.toContain(
        'a-long-enough-password'
      );
      await expect(
        argon2.verify(repo.store[0].passwordHash, 'a-long-enough-password')
      ).resolves.toBe(true);
    });

    it('enforces the length floor, because no route ever will', async () => {
      const { dataSource } = fakeDataSource();

      await expect(
        createAdmin(dataSource, { username: 'ops', password: 'short' })
      ).rejects.toThrow(String(MIN_ADMIN_PASSWORD_LENGTH));
    });

    it('refuses a duplicate name with a sentence, not a constraint', async () => {
      const { dataSource } = fakeDataSource([{ username: 'ops' } as AdminUser]);

      await expect(
        createAdmin(dataSource, {
          username: 'ops',
          password: 'a-long-enough-password',
        })
      ).rejects.toThrow(/already exists/);
    });

    it('starts the account enabled and never logged in', async () => {
      const { dataSource, repo } = fakeDataSource();

      await createAdmin(dataSource, {
        username: 'ops',
        password: 'a-long-enough-password',
        displayName: '  Operations  ',
      });

      expect(repo.store[0]).toMatchObject({
        displayName: 'Operations',
        disabledAt: null,
        lastLoginAt: null,
      });
    });
  });

  describe('list', () => {
    it('returns no secrets at all', async () => {
      const { dataSource } = fakeDataSource([
        {
          username: 'ops',
          displayName: null,
          passwordHash: 'a-real-hash',
          disabledAt: null,
          lastLoginAt: new Date('2026-09-01T10:00:00.000Z'),
        } as AdminUser,
      ]);

      const rows = await listAdmins(dataSource);

      expect(JSON.stringify(rows)).not.toContain('a-real-hash');
      expect(rows[0]).toEqual({
        username: 'ops',
        displayName: null,
        disabledAt: null,
        lastLoginAt: '2026-09-01T10:00:00.000Z',
      });
    });

    it('says so when there are none, rather than printing a bare header', () => {
      expect(formatAdminList([])).toContain('No admins');
    });

    it('prints never for an account that has not been used', () => {
      // The column that answers "is this account still used", which is the
      // question behind every decision to disable one.
      const rendered = formatAdminList([
        {
          username: 'ops',
          displayName: null,
          disabledAt: null,
          lastLoginAt: null,
        },
      ]);

      expect(rendered).toContain('never');
    });
  });
});
