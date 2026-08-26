import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AUTH_PATTERNS,
  UserKind,
  ZONE_PATTERNS,
} from '@portfolio/luna-shopper/contracts';
import { generateKeyPairSync } from 'node:crypto';
import { OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtStrategy, type CurrentUser } from '../auth/jwt.strategy';
import { ZoneController } from './zone.controller';

/**
 * A stale token never mints a second identity (plan 0020, section 6).
 *
 * The assertion is on the NATS call rather than on the status code, because the
 * regression this plan exists to prevent is not "the wrong number came back", it
 * is "a guest silently lost every zone they owned". Only
 * `auth.createTemporaryUser` firing can cause that, so that is what is asserted.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const jwt = new JwtService();

const sign = (expiresIn: string) =>
  jwt.sign(
    { sub: 'u1', kind: UserKind.TEMPORARY },
    { privateKey, algorithm: 'RS256', expiresIn }
  );

new JwtStrategy({
  getOrThrow: () => ({
    authJwtPublicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  }),
} as never);

const guard = new OptionalJwtAuthGuard();

function build() {
  const send = jest.fn(async (subject: string) => {
    if (subject === AUTH_PATTERNS.createTemporaryUser) {
      return {
        userId: 'guest',
        kind: UserKind.TEMPORARY,
        username: 'Quiet Lantern',
        accessToken: 'a',
        refreshToken: 'r',
      };
    }
    if (subject === AUTH_PATTERNS.getProfile) {
      return { userId: 'u1', username: 'Swift Sail' };
    }
    return { id: 'z1' };
  });
  return { controller: new ZoneController({ send } as never), send };
}

/**
 * Runs the guard the way Nest's pipeline does, then the handler only if the
 * guard let the request through. `request.user` is whatever the guard attached,
 * which is what `@AuthUser()` would hand the handler.
 */
async function throughGuard(
  authorization: string | undefined,
  handler: (user: CurrentUser | undefined) => Promise<unknown>
) {
  const request: { headers: Record<string, string>; user?: CurrentUser } = {
    headers: authorization === undefined ? {} : { authorization },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: () => undefined, end: () => undefined }),
    }),
  } as unknown as ExecutionContext;

  await guard.canActivate(context);
  return handler(request.user);
}

const calledWith = (send: jest.Mock, subject: string) =>
  send.mock.calls.some((c) => c[0] === subject);

describe('zone entry points with a stale token', () => {
  it('POST /v1/zones does not mint a temporary user for an expired token', async () => {
    const { controller, send } = build();
    const expired = sign('-1s');

    await expect(
      throughGuard(`Bearer ${expired}`, (user) =>
        controller.create(user, { name: 'Home' })
      )
    ).rejects.toBeDefined();

    expect(calledWith(send, AUTH_PATTERNS.createTemporaryUser)).toBe(false);
    expect(calledWith(send, ZONE_PATTERNS.create)).toBe(false);
  });

  it('POST /v1/zones/join does not mint a temporary user for an expired token', async () => {
    const { controller, send } = build();
    const expired = sign('-1s');

    await expect(
      throughGuard(`Bearer ${expired}`, (user) =>
        controller.join(user, { joinCode: 'ABCD1234' })
      )
    ).rejects.toBeDefined();

    expect(calledWith(send, AUTH_PATTERNS.createTemporaryUser)).toBe(false);
    expect(calledWith(send, ZONE_PATTERNS.join)).toBe(false);
  });

  it('a caller with no token at all still gets a temporary identity', async () => {
    const { controller, send } = build();

    const result = (await throughGuard(undefined, (user) =>
      controller.create(user, { name: 'Home' })
    )) as { tokens?: { userId: string } };

    expect(calledWith(send, AUTH_PATTERNS.createTemporaryUser)).toBe(true);
    expect(result.tokens?.userId).toBe('guest');
  });

  it('a caller with a valid token acts as that user and gets no tokens back', async () => {
    const { controller, send } = build();

    const result = (await throughGuard(`Bearer ${sign('15m')}`, (user) =>
      controller.create(user, { name: 'Home' })
    )) as { tokens?: unknown };

    expect(calledWith(send, AUTH_PATTERNS.createTemporaryUser)).toBe(false);
    expect(result.tokens).toBeUndefined();
  });
});
