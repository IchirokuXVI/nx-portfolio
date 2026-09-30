import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { UserKind } from '@portfolio/luna-shopper/contracts';
import {
  ERROR_CODES,
  GlobalExceptionFilter,
} from '@portfolio/luna-shopper/platform';
import { describeIntegration } from '@portfolio/luna-shopper/test-fixtures/jest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { JwtStrategy } from './jwt.strategy';
import { RequirePermission } from './require-permission.decorator';

/**
 * `@RequirePermission` over real HTTP (plan 0175).
 *
 * The route below is a **spec level controller**, and it is the only route in
 * the gateway that carries the decorator today: the product routes that need
 * `shopMap.record` arrive with backend plan 0168. Everything else is real: the
 * passport strategy verifying an RS256 signature, the guard, and the exception
 * filter that turns a refusal into the house envelope.
 *
 * The second block is the plan's end to end proof and runs only against a live
 * stack (`LUNA_INTEGRATION=1`): the back office grants `admin` through the real
 * gateway, the account refreshes through the real gateway, and the refreshed
 * token, verified with that stack's public key, passes this route where the
 * token from before the grant was refused.
 *
 *   bash k8s/e2e/luna-shopper-backend/luna-slot.sh --ephemeral --up <n> --services gateway,auth
 *   LUNA_INTEGRATION=1 LUNA_GATEWAY_URL=http://localhost:<gateway port> \
 *     AUTH_JWT_PUBLIC_KEY_FILE=<the slot's auth public key> \
 *     npx nx test luna-shopper-backend-gateway --testFile=require-permission.http.spec.ts
 */

@Controller('probe')
class ProbeController {
  @Get('map')
  @RequirePermission('shopMap.record')
  map(): { ok: true } {
    return { ok: true };
  }
}

async function boot(publicKey: string) {
  const nest = (
    await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProbeController],
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => ({ authJwtPublicKey: publicKey }) },
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
  return { nest, origin: `http://127.0.0.1:${port}` };
}

interface Problem {
  code?: string;
  details?: Record<string, unknown>;
}

