import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorageService } from '@nestjs/throttler';
import {
  ADMIN_TOKEN_AUDIENCE,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import {
  createThrottlerOptions,
  RateLimitedException,
} from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import {
  ADMIN_THROTTLE_LIMIT,
  GatewayThrottlerGuard,
} from './gateway-throttler.guard';

/**
 * A verified operator is counted per operator, and nothing else is.
 *
 * Real RS256 keypairs, as in `admin-token-separation.spec.ts`, because the
 * property that matters is that a token nobody can verify earns nothing.
 */
const authKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const adminKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const strangerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

const pem = (key: { export: (o: object) => string | Buffer }) =>
  key.export({ type: 'spki', format: 'pem' }).toString();

const jwt = new JwtService();

const adminToken = (sub: string, privateKey = adminKeys.privateKey) =>
  jwt.sign(
    { sub },
    {
      privateKey,
      algorithm: 'RS256',
      audience: ADMIN_TOKEN_AUDIENCE,
      expiresIn: '15m',
    }
  );

const userToken = jwt.sign(
  { sub: 'u1', kind: UserKind.REGISTERED },
  { privateKey: authKeys.privateKey, algorithm: 'RS256', expiresIn: '15m' }
);

class AnyRoute {
  handle(): void {
    return undefined;
  }
}

function contextFor(ip: string, token?: string): ExecutionContext {
  const request = {
    ip,
    ips: [],
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const response = { header: jest.fn() };
  return {
    getHandler: () => AnyRoute.prototype.handle,
    getClass: () => AnyRoute,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

async function buildGuard() {
  const guard = new GatewayThrottlerGuard(
    createThrottlerOptions(),
    new ThrottlerStorageService(),
    new Reflector(),
    {
      getOrThrow: () => ({ adminJwtPublicKey: pem(adminKeys.publicKey) }),
    } as never
  );
  await guard.onModuleInit();
  return guard;
}

/** Sends `count` requests and answers how many were let through. */
async function send(
  guard: GatewayThrottlerGuard,
  count: number,
  context: () => ExecutionContext
): Promise<number> {
  let passed = 0;
  for (let i = 0; i < count; i += 1) {
    try {
      if (await guard.canActivate(context())) {
        passed += 1;
      }
    } catch (error) {
      if (!(error instanceof RateLimitedException)) {
        throw error;
      }
    }
  }
  return passed;
}

const DEFAULT_LIMIT = createThrottlerOptions().throttlers[0].limit as number;

describe('GatewayThrottlerGuard', () => {
  it('keeps an anonymous caller on the default bucket', async () => {
    const guard = await buildGuard();
    expect(
      await send(guard, DEFAULT_LIMIT + 5, () => contextFor('1.1.1.1'))
    ).toBe(DEFAULT_LIMIT);
  });

  it('keeps a velista access token on the default bucket', async () => {
    const guard = await buildGuard();
    expect(
      await send(guard, DEFAULT_LIMIT + 5, () =>
        contextFor('1.1.1.1', userToken)
      )
    ).toBe(DEFAULT_LIMIT);
  });

  it('counts a verified operator on the operator bucket, past the default limit', async () => {
    const guard = await buildGuard();
    const token = adminToken('a1');
    expect(
      await send(guard, ADMIN_THROTTLE_LIMIT.limit + 5, () =>
        contextFor('1.1.1.1', token)
      )
    ).toBe(ADMIN_THROTTLE_LIMIT.limit);
  });

  it('leaves the address bucket untouched by an operator', async () => {
    const guard = await buildGuard();
    const token = adminToken('a1');
    await send(guard, DEFAULT_LIMIT + 5, () => contextFor('1.1.1.1', token));
    expect(await send(guard, 1, () => contextFor('1.1.1.1'))).toBe(1);
  });

  it('gives each operator a bucket of their own', async () => {
    const guard = await buildGuard();
    const first = adminToken('a1');
    const second = adminToken('a2');
    await send(guard, ADMIN_THROTTLE_LIMIT.limit + 1, () =>
      contextFor('1.1.1.1', first)
    );
    expect(await send(guard, 1, () => contextFor('1.1.1.1', second))).toBe(1);
  });

  it('grants nothing to an admin audience token signed with another key', async () => {
    const guard = await buildGuard();
    const forged = adminToken('a1', strangerKeys.privateKey);
    expect(
      await send(guard, DEFAULT_LIMIT + 5, () => contextFor('1.1.1.1', forged))
    ).toBe(DEFAULT_LIMIT);
  });
});
