import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  SHOP_WALK_LIMITS,
  SHOP_WALK_PATTERNS,
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
import { JwtStrategy } from '../auth/jwt.strategy';
import { bodyParserProblems, jsonBodyParsers } from '../harvest/import-body';
import { NatsClient } from '../messaging/nats-client';
import { ACCOUNT_THROTTLE_LIMITS } from '../throttling/account-throttler.guard';
import {
  CatalogLocationMapController,
  CatalogLocationWalksController,
  CatalogWalksController,
} from './shop-walks.controller';

/**
 * A shop's walks over real HTTP (backend plan 0168, section 3).
 *
 * Real token verification, the real permission guard, the real validation pipe,
 * body parsers and exception filter; the broker is a stub that records what it
 * was asked. What is under test is who reaches catalog and with what: the map
 * with no account, the walks only with `shopMap.record`, and the entries route
 * throttled per account and capped at 256 KB.
 */
const SHOP = '5c7e9a1b-3d5f-4a7b-9c1d-3e5f7a9b1c3d';
const WALK = '7e2a1b3c-4d5e-4f6a-9b8c-1d2e3f4a5b6c';
const ENTRY = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

interface Sent {
  subject: string;
  payload: Record<string, unknown>;
}

interface Problem {
  code?: string;
  details?: Record<string, unknown>;
}

