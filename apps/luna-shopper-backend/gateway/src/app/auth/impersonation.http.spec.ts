import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import {
  AUTH_PATTERNS,
  IMPERSONATION_PATTERNS,
  UserKind,
  ZONE_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AccountController } from '../account/account.controller';
import { ScopeResolutionService } from '../catalog/scope-resolution.service';
import { legalConfig } from '../config/legal-config';
import { NatsClient } from '../messaging/nats-client';
import { ZoneController } from '../zones/zone.controller';
import { AuthController } from './auth.controller';
import { GoogleController } from './google.controller';
import { ImpersonationGate } from './impersonation-gate';
import { ImpersonationController } from './impersonation.controller';
import { JwtStrategy } from './jwt.strategy';
import { RecoverySignInController } from './recovery-sign-in.controller';

/**
 * A support session over real HTTP, at the gateway (plan 0194, section 4).
 *
 * The controllers, the passport strategy, the two guards and the exception
 * filter are the real ones, verifying a real RS256 signature. Only the broker
 * is a double: it records each subject it is sent and answers the liveness
 * question with whatever the test set. So what is asserted is what a route
 * really carries, and not a restatement of its decorators.
 */

const SESSION = '0b0f6a0e-3c0b-4a55-9b0e-6d2f5a1c7e11';
const OPERATOR = '44444444-4444-4444-8444-444444444444';
const ZONE = '11111111-1111-4111-8111-111111111111';
const MEMBERSHIP = '22222222-2222-4222-8222-222222222222';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwt = new JwtService();
const sign = (claims: Record<string, unknown>) =>
  jwt.sign(claims, { privateKey, algorithm: 'RS256', expiresIn: '15m' });

const act = () => ({
  sub: OPERATOR,
  sid: SESSION,
  until: Math.floor(Date.now() / 1000) + 3600,
});

/** An ordinary token: the person, signed in the ordinary way. */
const ordinary = () => sign({ sub: 'u1', kind: UserKind.REGISTERED });

/** A token of a support session: the same person, with the operator in `act`. */
const supported = () =>
  sign({ sub: 'u1', kind: UserKind.REGISTERED, act: act() });

interface Problem {
  code?: string;
}

