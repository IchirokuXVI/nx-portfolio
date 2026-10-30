import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { AUTH_PATTERNS, UserKind } from '@portfolio/luna-shopper/contracts';
import {
  createValidationPipe,
  ERROR_CODES,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { NatsClient } from '../messaging/nats-client';
import { GoogleController } from './google.controller';
import { ImpersonationGate } from './impersonation-gate';
import { JwtStrategy } from './jwt.strategy';

/**
 * The two routes of the Android sign in of plan 0238 over real HTTP: the nonce
 * mint and the trade of a Google ID token.
 *
 * Over HTTP for the reason the exchange spec gives: the global pipe decides
 * what body reaches auth, the configured guard answers 501 first, the optional
 * guard decides which caller is named, and the filter turns auth's refusals
 * into the statuses the app reads. The broker is a double that records what
 * each route sends.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwt = new JwtService();
const bearer = () =>
  jwt.sign(
    { sub: 'guest-1', kind: UserKind.TEMPORARY },
    { privateKey, algorithm: 'RS256', expiresIn: '15m' }
  );

const pair = {
  userId: 'guest-1',
  kind: UserKind.REGISTERED,
  username: 'Swift Sail',
  accessToken: 'access-abc',
  refreshToken: 'refresh-xyz',
};

const minted = { nonce: 'minted-nonce', clientId: 'web-client' };

interface Sent {
  subject: string;
  payload: Record<string, unknown>;
}

/** Auth's two refusals of a token, as the broker carries them. */
const refusals: Record<string, unknown> = {
  'refused-token': {
    code: ERROR_CODES.INVALID_GOOGLE_TOKEN,
    status: 401,
    message: 'Invalid Google sign in',
    correlationId: 'c1',
  },
  'silent-token': {
    code: ERROR_CODES.GOOGLE_SIGN_IN_NEEDS_CONSENT,
    status: 409,
    message: 'This Google account opens no account here yet',
    correlationId: 'c2',
  },
};

async function boot(googleEnabled: boolean) {
  const sent: Sent[] = [];
  const nest = (
    await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [GoogleController],
      providers: [
        JwtStrategy,
        ImpersonationGate,
        {
          provide: NatsClient,
          useValue: {
            send: async (subject: string, payload: Record<string, unknown>) => {
              sent.push({ subject, payload });
              if (subject === AUTH_PATTERNS.mintGoogleNonce) {
                return minted;
              }
              const refusal = refusals[String(payload['idToken'])];
              if (refusal) {
                throw refusal;
              }
              return pair;
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: () => ({
              appBaseUrl: 'https://app.example/{locale}/velista',
              google: { enabled: googleEnabled },
              authJwtPublicKey: publicKey
                .export({ type: 'spki', format: 'pem' })
                .toString(),
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
  nest.useGlobalPipes(createValidationPipe());
  nest.setGlobalPrefix('v1');
  await nest.init();
  await nest.listen(0);
  const { port } = nest.getHttpServer().address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  const post = (path: string, body?: unknown, token?: string) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  return { sent, post, close: () => nest.close() };
}

describe('the Android Google routes of plan 0238 over HTTP', () => {
  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot(true);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    app.sent.length = 0;
  });

  describe('POST /v1/auth/google/nonce', () => {
    it('answers 201 with the nonce and the client id, naming nobody without a bearer', async () => {
      const res = await app.post('/v1/auth/google/nonce', {});

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(minted);
      expect(app.sent).toEqual([
        { subject: AUTH_PATTERNS.mintGoogleNonce, payload: {} },
      ]);
    });

    it('takes an empty request with no body at all', async () => {
      const res = await app.post('/v1/auth/google/nonce');

      expect(res.status).toBe(201);
    });

    it('names the caller from the bearer and passes the flag and the version', async () => {
      const res = await app.post(
        '/v1/auth/google/nonce',
        { silent: false, acceptedTermsVersion: '2026-10-28' },
        bearer()
      );

      expect(res.status).toBe(201);
      expect(app.sent[0].payload).toEqual({
        userId: 'guest-1',
        silent: false,
        acceptedTermsVersion: '2026-10-28',
      });
    });

    it('passes a silent request on', async () => {
      await app.post('/v1/auth/google/nonce', { silent: true });

      expect(app.sent[0].payload).toEqual({ silent: true });
    });

    it('refuses a body that tries to name the caller', async () => {
      const res = await app.post('/v1/auth/google/nonce', {
        userId: 'someone-else',
      });

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('refuses a flag that is not a boolean', async () => {
      const res = await app.post('/v1/auth/google/nonce', { silent: 'yes' });

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('refuses a stale bearer with 401 and sends nothing', async () => {
      const res = await app.post('/v1/auth/google/nonce', {}, 'not-a-token');

      expect(res.status).toBe(401);
      expect(app.sent).toEqual([]);
    });
  });

  describe('POST /v1/auth/google/id-token', () => {
    it('refuses a request without a token and sends nothing', async () => {
      const res = await app.post('/v1/auth/google/id-token');

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('refuses a token past the length bound and sends nothing', async () => {
      const res = await app.post('/v1/auth/google/id-token', {
        idToken: 'x'.repeat(4097),
      });

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('answers 201 with the pair, naming nobody without a bearer', async () => {
      const res = await app.post('/v1/auth/google/id-token', {
        idToken: 'good-token',
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(pair);
      expect(app.sent).toEqual([
        {
          subject: AUTH_PATTERNS.signInWithGoogleIdToken,
          payload: { idToken: 'good-token' },
        },
      ]);
    });

    it('names the caller of a bearer, from the token', async () => {
      const res = await app.post(
        '/v1/auth/google/id-token',
        { idToken: 'good-token' },
        bearer()
      );

      expect(res.status).toBe(201);
      expect(app.sent[0].payload).toEqual({
        idToken: 'good-token',
        callerUserId: 'guest-1',
      });
    });

    it('refuses a body that tries to name the caller', async () => {
      const res = await app.post('/v1/auth/google/id-token', {
        idToken: 'good-token',
        callerUserId: 'guest-1',
      });

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('answers 401 invalid_google_token for a token auth refuses, without echoing it', async () => {
      const res = await app.post('/v1/auth/google/id-token', {
        idToken: 'refused-token',
      });

      expect(res.status).toBe(401);
      const body = await res.text();
      expect(JSON.parse(body).code).toBe(ERROR_CODES.INVALID_GOOGLE_TOKEN);
      expect(body).not.toContain('refused-token');
    });

    it('answers 409 google_sign_in_needs_consent for a silent sign in auth refuses', async () => {
      const res = await app.post('/v1/auth/google/id-token', {
        idToken: 'silent-token',
      });

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe(
        ERROR_CODES.GOOGLE_SIGN_IN_NEEDS_CONSENT
      );
    });
  });
});

describe('the Android Google routes with Google unconfigured (plan 0026)', () => {
  it.each(['/v1/auth/google/nonce', '/v1/auth/google/id-token'])(
    '%s answers 501 not_configured before anything else',
    async (path) => {
      const app = await boot(false);
      try {
        const res = await app.post(path, { idToken: 'good-token' });

        expect(res.status).toBe(501);
        expect((await res.json()).code).toBe(ERROR_CODES.NOT_CONFIGURED);
        expect(app.sent).toEqual([]);
      } finally {
        await app.close();
      }
    }
  );
});

describe('the throttle of the Android Google routes (plan 0238, target state 4)', () => {
  const proto = GoogleController.prototype as unknown as Record<string, object>;
  const meta = (handler: string, key: string) =>
    Reflect.getMetadata(key, proto[handler]);

  it.each(['mintNonce', 'signInWithIdToken'])(
    '%s takes the throttle of the state mint and does not skip it',
    (handler) => {
      for (const key of [
        'THROTTLER:SKIPdefault',
        'THROTTLER:LIMITdefault',
        'THROTTLER:TTLdefault',
      ]) {
        expect(meta(handler, key)).toEqual(meta('mintState', key));
      }
      expect(meta(handler, 'THROTTLER:SKIPdefault')).toBeUndefined();
    }
  );
});
