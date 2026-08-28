import { ValidationException } from '@portfolio/luna-shopper/platform';
import type { EntityManager } from 'typeorm';
import { EmailVerification } from '../entities';
import { TokenGrantService } from './token-grant.service';

/**
 * The token dance 0022 and 0023 both build on (plan 0021, section 3): a grant is
 * usable once, only its hash is ever stored, and expiry is enforced on read.
 */

/** An in memory stand in for one entity's repository. */
function makeManager() {
  const rows: EmailVerification[] = [];
  const repository = {
    create: (row: Partial<EmailVerification>) =>
      ({ ...row }) as EmailVerification,
    save: async (row: EmailVerification) => {
      if (!rows.includes(row)) {
        rows.push(row);
      }
      return row;
    },
    findOne: async ({
      where,
    }: {
      where: Partial<EmailVerification>;
    }): Promise<EmailVerification | null> =>
      rows.find((r) => r.tokenHash === where.tokenHash) ?? null,
  };
  return {
    rows,
    manager: { getRepository: () => repository } as unknown as EntityManager,
  };
}

const HOUR = 60 * 60 * 1000;

describe('TokenGrantService', () => {
  const grants = new TokenGrantService();

  it('issues a token that consumes once, and never twice', async () => {
    const { manager } = makeManager();

    const raw = await grants.issue(
      manager,
      EmailVerification,
      { userId: 'u1' },
      HOUR
    );
    const record = await grants.consume(manager, EmailVerification, raw);

    expect(record.userId).toBe('u1');
    expect(record.consumedAt).toBeInstanceOf(Date);

    await expect(
      grants.consume(manager, EmailVerification, raw)
    ).rejects.toBeInstanceOf(ValidationException);
  });

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

  it('refuses a grant whose expiry has passed', async () => {
    const { manager } = makeManager();

    const raw = await grants.issue(
      manager,
      EmailVerification,
      { userId: 'u1' },
      -1
    );

    await expect(
      grants.consume(manager, EmailVerification, raw)
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('answers a token it never issued the same way it answers a spent one', async () => {
    // One outcome on purpose: telling them apart would confirm which guess was
    // once a real token.
    const { manager } = makeManager();

    await expect(
      grants.consume(manager, EmailVerification, 'never-issued')
    ).rejects.toBeInstanceOf(ValidationException);
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
});
