import { JwtService } from '@nestjs/jwt';
import {
  ADMIN_TOKEN_AUDIENCE,
  UserKind,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import { generateKeyPairSync } from 'node:crypto';
import { PlatformAdminService } from './platform-admin.service';

/**
 * The harvester's gate (plan 0072, section 6).
 *
 * The same matrix catalog's spec runs, deliberately duplicated rather than
 * shared, because the two gates are separate classes with separate reach and the
 * point of testing both is that they cannot drift into disagreeing about the same
 * token. What differs is the last describe: the harvester has no service path, so
 * a uuid alone gets nowhere however it is configured.
 */
const adminKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const authKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });

const pem = (key: { export: (o: object) => string | Buffer }) =>
  key.export({ type: 'spki', format: 'pem' }).toString();

const jwt = new JwtService();

function signAdmin(
  overrides: {
    sub?: string;
    audience?: string;
    expiresIn?: string;
    privateKey?: typeof adminKeys.privateKey;
  } = {}
) {
  return jwt.sign(
    { sub: overrides.sub ?? 'admin-1' },
    {
      privateKey: overrides.privateKey ?? adminKeys.privateKey,
      algorithm: 'RS256',
      audience: overrides.audience ?? ADMIN_TOKEN_AUDIENCE,
      expiresIn: overrides.expiresIn ?? '15m',
    }
  );
}

function makeService(): PlatformAdminService {
  return new PlatformAdminService(jwt, {
    getOrThrow: () => ({ adminJwtPublicKey: pem(adminKeys.publicKey) }),
  } as never);
}

describe('PlatformAdminService (harvester)', () => {
  it('accepts a valid operator token and answers the admin id', async () => {
    await expect(
      makeService().requireAdmin({ userId: 'ignored', adminToken: signAdmin() })
    ).resolves.toBe('admin-1');
  });

  it('refuses an expired token', async () => {
    await expect(
      makeService().requireAdmin({
        userId: 'admin-1',
        adminToken: signAdmin({ expiresIn: '-1s' }),
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a token signed with the auth key', async () => {
    await expect(
      makeService().requireAdmin({
        userId: 'admin-1',
        adminToken: signAdmin({ privateKey: authKeys.privateKey }),
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a token with the wrong audience', async () => {
    await expect(
      makeService().requireAdmin({
        userId: 'admin-1',
        adminToken: signAdmin({ audience: 'velista' }),
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a velista access token', async () => {
    const token = jwt.sign(
      { sub: 'u1', kind: UserKind.REGISTERED },
      { privateKey: authKeys.privateKey, algorithm: 'RS256', expiresIn: '15m' }
    );
    await expect(
      makeService().requireAdmin({ userId: 'u1', adminToken: token })
    ).rejects.toThrow(ForbiddenException);
  });

  describe('there is no second way in', () => {
    // Catalog has a service path because the harvester writes to it. Nothing
    // writes to the harvester, so a caller with no token is refused whatever
    // uuid it presents. This is what keeps the 21 read subjects closed to an
    // unauthenticated caller.
    it('refuses a caller presenting only a uuid', async () => {
      await expect(
        makeService().requireAdmin({
          userId: 'ac700000-0000-4000-a000-000000000001',
        })
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a caller presenting nothing at all', async () => {
      await expect(makeService().requireAdmin({ userId: '' })).rejects.toThrow(
        ForbiddenException
      );
    });
  });
});
