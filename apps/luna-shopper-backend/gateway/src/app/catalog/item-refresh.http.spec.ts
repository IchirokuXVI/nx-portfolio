import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  PRICE_REFRESH_PATTERNS,
  PriceRefreshStatus,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import {
  createThrottlerOptions,
  createValidationPipe,
  enableApiVersioning,
  ERROR_CODES,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ImpersonationGate } from '../auth/impersonation-gate';
import { JwtStrategy } from '../auth/jwt.strategy';
import { NatsClient } from '../messaging/nats-client';
import { ACCOUNT_THROTTLE_LIMITS } from '../throttling/account-throttler.guard';
import { ItemRefreshController } from './item-refresh.controller';

/**
 * A shopper refreshes one price, over real HTTP (harvester plan 0216, section
 * 10).
 *
 * Real token verification, the real account throttler, the real validation
 * pipe and exception filter; the broker is a stub that records what it was
 * asked. What is under test is who reaches the harvester and with what: a
 * registered account on each route, a guest on none, and the eleventh `POST`
 * in ten minutes refused.
 */
const ITEM = '02160216-2222-4222-8222-222222222222';
const OTHER_ITEM = '02160216-2222-4222-8222-222222222223';
const SCOPE = '02160216-3333-4333-8333-333333333331';
const REFRESH = '02160216-5555-4555-8555-555555555555';

interface Sent {
  subject: string;
  payload: Record<string, unknown>;
}

async function boot(publicKey: string) {
  const sent: Sent[] = [];
  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule,
      ThrottlerModule.forRoot(createThrottlerOptions()),
    ],
    controllers: [ItemRefreshController],
    providers: [
      JwtStrategy,
      // What the strategy asks auth through for a token of a support session
      // (plan 0194). No token here is one, so it is never called.
      ImpersonationGate,
      {
        provide: ConfigService,
        useValue: { getOrThrow: () => ({ authJwtPublicKey: publicKey }) },
      },
      {
        provide: NatsClient,
        useValue: {
          send: async (subject: string, payload: Record<string, unknown>) => {
            sent.push({ subject, payload });
            if (subject === PRICE_REFRESH_PATTERNS.check) {
              return {
                refreshable: true,
                reason: null,
                retryAfterSeconds: 0,
                pendingRefreshId: null,
                observedAt: null,
              };
            }
            return {
              id: REFRESH,
              itemId: ITEM,
              priceScopeId: SCOPE,
              status: PriceRefreshStatus.PENDING,
              observedAt: null,
              requestedAt: '2026-11-06T12:00:00.000Z',
              finishedAt: null,
            };
          },
        },
      },
    ],
  }).compile();

  const nest = moduleRef.createNestApplication();
  enableApiVersioning(nest);
  nest.useGlobalPipes(createValidationPipe());
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
  return { nest, sent, origin: `http://127.0.0.1:${port}` };
}

