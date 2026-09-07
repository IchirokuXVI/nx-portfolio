import * as argon2 from 'argon2';
import type { AdminUser } from '../../entities';
import {
  createAdmin,
  ensureAdmin,
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

  /**
   * What `stack.sh up` runs on every slot, which is why the assertions are about
   * repetition rather than about creating: the interesting cases are all the
   * second run.
   */
  describe('ensure', () => {
    it('creates the row when there is none', async () => {
      const { dataSource, repo } = fakeDataSource();

      const admin = await ensureAdmin(dataSource, {
        username: 'dev-admin',
        password: async () => 'a-long-enough-password',
      });

      expect(admin).toMatchObject({ username: 'dev-admin', created: true });
      expect(repo.store).toHaveLength(1);
    });

    it('leaves an existing account alone rather than refusing', async () => {
      // Everything about the stored row is deliberate: a developer who changed
      // the password, renamed the account or disabled it did so on purpose, and
      // an `up` a minute later must not undo any of the three.
      const { dataSource, repo } = fakeDataSource([
        {
          id: 'a1',
          username: 'dev-admin',
          passwordHash: 'the-hash-it-already-had',
          displayName: 'Renamed By Hand',
          disabledAt: new Date('2026-01-01'),
        } as AdminUser,
      ]);

      const admin = await ensureAdmin(dataSource, {
        username: 'dev-admin',
        displayName: 'Dev Admin',
        password: async () => 'a-long-enough-password',
      });

      expect(admin).toEqual({
        id: 'a1',
        username: 'dev-admin',
        created: false,
      });
      expect(repo.store).toHaveLength(1);
      expect(repo.store[0]).toMatchObject({
        passwordHash: 'the-hash-it-already-had',
        displayName: 'Renamed By Hand',
        disabledAt: new Date('2026-01-01'),
      });
    });

    it('never asks for a password it will not use', async () => {
      // The command prompts to produce one, so asking when the row is already
      // there would make a script hang and a person answer for nothing.
      const { dataSource } = fakeDataSource([
        { id: 'a1', username: 'dev-admin' } as AdminUser,
      ]);
      const password = jest.fn(async () => 'a-long-enough-password');

      await ensureAdmin(dataSource, { username: 'dev-admin', password });

      expect(password).not.toHaveBeenCalled();
    });

    it('still enforces the length floor when it does create one', async () => {
      const { dataSource } = fakeDataSource();

      await expect(
        ensureAdmin(dataSource, {
          username: 'dev-admin',
          password: async () => 'short',
        })
      ).rejects.toThrow(/at least/);
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
