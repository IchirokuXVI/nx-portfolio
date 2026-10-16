import { JwtService } from '@nestjs/jwt';
import {
  UserKind,
  type AccessTokenClaims,
} from '@portfolio/luna-shopper/contracts';
import { ERROR_CODES } from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import type { RefreshToken } from '../entities';
import { TokenService } from './token.service';

/**
 * Issuing for a support session, and not for one (plan 0194, section 4).
 *
 * The clock is fake and the signature is real. Each assertion reads the token
 * that was actually signed and the refresh row that was actually saved, so the
 * deadline is checked where it is enforced.
 */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const NOW = Date.parse('2026-10-13T10:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const USER = {
  id: 'u1',
  kind: UserKind.REGISTERED,
  username: 'Quiet Lantern',
  roles: [],
};

function build() {
  const saved: RefreshToken[] = [];
  const repository = {
    create: (row: Partial<RefreshToken>) => ({ ...row }) as RefreshToken,
    save: async (row: RefreshToken) => {
      saved.push(row);
      return row;
    },
  };
  const jwt = new JwtService();
  const tokens = new TokenService(
    jwt,
    {
      getOrThrow: () => ({
        jwt: {
          privateKey: privateKey
            .export({ type: 'pkcs8', format: 'pem' })
            .toString(),
          kid: 'test-kid',
          accessTokenTtl: '15m',
          refreshTokenTtl: '30d',
          participantTokenTtl: '15m',
        },
      }),
    } as never,
    repository as never
  );
  const claimsOf = (token: string) => jwt.decode<AccessTokenClaims>(token);
  return { tokens, saved, claimsOf };
}

const session = (msFromNow: number) => ({
  id: 's1',
  adminId: 'a1',
  expiresAt: new Date(NOW + msFromNow),
});

describe('issuing tokens', () => {
  // Only the clock is pinned. Fake timers would also hold back the ticks the
  // signing library resolves on.
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('for a support session', () => {
    it('names the operator, the session and the deadline in act, and keeps sub the user', async () => {
      const { tokens, claimsOf } = build();

      const pair = await tokens.issueTokensForSession(
        USER,
        session(120 * MINUTE)
      );

      const claims = claimsOf(pair.accessToken);
      expect(claims.sub).toBe('u1');
      expect(claims.act).toEqual({
        sub: 'a1',
        sid: 's1',
        until: (NOW + 120 * MINUTE) / 1000,
      });
      // The shape of the pair is the shape of every other pair.
      expect(Object.keys(pair).sort()).toEqual([
        'accessToken',
        'kind',
        'refreshToken',
        'userId',
        'username',
      ]);
    });

    it('gives the access token its usual life while the deadline is far', async () => {
      const { tokens, claimsOf } = build();

      const pair = await tokens.issueTokensForSession(
        USER,
        session(120 * MINUTE)
      );

      expect(claimsOf(pair.accessToken).exp).toBe((NOW + 15 * MINUTE) / 1000);
    });

    it('gives one minute of life one minute before the deadline', async () => {
      const { tokens, claimsOf } = build();

      const pair = await tokens.issueTokensForSession(USER, session(MINUTE));

      const claims = claimsOf(pair.accessToken);
      expect(claims.exp).toBe((NOW + MINUTE) / 1000);
      expect((claims.exp as number) - (claims.iat as number)).toBe(60);
    });

    it.each([1, 7, 14, 15, 16, 59, 119, 120])(
      'never signs an exp past the deadline (%d minutes left)',
      async (minutesLeft) => {
        const { tokens, claimsOf } = build();

        const pair = await tokens.issueTokensForSession(
          USER,
          session(minutesLeft * MINUTE)
        );

        const claims = claimsOf(pair.accessToken);
        expect(claims.exp as number).toBeLessThanOrEqual(
          claims.act?.until as number
        );
      }
    );

    it('cuts the refresh row to the deadline, and names the session on it', async () => {
      const { tokens, saved } = build();

      await tokens.issueTokensForSession(USER, session(90 * MINUTE));

      expect(saved).toHaveLength(1);
      expect(saved[0].expiresAt).toEqual(new Date(NOW + 90 * MINUTE));
      expect(saved[0].impersonationSessionId).toBe('s1');
    });

    it.each([0, -1, -120 * MINUTE])(
      'refuses a deadline that is not in the future (%d ms)',
      async (msFromNow) => {
        const { tokens, saved } = build();

        await expect(
          tokens.issueTokensForSession(USER, session(msFromNow))
        ).rejects.toMatchObject({ code: ERROR_CODES.IMPERSONATION_ENDED });
        expect(saved).toEqual([]);
      }
    );
  });

  describe('for an ordinary session, which does not change', () => {
    it('signs no act claim', async () => {
      const { tokens, claimsOf } = build();

      const pair = await tokens.issueTokens(USER);

      const claims = claimsOf(pair.accessToken);
      expect(claims.act).toBeUndefined();
      expect(claims.exp).toBe((NOW + 15 * MINUTE) / 1000);
    });

    it('keeps the 30 day life of the refresh row, which names no session', async () => {
      const { tokens, saved } = build();

      await tokens.issueTokens(USER);

      expect(saved).toHaveLength(1);
      expect(saved[0].expiresAt).toEqual(new Date(NOW + 30 * DAY));
      expect(saved[0].impersonationSessionId).toBeNull();
    });
  });
});
