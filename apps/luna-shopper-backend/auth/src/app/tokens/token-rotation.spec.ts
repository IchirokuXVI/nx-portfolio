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
 * updates nothing, the locked read returns the row of the case, the read of
 * the successor after the lock finds it or not, and the update of the
 * successor spends it or not. What the `WHERE` clauses decide is
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
  replacedAt: new Date(),
  revokedAt: new Date(),
  expired: false,
  graceOver: false,
  inFlight: false,
};

/** The successor of {@link GRACE_ROW}: the first one, never reissued. */
const FIRST_SUCCESSOR = { reissuedBefore: false };

function build(
  locked: Record<string, unknown> | null,
  successor: Record<string, unknown> | null = FIRST_SUCCESSOR,
  successorSpent = 0
) {
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
  // The locked read answers the row of the case, and the read after the lock
  // answers its successor.
  const reads = [locked, successor];
  const manager = {
    createQueryBuilder: () => builder,
    query: async () => {
      const next = reads.shift();
      return next ? [{ ...next }] : [];
    },
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
    name: string;
    reason: RefreshRefusal;
    locked: Record<string, unknown> | null;
    successor?: Record<string, unknown> | null;
  }> = [
    { name: 'an unknown token', reason: 'unknown', locked: null },
    {
      name: 'an expired row',
      reason: 'expired',
      locked: { ...GRACE_ROW, expired: true },
    },
    {
      name: 'a row with no successor',
      reason: 'revoked',
      locked: {
        ...GRACE_ROW,
        replacedById: null,
        replacedAt: null,
        graceOver: null,
        inFlight: null,
      },
    },
    {
      name: 'a pointer without its moment',
      reason: 'revoked',
      locked: { ...GRACE_ROW, replacedAt: null, inFlight: null },
    },
    {
      name: 'a row outside the grace',
      reason: 'grace_over',
      locked: { ...GRACE_ROW, graceOver: true },
    },
    {
      name: 'a copy of the request',
      reason: 'in_flight',
      locked: { ...GRACE_ROW, inFlight: true },
    },
    {
      name: 'a row that was reissued before',
      reason: 'reissued_before',
      locked: GRACE_ROW,
      successor: { reissuedBefore: true },
    },
    {
      name: 'a pointer to a successor the read cannot see',
      reason: 'reissued_before',
      locked: GRACE_ROW,
      successor: null,
    },
    {
      name: 'a pointer whose comparison reads null',
      reason: 'reissued_before',
      locked: GRACE_ROW,
      successor: { reissuedBefore: null },
    },
    {
      name: 'a row whose successor was spent',
      reason: 'successor_spent',
      locked: GRACE_ROW,
    },
  ];

  for (const { name, reason, locked, successor } of cases) {
    it(`writes one warn line with the reason ${reason} for ${name}`, async () => {
      const { tokens, manager, lines } = build(
        locked,
        successor === undefined ? FIRST_SUCCESSOR : successor
      );

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
    const { tokens, manager, lines } = build(GRACE_ROW, FIRST_SUCCESSOR, 1);

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