describe('@RequirePermission over HTTP', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwt = new JwtService();
  const sign = (claims: Record<string, unknown>) =>
    jwt.sign(claims, { privateKey, algorithm: 'RS256', expiresIn: '15m' });

  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    app = await boot(
      publicKey.export({ type: 'spki', format: 'pem' }).toString()
    );
  });

  afterAll(async () => {
    await app.nest.close();
  });

  const probe = (token?: string) =>
    fetch(`${app.origin}/probe/map`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

  it('passes an account whose token carries the permission', async () => {
    const res = await probe(
      sign({ sub: 'u1', kind: UserKind.REGISTERED, perms: ['shopMap.record'] })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('refuses an account without it with 403 and names the permission', async () => {
    const res = await probe(
      sign({ sub: 'u1', kind: UserKind.REGISTERED, perms: [] })
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as Problem;
    expect(body.code).toBe(ERROR_CODES.PERMISSION_REQUIRED);
    expect(body.details).toEqual({ permission: 'shopMap.record' });
  });

  // A token signed before plan 0175 has no claim at all, and a guest's is empty.
  it.each([
    ['carries no perms claim', { sub: 'u1', kind: UserKind.REGISTERED }],
    [
      'names only a permission this gateway has never heard of',
      { sub: 'u1', kind: UserKind.REGISTERED, perms: ['prices.trusted'] },
    ],
    [
      'names a role instead of a permission',
      { sub: 'u1', kind: UserKind.REGISTERED, perms: ['admin'] },
    ],
  ])('refuses a token that %s', async (_name, claims) => {
    const res = await probe(sign(claims));

    expect(res.status).toBe(403);
    expect(((await res.json()) as Problem).code).toBe(
      ERROR_CODES.PERMISSION_REQUIRED
    );
  });

  it('answers 401 with no token, so the guard never sees an anonymous caller', async () => {
    const res = await probe();

    expect(res.status).toBe(401);
    expect(((await res.json()) as Problem).code).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});

/**
 * The plan's progress evidence, against a live stack: the back office sets
 * `admin` on an account, the account refreshes, and a route guarded by
 * `shopMap.record` passes where it failed before. The guest refusal is here too,
 * and so is the role filter on the user list, because both are only worth
 * proving through the real gateway and the real auth service.
 */
describeIntegration('granting a role, end to end (live stack)', () => {
  const gateway = process.env['LUNA_GATEWAY_URL'] ?? 'http://localhost:3000';
  let app: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    const file = process.env['AUTH_JWT_PUBLIC_KEY_FILE'];
    const inline = process.env['AUTH_JWT_PUBLIC_KEY'];
    const publicKey = file ? readFileSync(file, 'utf8') : inline;
    if (!publicKey) {
      throw new Error(
        'Set AUTH_JWT_PUBLIC_KEY_FILE or AUTH_JWT_PUBLIC_KEY to the stack’s auth public key'
      );
    }
    app = await boot(publicKey);
  });

  afterAll(async () => {
    await app?.nest.close();
  });

  async function call<T>(
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {}
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${gateway}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  const probe = (token: string) =>
    fetch(`${app.origin}/probe/map`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  interface Tokens {
    userId: string;
    accessToken: string;
    refreshToken: string;
  }

  it('grants admin from the back office, refreshes, and passes the guarded route', async () => {
    // A guest: a zone created with no token mints one.
    const zone = await call<{ tokens: Tokens }>('POST', '/v1/zones', {
      body: { name: 'Plan 0175 zone', username: 'mapper' },
    });
    expect(zone.status).toBe(201);
    const guest = zone.body.tokens;

    const login = await call<{ accessToken: string }>(
      'POST',
      '/v1/admin/auth/login',
      { body: { username: 'dev-admin', password: 'dev-admin-password' } }
    );
    expect(login.status).toBe(201);
    const operator = login.body.accessToken;

    // A guest holds no role.
    const refused = await call<Problem>(
      'PUT',
      `/v1/admin/users/${guest.userId}/roles`,
      { token: operator, body: { roles: ['admin'] } }
    );
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe(ERROR_CODES.GUEST_HAS_NO_ROLES);

    // The upgrade keeps the id and an empty set.
    const upgraded = await call<Tokens>('POST', '/v1/auth/upgrade', {
      token: guest.accessToken,
      body: {
        email: `plan0175-${Date.now()}@example.com`,
        password: 'a long enough password 0175',
      },
    });
    expect(upgraded.status).toBe(201);
    expect(upgraded.body.userId).toBe(guest.userId);

    const meBefore = await call<{ permissions: string[] }>(
      'GET',
      '/v1/account/me',
      { token: upgraded.body.accessToken }
    );
    expect(meBefore.status).toBe(200);
    expect(meBefore.body.permissions).toEqual([]);
    expect((await probe(upgraded.body.accessToken)).status).toBe(403);

    const granted = await call<{ roles: string[] }>(
      'PUT',
      `/v1/admin/users/${guest.userId}/roles`,
      { token: operator, body: { roles: ['admin'] } }
    );
    expect(granted.status).toBe(200);
    expect(granted.body.roles).toEqual(['admin']);

    const filtered = await call<{ items: { userId: string }[] }>(
      'GET',
      '/v1/admin/users?role=admin&limit=100',
      { token: operator }
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.map((row) => row.userId)).toContain(
      guest.userId
    );

    // The token from before the grant still says nothing: permissions travel
    // in the token, so they arrive with the next one.
    expect((await probe(upgraded.body.accessToken)).status).toBe(403);

    const refreshed = await call<Tokens>('POST', '/v1/auth/refresh', {
      body: { refreshToken: upgraded.body.refreshToken },
    });
    expect(refreshed.status).toBe(201);

    const probed = await probe(refreshed.body.accessToken);
    expect(probed.status).toBe(200);

    const meAfter = await call<{ permissions: string[] }>(
      'GET',
      '/v1/account/me',
      { token: refreshed.body.accessToken }
    );
    expect(meAfter.body.permissions).toEqual(['shopMap.record']);

    // Tidy: take the role away again, so the stack is left as it was found.
    const cleared = await call<{ roles: string[] }>(
      'PUT',
      `/v1/admin/users/${guest.userId}/roles`,
      { token: operator, body: { roles: [] } }
    );
    expect(cleared.body.roles).toEqual([]);
  });
});
