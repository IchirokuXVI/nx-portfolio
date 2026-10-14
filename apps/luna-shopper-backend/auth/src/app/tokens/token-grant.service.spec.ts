import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { EntityManager } from 'typeorm';
import { EmailVerification, PasswordReset } from '../entities';
import { TokenGrantService } from './token-grant.service';

/**
 * The token dance 0022 and 0023 both build on (plan 0021, section 3): a grant is
 * usable once, only its hash is ever stored, and expiry is enforced on read.
 *
 * The spend is one conditional statement (plan 0210, target state 2). What a
 * double can prove about it is what the statement says, and that is what the
 * spend specs here assert. That it holds against a second request at the same
 * instant is a property of Postgres, proven in `token-grant.integration.spec.ts`.
 */

/** One `UPDATE` as the service built it, and what the double answered. */
interface Statement {
  entity: unknown;
  set: Record<string, unknown>;
  where: string;
  parameters: Record<string, unknown>;
  returning: string | null;
}

/**
 * An in memory stand in for one entity's repository, plus a query builder
 * that records each `UPDATE` and answers it with `raw`.
 */
function makeManager(raw: Record<string, unknown>[] = [], affected = 0) {
  const rows: EmailVerification[] = [];
  const statements: Statement[] = [];
  const repository = {
    create: (row: Partial<EmailVerification>) =>
      ({ ...row }) as EmailVerification,
    save: async (row: EmailVerification) => {
      if (!rows.includes(row)) {
        rows.push(row);
      }
      return row;
    },
  };
  const builder = () => {
    const statement: Statement = {
      entity: null,
      set: {},
      where: '',
      parameters: {},
      returning: null,
    };
    const chain = {
      update: (entity: unknown) => ((statement.entity = entity), chain),
      set: (set: Record<string, unknown>) => ((statement.set = set), chain),
      where: (where: string, parameters: Record<string, unknown>) => (
        (statement.where = where),
        (statement.parameters = parameters),
        chain
      ),
      returning: (columns: string) => ((statement.returning = columns), chain),
      execute: async () => {
        statements.push(statement);
        return { raw, affected };
      },
    };
    return chain;
  };
  // The columns of the table, as the metadata names them. Every one of them is
  // named as its property today; `expiresOn` is not, so the mapping is shown to
  // read the column name rather than assume the two are the same.
  const metadata = {
    columns: [
      { propertyName: 'id', databaseName: 'id' },
      { propertyName: 'userId', databaseName: 'userId' },
      { propertyName: 'tokenHash', databaseName: 'tokenHash' },
      { propertyName: 'expiresAt', databaseName: 'expiresOn' },
      { propertyName: 'consumedAt', databaseName: 'consumedAt' },
    ],
  };
  return {
    rows,
    statements,
    manager: {
      getRepository: () => repository,
      createQueryBuilder: builder,
      connection: { getMetadata: () => metadata },
    } as unknown as EntityManager,
  };
}

const HOUR = 60 * 60 * 1000;

describe('TokenGrantService', () => {
  const grants = new TokenGrantService();

  it('stores only the hash, so a database read never yields a usable link', async () => {
    const { rows, manager } = makeManager();

    const raw = await grants.issue(
      manager,
      EmailVerification,
      { userId: 'u1' },
      HOUR
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(raw);
    expect(rows[0].tokenHash).toBe(grants.hash(raw));
    // SHA-256, hex: nothing about the raw value survives.
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives every grant a different token', async () => {
    const { manager } = makeManager();

    const issued = await Promise.all(
      [1, 2, 3].map(() =>
        grants.issue(manager, EmailVerification, { userId: 'u1' }, HOUR)
      )
    );

    expect(new Set(issued).size).toBe(3);
  });

  describe('consume', () => {
    it('spends in one statement whose condition is the whole check', async () => {
      const at = new Date('2026-10-14T10:00:00Z');
      const { statements, manager } = makeManager([
        {
          id: 'g1',
          userId: 'u1',
          tokenHash: grants.hash('raw'),
          expiresOn: at,
          consumedAt: at,
        },
      ]);

      const record = await grants.consume(manager, EmailVerification, 'raw');

      expect(statements).toHaveLength(1);
      const [statement] = statements;
      expect(statement.entity).toBe(EmailVerification);
      // The read and the write are one: unknown, spent and expired are all
      // the same `WHERE` that matched nothing.
      expect(statement.where).toContain('"tokenHash" = :tokenHash');
      expect(statement.where).toContain('"consumedAt" IS NULL');
      expect(statement.where).toContain('"expiresAt" > now()');
      expect(statement.parameters).toEqual({ tokenHash: grants.hash('raw') });
      // The clock of the database writes the stamp, the one the expiry is
      // compared on.
      expect(typeof statement.set['consumedAt']).toBe('function');
      expect(statement.returning).toBe('*');

      // Mapped back by column name, so a column named apart from its property
      // still lands on the property.
      expect(record).toEqual({
        id: 'g1',
        userId: 'u1',
        tokenHash: grants.hash('raw'),
        expiresAt: at,
        consumedAt: at,
      });
    });

    it('writes how the grant ended in the statement that ends it', async () => {
      const { statements, manager } = makeManager([{ id: 'g1' }]);

      await grants.consume(manager, PasswordReset, 'raw', 'nope', {
        spentAs: 'SIGN_IN',
      } as Partial<PasswordReset>);

      expect(statements[0].set['spentAs']).toBe('SIGN_IN');
      expect(typeof statements[0].set['consumedAt']).toBe('function');
    });

    it('answers no row back with the one refusal, whatever the reason', async () => {
      // One outcome on purpose: telling them apart would confirm which guess was
      // once a real token.
      const { manager } = makeManager([]);

      await expect(
        grants.consume(manager, EmailVerification, 'never-issued', 'nope')
      ).rejects.toEqual(new ValidationException('nope'));
    });
  });

  describe('endOthers', () => {
    it('ends every other live grant of the account, and only those', async () => {
      const { statements, manager } = makeManager([], 2);

      const ended = await grants.endOthers(
        manager,
        PasswordReset,
        { id: 'g1', userId: 'u1' } as PasswordReset,
        { spentAs: 'SUPERSEDED' } as Partial<PasswordReset>
      );

      expect(ended).toBe(2);
      const [statement] = statements;
      expect(statement.entity).toBe(PasswordReset);
      expect(statement.where).toContain('"userId" = :userId');
      expect(statement.where).toContain('"consumedAt" IS NULL');
      expect(statement.where).toContain('"id" <> :id');
      expect(statement.parameters).toEqual({ userId: 'u1', id: 'g1' });
      expect(statement.set['spentAs']).toBe('SUPERSEDED');
      expect(typeof statement.set['consumedAt']).toBe('function');
    });
  });

  describe('isLive', () => {
    it('is false once spent, and false once expired', () => {
      const later = new Date(Date.now() + HOUR);
      const earlier = new Date(Date.now() - 1);

      expect(
        grants.isLive({ tokenHash: 'h', expiresAt: later, consumedAt: null })
      ).toBe(true);
      expect(
        grants.isLive({
          tokenHash: 'h',
          expiresAt: later,
          consumedAt: new Date(),
        })
      ).toBe(false);
      expect(
        grants.isLive({ tokenHash: 'h', expiresAt: earlier, consumedAt: null })
      ).toBe(false);
    });
  });
});
