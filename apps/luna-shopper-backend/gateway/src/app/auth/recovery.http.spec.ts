import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import {
  ADMIN_USER_PATTERNS,
  AUTH_PATTERNS,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AdminUsersController } from '../admin/admin-directory.controller';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';
import { NatsClient } from '../messaging/nats-client';
import { ImpersonationGate } from './impersonation-gate';
import { JwtStrategy } from './jwt.strategy';
import { RecoverySignInController } from './recovery-sign-in.controller';

/**
 * The three routes of plan 0210 over real HTTP, at the gateway.
 *
 * Over HTTP because what is checked lives outside the handlers: the optional
 * guard decides whether a caller is sent at all, the global pipe decides what
 * `switchAccount` a body may carry, and the `no-store` header is a decorator.
 * The broker is a double that records what each route sends, which is the seam
 * the gateway owns: every one of these is a proxy.
 */

const USER = '33333333-3333-4333-8333-333333333333';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwt = new JwtService();
const bearer = () =>
  jwt.sign(
    { sub: 'u1', kind: UserKind.REGISTERED },
    { privateKey, algorithm: 'RS256', expiresIn: '15m' }
  );

interface Sent {
  subject: string;
  payload: Record<string, unknown>;
}

describe('the routes of a reset grant (plan 0210)', () => {
  const sent: Sent[] = [];
  let origin: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const nest = (
      await Test.createTestingModule({
        imports: [PassportModule],
        controllers: [RecoverySignInController, AdminUsersController],
        providers: [
          JwtStrategy,
          ImpersonationGate,
          {
            provide: NatsClient,
            useValue: {
              send: async (
                subject: string,
                payload: Record<string, unknown>
              ) => {
                sent.push({ subject, payload });
                return { ok: true };
              },
            },
          },
          {
            provide: ConfigService,
            useValue: {
              getOrThrow: () => ({
                authJwtPublicKey: publicKey
                  .export({ type: 'spki', format: 'pem' })
                  .toString(),
              }),
            },
          },
        ],
      })
        .overrideGuard(AdminJwtGuard)
        .useValue({
          canActivate: (context: {
            switchToHttp(): { getRequest(): Record<string, unknown> };
          }) => {
            context.switchToHttp().getRequest()['user'] = {
              adminId: 'admin-1',
              token: 'admin-token',
            };
            return true;
          },
        })
        .compile()
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
    nest.useGlobalPipes(createValidationPipe());
    nest.setGlobalPrefix('v1');
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
    sent.length = 0;
  });

  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });

  describe('POST /v1/auth/recovery-sign-in', () => {
    it('sends no caller for a request with no bearer', async () => {
      const res = await post('/v1/auth/recovery-sign-in', { token: 't' });

      expect(res.status).toBe(201);
      expect(sent).toEqual([
        { subject: AUTH_PATTERNS.recoverySignIn, payload: { token: 't' } },
      ]);
    });

    it('sends the caller of a bearer, from the token and never the body', async () => {
      const res = await post(
        '/v1/auth/recovery-sign-in',
        { token: 't', switchAccount: true },
        bearer()
      );

      expect(res.status).toBe(201);
      expect(sent[0].payload).toEqual({
        token: 't',
        switchAccount: true,
        callerUserId: 'u1',
      });
    });

    it('answers a stale bearer with 401 and sends nothing', async () => {
      const res = await post(
        '/v1/auth/recovery-sign-in',
        { token: 't' },
        'not-a-token'
      );

      expect(res.status).toBe(401);
      expect(sent).toEqual([]);
    });

    it('takes only a JSON boolean for switchAccount', async () => {
      // The string `"false"` would read as true under the converting pipe, and
      // leave a session the person said to keep.
      const res = await post('/v1/auth/recovery-sign-in', {
        token: 't',
        switchAccount: 'false',
      });

      expect(res.status).toBe(400);
      expect(sent).toEqual([]);
    });

    it('refuses a body with no token', async () => {
      const res = await post('/v1/auth/recovery-sign-in', {});

      expect(res.status).toBe(400);
      expect(sent).toEqual([]);
    });
  });

  describe('the operator routes', () => {
    it('mails the grant through auth, with the operator credential', async () => {
      const res = await post(`/v1/admin/users/${USER}/send-password-reset`, {
        locale: 'es',
      });

      expect(res.status).toBe(201);
      expect(sent).toEqual([
        {
          subject: ADMIN_USER_PATTERNS.sendPasswordReset,
          payload: {
            userId: 'admin-1',
            adminToken: 'admin-token',
            targetUserId: USER,
            locale: 'es',
          },
        },
      ]);
    });

    it('answers the links with Cache-Control: no-store', async () => {
      const res = await post(`/v1/admin/users/${USER}/recovery-links`, {});

      expect(res.status).toBe(201);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(sent[0]).toMatchObject({
        subject: ADMIN_USER_PATTERNS.createRecoveryLinks,
        payload: { targetUserId: USER },
      });
    });
  });
});
