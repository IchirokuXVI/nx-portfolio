import { HttpStatus, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import { generateKeyPairSync } from 'node:crypto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { AdminJwtGuard } from './admin-jwt.guard';
import { AdminJwtStrategy, type CurrentAdmin } from './admin-jwt.strategy';

/**
 * The two principals cannot be substituted for one another (plan 0071,
 * sections 3 and 5, and two of section 11's exit criteria).
 *
 * Section 5 asks for this as a *requirement* rather than an observation, and the
 * distinction is the whole reason the file exists. It does fall out of the key
 * split: an admin token is signed with a key `JwtStrategy` does not hold, so it
 * cannot verify. But the day somebody decides one keypair is enough, that
 * property disappears without a single line changing in either guard, and this is
 * what fails instead.
 *
 * Everything runs against real RS256 keypairs and the real strategies, because
 * what is being asserted lives inside passport-jwt's verification rather than in
 * any branch of ours.
 */
const authKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const adminKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

const pem = (key: { export: (o: object) => string | Buffer }) =>
  key.export({ type: 'spki', format: 'pem' }).toString();

const jwt = new JwtService();

/** A velista access token, exactly as `TokenService` signs one. */
const userToken = jwt.sign(
  { sub: 'u1', kind: UserKind.REGISTERED },
  { privateKey: authKeys.privateKey, algorithm: 'RS256', expiresIn: '15m' }
);

/** An operator token, exactly as `AdminTokenService` signs one. */
const adminToken = jwt.sign(
  { sub: 'a1' },
  {
    privateKey: adminKeys.privateKey,
    algorithm: 'RS256',
    audience: ADMIN_TOKEN_AUDIENCE,
    expiresIn: '15m',
  }
);

// Both strategies register themselves with passport under their own names, which
// is what the two guards resolve.
new JwtStrategy({
  getOrThrow: () => ({ authJwtPublicKey: pem(authKeys.publicKey) }),
} as never);
new AdminJwtStrategy({
  getOrThrow: () => ({ adminJwtPublicKey: pem(adminKeys.publicKey) }),
} as never);

function contextFor(token?: string) {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: () => undefined, end: () => undefined }),
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

const adminGuard = new AdminJwtGuard();
const userGuard = new JwtAuthGuard();

describe('admin and user tokens are separate principals', () => {
  it('accepts an operator token on an admin route, as the operator', async () => {
    const { context, request } = contextFor(adminToken);

    await expect(adminGuard.canActivate(context)).resolves.toBe(true);

    // `adminId` and no `userId`: a handler that asked for the wrong principal
    // would not find one, rather than find something it could act on. The token
    // comes back with it because catalog and the harvester verify it again for
    // themselves (plan 0073, section 1), so the route has to forward it.
    expect(request.user as CurrentAdmin).toEqual({
      adminId: 'a1',
      token: adminToken,
    });
  });

  it('rejects a velista access token on an admin route', async () => {
    const { context } = contextFor(userToken);

    await expect(adminGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('rejects an operator token on a user route', async () => {
    // Stated as a requirement in section 5 rather than assumed to fall out of the
    // key split, which is exactly what it does today.
    const { context } = contextFor(adminToken);

    await expect(userGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('rejects a token signed with the admin key that claims another audience', async () => {
    // The redundant check, made load bearing. If the two keys were ever merged,
    // this is the assertion still standing between an operator route and a token
    // minted for something else.
    const wrongAudience = jwt.sign(
      { sub: 'a1' },
      {
        privateKey: adminKeys.privateKey,
        algorithm: 'RS256',
        audience: 'velista',
        expiresIn: '15m',
      }
    );
    const { context } = contextFor(wrongAudience);

    await expect(adminGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('rejects an expired operator token', async () => {
    const expired = jwt.sign(
      { sub: 'a1' },
      {
        privateKey: adminKeys.privateKey,
        algorithm: 'RS256',
        audience: ADMIN_TOKEN_AUDIENCE,
        expiresIn: '-1s',
      }
    );
    const { context } = contextFor(expired);

    await expect(adminGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('rejects a request with no token at all', async () => {
    const { context } = contextFor();

    await expect(adminGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });
});
