import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { TokenService, type RefreshRefusal } from './token.service';

/**
 * The log line of each refused refresh (plan 0229, section 3.4).
 *
 * The manager is a fake that answers the statements of one case: the spend
 * updates nothing, the locked read returns the row of the case, and the update
 * of the successor spends it or not. What the `WHERE` clauses decide is
 * asserted against real Postgres in `token-rotation.integration.spec.ts`. Here
 * the subject is the line: one per refusal, its reason, its row, and never
 * the token or its hash.
 */

const RAW = 'raw-refresh-token-value-that-must-never-be-logged';
const HASH = createHash('sha256').update(RAW).digest('hex');
const ROW_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SUCCESSOR_ID = '33333333-3333-4333-8333-333333333333';

/** A row that a rotation revoked inside the grace, with an unused successor. */
const GRACE_ROW = {
  id: ROW_ID,
  userId: USER_ID,
  impersonationSessionId: null,
  replacedById: SUCCESSOR_ID,
  revokedAt: new Date(),
  expired: false,
  graceOver: false,
  inFlight: false,
  reissuedBefore: false,
};

function build(locked: Record<string, unknown> | null, successorSpent = 0) {
  const untouched = () => {
    throw new Error('the default repository was reached');
  };
  const tokens = new TokenService(
    new JwtService(),
    { getOrThrow: () => ({ jwt: {} }) } as never,
    { save: untouched, update: untouched, findOne: untouched } as never
  );
  // The spend answers no row, and the update of the successor answers how
  // many rows it spent.
  const results = [{ raw: [] }, { raw: [], affected: successorSpent }];
  const builder = {
    update: () => builder,
    set: () => builder,
    where: () => builder,
    returning: () => builder,
    execute: async () => results.shift(),
  };
  const manager = {
    createQueryBuilder: () => builder,
    query: async () => (locked ? [{ ...locked }] : []),
  } as unknown as EntityManager;

  const lines: Array<{ level: string; args: unknown[] }> = [];
  for (const level of ['warn', 'log', 'error'] as const) {
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        lines.push({ level, args });
      });
  }
  return { tokens, manager, lines };
}

describe('a refused refresh', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const cases: Array<{
    reason: RefreshRefusal;
    locked: Record<string, unknown> | null;
  }> = [
    { reason: 'unknown', locked: null },
    { reason: 'expired', locked: { ...GRACE_ROW, expired: true } },
    {
      reason: 'revoked',
      locked: { ...GRACE_ROW, replacedById: null, graceOver: null },
    },
    { reason: 'grace_over', locked: { ...GRACE_ROW, graceOver: true } },
    { reason: 'in_flight', locked: { ...GRACE_ROW, inFlight: true } },
    {
      reason: 'reissued_before',
      locked: { ...GRACE_ROW, reissuedBefore: true },
    },
    { reason: 'successor_spent', locked: GRACE_ROW },
  ];

  for (const { reason, locked } of cases) {
    it(`writes one warn line with the reason ${reason}`, async () => {
      const { tokens, manager, lines } = build(locked);

      await expect(tokens.rotate(RAW, manager)).rejects.toMatchObject({
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Invalid or expired refresh token',
      });

      expect(lines).toHaveLength(1);
      expect(lines[0].level).toBe('warn');
      expect(lines[0].args[0]).toEqual({
        msg: 'Refresh refused',
        reason,
        ...(locked ? { rowId: ROW_ID, userId: USER_ID } : {}),
      });
      const written = JSON.stringify(lines);
      expect(written).not.toContain(RAW);
      expect(written).not.toContain(HASH);
      expect(written).not.toContain(HASH.slice(0, 8));
    });
  }

  it('writes one info line when the grace reissues, and no warn', async () => {
    const { tokens, manager, lines } = build(GRACE_ROW, 1);

    await expect(tokens.rotate(RAW, manager)).resolves.toEqual({
      id: ROW_ID,
      userId: USER_ID,
      impersonationSessionId: null,
      reissued: true,
    });

    expect(lines).toEqual([
      {
        level: 'log',
        args: [
          {
            msg: 'Refresh reissued inside the grace',
            reason: 'reissued',
            rowId: ROW_ID,
            userId: USER_ID,
          },
        ],
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(HASH);
  });
});
