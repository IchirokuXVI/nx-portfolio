import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserKind } from '@portfolio/luna-shopper/contracts';
import {
  getRequestContext,
  runWithRequestContext,
} from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import { OptionalJwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy, type CurrentUser } from './jwt.strategy';

/**
 * Optional authentication rejects a stale token (plan 0020).
 *
 * The regression this guards against is silent and unrecoverable: a guest whose
 * access token expired while the app sat open used to be waved through as
 * anonymous, so the handler minted them a second identity and everything the
 * first one owned became unreachable. The tests below run against a real RS256
 * key pair and the real strategy, because the distinction that matters lives
 * inside passport-jwt's verification, not in the guard's own branches.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const jwt = new JwtService();

const sign = (claims: Record<string, unknown>, expiresIn: string) =>
  jwt.sign(claims, { privateKey, algorithm: 'RS256', expiresIn });

/** Registers the strategy with passport under the name the guard resolves. */
new JwtStrategy({
  getOrThrow: () => ({
    authJwtPublicKey: publicKey.export({ type: 'spki', format: 'pem' }),
  }),
} as never);

interface TestRequest {
  headers: Record<string, string>;
  user?: CurrentUser;
}

function contextFor(headers: Record<string, string>) {
  const request: TestRequest = { headers };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: () => undefined, end: () => undefined }),
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

const guard = new OptionalJwtAuthGuard();

describe('OptionalJwtAuthGuard', () => {
  it('lets a caller with no Authorization header through, attaching no user', async () => {
    const { context, request } = contextFor({});

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toBeUndefined();
  });

  it('rejects an expired token instead of treating it as anonymous', async () => {
    const token = sign({ sub: 'u1', kind: UserKind.TEMPORARY }, '-1s');
    const { context, request } = contextFor({
      authorization: `Bearer ${token}`,
    });

    // The assertion is on the rejection, not on a false return: the global
    // filter needs the exception to build the house envelope.
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
    expect(request.user).toBeUndefined();
  });

  it('rejects a token whose signature does not verify', async () => {
    const { privateKey: otherKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const token = jwt.sign(
      { sub: 'u1', kind: UserKind.REGISTERED },
      { privateKey: otherKey, algorithm: 'RS256', expiresIn: '15m' }
    );
    const { context } = contextFor({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  // Presented but unusable. A client defect answered with a new account would be
  // the same data loss in a different costume, so all of these are rejected.
  it.each([
    ['is malformed', 'Bearer not-a-token'],
    ['is present but empty', ''],
    ['carries no scheme', 'abc.def.ghi'],
  ])('rejects an Authorization header that %s', async (_name, header) => {
    const { context } = contextFor({ authorization: header });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('attaches the caller and pins the request context for a valid token', async () => {
    const token = sign({ sub: 'u1', kind: UserKind.REGISTERED }, '15m');
    const { context, request } = contextFor({
      authorization: `Bearer ${token}`,
    });

    const pinned = await runWithRequestContext(
      { correlationId: 'c1' },
      async () => {
        await expect(guard.canActivate(context)).resolves.toBe(true);
        return getRequestContext()?.userId;
      }
    );

    expect(request.user).toEqual({ userId: 'u1', kind: UserKind.REGISTERED });
    expect(pinned).toBe('u1');
  });
});