async function boot(publicKey: string) {
  const sent: Sent[] = [];
  const moduleRef = await Test.createTestingModule({
    imports: [
      PassportModule,
      ThrottlerModule.forRoot(createThrottlerOptions()),
    ],
    controllers: [
      CatalogLocationMapController,
      CatalogLocationWalksController,
      CatalogWalksController,
    ],
    providers: [
      JwtStrategy,
      {
        provide: ConfigService,
        useValue: { getOrThrow: () => ({ authJwtPublicKey: publicKey }) },
      },
      {
        provide: NatsClient,
        useValue: {
          send: async (subject: string, payload: Record<string, unknown>) => {
            sent.push({ subject, payload });
            return { ok: true };
          },
        },
      },
    ],
  }).compile();

  const nest = moduleRef.createNestApplication({ bodyParser: false });
  enableApiVersioning(nest);
  const limits = {
    importMaxBytes: 1024 * 1024,
    bulkMaxBytes: 1024 * 1024,
    defaultMaxBytes: 100 * 1024,
  };
  for (const parser of jsonBodyParsers(limits)) {
    if (parser.path) {
      nest.use(parser.path, parser.handler);
    } else {
      nest.use(parser.handler);
    }
  }
  nest.use(bodyParserProblems(limits));
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

describe('shop walks over HTTP (plan 0168)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwt = new JwtService();
  const token = (sub: string, perms: string[]) =>
    jwt.sign(
      { sub, kind: UserKind.REGISTERED, perms },
      { privateKey, algorithm: 'RS256', expiresIn: '15m' }
    );
  const mapper = token('mapper-1', ['shopMap.record']);
  const shopper = token('shopper-1', []);

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
    options: { bearer?: string; body?: unknown; raw?: string } = {}
  ) =>
    fetch(`${app.origin}${path}`, {
      method,
      headers: {
        ...(options.body !== undefined || options.raw !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...(options.bearer
          ? { authorization: `Bearer ${options.bearer}` }
          : {}),
      },
      body:
        options.raw ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });

  const entry = (id = ENTRY) => ({
    id,
    baseSeq: 0,
    kind: 'started',
    at: '2026-09-30T10:00:00.000Z',
    logFrom: 0,
    logTo: 1000,
    events: [{ type: 'path', points: [[0, 0, 0]] }],
  });

  it('serves the map with no account, and asks catalog for the shop alone', async () => {
    const res = await call('GET', `/v1/catalog/locations/${SHOP}/map`);
    expect(res.status).toBe(200);
    expect(app.sent).toEqual([
      {
        subject: SHOP_WALK_PATTERNS.mapForLocation,
        payload: { supermarketLocationId: SHOP },
      },
    ]);
  });

  it.each([
    ['GET', `/v1/catalog/locations/${SHOP}/walks`, undefined],
    ['POST', `/v1/catalog/locations/${SHOP}/walks`, { name: 'Walk' }],
    ['GET', `/v1/catalog/walks/${WALK}`, undefined],
    ['GET', `/v1/catalog/walks/${WALK}/log`, undefined],
    ['PATCH', `/v1/catalog/walks/${WALK}`, { shown: true }],
    ['DELETE', `/v1/catalog/walks/${WALK}`, undefined],
    ['POST', `/v1/catalog/walks/${WALK}/entries`, entry()],
  ])('%s %s needs shopMap.record', async (method, path, body) => {
    const anonymous = await call(method, path, { body });
    expect(anonymous.status).toBe(401);
    const refused = await call(method, path, { body, bearer: shopper });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as Problem).code).toBe(
      ERROR_CODES.PERMISSION_REQUIRED
    );
    expect(app.sent).toEqual([]);

    const allowed = await call(method, path, { body, bearer: mapper });
    expect(allowed.status).toBeLessThan(300);
    expect(app.sent).toHaveLength(1);
    expect(app.sent[0].payload['userId']).toBe('mapper-1');
  });

  it('forwards an entry as the contract states it', async () => {
    const res = await call('POST', `/v1/catalog/walks/${WALK}/entries`, {
      bearer: token('mapper-2', ['shopMap.record']),
      body: { ...entry(), kind: 'rewound', rewoundTo: 500 },
    });
    expect(res.status).toBe(201);
    expect(app.sent).toEqual([
      {
        subject: SHOP_WALK_PATTERNS.append,
        payload: {
          userId: 'mapper-2',
          walkId: WALK,
          ...entry(),
          kind: 'rewound',
          rewoundTo: 500,
        },
      },
    ]);
  });

  it.each([
    ['an id that is not a uuid', { ...entry(), id: 'e1' }],
    ['an unknown kind', { ...entry(), kind: 'paused' }],
    ['a negative base', { ...entry(), baseSeq: -1 }],
    ['events that are not a list', { ...entry(), events: {} }],
  ])('refuses %s with a 400', async (_name, body) => {
    const res = await call('POST', `/v1/catalog/walks/${WALK}/entries`, {
      bearer: token('mapper-3', ['shopMap.record']),
      body,
    });
    expect(res.status).toBe(400);
    expect(app.sent).toEqual([]);
  });

  it('takes an entry up to 256 KB and refuses a larger one as shop_map_too_large', async () => {
    const bearer = token('mapper-4', ['shopMap.record']);
    const padded = (bytes: number) => {
      const body = { ...entry(), events: [] as unknown[] };
      const base = JSON.stringify(body).length;
      const point = ',[0,0,0]';
      const count = Math.floor((bytes - base - 40) / point.length);
      const points = Array.from({ length: count }, () => [0, 0, 0]);
      return JSON.stringify({ ...body, events: [{ type: 'path', points }] });
    };
    const within = await call('POST', `/v1/catalog/walks/${WALK}/entries`, {
      bearer,
      raw: padded(200 * 1024),
    });
    expect(within.status).toBe(201);

    const over = await call('POST', `/v1/catalog/walks/${WALK}/entries`, {
      bearer,
      raw: padded(SHOP_WALK_LIMITS.entryMaxBytes + 1024),
    });
    expect(over.status).toBe(422);
    const problem = (await over.json()) as Problem;
    expect(problem.code).toBe(ERROR_CODES.SHOP_MAP_TOO_LARGE);
    expect(problem.details).toEqual({
      limit: 'entry',
      maxBytes: SHOP_WALK_LIMITS.entryMaxBytes,
    });
  });

  it('throttles the entries route per account', async () => {
    const limit = ACCOUNT_THROTTLE_LIMITS.shopWalkEntries.limit;
    const first = token('mapper-5', ['shopMap.record']);
    const statuses: number[] = [];
    for (let i = 0; i <= limit; i++) {
      const res = await call('POST', `/v1/catalog/walks/${WALK}/entries`, {
        bearer: first,
        body: entry(),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, limit).every((s) => s === 201)).toBe(true);
    expect(statuses[limit]).toBe(429);

    // Another account on the same address is not held up.
    const other = await call('POST', `/v1/catalog/walks/${WALK}/entries`, {
      bearer: token('mapper-6', ['shopMap.record']),
      body: entry(),
    });
    expect(other.status).toBe(201);
    // The throttle runs after the permission: a refused caller spends nothing.
    const refused = await call('POST', `/v1/catalog/walks/${WALK}/entries`, {
      bearer: shopper,
      body: entry(),
    });
    expect(refused.status).toBe(403);
  });
});