describe('price refresh over HTTP (plan 0216)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwt = new JwtService();
  const token = (sub: string, kind = UserKind.REGISTERED) =>
    jwt.sign(
      { sub, kind, perms: [] },
      { privateKey, algorithm: 'RS256', expiresIn: '15m' }
    );

  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot(
      publicKey.export({ type: 'spki', format: 'pem' }).toString()
    );
  });

  afterAll(async () => {
    await app.nest.close();
  });

  beforeEach(() => {
    app.sent.length = 0;
  });

  const call = (
    method: string,
    path: string,
    options: { bearer?: string; body?: unknown } = {}
  ) =>
    fetch(`${app.origin}${path}`, {
      method,
      headers: {
        ...(options.body !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...(options.bearer
          ? { authorization: `Bearer ${options.bearer}` }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  it('reaches priceRefresh.check with the verified user, the product and the scope', async () => {
    const res = await call(
      'GET',
      `/v1/catalog/items/${ITEM}/refresh?priceScopeId=${SCOPE}`,
      { bearer: token('shopper-1') }
    );
    expect(res.status).toBe(200);
    expect(app.sent).toEqual([
      {
        subject: PRICE_REFRESH_PATTERNS.check,
        payload: { userId: 'shopper-1', itemId: ITEM, priceScopeId: SCOPE },
      },
    ]);
  });

  it('reaches priceRefresh.request and answers 201', async () => {
    const res = await call('POST', `/v1/catalog/items/${ITEM}/refresh`, {
      bearer: token('shopper-2'),
      body: { priceScopeId: SCOPE },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { id: string }).id).toBe(REFRESH);
    expect(app.sent).toEqual([
      {
        subject: PRICE_REFRESH_PATTERNS.request,
        payload: { userId: 'shopper-2', itemId: ITEM, priceScopeId: SCOPE },
      },
    ]);
  });

  it('reaches priceRefresh.get, and answers 404 for a refresh of another product', async () => {
    const ok = await call(
      'GET',
      `/v1/catalog/items/${ITEM}/refreshes/${REFRESH}`,
      { bearer: token('shopper-3') }
    );
    expect(ok.status).toBe(200);
    expect(app.sent[0]).toEqual({
      subject: PRICE_REFRESH_PATTERNS.get,
      payload: { userId: 'shopper-3', refreshId: REFRESH },
    });

    const other = await call(
      'GET',
      `/v1/catalog/items/${OTHER_ITEM}/refreshes/${REFRESH}`,
      { bearer: token('shopper-3') }
    );
    expect(other.status).toBe(404);
  });

  it.each([
    ['GET', `/v1/catalog/items/${ITEM}/refresh?priceScopeId=${SCOPE}`],
    ['POST', `/v1/catalog/items/${ITEM}/refresh`],
    ['GET', `/v1/catalog/items/${ITEM}/refreshes/${REFRESH}`],
  ])(
    '%s %s refuses a guest with 403, and a caller with no token',
    async (method, path) => {
      const body = method === 'POST' ? { priceScopeId: SCOPE } : undefined;
      const guest = await call(method, path, {
        bearer: token('guest-1', UserKind.TEMPORARY),
        body,
      });
      expect(guest.status).toBe(403);
      expect(((await guest.json()) as { code: string }).code).toBe(
        ERROR_CODES.FORBIDDEN
      );
      const anonymous = await call(method, path, { body });
      expect(anonymous.status).toBe(401);
      expect(app.sent).toEqual([]);
    }
  );

  it('refuses a scope that is not a uuid', async () => {
    const res = await call('POST', `/v1/catalog/items/${ITEM}/refresh`, {
      bearer: token('shopper-4'),
      body: { priceScopeId: 'madrid' },
    });
    expect(res.status).toBe(400);
    expect(app.sent).toEqual([]);
  });

  it('refuses the eleventh POST in ten minutes with a 429, per account', async () => {
    const limit = ACCOUNT_THROTTLE_LIMITS.priceRefresh.limit;
    expect(limit).toBe(10);
    const bearer = token('shopper-5');
    const statuses: number[] = [];
    for (let i = 0; i <= limit; i++) {
      const res = await call('POST', `/v1/catalog/items/${ITEM}/refresh`, {
        bearer,
        body: { priceScopeId: SCOPE },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, limit).every((status) => status === 201)).toBe(
      true
    );
    expect(statuses[limit]).toBe(429);

    // The two reads stay on the global bucket.
    const read = await call(
      'GET',
      `/v1/catalog/items/${ITEM}/refresh?priceScopeId=${SCOPE}`,
      { bearer }
    );
    expect(read.status).toBe(200);
    // Another account is not held up.
    const other = await call('POST', `/v1/catalog/items/${ITEM}/refresh`, {
      bearer: token('shopper-6'),
      body: { priceScopeId: SCOPE },
    });
    expect(other.status).toBe(201);
  });
});
