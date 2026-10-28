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
 * The two routes of the browser half of plan 0230 over real HTTP: the mint
 * with its challenge, and the exchange.
 *
 * Over HTTP because what is checked lives outside the handlers. The global pipe
 * decides that a body without a challenge or a verifier never reaches auth, the
 * configured guard answers 501 before anything else, the optional guard decides
 * which caller is named, and the filter turns auth's refusal into the 401 the
 * app reads. The broker is a double that records what each route sends.
 */

/** A fixed verifier and its S256 challenge, base64url of its SHA-256. */
const VERIFIER = 'dBjftJeZ4CVP-mJ92K1ifhZ-dDyiYZUiYvyCxt3zbJs';
const CHALLENGE = 'lgghW2CGVJuIAQbifjAcK_8CsFoeysR6G6EYjaO0E8c';

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

interface Sent {
  subject: string;
  payload: Record<string, unknown>;
}

/** What auth answers a code it does not know, as the broker carries it. */
const refusal = {
  code: ERROR_CODES.UNAUTHORIZED,
  status: 401,
  message: 'Invalid or expired sign in code',
  correlationId: 'c1',
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
              if (subject === AUTH_PATTERNS.mintOAuthState) {
                return { state: 'minted-state' };
              }
              if (payload['code'] === 'unknown') {
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

describe('the Google routes of plan 0230 over HTTP', () => {
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

  describe('POST /v1/auth/google/state', () => {
    it('refuses a mint without a challenge and sends nothing', async () => {
      const res = await app.post('/v1/auth/google/state');

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('refuses a challenge of the wrong shape', async () => {
      const res = await app.post('/v1/auth/google/state', {
        codeChallenge: 'short',
      });

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('mints with the challenge, and the caller from the bearer', async () => {
      const res = await app.post(
        '/v1/auth/google/state',
        { codeChallenge: CHALLENGE },
        bearer()
      );

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ state: 'minted-state' });
      expect(app.sent).toEqual([
        {
          subject: AUTH_PATTERNS.mintOAuthState,
          payload: { userId: 'guest-1', codeChallenge: CHALLENGE },
        },
      ]);
    });
  });

  describe('POST /v1/auth/google/exchange', () => {
    it('refuses a request without a body and sends nothing', async () => {
      const res = await app.post('/v1/auth/google/exchange');

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('refuses a verifier of the wrong shape', async () => {
      const res = await app.post('/v1/auth/google/exchange', {
        code: 'c',
        codeVerifier: 'not-43-characters',
      });

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('answers 401 unauthorized for a code auth does not know', async () => {
      const res = await app.post('/v1/auth/google/exchange', {
        code: 'unknown',
        codeVerifier: VERIFIER,
      });

      expect(res.status).toBe(401);
      expect((await res.json()).code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('answers 201 with the pair, naming nobody without a bearer', async () => {
      const res = await app.post('/v1/auth/google/exchange', {
        code: 'staged',
        codeVerifier: VERIFIER,
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(pair);
      expect(app.sent).toEqual([
        {
          subject: AUTH_PATTERNS.exchangeGoogleSignIn,
          payload: { code: 'staged', codeVerifier: VERIFIER },
        },
      ]);
    });

    it('refuses a body that tries to name the caller', async () => {
      const res = await app.post('/v1/auth/google/exchange', {
        code: 'staged',
        codeVerifier: VERIFIER,
        callerUserId: 'guest-1',
      });

      expect(res.status).toBe(400);
      expect(app.sent).toEqual([]);
    });

    it('names the caller of a bearer, from the token', async () => {
      const res = await app.post(
        '/v1/auth/google/exchange',
        { code: 'staged', codeVerifier: VERIFIER },
        bearer()
      );

      expect(res.status).toBe(201);
      expect(app.sent[0].payload).toEqual({
        code: 'staged',
        codeVerifier: VERIFIER,
        callerUserId: 'guest-1',
      });
    });

    it('refuses a stale bearer with 401 and sends nothing', async () => {
      // The hardened optional guard of plan 0020: a guest whose token expired
      // refreshes first, so auth compares a current bearer or none.
      const res = await app.post(
        '/v1/auth/google/exchange',
        { code: 'staged', codeVerifier: VERIFIER },
        'not-a-token'
      );

      expect(res.status).toBe(401);
      expect(app.sent).toEqual([]);
    });
  });
});

describe('the exchange with Google unconfigured (plan 0026)', () => {
  it('answers 501 not_configured before anything else', async () => {
    const app = await boot(false);
    try {
      const res = await app.post('/v1/auth/google/exchange', {
        code: 'staged',
        codeVerifier: VERIFIER,
      });

      expect(res.status).toBe(501);
      expect((await res.json()).code).toBe(ERROR_CODES.NOT_CONFIGURED);
      expect(app.sent).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