describe('a support session at the gateway', () => {
  /** What auth answers the liveness question with. A test may change it. */
  let live = true;
  const sent: Array<{ subject: string; payload: Record<string, unknown> }> = [];
  const nats = {
    send: async (subject: string, payload: Record<string, unknown>) => {
      sent.push({ subject, payload });
      if (subject === IMPERSONATION_PATTERNS.check) {
        return { live };
      }
      return { ok: true };
    },
  };
  const subjects = () => sent.map((entry) => entry.subject);

  let origin: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const nest = (
      await Test.createTestingModule({
        imports: [PassportModule],
        controllers: [
          AccountController,
          AuthController,
          GoogleController,
          ZoneController,
          ImpersonationController,
          RecoverySignInController,
        ],
        providers: [
          JwtStrategy,
          ImpersonationGate,
          { provide: NatsClient, useValue: nats },
          { provide: ScopeResolutionService, useValue: {} },
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: () => ({
                authJwtPublicKey: publicKey
                  .export({ type: 'spki', format: 'pem' })
                  .toString(),
                appBaseUrl: 'http://localhost:4200/{locale}/velista',
                google: { enabled: true },
                legal: legalConfig({}),
              }),
            },
          },
        ],
      }).compile()
    ).createNestApplication();

    const logger = {
      setContext: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    nest.useGlobalFilters(
      new GlobalExceptionFilter(
        logger as unknown as ConstructorParameters<
          typeof GlobalExceptionFilter
        >[0]
      )
    );
    await nest.init();
    await nest.listen(0);
    const { port } = nest.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${port}`;
    close = () => nest.close();
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(() => {
    live = true;
    sent.length = 0;
  });

  const call = (method: string, path: string, token?: string) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: method === 'GET' || method === 'DELETE' ? undefined : '{}',
    });

  /**
   * The five routes of target state 8, and the sign in with a reset link that
   * plan 0210 added, and accepting the Terms that plan 0231 added, each with
   * the subject its handler sends when it is allowed to run.
   */
  const REFUSED: Array<[string, string, string, string]> = [
    ['DELETE /account', 'DELETE', '/account', AUTH_PATTERNS.deleteAccount],
    ['POST /auth/upgrade', 'POST', '/auth/upgrade', AUTH_PATTERNS.upgrade],
    [
      'POST /auth/google/state',
      'POST',
      '/auth/google/state',
      AUTH_PATTERNS.mintOAuthState,
    ],
    [
      'POST /auth/google/nonce',
      'POST',
      '/auth/google/nonce',
      AUTH_PATTERNS.mintGoogleNonce,
    ],
    [
      'POST /zones/:id/members/:mid/transfer-ownership',
      'POST',
      `/zones/${ZONE}/members/${MEMBERSHIP}/transfer-ownership`,
      ZONE_PATTERNS.transferOwnership,
    ],
    [
      'POST /auth/resend-verification',
      'POST',
      '/auth/resend-verification',
      AUTH_PATTERNS.resendVerification,
    ],
    [
      'POST /auth/recovery-sign-in',
      'POST',
      '/auth/recovery-sign-in',
      AUTH_PATTERNS.recoverySignIn,
    ],
    [
      'POST /account/terms-acceptances',
      'POST',
      '/account/terms-acceptances',
      AUTH_PATTERNS.acceptTerms,
    ],
  ];

  describe.each(REFUSED)('%s', (_name, method, path, subject) => {
    it('answers 403 impersonation_not_allowed to a support session', async () => {
      const res = await call(method, path, supported());

      expect(res.status).toBe(403);
      expect(((await res.json()) as Problem).code).toBe(
        ERROR_CODES.IMPERSONATION_NOT_ALLOWED
      );
      // The handler never ran: the one message is the liveness question.
      expect(subjects()).toEqual([IMPERSONATION_PATTERNS.check]);
    });

    it('answers as it always did to the person', async () => {
      const res = await call(method, path, ordinary());

      expect(res.status).toBeLessThan(300);
      expect(subjects()).toEqual([subject]);
    });
  });

  it('leaves every other route open to a support session', async () => {
    const res = await call('GET', '/account/me', supported());

    expect(res.status).toBe(200);
    expect(subjects()).toContain(AUTH_PATTERNS.getProfile);
  });

  it('asks auth on each request of a support session', async () => {
    await call('GET', '/account/me', supported());
    await call('GET', '/account/me', supported());

    expect(
      sent
        .filter((entry) => entry.subject === IMPERSONATION_PATTERNS.check)
        .map((entry) => entry.payload)
    ).toEqual([{ sessionId: SESSION }, { sessionId: SESSION }]);
  });

  it('sends no check for a token with no act', async () => {
    const res = await call('GET', '/account/me', ordinary());

    expect(res.status).toBe(200);
    expect(subjects()).not.toContain(IMPERSONATION_PATTERNS.check);
  });

  it('answers 401 impersonation_ended after the session ended, inside the exp of the token', async () => {
    const token = supported();
    expect((await call('GET', '/account/me', token)).status).toBe(200);

    live = false;
    sent.length = 0;
    const res = await call('GET', '/account/me', token);

    expect(res.status).toBe(401);
    expect(((await res.json()) as Problem).code).toBe(
      ERROR_CODES.IMPERSONATION_ENDED
    );
    // Refused before the handler: nothing was read for a dead session.
    expect(subjects()).toEqual([IMPERSONATION_PATTERNS.check]);
  });

  it('refuses a token whose act claim is malformed, and does not read it as an ordinary token', async () => {
    const res = await call(
      'GET',
      '/account/me',
      sign({ sub: 'u1', kind: UserKind.REGISTERED, act: { sub: OPERATOR } })
    );

    expect(res.status).toBe(401);
    expect(((await res.json()) as Problem).code).toBe(
      ERROR_CODES.IMPERSONATION_ENDED
    );
    expect(sent).toEqual([]);
  });

  describe('POST /auth/impersonation/end', () => {
    it('ends the session of the token, named by the token and by no body', async () => {
      const res = await fetch(`${origin}/auth/impersonation/end`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${supported()}`,
        },
        body: JSON.stringify({ userId: 'someone-else', sessionId: 'other' }),
      });

      expect(res.status).toBe(201);
      expect(sent.at(-1)).toEqual({
        subject: IMPERSONATION_PATTERNS.end,
        payload: { userId: 'u1', sessionId: SESSION },
      });
    });

    it('sends no session for an ordinary token, which auth answers with not_impersonating', async () => {
      await call('POST', '/auth/impersonation/end', ordinary());

      expect(sent).toEqual([
        {
          subject: IMPERSONATION_PATTERNS.end,
          payload: { userId: 'u1', sessionId: undefined },
        },
      ]);
    });

    it('needs a token', async () => {
      expect((await call('POST', '/auth/impersonation/end')).status).toBe(401);
    });
  });

  describe('POST /auth/impersonation/exchange', () => {
    it('takes no token, and hands auth the code alone', async () => {
      const res = await fetch(`${origin}/auth/impersonation/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'the-code', userId: 'u2' }),
      });

      expect(res.status).toBe(201);
      expect(sent).toEqual([
        {
          subject: IMPERSONATION_PATTERNS.exchange,
          payload: { code: 'the-code' },
        },
      ]);
    });
  });
});
